import { Transaction } from '@mysten/sui/transactions';
import { fromBase64 } from '@mysten/sui/utils';
import { buildCetusSwapTx, fetchCetusQuote, normalizeDexName, type CetusQuoteResult } from './cetusSwap';
import { txFromKindBase64 } from './aftermathPerps';
import { safeNormalizeCoinType, SUI_COIN_TYPE } from './suiClient';
import { addCoinFeeToTx, calcFeeUnits } from './voltFee';

export const AF_ROUTER_API = 'https://aftermath.finance/api/router';

export type SwapRouterProvider = 'Cetus' | 'Aftermath';

export interface RouterQuoteSummary {
  provider: SwapRouterProvider;
  amountOutAtomic: bigint;
  dexHops: string[];
  error?: string;
}

export interface SmartSwapQuote {
  provider: SwapRouterProvider;
  fromCoinType: string;
  toCoinType: string;
  amountOutAtomic: bigint;
  feeUnits: bigint;
  netInputUnits: bigint;
  dexHops: string[];
  priceImpactPct: number;
  /** Positive percentage improvement over the runner-up aggregator (0 if single quote or tie). */
  savingsPct: number;
  alternatives: RouterQuoteSummary[];
  cetusQuote?: CetusQuoteResult;
  aftermathRoute?: any;
}

function parseAfBigInt(val: unknown): bigint {
  if (typeof val === 'bigint') return val;
  if (typeof val === 'number' && Number.isFinite(val)) return BigInt(Math.trunc(val));
  if (typeof val === 'string') {
    const cleaned = val.trim().replace(/n$/i, '');
    if (/^-?\d+$/.test(cleaned)) return BigInt(cleaned);
  }
  return 0n;
}

function extractAftermathDexHops(routes: any[]): string[] {
  const hops = new Set<string>();
  if (Array.isArray(routes)) {
    for (const r of routes) {
      if (Array.isArray(r?.paths)) {
        for (const p of r.paths) {
          if (p?.protocolName) hops.add(normalizeDexName(String(p.protocolName)));
        }
      }
    }
  }
  return hops.size > 0 ? Array.from(hops) : ['Aftermath Finance'];
}

interface AfQuoteResult {
  amountOutAtomic: bigint;
  feeUnits: bigint;
  netInputUnits: bigint;
  dexHops: string[];
  completeRoute: any;
  netTradeFeePct: number;
}

export async function fetchAftermathSwapQuote(params: {
  fromCoinType: string;
  toCoinType: string;
  amountInAtomic: bigint;
  feeRate: number;
}): Promise<AfQuoteResult> {
  const { fromCoinType, toCoinType, amountInAtomic, feeRate } = params;
  if (amountInAtomic <= 0n) {
    throw new Error('Amount must be greater than zero');
  }

  const feeUnits = calcFeeUnits(amountInAtomic, feeRate);
  const netInputUnits = amountInAtomic - feeUnits;
  if (netInputUnits <= 0n) {
    throw new Error('Amount too small after protocol fee');
  }

  const res = await fetch(`${AF_ROUTER_API}/trade-route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      coinInType: safeNormalizeCoinType(fromCoinType),
      coinOutType: safeNormalizeCoinType(toCoinType),
      coinInAmount: `${netInputUnits}n`,
    }),
    signal: AbortSignal.timeout(6500),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Aftermath router error (${res.status})`);
  }

  const amountOutAtomic = parseAfBigInt(data?.coinOut?.amount);
  if (amountOutAtomic <= 0n || !Array.isArray(data?.routes) || data.routes.length === 0) {
    throw new Error('No Aftermath liquidity route found');
  }

  return {
    amountOutAtomic,
    feeUnits,
    netInputUnits,
    dexHops: extractAftermathDexHops(data.routes),
    completeRoute: data,
    netTradeFeePct: Number(data?.netTradeFeePercentage || 0) * 100,
  };
}

/**
 * Races Cetus Aggregator (which includes Bluefin Spot, Cetus, DeepBook, Turbos, FlowX)
 * against Aftermath Router in parallel and selects the route with highest output after Volt tier fee.
 */
export async function fetchBestSwapQuote(params: {
  fromCoinType: string;
  toCoinType: string;
  amountInAtomic: bigint;
  feeRate: number;
}): Promise<SmartSwapQuote> {
  const [cetusSettled, afSettled] = await Promise.allSettled([
    fetchCetusQuote(params),
    fetchAftermathSwapQuote(params),
  ]);

  const cetus = cetusSettled.status === 'fulfilled' ? cetusSettled.value : null;
  const af = afSettled.status === 'fulfilled' ? afSettled.value : null;

  const alternatives: RouterQuoteSummary[] = [
    cetus
      ? { provider: 'Cetus', amountOutAtomic: cetus.amountOutAtomic, dexHops: cetus.dexHops }
      : {
          provider: 'Cetus',
          amountOutAtomic: 0n,
          dexHops: [],
          error: cetusSettled.status === 'rejected' ? cetusSettled.reason?.message || 'Unavailable' : 'Unavailable',
        },
    af
      ? { provider: 'Aftermath', amountOutAtomic: af.amountOutAtomic, dexHops: af.dexHops }
      : {
          provider: 'Aftermath',
          amountOutAtomic: 0n,
          dexHops: [],
          error: afSettled.status === 'rejected' ? afSettled.reason?.message || 'Unavailable' : 'Unavailable',
        },
  ];

  if (!cetus && !af) {
    const errMsg = alternatives.map((a) => `${a.provider}: ${a.error}`).join(' | ');
    throw new Error(errMsg || 'No liquidity route found across aggregators');
  }

  const pickAftermath = Boolean(af && (!cetus || af.amountOutAtomic > cetus.amountOutAtomic));

  if (pickAftermath && af) {
    const savingsPct =
      cetus && cetus.amountOutAtomic > 0n
        ? (Number(af.amountOutAtomic - cetus.amountOutAtomic) / Number(cetus.amountOutAtomic)) * 100
        : 0;
    const priceImpactPct = cetus
      ? Math.max(0, cetus.priceImpactPct - savingsPct)
      : Math.max(0, af.netTradeFeePct);

    return {
      provider: 'Aftermath',
      fromCoinType: params.fromCoinType,
      toCoinType: params.toCoinType,
      amountOutAtomic: af.amountOutAtomic,
      feeUnits: af.feeUnits,
      netInputUnits: af.netInputUnits,
      dexHops: af.dexHops,
      priceImpactPct,
      savingsPct,
      alternatives,
      cetusQuote: cetus || undefined,
      aftermathRoute: af.completeRoute,
    };
  }

  // Default / Winner: Cetus Aggregator
  const c = cetus!;
  const savingsPct =
    af && af.amountOutAtomic > 0n && c.amountOutAtomic >= af.amountOutAtomic
      ? (Number(c.amountOutAtomic - af.amountOutAtomic) / Number(af.amountOutAtomic)) * 100
      : 0;

  return {
    provider: 'Cetus',
    fromCoinType: params.fromCoinType,
    toCoinType: params.toCoinType,
    amountOutAtomic: c.amountOutAtomic,
    feeUnits: c.feeUnits,
    netInputUnits: c.netInputUnits,
    dexHops: c.dexHops,
    priceImpactPct: c.priceImpactPct,
    savingsPct,
    alternatives,
    cetusQuote: c,
    aftermathRoute: af?.completeRoute,
  };
}

export async function buildAftermathSwapTx(params: {
  sender: string;
  fromCoinType: string;
  amountInAtomic: bigint;
  quote: SmartSwapQuote;
  slippage?: number;
  refSharePct?: number;
}): Promise<Transaction | string> {
  const { sender, fromCoinType, quote, slippage = 0.01, refSharePct = 0.25 } = params;
  if (!quote.aftermathRoute) {
    throw new Error('Missing Aftermath completeRoute');
  }

  const res = await fetch(`${AF_ROUTER_API}/v1/transactions/trade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      walletAddress: sender,
      completeRoute: quote.aftermathRoute,
      slippage,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.txKind) {
    throw new Error(data?.message || data?.error || `Aftermath build tx error (${res.status})`);
  }

  const isSui = safeNormalizeCoinType(fromCoinType) === safeNormalizeCoinType(SUI_COIN_TYPE);
  if (isSui) {
    return txFromKindBase64(data.txKind, sender, quote.feeUnits, refSharePct);
  }

  // Non-SUI input coin: attach Volt fee split via coinWithBalance on Transaction
  try {
    const tx = Transaction.fromKind(fromBase64(data.txKind));
    tx.setSenderIfNotSet(sender);
    if (quote.feeUnits > 0n) {
      addCoinFeeToTx(tx, {
        coinType: fromCoinType,
        feeAtomic: quote.feeUnits,
        sender,
        refSharePct,
      });
    }
    return tx;
  } catch (err: any) {
    // Graceful fallback to Cetus aggregator if a v2 FundsWithdrawal non-SUI payload cannot be extended via coinWithBalance
    if (quote.cetusQuote) {
      return buildCetusSwapTx({
        sender,
        fromCoinType,
        amountInAtomic: params.amountInAtomic,
        quote: quote.cetusQuote,
        slippage,
        refSharePct,
      });
    }
    throw err;
  }
}

export async function buildBestSwapTx(params: {
  sender: string;
  fromCoinType: string;
  amountInAtomic: bigint;
  quote: SmartSwapQuote;
  slippage?: number;
  refSharePct?: number;
}): Promise<Transaction | string> {
  if (params.quote.provider === 'Aftermath' && params.quote.aftermathRoute) {
    return buildAftermathSwapTx(params);
  }
  if (!params.quote.cetusQuote) {
    throw new Error('Selected Cetus quote is unavailable');
  }
  return buildCetusSwapTx({
    sender: params.sender,
    fromCoinType: params.fromCoinType,
    amountInAtomic: params.amountInAtomic,
    quote: params.quote.cetusQuote,
    slippage: params.slippage,
    refSharePct: params.refSharePct,
  });
}
