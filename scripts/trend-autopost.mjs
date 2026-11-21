#!/usr/bin/env node
/**
 * Voltswap Live-Trend Autoposter (Mode A: Full Autopilot, $0/month)
 *
 * Collects live real-time Sui signals right at publish time:
 *   1. Voltswap Whale Radar (/api/whales?fresh=1) — real Sui buy/sell flows & DEX share
 *   2. DeFiLlama API — Sui protocol TVL & 24h movers
 *   3. DexScreener API — top Sui volume & moving token pairs
 *   4. Google News RSS (24h) — breaking Sui / Hashi / Mysten headlines
 *   5. Gemini 3.8 Flash (@google/genai Interactions API + Google Search grounding)
 *
 * Renders a crisp 1600x900 dark-gold Voltswap data card via Python Pillow,
 * then publishes to X (@voltswap via official X API v2) & Telegram (@voltswap_org).
 *
 * Environment secrets (NEVER commit):
 *   GEMINI_API_KEY
 *   X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET
 *   WHALE_TG_BOT_TOKEN (optional: posts to @voltswap_org)
 *   WHALE_TG_CHANNEL_ID (default: @voltswap_org)
 */

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "1";
const TEST_CARD_ONLY = process.argv.includes("--test-card");
const PUBLISH_X = process.env.PUBLISH_X !== "0";
const PUBLISH_TG = process.env.PUBLISH_TG !== "0";
const STATE_FILE = path.resolve(process.env.TREND_STATE_FILE ?? ".trend-history.json");
const GEMINI_MODEL = (process.env.GEMINI_MODEL ?? "gemini-3.8-flash").trim();
const TOPIC_HINT = (process.env.TOPIC_HINT ?? "").trim();

const STABLES = new Set(["USDC", "USDT", "BUCK", "AUSD", "FDUSD", "USDY", "SUSDC", "WUSDC", "USDB", "SBUSDT", "DAI"]);
const isStable = (s) => STABLES.has(String(s ?? "").trim().toUpperCase());

function sanitizeTelegramHtml(raw) {
  let s = String(raw ?? "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<\s*(p|div|li|h[1-6])[^>]*>/gi, "")
    .replace(/<(?!\/?(?:b|strong|i|em|code|pre|a)(?:\s|>|$))[^>]+>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s;
}

function fmtUsd(v) {
  if (!Number.isFinite(v)) return "$0";
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${Math.round(v)}`;
}

function xWeightedLen(text) {
  const normalized = String(text ?? "").replace(/https?:\/\/\S+/g, "x".repeat(23));
  let n = 0;
  for (const ch of normalized) {
    const cp = ch.codePointAt(0) ?? 0;
    n += cp > 0x2000 && cp > 0x27ff ? 2 : 1;
  }
  return n;
}

function trimXText(text, maxWeighted = 274) {
  let s = String(text ?? "").trim();
  if (xWeightedLen(s) <= maxWeighted) return s;
  const lines = s.split("\n");
  while (lines.length > 2 && xWeightedLen(lines.join("\n")) > maxWeighted) {
    lines.splice(lines.length - 2, 1);
  }
  s = lines.join("\n");
  while (xWeightedLen(s) > maxWeighted && s.length > 40) {
    s = s.slice(0, -4).trimEnd() + "...";
  }
  return s;
}

function loadHistory() {
  try {
    const j = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    if (Array.isArray(j?.posts)) return j;
  } catch {
    // fresh
  }
  return { posts: [] };
}

function saveHistory(hist) {
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const posts = (hist.posts || []).filter((p) => (p.ts || 0) >= cutoff).slice(-40);
  fs.writeFileSync(STATE_FILE, JSON.stringify({ posts, updatedAt: Date.now() }, null, 2));
}

async function fetchJson(url, timeoutMs = 12_000) {
  const r = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "voltswap-trend-bot/1.0" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

async function collectLiveSignals() {
  const out = { capturedAtUtc: new Date().toISOString(), whales: null, defiLlamaSui: [], dexScreenerSui: [], newsHeadlines: [] };

  await Promise.allSettled([
    // 1. Live Voltswap Whale Radar (last 1h swaps across 5 Sui DEXes)
    fetchJson("https://voltswap.org/api/whales?fresh=1", 20_000).then((w) => {
      const items = Array.isArray(w?.items) ? w.items : [];
      let totalUsd = 0;
      const byDex = {};
      const netFlow = {};
      for (const it of items) {
        const u = Number(it.usd) || 0;
        totalUsd += u;
        byDex[it.dex] = (byDex[it.dex] || 0) + u;
        const inS = isStable(it.inSym);
        const outS = isStable(it.outSym);
        if (inS && !outS) netFlow[it.outSym] = (netFlow[it.outSym] || 0) + u;
        else if (!inS && outS) netFlow[it.inSym] = (netFlow[it.inSym] || 0) - u;
      }
      const topSwaps = [...items]
        .sort((a, b) => (b.usd || 0) - (a.usd || 0))
        .slice(0, 6)
        .map((x) => ({
          dex: x.dex,
          pair: `${x.inSym} -> ${x.outSym}`,
          usd: Math.round(x.usd || 0),
        }));
      const topNet = Object.entries(netFlow)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 5)
        .map(([sym, usd]) => ({ sym, netUsd: Math.round(usd), bias: usd >= 0 ? "net_buy" : "net_sell" }));
      out.whales = {
        swapCount1h: items.length,
        totalUsd1h: Math.round(totalUsd),
        dexVolume: Object.entries(byDex)
          .sort((a, b) => b[1] - a[1])
          .map(([dex, usd]) => ({ dex, usd: Math.round(usd) })),
        topNet,
        topSwaps,
      };
    }),

    // 2. DeFiLlama Sui protocols TVL & 24h movers
    fetchJson("https://api.llama.fi/protocols", 15_000).then((list) => {
      if (!Array.isArray(list)) return;
      const sui = list.filter((p) => Array.isArray(p.chains) && p.chains.includes("Sui") && (p.chainTvls?.Sui || 0) >= 2_000_000);
      const topByTvl = [...sui].sort((a, b) => (b.chainTvls?.Sui || 0) - (a.chainTvls?.Sui || 0)).slice(0, 6);
      const topByMove = [...sui]
        .filter((p) => Number.isFinite(p.change_1d))
        .sort((a, b) => Math.abs(b.change_1d) - Math.abs(a.change_1d))
        .slice(0, 5);
      const merged = new Map();
      for (const p of [...topByMove, ...topByTvl]) {
        merged.set(p.name, {
          name: p.name,
          category: p.category,
          suiTvlUsd: Math.round(p.chainTvls?.Sui || 0),
          change24hPct: Number.isFinite(p.change_1d) ? Number(p.change_1d.toFixed(2)) : null,
        });
      }
      out.defiLlamaSui = [...merged.values()].slice(0, 8);
    }),

    // 3. DexScreener Sui top-volume pairs
    fetchJson("https://api.dexscreener.com/latest/dex/search?q=SUI", 12_000).then((j) => {
      const pairs = (j?.pairs || [])
        .filter((p) => p.chainId === "sui" && (p.volume?.h24 || 0) >= 50_000)
        .sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0));
      const seen = new Set();
      for (const p of pairs) {
        const key = `${p.baseToken?.symbol}/${p.quoteToken?.symbol}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.dexScreenerSui.push({
          pair: key,
          dex: p.dexId,
          priceUsd: p.priceUsd,
          vol24hUsd: Math.round(p.volume?.h24 || 0),
          change24hPct: p.priceChange?.h24 ?? null,
        });
        if (out.dexScreenerSui.length >= 6) break;
      }
    }),

    // 4. Google News RSS (breaking Sui headlines last 24h)
    fetch("https://news.google.com/rss/search?q=%22Sui%22+(crypto+OR+DeFi+OR+blockchain+OR+hBTC+OR+Mysten)+when:1d&hl=en-US&gl=US&ceid=US:en", {
      signal: AbortSignal.timeout(12_000),
    })
      .then((r) => (r.ok ? r.text() : ""))
      .then((xml) => {
        const matches = [...xml.matchAll(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>[\s\S]*?<pubDate>([\s\S]*?)<\/pubDate>/g)];
        out.newsHeadlines = matches
          .map((m) => ({
            title: m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim(),
            pubDate: m[2].trim(),
          }))
          .filter((n) => !/price\s+(prediction|forecast)|2027|2028|2030|2040/i.test(n.title))
          .slice(0, 8);
      }),
  ]);

  return out;
}

function extractJsonObject(raw) {
  const s = String(raw ?? "").trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : s;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("Model did not return a JSON object");
  }
  return JSON.parse(candidate.slice(first, last + 1));
}

function buildDeterministicFallback(signals, recentHistory) {
  const recentKeys = new Set(
    (recentHistory.posts || [])
      .filter((p) => Date.now() - (p.ts || 0) < 48 * 60 * 60 * 1000)
      .map((p) => p.topic_key),
  );
  const w = signals.whales || { swapCount1h: 0, totalUsd1h: 0, dexVolume: [], topNet: [], topSwaps: [] };
  const topDex = w.dexVolume?.[0];
  const topNet = w.topNet?.[0];
  const topPair = signals.dexScreenerSui?.[0];
  const topNews = signals.newsHeadlines?.find((n) => n.title && n.title.length > 20);
  const topLlama = [...(signals.defiLlamaSui || [])].sort((a, b) => (b.change24hPct ?? -999) - (a.change24hPct ?? -999))[0];

  // Candidate 1: Breaking Sui news + live Whale Radar context
  if (topNews && !recentKeys.has("news-" + topNews.title.toLowerCase().slice(0, 24).replace(/[^a-z0-9]+/g, "-"))) {
    const cleanTitle = topNews.title.replace(/\s+-\s+[^-]+$/, "").trim();
    const key = "news-" + cleanTitle.toLowerCase().slice(0, 24).replace(/[^a-z0-9]+/g, "-");
    const shortHeadline = cleanTitle.length > 64 ? cleanTitle.slice(0, 61).trimEnd() + "..." : cleanTitle;
    const xText = trimXText(
      `Trending on @SuiNetwork right now:\n${shortHeadline}\n\nLive Whale Radar: ${w.swapCount1h} large swaps (${fmtUsd(w.totalUsd1h)}) in the last hour${topDex ? `, led by ${topDex.dex}` : ""}.\n\nTrack live & swap (0.10% -> 0.00% fee):\nhttps://voltswap.org/whales\n#Sui #DeFi`,
      274,
    );
    const tgHtml = [
      `⚡ <b>Trending on Sui Right Now</b>`,
      ``,
      `<b>${cleanTitle.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</b>`,
      ``,
      `🐋 Live Whale Radar (1h): <code>${w.swapCount1h} swaps</code> · <code>${fmtUsd(w.totalUsd1h)}</code>${topDex ? ` (led by <b>${topDex.dex}</b>)` : ""}`,
      topPair ? `📊 Spot Pulse: <code>${topPair.pair}</code> 24h vol <code>${fmtUsd(topPair.vol24hUsd)}</code> (${topPair.change24hPct ?? 0}%)` : "",
      ``,
      `<i>Track live flows &amp; split-route across all 5 Sui DEX pools at voltswap.org/whales</i>`,
    ]
      .filter(Boolean)
      .join("\n");
    return {
      topic_key: key,
      x_text: xText,
      tg_html: tgHtml,
      card: {
        badge: "TRENDING ON SUI",
        headline: shortHeadline,
        subline: "Live Sui ecosystem momentum paired with real-time on-chain Whale Radar liquidity.",
        cta: "voltswap.org/whales",
        stats: [
          { label: "WHALE RADAR (1H)", value: fmtUsd(w.totalUsd1h), note: `${w.swapCount1h} large swaps live`, tone: "gold" },
          {
            label: topPair ? `${topPair.pair} 24H VOL` : "TOP DEX FLOW",
            value: topPair ? fmtUsd(topPair.vol24hUsd) : topDex ? fmtUsd(topDex.usd) : "$3M+",
            note: topPair?.change24hPct != null ? `24h move: ${topPair.change24hPct}%` : topDex ? `${topDex.dex} leading` : "Sui spot volume",
            tone: (topPair?.change24hPct ?? 0) >= 0 ? "up" : "down",
          },
          { label: "VOLTSWAP FEE", value: "0.10% -> 0.00%", note: "6 ranks + 50% atomic PTB", tone: "neutral" },
        ],
      },
    };
  }

  // Candidate 2: Live Whale Radar + TVL Pulse
  const key = `whale-pulse-${new Date().toISOString().slice(0, 13)}`;
  const netStr = topNet ? `${topNet.sym} ${topNet.bias === "net_buy" ? "net buy" : "net sell"} ${fmtUsd(Math.abs(topNet.netUsd))}` : `${w.swapCount1h} whale swaps live`;
  const xText = trimXText(
    `Sui Whale Pulse (last 1h) ⚡\n\n• ${w.swapCount1h} large swaps worth ${fmtUsd(w.totalUsd1h)}\n• Flow focus: ${netStr}${topDex ? `\n• Top venue: ${topDex.dex} (${fmtUsd(topDex.usd)})` : ""}\n\nWatch live free & split-route:\nhttps://voltswap.org/whales\n#Sui #DeFi`,
    274,
  );
  const tgHtml = [
    `🐋 <b>Sui Whale Pulse (Last 1h)</b>`,
    ``,
    `• Large swaps tracked: <code>${w.swapCount1h}</code> (<b>${fmtUsd(w.totalUsd1h)}</b>)`,
    `• Top flow bias: <code>${netStr}</code>`,
    topDex ? `• Leading DEX: <b>${topDex.dex}</b> (<code>${fmtUsd(topDex.usd)}</code>)` : "",
    topLlama ? `• DeFiLlama mover: <b>${topLlama.name}</b> (<code>${fmtUsd(topLlama.suiTvlUsd)}</code> TVL)` : "",
    ``,
    `<i>Real-time non-custodial routing across all 5 Sui DEXes · 0.10% down to 0.00% fee</i>`,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    topic_key: key,
    x_text: xText,
    tg_html: tgHtml,
    card: {
      badge: "SUI WHALE PULSE",
      headline: `${fmtUsd(w.totalUsd1h)} in Large Sui Swaps Last Hour`,
      subline: `Real-time flow across Cetus, DeepBook, Bluefin, Momentum & Turbos: ${netStr}.`,
      cta: "voltswap.org/whales",
      stats: [
        { label: "1H WHALE VOLUME", value: fmtUsd(w.totalUsd1h), note: `${w.swapCount1h} swaps tracked live`, tone: "gold" },
        {
          label: topDex ? `TOP VENUE: ${topDex.dex}` : "FLOW BIAS",
          value: topDex ? fmtUsd(topDex.usd) : netStr.slice(0, 18),
          note: topNet ? `${topNet.sym} ${topNet.bias === "net_buy" ? "buying" : "selling"}` : "5 Sui DEXes live",
          tone: topNet?.bias === "net_sell" ? "down" : "up",
        },
        {
          label: topLlama ? `${topLlama.name} TVL` : "VOLTSWAP RANKS",
          value: topLlama ? fmtUsd(topLlama.suiTvlUsd) : "0.10% -> 0.00%",
          note: topLlama?.change24hPct != null ? `24h TVL: ${topLlama.change24hPct}%` : "6 glowing on-chain tiers",
          tone: "neutral",
        },
      ],
    },
  };
}

async function callModelWithTimeout(ai, params, timeoutMs = 25_000) {
  let timer;
  try {
    return await Promise.race([
      ai.interactions.create(params),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function generatePostWithGemini(signals, recentHistory) {
  const apiKey = (process.env.GEMINI_API_KEY ?? "").trim();
  if (!apiKey) {
    console.log("[voltswap-trend] GEMINI_API_KEY is not set; using live deterministic data brief.");
    return buildDeterministicFallback(signals, recentHistory);
  }

  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey, httpOptions: { timeout: 22_000 } });

  const recentTopics = (recentHistory.posts || [])
    .filter((p) => Date.now() - (p.ts || 0) < 72 * 60 * 60 * 1000)
    .slice(-12)
    .map((p) => `- ${p.topic_key}: ${p.headline}`);

  const systemInstruction = `You are the lead Sui DeFi analyst & growth editor for Voltswap (voltswap.org), a non-custodial Sui DEX aggregator (split-routing across Cetus, DeepBook, Bluefin, Momentum & Turbos, live Hashi $hBTC pools, free live Whale Radar at voltswap.org/whales, 6 glowing Trader Ranks from 0.10% down to 0.00% fee, and 25%-50% atomic Move PTB partner rev-share at voltswap.org/partner).

Write ONE sharp, data-backed post about the SINGLE hottest Sui ecosystem trend RIGHT NOW.

STRICT RULES:
1. NEVER invent or hallucinate numbers. Cite ONLY real numbers from the LIVE SIGNALS JSON.
2. NEVER repeat a topic covered in the last 72h list below.
3. ZERO AI slop or cringe marketing buzzwords (ban: "exciting", "revolutionizing", "game-changer", "dive into", "in the rapidly evolving", "delve", "unlock the power", "seamless"). Write like a real sharp crypto trader/analyst on X.
4. Tie the live Sui trend naturally (1 short line) to Voltswap (mention Voltswap Whale Radar or Voltswap split-routing). IMPORTANT for X reach & API cost: in x_text do NOT put clickable URLs or raw domain links (the URL already appears cleanly on the attached data graphic card!). Never mention Darkglide.
5. x_text MUST be strictly <= 255 characters total (no URLs, max 2 hashtags like #Sui #DeFi).
6. tg_html must use plain newlines (\n) — NEVER use <br> or <p> tags! Allowed Telegram HTML tags ONLY: <b>, <code>, <i>, <a href="...">. 300-520 chars, great for @voltswap_org subscribers.
7. card fields MUST be clean ASCII/numbers (NO emojis in card fields!) for a 1600x900 dark-gold data graphic:
   - badge: 2-4 words uppercase (e.g. "SUI WHALE PULSE", "SUI BTCFI LIVE", "SUI TVL MOVERS")
   - headline: punchy 5-10 word headline with a real number or ticker
   - subline: concise 10-18 word context line
   - cta: short URL path ("voltswap.org", "voltswap.org/whales", or "voltswap.org/partner")
   - stats: EXACTLY 3 objects { "label": "SHORT LABEL", "value": "SHORT VALUE", "note": "short 3-6 word note", "tone": "up"|"down"|"gold"|"neutral" }

Return ONLY valid JSON matching:
{
  "topic_key": "short-kebab-slug",
  "x_text": "...",
  "tg_html": "...",
  "card": {
    "badge": "...",
    "headline": "...",
    "subline": "...",
    "cta": "voltswap.org/whales",
    "stats": [
      { "label": "...", "value": "...", "note": "...", "tone": "gold" },
      { "label": "...", "value": "...", "note": "...", "tone": "up" },
      { "label": "...", "value": "...", "note": "...", "tone": "neutral" }
    ]
  }
}`;

  const prompt = [
    `Current UTC time: ${signals.capturedAtUtc}`,
    TOPIC_HINT ? `Priority topic hint from operator: ${TOPIC_HINT}` : "",
    recentTopics.length ? `Topics ALREADY posted in the last 72h (DO NOT REPEAT):\n${recentTopics.join("\n")}` : "No recent posts in last 72h.",
    "",
    "LIVE ON-CHAIN & NEWS SIGNALS RIGHT NOW:",
    JSON.stringify(signals, null, 2),
    "",
    "Pick the single strongest trending angle right now (fresh breaking Sui/Hashi/DeFi news OR the sharpest live Whale Radar / TVL / volume move) and return ONLY the JSON object.",
  ]
    .filter(Boolean)
    .join("\n");

  const useSearch = process.env.GEMINI_ENABLE_SEARCH === "1";
  const modelChain = [...new Set(["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", GEMINI_MODEL, "gemma-4-31b-it", "gemma-4-26b-a4b-it"].filter(Boolean))];

  for (const model of modelChain) {
    try {
      const isGemma = model.startsWith("gemma-");
      const interaction = await callModelWithTimeout(
        ai,
        {
          model,
          system_instruction: isGemma ? undefined : systemInstruction,
          input: isGemma ? `${systemInstruction}\n\n${prompt}` : prompt,
          tools: !isGemma && useSearch ? [{ type: "google_search" }] : undefined,
          store: false,
        },
        25_000,
      );
      const parsed = extractJsonObject(interaction.output_text);
      if (parsed?.x_text && parsed?.card?.headline) {
        console.log(`[voltswap-trend] generated via model=${model}`);
        parsed.x_text = trimXText(parsed.x_text, 274);
        return parsed;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "err";
      console.warn(`[voltswap-trend] model=${model} skipped: ${msg.slice(0, 180)}`);
    }
  }

  console.warn("[voltswap-trend] All Gemini/Gemma models hit rate limits; falling back to live deterministic data brief.");
  return buildDeterministicFallback(signals, recentHistory);
}

function renderCardPng(cardData, outPngPath) {
  const tmpJson = outPngPath.replace(/\.png$/i, ".json");
  fs.writeFileSync(tmpJson, JSON.stringify(cardData, null, 2));
  const scriptPath = path.join(__dirname, "render-trend-card.py");
  const py = process.platform === "win32" ? "python" : "python3";
  execFileSync(py, [scriptPath, "--input", tmpJson, "--output", outPngPath], { stdio: "inherit" });
  try {
    fs.unlinkSync(tmpJson);
  } catch {
    // ignore
  }
}

// --- Official X API v2 OAuth 1.0a (HMAC-SHA1, zero npm deps) ---
function pct(str) {
  return encodeURIComponent(String(str)).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

function oauth1Header(method, rawUrl, creds, extraParams = {}) {
  const u = new URL(rawUrl);
  const baseUrl = `${u.origin}${u.pathname}`;
  const oauthParams = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  const allParams = [];
  for (const [k, v] of u.searchParams.entries()) allParams.push([k, v]);
  for (const [k, v] of Object.entries(extraParams)) allParams.push([k, String(v)]);
  for (const [k, v] of Object.entries(oauthParams)) allParams.push([k, v]);
  allParams.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));

  const paramStr = allParams.map(([k, v]) => `${pct(k)}=${pct(v)}`).join("&");
  const baseString = `${method.toUpperCase()}&${pct(baseUrl)}&${pct(paramStr)}`;
  const signingKey = `${pct(creds.apiSecret)}&${pct(creds.accessSecret)}`;
  oauthParams.oauth_signature = crypto.createHmac("sha1", signingKey).update(baseString).digest("base64");

  return (
    "OAuth " +
    Object.keys(oauthParams)
      .sort()
      .map((k) => `${pct(k)}="${pct(oauthParams[k])}"`)
      .join(", ")
  );
}

async function uploadMediaX(pngPath, creds) {
  const buf = fs.readFileSync(pngPath);

  // Step 1: Initialize (X API v2 standard)
  const initUrl = "https://api.x.com/2/media/upload/initialize";
  const rInit = await fetch(initUrl, {
    method: "POST",
    headers: {
      Authorization: oauth1Header("POST", initUrl, creds),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      media_type: "image/png",
      total_bytes: buf.length,
      media_category: "tweet_image",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const jInit = await rInit.json().catch(() => ({}));
  const mediaId = jInit?.data?.id || jInit?.media_id_string;
  if (!rInit.ok || !mediaId) {
    throw new Error(`X media init failed (${rInit.status}): ${JSON.stringify(jInit).slice(0, 240)}`);
  }

  // Step 2: Append
  const appendUrl = `https://api.x.com/2/media/upload/${mediaId}/append`;
  const fd = new FormData();
  fd.append("segment_index", "0");
  fd.append("media", new Blob([buf], { type: "image/png" }), "card.png");
  const rApp = await fetch(appendUrl, {
    method: "POST",
    headers: { Authorization: oauth1Header("POST", appendUrl, creds) },
    body: fd,
    signal: AbortSignal.timeout(20_000),
  });
  if (!rApp.ok) {
    const t = await rApp.text().catch(() => "");
    throw new Error(`X media append failed (${rApp.status}): ${t.slice(0, 240)}`);
  }

  // Step 3: Finalize
  const finUrl = `https://api.x.com/2/media/upload/${mediaId}/finalize`;
  const rFin = await fetch(finUrl, {
    method: "POST",
    headers: { Authorization: oauth1Header("POST", finUrl, creds) },
    signal: AbortSignal.timeout(15_000),
  });
  if (!rFin.ok) {
    const t = await rFin.text().catch(() => "");
    throw new Error(`X media finalize failed (${rFin.status}): ${t.slice(0, 240)}`);
  }

  return String(mediaId);
}

async function publishToX(text, pngPath) {
  const creds = {
    apiKey: (process.env.X_API_KEY ?? "").trim(),
    apiSecret: (process.env.X_API_SECRET ?? "").trim(),
    accessToken: (process.env.X_ACCESS_TOKEN ?? "").trim(),
    accessSecret: (process.env.X_ACCESS_SECRET ?? "").trim(),
  };
  if (!creds.apiKey || !creds.apiSecret || !creds.accessToken || !creds.accessSecret) {
    console.log("[voltswap-trend] X API secrets not fully configured yet; skipping X publish.");
    return null;
  }

  let mediaId = null;
  if (pngPath && fs.existsSync(pngPath)) {
    try {
      mediaId = await uploadMediaX(pngPath, creds);
      console.log("[voltswap-trend] X media uploaded:", mediaId);
    } catch (e) {
      console.warn("[voltswap-trend] X media upload skipped (falling back to text-only):", e instanceof Error ? e.message : "err");
    }
  }

  const tweetUrl = "https://api.x.com/2/tweets";
  const payload = mediaId ? { text, media: { media_ids: [mediaId] } } : { text };
  const r = await fetch(tweetUrl, {
    method: "POST",
    headers: {
      Authorization: oauth1Header("POST", tweetUrl, creds),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j?.data?.id) {
    throw new Error(`X tweet failed (${r.status}): ${JSON.stringify(j).slice(0, 300)}`);
  }
  console.log(`[voltswap-trend] Published to X: https://x.com/voltswap/status/${j.data.id}`);
  return j.data.id;
}

async function publishToTelegram(captionHtml, pngPath) {
  const token = (process.env.WHALE_TG_BOT_TOKEN ?? "").trim();
  const chatId = (process.env.WHALE_TG_CHANNEL_ID ?? "@voltswap_org").trim() || "@voltswap_org";
  if (!token) {
    console.log("[voltswap-trend] WHALE_TG_BOT_TOKEN not set; skipping Telegram publish.");
    return null;
  }
  const replyMarkup = {
    inline_keyboard: [
      [
        { text: "⚡ Swap on Voltswap", url: "https://voltswap.org" },
        { text: "🐋 Live Whale Radar", url: "https://voltswap.org/whales" },
      ],
      [{ text: "🏆 Ranks & 50% Partner", url: "https://voltswap.org/partner" }],
    ],
  };

  const caption = sanitizeTelegramHtml(captionHtml).slice(0, 1020);
  if (pngPath && fs.existsSync(pngPath)) {
    const fd = new FormData();
    fd.append("chat_id", chatId);
    fd.append("photo", new Blob([fs.readFileSync(pngPath)], { type: "image/png" }), "voltswap_trend.png");
    fd.append("caption", caption);
    fd.append("parse_mode", "HTML");
    fd.append("reply_markup", JSON.stringify(replyMarkup));
    const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
      method: "POST",
      body: fd,
      signal: AbortSignal.timeout(15_000),
    });
    const j = await r.json().catch(() => ({ ok: false }));
    if (!r.ok || !j.ok) throw new Error(`TG sendPhoto failed (${r.status}): ${j.description ?? "unknown"}`);
    console.log(`[voltswap-trend] Published to Telegram ${chatId}: msg_id=${j.result?.message_id}`);
    return j.result?.message_id ?? null;
  }

  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: caption, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: replyMarkup }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = await r.json().catch(() => ({ ok: false }));
  if (!r.ok || !j.ok) throw new Error(`TG sendMessage failed (${r.status}): ${j.description ?? "unknown"}`);
  return j.result?.message_id ?? null;
}

async function sendOwnerXAssist(post, pngPath) {
  const token = (process.env.WHALE_TG_BOT_TOKEN ?? "").trim();
  const ownerId = (process.env.OWNER_TG_CHAT_ID ?? "141393418").trim();
  if (!token || !ownerId) return false;

  const escHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const intentUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(post.x_text)}`;
  const caption = [
    `🐦 <b>Ready for X (@voltswap)</b> · <code>${escHtml(post.topic_key || "sui-trend")}</code>`,
    ``,
    `<code>${escHtml(post.x_text)}</code>`,
    ``,
    `<i>1 tap opens X pre-filled -> attach this image &amp; hit Post (0$ mode).</i>`,
  ].join("\n");

  const replyMarkup = {
    inline_keyboard: [[{ text: "🐦 Open X with Text Pre-Filled", url: intentUrl }]],
  };

  try {
    let r;
    if (pngPath && fs.existsSync(pngPath)) {
      const fd = new FormData();
      fd.append("chat_id", ownerId);
      fd.append("photo", new Blob([fs.readFileSync(pngPath)], { type: "image/png" }), "voltswap_x_post.png");
      fd.append("caption", caption.slice(0, 1020));
      fd.append("parse_mode", "HTML");
      fd.append("reply_markup", JSON.stringify(replyMarkup));
      r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: "POST",
        body: fd,
        signal: AbortSignal.timeout(15_000),
      });
    } else {
      r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: ownerId, text: caption, parse_mode: "HTML", disable_web_page_preview: true, reply_markup: replyMarkup }),
        signal: AbortSignal.timeout(15_000),
      });
    }
    const j = await r.json().catch(() => ({ ok: false }));
    if (!r.ok || !j.ok) {
      console.warn(`[voltswap-trend] Owner X-assist DM skipped (${r.status}): ${j.description ?? "unknown"} (open @Voltswap_sui_bot and press /start once to enable DMs)`);
      return false;
    }
    console.log(`[voltswap-trend] Sent 1-tap X-assist DM to owner (${ownerId}): msg_id=${j.result?.message_id}`);
    return true;
  } catch (e) {
    console.warn("[voltswap-trend] Owner X-assist DM error:", e instanceof Error ? e.message : "unknown");
    return false;
  }
}

async function main() {
  const signals = await collectLiveSignals();
  console.log(
    `[voltswap-trend] signals collected: whales=${signals.whales?.swapCount1h ?? 0}, llama=${signals.defiLlamaSui.length}, dex=${signals.dexScreenerSui.length}, news=${signals.newsHeadlines.length}`,
  );

  if (TEST_CARD_ONLY) {
    const topDex = signals.dexScreenerSui[0];
    const topNews = signals.newsHeadlines[0]?.title || "Sui On-Chain Liquidity Pulse";
    const sampleCard = {
      badge: "SUI LIVE PULSE",
      headline: topNews.slice(0, 62),
      subline: "Live Sui DEX volume, Whale Radar net flows & protocol TVL across all 5 pools.",
      cta: "voltswap.org/whales",
      stats: [
        {
          label: "WHALE RADAR (1H)",
          value: fmtUsd(signals.whales?.totalUsd1h || 0),
          note: `${signals.whales?.swapCount1h || 0} large Sui swaps live`,
          tone: "gold",
        },
        {
          label: topDex ? `${topDex.pair} 24H VOL` : "TOP SUI PAIR",
          value: topDex ? fmtUsd(topDex.vol24hUsd) : "$3.3M",
          note: topDex?.change24hPct != null ? `24h move: ${topDex.change24hPct}%` : "Active Sui spot flow",
          tone: (topDex?.change24hPct ?? 0) >= 0 ? "up" : "down",
        },
        {
          label: "VOLTSWAP SPLIT FEE",
          value: "0.10% -> 0.00%",
          note: "6 ranks + 50% atomic PTB",
          tone: "neutral",
        },
      ],
    };
    const outPng = path.resolve(process.env.TEST_CARD_OUT ?? ".trend-card-preview.png");
    renderCardPng(sampleCard, outPng);
    return;
  }

  const history = loadHistory();
  const post = await generatePostWithGemini(signals, history);
  if (!post) return;

  console.log(`[voltswap-trend] topic=${post.topic_key} x_len=${xWeightedLen(post.x_text)}`);
  console.log("--- X POST ---\n" + post.x_text + "\n--------------");
  console.log("--- TG POST ---\n" + post.tg_html + "\n---------------");

  const cardPng = path.resolve(".trend-card-out.png");
  try {
    renderCardPng(post.card, cardPng);
  } catch (e) {
    console.warn("[voltswap-trend] Card render failed, proceeding text-only:", e instanceof Error ? e.message : "err");
  }

  if (DRY_RUN) {
    console.log("[voltswap-trend] DRY_RUN=1 — skipping live publish.");
    return;
  }

  let xId = null;
  let tgId = null;
  let xErr = null;
  let tgErr = null;
  if (PUBLISH_X) {
    try {
      xId = await publishToX(post.x_text, cardPng);
    } catch (e) {
      xErr = e instanceof Error ? e.message : "unknown";
      console.error("[voltswap-trend] X publish error:", xErr);
    }
  }
  if (PUBLISH_TG) {
    try {
      tgId = await publishToTelegram(post.tg_html, cardPng);
    } catch (e) {
      tgErr = e instanceof Error ? e.message : "unknown";
      console.error("[voltswap-trend] Telegram publish error:", tgErr);
    }
  }

  if (PUBLISH_X && !xId) {
    await sendOwnerXAssist(post, cardPng);
  }

  if (xId || tgId) {
    history.posts.push({
      ts: Date.now(),
      topic_key: post.topic_key || "sui-trend",
      headline: post.card?.headline || post.x_text.slice(0, 80),
      x_id: xId,
      tg_id: tgId,
    });
    saveHistory(history);
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, "changed=true\n");
    }
  } else if (xErr || tgErr) {
    throw new Error(`Publish failed (x=${xErr ?? "skipped"}, tg=${tgErr ?? "skipped"})`);
  } else {
    console.log("[voltswap-trend] Neither X nor Telegram published (check secrets).");
  }
}

main().catch((err) => {
  console.error("[voltswap-trend] fatal:", err instanceof Error ? err.message : "unknown");
  process.exit(1);
});
