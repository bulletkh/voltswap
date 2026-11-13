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

export type AfOrderType = 0 | 1 | 2 | 3; // 0=Standard(GTC), 1=FillOrKill, 2=PostOnly, 3=IOC
export type AfTriggerPriceType = 0 | 1 | 2; // 0=Index, 1=Book, 2=Mark

export interface AfSlTpConfig {
  takeProfitPrice?: number;
  stopLossPrice?: number;
  triggerPriceType: AfTriggerPriceType;
}

export interface AfPendingOrder {
  orderId: string;
  marketId: string;
  side: 0 | 1; // 0=Bid(Long), 1=Ask(Short)
  price: number;
  currentSize: number;
  initialSize: number;
  clientOrderId?: string;
}

export interface AfAccountState {
  accountId: string | null;
  accountCapId: string | null;
  accountObjectId: string | null;
  totalEquityUsd: number;
  availableCollateral: number;
  availableCollateralUsd: number;
  totalUnrealizedPnlUsd: number;
  totalUnrealizedFundingsUsd: number;
  positions: AfPositionInfo[];
  pendingOrders: AfPendingOrder[];
  /** All marketIds with an existing on-chain Position struct (including closed 0-size slots to prevent MoveAbort 41). */
  positionMarketIds: string[];
}

export interface AfCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface AfMarketTrade {
  timestamp: number;
  txDigest: string;
  side: 0 | 1;
  sizeFilled: number;
  orderPrice: number;
}

export interface AfFundingPoint {
  timestamp: number;
  fundingRate: number;
}

export interface AfOrderHistoryEntry {
  timestamp: number;
  txDigest: string;
  eventType: string;
  marketId: string;
  side?: 0 | 1;
  size?: number;
  price?: number;
  pnl?: number;
  fees?: number;
}

export interface AfCollateralHistoryEntry {
  timestamp: number;
  txDigest: string;
  eventType: string;
  marketId?: string;
  collateralChange: number;
  collateralChangeUsd: number;
  pnlUsd?: number | null;
  fees?: number | null;
}

export interface AfStopOrderItem {
  objectId: string;
  orderState: string;
  marketId: string;
  side: 0 | 1;
  size: number;
  limitPrice?: number;
  slTp?: { takeProfitPrice?: number; stopLossPrice?: number; triggerPriceType: number };
  nonSlTp?: {
    stopIndexPrice: number;
    triggerIfGeStopIndexPrice: boolean;
    reduceOnly: boolean;
    triggerPriceType: number;
  };
}

export interface AfTwapOrderItem {
  twapOrderObjectId: string;
  orderState: string;
  marketId: string;
  side: 0 | 1;
  totalSize: number;
  processedSize: number;
  chunksAmount: number;
  executionGapMs: number;
  reduceOnly: boolean;
  createdAt?: number;
}

export const AF_TERMS_MESSAGE = 'Aftermath Terms and Conditions';

const MASK_64 = (1n << 64n) - 1n;
const ASK_THRESHOLD = 1n << 127n;

export function decodeOrderIdPrice(orderId: string | bigint, side?: 0 | 1): number {
  const id = typeof orderId === 'bigint' ? orderId : parseBigIntN(orderId, 0n);
  if (id <= 0n) return 0;
  const isAsk = side !== undefined ? side === 1 : id < ASK_THRESHOLD;
  const raw = isAsk ? id >> 64n : (id >> 64n) ^ MASK_64;
  return Number(raw) / 1e9;
}

export function alignSizeToLot(sizeContracts: number, lotSize: bigint): bigint {
  const lot = lotSize > 0n ? lotSize : 10000n;
  const raw = BigInt(Math.max(1, Math.round(sizeContracts * 1e9)));
  return (raw / lot) * lot || lot;
}

export function alignPriceToTick(priceUsd: number, tickSize: bigint): bigint {
  const tick = tickSize > 0n ? tickSize : 10000n;
  const raw = BigInt(Math.max(1, Math.round(priceUsd * 1e9)));
  return (raw / tick) * tick || tick;
}

function parseAfSize(val: unknown): number {
  if (typeof val === 'string' && val.endsWith('n')) {
    return Number(parseBigIntN(val, 0n)) / 1e9;
  }
  const n = Number(val || 0);
  return Number.isFinite(n) ? n : 0;
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
      accountCapId: null,
      accountObjectId: null,
      totalEquityUsd: 0,
      availableCollateral: 0,
      availableCollateralUsd: 0,
      totalUnrealizedPnlUsd: 0,
      totalUnrealizedFundingsUsd: 0,
      positions: [],
      pendingOrders: [],
      positionMarketIds: [],
    };
  }

  const primaryCap =
    caps.find(
      (c) => c.collateralCoinType === AF_USDC_COIN_TYPE && parseBigIntN(c.collateral, 0n) > 0n
    ) || caps[0];

  const accountId: string = primaryCap.accountId;
  const accountCapId: string | null = primaryCap.objectId || null;
  const posRes = await fetch(`${AF_PERPS_API}/accounts/positions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountIds: [accountId] }),
  });
  if (!posRes.ok) {
    return {
      accountId,
      accountCapId,
      accountObjectId: primaryCap.accountObjectId || null,
      totalEquityUsd: 0,
      availableCollateral: Number(parseBigIntN(primaryCap.collateral, 0n)) / 1e6,
      availableCollateralUsd: Number(parseBigIntN(primaryCap.collateral, 0n)) / 1e6,
      totalUnrealizedPnlUsd: 0,
      totalUnrealizedFundingsUsd: 0,
      positions: [],
      pendingOrders: [],
      positionMarketIds: [],
    };
  }
  const posData = await posRes.json();
  const acc = posData?.accounts?.[0];
  const rawPositions: any[] = acc?.positions || [];

  const pendingOrders: AfPendingOrder[] = [];
  for (const pos of rawPositions) {
    const mktId = String(pos?.marketId || '');
    const list: any[] = Array.isArray(pos?.pendingOrders) ? pos.pendingOrders : [];
    for (const po of list) {
      const orderId = String(po?.orderId || '');
      if (!orderId) continue;
      const side: 0 | 1 = Number(po?.side) === 1 ? 1 : 0;
      pendingOrders.push({
        orderId,
        marketId: mktId,
        side,
        price: decodeOrderIdPrice(orderId, side),
        currentSize: parseAfSize(po?.currentSize),
        initialSize: parseAfSize(po?.initialSize),
        clientOrderId: po?.clientOrderId ? String(po.clientOrderId) : undefined,
      });
    }
  }

  return {
    accountId,
    accountCapId,
    accountObjectId: primaryCap.accountObjectId || null,
    totalEquityUsd: Number(acc?.totalEquityUsd || 0),
    availableCollateral: Number(acc?.availableCollateral || 0),
    availableCollateralUsd: Number(acc?.availableCollateralUsd || 0),
    totalUnrealizedPnlUsd: Number(acc?.totalUnrealizedPnlUsd || 0),
    totalUnrealizedFundingsUsd: Number(acc?.totalUnrealizedFundingsUsd || 0),
    positionMarketIds: rawPositions.map((p) => String(p.marketId)).filter(Boolean),
    pendingOrders,
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

function formatSlTpPayload(slTp?: AfSlTpConfig) {
  if (!slTp) return undefined;
  const tp = slTp.takeProfitPrice && slTp.takeProfitPrice > 0 ? slTp.takeProfitPrice : undefined;
  const sl = slTp.stopLossPrice && slTp.stopLossPrice > 0 ? slTp.stopLossPrice : undefined;
  if (!tp && !sl) return undefined;
  return {
    ...(tp ? { takeProfitPrice: tp } : {}),
    ...(sl ? { stopLossPrice: sl } : {}),
    triggerPriceType: slTp.triggerPriceType ?? 2,
  };
}

/**
 * Fetches native Aftermath OHLCV candles for a perpetual market.
 */
export async function fetchAftermathCandles(
  marketId: string,
  resolution: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '12h' | '1d' = '15m',
  limitCandles = 200
): Promise<AfCandle[]> {
  const resMsMap: Record<string, number> = {
    '1m': 60_000,
    '5m': 300_000,
    '15m': 900_000,
    '30m': 1_800_000,
    '1h': 3_600_000,
    '4h': 14_400_000,
    '12h': 43_200_000,
    '1d': 86_400_000,
  };
  const stepMs = resMsMap[resolution] ?? 900_000;
  const toTimestamp = Date.now();
  const fromTimestamp = toTimestamp - stepMs * limitCandles;

  const res = await fetch(`${AF_PERPS_API}/market/candle-history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ marketId, fromTimestamp, toTimestamp, resolution }),
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  const raw: any[] = data?.candles || [];

  const dedup = new Map<number, AfCandle>();
  for (const c of raw) {
    const t = Math.floor(Number(c.timestamp || 0) / 1000);
    if (!Number.isFinite(t) || t <= 0) continue;
    dedup.set(t, {
      time: t,
      open: Number(c.open || 0),
      high: Number(c.high || 0),
      low: Number(c.low || 0),
      close: Number(c.close || 0),
      volume: Number(c.volume || 0),
    });
  }
  return Array.from(dedup.values()).sort((a, b) => a.time - b.time);
}

export async function fetchAftermathMarketTrades(
  marketId: string,
  limit = 40
): Promise<AfMarketTrade[]> {
  const res = await fetch(`${AF_PERPS_API}/market/order-history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ marketId, limit }),
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  const orders: any[] = data?.orders || [];
  return orders.map((o) => ({
    timestamp: Number(o.timestamp || 0),
    txDigest: String(o.txDigest || ''),
    side: Number(o.side) === 1 ? 1 : 0,
    sizeFilled: parseAfSize(o.sizeFilled ?? o.size),
    orderPrice: Number(o.orderPrice ?? o.price ?? 0),
  }));
}

export async function fetchAftermathFundingHistory(
  marketId: string,
  hours = 48
): Promise<AfFundingPoint[]> {
  const toTimestamp = Date.now();
  const fromTimestamp = toTimestamp - hours * 3_600_000;
  const res = await fetch(`${AF_PERPS_API}/market/funding-history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ marketId, fromTimestamp, toTimestamp, limit: 60 }),
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  const list: any[] = data?.history || data?.fundingRates || [];
  return list.map((f) => ({
    timestamp: Number(f.timestamp || 0),
    fundingRate: Number(f.fundingRate ?? f.rate ?? 0),
  }));
}

export async function fetchAftermathOrderHistory(
  accountId: string,
  limit = 30
): Promise<AfOrderHistoryEntry[]> {
  const res = await fetch(`${AF_PERPS_API}/account/order-history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId, limit }),
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  const orders: any[] = data?.orders || [];
  return orders.map((o) => ({
    timestamp: Number(o.timestamp || 0),
    txDigest: String(o.txDigest || ''),
    eventType: String(o.eventType || '').split('::').pop() || 'Order',
    marketId: String(o.marketId || ''),
    side: o.side === 0 || o.side === 1 ? o.side : undefined,
    size: o.size !== undefined ? parseAfSize(o.size) : undefined,
    price: o.price !== undefined ? Number(o.price) : undefined,
    pnl: o.pnl !== undefined ? Number(o.pnl) : undefined,
    fees: o.fees !== undefined ? Number(o.fees) : undefined,
  }));
}

export async function fetchAftermathCollateralHistory(
  accountId: string,
  limit = 30
): Promise<AfCollateralHistoryEntry[]> {
  const res = await fetch(`${AF_PERPS_API}/account/collateral-history`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId, limit }),
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  const changes: any[] = data?.collateralChanges || [];
  return changes.map((c) => ({
    timestamp: Number(c.timestamp || 0),
    txDigest: String(c.txDigest || ''),
    eventType: String(c.eventType || '').split('::').pop() || 'Collateral',
    marketId: c.marketId ? String(c.marketId) : undefined,
    collateralChange: Number(c.collateralChange || 0),
    collateralChangeUsd: Number(c.collateralChangeUsd || 0),
    pnlUsd: c.pnlUsd !== null && c.pnlUsd !== undefined ? Number(c.pnlUsd) : null,
    fees: c.fees !== null && c.fees !== undefined ? Number(c.fees) : null,
  }));
}

export async function fetchAftermathLeveragePreview(params: {
  accountId: string;
  marketId: string;
  leverage: number;
}): Promise<{ collateralChange: number; liquidationPrice?: number; error?: string }> {
  const res = await fetch(`${AF_PERPS_API}/account/previews/set-leverage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    return {
      collateralChange: 0,
      error: String(data?.error || `Leverage preview failed (${res.status})`),
    };
  }
  return {
    collateralChange: Number(data?.collateralChange || 0),
    liquidationPrice: data?.updatedPosition?.liquidationPrice
      ? Number(data.updatedPosition.liquidationPrice)
      : undefined,
  };
}

export async function fetchAftermathStopOrders(params: {
  walletAddress: string;
  accountId: string;
  accountCapId?: string | null;
  bytes: string;
  signature: string;
  marketIds?: string[];
}): Promise<AfStopOrderItem[]> {
  const res = await fetch(`${AF_PERPS_API}/account/stop-order-datas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      walletAddress: params.walletAddress,
      accountId: params.accountId,
      ...(params.accountCapId ? { accountCapId: params.accountCapId } : {}),
      bytes: params.bytes,
      signature: params.signature,
      marketIds: params.marketIds ?? [],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Stop orders HTTP ${res.status}`);
  }
  const items: any[] = data?.stopOrderDatas || [];
  return items.map((s) => ({
    objectId: String(s.objectId || ''),
    orderState: String(s.orderState || 'active'),
    marketId: String(s.marketId || ''),
    side: Number(s.side) === 1 ? 1 : 0,
    size: parseAfSize(s.size),
    limitPrice: s.limitOrder?.price ? Number(parseBigIntN(s.limitOrder.price, 0n)) / 1e9 : undefined,
    slTp: s.slTp
      ? {
          takeProfitPrice: s.slTp.takeProfitPrice ? Number(s.slTp.takeProfitPrice) : undefined,
          stopLossPrice: s.slTp.stopLossPrice ? Number(s.slTp.stopLossPrice) : undefined,
          triggerPriceType: Number(s.slTp.triggerPriceType ?? 2),
        }
      : undefined,
    nonSlTp: s.nonSlTp
      ? {
          stopIndexPrice: Number(s.nonSlTp.stopIndexPrice || 0),
          triggerIfGeStopIndexPrice: Boolean(s.nonSlTp.triggerIfGeStopIndexPrice),
          reduceOnly: Boolean(s.nonSlTp.reduceOnly),
          triggerPriceType: Number(s.nonSlTp.triggerPriceType ?? 2),
        }
      : undefined,
  }));
}

export async function fetchAftermathTwapOrders(params: {
  walletAddress: string;
  accountId: string;
  bytes: string;
  signature: string;
  marketIds?: string[];
}): Promise<AfTwapOrderItem[]> {
  const res = await fetch(`${AF_PERPS_API}/account/twap-order-datas`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      walletAddress: params.walletAddress,
      accountId: params.accountId,
      bytes: params.bytes,
      signature: params.signature,
      marketIds: params.marketIds ?? [],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `TWAP orders HTTP ${res.status}`);
  }
  const items: any[] = data?.twapOrderDatas || [];
  return items.map((t) => ({
    twapOrderObjectId: String(t.twapOrderObjectId || ''),
    orderState: String(t.orderState || 'active'),
    marketId: String(t.details?.marketId || ''),
    side: Number(t.details?.side) === 1 ? 1 : 0,
    totalSize: parseAfSize(t.details?.size),
    processedSize: parseAfSize(t.processedAmount),
    chunksAmount: Number(t.details?.chunksAmount || 0),
    executionGapMs: Number(t.details?.executionGapMs || 0),
    reduceOnly: Boolean(t.details?.reduceOnly),
    createdAt: t.orderCreationTimestampMs ? Number(t.orderCreationTimestampMs) : undefined,
  }));
}

export async function buildPlaceMarketOrderTx(params: {
  walletAddress: string;
  accountId: string;
  accountCapId?: string | null;
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
  slTp?: AfSlTpConfig;
  feeMist?: bigint;
  refSharePct?: number;
}): Promise<Transaction | string> {
  const alignedSize = alignSizeToLot(params.sizeContracts, params.lotSize);
  const slTpPayload = formatSlTpPayload(params.slTp);

  return postTxKind(
    '/account/transactions/place-market-order',
    {
      walletAddress: params.walletAddress,
      accountId: params.accountId,
      ...(params.accountCapId ? { accountCapId: params.accountCapId } : {}),
      marketId: params.marketId,
      side: params.side,
      size: `${alignedSize.toString()}n`,
      leverage: params.leverage,
      reduceOnly: params.reduceOnly,
      collateralChange: params.collateralChange,
      hasPosition: params.hasPosition,
      cancelSlTp: params.cancelSlTp,
      slippage: params.slippage ?? 0.02,
      ...(slTpPayload ? { slTp: slTpPayload } : {}),
    },
    params.walletAddress,
    params.feeMist,
    params.refSharePct ?? 0.25
  );
}

export async function buildPlaceLimitOrderTx(params: {
  walletAddress: string;
  accountId: string;
  accountCapId?: string | null;
  marketId: string;
  side: 0 | 1;
  sizeContracts: number;
  priceUsd: number;
  lotSize: bigint;
  tickSize: bigint;
  orderType: AfOrderType;
  leverage: number;
  reduceOnly: boolean;
  collateralChange: number;
  hasPosition: boolean;
  cancelSlTp: boolean;
  expiryMs?: number;
  slTp?: AfSlTpConfig;
  feeMist?: bigint;
  refSharePct?: number;
}): Promise<Transaction | string> {
  const alignedSize = alignSizeToLot(params.sizeContracts, params.lotSize);
  const alignedPrice = alignPriceToTick(params.priceUsd, params.tickSize);
  const slTpPayload = formatSlTpPayload(params.slTp);

  return postTxKind(
    '/account/transactions/place-limit-order',
    {
      walletAddress: params.walletAddress,
      accountId: params.accountId,
      ...(params.accountCapId ? { accountCapId: params.accountCapId } : {}),
      marketId: params.marketId,
      side: params.side,
      size: `${alignedSize.toString()}n`,
      price: `${alignedPrice.toString()}n`,
      orderType: params.orderType,
      collateralChange: params.collateralChange,
      hasPosition: params.hasPosition,
      cancelSlTp: params.cancelSlTp,
      reduceOnly: params.reduceOnly,
      leverage: params.leverage,
      ...(params.expiryMs ? { expiryTimestamp: `${Math.floor(params.expiryMs)}n` } : {}),
      ...(slTpPayload ? { slTp: slTpPayload } : {}),
    },
    params.walletAddress,
    params.feeMist,
    params.refSharePct ?? 0.25
  );
}

export async function buildPlaceScaleOrderTx(params: {
  walletAddress: string;
  accountId: string;
  accountCapId?: string | null;
  marketId: string;
  side: 0 | 1;
  totalSizeContracts: number;
  startPriceUsd: number;
  endPriceUsd: number;
  numberOfOrders: number;
  lotSize: bigint;
  tickSize: bigint;
  orderType: AfOrderType;
  leverage: number;
  reduceOnly: boolean;
  collateralChange: number;
  hasPosition: boolean;
  feeMist?: bigint;
  refSharePct?: number;
}): Promise<Transaction | string> {
  const alignedTotalSize = alignSizeToLot(params.totalSizeContracts, params.lotSize);
  const alignedStart = alignPriceToTick(params.startPriceUsd, params.tickSize);
  const alignedEnd = alignPriceToTick(params.endPriceUsd, params.tickSize);

  return postTxKind(
    '/account/transactions/place-scale-order',
    {
      walletAddress: params.walletAddress,
      accountId: params.accountId,
      ...(params.accountCapId ? { accountCapId: params.accountCapId } : {}),
      marketId: params.marketId,
      side: params.side,
      totalSize: `${alignedTotalSize.toString()}n`,
      startPrice: `${alignedStart.toString()}n`,
      endPrice: `${alignedEnd.toString()}n`,
      numberOfOrders: Math.min(20, Math.max(2, Math.round(params.numberOfOrders))),
      orderType: params.orderType,
      collateralChange: params.collateralChange,
      hasPosition: params.hasPosition,
      reduceOnly: params.reduceOnly,
      cancelSlTp: false,
      leverage: params.leverage,
    },
    params.walletAddress,
    params.feeMist,
    params.refSharePct ?? 0.25
  );
}

export async function buildPlaceStopOrderTx(params: {
  walletAddress: string;
  accountId: string;
  accountCapId?: string | null;
  marketId: string;
  side: 0 | 1;
  sizeContracts: number;
  lotSize: bigint;
  tickSize: bigint;
  triggerPriceUsd: number;
  triggerIfGeStopIndexPrice: boolean;
  triggerPriceType: AfTriggerPriceType;
  reduceOnly: boolean;
  limitPriceUsd?: number;
  limitOrderType?: AfOrderType;
  feeMist?: bigint;
  refSharePct?: number;
}): Promise<Transaction | string> {
  const alignedSize = alignSizeToLot(params.sizeContracts, params.lotSize);
  const limitOrder =
    params.limitPriceUsd && params.limitPriceUsd > 0
      ? {
          price: `${alignPriceToTick(params.limitPriceUsd, params.tickSize).toString()}n`,
          orderType: params.limitOrderType ?? 0,
        }
      : undefined;

  return postTxKind(
    '/account/transactions/place-stop-orders',
    {
      walletAddress: params.walletAddress,
      accountId: params.accountId,
      ...(params.accountCapId ? { accountCapId: params.accountCapId } : {}),
      stopOrders: [
        {
          marketId: params.marketId,
          side: params.side,
          size: `${alignedSize.toString()}n`,
          ...(limitOrder ? { limitOrder } : {}),
          nonSlTp: {
            stopIndexPrice: params.triggerPriceUsd,
            triggerIfGeStopIndexPrice: params.triggerIfGeStopIndexPrice,
            reduceOnly: params.reduceOnly,
            triggerPriceType: params.triggerPriceType,
          },
        },
      ],
    },
    params.walletAddress,
    params.feeMist,
    params.refSharePct ?? 0.25
  );
}

export async function buildCreateTwapOrderTx(params: {
  walletAddress: string;
  accountId: string;
  accountCapId?: string | null;
  marketId: string;
  side: 0 | 1;
  sizeContracts: number;
  lotSize: bigint;
  reduceOnly: boolean;
  chunksAmount: number;
  executionGapMs: number;
  maxSlippageBps?: number;
  feeMist?: bigint;
  refSharePct?: number;
}): Promise<Transaction | string> {
  const alignedSize = alignSizeToLot(params.sizeContracts, params.lotSize);
  const chunks = Math.min(50, Math.max(2, Math.round(params.chunksAmount)));
  return postTxKind(
    '/account/transactions/create-twap-orders',
    {
      walletAddress: params.walletAddress,
      accountId: params.accountId,
      ...(params.accountCapId ? { accountCapId: params.accountCapId } : {}),
      twapOrders: [
        {
          marketId: params.marketId,
          side: params.side,
          size: `${alignedSize.toString()}n`,
          reduceOnly: params.reduceOnly,
          chunksAmount: chunks,
          executionGapMs: Math.max(10_000, Math.round(params.executionGapMs)),
          executionTimeUncertaintyMs: 5000,
          timeForRetryMs: 15000,
          amountUncertaintyBps: 500,
          maxOneExecutionAmountBps: Math.min(10000, Math.max(100, Math.ceil(15000 / chunks))),
          smallTailMergeThresholdBps: 1000,
          maxSlippageBps: params.maxSlippageBps ?? 200,
        },
      ],
    },
    params.walletAddress,
    params.feeMist,
    params.refSharePct ?? 0.25
  );
}

export async function buildPlaceSlTpTx(params: {
  walletAddress: string;
  accountId: string;
  accountCapId?: string | null;
  marketId: string;
  positionSide: 0 | 1;
  sizeContracts?: number;
  lotSize?: bigint;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  triggerPriceType?: AfTriggerPriceType;
}): Promise<Transaction | string> {
  const alignedSize =
    params.sizeContracts && params.sizeContracts > 0
      ? `${alignSizeToLot(params.sizeContracts, params.lotSize ?? 10000n).toString()}n`
      : undefined;

  return postTxKind(
    '/account/transactions/place-sl-tp-orders',
    {
      walletAddress: params.walletAddress,
      accountId: params.accountId,
      ...(params.accountCapId ? { accountCapId: params.accountCapId } : {}),
      marketId: params.marketId,
      positionSide: params.positionSide,
      ...(alignedSize ? { size: alignedSize } : {}),
      ...(params.takeProfitPrice && params.takeProfitPrice > 0
        ? { takeProfitPrice: params.takeProfitPrice }
        : {}),
      ...(params.stopLossPrice && params.stopLossPrice > 0
        ? { stopLossPrice: params.stopLossPrice }
        : {}),
      triggerPriceType: params.triggerPriceType ?? 2,
    },
    params.walletAddress
  );
}

export async function buildCancelOrdersTx(params: {
  walletAddress: string;
  accountId: string;
  accountCapId?: string | null;
  marketId: string;
  orderIds: string[];
}): Promise<Transaction | string> {
  const normalizedIds = params.orderIds.map((id) => (id.endsWith('n') ? id : `${id}n`));
  return postTxKind(
    '/account/transactions/cancel-orders',
    {
      walletAddress: params.walletAddress,
      accountId: params.accountId,
      ...(params.accountCapId ? { accountCapId: params.accountCapId } : {}),
      marketIdsToData: {
        [params.marketId]: {
          orderIds: normalizedIds,
          collateralChange: 0,
        },
      },
    },
    params.walletAddress
  );
}

export async function buildCancelStopOrdersTx(params: {
  walletAddress: string;
  accountId: string;
  accountCapId?: string | null;
  stopOrderIds: string[];
}): Promise<Transaction | string> {
  return postTxKind(
    '/account/transactions/cancel-stop-orders',
    {
      walletAddress: params.walletAddress,
      accountId: params.accountId,
      ...(params.accountCapId ? { accountCapId: params.accountCapId } : {}),
      stopOrderIds: params.stopOrderIds,
    },
    params.walletAddress
  );
}

export async function buildCancelTwapOrdersTx(params: {
  walletAddress: string;
  accountId: string;
  accountCapId?: string | null;
  twapOrderIds: string[];
}): Promise<Transaction | string> {
  return postTxKind(
    '/account/transactions/cancel-twap-orders',
    {
      walletAddress: params.walletAddress,
      accountId: params.accountId,
      ...(params.accountCapId ? { accountCapId: params.accountCapId } : {}),
      twapOrderIds: params.twapOrderIds,
    },
    params.walletAddress
  );
}

export async function buildSetLeverageTx(params: {
  walletAddress: string;
  accountId: string;
  accountCapId?: string | null;
  marketId: string;
  leverage: number;
  collateralChange: number;
}): Promise<Transaction | string> {
  return postTxKind(
    '/account/transactions/set-leverage',
    {
      walletAddress: params.walletAddress,
      accountId: params.accountId,
      ...(params.accountCapId ? { accountCapId: params.accountCapId } : {}),
      marketId: params.marketId,
      leverage: params.leverage,
      collateralChange: params.collateralChange,
    },
    params.walletAddress
  );
}

export async function buildAllocateCollateralTx(params: {
  walletAddress: string;
  accountId: string;
  accountCapId?: string | null;
  marketId: string;
  amountUsdc: number;
}): Promise<Transaction | string> {
  const baseUnits = BigInt(Math.max(1, Math.floor(params.amountUsdc * 1e6)));
  return postTxKind(
    '/account/transactions/allocate-collateral',
    {
      walletAddress: params.walletAddress,
      accountId: params.accountId,
      ...(params.accountCapId ? { accountCapId: params.accountCapId } : {}),
      marketId: params.marketId,
      allocateAmount: `${baseUnits.toString()}n`,
    },
    params.walletAddress
  );
}

export async function buildDeallocateCollateralTx(params: {
  walletAddress: string;
  accountId: string;
  accountCapId?: string | null;
  marketId: string;
  amountUsdc: number;
}): Promise<Transaction | string> {
  const baseUnits = BigInt(Math.max(1, Math.floor(params.amountUsdc * 1e6)));
  return postTxKind(
    '/account/transactions/deallocate-collateral',
    {
      walletAddress: params.walletAddress,
      accountId: params.accountId,
      ...(params.accountCapId ? { accountCapId: params.accountCapId } : {}),
      marketId: params.marketId,
      deallocateAmount: `${baseUnits.toString()}n`,
    },
    params.walletAddress
  );
}
