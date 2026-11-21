import { getWhales, type Whale } from "@/lib/whales";
import { esc } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

const sentDigests = new Map<string, number>();
const SENT_TTL_MS = 24 * 60 * 60 * 1000;
const GROUP_WINDOW_MS = 10 * 60 * 1000;

const norm = (s: string) => s.trim().toUpperCase();
const isStable = (s: string) => STABLES.has(norm(s));
const isBtc = (s: string) => BTC_TOKENS.has(norm(s));
const fmtUsd = (v: number) => "$" + Math.round(v).toLocaleString("en-US");
const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

function fmtAmt(v: number): string {
  if (!Number.isFinite(v) || v <= 0) return "";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (v >= 100) return Math.round(v).toLocaleString("en-US");
  if (v >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

type GroupedWhale = Whale & { count: number; digests: string[] };

function groupSwaps(items: Whale[]): GroupedWhale[] {
  const sorted = [...items].sort((a, b) => b.t - a.t);
  const out: GroupedWhale[] = [];
  const open = new Map<string, GroupedWhale>();
  for (const w of sorted) {
    const key = `${w.sender ?? w.digest}|${w.dex}|${w.inSym}|${w.outSym}`;
    const cur = open.get(key);
    if (cur && Math.abs(cur.t - w.t) <= GROUP_WINDOW_MS) {
      cur.usd += w.usd;
      cur.inAmt += w.inAmt;
      cur.outAmt += w.outAmt;
      cur.count += 1;
      cur.digests.push(w.digest);
      continue;
    }
    const row: GroupedWhale = { ...w, count: 1, digests: [w.digest] };
    open.set(key, row);
    out.push(row);
  }
  return out;
}

function formatCard(w: GroupedWhale): string {
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

function isAuthorized(req: Request): boolean {
  const expected = (process.env.WHALE_TG_CRON_SECRET || process.env.CRON_SECRET || "").trim();
  if (!expected) return false;
  const auth = req.headers.get("authorization") ?? "";
  if (auth === `Bearer ${expected}`) return true;
  const qs = new URL(req.url).searchParams.get("secret") ?? "";
  return qs === expected;
}

async function handle(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const token = (process.env.WHALE_TG_BOT_TOKEN ?? "").trim();
  const channel = (process.env.WHALE_TG_CHANNEL_ID ?? "@voltswap_org").trim() || "@voltswap_org";
  if (!token) {
    return Response.json({ ok: false, error: "WHALE_TG_BOT_TOKEN not configured" }, { status: 503 });
  }

  const sp = new URL(req.url).searchParams;
  const minUsd = Math.max(1_000, Number(sp.get("minUsd") ?? process.env.WHALE_TG_MIN_USD ?? "10000") || 10_000);
  const stableMinUsd = Math.max(minUsd, Number(sp.get("stableMinUsd") ?? process.env.WHALE_TG_STABLE_MIN_USD ?? "25000") || 25_000);
  const maxPerRun = Math.max(1, Math.min(5, Number(sp.get("max") ?? process.env.WHALE_TG_MAX_PER_RUN ?? "2") || 2));
  const windowSec = Math.max(60, Math.min(3_600, Number(sp.get("windowSec") ?? "360") || 360));
  const dryRun = sp.get("dryRun") === "1";

  const now = Date.now();
  for (const [k, ts] of sentDigests.entries()) {
    if (now - ts > SENT_TTL_MS) sentDigests.delete(k);
  }

  const data = await getWhales(true);
  const unseen = data.items.filter((w) => now - w.t <= windowSec * 1000 && !sentDigests.has(w.digest));
  const qualified = groupSwaps(unseen)
    .filter((g) => g.usd >= (isStable(g.inSym) && isStable(g.outSym) ? stableMinUsd : minUsd))
    .sort((a, b) => b.usd - a.usd)
    .slice(0, maxPerRun);

  const sent: { digest: string; dex: string; usd: number; msgId: number | null }[] = [];

  for (const w of qualified) {
    const html = formatCard(w);
    if (dryRun) {
      sent.push({ digest: w.digest, dex: w.dex, usd: Math.round(w.usd), msgId: null });
      continue;
    }
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: channel,
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
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const j = (await r.json().catch(() => ({ ok: false }))) as { ok?: boolean; result?: { message_id?: number } };
    if (r.ok && j.ok) {
      for (const d of w.digests) sentDigests.set(d, now);
      sent.push({ digest: w.digest, dex: w.dex, usd: Math.round(w.usd), msgId: j.result?.message_id ?? null });
    }
  }

  return Response.json(
    { ok: true, dryRun, scanned: data.items.length, unseen: unseen.length, sent },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
