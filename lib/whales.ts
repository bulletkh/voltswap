// Free "whale radar": recent large Cetus, Bluefin, Momentum, Turbos and DeepBook swaps, read from Sui's public GraphQL and valued with DeFiLlama prices.
// State lives in module memory (one serverless instance); it is a live tape, not a permanent history.

const GQL = "https://graphql.mainnet.sui.io/graphql";

type Swap = { pool: string; aToB: boolean; amountIn: string; amountOut: string };
type Dex = { name: string; type: string; parse: (j: Record<string, unknown>) => Swap | null };

const str = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");

// Event shapes were checked against live mainnet events.
const DEXES: Dex[] = [
  {
    name: "Cetus",
    type: "0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb::pool::SwapEvent",
    parse: (j) => (j.pool ? { pool: str(j.pool), aToB: j.atob === true || j.atob === "true", amountIn: str(j.amount_in), amountOut: str(j.amount_out) } : null),
  },
  {
    name: "Bluefin",
    type: "0x3492c874c1e3b3e2984e8c41b589e642d4d0a5d6459e5a9cfc2d52fd7c89c267::events::AssetSwap",
    parse: (j) => (j.pool_id ? { pool: str(j.pool_id), aToB: j.a2b === true || j.a2b === "true", amountIn: str(j.amount_in), amountOut: str(j.amount_out) } : null),
  },
  {
    // In Momentum's event amount_x / amount_y are the pool's X and Y sides; the input side is X when x_for_y.
    name: "Momentum",
    type: "0x70285592c97965e811e0c6f98dccc3a9c2b4ad854b3594faab9597ada267b860::trade::SwapEvent",
    parse: (j) => {
      if (!j.pool_id) return null;
      const xForY = j.x_for_y === true || j.x_for_y === "true";
      return { pool: str(j.pool_id), aToB: xForY, amountIn: xForY ? str(j.amount_x) : str(j.amount_y), amountOut: xForY ? str(j.amount_y) : str(j.amount_x) };
    },
  },
  {
    name: "Turbos",
    type: "0x91bfbc386a41afcfd9b2533058d7e915a1d3829089cc268ff4333d54d6339ca1::pool::SwapEvent",
    parse: (j) => {
      if (!j.pool) return null;
      const aToB = j.a_to_b === true || j.a_to_b === "true";
      return { pool: str(j.pool), aToB, amountIn: aToB ? str(j.amount_a) : str(j.amount_b), amountOut: aToB ? str(j.amount_b) : str(j.amount_a) };
    },
  },
  {
    // DeepBook v3 order book: one event per matched maker order. Fills of one taker order are summed below.
    // The pool's base coin is side A; a taker bid pays quote (B) to receive base (A).
    name: "DeepBook",
    type: "0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809::order_info::OrderFilled",
    parse: (j) => {
      if (!j.pool_id) return null;
      const bid = j.taker_is_bid === true || j.taker_is_bid === "true";
      return { pool: str(j.pool_id), aToB: !bid, amountIn: bid ? str(j.quote_quantity) : str(j.base_quantity), amountOut: bid ? str(j.base_quantity) : str(j.quote_quantity) };
    },
  },
];
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
  dex: string;
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
  lastSeen: new Map<string, number>(),
  lastRun: 0,
  warm: new Set<string>(),
  warmAll: false,
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
        const m = /Pool<([^,<>\s]+),\s*([^,<>\s]+)/.exec(repr);
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

type Fresh = { dex: Dex; node: Node; swap: Swap; t: number };

async function fetchDex(dex: Dex): Promise<Fresh[]> {
  const pages: Node[][] = [];
  let before: string | null = null;
  const seen = state.lastSeen.get(dex.name) ?? 0;
  const maxPages = state.warm.has(dex.name) ? 4 : 16;
  for (let i = 0; i < maxPages; i++) {
    const d: {
      events: { pageInfo: { hasPreviousPage: boolean; startCursor: string | null }; nodes: Node[] };
    } = await gql(EVENTS_Q, { t: dex.type, b: before });
    pages.push(d.events.nodes);
    const oldest = d.events.nodes[0]?.timestamp ? Date.parse(d.events.nodes[0].timestamp) : 0;
    if (!d.events.pageInfo.hasPreviousPage || !d.events.pageInfo.startCursor) break;
    if (seen && oldest <= seen) break;
    before = d.events.pageInfo.startCursor;
  }
  const out: Fresh[] = [];
  for (const node of pages.flat()) {
    if (!node.timestamp || !node.contents || !node.transaction) continue;
    const t = Date.parse(node.timestamp);
    if (t <= seen - 2_000) continue;
    const swap = dex.parse(node.contents.json);
    if (swap) out.push({ dex, node, swap, t });
  }
  state.warm.add(dex.name);
  return out;
}

async function refresh() {
  const results = await Promise.allSettled(DEXES.map((d) => fetchDex(d)));
  const fresh: Fresh[] = [];
  let failed = 0;
  let lastErr: unknown = null;
  for (const r of results) {
    if (r.status === "fulfilled") fresh.push(...r.value);
    else {
      failed++;
      lastErr = r.reason;
    }
  }
  if (failed === DEXES.length) throw lastErr instanceof Error ? lastErr : new Error("fetch failed");
  state.warmAll = true;
  if (fresh.length === 0) return;

  await loadPools([...new Set(fresh.map((f) => f.swap.pool))]);
  const coinTypes = new Set<string>();
  for (const f of fresh) {
    const pair = state.pools.get(f.swap.pool);
    if (pair) pair.forEach((c) => coinTypes.add(c));
  }
  await loadPrices([...coinTypes]);

  state.stats = {
    fresh: fresh.length,
    scanned: fresh.length,
    poolsOk: [...state.pools.values()].filter(Boolean).length,
    poolsNone: [...state.pools.values()].filter((v) => !v).length,
    pricesOk: [...state.prices.values()].filter(Boolean).length,
    pricesNone: [...state.prices.values()].filter((v) => !v).length,
    maxUsd: state.stats.maxUsd,
  };

  // One row per transaction: keep the biggest hop (aggregator routes emit several swap events).
  // Sum fills of the same pool and direction inside one transaction (order books emit one event per maker order).
  const merged = new Map<string, Fresh>();
  for (const f of fresh) {
    const key = `${(f.node.transaction as { digest: string }).digest}|${f.swap.pool}|${f.swap.aToB}`;
    const cur = merged.get(key);
    if (!cur) {
      merged.set(key, f);
      continue;
    }
    try {
      cur.swap = {
        ...cur.swap,
        amountIn: (BigInt(cur.swap.amountIn) + BigInt(f.swap.amountIn)).toString(),
        amountOut: (BigInt(cur.swap.amountOut) + BigInt(f.swap.amountOut)).toString(),
      };
    } catch {
      // malformed amount: keep the first event only
    }
  }

  const best = new Map<string, Whale>();
  for (const f of merged.values()) {
    const { swap } = f;
    const pair = state.pools.get(swap.pool);
    if (!pair) continue;
    const inT = swap.aToB ? pair[0] : pair[1];
    const outT = swap.aToB ? pair[1] : pair[0];
    const pin = state.prices.get(inT);
    const pout = state.prices.get(outT);
    if (!pin && !pout) continue;
    const inAmt = pin ? Number(swap.amountIn) / 10 ** pin.decimals : NaN;
    const outAmt = pout ? Number(swap.amountOut) / 10 ** pout.decimals : NaN;
    const inUsd = pin ? inAmt * pin.price : NaN;
    const outUsd = pout ? outAmt * pout.price : NaN;
    // Both sides priced: they must roughly agree, otherwise the price data for a thin token is unreliable.
    if (Number.isFinite(inUsd) && Number.isFinite(outUsd) && (inUsd > outUsd * 3 || outUsd > inUsd * 3)) continue;
    const usd = Number.isFinite(inUsd) ? inUsd : outUsd;
    if (Number.isFinite(usd) && usd > state.stats.maxUsd) state.stats.maxUsd = Math.round(usd);
    if (!Number.isFinite(usd) || usd < FLOOR_USD) continue;
    const digest = (f.node.transaction as { digest: string }).digest;
    const row: Whale = {
      id: `${digest}:${swap.pool}`,
      t: f.t,
      digest,
      dex: f.dex.name,
      sender: f.node.transaction?.sender?.address ?? null,
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

  for (const d of DEXES) {
    const ts = fresh.filter((f) => f.dex === d).map((f) => f.t);
    if (ts.length) state.lastSeen.set(d.name, Math.max(state.lastSeen.get(d.name) ?? 0, ...ts));
  }

  const cutoff = Date.now() - KEEP_MS;
  const sorted = [...state.whales.values()].filter((w) => w.t >= cutoff).sort((a, b) => b.t - a.t).slice(0, MAX_KEEP);
  state.whales = new Map(sorted.map((w) => [w.digest, w]));
}

export async function getWhales(waitFresh = false): Promise<{ updated: number; floor: number; error: string | null; stats: typeof state.stats; items: Whale[] }> {
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
  if (state.inflight && (!state.warmAll || waitFresh)) await state.inflight;
  return {
    updated: state.lastRun,
    floor: FLOOR_USD,
    error: state.lastError,
    stats: state.stats,
    items: [...state.whales.values()].sort((a, b) => b.t - a.t).slice(0, 100),
  };
}
