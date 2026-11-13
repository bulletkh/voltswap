import { Transaction } from '@mysten/sui/transactions';
import { buildCetusSwapTx, fetchCetusQuote } from './cetusSwap';
import { USDC_COIN_TYPE } from './suiClient';

export type EarnCategory = 'all' | 'lending' | 'lst' | 'lp';

export interface SuiYieldOpportunity {
  id: string;
  symbol: string;
  protocol: string;
  category: Exclude<EarnCategory, 'all'>;
  tvlUsd: number;
  apyTotal: number;
  apyBase: number;
  apyReward: number;
  volume24hUsd: number;
  externalUrl: string;
}

export interface LstOption {
  symbol: string;
  name: string;
  protocol: string;
  coinType: string;
  decimals: number;
  logo: string;
}

export const SUI_LST_OPTIONS: LstOption[] = [
  {
    symbol: 'haSUI',
    name: 'Haedal Staked SUI',
    protocol: 'Haedal',
    coinType: '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI',
    decimals: 9,
    logo: '/tokens/hasui.png',
  },
  {
    symbol: 'afSUI',
    name: 'Aftermath Staked SUI',
    protocol: 'Aftermath',
    coinType: '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI',
    decimals: 9,
    logo: '/tokens/afsui.svg',
  },
  {
    symbol: 'vSUI',
    name: 'Volo Staked SUI',
    protocol: 'Volo / Navi',
    coinType: '0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT',
    decimals: 9,
    logo: '/tokens/sui.svg',
  },
  {
    symbol: 'BUCK',
    name: 'Bucket USD Savings',
    protocol: 'Bucket',
    coinType: '0xce7ff77a83ea0cb6fd39bd8748e2ec89a3f41e8efdc3f4eb123e0ca37b184db2::buck::BUCK',
    decimals: 9,
    logo: '/tokens/buck.svg',
  },
];

const LENDING_PROJECTS = new Set([
  'suilend',
  'navi-lending',
  'scallop-lend',
  'alpha-lending',
  'bucket-protocol',
]);

const LST_PROJECTS = new Set([
  'haedal-protocol',
  'aftermath-liquid-staking',
  'volo-staked-sui',
  'springsui',
]);

function mapProtocolUrl(project: string): string {
  const p = project.toLowerCase();
  if (p.includes('suilend') || p.includes('spring')) return 'https://suilend.fi';
  if (p.includes('navi') || p.includes('volo')) return 'https://app.naviprotocol.io';
  if (p.includes('scallop')) return 'https://app.scallop.io';
  if (p.includes('bluefin')) return 'https://trade.bluefin.io/pools';
  if (p.includes('cetus')) return 'https://app.cetus.zone/liquidity';
  if (p.includes('aftermath')) return 'https://aftermath.finance/stake';
  if (p.includes('haedal')) return 'https://haedal.xyz/stake';
  if (p.includes('bucket')) return 'https://app.bucketprotocol.io';
  return 'https://defillama.com/chain/Sui';
}

function classifyLlamaCategory(project: string, symbol: string): Exclude<EarnCategory, 'all'> {
  const p = project.toLowerCase();
  if (LST_PROJECTS.has(p) || /HASUI|AFSUI|VSUI|SSUI/i.test(symbol)) return 'lst';
  if (LENDING_PROJECTS.has(p) || !symbol.includes('-')) return 'lending';
  return 'lp';
}

export async function fetchSuiYieldOpportunities(): Promise<SuiYieldOpportunity[]> {
  const [llamaRes, cetusRes] = await Promise.all([
    fetch('https://yields.llama.fi/pools').catch(() => null),
    fetch(
      'https://api-sui.cetus.zone/v2/sui/stats_pools?is_vaults=false&order_by=-tvl&limit=20'
    ).catch(() => null),
  ]);

  const items: SuiYieldOpportunity[] = [];
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

    for (const p of suiPools.slice(0, 35)) {
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
        volume24hUsd: Number(p.volumeUsd1d || 0),
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
        volume24hUsd: Number(pool.vol_in_usd_24h || 0),
        externalUrl: 'https://app.cetus.zone/liquidity',
      });
    }
  }

  return items.sort((a, b) => b.tvlUsd - a.tvlUsd);
}

/**
 * Builds a single-PTB Cetus Aggregator route converting SUI or USDC into a yield-bearing Sui asset
 * (haSUI, afSUI, vSUI, BUCK) with Volt tier fee + instant atomic referral split.
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
    slippage: params.slippage ?? 0.01,
    refSharePct: params.refSharePct ?? 0.25,
  });

  return {
    tx,
    expectedOutAtomic: quote.amountOutAtomic.toString(),
  };
}

export { USDC_COIN_TYPE };
