import { CetusClmmSDK, type Pool, type Position } from '@cetusprotocol/sui-clmm-sdk';
import {
  SuilendClient,
  LENDING_MARKET_ID,
  LENDING_MARKET_TYPE,
  calculateDepositAprPercent,
  calculateUtilizationPercent,
  decimalToBigNumber,
} from '@suilend/sdk';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeStructTag } from '@mysten/sui/utils';
import { POPULAR_TOKENS } from './constants';
import { suiGrpcClient } from './suiClient';

export interface CetusClmmPoolMeta {
  poolId: string;
  name: string;
  symbolA: string;
  symbolB: string;
  decimalsA: number;
  decimalsB: number;
  feePct: number;
  priceBaseCoin: 'coin_a' | 'coin_b';
  logoA: string;
  logoB: string;
}

export interface CetusClmmPoolLive extends CetusClmmPoolMeta {
  pool: Pool;
  currentPrice: number; // price of priceBaseCoin in terms of the other coin
  tvlUsd: number;
  volume24hUsd: number;
  feeAprPct: number;
  totalApyPct: number;
}

export interface CetusUserPositionView {
  position: Position;
  poolName: string;
  symbolA: string;
  symbolB: string;
  decimalsA: number;
  decimalsB: number;
  feeOwedA: number;
  feeOwedB: number;
  inRange: boolean;
}

export interface SuilendReserveLive {
  coinType: string;
  symbol: string;
  name: string;
  logo: string;
  decimals: number;
  priceUsd: number;
  depositAprPct: number;
  utilizationPct: number;
  tvlUsd: number;
  availableLiquidity: number;
  depositLimitUsd: number;
}

export interface SuilendUserState {
  obligationId: string | null;
  obligationOwnerCapId: string | null;
  depositsByCoinType: Record<string, number>;
}

const TOKEN_LOGO_FALLBACK: Record<string, string> = {
  SUI: '/tokens/sui.svg',
  USDC: '/tokens/usdc.svg',
  DEEP: '/tokens/deep.svg',
  WAL: '/tokens/wal.svg',
  CETUS: '/tokens/cetus.svg',
  BUCK: '/tokens/buck.svg',
  HASUI: '/tokens/hasui.svg',
  VSUI: '/tokens/vsui.png',
  AFSUI: '/tokens/afsui.svg',
  SCA: '/tokens/sca.svg',
  NS: '/tokens/ns.svg',
  SEND: '/tokens/send.svg',
  USDSUI: '/tokens/usdc.svg',
  ETH: '/tokens/eth.svg',
  WETH: '/tokens/eth.svg',
  WBTC: '/tokens/btc.svg',
  XBTC: '/tokens/btc.svg',
  LBTC: '/tokens/btc.svg',
  USDT: '/tokens/usdt.svg',
};

function resolveTokenDisplay(coinType: string): {
  symbol: string;
  name: string;
  logo: string;
} {
  const norm = normalizeStructTag(coinType);
  const found = POPULAR_TOKENS.find((t) => normalizeStructTag(t.address) === norm);
  if (found) {
    return { symbol: found.symbol, name: found.name, logo: found.logo };
  }
  const rawSym = (norm.split('::').pop() || 'TOKEN').toUpperCase();
  return {
    symbol: rawSym,
    name: `${rawSym} Reserve`,
    logo: TOKEN_LOGO_FALLBACK[rawSym] || '/tokens/sui.svg',
  };
}

export const CURATED_CETUS_POOLS: CetusClmmPoolMeta[] = [
  {
    poolId: '0x440e5e3b13b8220c5c338bb5a4291cab5c58064eaf3654c77f3e9aed5147689c',
    name: 'USDSUI / SUI (0.2%)',
    symbolA: 'USDSUI',
    symbolB: 'SUI',
    decimalsA: 6,
    decimalsB: 9,
    feePct: 0.2,
    priceBaseCoin: 'coin_b',
    logoA: '/tokens/usdc.svg',
    logoB: '/tokens/sui.svg',
  },
  {
    poolId: '0xf4238fa592c9ed7f148fd091cb2c4147cb15ad81b797115ce42971923ebf6e4c',
    name: 'WAL / SUI (0.05%)',
    symbolA: 'WAL',
    symbolB: 'SUI',
    decimalsA: 9,
    decimalsB: 9,
    feePct: 0.05,
    priceBaseCoin: 'coin_a',
    logoA: '/tokens/wal.svg',
    logoB: '/tokens/sui.svg',
  },
  {
    poolId: '0x72f5c6eef73d77de271886219a2543e7c29a33de19a6c69c5cf1899f729c3f17',
    name: 'WAL / SUI (0.25%)',
    symbolA: 'WAL',
    symbolB: 'SUI',
    decimalsA: 9,
    decimalsB: 9,
    feePct: 0.25,
    priceBaseCoin: 'coin_a',
    logoA: '/tokens/wal.svg',
    logoB: '/tokens/sui.svg',
  },
  {
    poolId: '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105',
    name: 'USDC / SUI (0.25%)',
    symbolA: 'USDC',
    symbolB: 'SUI',
    decimalsA: 6,
    decimalsB: 9,
    feePct: 0.25,
    priceBaseCoin: 'coin_b',
    logoA: '/tokens/usdc.svg',
    logoB: '/tokens/sui.svg',
  },
  {
    poolId: '0x763f63cbada3a932c46972c6c6dcf1abd8a9a73331908a1d7ef24c2232d85520',
    name: 'NS / SUI (0.25%)',
    symbolA: 'NS',
    symbolB: 'SUI',
    decimalsA: 6,
    decimalsB: 9,
    feePct: 0.25,
    priceBaseCoin: 'coin_a',
    logoA: '/tokens/ns.svg',
    logoB: '/tokens/sui.svg',
  },
  {
    poolId: '0xd978d331772a5b90d5a4781e1232d18afd12019d0c35db79e3674beeda8f9126',
    name: 'DEEP / SUI (0.05%)',
    symbolA: 'DEEP',
    symbolB: 'SUI',
    decimalsA: 6,
    decimalsB: 9,
    feePct: 0.05,
    priceBaseCoin: 'coin_a',
    logoA: '/tokens/deep.svg',
    logoB: '/tokens/sui.svg',
  },
  {
    poolId: '0xa2f4e24dc234cf024bae1bd5b1275ab5bdc7c28dd1ec84dd98c2d012bbd315f0',
    name: 'DEEP / USDC (0.05%)',
    symbolA: 'DEEP',
    symbolB: 'USDC',
    decimalsA: 6,
    decimalsB: 6,
    feePct: 0.05,
    priceBaseCoin: 'coin_a',
    logoA: '/tokens/deep.svg',
    logoB: '/tokens/usdc.svg',
  },
  {
    poolId: '0xe01243f37f712ef87e556afb9b1d03d0fae13f96d324ec912daffc339dfdcbd2',
    name: 'DEEP / SUI (0.25%)',
    symbolA: 'DEEP',
    symbolB: 'SUI',
    decimalsA: 6,
    decimalsB: 9,
    feePct: 0.25,
    priceBaseCoin: 'coin_a',
    logoA: '/tokens/deep.svg',
    logoB: '/tokens/sui.svg',
  },
  {
    poolId: '0x9e59de50d9e5979fc03ac5bcacdb581c823dbd27d63a036131e17b391f2fac88',
    name: 'USDC / ETH (0.25%)',
    symbolA: 'USDC',
    symbolB: 'ETH',
    decimalsA: 6,
    decimalsB: 8,
    feePct: 0.25,
    priceBaseCoin: 'coin_b',
    logoA: '/tokens/usdc.svg',
    logoB: '/tokens/eth.svg',
  },
  {
    poolId: '0x51e883ba7c0b566a26cbc8a94cd33eb0abd418a77cc1e60ad22fd9b1f29cd2ab',
    name: 'USDC / SUI (0.05%)',
    symbolA: 'USDC',
    symbolB: 'SUI',
    decimalsA: 6,
    decimalsB: 9,
    feePct: 0.05,
    priceBaseCoin: 'coin_b',
    logoA: '/tokens/usdc.svg',
    logoB: '/tokens/sui.svg',
  },
];

function createCetusSdk(sender?: string): CetusClmmSDK {
  const sdk = CetusClmmSDK.createSDK({
    env: 'mainnet',
    sui_client: suiGrpcClient as any,
  });
  if (sender) {
    sdk.setSenderAddress(sender);
  }
  return sdk;
}

/**
 * Computes human price from Cetus CLMM sqrt_price_x64.
 * sqrtPriceX64 / 2^64 = sqrt(rawB / rawA)
 */
function computePriceFromSqrtX64(
  sqrtPriceX64Str: string,
  decimalsA: number,
  decimalsB: number,
  priceBaseCoin: 'coin_a' | 'coin_b'
): number {
  const q64 = Math.pow(2, 64);
  const ratio = Number(sqrtPriceX64Str) / q64;
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  // price_a_in_b = (ratio^2) * 10^(decimalsA - decimalsB)
  const priceAInB = ratio * ratio * Math.pow(10, decimalsA - decimalsB);
  if (priceBaseCoin === 'coin_a') return priceAInB;
  return priceAInB > 0 ? 1 / priceAInB : 0;
}

export async function fetchCetusClmmPools(): Promise<CetusClmmPoolLive[]> {
  const sdk = createCetusSdk();

  const [geckoRes, llamaRes, onChainPools] = await Promise.all([
    fetch('https://api.geckoterminal.com/api/v2/networks/sui-network/dexes/cetus/pools?page=1')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    fetch('https://yields.llama.fi/pools')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    Promise.allSettled(CURATED_CETUS_POOLS.map((meta) => sdk.Pool.getPool(meta.poolId))),
  ]);

  const geckoByAddr: Record<string, { tvlUsd: number; vol24hUsd: number }> = {};
  for (const item of geckoRes?.data || []) {
    const addr = String(item?.attributes?.address || '').toLowerCase();
    if (!addr) continue;
    geckoByAddr[addr] = {
      tvlUsd: Number(item?.attributes?.reserve_in_usd || 0),
      vol24hUsd: Number(item?.attributes?.volume_usd?.h24 || 0),
    };
  }

  const llamaCetus = ((llamaRes?.data as any[]) || []).filter(
    (p) => p?.chain === 'Sui' && p?.project === 'cetus-clmm'
  );

  const results: CetusClmmPoolLive[] = [];
  CURATED_CETUS_POOLS.forEach((meta, idx) => {
    const settled = onChainPools[idx];
    if (settled.status !== 'fulfilled' || !settled.value) return;
    const pool = settled.value;
    const g = geckoByAddr[meta.poolId.toLowerCase()];
    const tvlUsd = g?.tvlUsd || 0;
    const volume24hUsd = g?.vol24hUsd || 0;
    const feeAprPct =
      tvlUsd > 0 ? ((volume24hUsd * (meta.feePct / 100) * 365) / tvlUsd) * 100 : 0;

    // Match DeFiLlama pool by token pair + approximate TVL/fee
    const symPair = `${meta.symbolA}-${meta.symbolB}`.toUpperCase();
    const llamaMatch = llamaCetus
      .filter((p) => String(p.symbol || '').toUpperCase() === symPair)
      .sort((a, b) => Math.abs((a.tvlUsd || 0) - tvlUsd) - Math.abs((b.tvlUsd || 0) - tvlUsd))[0];

    const totalApyPct = Math.max(feeAprPct, Number(llamaMatch?.apy || 0));
    const currentPrice = computePriceFromSqrtX64(
      String(pool.current_sqrt_price),
      meta.decimalsA,
      meta.decimalsB,
      meta.priceBaseCoin
    );

    results.push({
      ...meta,
      pool,
      currentPrice,
      tvlUsd: tvlUsd || Number(llamaMatch?.tvlUsd || 0),
      volume24hUsd,
      feeAprPct,
      totalApyPct,
    });
  });

  return results.sort((a, b) => b.totalApyPct - a.totalApyPct);
}

export async function fetchUserCetusPositions(
  owner: string,
  livePools: CetusClmmPoolLive[]
): Promise<CetusUserPositionView[]> {
  if (!owner) return [];
  const sdk = createCetusSdk(owner);
  const poolIds = livePools.map((p) => p.poolId);
  const positions = await sdk.Position.getPositionList(owner, poolIds).catch(
    () => [] as Position[]
  );
  if (!positions.length) return [];

  const feesMap = await sdk.Position.batchFetchPositionFees(
    positions.map((p) => p.pos_object_id)
  ).catch(() => ({} as Record<string, { feeOwedA: string; feeOwedB: string }>));

  return positions.map((pos) => {
    const matched = livePools.find(
      (lp) => lp.poolId.toLowerCase() === String(pos.pool).toLowerCase()
    );
    const decA = matched?.decimalsA ?? 9;
    const decB = matched?.decimalsB ?? 9;
    const feeRaw = (feesMap as any)?.[pos.pos_object_id];
    const feeOwedA = feeRaw ? Number(feeRaw.feeOwedA || 0) / Math.pow(10, decA) : 0;
    const feeOwedB = feeRaw ? Number(feeRaw.feeOwedB || 0) / Math.pow(10, decB) : 0;
    const curTick = matched?.pool?.current_tick_index ?? 0;
    const inRange = curTick >= pos.tick_lower_index && curTick <= pos.tick_upper_index;

    return {
      position: pos,
      poolName: matched?.name || 'Cetus CLMM',
      symbolA: matched?.symbolA || 'Coin A',
      symbolB: matched?.symbolB || 'Coin B',
      decimalsA: decA,
      decimalsB: decB,
      feeOwedA,
      feeOwedB,
      inRange,
    };
  });
}

export async function quoteCetusAddLiquidity(params: {
  poolMeta: CetusClmmPoolLive;
  fixedCoin: 'a' | 'b';
  amountHuman: number;
  rangeMode: 'tight' | 'balanced' | 'wide' | 'full';
  slippage?: number;
}) {
  const { poolMeta, fixedCoin, amountHuman, rangeMode, slippage = 0.01 } = params;
  const sdk = createCetusSdk();
  const decimals = fixedCoin === 'a' ? poolMeta.decimalsA : poolMeta.decimalsB;
  const coinAmountRaw = BigInt(Math.floor(amountHuman * Math.pow(10, decimals))).toString();

  let addModeParams: any;
  if (rangeMode === 'full') {
    addModeParams = { is_full_range: true };
  } else {
    const pct = rangeMode === 'tight' ? 0.1 : rangeMode === 'balanced' ? 0.25 : 0.5;
    const minP = Math.max(1e-9, poolMeta.currentPrice * (1 - pct));
    const maxP = poolMeta.currentPrice * (1 + pct);
    addModeParams = {
      is_full_range: false,
      min_price: minP.toPrecision(6),
      max_price: maxP.toPrecision(6),
      coin_decimals_a: poolMeta.decimalsA,
      coin_decimals_b: poolMeta.decimalsB,
      price_base_coin: poolMeta.priceBaseCoin,
    };
  }

  const calc = await sdk.Position.calculateAddLiquidityResultWithPrice({
    pool_id: poolMeta.poolId,
    coin_amount: coinAmountRaw,
    fix_amount_a: fixedCoin === 'a',
    slippage,
    add_mode_params: addModeParams,
  });

  return {
    calc,
    addModeParams,
    amountAHuman: Number(calc.coin_amount_a) / Math.pow(10, poolMeta.decimalsA),
    amountBHuman: Number(calc.coin_amount_b) / Math.pow(10, poolMeta.decimalsB),
  };
}

export async function buildCetusOpenAndAddLiquidityTx(params: {
  sender: string;
  poolId: string;
  calc: any;
  addModeParams: any;
}): Promise<Transaction> {
  const sdk = createCetusSdk(params.sender);
  const tx = await sdk.Position.createAddLiquidityFixCoinWithPricePayload({
    pool_id: params.poolId,
    calculate_result: params.calc,
    add_mode_params: params.addModeParams,
  });
  tx.setSender(params.sender);
  return tx;
}

export async function buildCetusCollectFeesTx(params: {
  sender: string;
  pool: Pool;
  positionId: string;
}): Promise<Transaction> {
  const sdk = createCetusSdk(params.sender);
  const tx = await sdk.Position.collectFeePayload({
    pool_id: params.pool.id,
    pos_id: params.positionId,
    coin_type_a: params.pool.coin_type_a,
    coin_type_b: params.pool.coin_type_b,
  });
  tx.setSender(params.sender);
  return tx;
}

export async function buildCetusRemoveLiquidityTx(params: {
  sender: string;
  pool: Pool;
  position: Position;
}): Promise<Transaction> {
  const sdk = createCetusSdk(params.sender);
  const tx = await sdk.Position.closePositionPayload({
    pool_id: params.pool.id,
    pos_id: params.position.pos_object_id,
    coin_type_a: params.pool.coin_type_a,
    coin_type_b: params.pool.coin_type_b,
    min_amount_a: '0',
    min_amount_b: '0',
    collect_fee: true,
    rewarder_coin_types: (params.pool.rewarder_infos || []).map((r) => r.coin_type),
  });
  tx.setSender(params.sender);
  return tx;
}

// ============================================================================
// SUILEND OFFICIAL LENDING SDK (@suilend/sdk)
// ============================================================================

export async function fetchSuilendReserves(): Promise<SuilendReserveLive[]> {
  const client = await SuilendClient.initialize(
    LENDING_MARKET_ID,
    LENDING_MARKET_TYPE,
    suiGrpcClient as any
  );

  const rawReserves: SuilendReserveLive[] = [];
  for (const r of client.lendingMarket.reserves) {
    const coinType = normalizeStructTag(r.coinType);
    if (coinType.toLowerCase().includes('::fud::fud')) continue;

    const decimals = Number(r.mintDecimals || 9);
    const scale = Math.pow(10, decimals);

    const availHuman = Number(r.availableAmount || 0) / scale;
    const borrowedHuman = decimalToBigNumber(r.borrowedAmount).toNumber() / scale;
    const totalDepositHuman = availHuman + borrowedHuman;
    const priceUsd = decimalToBigNumber(r.price).toNumber();
    const tvlUsd = totalDepositHuman * priceUsd;

    const depositAprPct = calculateDepositAprPercent(r).toNumber();
    const utilizationPct = calculateUtilizationPercent(r).toNumber();
    const depositLimitUsd = Number((r.config as any)?.element?.depositLimitUsd || 0);

    if (tvlUsd < 10_000 || depositAprPct <= 0.01) continue;

    const meta = resolveTokenDisplay(coinType);
    rawReserves.push({
      coinType,
      symbol: meta.symbol,
      name: meta.name,
      logo: meta.logo,
      decimals,
      priceUsd,
      depositAprPct,
      utilizationPct,
      tvlUsd,
      availableLiquidity: availHuman,
      depositLimitUsd,
    });
  }

  const top7 = rawReserves
    .sort((a, b) => b.depositAprPct - a.depositAprPct)
    .slice(0, 7);

  // Resolve real on-chain symbol/name for generic ::coin::COIN reserves
  await Promise.all(
    top7.map(async (item) => {
      if (item.symbol === 'COIN' || item.name.endsWith(' Reserve')) {
        try {
          const metaRes = await suiGrpcClient.core.getCoinMetadata({ coinType: item.coinType });
          const sym = metaRes?.coinMetadata?.symbol?.trim();
          const name = metaRes?.coinMetadata?.name?.trim();
          if (sym) {
            item.symbol = sym.toUpperCase();
            item.logo = TOKEN_LOGO_FALLBACK[item.symbol] || item.logo;
          }
          if (name) {
            item.name = name;
          }
        } catch {
          // ignore metadata fetch failure
        }
      }
    })
  );

  return top7;
}

export async function fetchUserSuilendPositions(owner: string): Promise<SuilendUserState> {
  if (!owner) {
    return { obligationId: null, obligationOwnerCapId: null, depositsByCoinType: {} };
  }

  const caps = await SuilendClient.getObligationOwnerCaps(
    owner,
    [LENDING_MARKET_TYPE],
    suiGrpcClient as any
  ).catch(() => []);

  if (!caps.length) {
    return { obligationId: null, obligationOwnerCapId: null, depositsByCoinType: {} };
  }

  const cap = caps[0];
  const client = await SuilendClient.initialize(
    LENDING_MARKET_ID,
    LENDING_MARKET_TYPE,
    suiGrpcClient as any
  );
  const obligation = await client.getObligation(cap.obligationId).catch(() => null);
  const depositsByCoinType: Record<string, number> = {};

  if (obligation) {
    for (const dep of obligation.deposits || []) {
      const reserve = client.lendingMarket.reserves[Number(dep.reserveArrayIndex)];
      if (!reserve) continue;
      const coinType = normalizeStructTag(reserve.coinType);
      const dec = Number(reserve.mintDecimals || 9);
      const scale = Math.pow(10, dec);
      const cTokenRatio =
        Number(reserve.ctokenSupply || 0) > 0
          ? (Number(reserve.availableAmount || 0) / scale +
              decimalToBigNumber(reserve.borrowedAmount).toNumber() / scale) /
            (Number(reserve.ctokenSupply) / scale)
          : 1;
      const depositedHuman =
        (Number(dep.depositedCtokenAmount || 0) / Math.pow(10, dec)) * cTokenRatio;
      if (depositedHuman > 1e-7) {
        depositsByCoinType[coinType] = depositedHuman;
      }
    }
  }

  return {
    obligationId: cap.obligationId,
    obligationOwnerCapId: cap.id,
    depositsByCoinType,
  };
}

export async function buildSuilendDepositTx(params: {
  sender: string;
  coinType: string;
  amountHuman: number;
  decimals: number;
  obligationOwnerCapId?: string | null;
}): Promise<Transaction> {
  const { sender, coinType, amountHuman, decimals, obligationOwnerCapId } = params;
  const client = await SuilendClient.initialize(
    LENDING_MARKET_ID,
    LENDING_MARKET_TYPE,
    suiGrpcClient as any
  );
  const tx = new Transaction();
  tx.setSender(sender);

  const rawAmount = BigInt(Math.floor(amountHuman * Math.pow(10, decimals))).toString();
  const normCoin = normalizeStructTag(coinType);

  if (obligationOwnerCapId) {
    await client.depositIntoObligation(sender, normCoin, rawAmount, tx, obligationOwnerCapId);
  } else {
    const cap = client.createObligation(tx);
    await client.depositIntoObligation(sender, normCoin, rawAmount, tx, cap);
    tx.transferObjects([cap], sender);
  }

  return tx;
}

export async function buildSuilendWithdrawTx(params: {
  sender: string;
  obligationOwnerCapId: string;
  obligationId: string;
  coinType: string;
  amountHuman: number;
  decimals: number;
}): Promise<Transaction> {
  const { sender, obligationOwnerCapId, obligationId, coinType, amountHuman, decimals } = params;
  const client = await SuilendClient.initialize(
    LENDING_MARKET_ID,
    LENDING_MARKET_TYPE,
    suiGrpcClient as any
  );
  const tx = new Transaction();
  tx.setSender(sender);

  const rawAmount = BigInt(Math.floor(amountHuman * Math.pow(10, decimals))).toString();
  await client.withdrawAndSendToUser(
    sender,
    obligationOwnerCapId,
    obligationId,
    normalizeStructTag(coinType),
    rawAmount,
    tx
  );

  return tx;
}
