import {
  deepbook,
  mainnetCoins,
  mainnetMarginPools,
  mainnetPackageIds,
  mainnetPools,
  OrderType,
  SelfMatchingOptions,
} from '@mysten/deepbook-v3';
import { Transaction } from '@mysten/sui/transactions';
import type { DeepBookPoolMeta } from './deepbookV3';
import { suiGrpcClient } from './suiClient';
import { appendVoltFeeCoinSplit } from './voltFee';

export const MARGIN_ENABLED_POOL_KEYS = [
  'SUI_USDC',
  'DEEP_USDC',
  'WAL_USDC',
  'XBTC_USDC',
  'SUIUSDE_USDC',
  'SUI_SUIUSDE',
] as const;

export type MarginPoolKey = (typeof MARGIN_ENABLED_POOL_KEYS)[number];

export interface MarginPoolRiskConfig {
  poolKey: string;
  minOpenRiskRatio: number;
  minBorrowRiskRatio: number;
  minWithdrawRiskRatio: number;
  liquidationRiskRatio: number;
  maxLeverageSafe: number;
  baseBorrowAprPct: number;
  quoteBorrowAprPct: number;
  baseAvailableLiquidity: number;
  quoteAvailableLiquidity: number;
  minBorrowBase: number;
  minBorrowQuote: number;
}

export interface MarginOpenOrder {
  orderId: string;
  isBid: boolean;
  price: number;
  quantity: number;
  filledQuantity: number;
  status: number;
}

export interface MarginManagerPosition {
  managerId: string;
  poolKey: string;
  deepbookPoolId: string;
  riskRatio: number;
  baseAsset: number;
  quoteAsset: number;
  baseDebt: number;
  quoteDebt: number;
  baseBalance: number;
  quoteBalance: number;
  deepBalance: number;
  basePythPriceUsd: number;
  quotePythPriceUsd: number;
  openOrders: MarginOpenOrder[];
  conditionalOrderIds: string[];
}

function getPoolCoins(poolKey: string) {
  const pool = mainnetPools[poolKey as keyof typeof mainnetPools];
  if (!pool) throw new Error(`Unsupported DeepBook margin pool: ${poolKey}`);
  const baseCoin = mainnetCoins[pool.baseCoin as keyof typeof mainnetCoins];
  const quoteCoin = mainnetCoins[pool.quoteCoin as keyof typeof mainnetCoins];
  const baseMarginPool = mainnetMarginPools[pool.baseCoin as keyof typeof mainnetMarginPools];
  const quoteMarginPool = mainnetMarginPools[pool.quoteCoin as keyof typeof mainnetMarginPools];

  if (
    !baseCoin?.priceInfoObjectId ||
    !quoteCoin?.priceInfoObjectId ||
    !baseMarginPool ||
    !quoteMarginPool
  ) {
    throw new Error(`Margin pool or Pyth oracle metadata missing for ${poolKey}`);
  }
  return { pool, baseCoin, quoteCoin, baseMarginPool, quoteMarginPool };
}

export function createDeepBookMarginClient(owner: string, managerId?: string, poolKey?: string) {
  return suiGrpcClient.$extend(
    deepbook({
      address: owner,
      marginManagers:
        managerId && poolKey ? { MAIN: { address: managerId, poolKey } } : undefined,
    })
  );
}

/** Filters spot pool list down to Mainnet pools enabled for DeepBook v3 Margin Trading. */
export function filterMarginEnabledPools(pools: DeepBookPoolMeta[]): DeepBookPoolMeta[] {
  const byName = new Map(pools.map((p) => [p.poolName, p]));
  const result: DeepBookPoolMeta[] = [];
  for (const key of MARGIN_ENABLED_POOL_KEYS) {
    const found = byName.get(key);
    if (found) result.push(found);
  }
  return result;
}

/** Fetches live risk bounds, interest rates, and available borrow liquidity for a margin pair. */
export async function fetchMarginPoolConfig(poolKey: string): Promise<MarginPoolRiskConfig> {
  const { pool } = getPoolCoins(poolKey);
  const ext = createDeepBookMarginClient(
    '0x0000000000000000000000000000000000000000000000000000000000000000'
  );
  const db = ext.deepbook;

  const [
    minOpen,
    minBorrow,
    minWithdraw,
    liqRatio,
    baseIr,
    quoteIr,
    baseSup,
    baseBor,
    quoteSup,
    quoteBor,
    minBBase,
    minBQuote,
  ] = await Promise.all([
    db.getMinOpenRiskRatio(poolKey).catch(() => 1.17495),
    db.getMinBorrowRiskRatio(poolKey).catch(() => 1.2499),
    db.getMinWithdrawRiskRatio(poolKey).catch(() => 2.0),
    db.getLiquidationRiskRatio(poolKey).catch(() => 1.1),
    db.getMarginPoolInterestRate(pool.baseCoin).catch(() => 0.03),
    db.getMarginPoolInterestRate(pool.quoteCoin).catch(() => 0.06),
    db.getMarginPoolTotalSupply(pool.baseCoin, 4).catch(() => '0'),
    db.getMarginPoolTotalBorrow(pool.baseCoin, 4).catch(() => '0'),
    db.getMarginPoolTotalSupply(pool.quoteCoin, 4).catch(() => '0'),
    db.getMarginPoolTotalBorrow(pool.quoteCoin, 4).catch(() => '0'),
    db.getMarginPoolMinBorrow(pool.baseCoin, 4).catch(() => '0.1'),
    db.getMarginPoolMinBorrow(pool.quoteCoin, 4).catch(() => '0.1'),
  ]);

  // Max safe borrow leverage from risk ratio formula: RR = Assets / Debt => L_max = RR / (RR - 1)
  const effectiveBorrowRatio = Math.max(1.26, Number(minBorrow || 1.2499) + 0.02);
  const maxLev = Number(
    Math.min(5, effectiveBorrowRatio / (effectiveBorrowRatio - 1)).toFixed(1)
  );

  return {
    poolKey,
    minOpenRiskRatio: Number(minOpen || 1.17495),
    minBorrowRiskRatio: Number(minBorrow || 1.2499),
    minWithdrawRiskRatio: Number(minWithdraw || 2.0),
    liquidationRiskRatio: Number(liqRatio || 1.1),
    maxLeverageSafe: maxLev,
    baseBorrowAprPct: Number(baseIr || 0) * 100,
    quoteBorrowAprPct: Number(quoteIr || 0) * 100,
    baseAvailableLiquidity: Math.max(0, Number(baseSup) - Number(baseBor)),
    quoteAvailableLiquidity: Math.max(0, Number(quoteSup) - Number(quoteBor)),
    minBorrowBase: Math.max(0.1, Number(minBBase || 0.1)),
    minBorrowQuote: Math.max(0.1, Number(minBQuote || 0.1)),
  };
}

/** Discovers all MarginManagers owned by `owner` and returns the state for `pool` if one exists. */
export async function fetchMarginPositionForPool(
  owner: string,
  pool: DeepBookPoolMeta
): Promise<MarginManagerPosition | null> {
  const probe = createDeepBookMarginClient(owner);
  const ids = await probe.deepbook.getMarginManagerIdsForOwner(owner).catch(() => [] as string[]);
  if (!ids.length) return null;

  let matchedId: string | null = null;
  for (const id of ids) {
    const obj = await suiGrpcClient.core
      .getObject({ objectId: id, include: { json: true } })
      .catch(() => null);
    const json: any = obj?.object?.json;
    const poolField = String(json?.deepbook_pool || '').toLowerCase();
    if (poolField === pool.poolId.toLowerCase()) {
      matchedId = id;
      break;
    }
  }
  if (!matchedId) return null;

  const ext = createDeepBookMarginClient(owner, matchedId, pool.poolName);
  const db = ext.deepbook;
  const { baseCoin, quoteCoin } = getPoolCoins(pool.poolName);

  const [state, balances, rawOrders, tpslIds] = await Promise.all([
    db.getMarginManagerState('MAIN', 6).catch(() => null),
    db.getMarginManagerBalances({ [matchedId]: pool.poolName }, 6).catch(() => null),
    db.getAccountOrderDetails(pool.poolName, 'MAIN').catch(() => []),
    db.getConditionalOrderIds('MAIN').catch(() => []),
  ]);

  if (!state) return null;

  const openOrders: MarginOpenOrder[] = await Promise.all(
    (Array.isArray(rawOrders) ? rawOrders : []).map(async (ord: any) => {
      const norm = await db.getOrderNormalized(pool.poolName, ord.order_id).catch(() => null);
      return {
        orderId: String(ord.order_id),
        isBid: Boolean(norm?.isBid ?? BigInt(ord.order_id) >> 127n === 0n),
        price: Number(norm?.normalized_price || 0),
        quantity: norm ? Number(norm.quantity) : Number(ord.quantity || 0) / baseCoin.scalar,
        filledQuantity: norm
          ? Number(norm.filled_quantity)
          : Number(ord.filled_quantity || 0) / baseCoin.scalar,
        status: Number(ord.status || 0),
      };
    })
  );

  const balEntry = balances?.[matchedId];
  const basePyth =
    Number(state.basePythPrice || 0) / Math.pow(10, Math.abs(state.basePythDecimals || 8));
  const quotePyth =
    Number(state.quotePythPrice || 0) / Math.pow(10, Math.abs(state.quotePythDecimals || 8));

  return {
    managerId: state.managerId,
    poolKey: pool.poolName,
    deepbookPoolId: state.deepbookPoolId,
    riskRatio: Number(state.riskRatio || 0),
    baseAsset: Number(state.baseAsset || 0),
    quoteAsset: Number(state.quoteAsset || 0),
    baseDebt: Number(state.baseDebt || 0),
    quoteDebt: Number(state.quoteDebt || 0),
    baseBalance: Number(balEntry?.base ?? state.baseAsset ?? 0),
    quoteBalance: Number(balEntry?.quote ?? state.quoteAsset ?? 0),
    deepBalance: Number(balEntry?.deep ?? 0),
    basePythPriceUsd: basePyth > 0 ? basePyth : 1,
    quotePythPriceUsd: quotePyth > 0 ? quotePyth : 1 / quoteCoin.scalar || 1,
    openOrders,
    conditionalOrderIds: Array.isArray(tpslIds) ? tpslIds.map(String) : [],
  };
}

/** Helper to attach optional TP/SL conditional orders to either a newly initialized or shared manager. */
function appendConditionalTpSl(params: {
  tx: Transaction;
  db: ReturnType<typeof createDeepBookMarginClient>['deepbook'];
  managerArg: any;
  isNewManager: boolean;
  poolKey: string;
  baseType: string;
  quoteType: string;
  baseOracle: string;
  quoteOracle: string;
  poolAddress: string;
  isLong: boolean;
  quantity: number;
  tpPrice?: number;
  slPrice?: number;
}) {
  const {
    tx,
    db,
    managerArg,
    isNewManager,
    poolKey,
    baseType,
    quoteType,
    baseOracle,
    quoteOracle,
    poolAddress,
    isLong,
    quantity,
    tpPrice,
    slPrice,
  } = params;

  const entries: Array<{ price: number; triggerBelow: boolean; offset: number }> = [];
  if (tpPrice && tpPrice > 0) {
    // Long TP triggers ABOVE market (triggerBelowPrice=false); Short TP triggers BELOW market (triggerBelowPrice=true)
    entries.push({ price: tpPrice, triggerBelow: !isLong, offset: 1 });
  }
  if (slPrice && slPrice > 0) {
    // Long SL triggers BELOW market (triggerBelowPrice=true); Short SL triggers ABOVE market (triggerBelowPrice=false)
    entries.push({ price: slPrice, triggerBelow: isLong, offset: 2 });
  }

  for (const entry of entries) {
    const condId = Date.now() + entry.offset;
    const closeSideIsBid = !isLong;
    if (isNewManager) {
      const cond = db.marginTPSL.newCondition(poolKey, entry.triggerBelow, entry.price)(tx);
      const pending = db.marginTPSL.newPendingMarketOrder(poolKey, {
        clientOrderId: String(condId + 100),
        quantity,
        isBid: closeSideIsBid,
        payWithDeep: false,
      })(tx);
      tx.moveCall({
        target: `${mainnetPackageIds.MARGIN_PACKAGE_ID}::margin_manager_upgraded::add_conditional_order`,
        arguments: [
          managerArg,
          tx.object(poolAddress),
          tx.object(baseOracle),
          tx.object(quoteOracle),
          tx.object(mainnetPackageIds.MARGIN_REGISTRY_ID),
          tx.pure.u64(BigInt(condId)),
          cond,
          pending,
          tx.object('0x6'),
        ],
        typeArguments: [baseType, quoteType],
      });
    } else {
      tx.add(
        db.marginTPSL.addConditionalOrder({
          marginManagerKey: 'MAIN',
          conditionalOrderId: String(condId),
          triggerBelowPrice: entry.triggerBelow,
          triggerPrice: entry.price,
          pendingOrder: {
            clientOrderId: String(condId + 100),
            quantity,
            isBid: closeSideIsBid,
            payWithDeep: false,
          },
        })
      );
    }
  }
}

export interface MarginHealthMetrics {
  hasDebt: boolean;
  riskRatio: number;
  liquidationRiskRatio: number;
  borrowRiskRatio: number;
  assetUsd: number;
  debtUsd: number;
  netEquityUsd: number;
  healthBufferPct: number;
  barProgressPct: number;
  status: 'healthy' | 'caution' | 'danger' | 'idle';
  estLiquidationPrice: number | null;
  distanceToLiqPct: number | null;
  inferredSide: 'long' | 'short';
}

/**
 * Computes live Health Factor, buffer to liquidation, and analytical liquidation price
 * for an active isolated DeepBook MarginManager position.
 */
export function computeMarginHealthMetrics(
  position: MarginManagerPosition | null,
  riskConfig: MarginPoolRiskConfig | null
): MarginHealthMetrics {
  const liquidationRiskRatio = riskConfig?.liquidationRiskRatio ?? 1.1;
  const borrowRiskRatio = riskConfig?.minBorrowRiskRatio ?? 1.25;

  if (!position) {
    return {
      hasDebt: false,
      riskRatio: 0,
      liquidationRiskRatio,
      borrowRiskRatio,
      assetUsd: 0,
      debtUsd: 0,
      netEquityUsd: 0,
      healthBufferPct: 100,
      barProgressPct: 100,
      status: 'idle',
      estLiquidationPrice: null,
      distanceToLiqPct: null,
      inferredSide: 'long',
    };
  }

  const assetUsd =
    position.baseAsset * position.basePythPriceUsd +
    position.quoteAsset * position.quotePythPriceUsd;
  const debtUsd =
    position.baseDebt * position.basePythPriceUsd +
    position.quoteDebt * position.quotePythPriceUsd;
  const netEquityUsd = assetUsd - debtUsd;
  const hasDebt = debtUsd > 1e-8 || position.baseDebt > 0 || position.quoteDebt > 0;
  const inferredSide: 'long' | 'short' =
    position.quoteDebt * position.quotePythPriceUsd >= position.baseDebt * position.basePythPriceUsd
      ? 'long'
      : 'short';

  if (!hasDebt) {
    return {
      hasDebt: false,
      riskRatio: 99,
      liquidationRiskRatio,
      borrowRiskRatio,
      assetUsd,
      debtUsd,
      netEquityUsd,
      healthBufferPct: 100,
      barProgressPct: 100,
      status: 'healthy',
      estLiquidationPrice: null,
      distanceToLiqPct: null,
      inferredSide,
    };
  }

  const riskRatio = Number(position.riskRatio || 0);
  const healthBufferPct =
    riskRatio > 0 ? Math.max(0, ((riskRatio - liquidationRiskRatio) / riskRatio) * 100) : 0;
  const barProgressPct = Math.max(
    4,
    Math.min(100, ((riskRatio - liquidationRiskRatio) / Math.max(0.4, 2.2 - liquidationRiskRatio)) * 100)
  );
  const status: MarginHealthMetrics['status'] =
    riskRatio >= borrowRiskRatio
      ? 'healthy'
      : riskRatio >= liquidationRiskRatio * 1.06
        ? 'caution'
        : 'danger';

  let estLiquidationPrice: number | null = null;
  let distanceToLiqPct: number | null = null;
  const numUsd =
    liquidationRiskRatio * position.quoteDebt * position.quotePythPriceUsd -
    position.quoteAsset * position.quotePythPriceUsd;
  const denBase = position.baseAsset - liquidationRiskRatio * position.baseDebt;
  if (Math.abs(denBase) > 1e-9) {
    const solved = numUsd / denBase;
    if (Number.isFinite(solved) && solved > 0 && position.basePythPriceUsd > 0) {
      estLiquidationPrice = solved;
      distanceToLiqPct = ((solved - position.basePythPriceUsd) / position.basePythPriceUsd) * 100;
    }
  }

  return {
    hasDebt,
    riskRatio,
    liquidationRiskRatio,
    borrowRiskRatio,
    assetUsd,
    debtUsd,
    netEquityUsd,
    healthBufferPct,
    barProgressPct,
    status,
    estLiquidationPrice,
    distanceToLiqPct,
    inferredSide,
  };
}

/**
 * Deposits standalone Base or Quote collateral into an existing MarginManager
 * to boost Health Factor and push out liquidation price without opening a new trade.
 */
export function buildMarginDepositCollateralTx(params: {
  owner: string;
  pool: DeepBookPoolMeta;
  managerId: string;
  assetSide: 'base' | 'quote';
  amount: number;
}): Transaction {
  const { owner, pool: poolMeta, managerId, assetSide, amount } = params;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Collateral amount must be greater than zero.');
  }
  const ext = createDeepBookMarginClient(owner, managerId, poolMeta.poolName);
  const tx = new Transaction();
  tx.setSender(owner);
  if (assetSide === 'base') {
    tx.add(ext.deepbook.marginManager.depositBase({ managerKey: 'MAIN', amount }));
  } else {
    tx.add(ext.deepbook.marginManager.depositQuote({ managerKey: 'MAIN', amount }));
  }
  return tx;
}

/**
 * Attaches standalone Conditional Take Profit and/or Stop Loss orders onto an
 * already-open DeepBook MarginManager position.
 */
export function buildMarginAttachTpSlTx(params: {
  owner: string;
  pool: DeepBookPoolMeta;
  managerId: string;
  side: 'long' | 'short';
  quantity: number;
  tpPrice?: number;
  slPrice?: number;
}): Transaction {
  const { owner, pool: poolMeta, managerId, side, quantity, tpPrice, slPrice } = params;
  if ((!tpPrice || tpPrice <= 0) && (!slPrice || slPrice <= 0)) {
    throw new Error('Enter at least a Take Profit or Stop Loss trigger price.');
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Position close size must be greater than zero.');
  }
  const { pool, baseCoin, quoteCoin } = getPoolCoins(poolMeta.poolName);
  const ext = createDeepBookMarginClient(owner, managerId, poolMeta.poolName);
  const lotAtoms = BigInt(Math.max(1, Math.round(poolMeta.lotSize * baseCoin.scalar)));
  const rawQtyAtoms = BigInt(Math.max(1, Math.round(quantity * baseCoin.scalar)));
  const onChainQty = (rawQtyAtoms / lotAtoms) * lotAtoms || lotAtoms;
  const safeQuantityNum = Number(onChainQty) / baseCoin.scalar;

  const tx = new Transaction();
  tx.setSender(owner);

  appendConditionalTpSl({
    tx,
    db: ext.deepbook,
    managerArg: managerId,
    isNewManager: false,
    poolKey: poolMeta.poolName,
    baseType: baseCoin.type,
    quoteType: quoteCoin.type,
    baseOracle: baseCoin.priceInfoObjectId!,
    quoteOracle: quoteCoin.priceInfoObjectId!,
    poolAddress: pool.address,
    isLong: side === 'long',
    quantity: safeQuantityNum,
    tpPrice,
    slPrice,
  });

  return tx;
}

/**
 * Builds an atomic DeepBook v3 Margin Leveraged Order PTB.
 * - Creates + deposits + borrows + places Margin Market/Limit Order + optional TP/SL + shares MarginManager in 1 TX when no manager exists yet.
 * - Uses an existing shared MarginManager when `existingManagerId` is supplied.
 */
export function buildDeepBookMarginOrderTx(params: {
  owner: string;
  pool: DeepBookPoolMeta;
  existingManagerId: string | null;
  side: 'long' | 'short';
  orderStyle: 'market' | 'limit';
  collateralSide: 'base' | 'quote';
  depositCollateralAmount: number;
  borrowAmount: number;
  orderQuantityBase: number;
  limitPrice?: number;
  tpPrice?: number;
  slPrice?: number;
  feeMist?: bigint;
  refSharePct?: number;
}): Transaction {
  const {
    owner,
    pool: poolMeta,
    existingManagerId,
    side,
    orderStyle,
    collateralSide,
    depositCollateralAmount,
    borrowAmount,
    orderQuantityBase,
    limitPrice,
    tpPrice,
    slPrice,
    feeMist,
    refSharePct,
  } = params;

  const { pool, baseCoin, quoteCoin, baseMarginPool, quoteMarginPool } = getPoolCoins(
    poolMeta.poolName
  );
  const isLong = side === 'long';
  const ext = createDeepBookMarginClient(
    owner,
    existingManagerId ?? undefined,
    existingManagerId ? poolMeta.poolName : undefined
  );
  const db = ext.deepbook;

  const tx = new Transaction();
  tx.setSender(owner);

  const clientOrderId = BigInt(Date.now());
  const expireTimestamp = 1844674407370955161n;
  const lotAtoms = BigInt(Math.max(1, Math.round(poolMeta.lotSize * baseCoin.scalar)));
  const rawQtyAtoms = BigInt(Math.max(1, Math.round(orderQuantityBase * baseCoin.scalar)));
  const onChainQty = (rawQtyAtoms / lotAtoms) * lotAtoms || lotAtoms;
  const safeQuantityNum = Number(onChainQty) / baseCoin.scalar;

  if (!existingManagerId) {
    const { manager, initializer } = db.marginManager.newMarginManagerWithInitializer(
      poolMeta.poolName
    )(tx);

    if (depositCollateralAmount > 0) {
      tx.add(
        db.marginManager.depositDuringInitialization({
          manager,
          poolKey: poolMeta.poolName,
          coinType: collateralSide === 'base' ? pool.baseCoin : pool.quoteCoin,
          amount: depositCollateralAmount,
        })
      );
    }

    if (borrowAmount > 0) {
      const borrowAtoms = BigInt(
        Math.round(borrowAmount * (isLong ? quoteCoin.scalar : baseCoin.scalar))
      );
      tx.moveCall({
        target: `${mainnetPackageIds.MARGIN_PACKAGE_ID}::margin_manager_upgraded::${
          isLong ? 'borrow_quote' : 'borrow_base'
        }`,
        arguments: [
          manager,
          tx.object(mainnetPackageIds.MARGIN_REGISTRY_ID),
          tx.object(isLong ? quoteMarginPool.address : baseMarginPool.address),
          tx.object(baseCoin.priceInfoObjectId!),
          tx.object(quoteCoin.priceInfoObjectId!),
          tx.object(pool.address),
          tx.pure.u64(borrowAtoms),
          tx.object('0x6'),
        ],
        typeArguments: [baseCoin.type, quoteCoin.type],
      });
    }

    if (orderStyle === 'limit' && limitPrice && limitPrice > 0) {
      const onChainPrice = BigInt(
        Math.round((limitPrice * 1e9 * quoteCoin.scalar) / baseCoin.scalar)
      );
      tx.moveCall({
        target: `${mainnetPackageIds.MARGIN_PACKAGE_ID}::pool_proxy_upgraded::place_limit_order_v2`,
        arguments: [
          tx.object(mainnetPackageIds.MARGIN_REGISTRY_ID),
          manager,
          tx.object(pool.address),
          tx.object(baseMarginPool.address),
          tx.object(quoteMarginPool.address),
          tx.object(baseCoin.priceInfoObjectId!),
          tx.object(quoteCoin.priceInfoObjectId!),
          tx.pure.u64(clientOrderId),
          tx.pure.u8(OrderType.NO_RESTRICTION),
          tx.pure.u8(SelfMatchingOptions.SELF_MATCHING_ALLOWED),
          tx.pure.u64(onChainPrice),
          tx.pure.u64(onChainQty),
          tx.pure.bool(isLong),
          tx.pure.bool(false),
          tx.pure.u64(expireTimestamp),
          tx.object('0x6'),
        ],
        typeArguments: [baseCoin.type, quoteCoin.type],
      });
    } else {
      tx.moveCall({
        target: `${mainnetPackageIds.MARGIN_PACKAGE_ID}::pool_proxy_upgraded::place_market_order_v2`,
        arguments: [
          tx.object(mainnetPackageIds.MARGIN_REGISTRY_ID),
          manager,
          tx.object(pool.address),
          tx.object(baseMarginPool.address),
          tx.object(quoteMarginPool.address),
          tx.object(baseCoin.priceInfoObjectId!),
          tx.object(quoteCoin.priceInfoObjectId!),
          tx.pure.u64(clientOrderId),
          tx.pure.u8(SelfMatchingOptions.SELF_MATCHING_ALLOWED),
          tx.pure.u64(onChainQty),
          tx.pure.bool(isLong),
          tx.pure.bool(false),
          tx.object('0x6'),
        ],
        typeArguments: [baseCoin.type, quoteCoin.type],
      });
    }

    appendConditionalTpSl({
      tx,
      db,
      managerArg: manager,
      isNewManager: true,
      poolKey: poolMeta.poolName,
      baseType: baseCoin.type,
      quoteType: quoteCoin.type,
      baseOracle: baseCoin.priceInfoObjectId!,
      quoteOracle: quoteCoin.priceInfoObjectId!,
      poolAddress: pool.address,
      isLong,
      quantity: safeQuantityNum,
      tpPrice,
      slPrice,
    });

    tx.add(db.marginManager.shareMarginManager(poolMeta.poolName, manager, initializer));
  } else {
    if (depositCollateralAmount > 0) {
      if (collateralSide === 'base') {
        tx.add(
          db.marginManager.depositBase({
            managerKey: 'MAIN',
            amount: depositCollateralAmount,
          })
        );
      } else {
        tx.add(
          db.marginManager.depositQuote({
            managerKey: 'MAIN',
            amount: depositCollateralAmount,
          })
        );
      }
    }

    if (borrowAmount > 0) {
      if (isLong) {
        tx.add(db.marginManager.borrowQuote('MAIN', borrowAmount));
      } else {
        tx.add(db.marginManager.borrowBase('MAIN', borrowAmount));
      }
    }

    if (orderStyle === 'limit' && limitPrice && limitPrice > 0) {
      tx.add(
        db.poolProxy.placeLimitOrder({
          poolKey: poolMeta.poolName,
          marginManagerKey: 'MAIN',
          clientOrderId: clientOrderId.toString(),
          price: limitPrice,
          quantity: safeQuantityNum,
          isBid: isLong,
          orderType: OrderType.NO_RESTRICTION,
          selfMatchingOption: SelfMatchingOptions.SELF_MATCHING_ALLOWED,
          payWithDeep: false,
        })
      );
    } else {
      tx.add(
        db.poolProxy.placeMarketOrder({
          poolKey: poolMeta.poolName,
          marginManagerKey: 'MAIN',
          clientOrderId: clientOrderId.toString(),
          quantity: safeQuantityNum,
          isBid: isLong,
          selfMatchingOption: SelfMatchingOptions.SELF_MATCHING_ALLOWED,
          payWithDeep: false,
        })
      );
    }

    appendConditionalTpSl({
      tx,
      db,
      managerArg: existingManagerId,
      isNewManager: false,
      poolKey: poolMeta.poolName,
      baseType: baseCoin.type,
      quoteType: quoteCoin.type,
      baseOracle: baseCoin.priceInfoObjectId!,
      quoteOracle: quoteCoin.priceInfoObjectId!,
      poolAddress: pool.address,
      isLong,
      quantity: safeQuantityNum,
      tpPrice,
      slPrice,
    });
  }

  if (feeMist && feeMist > 0n) {
    appendVoltFeeCoinSplit(tx, tx.gas, feeMist, owner, refSharePct ?? 0.25);
  }

  return tx;
}

/** Places a reduce-only market order and immediately repays margin loan proceeds in 1 TX. */
export function buildMarginCloseAndRepayTx(params: {
  owner: string;
  pool: DeepBookPoolMeta;
  managerId: string;
  closeDirection: 'sellBaseToRepayQuote' | 'buyBaseToRepayBase';
  quantityBase: number;
  feeMist?: bigint;
  refSharePct?: number;
}): Transaction {
  const { owner, pool, managerId, closeDirection, quantityBase, feeMist, refSharePct } = params;
  const ext = createDeepBookMarginClient(owner, managerId, pool.poolName);
  const db = ext.deepbook;
  const tx = new Transaction();
  tx.setSender(owner);

  tx.add(db.poolProxy.withdrawSettledAmounts('MAIN'));
  tx.add(
    db.poolProxy.placeReduceOnlyMarketOrderAndRepayLoan({
      poolKey: pool.poolName,
      marginManagerKey: 'MAIN',
      clientOrderId: Date.now().toString(),
      quantity: quantityBase,
      isBid: closeDirection === 'buyBaseToRepayBase',
      selfMatchingOption: SelfMatchingOptions.SELF_MATCHING_ALLOWED,
      payWithDeep: false,
    })
  );

  if (feeMist && feeMist > 0n) {
    appendVoltFeeCoinSplit(tx, tx.gas, feeMist, owner, refSharePct ?? 0.25);
  }
  return tx;
}

/** Repays full or partial base/quote debt inside an existing MarginManager. */
export function buildMarginRepayTx(params: {
  owner: string;
  pool: DeepBookPoolMeta;
  managerId: string;
  debtSide: 'base' | 'quote';
  amount?: number;
}): Transaction {
  const { owner, pool, managerId, debtSide, amount } = params;
  const ext = createDeepBookMarginClient(owner, managerId, pool.poolName);
  const db = ext.deepbook;
  const tx = new Transaction();
  tx.setSender(owner);
  tx.add(db.poolProxy.withdrawSettledAmounts('MAIN'));
  if (debtSide === 'base') {
    tx.add(db.marginManager.repayBase('MAIN', amount));
  } else {
    tx.add(db.marginManager.repayQuote('MAIN', amount));
  }
  return tx;
}

/** Withdraws free base or quote collateral from a MarginManager back to the owner wallet. */
export function buildMarginWithdrawCollateralTx(params: {
  owner: string;
  pool: DeepBookPoolMeta;
  managerId: string;
  asset: 'base' | 'quote';
  amount: number;
}): Transaction {
  const { owner, pool, managerId, asset, amount } = params;
  const ext = createDeepBookMarginClient(owner, managerId, pool.poolName);
  const db = ext.deepbook;
  const tx = new Transaction();
  tx.setSender(owner);
  tx.add(db.poolProxy.withdrawSettledAmounts('MAIN'));
  const coinOut = tx.add(
    asset === 'base'
      ? db.marginManager.withdrawBase('MAIN', amount)
      : db.marginManager.withdrawQuote('MAIN', amount)
  );
  tx.transferObjects([coinOut], owner);
  return tx;
}

/** Cancels a live Margin Limit Order or clears all active conditional TP/SL orders. */
export function buildMarginCancelTx(params: {
  owner: string;
  pool: DeepBookPoolMeta;
  managerId: string;
  orderId?: string;
  clearConditionalTpSl?: boolean;
}): Transaction {
  const { owner, pool, managerId, orderId, clearConditionalTpSl } = params;
  const ext = createDeepBookMarginClient(owner, managerId, pool.poolName);
  const db = ext.deepbook;
  const tx = new Transaction();
  tx.setSender(owner);
  if (orderId) {
    tx.add(db.poolProxy.cancelOrder('MAIN', orderId));
    tx.add(db.poolProxy.withdrawSettledAmounts('MAIN'));
  }
  if (clearConditionalTpSl) {
    tx.add(db.marginTPSL.cancelAllConditionalOrders('MAIN'));
  }
  return tx;
}
