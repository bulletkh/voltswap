import {
  DeepBookClient,
  mainnetCoins,
  mainnetMarginPools,
  mainnetPackageIds,
} from '@mysten/deepbook-v3';
import { Transaction } from '@mysten/sui/transactions';
import { buildCetusSwapTx, fetchCetusQuote } from './cetusSwap';
import { suiGrpcClient, SUI_COIN_TYPE, USDC_COIN_TYPE } from './suiClient';
import { addCoinFeeToTx, calcFeeUnits } from './voltFee';

export type EarnFilterTab = 'onsite' | 'margin' | 'lst';

export interface DeepBookMarginVault {
  coinKey: keyof typeof mainnetMarginPools;
  symbol: string;
  name: string;
  coinType: string;
  decimals: number;
  poolAddress: string;
  logo: string;
  priceUsd: number;
  totalSupply: number;
  totalBorrow: number;
  supplyCap: number;
  tvlUsd: number;
  utilizationPct: number;
  borrowAprPct: number;
  supplyAprPct: number;
  protocolSpreadPct: number;
}

export interface UserMarginPosition {
  coinKey: string;
  supplierCapId: string;
  suppliedAmount: number;
}

export interface LstVaultOption {
  symbol: string;
  name: string;
  protocol: string;
  category: 'lst' | 'rwa';
  coinType: string;
  decimals: number;
  logo: string;
  defaultApyPct: number;
  basePayCoin: 'SUI' | 'USDC';
}

export interface LstVaultLiveStat extends LstVaultOption {
  apyPct: number;
  tvlUsd: number;
  exchangeRateToBase: number | null; // e.g., 1 haSUI = 1.084 SUI
}

export interface ExternalEcosystemPool {
  id: string;
  symbol: string;
  protocol: string;
  category: 'lending' | 'lst' | 'lp';
  tvlUsd: number;
  apyTotal: number;
  apyBase: number;
  apyReward: number;
  externalUrl: string;
}

export const LST_VAULT_OPTIONS: LstVaultOption[] = [
  {
    symbol: 'haSUI',
    name: 'Haedal Staked SUI',
    protocol: 'Haedal Liquid Staking',
    category: 'lst',
    coinType:
      '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI',
    decimals: 9,
    logo: '/tokens/hasui.png',
    defaultApyPct: 2.35,
    basePayCoin: 'SUI',
  },
  {
    symbol: 'afSUI',
    name: 'Aftermath Staked SUI',
    protocol: 'Aftermath Staking',
    category: 'lst',
    coinType:
      '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI',
    decimals: 9,
    logo: '/tokens/afsui.svg',
    defaultApyPct: 2.4,
    basePayCoin: 'SUI',
  },
  {
    symbol: 'vSUI',
    name: 'Volo Staked SUI',
    protocol: 'Volo / Navi',
    category: 'lst',
    coinType:
      '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT',
    decimals: 9,
    logo: '/tokens/vsui.png',
    defaultApyPct: 2.25,
    basePayCoin: 'SUI',
  },
  {
    symbol: 'sSUI',
    name: 'SpringSui Staked SUI',
    protocol: 'SpringSui / Suilend',
    category: 'lst',
    coinType:
      '0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI',
    decimals: 9,
    logo: '/tokens/sui.svg',
    defaultApyPct: 2.45,
    basePayCoin: 'SUI',
  },
  {
    symbol: 'USDY',
    name: 'Ondo US Dollar Yield',
    protocol: 'Ondo RWA Treasury',
    category: 'rwa',
    coinType:
      '0x960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY',
    decimals: 6,
    logo: '/tokens/ondo.png',
    defaultApyPct: 3.75,
    basePayCoin: 'USDC',
  },
  {
    symbol: 'BUCK',
    name: 'Bucket Protocol USD',
    protocol: 'Bucket Savings',
    category: 'rwa',
    coinType:
      '0xce7ff77a83ea0cb6fd39bd8748e2ec89a3f41e8efdc3f4eb123e0ca37b184db2::buck::BUCK',
    decimals: 9,
    logo: '/tokens/buck.svg',
    defaultApyPct: 3.2,
    basePayCoin: 'USDC',
  },
];

// Keep backward-compatible alias if imported elsewhere
export const SUI_LST_OPTIONS = LST_VAULT_OPTIONS;

const MARGIN_VAULT_META: Array<{
  coinKey: keyof typeof mainnetMarginPools;
  symbol: string;
  name: string;
  decimals: number;
  logo: string;
  fallbackPriceUsd: number;
}> = [
  {
    coinKey: 'USDC',
    symbol: 'USDC',
    name: 'USDC Margin Vault',
    decimals: 6,
    logo: '/tokens/usdc.svg',
    fallbackPriceUsd: 1,
  },
  {
    coinKey: 'SUI',
    symbol: 'SUI',
    name: 'SUI Margin Vault',
    decimals: 9,
    logo: '/tokens/sui.svg',
    fallbackPriceUsd: 0.81,
  },
  {
    coinKey: 'DEEP',
    symbol: 'DEEP',
    name: 'DEEP Margin Vault',
    decimals: 6,
    logo: '/tokens/deep.png',
    fallbackPriceUsd: 0.04,
  },
  {
    coinKey: 'WAL',
    symbol: 'WAL',
    name: 'WAL Margin Vault',
    decimals: 9,
    logo: '/tokens/wal.svg',
    fallbackPriceUsd: 0.12,
  },
  {
    coinKey: 'USDSUI',
    symbol: 'USDSUI',
    name: 'Sui USD Margin Vault',
    decimals: 6,
    logo: '/tokens/usdc.svg',
    fallbackPriceUsd: 1,
  },
  {
    coinKey: 'SUIUSDE',
    symbol: 'SUIUSDE',
    name: 'sUSDe Margin Vault',
    decimals: 6,
    logo: '/tokens/usdc.svg',
    fallbackPriceUsd: 1,
  },
  {
    coinKey: 'XBTC',
    symbol: 'XBTC',
    name: 'xBTC Margin Vault',
    decimals: 8,
    logo: '/tokens/btc.svg',
    fallbackPriceUsd: 69300,
  },
];

const ZERO_SENDER = '0x0000000000000000000000000000000000000000000000000000000000000000';
const SUPPLIER_CAP_TYPE = `${mainnetPackageIds.MARGIN_V1}::margin_pool::SupplierCap`;

async function fetchDeepBookCoinPrices(): Promise<Record<string, number>> {
  const prices: Record<string, number> = {
    USDC: 1,
    USDSUI: 1,
    SUIUSDE: 1,
    SUI: 0.81,
    DEEP: 0.04,
    WAL: 0.12,
    XBTC: 69300,
  };
  try {
    const res = await fetch('https://deepbook-indexer.mainnet.mystenlabs.com/summary');
    if (!res.ok) return prices;
    const rows: any[] = await res.json();
    for (const row of rows || []) {
      const pair = String(row.trading_pairs || '').toUpperCase();
      const px = Number(row.last_price || 0);
      if (!Number.isFinite(px) || px <= 0) continue;
      if (pair === 'SUI_USDC') prices.SUI = px;
      if (pair === 'DEEP_USDC') prices.DEEP = px;
      if (pair === 'WAL_USDC') prices.WAL = px;
      if (pair === 'WBTC_USDC' || pair === 'HBTC_USDC') prices.XBTC = px;
    }
  } catch {
    // keep fallback prices
  }
  return prices;
}

/**
 * Fetches live on-chain stats for all DeepBook v3 Margin Pools directly from Sui Mainnet.
 */
export async function fetchDeepBookMarginVaults(): Promise<DeepBookMarginVault[]> {
  const db = new DeepBookClient({
    client: suiGrpcClient,
    network: 'mainnet',
    address: ZERO_SENDER,
  });

  const prices = await fetchDeepBookCoinPrices();

  const settled = await Promise.allSettled(
    MARGIN_VAULT_META.map(async (meta): Promise<DeepBookMarginVault> => {
      const poolCfg = mainnetMarginPools[meta.coinKey];
      const coinCfg = (mainnetCoins as Record<string, any>)[meta.coinKey];
      const [supStr, borStr, rate, spread, capStr] = await Promise.all([
        db.getMarginPoolTotalSupply(meta.coinKey, meta.decimals),
        db.getMarginPoolTotalBorrow(meta.coinKey, meta.decimals),
        db.getMarginPoolInterestRate(meta.coinKey),
        db.getMarginPoolProtocolSpread(meta.coinKey),
        db.getMarginPoolSupplyCap(meta.coinKey, meta.decimals),
      ]);

      const totalSupply = Number(supStr || 0);
      const totalBorrow = Number(borStr || 0);
      const supplyCap = Number(capStr || 0);
      const priceUsd = prices[meta.symbol] ?? meta.fallbackPriceUsd;
      const utilRatio = totalSupply > 0 ? Math.min(1, totalBorrow / totalSupply) : 0;
      const borrowAprPct = rate * 100;
      const supplyAprPct = rate * utilRatio * Math.max(0, 1 - spread) * 100;

      return {
        coinKey: meta.coinKey,
        symbol: meta.symbol,
        name: meta.name,
        coinType: coinCfg?.type || poolCfg.type,
        decimals: meta.decimals,
        poolAddress: poolCfg.address,
        logo: meta.logo,
        priceUsd,
        totalSupply,
        totalBorrow,
        supplyCap,
        tvlUsd: totalSupply * priceUsd,
        utilizationPct: utilRatio * 100,
        borrowAprPct,
        supplyAprPct,
        protocolSpreadPct: spread * 100,
      };
    })
  );

  return settled
    .filter((r): r is PromiseFulfilledResult<DeepBookMarginVault> => r.status === 'fulfilled')
    .map((r) => r.value)
    .sort((a, b) => b.tvlUsd - a.tvlUsd);
}

/**
 * Discovers the user's owned DeepBook v3 `SupplierCap` objects and reads their
 * live on-chain deposit balances across all Margin Pools.
 */
export async function fetchUserDeepBookMarginPositions(owner: string): Promise<{
  supplierCapIds: string[];
  positions: Record<string, UserMarginPosition>;
}> {
  const owned = await suiGrpcClient.core.listOwnedObjects({
    owner,
    type: SUPPLIER_CAP_TYPE,
  });

  const supplierCapIds = (owned.objects || [])
    .map((o: any) => o?.objectId || o?.data?.objectId)
    .filter((id: any): id is string => typeof id === 'string' && id.startsWith('0x'));

  const positions: Record<string, UserMarginPosition> = {};
  if (supplierCapIds.length === 0) {
    return { supplierCapIds, positions };
  }

  const db = new DeepBookClient({
    client: suiGrpcClient,
    network: 'mainnet',
    address: owner,
  });

  await Promise.all(
    MARGIN_VAULT_META.map(async (meta) => {
      for (const capId of supplierCapIds) {
        try {
          const amtStr = await db.getUserSupplyAmount(meta.coinKey, capId, meta.decimals);
          const amt = Number(amtStr || 0);
          if (amt > 0.000001) {
            positions[meta.coinKey] = {
              coinKey: meta.coinKey,
              supplierCapId: capId,
              suppliedAmount: amt,
            };
            break;
          }
        } catch {
          // ignore if cap has no entry in this pool
        }
      }
    })
  );

  return { supplierCapIds, positions };
}

/**
 * Builds an atomic Sui Mainnet PTB supplying to a DeepBook v3 Margin Pool.
 * Reuses `existingSupplierCapId` or mints a fresh `SupplierCap` in the same PTB,
 * charging Volt Tiered Fee + Atomic Referral split on the deposited asset.
 */
export function buildDeepBookMarginSupplyTx(params: {
  sender: string;
  coinKey: keyof typeof mainnetMarginPools;
  coinType: string;
  decimals: number;
  amountHuman: number;
  existingSupplierCapId?: string | null;
  feeRate: number;
  refSharePct?: number;
}): { tx: Transaction; netDepositHuman: number } {
  const {
    sender,
    coinKey,
    coinType,
    decimals,
    amountHuman,
    existingSupplierCapId,
    feeRate,
    refSharePct = 0.25,
  } = params;

  const scalar = Math.pow(10, decimals);
  const grossAtomic = BigInt(Math.floor(amountHuman * scalar));
  if (grossAtomic <= 0n) {
    throw new Error('Enter a positive amount to supply.');
  }

  const feeAtomic = calcFeeUnits(grossAtomic, feeRate);
  const netAtomic = grossAtomic - feeAtomic;
  const netDepositHuman = Number(netAtomic) / scalar;
  if (netDepositHuman <= 0) {
    throw new Error('Amount is too small after fee deduction.');
  }

  const tx = new Transaction();
  tx.setSender(sender);

  if (feeAtomic > 0n) {
    addCoinFeeToTx(tx, {
      coinType,
      feeAtomic,
      sender,
      refSharePct,
    });
  }

  const db = new DeepBookClient({
    client: suiGrpcClient,
    network: 'mainnet',
    address: sender,
  });

  if (existingSupplierCapId) {
    db.marginPool.supplyToMarginPool(coinKey, tx.object(existingSupplierCapId), netDepositHuman)(tx);
  } else {
    const cap = db.marginPool.mintSupplierCap()(tx);
    db.marginPool.supplyToMarginPool(coinKey, cap, netDepositHuman)(tx);
    tx.transferObjects([cap], sender);
  }

  return { tx, netDepositHuman };
}

/**
 * Builds an atomic Sui Mainnet PTB withdrawing collateral + accrued interest
 * from a DeepBook v3 Margin Pool directly back to the user's wallet.
 */
export function buildDeepBookMarginWithdrawTx(params: {
  sender: string;
  coinKey: keyof typeof mainnetMarginPools;
  supplierCapId: string;
  amountHuman?: number;
  withdrawAll?: boolean;
}): Transaction {
  const { sender, coinKey, supplierCapId, amountHuman, withdrawAll } = params;
  const tx = new Transaction();
  tx.setSender(sender);

  const db = new DeepBookClient({
    client: suiGrpcClient,
    network: 'mainnet',
    address: sender,
  });

  const withdrawnCoin = db.marginPool.withdrawFromMarginPool(
    coinKey,
    tx.object(supplierCapId),
    withdrawAll ? undefined : amountHuman
  )(tx);
  tx.transferObjects([withdrawnCoin], sender);

  return tx;
}

/**
 * Fetches live APYs, TVL, and Cetus swap exchange rates for on-site LST & RWA Yield Vaults.
 */
export async function fetchLstVaultStats(): Promise<LstVaultLiveStat[]> {
  const [llamaRes, voloRes, rateQuotes] = await Promise.all([
    fetch('https://yields.llama.fi/pools').catch(() => null),
    fetch('https://open-api.naviprotocol.io/api/volo/stats').catch(() => null),
    Promise.allSettled(
      LST_VAULT_OPTIONS.map(async (opt) => {
        const baseType = opt.basePayCoin === 'USDC' ? USDC_COIN_TYPE : SUI_COIN_TYPE;
        const unit = BigInt(Math.pow(10, opt.decimals));
        const q = await fetchCetusQuote({
          fromCoinType: opt.coinType,
          toCoinType: baseType,
          amountInAtomic: unit,
          feeRate: 0,
        });
        const baseDec = opt.basePayCoin === 'USDC' ? 6 : 9;
        return Number(q.amountOutAtomic) / Math.pow(10, baseDec);
      })
    ),
  ]);

  let llamaSui: any[] = [];
  if (llamaRes?.ok) {
    const j = await llamaRes.json().catch(() => ({}));
    llamaSui = (j?.data || []).filter((p: any) => p?.chain === 'Sui');
  }

  let voloApy = 0;
  let voloTvlSui = 0;
  if (voloRes?.ok) {
    const vj = await voloRes.json().catch(() => ({}));
    voloApy = Number(vj?.data?.apy || 0) * 100;
    voloTvlSui = Number(vj?.data?.totalStaked || 0);
  }

  const findLlama = (sym: string, projHint?: string) => {
    return llamaSui
      .filter((p: any) => {
        const s = String(p.symbol || '').toUpperCase();
        const pr = String(p.project || '').toLowerCase();
        if (s !== sym.toUpperCase()) return false;
        if (projHint && !pr.includes(projHint)) return false;
        return true;
      })
      .sort((a: any, b: any) => Number(b.tvlUsd || 0) - Number(a.tvlUsd || 0))[0];
  };

  return LST_VAULT_OPTIONS.map((opt, idx) => {
    const match =
      opt.symbol === 'USDY'
        ? findLlama('USDY', 'ondo')
        : findLlama(opt.symbol);
    let apyPct = Number(match?.apy || opt.defaultApyPct);
    let tvlUsd = Number(match?.tvlUsd || 0);

    if (opt.symbol === 'vSUI' && voloApy > 0) {
      apyPct = Math.max(apyPct, voloApy);
      if (tvlUsd <= 0 && voloTvlSui > 0) tvlUsd = voloTvlSui * 0.81;
    }

    const qRes = rateQuotes[idx];
    const exchangeRateToBase =
      qRes && qRes.status === 'fulfilled' && Number.isFinite(qRes.value) && qRes.value > 0
        ? qRes.value
        : null;

    return {
      ...opt,
      apyPct: apyPct > 0 ? apyPct : opt.defaultApyPct,
      tvlUsd,
      exchangeRateToBase,
    };
  });
}

const LENDING_PROJECTS = new Set([
  'suilend',
  'current',
  'navi-lending',
  'scallop-lend',
  'alpha-lending',
  'bucket-protocol',
  'ember',
]);

const LST_PROJECTS = new Set([
  'haedal-protocol',
  'aftermath-liquid-staking',
  'volo-staked-sui',
  'springsui',
]);

function mapProtocolUrl(project: string): string {
  const p = project.toLowerCase();
  if (p.includes('suilend') || p.includes('spring') || p.includes('current'))
    return 'https://app.current.finance/lend';
  if (p.includes('navi') || p.includes('volo')) return 'https://app.naviprotocol.io';
  if (p.includes('scallop')) return 'https://app.scallop.io';
  if (p.includes('bluefin')) return 'https://trade.bluefin.io/pools';
  if (p.includes('cetus')) return 'https://app.cetus.zone/liquidity';
  if (p.includes('aftermath')) return 'https://aftermath.finance/stake';
  if (p.includes('haedal')) return 'https://haedal.xyz/stake';
  if (p.includes('bucket')) return 'https://app.bucketprotocol.io';
  if (p.includes('ember')) return 'https://app.ember.so';
  return 'https://defillama.com/chain/Sui';
}

function classifyLlamaCategory(project: string, symbol: string): 'lending' | 'lst' | 'lp' {
  const p = project.toLowerCase();
  if (LST_PROJECTS.has(p) || /HASUI|AFSUI|VSUI|SSUI/i.test(symbol)) return 'lst';
  if (LENDING_PROJECTS.has(p) || !symbol.includes('-')) return 'lending';
  return 'lp';
}

export async function fetchExternalEcosystemPools(): Promise<ExternalEcosystemPool[]> {
  const [llamaRes, cetusRes] = await Promise.all([
    fetch('https://yields.llama.fi/pools').catch(() => null),
    fetch(
      'https://api-sui.cetus.zone/v2/sui/stats_pools?is_vaults=false&order_by=-tvl&limit=20'
    ).catch(() => null),
  ]);

  const items: ExternalEcosystemPool[] = [];
  const seen = new Set<string>();

  if (llamaRes?.ok) {
    const llamaJson = await llamaRes.json().catch(() => ({}));
    const suiPools: any[] = (llamaJson?.data || []).filter(
      (p: any) =>
        p?.chain === 'Sui' &&
        Number(p?.tvlUsd || 0) >= 250_000 &&
        Number(p?.apy || 0) > 0 &&
        Number(p?.apy || 0) < 500
    );

    suiPools.sort((a, b) => Number(b.tvlUsd || 0) - Number(a.tvlUsd || 0));

    for (const p of suiPools.slice(0, 30)) {
      const sym = String(p.symbol || '').trim();
      const proj = String(p.project || 'Sui Protocol').replace(/-/g, ' ');
      const cat = classifyLlamaCategory(String(p.project || ''), sym);
      const key = `${proj.toLowerCase()}:${sym.toLowerCase()}`;
      seen.add(key);

      items.push({
        id: String(p.pool || key),
        symbol: sym,
        protocol: proj.replace(/\b\w/g, (c) => c.toUpperCase()),
        category: cat,
        tvlUsd: Number(p.tvlUsd || 0),
        apyTotal: Number(p.apy || 0),
        apyBase: Number(p.apyBase || 0),
        apyReward: Number(p.apyReward || 0),
        externalUrl: mapProtocolUrl(String(p.project || '')),
      });
    }
  }

  if (cetusRes?.ok) {
    const cetusJson = await cetusRes.json().catch(() => ({}));
    const list: any[] = cetusJson?.data?.lp_list || [];
    for (const pool of list.slice(0, 12)) {
      const symbol = `${pool.coin_a?.symbol || '?'}-${pool.coin_b?.symbol || '?'}`;
      const tvl = Number(pool.tvl_in_usd || 0);
      const apy = Number(pool.total_apr || pool.apr?.total || 0) * 100;
      if (tvl < 100_000 || apy <= 0) continue;
      const key = `cetus:${symbol.toLowerCase()}`;
      if (seen.has(key)) continue;

      items.push({
        id: String(pool.swap_account || key),
        symbol,
        protocol: 'Cetus CLMM',
        category: 'lp',
        tvlUsd: tvl,
        apyTotal: apy,
        apyBase: apy * 0.7,
        apyReward: apy * 0.3,
        externalUrl: 'https://app.cetus.zone/liquidity',
      });
    }
  }

  return items.sort((a, b) => b.tvlUsd - a.tvlUsd);
}

/**
 * Builds a single-PTB Cetus Aggregator route acquiring OR redeeming yield-bearing
 * Sui tokens (`haSUI`, `afSUI`, `vSUI`, `sSUI`, `USDY`, `BUCK`) with Volt tier fee
 * + atomic referral split directly inside VoltSwap.
 */
export async function buildEarnZapTx(params: {
  sender: string;
  inputCoinType: string;
  targetCoinType: string;
  amountInAtomic: bigint;
  slippage?: number;
  feeRate: number;
  refSharePct?: number;
}): Promise<{ tx: Transaction; expectedOutAtomic: string }> {
  const quote = await fetchCetusQuote({
    fromCoinType: params.inputCoinType,
    toCoinType: params.targetCoinType,
    amountInAtomic: params.amountInAtomic,
    feeRate: params.feeRate,
  });

  const tx = await buildCetusSwapTx({
    sender: params.sender,
    fromCoinType: params.inputCoinType,
    amountInAtomic: params.amountInAtomic,
    quote,
    slippage: params.slippage ?? 0.012,
    refSharePct: params.refSharePct ?? 0.25,
  });

  return {
    tx,
    expectedOutAtomic: quote.amountOutAtomic.toString(),
  };
}

export { USDC_COIN_TYPE };
