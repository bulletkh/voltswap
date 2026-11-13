import {
  deepbook,
  mainnetCoins,
  mainnetPackageIds,
  mainnetPools,
  OrderType,
  SelfMatchingOptions,
} from '@mysten/deepbook-v3';
import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { VOLT_TREASURY_ADDRESS } from './constants';
import { suiGrpcClient, safeNormalizeCoinType, SUI_COIN_TYPE } from './suiClient';
import { appendVoltFeeCoinSplit, addCoinFeeToTx } from './voltFee';

export const DEEPBOOK_INDEXER = 'https://deepbook-indexer.mainnet.mystenlabs.com';
export const DEEPBOOK_PACKAGE_ID = mainnetPackageIds.DEEPBOOK_PACKAGE_ID;
export const DEEPBOOK_REGISTRY_ID = mainnetPackageIds.REGISTRY_ID;
export const DEEPBOOK_DEEP_COIN_TYPE = mainnetCoins.DEEP.type;
const SUI_GRAPHQL_URL = 'https://graphql.mainnet.sui.io/graphql';

export interface DeepBookPoolMeta {
  poolId: string;
  poolName: string;
  baseSymbol: string;
  quoteSymbol: string;
  baseCoinId: string;
  quoteCoinId: string;
  baseDecimals: number;
  quoteDecimals: number;
  tickSize: number;
  lotSize: number;
  minSize: number;
  lastPrice?: number;
  change24hPct?: number;
  volume24hUsd?: number;
  baseVolume24h?: number;
  high24h?: number;
  low24h?: number;
}

export interface DeepBookLevel {
  price: number;
  size: number;
  totalSize: number;
}

export interface DeepBookOrderbook {
  bids: DeepBookLevel[];
  asks: DeepBookLevel[];
  midPrice: number;
  spreadPct: number;
}

export interface DeepBookCandle {
  time: number; // unix seconds for lightweight-charts
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DeepBookTrade {
  tradeId: string;
  price: number;
  baseVolume: number;
  quoteVolume: number;
  type: 'buy' | 'sell';
  timestamp: number;
}

export interface DeepBookOpenOrder {
  managerId?: string;
  orderId: string;
  clientOrderId: string;
  isBid: boolean;
  price: number;
  quantity: number;
  filledQuantity: number;
  expireTimestamp: number;
  status: number;
}

export interface DeepBookManagerState {
  managerId: string;
  baseBalance: number;
  quoteBalance: number;
  deepBalance: number;
  settledBase: number;
  settledQuote: number;
  referralId?: string | null;
  openOrders: DeepBookOpenOrder[];
}

export interface VoltSpotReferral {
  poolKey: string;
  poolId: string;
  referralId: string;
  owner: string;
}

export const DEFAULT_DEEPBOOK_POOLS: DeepBookPoolMeta[] = [
  {
    poolId: '0xe05dafb5133bcffb8d59f4e12465dc0e9faeaa05e3e342a08fe135800e3e4407',
    poolName: 'SUI_USDC',
    baseSymbol: 'SUI',
    quoteSymbol: 'USDC',
    baseCoinId: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
    quoteCoinId: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    baseDecimals: 9,
    quoteDecimals: 6,
    tickSize: 0.0001,
    lotSize: 0.1,
    minSize: 1,
  },
  {
    poolId: '0xb663828d6217467c8a1838a03793da896cbe745b150ebd57d82f814ca579fc22',
    poolName: 'DEEP_SUI',
    baseSymbol: 'DEEP',
    quoteSymbol: 'SUI',
    baseCoinId: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
    quoteCoinId: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
    baseDecimals: 6,
    quoteDecimals: 9,
    tickSize: 0.0001,
    lotSize: 1,
    minSize: 10,
  },
  {
    poolId: '0xf948981b806057580f91622417534f491da5f61aeaf33d0ed8e69fd5691c95ce',
    poolName: 'DEEP_USDC',
    baseSymbol: 'DEEP',
    quoteSymbol: 'USDC',
    baseCoinId: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
    quoteCoinId: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    baseDecimals: 6,
    quoteDecimals: 6,
    tickSize: 0.00001,
    lotSize: 1,
    minSize: 10,
  },
  {
    poolId: '0x56a1c985c1f1123181d6b881714793689321ba24301b3585eec427436eb1c76d',
    poolName: 'WAL_USDC',
    baseSymbol: 'WAL',
    quoteSymbol: 'USDC',
    baseCoinId: '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL',
    quoteCoinId: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    baseDecimals: 9,
    quoteDecimals: 6,
    tickSize: 0.0001,
    lotSize: 1,
    minSize: 1,
  },
  {
    poolId: '0x0c0fdd4008740d81a8a7d4281322aee71a1b62c449eb5b142656753d89ebc060',
    poolName: 'NS_USDC',
    baseSymbol: 'NS',
    quoteSymbol: 'USDC',
    baseCoinId: '0x5145494a5f5100e645e4b0aa950fa6b68f614e8c59e17bc5ded3495123a79178::ns::NS',
    quoteCoinId: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    baseDecimals: 6,
    quoteDecimals: 6,
    tickSize: 0.0001,
    lotSize: 1,
    minSize: 1,
  },
  {
    poolId: '0x1fe7b99c28ded39774f37327b509d58e2be7fff94899c06d22b407496a6fa990',
    poolName: 'SEND_USDC',
    baseSymbol: 'SEND',
    quoteSymbol: 'USDC',
    baseCoinId: '0xb45fcfcc2cc07ce0702cc2d229621e046c906ef14d9b25e8e4d25f6e8763fef7::send::SEND',
    quoteCoinId: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    baseDecimals: 6,
    quoteDecimals: 6,
    tickSize: 0.0001,
    lotSize: 1,
    minSize: 1,
  },
  {
    poolId: '0x20b9a3ec7a02d4f344aa1ebc5774b7b0ccafa9a5d76230662fdc0300bb215307',
    poolName: 'XBTC_USDC',
    baseSymbol: 'XBTC',
    quoteSymbol: 'USDC',
    baseCoinId: '0x876a4b7bce8aeaef60464c11f4026903e9afacab79b9b142686158aa86560b50::xbtc::XBTC',
    quoteCoinId: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    baseDecimals: 8,
    quoteDecimals: 6,
    tickSize: 1,
    lotSize: 0.00001,
    minSize: 0.0001,
  },
  {
    poolId: '0x1109352b9112717bd2a7c3eb9a416fff1ba6951760f5bdd5424cf5e4e5b3e65c',
    poolName: 'BWETH_USDC',
    baseSymbol: 'BWETH',
    quoteSymbol: 'USDC',
    baseCoinId: '0xd0e89b2af5e4910726fbcd8b8dd37bb79b29e5f83f7491bca830e94f7f226d29::eth::ETH',
    quoteCoinId: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    baseDecimals: 8,
    quoteDecimals: 6,
    tickSize: 0.1,
    lotSize: 0.001,
    minSize: 0.01,
  },
  {
    poolId: '0x0fac1cebf35bde899cd9ecdd4371e0e33f44ba83b8a2902d69186646afa3a94b',
    poolName: 'SUIUSDE_USDC',
    baseSymbol: 'SUIUSDE',
    quoteSymbol: 'USDC',
    baseCoinId: '0x41d587e5336f1c86cad50d38a7136db99333bb9bda91cea4ba69115defeb1402::sui_usde::SUI_USDE',
    quoteCoinId: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    baseDecimals: 6,
    quoteDecimals: 6,
    tickSize: 0.0001,
    lotSize: 0.1,
    minSize: 1,
  },
  {
    poolId: '0x034f3a42e7348de2084406db7a725f9d9d132a56c68324713e6e623601fb4fd7',
    poolName: 'SUI_SUIUSDE',
    baseSymbol: 'SUI',
    quoteSymbol: 'SUIUSDE',
    baseCoinId: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
    quoteCoinId: '0x41d587e5336f1c86cad50d38a7136db99333bb9bda91cea4ba69115defeb1402::sui_usde::SUI_USDE',
    baseDecimals: 9,
    quoteDecimals: 6,
    tickSize: 0.0001,
    lotSize: 0.1,
    minSize: 1,
  },
];

const FEATURED_POOL_ORDER = [
  'SUI_USDC',
  'DEEP_USDC',
  'WAL_USDC',
  'XBTC_USDC',
  'BWETH_USDC',
  'DEEP_SUI',
  'SUIUSDE_USDC',
  'SUI_SUIUSDE',
  'NS_USDC',
  'SEND_USDC',
];

const USD_QUOTES = new Set(['USDC', 'USDT', 'WUSDC', 'WUSDT', 'SUIUSDE', 'USDSUI', 'AUSD']);

type SdkCoinEntry = {
  address: string;
  type: string;
  scalar: number;
  feed?: string;
  currencyId?: string;
  priceInfoObjectId?: string;
};

type SdkPoolEntry = {
  address: string;
  baseCoin: string;
  quoteCoin: string;
};

const dynamicCoins: Record<string, SdkCoinEntry> = {
  ...(mainnetCoins as unknown as Record<string, SdkCoinEntry>),
};

const dynamicPools: Record<string, SdkPoolEntry> = {
  ...(mainnetPools as unknown as Record<string, SdkPoolEntry>),
};

function registerPoolsInSdkCache(pools: DeepBookPoolMeta[]) {
  for (const p of pools) {
    if (!dynamicCoins[p.baseSymbol] && p.baseCoinId) {
      dynamicCoins[p.baseSymbol] = {
        address: p.baseCoinId.split('::')[0] || p.baseCoinId,
        type: safeNormalizeCoinType(p.baseCoinId),
        scalar: Math.pow(10, p.baseDecimals),
      };
    }
    if (!dynamicCoins[p.quoteSymbol] && p.quoteCoinId) {
      dynamicCoins[p.quoteSymbol] = {
        address: p.quoteCoinId.split('::')[0] || p.quoteCoinId,
        type: safeNormalizeCoinType(p.quoteCoinId),
        scalar: Math.pow(10, p.quoteDecimals),
      };
    }
    if (!dynamicPools[p.poolName] && p.poolId) {
      dynamicPools[p.poolName] = {
        address: p.poolId,
        baseCoin: p.baseSymbol,
        quoteCoin: p.quoteSymbol,
      };
    }
  }
}

registerPoolsInSdkCache(DEFAULT_DEEPBOOK_POOLS);

export async function fetchDeepBookPools(): Promise<DeepBookPoolMeta[]> {
  try {
    const [poolsRes, summaryRes] = await Promise.all([
      fetch(`${DEEPBOOK_INDEXER}/get_pools`),
      fetch(`${DEEPBOOK_INDEXER}/summary`).catch(() => null),
    ]);
    if (!poolsRes.ok) return DEFAULT_DEEPBOOK_POOLS;
    const raw: any[] = await poolsRes.json();

    const summaryByPair = new Map<string, any>();
    let suiUsdRef = 0;
    if (summaryRes && summaryRes.ok) {
      try {
        const sumRows: any[] = await summaryRes.json();
        for (const row of Array.isArray(sumRows) ? sumRows : []) {
          const key = String(row?.trading_pairs || '');
          if (key) summaryByPair.set(key, row);
          if (key === 'SUI_USDC' && Number(row?.last_price) > 0) {
            suiUsdRef = Number(row.last_price);
          }
        }
      } catch {
        // Ignore malformed /summary payload; /get_pools still works
      }
    }

    const mapped: DeepBookPoolMeta[] = (Array.isArray(raw) ? raw : [])
      .filter((p) => p?.pool_id && p?.pool_name && p?.base_asset_symbol && p?.quote_asset_symbol)
      .map((p) => {
        const baseDecimals = Number(p.base_asset_decimals || 9);
        const quoteDecimals = Number(p.quote_asset_decimals || 6);
        const baseScale = Math.pow(10, baseDecimals);
        const rawTick = Number(p.tick_size || 100000);
        const humanTick = (rawTick / 1e9) * Math.pow(10, baseDecimals - quoteDecimals);
        const poolName = String(p.pool_name);
        const quoteSymbol = String(p.quote_asset_symbol);
        const s = summaryByPair.get(poolName);
        const lastPrice = s && Number(s.last_price) > 0 ? Number(s.last_price) : undefined;
        const change24hPct =
          s && s.price_change_percent_24h !== undefined && s.price_change_percent_24h !== null
            ? Number(s.price_change_percent_24h)
            : undefined;
        const rawQuoteVol = s ? Number(s.quote_volume || 0) : 0;
        const baseVolume24h = s && Number(s.base_volume) >= 0 ? Number(s.base_volume) : undefined;
        const volume24hUsd =
          rawQuoteVol > 0
            ? USD_QUOTES.has(quoteSymbol.toUpperCase())
              ? rawQuoteVol
              : quoteSymbol.toUpperCase() === 'SUI' && suiUsdRef > 0
                ? rawQuoteVol * suiUsdRef
                : rawQuoteVol
            : undefined;
        const high24h = s && Number(s.highest_price_24h) > 0 ? Number(s.highest_price_24h) : undefined;
        const low24h = s && Number(s.lowest_price_24h) > 0 ? Number(s.lowest_price_24h) : undefined;

        return {
          poolId: String(p.pool_id),
          poolName,
          baseSymbol: String(p.base_asset_symbol),
          quoteSymbol,
          baseCoinId: String(p.base_asset_id),
          quoteCoinId: String(p.quote_asset_id),
          baseDecimals,
          quoteDecimals,
          tickSize: Number(humanTick.toPrecision(4)) || 0.0001,
          lotSize: Number(p.lot_size || 1e8) / baseScale,
          minSize: Number(p.min_size || 1e9) / baseScale,
          lastPrice,
          change24hPct: Number.isFinite(change24hPct as number) ? change24hPct : undefined,
          volume24hUsd,
          baseVolume24h,
          high24h,
          low24h,
        };
      });

    mapped.sort((a, b) => {
      const ia = FEATURED_POOL_ORDER.indexOf(a.poolName);
      const ib = FEATURED_POOL_ORDER.indexOf(b.poolName);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return (b.volume24hUsd || 0) - (a.volume24hUsd || 0);
    });

    if (mapped.length > 0) {
      registerPoolsInSdkCache(mapped);
      return mapped;
    }
    return DEFAULT_DEEPBOOK_POOLS;
  } catch {
    return DEFAULT_DEEPBOOK_POOLS;
  }
}

export async function fetchDeepBookOrderbook(
  poolName: string,
  depth = 12
): Promise<DeepBookOrderbook> {
  const res = await fetch(`${DEEPBOOK_INDEXER}/orderbook/${poolName}?level=2&depth=${depth}`);
  if (!res.ok) throw new Error(`DeepBook orderbook HTTP ${res.status}`);
  const data = await res.json();

  const toLevels = (rows: any[], reverse = false): DeepBookLevel[] => {
    const clean = (Array.isArray(rows) ? rows : [])
      .map((r) => ({ price: Number(r[0]), size: Number(r[1]) }))
      .filter((r) => r.price > 0 && r.size > 0);
    let total = 0;
    const mapped = clean.map((r) => {
      total += r.size;
      return { ...r, totalSize: total };
    });
    return reverse ? mapped.reverse() : mapped;
  };

  const asks = toLevels(data.asks, true);
  const bids = toLevels(data.bids, false);
  const bestAsk = asks.length > 0 ? asks[asks.length - 1].price : 0;
  const bestBid = bids.length > 0 ? bids[0].price : 0;
  const midPrice = bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : bestBid || bestAsk || 0;
  const spreadPct = midPrice > 0 && bestAsk > bestBid ? ((bestAsk - bestBid) / midPrice) * 100 : 0;

  return { bids, asks, midPrice, spreadPct };
}

export async function fetchDeepBookCandles(
  poolName: string,
  interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' = '15m',
  limit = 120
): Promise<DeepBookCandle[]> {
  // Note: DeepBook v3 indexer endpoint is spelled /ohclv/
  const res = await fetch(`${DEEPBOOK_INDEXER}/ohclv/${poolName}?interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error(`DeepBook candles HTTP ${res.status}`);
  const data = await res.json();
  const raw: any[] = data?.candles || [];
  const candles = raw
    .map((c) => ({
      time: Math.floor(Number(c[0]) / 1000),
      open: Number(c[1]),
      high: Number(c[2]),
      low: Number(c[3]),
      close: Number(c[4]),
      volume: Number(c[5]),
    }))
    .filter((c) => Number.isFinite(c.time) && c.close > 0)
    .sort((a, b) => a.time - b.time);

  // Deduplicate ascending timestamps required by lightweight-charts
  const deduped: DeepBookCandle[] = [];
  for (const c of candles) {
    if (deduped.length === 0 || c.time > deduped[deduped.length - 1].time) {
      deduped.push(c);
    } else {
      deduped[deduped.length - 1] = c;
    }
  }
  return deduped;
}

export async function fetchDeepBookTrades(
  poolName: string,
  limit = 20
): Promise<DeepBookTrade[]> {
  const res = await fetch(`${DEEPBOOK_INDEXER}/trades/${poolName}?limit=${limit}`);
  if (!res.ok) return [];
  const raw: any[] = await res.json();
  return (Array.isArray(raw) ? raw : []).map((t) => ({
    tradeId: String(t.trade_id || `${t.timestamp}_${t.price}`),
    price: Number(t.price || 0),
    baseVolume: Number(t.base_volume || 0),
    quoteVolume: Number(t.quote_volume || 0),
    type: t.type === 'sell' ? 'sell' : 'buy',
    timestamp: Number(t.timestamp || 0),
  }));
}

export function createDeepBookClient(owner: string, managerId?: string) {
  return suiGrpcClient.$extend(
    deepbook({
      address: owner,
      coins: dynamicCoins,
      pools: dynamicPools,
      balanceManagers: managerId ? { MAIN: { address: managerId } } : undefined,
    })
  );
}

/**
 * Discovers ALL DeepBook v3 BalanceManager IDs owned by `owner`:
 * merges official DeepBook Registry IDs with any unregistered BalanceManager objects
 * created by past 1-tx flows via Sui GraphQL object history.
 */
export async function discoverBalanceManagers(owner: string): Promise<string[]> {
  const normOwner = normalizeSuiAddress(owner).toLowerCase();
  const extended = createDeepBookClient(owner);

  const [registryIds, gqlIds] = await Promise.all([
    extended.deepbook.getBalanceManagerIds(owner).catch(() => [] as string[]),
    (async () => {
      try {
        const query = `query($addr: SuiAddress!) {
          transactions(filter: { sentAddress: $addr }, last: 50) {
            nodes {
              effects {
                objectChanges {
                  nodes {
                    address
                    outputState {
                      asMoveObject {
                        contents { type { repr } json }
                      }
                    }
                  }
                }
              }
            }
          }
        }`;
        const res = await fetch(SUI_GRAPHQL_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, variables: { addr: owner } }),
        });
        if (!res.ok) return [] as string[];
        const payload = await res.json();
        const found: string[] = [];
        for (const txNode of payload?.data?.transactions?.nodes || []) {
          for (const ch of txNode?.effects?.objectChanges?.nodes || []) {
            const contents = ch?.outputState?.asMoveObject?.contents;
            const repr = String(contents?.type?.repr || '');
            const mgrOwner = String(contents?.json?.owner || '');
            if (
              repr.includes('::balance_manager::BalanceManager') &&
              mgrOwner &&
              normalizeSuiAddress(mgrOwner).toLowerCase() === normOwner
            ) {
              found.push(normalizeSuiAddress(String(ch.address)));
            }
          }
        }
        return found;
      } catch {
        return [] as string[];
      }
    })(),
  ]);

  const seen = new Set<string>();
  const merged: string[] = [];
  for (const rawId of [...registryIds, ...gqlIds]) {
    if (!rawId) continue;
    const norm = normalizeSuiAddress(rawId);
    if (!seen.has(norm)) {
      seen.add(norm);
      merged.push(norm);
    }
  }
  return merged;
}

export async function fetchDeepBookManagerState(
  owner: string,
  managerId: string,
  pool: DeepBookPoolMeta
): Promise<DeepBookManagerState> {
  const ext = createDeepBookClient(owner, managerId);
  const db = ext.deepbook;

  const [baseBal, quoteBal, deepBal, details, accountInfo, referralId] = await Promise.all([
    db.checkManagerBalanceWithAddress(managerId, pool.baseSymbol).catch(() => ({ balance: 0 })),
    db.checkManagerBalanceWithAddress(managerId, pool.quoteSymbol).catch(() => ({ balance: 0 })),
    db.checkManagerBalanceWithAddress(managerId, 'DEEP').catch(() => ({ balance: 0 })),
    db.getAccountOrderDetails(pool.poolName, 'MAIN').catch(() => []),
    db.account(pool.poolName, 'MAIN').catch(() => null),
    db.getBalanceManagerReferralId('MAIN', pool.poolName).catch(() => null),
  ]);

  const baseScale = Math.pow(10, pool.baseDecimals);
  const quoteScale = Math.pow(10, pool.quoteDecimals);

  const openOrders: DeepBookOpenOrder[] = await Promise.all(
    (Array.isArray(details) ? details : []).map(async (ord) => {
      const norm = await db.getOrderNormalized(pool.poolName, ord.order_id).catch(() => null);
      const rawQty = Number(ord.quantity || 0);
      const rawFilled = Number(ord.filled_quantity || 0);
      return {
        managerId,
        orderId: String(ord.order_id),
        clientOrderId: String(ord.client_order_id),
        isBid: Boolean(norm?.isBid ?? BigInt(ord.order_id) >> 127n === 0n),
        price: Number(norm?.normalized_price || 0),
        quantity: norm ? Number(norm.quantity) : rawQty / baseScale,
        filledQuantity: norm ? Number(norm.filled_quantity) : rawFilled / baseScale,
        expireTimestamp: Number(ord.expire_timestamp || 0),
        status: Number(ord.status || 0),
      };
    })
  );

  const settledBase = accountInfo
    ? Number(accountInfo.settled_balances?.base || 0) / baseScale
    : 0;
  const settledQuote = accountInfo
    ? Number(accountInfo.settled_balances?.quote || 0) / quoteScale
    : 0;

  return {
    managerId,
    baseBalance: Number(baseBal?.balance || 0),
    quoteBalance: Number(quoteBal?.balance || 0),
    deepBalance: Number(deepBal?.balance || 0),
    settledBase,
    settledQuote,
    referralId: referralId || null,
    openOrders,
  };
}

const SPOT_REFERRAL_CACHE_KEY = 'volt_deepbook_spot_referrals_v1';
let spotReferralCache: Record<string, VoltSpotReferral> | null = null;

function readCachedSpotReferrals(): Record<string, VoltSpotReferral> {
  if (spotReferralCache) return spotReferralCache;
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(SPOT_REFERRAL_CACHE_KEY);
      if (raw) {
        spotReferralCache = JSON.parse(raw);
        if (spotReferralCache) return spotReferralCache;
      }
    } catch {
      // ignore storage errors
    }
  }
  return {};
}

function writeCachedSpotReferrals(map: Record<string, VoltSpotReferral>) {
  spotReferralCache = map;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(SPOT_REFERRAL_CACHE_KEY, JSON.stringify(map));
    } catch {
      // ignore storage errors
    }
  }
}

/**
 * Discovers DeepBook v3 Spot PoolReferral shared objects minted by Volt Treasury.
 */
export async function fetchVoltSpotReferrals(
  owner: string = VOLT_TREASURY_ADDRESS
): Promise<Record<string, VoltSpotReferral>> {
  const cached = readCachedSpotReferrals();
  try {
    const normOwner = owner.toLowerCase();
    const eventType =
      '0x00c1a56ec8c4c623a848b2ed2f03d23a25d17570b670c22106f336eb933785cc::balance_manager::DeepBookReferralCreatedEvent';
    const res = await fetch(SUI_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{
          events(filter: { sender: "${owner}", type: "${eventType}" }, last: 50) {
            nodes { contents { json } }
          }
        }`,
      }),
    });
    if (!res.ok) return cached;
    const json = await res.json().catch(() => null);
    const nodes: any[] = json?.data?.events?.nodes || [];

    const poolIdToKey = new Map<string, string>();
    for (const [key, info] of Object.entries(mainnetPools as Record<string, { address: string }>)) {
      if (info?.address) poolIdToKey.set(info.address.toLowerCase(), key);
    }

    const dbClient = createDeepBookClient(owner);
    const next: Record<string, VoltSpotReferral> = { ...cached };
    for (const n of nodes) {
      const ev = n?.contents?.json;
      if (!ev || String(ev.owner || '').toLowerCase() !== normOwner) continue;
      const refId = String(ev.referral_id || '');
      if (!refId) continue;
      const poolId = await dbClient.deepbook
        .balanceManagerReferralPoolId(refId)
        .catch(() => null);
      if (!poolId) continue;
      const poolKey = poolIdToKey.get(poolId.toLowerCase());
      if (poolKey) {
        next[poolKey] = { poolKey, poolId, referralId: refId, owner: String(ev.owner) };
      }
    }
    writeCachedSpotReferrals(next);
    return next;
  } catch {
    return cached;
  }
}

/**
 * Mints DeepBook v3 native Spot PoolReferral objects for one or more pools.
 * Note: DeepBook v3 enforces multiplier multiples of 0.1 (e.g. 0.5, 1.0).
 */
export function buildMintSpotReferralsTx(params: {
  sender: string;
  poolKeys: string[];
  multiplier?: number;
}): Transaction {
  const { sender, poolKeys, multiplier = 0.5 } = params;
  const snappedMult = Math.min(1, Math.max(0.1, Math.round(multiplier * 10) / 10));
  const tx = new Transaction();
  tx.setSender(sender);
  const ext = createDeepBookClient(sender);
  for (const poolKey of poolKeys) {
    tx.add(ext.deepbook.deepBook.mintReferral(poolKey, snappedMult));
  }
  return tx;
}

/**
 * Claims accrued native Spot PoolReferral rewards (base/quote/DEEP) to creator wallet.
 */
export function buildClaimSpotReferralRewardsTx(params: {
  sender: string;
  referrals: Array<{ poolKey: string; referralId: string }>;
}): Transaction {
  const { sender, referrals } = params;
  const tx = new Transaction();
  tx.setSender(sender);
  const ext = createDeepBookClient(sender);
  const coinsToSend: any[] = [];
  for (const r of referrals) {
    const { baseRewards, quoteRewards, deepRewards } = ext.deepbook.deepBook.claimPoolReferralRewards(
      r.poolKey,
      r.referralId
    )(tx);
    coinsToSend.push(baseRewards, quoteRewards, deepRewards);
  }
  if (coinsToSend.length > 0) {
    tx.transferObjects(coinsToSend, sender);
  }
  return tx;
}

function attachSpotReferralInTx(
  tx: Transaction,
  managerArg: any,
  spotReferralId: string | null | undefined,
  owner: string
) {
  if (!spotReferralId || !spotReferralId.startsWith('0x')) return;
  const tradeCap = tx.moveCall({
    target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::mint_trade_cap`,
    arguments: [managerArg],
  });
  tx.moveCall({
    target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::set_balance_manager_referral`,
    arguments: [managerArg, tx.object(spotReferralId), tradeCap],
  });
  tx.transferObjects([tradeCap], owner);
}

export async function fetchAllDeepBookManagerStates(
  owner: string,
  managerIds: string[],
  pool: DeepBookPoolMeta
): Promise<DeepBookManagerState[]> {
  if (!managerIds.length) return [];
  return Promise.all(managerIds.map((id) => fetchDeepBookManagerState(owner, id, pool)));
}

export function buildDepositManagerTx(params: {
  owner: string;
  managerId: string;
  coinKey: string;
  amount: number;
}): Transaction {
  const ext = createDeepBookClient(params.owner, params.managerId);
  const tx = new Transaction();
  tx.setSender(params.owner);
  tx.add(ext.deepbook.balanceManager.depositIntoManager('MAIN', params.coinKey, params.amount));
  return tx;
}

/**
 * Atomic 1-TX BalanceManager creation + Coin deposit + Referral registration + Share
 * for first-time Spot CLOB users who don't own a BalanceManager yet.
 */
export function buildCreateAndDepositManagerTx(params: {
  owner: string;
  coinType: string;
  decimals: number;
  amount: number;
  spotReferralId?: string | null;
}): Transaction {
  const tx = new Transaction();
  tx.setSender(params.owner);
  const ext = createDeepBookClient(params.owner);
  const manager = tx.add(ext.deepbook.balanceManager.createBalanceManagerWithOwner(params.owner));

  const depositUnits = BigInt(Math.max(1, Math.round(params.amount * Math.pow(10, params.decimals))));
  const depositCoin = coinWithBalance({
    type: params.coinType,
    balance: depositUnits,
  })(tx);

  tx.moveCall({
    package: DEEPBOOK_PACKAGE_ID,
    module: 'balance_manager',
    function: 'deposit',
    arguments: [manager, depositCoin],
    typeArguments: [params.coinType],
  });

  tx.moveCall({
    target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::register_balance_manager`,
    arguments: [manager, tx.object(DEEPBOOK_REGISTRY_ID)],
  });

  attachSpotReferralInTx(tx, manager, params.spotReferralId, params.owner);
  tx.add(ext.deepbook.balanceManager.shareBalanceManager(manager));
  return tx;
}

export function buildWithdrawAllManagersAndCancelTx(params: {
  owner: string;
  pool: DeepBookPoolMeta;
  managers: Array<{ managerId: string; openOrderIds: string[] }>;
  extraCoinTypes?: string[];
}): Transaction {
  const tx = new Transaction();
  tx.setSender(params.owner);
  const coinsToReturn: any[] = [];
  const baseNorm = safeNormalizeCoinType(params.pool.baseCoinId).toLowerCase();
  const quoteNorm = safeNormalizeCoinType(params.pool.quoteCoinId).toLowerCase();
  const extraTypes = Array.from(
    new Set(
      (params.extraCoinTypes || []).filter((t) => {
        const n = safeNormalizeCoinType(t).toLowerCase();
        return Boolean(n) && n !== baseNorm && n !== quoteNorm;
      })
    )
  );

  for (const item of params.managers) {
    const mgr = tx.object(item.managerId);
    const proof = tx.moveCall({
      target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::generate_proof_as_owner`,
      arguments: [mgr],
    });
    for (const orderId of item.openOrderIds) {
      tx.moveCall({
        target: `${DEEPBOOK_PACKAGE_ID}::pool::cancel_order`,
        arguments: [
          tx.object(params.pool.poolId),
          mgr,
          proof,
          tx.pure.u128(BigInt(orderId)),
          tx.object('0x6'),
        ],
        typeArguments: [params.pool.baseCoinId, params.pool.quoteCoinId],
      });
    }
    tx.moveCall({
      target: `${DEEPBOOK_PACKAGE_ID}::pool::withdraw_settled_amounts`,
      arguments: [tx.object(params.pool.poolId), mgr, proof],
      typeArguments: [params.pool.baseCoinId, params.pool.quoteCoinId],
    });
    const outBase = tx.moveCall({
      target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::withdraw_all`,
      arguments: [mgr],
      typeArguments: [params.pool.baseCoinId],
    });
    const outQuote = tx.moveCall({
      target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::withdraw_all`,
      arguments: [mgr],
      typeArguments: [params.pool.quoteCoinId],
    });
    coinsToReturn.push(outBase, outQuote);
    for (const coinType of extraTypes) {
      const outExtra = tx.moveCall({
        target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::withdraw_all`,
        arguments: [mgr],
        typeArguments: [coinType],
      });
      coinsToReturn.push(outExtra);
    }
  }

  if (coinsToReturn.length > 0) {
    tx.transferObjects(coinsToReturn, params.owner);
  }
  return tx;
}

export function buildWithdrawAllManagerTx(params: {
  owner: string;
  managerId: string;
  poolName: string;
  coinKeys: string[];
}): Transaction {
  const ext = createDeepBookClient(params.owner, params.managerId);
  const tx = new Transaction();
  tx.setSender(params.owner);
  tx.add(ext.deepbook.deepBook.withdrawSettledAmounts(params.poolName, 'MAIN'));
  for (const key of params.coinKeys) {
    tx.add(ext.deepbook.balanceManager.withdrawAllFromManager('MAIN', key, params.owner));
  }
  return tx;
}

export function buildCancelDeepBookOrderTx(params: {
  owner: string;
  managerId: string;
  poolName: string;
  orderId: string;
  baseSymbol: string;
  quoteSymbol: string;
  withdrawAfterCancel?: boolean;
}): Transaction {
  const ext = createDeepBookClient(params.owner, params.managerId);
  const tx = new Transaction();
  tx.setSender(params.owner);
  tx.add(ext.deepbook.deepBook.cancelLiveOrder(params.poolName, 'MAIN', params.orderId));
  tx.add(ext.deepbook.deepBook.withdrawSettledAmounts(params.poolName, 'MAIN'));
  if (params.withdrawAfterCancel) {
    tx.add(ext.deepbook.balanceManager.withdrawAllFromManager('MAIN', params.baseSymbol, params.owner));
    tx.add(ext.deepbook.balanceManager.withdrawAllFromManager('MAIN', params.quoteSymbol, params.owner));
  }
  return tx;
}

/**
 * Builds an institutional DeepBook v3 Limit Order PTB.
 * - If the wallet already has a BalanceManager (`managerId`), tops up only the shortfall (if any) and places the limit order.
 * - If the wallet does NOT have a BalanceManager yet, creates a new BalanceManager, deposits required collateral,
 *   places the limit order, and shares the BalanceManager — all atomically in 1 single transaction!
 * - Appends Volt's tier-adjusted fee + instant on-chain referral rev-share split on Sui gas coin when `feeMist > 0n`.
 */
export function buildPlaceDeepBookLimitOrderTx(params: {
  owner: string;
  managerId: string | null;
  pool: DeepBookPoolMeta;
  price: number;
  quantity: number;
  isBid: boolean;
  postOnly?: boolean;
  existingManagerDepositCoin?: number; // current balance inside manager for the paying side
  payWithDeep?: boolean;
  feeMist?: bigint;
  refSharePct?: number;
  spotReferralId?: string | null;
  existingManagerReferralId?: string | null;
}): Transaction {
  const tx = new Transaction();
  tx.setSender(params.owner);

  const clientOrderId = Date.now().toString();
  const orderType = params.postOnly ? OrderType.POST_ONLY : OrderType.NO_RESTRICTION;
  const selfMatching = SelfMatchingOptions.SELF_MATCHING_ALLOWED;

  // Input side & fee cushion (DeepBook v3 input fee ~0.20% max when payWithDeep is false)
  const payingCoinKey = params.isBid ? params.pool.quoteSymbol : params.pool.baseSymbol;
  const payingCoinType = params.isBid ? params.pool.quoteCoinId : params.pool.baseCoinId;
  const payingDecimals = params.isBid ? params.pool.quoteDecimals : params.pool.baseDecimals;
  const requiredAmount = params.isBid
    ? params.price * params.quantity * 1.005
    : params.quantity * 1.005;

  const alreadyInManager = params.existingManagerDepositCoin ?? 0;
  const shortfall = Math.max(0, requiredAmount - alreadyInManager);

  const baseScale = Math.pow(10, params.pool.baseDecimals);
  const quoteScale = Math.pow(10, params.pool.quoteDecimals);
  const onChainPrice = BigInt(Math.round((params.price * 1e9 * quoteScale) / baseScale));
  const lotAtoms = BigInt(Math.max(1, Math.round(params.pool.lotSize * baseScale)));
  const rawQtyAtoms = BigInt(Math.max(1, Math.round(params.quantity * baseScale)));
  const onChainQty = (rawQtyAtoms / lotAtoms) * lotAtoms || lotAtoms;
  const expireTs = 1844674407370955161n;

  if (params.managerId) {
    const ext = createDeepBookClient(params.owner, params.managerId);
    if (params.spotReferralId && !params.existingManagerReferralId) {
      attachSpotReferralInTx(tx, tx.object(params.managerId), params.spotReferralId, params.owner);
    }
    if (shortfall > 0.000001) {
      tx.add(
        ext.deepbook.balanceManager.depositIntoManager(
          'MAIN',
          payingCoinKey,
          Number(shortfall.toFixed(Math.min(6, payingDecimals)))
        )
      );
    }
    tx.add(
      ext.deepbook.deepBook.placeLimitOrder({
        poolKey: params.pool.poolName,
        balanceManagerKey: 'MAIN',
        clientOrderId,
        price: params.price,
        quantity: params.quantity,
        isBid: params.isBid,
        orderType,
        selfMatchingOption: selfMatching,
        payWithDeep: params.payWithDeep ?? false,
      })
    );
  } else {
    // 1-tx first-time experience: create -> deposit -> generate proof -> place_limit_order -> share
    const ext = createDeepBookClient(params.owner);
    const manager = tx.add(ext.deepbook.balanceManager.createBalanceManagerWithOwner(params.owner));

    const depositUnits = BigInt(Math.max(1, Math.ceil(requiredAmount * Math.pow(10, payingDecimals))));
    const depositCoin = coinWithBalance({
      type: payingCoinType,
      balance: depositUnits,
    });

    tx.moveCall({
      package: DEEPBOOK_PACKAGE_ID,
      module: 'balance_manager',
      function: 'deposit',
      arguments: [manager, depositCoin],
      typeArguments: [payingCoinType],
    });

    const tradeProof = tx.moveCall({
      package: DEEPBOOK_PACKAGE_ID,
      module: 'balance_manager',
      function: 'generate_proof_as_owner',
      arguments: [manager],
    });

    tx.moveCall({
      package: DEEPBOOK_PACKAGE_ID,
      module: 'pool',
      function: 'place_limit_order',
      arguments: [
        tx.object(params.pool.poolId),
        manager,
        tradeProof,
        tx.pure.u64(BigInt(clientOrderId)),
        tx.pure.u8(orderType),
        tx.pure.u8(selfMatching),
        tx.pure.u64(onChainPrice),
        tx.pure.u64(onChainQty),
        tx.pure.bool(params.isBid),
        tx.pure.bool(params.payWithDeep ?? false),
        tx.pure.u64(expireTs),
        tx.object('0x6'),
      ],
      typeArguments: [params.pool.baseCoinId, params.pool.quoteCoinId],
    });

    tx.moveCall({
      target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::register_balance_manager`,
      arguments: [manager, tx.object(DEEPBOOK_REGISTRY_ID)],
    });

    attachSpotReferralInTx(tx, manager, params.spotReferralId, params.owner);
    tx.add(ext.deepbook.balanceManager.shareBalanceManager(manager));
  }

  if (params.feeMist && params.feeMist > 0n) {
    appendVoltFeeCoinSplit(tx, tx.gas, params.feeMist, params.owner, params.refSharePct ?? 0.25);
  }

  return tx;
}


/**
 * Builds a DeepBook v3 Spot CLOB Market Order (Immediate-or-Cancel at Book Price).
 * Works in 1 transaction whether or not the wallet already has a BalanceManager,
 * settles matched proceeds immediately, and optionally withdraws output to the wallet.
 */
export function buildPlaceDeepBookMarketOrderTx(params: {
  owner: string;
  pool: DeepBookPoolMeta;
  managerId?: string;
  managerBaseBalance?: number;
  managerQuoteBalance?: number;
  quantity: number;
  estPrice: number;
  slippagePct?: number;
  isBid: boolean;
  payWithDeep?: boolean;
  settleToWallet?: boolean;
  feeBps?: number;
  spotReferralId?: string | null;
  existingManagerReferralId?: string | null;
}): Transaction {
  const {
    owner,
    pool,
    managerId,
    managerBaseBalance = 0,
    managerQuoteBalance = 0,
    quantity,
    estPrice,
    slippagePct = 1.5,
    isBid,
    payWithDeep = false,
    settleToWallet = true,
    feeBps = 25,
    spotReferralId,
    existingManagerReferralId,
  } = params;

  const tx = new Transaction();
  tx.setSender(owner);

  const baseScale = Math.pow(10, pool.baseDecimals);
  const quoteScale = Math.pow(10, pool.quoteDecimals);
  const lotStep = pool.lotSize > 0 ? pool.lotSize : 0.0001;
  const alignedQty = Math.max(
    pool.minSize || lotStep,
    Math.floor(quantity / lotStep) * lotStep
  );
  const qtyRaw = BigInt(Math.round(alignedQty * baseScale));
  const clientOrderId = BigInt(Date.now());
  const slipFactor = 1 + Math.max(0.2, slippagePct) / 100;
  // +0.5% cushion covers DeepBook taker input fee (~0.1%) when payWithDeep=false
  const feeCushion = payWithDeep ? 1.001 : 1.005;

  const requiredBase = alignedQty * feeCushion;
  const requiredQuote = alignedQty * Math.max(estPrice, 0.000001) * slipFactor * feeCushion;

  const inputCoinType = isBid ? pool.quoteCoinId : pool.baseCoinId;
  const inputDecimals = isBid ? pool.quoteDecimals : pool.baseDecimals;
  const estInputHuman = isBid ? alignedQty * Math.max(estPrice, 0.000001) : alignedQty;
  const feeAtomic =
    feeBps > 0
      ? BigInt(Math.floor((estInputHuman * (feeBps / 10000)) * Math.pow(10, inputDecimals)))
      : 0n;

  if (feeAtomic > 0n) {
    addCoinFeeToTx(tx, { coinType: inputCoinType, feeAtomic, sender: owner });
  }

  let targetManagerArg: any;
  const isNewManager = !managerId;

  if (managerId) {
    targetManagerArg = tx.object(managerId);
    if (spotReferralId && !existingManagerReferralId) {
      attachSpotReferralInTx(tx, targetManagerArg, spotReferralId, owner);
    }
    if (isBid) {
      const deficit = Math.max(0, requiredQuote - managerQuoteBalance);
      const deficitRaw = BigInt(Math.ceil(deficit * quoteScale));
      if (deficitRaw > 0n) {
        const coin = coinWithBalance({ type: pool.quoteCoinId, balance: deficitRaw })(tx);
        tx.moveCall({
          target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::deposit`,
          arguments: [targetManagerArg, coin],
          typeArguments: [pool.quoteCoinId],
        });
      }
    } else {
      const deficit = Math.max(0, requiredBase - managerBaseBalance);
      const deficitRaw = BigInt(Math.ceil(deficit * baseScale));
      if (deficitRaw > 0n) {
        const coin = coinWithBalance({ type: pool.baseCoinId, balance: deficitRaw })(tx);
        tx.moveCall({
          target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::deposit`,
          arguments: [targetManagerArg, coin],
          typeArguments: [pool.baseCoinId],
        });
      }
    }
  } else {
    targetManagerArg = tx.moveCall({
      target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::new_with_custom_owner`,
      arguments: [tx.pure.address(owner)],
    });
    if (isBid) {
      const depRaw = BigInt(Math.ceil(requiredQuote * quoteScale));
      const coin = coinWithBalance({ type: pool.quoteCoinId, balance: depRaw })(tx);
      tx.moveCall({
        target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::deposit`,
        arguments: [targetManagerArg, coin],
        typeArguments: [pool.quoteCoinId],
      });
    } else {
      const depRaw = BigInt(Math.ceil(requiredBase * baseScale));
      const coin = coinWithBalance({ type: pool.baseCoinId, balance: depRaw })(tx);
      tx.moveCall({
        target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::deposit`,
        arguments: [targetManagerArg, coin],
        typeArguments: [pool.baseCoinId],
      });
    }
  }

  const tradeProof = tx.moveCall({
    target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::generate_proof_as_owner`,
    arguments: [targetManagerArg],
  });

  tx.moveCall({
    target: `${DEEPBOOK_PACKAGE_ID}::pool::place_market_order`,
    arguments: [
      tx.object(pool.poolId),
      targetManagerArg,
      tradeProof,
      tx.pure.u64(clientOrderId),
      tx.pure.u8(SelfMatchingOptions.SELF_MATCHING_ALLOWED),
      tx.pure.u64(qtyRaw),
      tx.pure.bool(isBid),
      tx.pure.bool(payWithDeep),
      tx.object('0x6'),
    ],
    typeArguments: [pool.baseCoinId, pool.quoteCoinId],
  });

  tx.moveCall({
    target: `${DEEPBOOK_PACKAGE_ID}::pool::withdraw_settled_amounts`,
    arguments: [tx.object(pool.poolId), targetManagerArg, tradeProof],
    typeArguments: [pool.baseCoinId, pool.quoteCoinId],
  });

  if (settleToWallet || isNewManager) {
    const outBase = tx.moveCall({
      target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::withdraw_all`,
      arguments: [targetManagerArg],
      typeArguments: [pool.baseCoinId],
    });
    const outQuote = tx.moveCall({
      target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::withdraw_all`,
      arguments: [targetManagerArg],
      typeArguments: [pool.quoteCoinId],
    });
    tx.transferObjects([outBase, outQuote], owner);
  }

  if (isNewManager) {
    tx.moveCall({
      target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::register_balance_manager`,
      arguments: [targetManagerArg, tx.object(DEEPBOOK_REGISTRY_ID)],
    });
    attachSpotReferralInTx(tx, targetManagerArg, spotReferralId, owner);
    tx.moveCall({
      target: '0x2::transfer::public_share_object',
      arguments: [targetManagerArg],
      typeArguments: [`${DEEPBOOK_PACKAGE_ID}::balance_manager::BalanceManager`],
    });
  }

  return tx;
}

export interface DeepBookGridOrderRung {
  price: number;
  quantity: number;
  isBid: boolean;
}

/**
 * Atomically deploys an N-rung Spot CLOB Limit Order Grid on DeepBook v3 in 1 transaction:
 * - Creates & registers BalanceManager (binding Volt native Spot Referral if available) when none exists,
 * - Deposits only the net Base & Quote collateral shortfall required across all grid rungs,
 * - Aligns every price strictly to pool tickSize & quantity to pool lotSize to guarantee zero Move aborts,
 * - Places all limit rungs inside one PTB + shares BalanceManager if new.
 */
export function buildPlaceDeepBookGridTx(params: {
  owner: string;
  pool: DeepBookPoolMeta;
  managerId?: string | null;
  managerBaseBalance?: number;
  managerQuoteBalance?: number;
  orders: DeepBookGridOrderRung[];
  postOnly?: boolean;
  payWithDeep?: boolean;
  feeMist?: bigint;
  refSharePct?: number;
  spotReferralId?: string | null;
  existingManagerReferralId?: string | null;
}): Transaction {
  const {
    owner,
    pool,
    managerId,
    managerBaseBalance = 0,
    managerQuoteBalance = 0,
    orders,
    postOnly = false,
    payWithDeep = false,
    feeMist = 0n,
    refSharePct = 0.25,
    spotReferralId,
    existingManagerReferralId,
  } = params;

  if (!orders || orders.length === 0) {
    throw new Error('Grid requires at least one limit order rung.');
  }

  const tx = new Transaction();
  tx.setSender(owner);

  const baseScale = Math.pow(10, pool.baseDecimals);
  const quoteScale = Math.pow(10, pool.quoteDecimals);
  const onChainTickSize = BigInt(Math.max(1, Math.round((pool.tickSize * 1e9 * quoteScale) / baseScale)));
  const lotAtoms = BigInt(Math.max(1, Math.round(pool.lotSize * baseScale)));
  const minQtyAtoms = BigInt(Math.max(1, Math.round(pool.minSize * baseScale)));

  const normalizedOrders = orders.map((ord) => {
    const rawPrice = BigInt(Math.max(1, Math.round((ord.price * 1e9 * quoteScale) / baseScale)));
    const snappedPrice = ((rawPrice + onChainTickSize / 2n) / onChainTickSize) * onChainTickSize || onChainTickSize;
    const rawQty = BigInt(Math.max(1, Math.round(ord.quantity * baseScale)));
    const steppedQty = (rawQty / lotAtoms) * lotAtoms;
    const finalQty = steppedQty >= minQtyAtoms ? steppedQty : minQtyAtoms;
    const snappedUiPrice = Number(snappedPrice) / ((1e9 * quoteScale) / baseScale);
    const snappedUiQty = Number(finalQty) / baseScale;
    return {
      isBid: ord.isBid,
      onChainPrice: snappedPrice,
      onChainQty: finalQty,
      uiPrice: snappedUiPrice,
      uiQty: snappedUiQty,
    };
  });

  const totalQuoteNeeded = normalizedOrders
    .filter((o) => o.isBid)
    .reduce((acc, o) => acc + o.uiPrice * o.uiQty * 1.005, 0);
  const totalBaseNeeded = normalizedOrders
    .filter((o) => !o.isBid)
    .reduce((acc, o) => acc + o.uiQty * 1.005, 0);

  const isNewManager = !managerId;
  const quoteDeficit = Math.max(0, totalQuoteNeeded - (isNewManager ? 0 : managerQuoteBalance));
  const baseDeficit = Math.max(0, totalBaseNeeded - (isNewManager ? 0 : managerBaseBalance));

  const targetManagerArg: any = isNewManager
    ? tx.moveCall({
        target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::new_with_custom_owner`,
        arguments: [tx.pure.address(owner)],
      })
    : tx.object(managerId);

  if (!isNewManager && spotReferralId && !existingManagerReferralId) {
    attachSpotReferralInTx(tx, targetManagerArg, spotReferralId, owner);
  }

  if (quoteDeficit > 0.000001) {
    const quoteRaw = BigInt(Math.max(1, Math.ceil(quoteDeficit * quoteScale)));
    const qCoin = coinWithBalance({ type: pool.quoteCoinId, balance: quoteRaw })(tx);
    tx.moveCall({
      target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::deposit`,
      arguments: [targetManagerArg, qCoin],
      typeArguments: [pool.quoteCoinId],
    });
  }

  if (baseDeficit > 0.000001) {
    const baseRaw = BigInt(Math.max(1, Math.ceil(baseDeficit * baseScale)));
    const isSuiBase = safeNormalizeCoinType(pool.baseCoinId) === safeNormalizeCoinType(SUI_COIN_TYPE);
    const bCoin = coinWithBalance({
      type: pool.baseCoinId,
      balance: baseRaw,
      useGasCoin: isSuiBase,
    })(tx);
    tx.moveCall({
      target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::deposit`,
      arguments: [targetManagerArg, bCoin],
      typeArguments: [pool.baseCoinId],
    });
  }

  const tradeProof = tx.moveCall({
    target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::generate_proof_as_owner`,
    arguments: [targetManagerArg],
  });

  const orderType = postOnly ? OrderType.POST_ONLY : OrderType.NO_RESTRICTION;
  const selfMatching = SelfMatchingOptions.SELF_MATCHING_ALLOWED;
  const expireTs = 1844674407370955161n;
  const baseOrderId = BigInt(Date.now());

  normalizedOrders.forEach((ord, idx) => {
    tx.moveCall({
      target: `${DEEPBOOK_PACKAGE_ID}::pool::place_limit_order`,
      arguments: [
        tx.object(pool.poolId),
        targetManagerArg,
        tradeProof,
        tx.pure.u64(baseOrderId + BigInt(idx)),
        tx.pure.u8(orderType),
        tx.pure.u8(selfMatching),
        tx.pure.u64(ord.onChainPrice),
        tx.pure.u64(ord.onChainQty),
        tx.pure.bool(ord.isBid),
        tx.pure.bool(payWithDeep),
        tx.pure.u64(expireTs),
        tx.object('0x6'),
      ],
      typeArguments: [pool.baseCoinId, pool.quoteCoinId],
    });
  });

  if (isNewManager) {
    tx.moveCall({
      target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::register_balance_manager`,
      arguments: [targetManagerArg, tx.object(DEEPBOOK_REGISTRY_ID)],
    });
    attachSpotReferralInTx(tx, targetManagerArg, spotReferralId, owner);
    tx.moveCall({
      target: '0x2::transfer::public_share_object',
      arguments: [targetManagerArg],
      typeArguments: [`${DEEPBOOK_PACKAGE_ID}::balance_manager::BalanceManager`],
    });
  }

  if (feeMist > 0n) {
    appendVoltFeeCoinSplit(tx, tx.gas, feeMist, owner, refSharePct);
  }

  return tx;
}
