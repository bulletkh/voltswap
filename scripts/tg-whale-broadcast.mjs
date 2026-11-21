#!/usr/bin/env node
/**
 * Voltswap Whale Radar -> Official Telegram Channel (@voltswap_org) broadcaster.
 *
 * Designed to run on a schedule (e.g., GitHub Actions cron every 5 minutes) with
 * persistent JSON state caching so each whale swap is announced at most once.
 *
 * Required env (live mode):
 *   WHALE_TG_BOT_TOKEN      Telegram bot token (keep in secrets ONLY, never commit)
 *
 * Optional env:
 *   WHALE_TG_CHANNEL_ID     Default: @voltswap_org
 *   WHALE_TG_MIN_USD        Default: 10000 (directional swaps)
 *   WHALE_TG_STABLE_MIN_USD Default: 25000 (stable-to-stable swaps)
 *   WHALE_TG_MAX_PER_RUN    Default: 2     (anti-spam pacing per run)
 *   WHALE_TG_STATE_FILE     Default: .whale-tg-state.json
 *   WHALE_API_URL           Default: https://voltswap.org/api/whales?fresh=1
 *   WHALE_TG_DRY_RUN        "1" or CLI flag --dry-run
 */

import fs from "node:fs";
import path from "node:path";

const DRY_RUN = process.argv.includes("--dry-run") || process.env.WHALE_TG_DRY_RUN === "1";
const BOT_TOKEN = (process.env.WHALE_TG_BOT_TOKEN ?? "").trim();
const CHANNEL_ID = (process.env.WHALE_TG_CHANNEL_ID ?? "@voltswap_org").trim() || "@voltswap_org";
const API_URL = (process.env.WHALE_API_URL ?? "https://voltswap.org/api/whales?fresh=1").trim();
const STATE_FILE = path.resolve(process.env.WHALE_TG_STATE_FILE ?? ".whale-tg-state.json");

const MIN_USD = Math.max(1_000, Number(process.env.WHALE_TG_MIN_USD ?? "10000") || 10_000);
const STABLE_MIN_USD = Math.max(MIN_USD, Number(process.env.WHALE_TG_STABLE_MIN_USD ?? "25000") || 25_000);
const MAX_PER_RUN = Math.max(1, Math.min(5, Number(process.env.WHALE_TG_MAX_PER_RUN ?? "2") || 2));
const MAX_AGE_MS = 65 * 60 * 1000;
const STATE_TTL_MS = 24 * 60 * 60 * 1000;
const GROUP_WINDOW_MS = 10 * 60 * 1000;

const STABLES = new Set([
  "USDC",
  "USDT",
  "BUCK",
  "AUSD",
  "FDUSD",
  "USDY",
  "SUSDC",
  "WUSDC",
  "USDB",
  "SBUSDT",
  "USDSUI",
  "DAI",
]);

const BTC_TOKENS = new Set(["HBTC", "LBTC", "WBTC", "XBTC", "SBTC", "BTC", "TBTC", "CBBTC"]);

const normSym = (s) => String(s ?? "").trim().toUpperCase();
const isStable = (s) => STABLES.has(normSym(s));
const isBtc = (s) => BTC_TOKENS.has(normSym(s));

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const fmtUsd = (v) => "$" + Math.round(v).toLocaleString("en-US");

const fmtAmt = (v) => {
  if (!Number.isFinite(v) || v <= 0) return "";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (v >= 100) return Math.round(v).toLocaleString("en-US");
  if (v >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
};

const shortAddr = (a) => (a && a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "Unknown");

function loadState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.sent && typeof parsed.sent === "object") {
      return { sent: parsed.sent };
    }
  } catch {
    // fresh state
  }
  return { sent: {} };
}

function saveState(state) {
  const cutoff = Date.now() - STATE_TTL_MS;
  const pruned = {};
  for (const [k, ts] of Object.entries(state.sent)) {
    if (typeof ts === "number" && ts >= cutoff) pruned[k] = ts;
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify({ sent: pruned, updatedAt: Date.now() }, null, 2));
}

async function fetchWhales() {
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch(API_URL, {
        headers: { accept: "application/json", "user-agent": "voltswap-whale-tg/1.0" },
        signal: AbortSignal.timeout(25_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      if (!Array.isArray(json?.items)) throw new Error("Missing items array");
      return json.items;
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((res) => setTimeout(res, 2_500));
    }
  }
  throw lastErr ?? new Error("Failed to fetch whales");
}

function groupRecentSwaps(items) {
  const sorted = [...items].sort((a, b) => b.t - a.t);
  const groups = [];
  const open = new Map();

  for (const w of sorted) {
    if (!w || !w.digest || !Number.isFinite(w.usd)) continue;
    const key = `${w.sender ?? w.digest}|${w.dex}|${w.inSym}|${w.outSym}`;
    const cur = open.get(key);
    if (cur && Math.abs(cur.t - w.t) <= GROUP_WINDOW_MS) {
      cur.usd += w.usd;
      cur.inAmt += Number(w.inAmt) || 0;
      cur.outAmt += Number(w.outAmt) || 0;
      cur.count += 1;
      cur.digests.push(w.digest);
      continue;
    }
    const row = {
      ...w,
      inAmt: Number(w.inAmt) || 0,
      outAmt: Number(w.outAmt) || 0,
      count: 1,
      digests: [w.digest],
    };
    open.set(key, row);
    groups.push(row);
  }
  return groups;
}

function formatMessage(w) {
  const tier =
    w.usd >= 100_000
      ? `🚨🐋 <b>MEGA WHALE ALERT · ${fmtUsd(w.usd)}</b>`
      : w.usd >= 25_000
        ? `🐋 <b>WHALE SWAP · ${fmtUsd(w.usd)}</b>`
        : `⚡ <b>LARGE SUI SWAP · ${fmtUsd(w.usd)}</b>`;

  const inSt = isStable(w.inSym);
  const outSt = isStable(w.outSym);
  const action =
    inSt && !outSt
      ? `🟢 <b>BUY ${esc(w.outSym)}</b>`
      : !inSt && outSt
        ? `🔴 <b>SELL ${esc(w.inSym)}</b>`
        : `🔄 <b>${esc(w.inSym)} → ${esc(w.outSym)}</b>`;

  const btcBadge = isBtc(w.inSym) || isBtc(w.outSym) ? " · 🟠 <b>Sui BTC</b>" : "";
  const countTag = w.count > 1 ? ` · ${w.count} clips` : "";

  const leftAmt = w.inAmt > 0 ? `${fmtAmt(w.inAmt)} ${esc(w.inSym)}` : esc(w.inSym);
  const rightAmt = w.outAmt > 0 ? `${fmtAmt(w.outAmt)} ${esc(w.outSym)}` : esc(w.outSym);

  const walletPart = w.sender
    ? `Wallet: <a href="https://suiscan.xyz/mainnet/account/${encodeURIComponent(w.sender)}">${esc(shortAddr(w.sender))}</a> · `
    : "";
  const txLink = `<a href="https://suiscan.xyz/mainnet/tx/${encodeURIComponent(w.digest)}">Suiscan Tx ↗</a>`;

  return [
    tier,
    `${action} · ${esc(w.dex)}${countTag}${btcBadge}`,
    "",
    `<code>${leftAmt}</code> → <code>${rightAmt}</code>`,
    `${walletPart}${txLink}`,
    "",
    `<i>⚡ Split-route on Sui · 0.10% down to 0.00% fee</i>`,
  ].join("\n");
}

async function sendToTelegram(html) {
  const payload = {
    chat_id: CHANNEL_ID,
    text: html,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "⚡ Swap on Voltswap", url: "https://voltswap.org" },
          { text: "🐋 Live Whale Radar", url: "https://voltswap.org/whales" },
        ],
        [{ text: "🏆 Ranks & 50% Partner Rev-Share", url: "https://voltswap.org/partner" }],
      ],
    },
  };

  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12_000),
  });
  const j = await r.json().catch(() => ({ ok: false }));
  if (!r.ok || !j.ok) {
    throw new Error(`Telegram sendMessage failed (${r.status}): ${j.description ?? "unknown"}`);
  }
  return j.result?.message_id ?? null;
}

async function main() {
  if (!DRY_RUN && !BOT_TOKEN) {
    console.log("[whale-tg] WHALE_TG_BOT_TOKEN secret is not set yet; skipping broadcast gracefully.");
    return;
  }

  const state = loadState();
  const now = Date.now();
  const items = await fetchWhales();

  const freshUnseen = items.filter((w) => {
    if (!w?.digest || !Number.isFinite(w.t) || !Number.isFinite(w.usd)) return false;
    if (now - w.t > MAX_AGE_MS) return false;
    if (state.sent[w.digest]) return false;
    return true;
  });

  const grouped = groupRecentSwaps(freshUnseen).filter((g) => {
    const bothStable = isStable(g.inSym) && isStable(g.outSym);
    const floor = bothStable ? STABLE_MIN_USD : MIN_USD;
    return g.usd >= floor;
  });

  // Prioritize largest swaps first, cap per run to avoid spamming
  grouped.sort((a, b) => b.usd - a.usd);
  const toSend = grouped.slice(0, MAX_PER_RUN);

  console.log(
    `[whale-tg] fetched=${items.length} unseen=${freshUnseen.length} qualified=${grouped.length} sending=${toSend.length} (min=$${MIN_USD}, stableMin=$${STABLE_MIN_USD}, dryRun=${DRY_RUN})`,
  );

  let sentCount = 0;
  for (const w of toSend) {
    const html = formatMessage(w);
    if (DRY_RUN) {
      console.log("--- DRY RUN CARD ---\n" + html + "\n--------------------");
      sentCount++;
      continue;
    }
    const msgId = await sendToTelegram(html);
    for (const d of w.digests) state.sent[d] = now;
    sentCount++;
    console.log(`[whale-tg] sent msg_id=${msgId} ${w.dex} ${w.inSym}->${w.outSym} ${fmtUsd(w.usd)}`);
    if (toSend.length > 1) await new Promise((res) => setTimeout(res, 1_100));
  }

  if (!DRY_RUN && sentCount > 0) {
    saveState(state);
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, "changed=true\n");
    }
  }
}

main().catch((err) => {
  console.error("[whale-tg] error:", err instanceof Error ? err.message : "unknown error");
  process.exit(1);
});
