import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { appendFeeToJsonV2Ptb, appendVoltFeeCoinSplit } from './voltFee';

export const AF_PERPS_API = 'https://aftermath.finance/api/perpetuals';
export const AF_USDC_COIN_TYPE =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
export const AF_SUI_COIN_TYPE =
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

export interface AfMarketInfo {
  marketId: string;
  symbol: string;
  collateralCoinType: string;
  indexPrice: number;
  markPrice: number;
  midPrice: number;
  volume24hUsd: number;
  priceChange24hPct: number;
  estimatedFundingRate: number;
  lotSize: bigint;
  tickSize: bigint;
  minOrderUsdValue: number;
  maxLeverage: number;
}

export interface AfOrderbookLevel {
  price: number;
  size: number;
  totalSize: number;
}

export interface AfMarketOrderbook {
  bids: AfOrderbookLevel[];
  asks: AfOrderbookLevel[];
  bestBid: number;
  bestAsk: number;
  midPrice: number;
}

export interface AfPositionInfo {
  marketId: string;
  baseAssetAmount: number;
  quoteAssetNotionalAmount: number;
  collateralUsd: number;
  leverage: number;
  entryPrice: number;
  liquidationPrice: number;
  unrealizedPnlUsd: number;
  unrealizedFundingsUsd: number;
  freeCollateral: number;
  freeMarginUsd: number;
}

export interface AfAccountState {
  accountId: string | null;
  accountObjectId: string | null;
  totalEquityUsd: number;
  availableCollateral: number;
  availableCollateralUsd: number;
  totalUnrealizedPnlUsd: number;
  positions: AfPositionInfo[];
  /** All marketIds with an existing on-chain Position struct (including closed 0-size slots to prevent MoveAbort 41). */
  positionMarketIds: string[];
}

function parseBigIntN(val: unknown, fallback = 1n): bigint {
  if (typeof val === 'bigint') return val;
  if (typeof val === 'number') return BigInt(Math.floor(val));
  if (typeof val === 'string') {
    const cleaned = val.endsWith('n') ? val.slice(0, -1) : val;
    try {
      return BigInt(cleaned);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

const ReservationV2 = bcs.enum('Reservation', { MaxAmountU64: bcs.u64() });
const WithdrawalTypeV2 = bcs.enum('WithdrawalType', { Balance: bcs.TypeTag });
const WithdrawFromV2 = bcs.enum('WithdrawFrom', {
  Sender: null,
  Sponsor: null,
  SenderAllowance: bcs.struct('SenderAllowance', { funder: bcs.Address, allowance: bcs.Address }),
});
const FundsWithdrawalV2 = bcs.struct('FundsWithdrawal', {
  reservation: ReservationV2,
  typeArg: WithdrawalTypeV2,
  withdrawFrom: WithdrawFromV2,
});
const CallArgV2 = bcs.enum('CallArg', {
  Pure: bcs.struct('Pure', {
    bytes: bcs.byteVector().transform({
      input: (val: any) => (typeof val === 'string' ? fromBase64(val) : val),
      output: (val: Uint8Array) => toBase64(val),
    }),
  }),
  Object: bcs.ObjectArg,
  FundsWithdrawal: FundsWithdrawalV2,
});
const ProgrammableTxV2 = bcs.struct('ProgrammableTransaction', {
  inputs: bcs.vector(CallArgV2),
  commands: bcs.vector(bcs.Command),
});
const TxKindV2 = bcs.enum('TransactionKind', {
  ProgrammableTransaction: ProgrammableTxV2,
});

function stripKindKeys(val: any): any {
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) return val.map(stripKindKeys);
  if (typeof val === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (k === '$kind') continue;
      out[k] = stripKindKeys(v);
    }
    return out;
  }
  return val;
}

export function txFromKindBase64(
  txKindBase64: string,
  sender: string,
  feeMist?: bigint,
  refSharePct = 0.25
): Transaction | string {
  const bytes = fromBase64(txKindBase64);
  try {
    const tx = Transaction.fromKind(bytes);
    tx.setSender(sender);
    if (feeMist && feeMist > 0n) {
      appendVoltFeeCoinSplit(tx, tx.gas, feeMist, sender, refSharePct);
    }
    return tx;
  } catch {
    const parsed = TxKindV2.parse(bytes);
    const ptx = stripKindKeys(parsed.ProgrammableTransaction);
    const inputs: any[] = ptx.inputs || [];
    const commands: any[] = ptx.commands || [];

    if (feeMist && feeMist > 0n) {
      appendFeeToJsonV2Ptb(inputs, commands, feeMist, sender, refSharePct);
    }

    return JSON.stringify({
      version: 2,
      sender,
      expiration: null,
      gasData: { budget: null, price: null, owner: null, payment: null },
      inputs,
      commands,
    });
  }
}

export async function fetchAftermathMarkets(): Promise<Record<string, AfMarketInfo>> {
  const marketsRes = await fetch(`${AF_PERPS_API}/markets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (!marketsRes.ok) {
    throw new Error(`Aftermath markets HTTP ${marketsRes.status}`);
  }
  const data = await marketsRes.json();
  const marketDatas: any[] = data?.marketDatas || [];
  const marketIds: string[] = marketDatas
    .map((item) => String(item?.market?.objectId || ''))
    .filter(Boolean);

  const [pricesRes, statsRes] =
    marketIds.length > 0
      ? await Promise.all([
          fetch(`${AF_PERPS_API}/markets/prices`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ marketIds }),
          }).catch(() => null),
          fetch(`${AF_PERPS_API}/markets/24hr-stats`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ marketIds }),
          }).catch(() => null),
        ])
      : [null, null];

  const pricesData = pricesRes?.ok ? await pricesRes.json().catch(() => ({})) : {};
  const statsData = statsRes?.ok ? await statsRes.json().catch(() => ({})) : {};

  const priceById: Record<string, any> = {};
  for (const p of pricesData?.marketsPrices || pricesData?.marketPrices || []) {
    if (p?.marketId) priceById[p.marketId] = p;
  }
  const statsById: Record<string, any> = {};
  const rawStats: any[] = statsData?.marketsStats || statsData?.market24hrStats || [];
  rawStats.forEach((s, idx) => {
    const mId = s?.marketId || marketIds[idx];
    if (mId) statsById[mId] = s;
  });

  const map: Record<string, AfMarketInfo> = {};
  for (const item of marketDatas) {
    const sym = String(item?.metadata?.symbol || '').toUpperCase();
    const m = item?.market;
    const params = m?.marketParams;
    if (!sym || !m?.objectId) continue;

    const imr = Number(params?.marginRatioInitial || 0.05);
    let maxLev = imr > 0 ? Math.max(1, Math.floor(1 / imr)) : 20;
    // Prevent MoveAbort 2003 in position::set_initial_margin_ratio when floor(1e18/maxLev) < ceil(imr*1e18)
    if (maxLev > 1 && Math.floor(1e18 / maxLev) < Math.ceil(imr * 1e18)) {
      maxLev -= 1;
    }

    const pInfo = priceById[m.objectId] || {};
    const sInfo = statsById[m.objectId] || {};
    const idxPrice = Number(m.indexPrice || pInfo.basePrice || sInfo.basePrice || 0);

    map[sym] = {
      marketId: m.objectId,
      symbol: sym,
      collateralCoinType: m.collateralCoinType || AF_USDC_COIN_TYPE,
      indexPrice: idxPrice,
      markPrice: Number(pInfo.markPrice || sInfo.markPrice || idxPrice),
      midPrice: Number(pInfo.midPrice || sInfo.midPrice || idxPrice),
      volume24hUsd: Number(sInfo.volumeUsd || 0),
      priceChange24hPct: Number(sInfo.priceChangePercentage || 0) * 100,
      estimatedFundingRate: Number(m.estimatedFundingRate || 0),
      lotSize: parseBigIntN(params?.lotSize, 10000n),
      tickSize: parseBigIntN(params?.tickSize, 10000n),
      minOrderUsdValue: Number(params?.minOrderUsdValue || 1),
      maxLeverage: maxLev,
    };
  }
  return map;
}

export async function fetchAftermathOrderbook(marketId: string): Promise<AfMarketOrderbook> {
  const res = await fetch(`${AF_PERPS_API}/markets/orderbooks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ marketIds: [marketId] }),
  });
  if (!res.ok) {
    throw new Error(`Aftermath orderbooks HTTP ${res.status}`);
  }
  const data = await res.json();
  const entry =
    (data?.orderbooks || []).find((b: any) => b.marketId === marketId) ||
    data?.orderbooks?.[0] ||
    {};
  const book = entry?.orderbook || entry;

  const parseLevels = (arr: any[], reverse = false): AfOrderbookLevel[] => {
    const clean = (Array.isArray(arr) ? arr : [])
      .map((lv: any) => ({
        price: Number(lv?.price ?? lv?.[0] ?? 0),
        size: Number(lv?.size ?? lv?.[1] ?? 0),
      }))
      .filter((lv) => lv.price > 0 && lv.size > 0)
      .slice(0, 12);

    let cum = 0;
    const withCum = clean.map((lv) => {
      cum += lv.size;
      return { ...lv, totalSize: cum };
    });
    return reverse ? withCum.reverse() : withCum;
  };

  const asks = parseLevels(book.asks, true);
  const bids = parseLevels(book.bids, false);
  const bestAsk = asks.length > 0 ? asks[asks.length - 1].price : 0;
  const bestBid = bids.length > 0 ? bids[0].price : 0;
  const midPrice =
    bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : bestBid || bestAsk || 0;

  return { bids, asks, bestBid, bestAsk, midPrice };
}

export async function fetchAftermathAccountState(walletAddress: string): Promise<AfAccountState> {
  const ownedRes = await fetch(`${AF_PERPS_API}/accounts/owned`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress }),
  });
  if (!ownedRes.ok) {
    throw new Error(`Aftermath owned accounts HTTP ${ownedRes.status}`);
  }
  const ownedData = await ownedRes.json();
  const caps: any[] = ownedData?.accountCaps || [];
  if (caps.length === 0) {
    return {
      accountId: null,
      accountObjectId: null,
      totalEquityUsd: 0,
      availableCollateral: 0,
      availableCollateralUsd: 0,
      totalUnrealizedPnlUsd: 0,
      positions: [],
      positionMarketIds: [],
    };
  }

  const primaryCap =
    caps.find(
      (c) => c.collateralCoinType === AF_USDC_COIN_TYPE && parseBigIntN(c.collateral, 0n) > 0n
    ) || caps[0];

  const accountId: string = primaryCap.accountId;
  const posRes = await fetch(`${AF_PERPS_API}/accounts/positions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountIds: [accountId] }),
  });
  if (!posRes.ok) {
    return {
      accountId,
      accountObjectId: primaryCap.accountObjectId || null,
      totalEquityUsd: 0,
      availableCollateral: Number(parseBigIntN(primaryCap.collateral, 0n)) / 1e6,
      availableCollateralUsd: Number(parseBigIntN(primaryCap.collateral, 0n)) / 1e6,
      totalUnrealizedPnlUsd: 0,
      positions: [],
      positionMarketIds: [],
    };
  }
  const posData = await posRes.json();
  const acc = posData?.accounts?.[0];
  const rawPositions: any[] = acc?.positions || [];

  return {
    accountId,
    accountObjectId: primaryCap.accountObjectId || null,
    totalEquityUsd: Number(acc?.totalEquityUsd || 0),
    availableCollateral: Number(acc?.availableCollateral || 0),
    availableCollateralUsd: Number(acc?.availableCollateralUsd || 0),
    totalUnrealizedPnlUsd: Number(acc?.totalUnrealizedPnlUsd || 0),
    positionMarketIds: rawPositions.map((p) => String(p.marketId)).filter(Boolean),
    positions: rawPositions
      .filter((p) => Math.abs(Number(p.baseAssetAmount || 0)) > 0)
      .map((p) => ({
        marketId: p.marketId,
        baseAssetAmount: Number(p.baseAssetAmount || 0),
        quoteAssetNotionalAmount: Number(p.quoteAssetNotionalAmount || 0),
        collateralUsd: Number(p.collateralUsd || 0),
        leverage: Number(p.leverage || 1),
        entryPrice: Number(p.entryPrice || 0),
        liquidationPrice: Number(p.liquidationPrice || 0),
        unrealizedPnlUsd: Number(p.unrealizedPnlUsd || 0),
        unrealizedFundingsUsd: Number(p.unrealizedFundingsUsd || 0),
        freeCollateral: Number(p.freeCollateral || 0),
        freeMarginUsd: Number(p.freeMarginUsd || 0),
      })),
  };
}

async function postTxKind(
  path: string,
  body: Record<string, any>,
  sender: string,
  feeMist?: bigint,
  refSharePct = 0.25
): Promise<Transaction | string> {
  const res = await fetch(`${AF_PERPS_API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const parsed = JSON.parse(text);
      msg = typeof parsed === 'string' ? parsed : parsed?.message || parsed?.error || text;
    } catch {
      // keep raw text
    }
    throw new Error(msg || `Aftermath API ${res.status}`);
  }
  const data = JSON.parse(text);
  if (!data?.txKind) {
    throw new Error(`Aftermath API did not return txKind for ${path}`);
  }
  return txFromKindBase64(data.txKind, sender, feeMist, refSharePct);
}

export async function buildCreateAccountTx(walletAddress: string): Promise<Transaction | string> {
  return postTxKind(
    '/transactions/create-account',
    { walletAddress, collateralCoinType: AF_USDC_COIN_TYPE },
    walletAddress
  );
}

export async function buildDepositCollateralTx(
  walletAddress: string,
  accountId: string,
  amountUsdc: number
): Promise<Transaction | string> {
  const baseUnits = BigInt(Math.max(1, Math.floor(amountUsdc * 1e6)));
  return postTxKind(
    '/account/transactions/deposit-collateral',
    {
      walletAddress,
      accountId,
      collateralCoinType: AF_USDC_COIN_TYPE,
      depositAmount: `${baseUnits.toString()}n`,
    },
    walletAddress
  );
}

export async function buildWithdrawCollateralTx(
  walletAddress: string,
  accountId: string,
  amountUsdc: number
): Promise<Transaction | string> {
  const baseUnits = BigInt(Math.max(1, Math.floor(amountUsdc * 1e6)));
  return postTxKind(
    '/account/transactions/withdraw-collateral',
    {
      walletAddress,
      accountId,
      collateralCoinType: AF_USDC_COIN_TYPE,
      withdrawAmount: `${baseUnits.toString()}n`,
      recipientAddress: walletAddress,
    },
    walletAddress
  );
}

export async function buildPlaceMarketOrderTx(params: {
  walletAddress: string;
  accountId: string;
  marketId: string;
  side: 0 | 1;
  sizeContracts: number;
  lotSize: bigint;
  leverage: number;
  reduceOnly: boolean;
  collateralChange: number;
  hasPosition: boolean;
  cancelSlTp: boolean;
  slippage?: number;
  feeMist?: bigint;
  refSharePct?: number;
}): Promise<Transaction | string> {
  const lot = params.lotSize > 0n ? params.lotSize : 10000n;
  const rawSize = BigInt(Math.max(1, Math.round(params.sizeContracts * 1e9)));
  const alignedSize = (rawSize / lot) * lot || lot;

  return postTxKind(
    '/account/transactions/place-market-order',
    {
      walletAddress: params.walletAddress,
      accountId: params.accountId,
      marketId: params.marketId,
      side: params.side,
      size: `${alignedSize.toString()}n`,
      leverage: params.leverage,
      reduceOnly: params.reduceOnly,
      collateralChange: params.collateralChange,
      hasPosition: params.hasPosition,
      cancelSlTp: params.cancelSlTp,
      slippage: params.slippage ?? 0.02,
    },
    params.walletAddress,
    params.feeMist,
    params.refSharePct ?? 0.25
  );
}
