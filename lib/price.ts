import type { AggregatorClient } from "@cetusprotocol/aggregator-sdk";
import { USDC_TYPE, USDT_TYPE, type Token } from "./tokens";

const TTL = 60_000;
const cache = new Map<string, { at: number; p: Promise<number | null> }>();

async function quoteUsd(agg: AggregatorClient, token: Token, units: bigint): Promise<number | null> {
  const r = await agg.findRouters({
    from: token.type,
    target: USDC_TYPE,
    amount: (units * 10n ** BigInt(token.decimals)).toString(),
    byAmountIn: true,
  });
  if (!r || r.error || r.insufficientLiquidity) return null;
  const out = Number(r.amountOut.toString()) / 1e6;
  return out > 0 ? out / Number(units) : null;
}

/** Approximate USD price of one token, taken from a live quote into USDC. */
export function getUsdPrice(agg: AggregatorClient, token: Token): Promise<number | null> {
  if (token.type === USDC_TYPE || token.type === USDT_TYPE) return Promise.resolve(1);
  const hit = cache.get(token.type);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = quoteUsd(agg, token, 1n)
    .then((v) => (v !== null && v >= 0.001 ? v : quoteUsd(agg, token, 100_000n)))
    .catch(() => null);
  cache.set(token.type, { at: Date.now(), p });
  return p;
}

export function formatUsd(v: number): string {
  if (v > 0 && v < 0.01) return "< $0.01";
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
