// Free "whale radar": recent large Cetus swaps, read from Sui's public GraphQL and valued with DeFiLlama prices.
// State lives in module memory (one serverless instance); it is a live tape, not a permanent history.

const GQL = "https://graphql.mainnet.sui.io/graphql";
const CETUS_SWAP = "0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb::pool::SwapEvent";
const LLAMA = "https://coins.llama.fi/prices/current/";

export const FLOOR_USD = 1_000;
const MIN_INTERVAL_MS = 8_000;
const KEEP_MS = 60 * 60 * 1000;
const MAX_KEEP = 300;
const PRICE_TTL_MS = 5 * 60 * 1000;

export type Whale = {
  id: string;
  t: number;
  digest: string;
  sender: string | null;
  inSym: string;
  inAmt: number;
  outSym: string;
  outAmt: number;
  usd: number;
};

type Node = {
  timestamp: string | null;
  contents: { json: Record<string, string> } | null;
  transaction: { digest: string; sender: { address: string } | null } | null;
};

type Price = { price: number; decimals: number; symbol: string; at: number };

const state = {
  whales: new Map<string, Whale>(),
  lastSeen: 0,
  lastRun: 0,
  warm: false,
  pools: new Map<string, [string, string] | null>(),
  prices: new Map<string, Price | null>(),
  inflight: null as Promise<void> | null,
  lastError: null as string | null,
  stats: { fresh: 0, poolsOk: 0, poolsNone: 0, pricesOk: 0, pricesNone: 0, maxUsd: 0, scanned: 0 },
};

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const r = await fetch(GQL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(9_000),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`graphql ${r.status}`);
  const j = (await r.json()) as { data?: T; errors?: { message: string }[] };
  if (!j.data) throw new Error(j.errors?.[0]?.message ?? "graphql error");
  return j.data;
}

const EVENTS_Q = `query($t:String,$b:String){
  events(last:50, before:$b, filter:{type:$t}){
    pageInfo{ hasPreviousPage startCursor }
    nodes{ timestamp contents{ json } transaction{ digest sender{ address } } }
  }
}`;

async function loadPools(ids: string[]) {
  const missing = ids.filter((p) => !state.pools.has(p));
  for (let i = 0; i < missing.length; i += 25) {
    const chunk = missing.slice(i, i + 25);
    const body = chunk
      .map((p, k) => `p${k}: object(address:"${p}"){ asMoveObject{ contents{ type{ repr } } } }`)
      .join("\n");
    try {
      const d = await gql<Record<string, { asMoveObject: { contents: { type: { repr: string } } | null } | null } | null>>(
        `query{ ${body} }`,
      );
      chunk.forEach((p, k) => {
        const repr = d[`p${k}`]?.asMoveObject?.contents?.type?.repr ?? "";
        const m = /Pool<(.+?),\s*(.+)>$/.exec(repr);
        state.pools.set(p, m ? [m[1].trim(), m[2].trim()] : null);
      });
    } catch {
      // leave unresolved; retried on the next run
    }
  }
}

async function loadPrices(types: string[]) {
  const now = Date.now();
  const need = types.filter((t) => {
    const p = state.prices.get(t);
    return p === undefined || (p === null ? false : now - p.at > PRICE_TTL_MS);
  });
  for (let i = 0; i < need.length; i += 40) {
    const chunk = need.slice(i, i + 40);
    try {
      const r = await fetch(LLAMA + chunk.map((t) => `sui:${t}`).join(","), { signal: AbortSignal.timeout(8_000), cache: "no-store" });
      if (!r.ok) continue;
      const j = (await r.json()) as { coins?: Record<string, { price: number; decimals?: number; symbol?: string }> };
      for (const t of chunk) {
        const c = j.coins?.[`sui:${t}`];
        state.prices.set(
          t,
          c && typeof c.price === "number" && typeof c.decimals === "number"
            ? { price: c.price, decimals: c.decimals, symbol: c.symbol ?? t.split("::").pop() ?? "?", at: now }
            : null,
        );
      }
    } catch {
      // retry next run
    }
  }
}

async function refresh() {
  const pages: Node[][] = [];
  let before: string | null = null;
  const maxPages = state.warm ? 4 : 16;
  for (let i = 0; i < maxPages; i++) {
    const d: {
      events: { pageInfo: { hasPreviousPage: boolean; startCursor: string | null }; nodes: Node[] };
    } = await gql(EVENTS_Q, { t: CETUS_SWAP, b: before });
    pages.push(d.events.nodes);
    const oldest = d.events.nodes[0]?.timestamp ? Date.parse(d.events.nodes[0].timestamp) : 0;
    if (!d.events.pageInfo.hasPreviousPage || !d.events.pageInfo.startCursor) break;
    if (state.lastSeen && oldest <= state.lastSeen) break;
    before = d.events.pageInfo.startCursor;
  }
  const nodes = pages.flat().filter((n) => n.timestamp && n.contents && n.transaction);
  const fresh = nodes.filter((n) => Date.parse(n.timestamp as string) > state.lastSeen - 2_000);
  if (fresh.length === 0) {
    state.warm = true;
    return;
  }

  await loadPools([...new Set(fresh.map((n) => (n.contents as { json: Record<string, string> }).json.pool))]);
  const coinTypes = new Set<string>();
  for (const n of fresh) {
    const pair = state.pools.get((n.contents as { json: Record<string, string> }).json.pool);
    if (pair) pair.forEach((c) => coinTypes.add(c));
  }
  await loadPrices([...coinTypes]);

  state.stats = {
    fresh: fresh.length,
    scanned: nodes.length,
    poolsOk: [...state.pools.values()].filter(Boolean).length,
    poolsNone: [...state.pools.values()].filter((v) => !v).length,
    pricesOk: [...state.prices.values()].filter(Boolean).length,
    pricesNone: [...state.prices.values()].filter((v) => !v).length,
    maxUsd: state.stats.maxUsd,
  };

  // One row per transaction: keep the biggest hop (aggregator routes emit several swap events).
  const best = new Map<string, Whale>();
  for (const n of fresh) {
    const j = (n.contents as { json: Record<string, string> }).json;
    const pair = state.pools.get(j.pool);
    if (!pair) continue;
    const atob = j.atob === "true" || (j.atob as unknown) === true;
    const inT = atob ? pair[0] : pair[1];
    const outT = atob ? pair[1] : pair[0];
    const pin = state.prices.get(inT);
    const pout = state.prices.get(outT);
    if (!pin && !pout) continue;
    const inAmt = pin ? Number(j.amount_in) / 10 ** pin.decimals : NaN;
    const outAmt = pout ? Number(j.amount_out) / 10 ** pout.decimals : NaN;
    const inUsd = pin ? inAmt * pin.price : NaN;
    const outUsd = pout ? outAmt * pout.price : NaN;
    // Both sides priced: they must roughly agree, otherwise the price data for a thin token is unreliable.
    if (Number.isFinite(inUsd) && Number.isFinite(outUsd) && (inUsd > outUsd * 3 || outUsd > inUsd * 3)) continue;
    const usd = Number.isFinite(inUsd) ? inUsd : outUsd;
    if (Number.isFinite(usd) && usd > state.stats.maxUsd) state.stats.maxUsd = Math.round(usd);
    if (!Number.isFinite(usd) || usd < FLOOR_USD) continue;
    const digest = (n.transaction as { digest: string }).digest;
    const row: Whale = {
      id: `${digest}:${j.pool}`,
      t: Date.parse(n.timestamp as string),
      digest,
      sender: n.transaction?.sender?.address ?? null,
      inSym: pin?.symbol ?? inT.split("::").pop() ?? "?",
      inAmt: Number.isFinite(inAmt) ? inAmt : 0,
      outSym: pout?.symbol ?? outT.split("::").pop() ?? "?",
      outAmt: Number.isFinite(outAmt) ? outAmt : 0,
      usd,
    };
    const cur = best.get(digest);
    if (!cur || row.usd > cur.usd) best.set(digest, row);
  }
  for (const row of best.values()) state.whales.set(row.digest, row);

  state.lastSeen = Math.max(state.lastSeen, ...fresh.map((n) => Date.parse(n.timestamp as string)));
  state.warm = true;

  const cutoff = Date.now() - KEEP_MS;
  const sorted = [...state.whales.values()].filter((w) => w.t >= cutoff).sort((a, b) => b.t - a.t).slice(0, MAX_KEEP);
  state.whales = new Map(sorted.map((w) => [w.digest, w]));
}

export async function getWhales(): Promise<{ updated: number; floor: number; error: string | null; stats: typeof state.stats; items: Whale[] }> {
  if (!state.inflight && Date.now() - state.lastRun >= MIN_INTERVAL_MS) {
    state.lastRun = Date.now();
    state.inflight = refresh()
      .then(() => {
        state.lastError = null;
      })
      .catch((e: unknown) => {
        state.lastError = e instanceof Error ? e.message : "error";
      })
      .finally(() => {
        state.inflight = null;
      });
  }
  if (state.inflight && !state.warm) await state.inflight;
  return {
    updated: state.lastRun,
    floor: FLOOR_USD,
    error: state.lastError,
    stats: state.stats,
    items: [...state.whales.values()].sort((a, b) => b.t - a.t).slice(0, 100),
  };
}
