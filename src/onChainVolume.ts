import { useCallback, useEffect, useState } from 'react';
import { mainnetCoins, mainnetPools } from '@mysten/deepbook-v3';
import { MAINNET_CONFIG } from '@mysten/deepbook-v3/predict';
import { fetchAftermathAccountState, fetchAftermathOrderHistory } from './aftermathPerps';
import { POPULAR_TOKENS, VOLT_TREASURY_ADDRESS } from './constants';
import { DEFAULT_DEEPBOOK_POOLS, DEEPBOOK_INDEXER, fetchDeepBookPools } from './deepbookV3';
import { rpcFetchGraphql, safeNormalizeAddress, safeNormalizeCoinType, SUI_COIN_TYPE } from './suiClient';
import {
  getWalletVolumeUsd,
  setSyncedWalletVolume,
  VOLT_VOLUME_EVENT,
  VOLT_VOLUME_RECORDED_EVENT,
} from './voltFee';

export interface OnChainTradeEntry {
  digest: string;
  timestampMs: number;
  channel: 'Swap' | 'Spot CLOB' | 'Margin 4.5x' | 'Perps' | 'Predict' | 'Earn';
  label: string;
  volumeUsd: number;
}

export interface OnChainReferralPayout {
  digest: string;
  timestampMs: number;
  traderAddress: string;
  coinSymbol: string;
  amount: number;
  usdValue: number;
}

export interface OnChainVolumeSummary {
  walletAddress: string;
  totalVolumeUsd: number;
  spotSwapVolumeUsd: number;
  clobVolumeUsd: number;
  marginVolumeUsd: number;
  perpsVolumeUsd: number;
  predictVolumeUsd: number;
  earnVolumeUsd: number;
  txScannedCount: number;
  trades: OnChainTradeEntry[];
  referralPayouts: OnChainReferralPayout[];
  referralEarnedUsd: number;
  fetchedAt: number;
  source: 'onchain';
}

interface CoinPriceEntry {
  symbol: string;
  decimals: number;
  priceUsd: number;
  isStable: boolean;
}

interface PoolLookupEntry {
  poolName: string;
  baseSymbol: string;
  quoteSymbol: string;
  baseDecimals: number;
  quoteDecimals: number;
  baseCoinType: string;
  quoteCoinType: string;
}

const STABLE_SYMBOLS = new Set([
  'USDC',
  'WUSDC',
  'USDT',
  'AUSD',
  'FDUSD',
  'BUCK',
  'USDSUI',
  'SUIUSDE',
]);

const SUMMARY_TTL_MS = 45_000;
const ONCHAIN_CACHE = new Map<string, OnChainVolumeSummary>();
const IN_FLIGHT_FETCH = new Map<string, Promise<OnChainVolumeSummary>>();
const DELAYED_TIMERS = new Map<string, ReturnType<typeof setTimeout>>();

let cachedLivePrices: Record<string, number> | null = null;
let livePricesFetchedAt = 0;

async function fetchLivePriceOverrides(): Promise<Record<string, number>> {
  const now = Date.now();
  if (cachedLivePrices && now - livePricesFetchedAt < 60_000) {
    return cachedLivePrices;
  }
  const overrides: Record<string, number> = {};
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);
    const res = await fetch(`${DEEPBOOK_INDEXER}/summary`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows)) {
        for (const r of rows) {
          const pair = String(r?.trading_pairs || '');
          const price = Number(r?.last_price || 0);
          if (!pair || !(price > 0)) continue;
          const [base, quote] = pair.split('_');
          if (quote === 'USDC' && base) {
            overrides[base.toUpperCase()] = price;
          }
        }
      }
    }
  } catch {
    // Fallback quietly to POPULAR_TOKENS static prices
  }
  cachedLivePrices = overrides;
  livePricesFetchedAt = now;
  return overrides;
}

function buildCoinMap(priceOverrides: Record<string, number>): Map<string, CoinPriceEntry> {
  const map = new Map<string, CoinPriceEntry>();
  const symbolPrice = new Map<string, number>();

  for (const t of POPULAR_TOKENS) {
    if (t.chain !== 'sui') continue;
    const sym = t.symbol.toUpperCase();
    const live = priceOverrides[sym];
    const priceUsd = live && live > 0 ? live : STABLE_SYMBOLS.has(sym) ? 1 : t.priceUsd || 0;
    if (priceUsd > 0 && !symbolPrice.has(sym)) {
      symbolPrice.set(sym, priceUsd);
    }
    const norm = safeNormalizeCoinType(t.address).toLowerCase();
    map.set(norm, {
      symbol: t.symbol,
      decimals: t.decimals,
      priceUsd,
      isStable: STABLE_SYMBOLS.has(sym),
    });
  }

  for (const [key, info] of Object.entries(mainnetCoins as Record<string, any>)) {
    if (!info?.type) continue;
    const norm = safeNormalizeCoinType(info.type).toLowerCase();
    const decimals = Math.round(Math.log10(Number(info.scalar || 1_000_000)));
    const sym = String(key).toUpperCase();
    const priceUsd =
      priceOverrides[sym] ||
      symbolPrice.get(sym) ||
      (STABLE_SYMBOLS.has(sym) ? 1 : 0);
    if (!map.has(norm)) {
      map.set(norm, {
        symbol: sym,
        decimals: decimals > 0 ? decimals : 9,
        priceUsd,
        isStable: STABLE_SYMBOLS.has(sym),
      });
    } else if (priceUsd > 0 && map.get(norm)!.priceUsd === 0) {
      map.get(norm)!.priceUsd = priceUsd;
    }
  }

  return map;
}

function buildPoolLookup(dynamicPools: typeof DEFAULT_DEEPBOOK_POOLS): Map<string, PoolLookupEntry> {
  const map = new Map<string, PoolLookupEntry>();
  for (const p of dynamicPools) {
    map.set(p.poolId.toLowerCase(), {
      poolName: p.poolName,
      baseSymbol: p.baseSymbol,
      quoteSymbol: p.quoteSymbol,
      baseDecimals: p.baseDecimals,
      quoteDecimals: p.quoteDecimals,
      baseCoinType: safeNormalizeCoinType(p.baseCoinId).toLowerCase(),
      quoteCoinType: safeNormalizeCoinType(p.quoteCoinId).toLowerCase(),
    });
  }

  for (const [poolName, sdkPool] of Object.entries(mainnetPools as Record<string, any>)) {
    if (!sdkPool?.address) continue;
    const key = String(sdkPool.address).toLowerCase();
    if (map.has(key)) continue;
    const bc = (mainnetCoins as Record<string, any>)[sdkPool.baseCoin];
    const qc = (mainnetCoins as Record<string, any>)[sdkPool.quoteCoin];
    if (!bc?.type || !qc?.type) continue;
    map.set(key, {
      poolName,
      baseSymbol: String(sdkPool.baseCoin),
      quoteSymbol: String(sdkPool.quoteCoin),
      baseDecimals: Math.round(Math.log10(Number(bc.scalar || 1e9))),
      quoteDecimals: Math.round(Math.log10(Number(qc.scalar || 1e6))),
      baseCoinType: safeNormalizeCoinType(bc.type).toLowerCase(),
      quoteCoinType: safeNormalizeCoinType(qc.type).toLowerCase(),
    });
  }
  return map;
}

interface GqlTxNode {
  digest: string;
  sender?: { address?: string };
  effects?: {
    status?: string;
    timestamp?: string;
    balanceChanges?: {
      nodes?: Array<{
        owner?: { address?: string };
        coinType?: { repr?: string };
        amount?: string;
      }>;
    };
    events?: {
      nodes?: Array<{
        contents?: {
          type?: { repr?: string };
          json?: Record<string, any>;
        };
      }>;
    };
  };
}

async function fetchSentTransactions(walletAddr: string, maxPages = 2): Promise<GqlTxNode[]> {
  const query = `query($a: SuiAddress!, $before: String) {
    transactions(filter: { sentAddress: $a }, last: 50, before: $before) {
      pageInfo { hasPreviousPage startCursor }
      nodes {
        digest
        effects {
          status
          timestamp
          balanceChanges {
            nodes {
              owner { address }
              coinType { repr }
              amount
            }
          }
          events {
            nodes {
              contents { type { repr } json }
            }
          }
        }
      }
    }
  }`;

  const collected: GqlTxNode[] = [];
  const seen = new Set<string>();
  let before: string | null = null;

  for (let page = 0; page < maxPages; page += 1) {
    const data: any = await rpcFetchGraphql<any>(
      query,
      before ? { a: walletAddr, before } : { a: walletAddr }
    ).catch(() => null);
    const conn = data?.transactions;
    const nodes: GqlTxNode[] = Array.isArray(conn?.nodes) ? conn.nodes : [];
    for (const n of nodes) {
      if (n?.digest && !seen.has(n.digest)) {
        seen.add(n.digest);
        collected.push(n);
      }
    }
    if (!conn?.pageInfo?.hasPreviousPage || !conn?.pageInfo?.startCursor) break;
    before = String(conn.pageInfo.startCursor);
  }

  return collected;
}

async function fetchIncomingAffectedTransactions(walletAddr: string): Promise<GqlTxNode[]> {
  const query = `query($a: SuiAddress!) {
    transactions(filter: { affectedAddress: $a }, last: 30) {
      nodes {
        digest
        sender { address }
        effects {
          status
          timestamp
          balanceChanges {
            nodes {
              owner { address }
              coinType { repr }
              amount
            }
          }
          events {
            nodes {
              contents { type { repr } }
            }
          }
        }
      }
    }
  }`;

  const data: any = await rpcFetchGraphql<any>(query, { a: walletAddr }).catch(() => null);
  return Array.isArray(data?.transactions?.nodes) ? data.transactions.nodes : [];
}

function parseSignedAmount(raw: string | undefined, decimals: number): number {
  if (!raw) return 0;
  try {
    const n = BigInt(raw);
    const sign = n < 0n ? -1 : 1;
    const abs = n < 0n ? -n : n;
    return sign * (Number(abs) / Math.pow(10, decimals));
  } catch {
    return 0;
  }
}

function estimateCoinDeltaUsd(
  coinTypeRaw: string,
  rawAmount: string | undefined,
  coinMap: Map<string, CoinPriceEntry>
): { symbol: string; amount: number; usd: number; isStable: boolean; isSui: boolean } {
  const norm = safeNormalizeCoinType(coinTypeRaw).toLowerCase();
  const entry = coinMap.get(norm);
  const suiNorm = safeNormalizeCoinType(SUI_COIN_TYPE).toLowerCase();
  const isSui = norm === suiNorm;
  const fallbackSym = coinTypeRaw.split('::').pop() || 'COIN';
  const decimals = entry?.decimals ?? (isSui ? 9 : fallbackSym.toUpperCase().includes('USD') ? 6 : 9);
  const symbol = entry?.symbol ?? fallbackSym;
  const isStable = entry?.isStable ?? STABLE_SYMBOLS.has(symbol.toUpperCase());
  const priceUsd = entry?.priceUsd ?? (isStable ? 1 : 0);
  const amount = parseSignedAmount(rawAmount, decimals);
  return {
    symbol,
    amount,
    usd: Math.abs(amount) * priceUsd,
    isStable,
    isSui,
  };
}

/**
 * Queries Sui Mainnet GraphQL + Aftermath Perpetuals order history to derive
 * persistent, device-independent trading volume and affiliate payouts.
 */
export async function fetchOnChainWalletSummary(
  walletAddress: string,
  force = false
): Promise<OnChainVolumeSummary> {
  const normAddr = safeNormalizeAddress(walletAddress) || walletAddress;
  const key = normAddr.toLowerCase();

  const cached = ONCHAIN_CACHE.get(key);
  if (!force && cached && Date.now() - cached.fetchedAt < SUMMARY_TTL_MS) {
    return cached;
  }
  const existingFlight = IN_FLIGHT_FETCH.get(key);
  if (existingFlight) return existingFlight;

  const task = (async (): Promise<OnChainVolumeSummary> => {
    const [priceOverrides, dynamicPools, sentTxs, affectedTxs, afState] = await Promise.all([
      fetchLivePriceOverrides(),
      fetchDeepBookPools().catch(() => DEFAULT_DEEPBOOK_POOLS),
      fetchSentTransactions(normAddr, 2),
      fetchIncomingAffectedTransactions(normAddr),
      fetchAftermathAccountState(normAddr).catch(() => null),
    ]);

    const afOrders = afState?.accountId
      ? await fetchAftermathOrderHistory(afState.accountId, 100).catch(() => [])
      : [];

    const coinMap = buildCoinMap(priceOverrides);
    const poolMap = buildPoolLookup(dynamicPools);
    const treasuryNorm = VOLT_TREASURY_ADDRESS.toLowerCase();
    const predictPkgV1 = (MAINNET_CONFIG.packages.predictV1 || '').toLowerCase();
    const predictOrdersPkg = (MAINNET_CONFIG.packages.predictOrdersV1 || '').toLowerCase();

    const trades: OnChainTradeEntry[] = [];
    const perpsDigests = new Set<string>();

    let perpsVolumeUsd = 0;
    for (const ord of afOrders) {
      const size = Math.abs(Number(ord.size || 0));
      const price = Number(ord.price || 0);
      const isFill =
        ord.eventType.toLowerCase().includes('filled') ||
        (size > 0 && price > 0 && !ord.eventType.toLowerCase().includes('cancel'));
      if (!isFill || !(size > 0 && price > 0)) continue;

      const notional = size * price;
      perpsVolumeUsd += notional;
      if (ord.txDigest) perpsDigests.add(ord.txDigest);
      trades.push({
        digest: ord.txDigest || `af-${ord.timestamp}`,
        timestampMs: Number(ord.timestamp || 0),
        channel: 'Perps',
        label: `Aftermath Perp ${ord.side === 1 ? 'Short' : 'Long'} (${size.toFixed(2)})`,
        volumeUsd: notional,
      });
    }

    let spotSwapVolumeUsd = 0;
    let clobVolumeUsd = 0;
    let marginVolumeUsd = 0;
    let predictVolumeUsd = 0;
    let earnVolumeUsd = 0;

    for (const tx of sentTxs) {
      if (tx.effects?.status !== 'SUCCESS' || !tx.digest || perpsDigests.has(tx.digest)) continue;
      const timestampMs = tx.effects?.timestamp ? Date.parse(tx.effects.timestamp) || 0 : 0;
      const events = tx.effects?.events?.nodes || [];
      const bcs = (tx.effects?.balanceChanges?.nodes || []).filter(
        (b) => String(b?.owner?.address || '').toLowerCase() === key
      );
      const evTypes = events.map((e) => String(e?.contents?.type?.repr || ''));

      // 1. Aftermath Perps fill fallback (if older than 100 orders window)
      const perpFills = events.filter((e) => {
        const t = String(e?.contents?.type?.repr || '');
        return t.includes('::events::FilledTakerOrder') || t.includes('::events::FilledMakerOrder');
      });
      if (perpFills.length > 0) {
        let txPerpUsd = 0;
        for (const pf of perpFills) {
          const j = pf?.contents?.json || {};
          const qBid = Number(j.quote_asset_delta_bid || 0) / 1e18;
          const qAsk = Number(j.quote_asset_delta_ask || 0) / 1e18;
          txPerpUsd += Math.max(Math.abs(qBid), Math.abs(qAsk));
        }
        if (txPerpUsd > 0.01) {
          perpsVolumeUsd += txPerpUsd;
          trades.push({
            digest: tx.digest,
            timestampMs,
            channel: 'Perps',
            label: 'Aftermath Perp Fill',
            volumeUsd: txPerpUsd,
          });
          continue;
        }
      }

      // 2. DeepBook v3 Spot CLOB & Margin 4.5x OrderFilled events
      const dbFills = events.filter((e) =>
        String(e?.contents?.type?.repr || '').includes('::order_info::OrderFilled')
      );
      if (dbFills.length > 0) {
        const isMarginTx = evTypes.some(
          (t) => t.includes('::margin_manager') || t.includes('margin_manager_upgraded')
        );
        let txDbUsd = 0;
        let pairLabel = 'DeepBook CLOB';
        for (const df of dbFills) {
          const j = df?.contents?.json || {};
          const poolId = String(j.pool_id || '').toLowerCase();
          const poolMeta = poolMap.get(poolId);
          if (poolMeta) {
            pairLabel = `${poolMeta.baseSymbol}/${poolMeta.quoteSymbol}`;
            const quoteCoin = coinMap.get(poolMeta.quoteCoinType);
            const baseCoin = coinMap.get(poolMeta.baseCoinType);
            const quoteAmt = Number(j.quote_quantity || 0) / Math.pow(10, poolMeta.quoteDecimals);
            const baseAmt = Number(j.base_quantity || 0) / Math.pow(10, poolMeta.baseDecimals);
            const qUsd = quoteCoin ? quoteAmt * quoteCoin.priceUsd : 0;
            const bUsd = baseCoin ? baseAmt * baseCoin.priceUsd : 0;
            txDbUsd += qUsd > 0 ? qUsd : bUsd;
          } else {
            // Fallback USDC-quoted assumption if pool unknown
            const rawQuote = Number(j.quote_quantity || 0) / 1e6;
            if (rawQuote > 0 && rawQuote < 10_000_000) txDbUsd += rawQuote;
          }
        }
        if (txDbUsd > 0.01) {
          if (isMarginTx) {
            marginVolumeUsd += txDbUsd;
          } else {
            clobVolumeUsd += txDbUsd;
          }
          trades.push({
            digest: tx.digest,
            timestampMs,
            channel: isMarginTx ? 'Margin 4.5x' : 'Spot CLOB',
            label: `${pairLabel} Fill`,
            volumeUsd: txDbUsd,
          });
          continue;
        }
      }

      // 3. DeepBook Predict Mint / Enqueue
      const isPredictOrder = evTypes.some(
        (t) =>
          t.includes('::queue_events::OrderEnqueued') ||
          (Boolean(predictOrdersPkg) && t.toLowerCase().includes(predictOrdersPkg) && t.toLowerCase().includes('enqueue')) ||
          (Boolean(predictPkgV1) && t.toLowerCase().includes(predictPkgV1) && t.toLowerCase().includes('mint'))
      );
      if (isPredictOrder) {
        const parsedBcs = bcs.map((b) =>
          estimateCoinDeltaUsd(String(b?.coinType?.repr || ''), b?.amount, coinMap)
        );
        const usdcSpend = parsedBcs
          .filter((d) => d.isStable && d.amount < 0)
          .reduce((s, d) => s + Math.abs(d.usd), 0);
        const vol = usdcSpend > 0.05 ? usdcSpend : 0;
        if (vol > 0) {
          predictVolumeUsd += vol;
          trades.push({
            digest: tx.digest,
            timestampMs,
            channel: 'Predict',
            label: 'DeepBook Predict Order',
            volumeUsd: vol,
          });
          continue;
        }
      }

      // 4. DEX Aggregator Swaps & Earn Zaps (Cetus / Aftermath Spot / Turbos / FlowX / MarginPool)
      const isSwapTx = evTypes.some(
        (t) =>
          t.includes('::SwapEvent') ||
          t.includes('ConfirmSwapEvent') ||
          t.includes('::AssetSwap') ||
          t.includes('::swap_v')
      );
      const isMarginSupplyTx = evTypes.some(
        (t) => t.includes('::margin_pool::') && (t.includes('Supplied') || t.includes('Deposit'))
      );

      if (isSwapTx || isMarginSupplyTx) {
        const parsed = bcs.map((b) =>
          estimateCoinDeltaUsd(String(b?.coinType?.repr || ''), b?.amount, coinMap)
        );
        const stableLeg = parsed.find((d) => d.isStable && Math.abs(d.usd) > 0.01);
        const nonSuiPriced = parsed.find((d) => !d.isSui && d.usd > 0.01);
        const maxPriced = parsed.reduce((mx, d) => {
          const val = d.isSui && d.amount < 0 ? Math.max(0, d.usd - 0.015) : d.usd;
          return val > mx ? val : mx;
        }, 0);

        const swapUsd = stableLeg ? stableLeg.usd : nonSuiPriced ? nonSuiPriced.usd : maxPriced;
        if (swapUsd > 0.02) {
          const inTok = parsed.find((d) => d.amount < 0);
          const outTok = parsed.find((d) => d.amount > 0);
          if (isMarginSupplyTx && !isSwapTx) {
            earnVolumeUsd += swapUsd;
            trades.push({
              digest: tx.digest,
              timestampMs,
              channel: 'Earn',
              label: `Supply ${inTok?.symbol || 'Asset'}`,
              volumeUsd: swapUsd,
            });
          } else {
            spotSwapVolumeUsd += swapUsd;
            trades.push({
              digest: tx.digest,
              timestampMs,
              channel: 'Swap',
              label:
                inTok && outTok
                  ? `${inTok.symbol} → ${outTok.symbol}`
                  : isMarginSupplyTx
                    ? 'LST / Earn Zap'
                    : 'Market Swap',
              volumeUsd: swapUsd,
            });
          }
        }
      }
    }

    // 5. On-Chain Affiliate Fee Rev-Share Payouts (transactions sent by OTHER traders paying this wallet)
    const referralPayouts: OnChainReferralPayout[] = [];
    let referralEarnedUsd = 0;

    for (const tx of affectedTxs) {
      if (tx.effects?.status !== 'SUCCESS' || !tx.digest) continue;
      const sender = safeNormalizeAddress(tx.sender?.address)?.toLowerCase() || '';
      if (!sender || sender === key) continue;

      const allBcs = tx.effects?.balanceChanges?.nodes || [];
      const evTypes = (tx.effects?.events?.nodes || []).map((e) =>
        String(e?.contents?.type?.repr || '')
      );
      const treasuryReceived =
        key !== treasuryNorm &&
        allBcs.some(
          (b) =>
            String(b?.owner?.address || '').toLowerCase() === treasuryNorm &&
            BigInt(b?.amount || '0') > 0n
        );
      const isTradeSplitTx =
        treasuryReceived ||
        evTypes.some(
          (t) =>
            t.includes('::SwapEvent') ||
            t.includes('ConfirmSwapEvent') ||
            t.includes('::order_info::Order') ||
            t.includes('::FilledTakerOrder')
        );
      if (!isTradeSplitTx) continue;

      const timestampMs = tx.effects?.timestamp ? Date.parse(tx.effects.timestamp) || 0 : 0;
      for (const b of allBcs) {
        if (String(b?.owner?.address || '').toLowerCase() !== key) continue;
        let rawVal = 0n;
        try {
          rawVal = BigInt(b?.amount || '0');
        } catch {
          rawVal = 0n;
        }
        if (rawVal <= 0n) continue;
        const parsed = estimateCoinDeltaUsd(String(b?.coinType?.repr || ''), b?.amount, coinMap);
        if (parsed.amount <= 0) continue;
        referralEarnedUsd += parsed.usd;
        referralPayouts.push({
          digest: tx.digest,
          timestampMs,
          traderAddress: sender,
          coinSymbol: parsed.symbol,
          amount: parsed.amount,
          usdValue: parsed.usd,
        });
      }
    }

    trades.sort((a, b) => b.timestampMs - a.timestampMs);
    referralPayouts.sort((a, b) => b.timestampMs - a.timestampMs);

    const totalVolumeUsd =
      spotSwapVolumeUsd +
      clobVolumeUsd +
      marginVolumeUsd +
      perpsVolumeUsd +
      predictVolumeUsd +
      earnVolumeUsd;

    const summary: OnChainVolumeSummary = {
      walletAddress: normAddr,
      totalVolumeUsd,
      spotSwapVolumeUsd,
      clobVolumeUsd,
      marginVolumeUsd,
      perpsVolumeUsd,
      predictVolumeUsd,
      earnVolumeUsd,
      txScannedCount: sentTxs.length,
      trades: trades.slice(0, 40),
      referralPayouts: referralPayouts.slice(0, 25),
      referralEarnedUsd,
      fetchedAt: Date.now(),
      source: 'onchain',
    };

    ONCHAIN_CACHE.set(key, summary);
    return summary;
  })().finally(() => {
    IN_FLIGHT_FETCH.delete(key);
  });

  IN_FLIGHT_FETCH.set(key, task);
  return task;
}

export async function syncWalletVolumeFromChain(
  walletAddress?: string | null,
  options?: { force?: boolean }
): Promise<OnChainVolumeSummary | null> {
  if (!walletAddress) return null;
  const summary = await fetchOnChainWalletSummary(walletAddress, Boolean(options?.force));
  setSyncedWalletVolume(walletAddress, summary.totalVolumeUsd);
  return summary;
}

export function scheduleDelayedChainSync(walletAddress: string, delayMs = 2800): void {
  if (!walletAddress) return;
  const key = walletAddress.toLowerCase();
  const prev = DELAYED_TIMERS.get(key);
  if (prev) clearTimeout(prev);
  const handle = setTimeout(() => {
    DELAYED_TIMERS.delete(key);
    syncWalletVolumeFromChain(walletAddress, { force: true }).catch(() => {});
  }, delayMs);
  DELAYED_TIMERS.set(key, handle);
}

/**
 * React hook keeping any UI component synchronized with Sui Mainnet + Aftermath volume
 * as well as instant optimistic updates after executing a trade.
 */
export function useSyncedWalletVolume(walletAddress?: string | null) {
  const [volumeUsd, setVolumeUsd] = useState<number>(() => getWalletVolumeUsd(walletAddress));
  const [summary, setSummary] = useState<OnChainVolumeSummary | null>(() =>
    walletAddress ? ONCHAIN_CACHE.get(walletAddress.toLowerCase()) ?? null : null
  );
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  const refresh = useCallback(
    async (force = false) => {
      if (!walletAddress) {
        setVolumeUsd(0);
        setSummary(null);
        return;
      }
      setIsSyncing(true);
      try {
        const res = await syncWalletVolumeFromChain(walletAddress, { force });
        if (res) {
          setSummary(res);
          setVolumeUsd(getWalletVolumeUsd(walletAddress));
        }
      } finally {
        setIsSyncing(false);
      }
    },
    [walletAddress]
  );

  useEffect(() => {
    if (!walletAddress) {
      setVolumeUsd(0);
      setSummary(null);
      return;
    }
    const key = walletAddress.toLowerCase();
    setVolumeUsd(getWalletVolumeUsd(walletAddress));
    const existing = ONCHAIN_CACHE.get(key) ?? null;
    setSummary(existing);

    if (!existing || Date.now() - existing.fetchedAt >= SUMMARY_TTL_MS) {
      refresh(false);
    }

    const onUpdated = (ev: Event) => {
      const detailAddr = (ev as CustomEvent<{ address?: string }>)?.detail?.address?.toLowerCase();
      if (!detailAddr || detailAddr === key) {
        setVolumeUsd(getWalletVolumeUsd(walletAddress));
        const nextSum = ONCHAIN_CACHE.get(key);
        if (nextSum) setSummary(nextSum);
      }
    };

    const onTradeRecorded = (ev: Event) => {
      const detailAddr = (ev as CustomEvent<{ address?: string }>)?.detail?.address?.toLowerCase();
      if (!detailAddr || detailAddr === key) {
        setVolumeUsd(getWalletVolumeUsd(walletAddress));
        scheduleDelayedChainSync(walletAddress, 2800);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener(VOLT_VOLUME_EVENT, onUpdated);
      window.addEventListener(VOLT_VOLUME_RECORDED_EVENT, onTradeRecorded);
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener(VOLT_VOLUME_EVENT, onUpdated);
        window.removeEventListener(VOLT_VOLUME_RECORDED_EVENT, onTradeRecorded);
      }
    };
  }, [walletAddress, refresh]);

  return { volumeUsd, summary, isSyncing, refresh };
}
