import {
  DeepBookClient,
  mainnetCoins,
  mainnetMarginPools,
  mainnetPackageIds,
} from '@mysten/deepbook-v3';
import { Transaction } from '@mysten/sui/transactions';
import { VOLT_TREASURY_ADDRESS } from './constants';
import { suiGrpcClient, USDC_COIN_TYPE } from './suiClient';

export type EarnFilterTab = 'all' | 'lending' | 'plp';

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

export interface VoltMarginSupplyReferral {
  coinKey: keyof typeof mainnetMarginPools;
  marginPoolId: string;
  referralId: string;
  owner: string;
}

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

const MARGIN_REFERRAL_CACHE_KEY = 'volt_margin_supply_referrals_v1';
let marginReferralCache: Partial<Record<keyof typeof mainnetMarginPools, VoltMarginSupplyReferral>> | null = null;

function readCachedMarginReferrals(): Partial<Record<keyof typeof mainnetMarginPools, VoltMarginSupplyReferral>> {
  if (marginReferralCache) return marginReferralCache;
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(MARGIN_REFERRAL_CACHE_KEY);
      if (raw) {
        marginReferralCache = JSON.parse(raw);
        if (marginReferralCache) return marginReferralCache;
      }
    } catch {
      // ignore storage errors
    }
  }
  return {};
}

function writeCachedMarginReferrals(map: Partial<Record<keyof typeof mainnetMarginPools, VoltMarginSupplyReferral>>) {
  marginReferralCache = map;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(MARGIN_REFERRAL_CACHE_KEY, JSON.stringify(map));
    } catch {
      // ignore storage errors
    }
  }
}

/**
 * Discovers DeepBook v3 MarginPool SupplyReferral caps created by Volt Treasury directly from Sui on-chain events.
 */
export async function fetchVoltMarginSupplyReferrals(
  owner: string = VOLT_TREASURY_ADDRESS
): Promise<Partial<Record<keyof typeof mainnetMarginPools, VoltMarginSupplyReferral>>> {
  const cached = readCachedMarginReferrals();
  try {
    const normOwner = owner.toLowerCase();
    const eventType = `${mainnetPackageIds.MARGIN_V1}::margin_pool::SupplyReferralMinted`;
    const res = await fetch('https://graphql.mainnet.sui.io/graphql', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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

    const poolIdToKey = new Map<string, keyof typeof mainnetMarginPools>();
    for (const [k, v] of Object.entries(mainnetMarginPools)) {
      if (v?.address) poolIdToKey.set(v.address.toLowerCase(), k as keyof typeof mainnetMarginPools);
    }

    const next: Partial<Record<keyof typeof mainnetMarginPools, VoltMarginSupplyReferral>> = { ...cached };
    for (const n of nodes) {
      const ev = n?.contents?.json;
      if (!ev) continue;
      if (String(ev.owner || '').toLowerCase() !== normOwner) continue;
      const coinKey = poolIdToKey.get(String(ev.margin_pool_id || '').toLowerCase());
      const refId = String(ev.supply_referral_id || '');
      if (coinKey && refId) {
        next[coinKey] = {
          coinKey,
          marginPoolId: String(ev.margin_pool_id),
          referralId: refId,
          owner: String(ev.owner),
        };
      }
    }
    writeCachedMarginReferrals(next);
    return next;
  } catch {
    return cached;
  }
}

/**
 * Mints native DeepBook v3 MarginPool SupplyReferral shared objects for Volt Treasury in a single PTB.
 */
export function buildMintMarginSupplyReferralsTx(params: {
  sender: string;
  coinKeys: Array<keyof typeof mainnetMarginPools>;
}): Transaction {
  const { sender, coinKeys } = params;
  const tx = new Transaction();
  tx.setSender(sender);

  const db = new DeepBookClient({
    client: suiGrpcClient,
    network: 'mainnet',
    address: sender,
  });

  for (const coinKey of coinKeys) {
    tx.add(db.marginPool.mintSupplyReferral(coinKey));
  }
  return tx;
}

/**
 * Withdraws earned native MarginPool supply referral fees directly to the creator treasury wallet.
 */
export function buildWithdrawMarginReferralFeesTx(params: {
  sender: string;
  referrals: Array<{ coinKey: keyof typeof mainnetMarginPools; referralId: string }>;
}): Transaction {
  const { sender, referrals } = params;
  const tx = new Transaction();
  tx.setSender(sender);

  const db = new DeepBookClient({
    client: suiGrpcClient,
    network: 'mainnet',
    address: sender,
  });

  const coins = referrals.map((r) => db.marginPool.withdrawReferralFees(r.coinKey, r.referralId)(tx));
  if (coins.length > 0) {
    tx.transferObjects(coins, sender);
  }
  return tx;
}

/**
 * Builds an atomic Sui Mainnet PTB supplying to a DeepBook v3 Margin Pool
 * at 0.00% Volt deposit fee, attributing the supply natively via DeepBook's
 * on-chain `SupplyReferral` so user principal stays 100% intact.
 */
export function buildDeepBookMarginSupplyTx(params: {
  sender: string;
  coinKey: keyof typeof mainnetMarginPools;
  coinType?: string;
  decimals?: number;
  amountHuman: number;
  existingSupplierCapId?: string | null;
  referralId?: string | null;
  feeRate?: number;
  refSharePct?: number;
}): { tx: Transaction; netDepositHuman: number } {
  const {
    sender,
    coinKey,
    amountHuman,
    existingSupplierCapId,
    referralId,
  } = params;

  const netDepositHuman = Number(amountHuman.toFixed(6));
  if (!Number.isFinite(netDepositHuman) || netDepositHuman <= 0) {
    throw new Error('Enter a positive amount to supply.');
  }

  const tx = new Transaction();
  tx.setSender(sender);

  const db = new DeepBookClient({
    client: suiGrpcClient,
    network: 'mainnet',
    address: sender,
  });

  const refArg = referralId && referralId.startsWith('0x') ? referralId : undefined;

  if (existingSupplierCapId) {
    db.marginPool.supplyToMarginPool(
      coinKey,
      tx.object(existingSupplierCapId),
      netDepositHuman,
      refArg
    )(tx);
  } else {
    const cap = db.marginPool.mintSupplierCap()(tx);
    db.marginPool.supplyToMarginPool(coinKey, cap, netDepositHuman, refArg)(tx);
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

export { USDC_COIN_TYPE };
