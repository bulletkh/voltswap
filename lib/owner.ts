import { FEE_RATE } from "./config";
import { OWNER_ADDRESS, TX_FIELDS, classify, coinMeta, currentPrices, dayKey, dayPrices, gql, normType, type FeeEvent, type RawTx } from "./fees";

const PAGE = 50;
const MAX_PAGES = 40; // up to 2000 transactions touching the treasury
const TTL_MS = 60_000;

export type OwnerSwap = { digest: string; t: number; wallet: string; coin: string; fee: number; feeUsd: number | null; volumeUsd: number | null };
export type Period = { fee: number; volume: number; swaps: number; wallets: number };
export type OwnerStats = {
  updated: number;
  owner: string;
  feeRate: number;
  periods: { d1: Period; d7: Period; d30: Period; all: Period };
  daily: { day: string; fee: number; volume: number; swaps: number }[];
  wallets: { address: string; swaps: number; volume: number; fee: number; last: number }[];
  coins: { symbol: string; amount: number; usd: number | null; swaps: number }[];
  recent: OwnerSwap[];
  balances: { symbol: string; amount: number; usd: number }[];
  balanceTotal: number;
  unpriced: number; // fee payments that could not be valued in USD
  scanned: number;
  complete: boolean;
};

let cache: { at: number; data: OwnerStats } | null = null;
let inflight: Promise<OwnerStats> | null = null;

async function fetchTxs(): Promise<{ txs: RawTx[]; complete: boolean }> {
  const q = `query($a:SuiAddress,$b:String){ transactions(last:${PAGE}, before:$b, filter:{affectedAddress:$a}){ pageInfo{hasPreviousPage startCursor} nodes{ ${TX_FIELDS} } } }`;
  const txs: RawTx[] = [];
  let before: string | null = null;
  let complete = false;
  for (let i = 0; i < MAX_PAGES; i++) {
    const d: { transactions: { pageInfo: { hasPreviousPage: boolean; startCursor: string | null }; nodes: RawTx[] } } = await gql(q, { a: OWNER_ADDRESS, b: before });
    txs.push(...d.transactions.nodes);
    if (!d.transactions.pageInfo.hasPreviousPage) {
      complete = true;
      break;
    }
    before = d.transactions.pageInfo.startCursor;
    if (!before) break;
  }
  return { txs, complete };
}

async function compute(): Promise<OwnerStats> {
  const { txs, complete } = await fetchTxs();
  const events: FeeEvent[] = [];
  for (const tx of txs) {
    const f = classify(tx);
    if (f) events.push(f);
  }
  events.sort((a, b) => a.t - b.t);

  const types = [...new Set(events.map((e) => e.feeCoin))];
  const metas = await coinMeta(types);
  const now = await currentPrices(types);
  // historical price per (coin, day); the 20 busiest coins only, the rest use the current price
  const byCoinDays = new Map<string, Set<number>>();
  for (const e of events) {
    const s = byCoinDays.get(e.feeCoin) ?? new Set<number>();
    s.add(dayKey(e.t));
    byCoinDays.set(e.feeCoin, s);
  }
  const hist = new Map<string, Map<number, number>>();
  await Promise.all(
    [...byCoinDays.entries()].slice(0, 20).map(async ([c, days]) => {
      hist.set(c, await dayPrices(c, [...days]));
    }),
  );

  let unpriced = 0;
  const swaps: OwnerSwap[] = events.map((e) => {
    const m = metas.get(e.feeCoin);
    const dec = m?.decimals ?? 9;
    const fee = Number(e.feeRaw) / 10 ** dec;
    const vol = Number(e.volumeRaw) / 10 ** dec;
    const price = hist.get(e.feeCoin)?.get(dayKey(e.t)) ?? now.get(e.feeCoin);
    if (price === undefined) unpriced++;
    return { digest: e.digest, t: e.t, wallet: e.wallet, coin: m?.symbol ?? e.feeCoin.split("::").pop() ?? "?", fee, feeUsd: price === undefined ? null : fee * price, volumeUsd: price === undefined ? null : vol * price };
  });

  const period = (since: number): Period => {
    const w = new Set<string>();
    let fee = 0;
    let volume = 0;
    let n = 0;
    for (const s of swaps) {
      if (s.t < since || s.feeUsd === null) continue;
      fee += s.feeUsd;
      volume += s.volumeUsd ?? 0;
      n++;
      w.add(s.wallet);
    }
    return { fee, volume, swaps: n, wallets: w.size };
  };
  const t0 = Date.now();
  const periods = { d1: period(t0 - 86_400_000), d7: period(t0 - 7 * 86_400_000), d30: period(t0 - 30 * 86_400_000), all: period(0) };

  const dailyMap = new Map<string, { fee: number; volume: number; swaps: number }>();
  for (let i = 29; i >= 0; i--) dailyMap.set(new Date(t0 - i * 86_400_000).toISOString().slice(0, 10), { fee: 0, volume: 0, swaps: 0 });
  for (const s of swaps) {
    const d = dailyMap.get(new Date(s.t).toISOString().slice(0, 10));
    if (d && s.feeUsd !== null) {
      d.fee += s.feeUsd;
      d.volume += s.volumeUsd ?? 0;
      d.swaps++;
    }
  }

  const wm = new Map<string, { swaps: number; volume: number; fee: number; last: number }>();
  const cm = new Map<string, { amount: number; usd: number; swaps: number; priced: boolean }>();
  for (const s of swaps) {
    const w = wm.get(s.wallet) ?? { swaps: 0, volume: 0, fee: 0, last: 0 };
    w.swaps++;
    w.volume += s.volumeUsd ?? 0;
    w.fee += s.feeUsd ?? 0;
    w.last = Math.max(w.last, s.t);
    wm.set(s.wallet, w);
    const c = cm.get(s.coin) ?? { amount: 0, usd: 0, swaps: 0, priced: true };
    c.amount += s.fee;
    c.usd += s.feeUsd ?? 0;
    c.swaps++;
    if (s.feeUsd === null) c.priced = false;
    cm.set(s.coin, c);
  }

  // treasury balances, valued where a price exists
  let balances: OwnerStats["balances"] = [];
  try {
    const d = await gql<{ address: { balances: { nodes: { coinType: { repr: string }; totalBalance: string }[] } } | null }>(
      `query($a:SuiAddress!){ address(address:$a){ balances(first:50){ nodes{ coinType{repr} totalBalance } } } }`,
      { a: OWNER_ADDRESS },
    );
    const nodes = d.address?.balances.nodes ?? [];
    const bt = nodes.map((n) => normType(n.coinType.repr));
    const [bm, bp] = await Promise.all([coinMeta(bt), currentPrices(bt)]);
    balances = nodes
      .map((n, i) => {
        const m = bm.get(bt[i]);
        const p = bp.get(bt[i]);
        if (!m || p === undefined) return null;
        const amount = Number(n.totalBalance) / 10 ** m.decimals;
        return { symbol: m.symbol, amount, usd: amount * p };
      })
      .filter((x): x is { symbol: string; amount: number; usd: number } => x !== null && x.usd >= 0.01)
      .sort((a, b) => b.usd - a.usd);
  } catch {
    /* balances are optional */
  }

  return {
    updated: Date.now(),
    owner: OWNER_ADDRESS,
    feeRate: FEE_RATE,
    periods,
    daily: [...dailyMap.entries()].map(([day, v]) => ({ day, ...v })),
    wallets: [...wm.entries()].map(([address, v]) => ({ address, ...v })).sort((a, b) => b.volume - a.volume).slice(0, 25),
    coins: [...cm.entries()].map(([symbol, v]) => ({ symbol, amount: v.amount, usd: v.priced ? v.usd : null, swaps: v.swaps })).sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0)),
    recent: swaps.slice(-30).reverse(),
    balances: balances.slice(0, 12),
    balanceTotal: balances.reduce((s, b) => s + b.usd, 0),
    unpriced,
    scanned: txs.length,
    complete,
  };
}

export async function getOwnerStats(): Promise<OwnerStats> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  if (!inflight) {
    inflight = compute()
      .then((d) => {
        cache = { at: Date.now(), data: d };
        return d;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
