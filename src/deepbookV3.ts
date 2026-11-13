import { deepbook, mainnetPackageIds, OrderType, SelfMatchingOptions } from '@mysten/deepbook-v3';
import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { suiGrpcClient } from './suiClient';
import { appendVoltFeeCoinSplit, addCoinFeeToTx } from './voltFee';

export const DEEPBOOK_INDEXER = 'https://deepbook-indexer.mainnet.mystenlabs.com';
export const DEEPBOOK_PACKAGE_ID = mainnetPackageIds.DEEPBOOK_PACKAGE_ID;
export const DEEPBOOK_REGISTRY_ID = mainnetPackageIds.REGISTRY_ID;
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
  openOrders: DeepBookOpenOrder[];
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
    poolName: 'BETH_USDC',
    baseSymbol: 'BETH',
    quoteSymbol: 'USDC',
    baseCoinId: '0xd0e89b2af5e4910726fbcd8b8dd37bb79b29e5f83f7491bca830e94f7f226d29::eth::ETH',
    quoteCoinId: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    baseDecimals: 8,
    quoteDecimals: 6,
    tickSize: 0.1,
    lotSize: 0.001,
    minSize: 0.01,
  },
];

const FEATURED_POOL_ORDER = [
  'SUI_USDC',
  'DEEP_SUI',
  'DEEP_USDC',
  'WAL_USDC',
  'XBTC_USDC',
  'BETH_USDC',
  'NS_USDC',
  'SEND_USDC',
];

export async function fetchDeepBookPools(): Promise<DeepBookPoolMeta[]> {
  try {
    const res = await fetch(`${DEEPBOOK_INDEXER}/get_pools`);
    if (!res.ok) return DEFAULT_DEEPBOOK_POOLS;
    const raw: any[] = await res.json();
    const mapped: DeepBookPoolMeta[] = raw
      .filter((p) => FEATURED_POOL_ORDER.includes(String(p.pool_name)))
      .map((p) => {
        const baseDecimals = Number(p.base_asset_decimals || 9);
        const quoteDecimals = Number(p.quote_asset_decimals || 6);
        const baseScale = Math.pow(10, baseDecimals);
        const rawTick = Number(p.tick_size || 100000);
        const humanTick = (rawTick / 1e9) * Math.pow(10, baseDecimals - quoteDecimals);
        return {
          poolId: String(p.pool_id),
          poolName: String(p.pool_name),
          baseSymbol: String(p.base_asset_symbol),
          quoteSymbol: String(p.quote_asset_symbol),
          baseCoinId: String(p.base_asset_id),
          quoteCoinId: String(p.quote_asset_id),
          baseDecimals,
          quoteDecimals,
          tickSize: Number(humanTick.toPrecision(4)) || 0.0001,
          lotSize: Number(p.lot_size || 1e8) / baseScale,
          minSize: Number(p.min_size || 1e9) / baseScale,
        };
      });

    mapped.sort(
      (a, b) => FEATURED_POOL_ORDER.indexOf(a.poolName) - FEATURED_POOL_ORDER.indexOf(b.poolName)
    );
    return mapped.length > 0 ? mapped : DEFAULT_DEEPBOOK_POOLS;
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

  const [baseBal, quoteBal, deepBal, details, accountInfo] = await Promise.all([
    db.checkManagerBalanceWithAddress(managerId, pool.baseSymbol).catch(() => ({ balance: 0 })),
    db.checkManagerBalanceWithAddress(managerId, pool.quoteSymbol).catch(() => ({ balance: 0 })),
    db.checkManagerBalanceWithAddress(managerId, 'DEEP').catch(() => ({ balance: 0 })),
    db.getAccountOrderDetails(pool.poolName, 'MAIN').catch(() => []),
    db.account(pool.poolName, 'MAIN').catch(() => null),
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
    openOrders,
  };
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

export function buildWithdrawAllManagersAndCancelTx(params: {
  owner: string;
  pool: DeepBookPoolMeta;
  managers: Array<{ managerId: string; openOrderIds: string[] }>;
}): Transaction {
  const tx = new Transaction();
  tx.setSender(params.owner);
  const coinsToReturn: any[] = [];

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
    tx.moveCall({
      target: '0x2::transfer::public_share_object',
      arguments: [targetManagerArg],
      typeArguments: [`${DEEPBOOK_PACKAGE_ID}::balance_manager::BalanceManager`],
    });
  }

  return tx;
}
