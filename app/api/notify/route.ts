import { TX_FIELDS, classify, coinMeta, currentPrices, gql, swapSides, type RawTx } from "@/lib/fees";
import { OWNER } from "@/lib/owner-address";
import { esc, sendTelegram, telegramReady } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const seen = new Set<string>(); // digests and wallets already announced (one instance's memory)
const stamps: number[] = []; // connect notices in the last hour

const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
const usd = (v: number) =>
  v === 0 ? "$0" : v < 0.01 ? "$" + v.toLocaleString("en-US", { maximumSignificantDigits: 2, maximumFractionDigits: 6 }) : "$" + v.toLocaleString("en-US", { maximumFractionDigits: v >= 100 ? 0 : 2 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadTx(digest: string): Promise<RawTx | null> {
  for (let i = 0; i < 4; i++) {
    try {
      const d = await gql<{ transaction: RawTx | null }>(`query($d:String!){ transaction(digest:$d){ ${TX_FIELDS} } }`, { d: digest });
      if (d.transaction?.effects) return d.transaction;
    } catch {
      /* retry */
    }
    await sleep(2_000);
  }
  return null;
}

export async function POST(req: Request) {
  if (!telegramReady()) return Response.json({ ok: false, reason: "telegram not configured" });
  let body: { type?: string; digest?: string; address?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  if (body.type === "swap" && typeof body.digest === "string" && /^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(body.digest)) {
    if (seen.has(body.digest)) return Response.json({ ok: true, dup: true });
    seen.add(body.digest);
    // Only a swap that really paid a fee to the treasury is announced; the chain is the source of truth.
    const tx = await loadTx(body.digest);
    const fee = tx ? classify(tx) : null;
    if (!tx || !fee) return Response.json({ ok: false, reason: "not a Voltswap fee swap" }, { status: 422 });
    const { out, into } = swapSides(tx);
    const types = [...new Set([fee.feeCoin, out?.coin, into?.coin].filter((x): x is string => Boolean(x)))];
    const [meta, price] = await Promise.all([coinMeta(types), currentPrices(types)]);
    const sym = (c?: string) => (c ? meta.get(c)?.symbol ?? c.split("::").pop() ?? "?" : "?");
    const amt = (c: string | undefined, raw: bigint | undefined) => (c && raw !== undefined ? Number(raw) / 10 ** (meta.get(c)?.decimals ?? 9) : 0);
    const p = price.get(fee.feeCoin);
    const dec = meta.get(fee.feeCoin)?.decimals ?? 9;
    const feeUsd = p !== undefined ? (Number(fee.feeRaw) / 10 ** dec) * p : null;
    const volUsd = p !== undefined ? (Number(fee.volumeRaw) / 10 ** dec) * p : null;
    const a = amt(out?.coin, out?.raw);
    const b = amt(into?.coin, into?.raw);
    const text =
      `⚡ <b>Swap on Voltswap</b>\n` +
      `${a.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${esc(sym(out?.coin))} → ${b.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${esc(sym(into?.coin))}\n` +
      (volUsd !== null ? `Volume: <b>${usd(volUsd)}</b>\n` : "") +
      `Fee earned: <b>${feeUsd !== null ? usd(feeUsd) : Number(fee.feeRaw) / 10 ** dec + " " + esc(sym(fee.feeCoin))}</b> (${(fee.rate * 100).toFixed(2)}%)\n` +
      `Wallet: <a href="https://suiscan.xyz/mainnet/account/${fee.wallet}">${short(fee.wallet)}</a>\n` +
      `<a href="https://suiscan.xyz/mainnet/tx/${fee.digest}">Transaction</a>`;
    const ok = await sendTelegram(text);
    return Response.json({ ok });
  }

  if (body.type === "connect" && typeof body.address === "string" && /^0x[0-9a-fA-F]{64}$/.test(body.address)) {
    const addr = body.address.toLowerCase();
    if (addr === OWNER) return Response.json({ ok: true, skipped: true });
    const k = "c:" + addr;
    const now = Date.now();
    while (stamps.length && now - stamps[0] > 3_600_000) stamps.shift();
    if (seen.has(k) || stamps.length >= 30) return Response.json({ ok: true, skipped: true });
    seen.add(k);
    stamps.push(now);
    const ok = await sendTelegram(`👛 <b>Wallet connected</b>\n<a href="https://suiscan.xyz/mainnet/account/${addr}">${short(addr)}</a>`);
    return Response.json({ ok });
  }
  return Response.json({ ok: false }, { status: 400 });
}
