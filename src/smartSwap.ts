import { AggregatorQuoter, TradeBuilder } from '@flowx-finance/sdk';
import {
  Config as Bluefin7kConfig,
  buildTx as buildBluefin7kTx,
  getQuote as getBluefin7kQuote,
  isBluefinXRouting,
} from '@bluefin-exchange/bluefin7k-aggregator-sdk';
import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import { fromBase64 } from '@mysten/sui/utils';
import { VOLT_TREASURY_ADDRESS } from './constants';
import { buildCetusSwapTx, fetchCetusQuote, normalizeDexName, type CetusQuoteResult } from './cetusSwap';
import { txFromKindBase64 } from './aftermathPerps';
import { safeNormalizeCoinType, SUI_COIN_TYPE, suiGrpcClient } from './suiClient';
import { addCoinFeeToTx, appendVoltFeeCoinSplit, calcFeeUnits } from './voltFee';

export const AF_ROUTER_API = 'https://aftermath.finance/api/router';

export type SwapRouterProvider = 'FlowX' | 'Cetus' | 'Aftermath' | 'Bluefin7k';

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
  flowxRoute?: any;
  bluefin7kQuote?: any;
}

interface NormalizedRouterQuote {
  provider: SwapRouterProvider;
  amountOutAtomic: bigint;
  feeUnits: bigint;
  netInputUnits: bigint;
  dexHops: string[];
  priceImpactPct: number;
  payload: Partial<
    Pick<SmartSwapQuote, 'cetusQuote' | 'aftermathRoute' | 'flowxRoute' | 'bluefin7kQuote'>
  >;
}

export interface SwapTxBuildParams {
  sender: string;
  fromCoinType: string;
  amountInAtomic: bigint;
  quote: SmartSwapQuote;
  slippage?: number;
  refSharePct?: number;
}

let flowxQuoterSingleton: AggregatorQuoter | null = null;
let bluefinConfigured = false;

function getFlowXQuoter(): AggregatorQuoter {
  if (!flowxQuoterSingleton) {
    flowxQuoterSingleton = new AggregatorQuoter('mainnet');
  }
  return flowxQuoterSingleton;
}

function ensureBluefin7kConfig(): void {
  if (bluefinConfigured) return;
  bluefinConfigured = true;
  Bluefin7kConfig.setSuiClient(suiGrpcClient as any);
  const env = (import.meta as any).env || {};
  const apiKey = typeof env.VITE_BLUEFIN7K_API_KEY === 'string' ? env.VITE_BLUEFIN7K_API_KEY.trim() : '';
  const baseUrl = typeof env.VITE_BLUEFIN7K_BASE_URL === 'string' ? env.VITE_BLUEFIN7K_BASE_URL.trim() : '';
  if (apiKey) {
    Bluefin7kConfig.setBluefinAggregatorApiKey(apiKey);
    Bluefin7kConfig.setApiKey(apiKey);
  }
  if (baseUrl) {
    Bluefin7kConfig.setBaseUrl(baseUrl);
  }
}

function parseBigIntValue(val: unknown): bigint {
  if (typeof val === 'bigint') return val;
  if (typeof val === 'number' && Number.isFinite(val)) return BigInt(Math.trunc(val));
  if (val && typeof (val as any).toString === 'function') {
    const cleaned = String((val as any).toString()).trim().replace(/n$/i, '');
    if (/^-?\d+$/.test(cleaned)) return BigInt(cleaned);
  }
  return 0n;
}

function computeNetSwapInput(amountInAtomic: bigint, feeRate: number) {
  if (amountInAtomic <= 0n) {
    throw new Error('Amount must be greater than zero');
  }
  const feeUnits = calcFeeUnits(amountInAtomic, feeRate);
  const netInputUnits = amountInAtomic - feeUnits;
  if (netInputUnits <= 0n) {
    throw new Error('Amount too small after protocol fee');
  }
  return { feeUnits, netInputUnits };
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

function extractFlowXDexHops(rawPaths: any): string[] {
  const hops = new Set<string>();
  if (Array.isArray(rawPaths)) {
    for (const pathGroup of rawPaths) {
      if (Array.isArray(pathGroup)) {
        for (const hop of pathGroup) {
          if (hop?.source) hops.add(normalizeDexName(String(hop.source)));
        }
      }
    }
  }
  return hops.size > 0 ? Array.from(hops) : ['FlowX Finance'];
}

function extractBluefin7kDexHops(swaps: any): string[] {
  const hops = new Set<string>();
  if (Array.isArray(swaps)) {
    for (const swap of swaps) {
      const source = swap?.pool?.type || swap?.pool?.dex || swap?.source || swap?.protocol;
      if (source) hops.add(normalizeDexName(String(source)));
    }
  }
  return hops.size > 0 ? Array.from(hops) : ['Bluefin7k'];
}

function prepareInputCoinAndFee(
  tx: Transaction,
  params: {
    sender: string;
    fromCoinType: string;
    amountInAtomic: bigint;
    feeUnits: bigint;
    netInputUnits: bigint;
    refSharePct?: number;
  }
) {
  const { sender, fromCoinType, amountInAtomic, feeUnits, netInputUnits, refSharePct = 0.25 } = params;
  tx.setSenderIfNotSet(sender);
  const normalizedFrom = safeNormalizeCoinType(fromCoinType);
  const isSui = normalizedFrom === safeNormalizeCoinType(SUI_COIN_TYPE);

  if (isSui) {
    if (feeUnits > 0n) {
      appendVoltFeeCoinSplit(tx, tx.gas, feeUnits, sender, refSharePct);
    }
    const [coinIn] = tx.splitCoins(tx.gas, [netInputUnits]);
    return coinIn;
  }

  const sourceCoin = tx.add(
    coinWithBalance({
      type: normalizedFrom,
      balance: amountInAtomic,
    })
  );
  if (feeUnits > 0n) {
    appendVoltFeeCoinSplit(tx, sourceCoin, feeUnits, sender, refSharePct);
  }
  return sourceCoin;
}

function formatRouterError(provider: SwapRouterProvider, reason: unknown): string {
  const msg = String((reason as any)?.message || reason || 'Unavailable').trim();
  if (
    provider === 'Bluefin7k' &&
    (!msg || msg === 'Error' || /403|404|RBAC|access denied|Not Found|Failed to fetch/i.test(msg))
  ) {
    return 'Partner API Key required';
  }
  return msg.length > 72 ? `${msg.slice(0, 69)}...` : msg;
}

export async function fetchAftermathSwapQuote(params: {
  fromCoinType: string;
  toCoinType: string;
  amountInAtomic: bigint;
  feeRate: number;
}): Promise<NormalizedRouterQuote> {
  const { feeUnits, netInputUnits } = computeNetSwapInput(params.amountInAtomic, params.feeRate);

  const res = await fetch(`${AF_ROUTER_API}/trade-route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      coinInType: safeNormalizeCoinType(params.fromCoinType),
      coinOutType: safeNormalizeCoinType(params.toCoinType),
      coinInAmount: `${netInputUnits}n`,
    }),
    signal: AbortSignal.timeout(6500),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Aftermath router error (${res.status})`);
  }

  const amountOutAtomic = parseBigIntValue(data?.coinOut?.amount);
  if (amountOutAtomic <= 0n || !Array.isArray(data?.routes) || data.routes.length === 0) {
    throw new Error('No Aftermath liquidity route found');
  }

  return {
    provider: 'Aftermath',
    amountOutAtomic,
    feeUnits,
    netInputUnits,
    dexHops: extractAftermathDexHops(data.routes),
    priceImpactPct: Math.max(0, Number(data?.netTradeFeePercentage || 0) * 100),
    payload: { aftermathRoute: data },
  };
}

export async function fetchFlowXQuote(params: {
  fromCoinType: string;
  toCoinType: string;
  amountInAtomic: bigint;
  feeRate: number;
}): Promise<NormalizedRouterQuote> {
  const { feeUnits, netInputUnits } = computeNetSwapInput(params.amountInAtomic, params.feeRate);

  const quoter = getFlowXQuoter();
  const routeResult = await quoter.getRoutes({
    tokenIn: safeNormalizeCoinType(params.fromCoinType),
    tokenOut: safeNormalizeCoinType(params.toCoinType),
    amountIn: netInputUnits.toString(),
  });

  const amountOutAtomic = parseBigIntValue(routeResult?.amountOut);
  if (!routeResult || amountOutAtomic <= 0n || !Array.isArray(routeResult.routes) || routeResult.routes.length === 0) {
    throw new Error('No FlowX liquidity route found');
  }

  const rawImpact = Number(routeResult?.rawQuote?.priceImpact ?? 0);
  return {
    provider: 'FlowX',
    amountOutAtomic,
    feeUnits,
    netInputUnits,
    dexHops: extractFlowXDexHops(routeResult?.rawQuote?.paths),
    priceImpactPct: Number.isFinite(rawImpact) ? Math.max(0, Math.abs(rawImpact)) : 0,
    payload: { flowxRoute: routeResult },
  };
}

export async function fetchBluefin7kQuote(params: {
  fromCoinType: string;
  toCoinType: string;
  amountInAtomic: bigint;
  feeRate: number;
}): Promise<NormalizedRouterQuote> {
  const { feeUnits, netInputUnits } = computeNetSwapInput(params.amountInAtomic, params.feeRate);
  ensureBluefin7kConfig();

  const quoteResponse = await getBluefin7kQuote(
    {
      tokenIn: safeNormalizeCoinType(params.fromCoinType),
      tokenOut: safeNormalizeCoinType(params.toCoinType),
      amountIn: netInputUnits.toString(),
    },
    { signal: AbortSignal.timeout(4500) }
  );

  if (isBluefinXRouting(quoteResponse)) {
    throw new Error('Sponsored BluefinX RFQ requires sponsorship');
  }

  const amountOutAtomic = parseBigIntValue((quoteResponse as any)?.returnAmountWithDecimal);
  if (amountOutAtomic <= 0n || !Array.isArray((quoteResponse as any)?.routes)) {
    throw new Error('No Bluefin7k liquidity route found');
  }

  const rawImpact = Number((quoteResponse as any)?.priceImpact ?? 0);
  return {
    provider: 'Bluefin7k',
    amountOutAtomic,
    feeUnits,
    netInputUnits,
    dexHops: extractBluefin7kDexHops((quoteResponse as any)?.swaps),
    priceImpactPct: Number.isFinite(rawImpact) ? Math.max(0, Math.abs(rawImpact) * (Math.abs(rawImpact) < 1 ? 100 : 1)) : 0,
    payload: { bluefin7kQuote: quoteResponse },
  };
}

async function fetchNormalizedCetusQuote(params: {
  fromCoinType: string;
  toCoinType: string;
  amountInAtomic: bigint;
  feeRate: number;
}): Promise<NormalizedRouterQuote> {
  const c = await fetchCetusQuote(params);
  return {
    provider: 'Cetus',
    amountOutAtomic: c.amountOutAtomic,
    feeUnits: c.feeUnits,
    netInputUnits: c.netInputUnits,
    dexHops: c.dexHops,
    priceImpactPct: c.priceImpactPct,
    payload: { cetusQuote: c },
  };
}

/**
 * Races FlowX, Cetus, Aftermath, and Bluefin7k Aggregators in parallel and
 * selects the highest-output route after Volt's tier fee.
 */
export async function fetchBestSwapQuote(params: {
  fromCoinType: string;
  toCoinType: string;
  amountInAtomic: bigint;
  feeRate: number;
}): Promise<SmartSwapQuote> {
  const racers: Array<{ provider: SwapRouterProvider; run: () => Promise<NormalizedRouterQuote> }> = [
    { provider: 'FlowX', run: () => fetchFlowXQuote(params) },
    { provider: 'Cetus', run: () => fetchNormalizedCetusQuote(params) },
    { provider: 'Aftermath', run: () => fetchAftermathSwapQuote(params) },
    { provider: 'Bluefin7k', run: () => fetchBluefin7kQuote(params) },
  ];

  const settled = await Promise.allSettled(racers.map((r) => r.run()));

  const validQuotes: NormalizedRouterQuote[] = [];
  const alternatives: RouterQuoteSummary[] = [];

  settled.forEach((outcome, idx) => {
    const provider = racers[idx].provider;
    if (outcome.status === 'fulfilled') {
      validQuotes.push(outcome.value);
      alternatives.push({
        provider,
        amountOutAtomic: outcome.value.amountOutAtomic,
        dexHops: outcome.value.dexHops,
      });
    } else {
      alternatives.push({
        provider,
        amountOutAtomic: 0n,
        dexHops: [],
        error: formatRouterError(provider, outcome.reason),
      });
    }
  });

  if (validQuotes.length === 0) {
    const errMsg = alternatives.map((a) => `${a.provider}: ${a.error}`).join(' | ');
    throw new Error(errMsg || 'No liquidity route found across aggregators');
  }

  validQuotes.sort((a, b) => (b.amountOutAtomic > a.amountOutAtomic ? 1 : b.amountOutAtomic < a.amountOutAtomic ? -1 : 0));
  alternatives.sort((a, b) => (b.amountOutAtomic > a.amountOutAtomic ? 1 : b.amountOutAtomic < a.amountOutAtomic ? -1 : 0));

  const winner = validQuotes[0];
  const runnerUp = validQuotes[1];
  const savingsPct =
    runnerUp && runnerUp.amountOutAtomic > 0n && winner.amountOutAtomic > runnerUp.amountOutAtomic
      ? (Number(winner.amountOutAtomic - runnerUp.amountOutAtomic) / Number(runnerUp.amountOutAtomic)) * 100
      : 0;

  const combinedPayload: Partial<SmartSwapQuote> = {};
  for (const q of validQuotes) {
    Object.assign(combinedPayload, q.payload);
  }

  return {
    provider: winner.provider,
    fromCoinType: params.fromCoinType,
    toCoinType: params.toCoinType,
    amountOutAtomic: winner.amountOutAtomic,
    feeUnits: winner.feeUnits,
    netInputUnits: winner.netInputUnits,
    dexHops: winner.dexHops,
    priceImpactPct: winner.priceImpactPct,
    savingsPct,
    alternatives,
    ...combinedPayload,
  };
}

export async function buildAftermathSwapTx(params: SwapTxBuildParams): Promise<Transaction | string> {
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

export async function buildFlowXSwapTx(params: SwapTxBuildParams): Promise<Transaction> {
  const { sender, fromCoinType, amountInAtomic, quote, slippage = 0.01, refSharePct = 0.25 } = params;
  if (!quote.flowxRoute?.routes?.length) {
    throw new Error('Missing FlowX route payload');
  }

  const tx = new Transaction();
  const coinIn = prepareInputCoinAndFee(tx, {
    sender,
    fromCoinType,
    amountInAtomic,
    feeUnits: quote.feeUnits,
    netInputUnits: quote.netInputUnits,
    refSharePct,
  });

  const slippageScaled = Math.max(1, Math.min(999_999, Math.round(slippage * 1_000_000)));
  const trade = new TradeBuilder('mainnet', quote.flowxRoute.routes)
    .sender(sender)
    .amountIn(quote.flowxRoute.amountIn)
    .amountOut(quote.flowxRoute.amountOut)
    .slippage(slippageScaled)
    .deadline(Date.now() + 20 * 60_000)
    .build();

  const coinOut = await trade.swap({
    client: suiGrpcClient as any,
    tx: tx as any,
    coinIn: coinIn as any,
  });
  if (coinOut) {
    tx.transferObjects([coinOut as any], sender);
  }
  return tx;
}

export async function buildBluefin7kSwapTx(params: SwapTxBuildParams): Promise<Transaction> {
  const { sender, fromCoinType, amountInAtomic, quote, slippage = 0.01, refSharePct = 0.25 } = params;
  if (!quote.bluefin7kQuote) {
    throw new Error('Missing Bluefin7k quote response');
  }
  ensureBluefin7kConfig();

  const tx = new Transaction();
  const coinIn = prepareInputCoinAndFee(tx, {
    sender,
    fromCoinType,
    amountInAtomic,
    feeUnits: quote.feeUnits,
    netInputUnits: quote.netInputUnits,
    refSharePct,
  });

  const built = await buildBluefin7kTx({
    quoteResponse: quote.bluefin7kQuote,
    accountAddress: sender,
    slippage,
    commission: { partner: VOLT_TREASURY_ADDRESS, commissionBps: 0 },
    devInspect: false,
    extendTx: { tx: tx as any, coinIn: coinIn as any },
  });

  if (!(built.tx instanceof Transaction)) {
    throw new Error('Sponsored BluefinX payload is not a standard user Transaction');
  }
  if (built.coinOut) {
    built.tx.transferObjects([built.coinOut as any], sender);
  }
  return built.tx;
}

export async function buildBestSwapTx(params: SwapTxBuildParams): Promise<Transaction | string> {
  const builders: Record<SwapRouterProvider, () => Promise<Transaction | string>> = {
    FlowX: () => buildFlowXSwapTx(params),
    Aftermath: () => buildAftermathSwapTx(params),
    Bluefin7k: () => buildBluefin7kSwapTx(params),
    Cetus: () => {
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
    },
  };

  return builders[params.quote.provider]();
}
