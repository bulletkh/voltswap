// Reads Voltswap fee income straight from the chain (Sui GraphQL). Server-side only.
import { OWNER } from "./owner-address";
import { TOKENS } from "./tokens";

export const OWNER_ADDRESS = OWNER;
const GQL = "https://graphql.mainnet.sui.io/graphql";

export async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const r = await fetch(GQL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`graphql ${r.status}`);
  const j = (await r.json()) as { data?: T; errors?: { message: string }[] };
  if (!j.data) throw new Error(j.errors?.[0]?.message ?? "graphql error");
  return j.data;
}

// Normalise 0x2::sui::SUI and 0x000…02::sui::SUI to one spelling.
export function normType(t: string): string {
  const [addr, ...rest] = t.split("::");
  return [("0x" + addr.replace(/^0x/, "").replace(/^0+/, "")).replace(/^0x$/, "0x0"), ...rest].join("::");
}

export type RawTx = {
  digest: string;
  sender: { address: string } | null;
  effects: {
    timestamp: string | null;
    status: string;
    balanceChanges: { nodes: { owner: { address: string } | null; amount: string; coinType: { repr: string } }[] };
  } | null;
};

export const TX_FIELDS = `digest sender{address} effects{ timestamp status balanceChanges(first:50){ nodes{ owner{address} amount coinType{repr} } } }`;

export type FeeEvent = {
  digest: string;
  t: number; // ms
  wallet: string;
  feeCoin: string; // normalised coin type
  feeRaw: bigint;
  volumeRaw: bigint; // size of the swap in feeCoin units
  rate: number;
  referrer?: string;
  refFeeRaw?: bigint;
};

/**
 * A fee payment = a successful tx where someone other than the treasury sends a coin to the treasury
 * and the same tx is a swap for that sender (one coin leaves, another arrives), with the payment being
 * roughly 0.005–1% of the swapped amount. Plain transfers and airdrops do not match.
 * If an atomic partner rev-share split occurred in the same PTB, `referrer` and `refFeeRaw` are captured too.
 */
export function classify(tx: RawTx): FeeEvent | null {
  const e = tx.effects;
  const sender = tx.sender?.address?.toLowerCase();
  if (!e || e.status !== "SUCCESS" || !sender || sender === OWNER_ADDRESS) return null;
  const mine = new Map<string, bigint>();
  const theirs = new Map<string, bigint>();
  const others = new Map<string, Map<string, bigint>>();
  for (const b of e.balanceChanges.nodes) {
    const o = b.owner?.address?.toLowerCase();
    if (!o) continue;
    const c = normType(b.coinType.repr);
    const a = BigInt(b.amount);
    if (o === OWNER_ADDRESS) mine.set(c, (mine.get(c) ?? 0n) + a);
    else if (o === sender) theirs.set(c, (theirs.get(c) ?? 0n) + a);
    else {
      const m = others.get(c) ?? new Map<string, bigint>();
      m.set(o, (m.get(o) ?? 0n) + a);
      others.set(c, m);
    }
  }
  const gains = [...theirs.values()].some((v) => v > 0n);
  const losses = [...theirs.values()].some((v) => v < 0n);
  if (!gains || !losses) return null;
  for (const [coin, fee] of mine) {
    if (fee <= 0n) continue;
    const s = theirs.get(coin) ?? 0n;
    // fee taken from the output: sender received (volume - fee); fee taken from the input: sender paid (volume + fee)
    const volume = s > 0n ? s + fee : s < 0n ? -s : 0n;
    if (volume <= 0n) continue;
    const rate = Number(fee) / Number(volume);
    if (rate < 0.00002 || rate > 0.01) continue;
    let referrer: string | undefined;
    let refFeeRaw: bigint | undefined;
    const coinOthers = others.get(coin);
    if (coinOthers) {
      for (const [addr, amt] of coinOthers) {
        if (amt > 0n && amt * 100n >= fee * 20n && amt * 100n <= fee * 260n) {
          referrer = addr;
          refFeeRaw = amt;
          break;
        }
      }
    }
    return {
      digest: tx.digest,
      t: Date.parse(e.timestamp ?? "") || 0,
      wallet: sender,
      feeCoin: coin,
      feeRaw: fee,
      volumeRaw: volume,
      rate,
      referrer,
      refFeeRaw,
    };
  }
  return null;
}

// ---- coin metadata and prices ----
const meta = new Map<string, { symbol: string; decimals: number } | null>();
const known = new Map(TOKENS.map((t) => [normType(t.type), { symbol: t.symbol, decimals: t.decimals }]));

export async function coinMeta(types: string[]): Promise<Map<string, { symbol: string; decimals: number } | null>> {
  const need = types.filter((t) => !meta.has(t) && !known.has(t));
  for (let i = 0; i < need.length; i += 20) {
    const chunk = need.slice(i, i + 20);
    const q = `query{ ${chunk.map((t, k) => `c${k}:coinMetadata(coinType:"${t}"){symbol decimals}`).join(" ")} }`;
    try {
      const d = await gql<Record<string, { symbol: string; decimals: number } | null>>(q);
      chunk.forEach((t, k) => meta.set(t, d[`c${k}`] ?? null));
    } catch {
      chunk.forEach((t) => meta.set(t, null));
    }
  }
  const out = new Map<string, { symbol: string; decimals: number } | null>();
  for (const t of types) out.set(t, known.get(t) ?? meta.get(t) ?? null);
  return out;
}

const key = (t: string) => `sui:${t}`;

export async function currentPrices(types: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (types.length === 0) return out;
  for (let i = 0; i < types.length; i += 40) {
    const ids = types.slice(i, i + 40).map(key).join(",");
    try {
      const r = await fetch(`https://coins.llama.fi/prices/current/${encodeURIComponent(ids)}`, { signal: AbortSignal.timeout(9_000), cache: "no-store" });
      const j = (await r.json()) as { coins?: Record<string, { price: number }> };
      for (const t of types.slice(i, i + 40)) {
        const p = j.coins?.[key(t)]?.price;
        if (typeof p === "number") out.set(t, p);
      }
    } catch {
      /* leave unpriced */
    }
  }
  return out;
}

/** Price of one coin on each given day (unix seconds at 12:00 UTC), nearest available. */
export async function dayPrices(type: string, days: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (days.length === 0) return out;
  try {
    const q = encodeURIComponent(JSON.stringify({ [key(type)]: days }));
    const r = await fetch(`https://coins.llama.fi/batchHistorical?coins=${q}&searchWidth=12h`, { signal: AbortSignal.timeout(12_000), cache: "no-store" });
    const j = (await r.json()) as { coins?: Record<string, { prices: { timestamp: number; price: number }[] }> };
    const arr = j.coins?.[key(type)]?.prices ?? [];
    for (const d of days) {
      let best: { timestamp: number; price: number } | null = null;
      for (const p of arr) if (!best || Math.abs(p.timestamp - d) < Math.abs(best.timestamp - d)) best = p;
      if (best && Math.abs(best.timestamp - d) <= 36 * 3600) out.set(d, best.price);
    }
  } catch {
    /* fall back to the current price */
  }
  return out;
}

export const dayKey = (ms: number) => Math.floor(ms / 86_400_000) * 86_400 + 43_200;

/** The sender's side of a swap: what left and what arrived (raw units). */
export function swapSides(tx: RawTx): { out: { coin: string; raw: bigint } | null; into: { coin: string; raw: bigint } | null } {
  const sender = tx.sender?.address?.toLowerCase();
  const sums = new Map<string, bigint>();
  for (const b of tx.effects?.balanceChanges.nodes ?? []) {
    if (b.owner?.address?.toLowerCase() !== sender) continue;
    const c = normType(b.coinType.repr);
    sums.set(c, (sums.get(c) ?? 0n) + BigInt(b.amount));
  }
  let out: { coin: string; raw: bigint } | null = null;
  let into: { coin: string; raw: bigint } | null = null;
  for (const [coin, raw] of sums) {
    if (raw < 0n && (!out || -raw > -out.raw)) out = { coin, raw: -raw };
    if (raw > 0n && (!into || raw > into.raw)) into = { coin, raw };
  }
  return { out, into };
}
