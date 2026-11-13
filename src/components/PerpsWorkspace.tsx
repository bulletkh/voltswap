import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Loader2,
  RefreshCw,
  Share2,
  Wallet,
  X,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  ExternalLink,
  KeyRound,
} from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import {
  AF_TERMS_MESSAGE,
  AF_USDC_COIN_TYPE,
  buildAllocateCollateralTx,
  buildCancelOrdersTx,
  buildCancelStopOrdersTx,
  buildCancelTwapOrdersTx,
  buildCreateAccountTx,
  buildCreateTwapOrderTx,
  buildDeallocateCollateralTx,
  buildDepositCollateralTx,
  buildPlaceLimitOrderTx,
  buildPlaceMarketOrderTx,
  buildPlaceScaleOrderTx,
  buildPlaceSlTpTx,
  buildPlaceStopOrderTx,
  buildSetLeverageTx,
  buildWithdrawCollateralTx,
  fetchAftermathAccountState,
  fetchAftermathCandles,
  fetchAftermathCollateralHistory,
  fetchAftermathFundingHistory,
  fetchAftermathLeveragePreview,
  fetchAftermathMarkets,
  fetchAftermathMarketTrades,
  fetchAftermathOrderbook,
  fetchAftermathOrderHistory,
  fetchAftermathStopOrders,
  fetchAftermathTwapOrders,
  type AfAccountState,
  type AfCollateralHistoryEntry,
  type AfFundingPoint,
  type AfMarketInfo,
  type AfMarketOrderbook,
  type AfMarketTrade,
  type AfOrderHistoryEntry,
  type AfOrderType,
  type AfPositionInfo,
  type AfSlTpConfig,
  type AfStopOrderItem,
  type AfTriggerPriceType,
  type AfTwapOrderItem,
} from '../aftermathPerps';
import { extractTxDigest, fetchWalletBalances, readBalanceFromMap } from '../suiClient';
import { simulateTxBeforeWallet } from '../suiSimulate';
import {
  addWalletVolumeUsd,
  calcFeeUnits,
  getValidReferrerForSender,
  resolveReferralTier,
  resolveTraderTier,
} from '../voltFee';
import { useSyncedWalletVolume } from '../onChainVolume';
import { fetchDeepBookCandles, type DeepBookCandle } from '../deepbookV3';
import { ProCandleChart, resolveTradingViewSymbol, type ChartTimeframe } from './ProCandleChart';
import type { PnlTradeData } from '../PnlShareModal';
import type { Transaction } from '@mysten/sui/transactions';

interface PerpsWorkspaceProps {
  onNotify: (
    type: 'success' | 'error' | 'info' | 'warning',
    title: string,
    message: string,
    actionLabel?: string,
    actionUrl?: string
  ) => void;
  onTradeRecorded: (trade: PnlTradeData) => void;
  onVolumeUpdated?: (newVolUsd: number) => void;
}

type OrderMode = 'market' | 'limit' | 'stop' | 'scale' | 'twap';
type BottomTab = 'positions' | 'orders' | 'stops' | 'twap' | 'history';
type PerpCategory = 'all' | 'crypto' | 'equities' | 'commodities' | 'fx_indices';

const FEATURED_PERP_SYMBOLS = ['SUI', 'BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'XAUT', 'NVDA', 'TSLA', 'US100'];

const COMMODITY_SYMS = new Set(['XAUT', 'XAG', 'WTI', 'BRENT', 'GOLD', 'SILVER']);
const FX_INDEX_SYMS = new Set(['US500', 'US100', 'KR200', 'JP225', 'INDIA50', 'USDJPY', 'USDKRW', 'USDBRL', 'SPX']);
const EQUITY_RWA_SYMS = new Set([
  'TSLA', 'NVDA', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'COIN', 'MSTR', 'HOOD', 'PLTR',
  'INTC', 'MU', 'MRVL', 'TSM', 'COST', 'LLY', 'AMC', 'SOFI', 'CRCL', 'SOXL', 'IONQ', 'SNDK',
  'BYD', 'NINTENDO', 'SAMSUNG', 'SKHYNIX', 'XIAOMI', 'SPCX', 'ANT', 'CBRS', 'DATA', 'DRAM',
  'ORBIO', 'IOVA', 'BOC', 'BP', 'CARDS', 'CHIP',
]);

function getPerpCategory(symbol: string): Exclude<PerpCategory, 'all'> {
  const s = symbol.toUpperCase().replace(/-PERP$/, '').replace(/USD$/, '');
  if (COMMODITY_SYMS.has(s)) return 'commodities';
  if (FX_INDEX_SYMS.has(s)) return 'fx_indices';
  if (EQUITY_RWA_SYMS.has(s)) return 'equities';
  return 'crypto';
}

function fmtPrice(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return '—';
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (p >= 10) return p.toFixed(3);
  return p.toFixed(4);
}

async function fetchFallbackCandles(symbol: string, tf: ChartTimeframe): Promise<DeepBookCandle[]> {
  const clean = symbol.replace('-PERP', '').replace(/USD$/, '').toUpperCase();
  const dbTf = tf === '30m' ? '15m' : tf;
  if (clean === 'SUI' || clean === 'WAL' || clean === 'DEEP') {
    try {
      const dbCandles = await fetchDeepBookCandles(`${clean}_USDC`, dbTf, 140);
      if (dbCandles.length > 5) return dbCandles;
    } catch {
      // fall through
    }
  }
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${clean}USDT&interval=${tf}&limit=140`
    );
    if (!res.ok) return [];
    const rows: any[] = await res.json();
    return rows.map((r) => ({
      time: Math.floor(Number(r[0]) / 1000),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }));
  } catch {
    return [];
  }
}

export const PerpsWorkspace: React.FC<PerpsWorkspaceProps> = ({
  onNotify,
  onTradeRecorded,
  onVolumeUpdated,
}) => {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();

  // Market & Book Data
  const [marketsMap, setMarketsMap] = useState<Record<string, AfMarketInfo>>({});
  const [selectedSymbol, setSelectedSymbol] = useState<string>('SUI');
  const [showMarketPicker, setShowMarketPicker] = useState(false);
  const [marketQuery, setMarketQuery] = useState('');
  const [marketCategory, setMarketCategory] = useState<PerpCategory>('all');

  const [orderbook, setOrderbook] = useState<AfMarketOrderbook>({
    bids: [],
    asks: [],
    bestBid: 0,
    bestAsk: 0,
    midPrice: 0,
  });
  const [marketTrades, setMarketTrades] = useState<AfMarketTrade[]>([]);
  const [bookTab, setBookTab] = useState<'book' | 'trades'>('book');

  const [candles, setCandles] = useState<DeepBookCandle[]>([]);
  const [candleSourceLabel, setCandleSourceLabel] = useState<string>('Aftermath Perps');
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('15m');
  const [candlesLoading, setCandlesLoading] = useState(false);
  const [chartTab, setChartTab] = useState<'chart' | 'funding'>('chart');
  const [fundingHistory, setFundingHistory] = useState<AfFundingPoint[]>([]);

  // Account & History Data
  const [afState, setAfState] = useState<AfAccountState | null>(null);
  const [walletUsdc, setWalletUsdc] = useState<number>(0);
  const [orderHistory, setOrderHistory] = useState<AfOrderHistoryEntry[]>([]);
  const [collateralHistory, setCollateralHistory] = useState<AfCollateralHistoryEntry[]>([]);
  const [historySubTab, setHistorySubTab] = useState<'orders' | 'collateral'>('orders');

  // Signed Stop / TWAP session auth cache
  const [afSig, setAfSig] = useState<{ wallet: string; bytes: string; signature: string } | null>(null);
  const [stopOrders, setStopOrders] = useState<AfStopOrderItem[]>([]);
  const [twapOrders, setTwapOrders] = useState<AfTwapOrderItem[]>([]);
  const [isLoadingSigned, setIsLoadingSigned] = useState(false);

  // Order Ticket State
  const [orderMode, setOrderMode] = useState<OrderMode>('market');
  const [side, setSide] = useState<'long' | 'short'>('long');
  const [leverage, setLeverage] = useState<number>(10);
  const [marginUsdc, setMarginUsdc] = useState<string>('0.5');
  const [reduceContracts, setReduceContracts] = useState<string>('');
  const [reduceOnly, setReduceOnly] = useState<boolean>(false);
  const [slippagePct, setSlippagePct] = useState<number>(1.5);

  // Limit / Scale / Stop / TWAP specifics
  const [limitPrice, setLimitPrice] = useState<string>('');
  const [limitOrderType, setLimitOrderType] = useState<AfOrderType>(0);
  const [stopIsLimit, setStopIsLimit] = useState<boolean>(false);
  const [stopTriggerPrice, setStopTriggerPrice] = useState<string>('');
  const [stopLimitPrice, setStopLimitPrice] = useState<string>('');
  const [stopTriggerAbove, setStopTriggerAbove] = useState<boolean>(true);
  const [stopTriggerSource, setStopTriggerSource] = useState<AfTriggerPriceType>(2);

  const [scaleStartPrice, setScaleStartPrice] = useState<string>('');
  const [scaleEndPrice, setScaleEndPrice] = useState<string>('');
  const [scaleCount, setScaleCount] = useState<number>(4);

  const [twapChunks, setTwapChunks] = useState<number>(5);
  const [twapGapSec, setTwapGapSec] = useState<number>(60);
  const [twapMaxSlipBps, setTwapMaxSlipBps] = useState<number>(150);

  // Inline TP/SL options
  const [enableSlTp, setEnableSlTp] = useState<boolean>(false);
  const [tpPriceInput, setTpPriceInput] = useState<string>('');
  const [slPriceInput, setSlPriceInput] = useState<string>('');
  const [slTpTriggerType, setSlTpTriggerType] = useState<AfTriggerPriceType>(2);

  // UI / Action Busy & Modals
  const [bottomTab, setBottomTab] = useState<BottomTab>('positions');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [collateralModal, setCollateralModal] = useState<'deposit' | 'withdraw' | null>(null);
  const [collateralAmt, setCollateralAmt] = useState<string>('');
  const [isCollateralBusy, setIsCollateralBusy] = useState(false);

  const [slTpModalPos, setSlTpModalPos] = useState<AfPositionInfo | null>(null);
  const [modalTp, setModalTp] = useState<string>('');
  const [modalSl, setModalSl] = useState<string>('');
  const [modalTriggerSrc, setModalTriggerSrc] = useState<AfTriggerPriceType>(2);

  const [marginModalPos, setMarginModalPos] = useState<AfPositionInfo | null>(null);
  const [marginModalDir, setMarginModalDir] = useState<'add' | 'remove'>('add');
  const [marginModalAmt, setMarginModalAmt] = useState<string>('');

  const lastSyncedMarketIdRef = useRef<string | null>(null);

  const { volumeUsd: walletVol } = useSyncedWalletVolume(account?.address);
  const activeRef = useMemo(() => getValidReferrerForSender(account?.address), [account?.address]);
  const traderTier = useMemo(() => resolveTraderTier(walletVol, Boolean(activeRef)), [walletVol, activeRef]);
  const refTier = useMemo(() => resolveReferralTier(walletVol), [walletVol]);

  // Markets polling
  useEffect(() => {
    let cancelled = false;
    const loadMarkets = async () => {
      try {
        const m = await fetchAftermathMarkets();
        if (!cancelled) setMarketsMap(m);
      } catch {
        // transient
      }
    };
    loadMarkets();
    const id = setInterval(loadMarkets, 10000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const orderedMarkets = useMemo(() => {
    const list = Object.values(marketsMap);
    return list.sort((a, b) => {
      const ia = FEATURED_PERP_SYMBOLS.indexOf(a.symbol);
      const ib = FEATURED_PERP_SYMBOLS.indexOf(b.symbol);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return b.volume24hUsd - a.volume24hUsd;
    });
  }, [marketsMap]);

  const marketsById = useMemo(() => {
    const m: Record<string, AfMarketInfo> = {};
    for (const info of Object.values(marketsMap)) m[info.marketId] = info;
    return m;
  }, [marketsMap]);

  const filteredPickerMarkets = useMemo(() => {
    const q = marketQuery.trim().toUpperCase();
    return orderedMarkets.filter((m) => {
      if (marketCategory !== 'all' && getPerpCategory(m.symbol) !== marketCategory) return false;
      if (!q) return true;
      return m.symbol.toUpperCase().includes(q);
    });
  }, [orderedMarkets, marketQuery, marketCategory]);

  const activeMarket = marketsMap[selectedSymbol] || orderedMarkets[0] || null;
  const activePosition = useMemo(
    () => afState?.positions.find((p) => p.marketId === activeMarket?.marketId) || null,
    [afState?.positions, activeMarket?.marketId]
  );

  // Clamp leverage to market max & auto-sync leverage on market entry when position is open
  useEffect(() => {
    if (!activeMarket) return;
    if (leverage > activeMarket.maxLeverage) {
      setLeverage(activeMarket.maxLeverage);
    }
    if (activePosition && lastSyncedMarketIdRef.current !== activeMarket.marketId) {
      lastSyncedMarketIdRef.current = activeMarket.marketId;
      setLeverage(Math.max(1, Math.min(activeMarket.maxLeverage, Math.round(activePosition.leverage))));
    } else if (!activePosition && lastSyncedMarketIdRef.current === activeMarket.marketId) {
      lastSyncedMarketIdRef.current = null;
    }
  }, [activeMarket, activePosition, leverage]);

  // Clear cached sig when wallet changes
  useEffect(() => {
    if (!account?.address || (afSig && afSig.wallet !== account.address)) {
      setAfSig(null);
      setStopOrders([]);
      setTwapOrders([]);
    }
  }, [account?.address, afSig]);

  // Orderbook + recent market trades polling
  useEffect(() => {
    if (!activeMarket?.marketId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [ob, tr] = await Promise.all([
          fetchAftermathOrderbook(activeMarket.marketId),
          fetchAftermathMarketTrades(activeMarket.marketId, 35),
        ]);
        if (!cancelled) {
          setOrderbook(ob);
          setMarketTrades(tr);
        }
      } catch {
        // transient
      }
    };
    load();
    const id = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeMarket?.marketId]);

  // Native Aftermath candles with DeepBook/Binance fallback + Funding history
  useEffect(() => {
    if (!activeMarket?.marketId) return;
    let cancelled = false;
    setCandles([]);
    setCandlesLoading(true);
    (async () => {
      try {
        const afCandles = await fetchAftermathCandles(activeMarket.marketId, timeframe, 200);
        if (!cancelled && afCandles.length >= 4) {
          setCandles(afCandles);
          setCandleSourceLabel('Aftermath Perps');
          return;
        }
        const fb = await fetchFallbackCandles(activeMarket.symbol, timeframe);
        if (!cancelled) {
          setCandles(fb.length > 0 ? fb : afCandles);
          setCandleSourceLabel(fb.length > 0 ? 'Market Reference Feed' : 'Aftermath Perps');
        }
      } catch {
        // handled cleanly
      } finally {
        if (!cancelled) setCandlesLoading(false);
      }
    })();

    fetchAftermathFundingHistory(activeMarket.marketId, 72)
      .then((fh) => {
        if (!cancelled) setFundingHistory(fh);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeMarket?.marketId, activeMarket?.symbol, timeframe]);

  const refreshAccount = useCallback(async () => {
    if (!account?.address) {
      setAfState(null);
      setWalletUsdc(0);
      setOrderHistory([]);
      setCollateralHistory([]);
      return;
    }
    try {
      const [state, bals] = await Promise.all([
        fetchAftermathAccountState(account.address),
        fetchWalletBalances(account.address),
      ]);
      setAfState(state);
      setWalletUsdc(readBalanceFromMap(bals, AF_USDC_COIN_TYPE, 6));
      if (state.accountId) {
        const [oh, ch] = await Promise.all([
          fetchAftermathOrderHistory(state.accountId, 25),
          fetchAftermathCollateralHistory(state.accountId, 25),
        ]);
        setOrderHistory(oh);
        setCollateralHistory(ch);
      }
    } catch {
      // ignore transient errors
    }
  }, [account?.address]);

  useEffect(() => {
    refreshAccount();
    const id = setInterval(refreshAccount, 8000);
    return () => clearInterval(id);
  }, [refreshAccount]);

  const loadSignedOrders = useCallback(
    async (forceTab?: 'stops' | 'twap') => {
      if (!account?.address || !afState?.accountId) return;
      setIsLoadingSigned(true);
      try {
        let cred = afSig && afSig.wallet === account.address ? afSig : null;
        if (!cred) {
          const signed = await dAppKit.signPersonalMessage({
            message: new TextEncoder().encode(AF_TERMS_MESSAGE),
          });
          cred = {
            wallet: account.address,
            bytes: signed.bytes,
            signature: signed.signature,
          };
          setAfSig(cred);
        }
        const [stops, twaps] = await Promise.all([
          fetchAftermathStopOrders({
            walletAddress: account.address,
            accountId: afState.accountId,
            accountCapId: afState.accountCapId,
            bytes: cred.bytes,
            signature: cred.signature,
          }).catch(() => []),
          fetchAftermathTwapOrders({
            walletAddress: account.address,
            accountId: afState.accountId,
            bytes: cred.bytes,
            signature: cred.signature,
          }).catch(() => []),
        ]);
        setStopOrders(stops);
        setTwapOrders(twaps);
        if (forceTab) setBottomTab(forceTab);
      } catch (err: any) {
        onNotify('error', 'Signature Cancelled', err?.message || 'Could not authenticate Aftermath order query.');
      } finally {
        setIsLoadingSigned(false);
      }
    },
    [account?.address, afState?.accountId, afState?.accountCapId, afSig, dAppKit, onNotify]
  );

  // Derived prices & order sizing
  const markPrice = orderbook.midPrice || activeMarket?.markPrice || activeMarket?.indexPrice || 0;
  const suiIndexPrice = marketsMap['SUI']?.indexPrice || 0.82;
  const effectiveOrderLev = activePosition
    ? Math.max(1, Math.min(activeMarket?.maxLeverage || 20, Math.round(activePosition.leverage)))
    : leverage;
  const leverageNeedsApply =
    Boolean(activePosition) && Math.abs(leverage - Math.round(activePosition!.leverage)) >= 1;

  const executionPriceEst = useMemo(() => {
    if (orderMode === 'limit' && Number(limitPrice) > 0) return Number(limitPrice);
    if (orderMode === 'scale') {
      const s = Number(scaleStartPrice);
      const e = Number(scaleEndPrice);
      if (s > 0 && e > 0) return (s + e) / 2;
    }
    if (orderMode === 'stop' && Number(stopTriggerPrice) > 0) return Number(stopTriggerPrice);
    return markPrice;
  }, [orderMode, limitPrice, scaleStartPrice, scaleEndPrice, stopTriggerPrice, markPrice]);

  const marginNum = reduceOnly ? 0 : Math.max(0, Number(marginUsdc) || 0);
  const openNotionalUsd = marginNum * effectiveOrderLev;
  const estContracts = reduceOnly
    ? Math.max(0, Number(reduceContracts) || 0)
    : executionPriceEst > 0
      ? openNotionalUsd / executionPriceEst
      : 0;
  const effectiveNotionalUsd = estContracts * executionPriceEst;

  const estLiqPrice =
    markPrice > 0 && !reduceOnly
      ? side === 'long'
        ? markPrice * (1 - 0.88 / effectiveOrderLev)
        : markPrice * (1 + 0.88 / effectiveOrderLev)
      : 0;

  // Shared preflight -> wallet sign -> notify helper
  const runPerpTx = async (
    buildFn: () => Promise<Transaction | string>,
    title: string,
    message: string
  ): Promise<string | null> => {
    if (!account?.address) {
      onNotify('info', 'Wallet Required', 'Connect your Sui wallet in the top bar.');
      return null;
    }
    setIsSubmitting(true);
    try {
      const tx = await buildFn();
      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) {
        onNotify('error', 'Preflight Check Failed', sim.errorMessage || 'Transaction would abort.');
        return null;
      }
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      onNotify('success', title, message, 'Suiscan', `https://suiscan.xyz/mainnet/tx/${digest}`);
      await refreshAccount();
      return digest;
    } catch (err: any) {
      onNotify('error', 'Execution Failed', err?.message || 'Wallet rejected transaction.');
      return null;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateAccount = async () => {
    if (!account?.address) return;
    setIsCollateralBusy(true);
    try {
      const tx = await buildCreateAccountTx(account.address);
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      onNotify(
        'success',
        'Aftermath Perps Account Created',
        'Margin account ready on-chain. Deposit USDC to begin trading.',
        'Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
      await refreshAccount();
    } catch (err: any) {
      onNotify('error', 'Account Creation Failed', err?.message || 'Transaction rejected.');
    } finally {
      setIsCollateralBusy(false);
    }
  };

  const handleCollateralSubmit = async () => {
    if (!account?.address || !afState?.accountId || !collateralModal) return;
    const amt = Number(collateralAmt);
    if (!Number.isFinite(amt) || amt <= 0) return;

    setIsCollateralBusy(true);
    try {
      const tx =
        collateralModal === 'deposit'
          ? await buildDepositCollateralTx(account.address, afState.accountId, amt)
          : await buildWithdrawCollateralTx(account.address, afState.accountId, amt);

      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) {
        onNotify('error', 'Collateral Rejected', sim.errorMessage || 'Simulation aborted.');
        return;
      }
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      setCollateralModal(null);
      setCollateralAmt('');
      onNotify(
        'success',
        collateralModal === 'deposit' ? 'USDC Deposited' : 'USDC Withdrawn',
        `${amt.toFixed(2)} USDC ${collateralModal === 'deposit' ? 'added to' : 'withdrawn from'} Account #${afState.accountId.replace('n', '')}`,
        'Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
      await refreshAccount();
    } catch (err: any) {
      onNotify('error', 'Collateral Action Failed', err?.message || 'Wallet rejected transaction.');
    } finally {
      setIsCollateralBusy(false);
    }
  };

  const handleApplyLeverage = async () => {
    if (!account?.address || !afState?.accountId || !activeMarket || !activePosition) return;
    setIsSubmitting(true);
    try {
      const preview = await fetchAftermathLeveragePreview({
        accountId: afState.accountId,
        marketId: activeMarket.marketId,
        leverage,
      });
      if (preview.error) {
        onNotify('error', 'Cannot Change Leverage', preview.error);
        return;
      }
      if (preview.collateralChange > afState.availableCollateralUsd) {
        onNotify(
          'warning',
          'Insufficient Free Collateral',
          `Lowering leverage to ${leverage}x requires $${preview.collateralChange.toFixed(2)} extra margin.`
        );
        return;
      }
      const tx = await buildSetLeverageTx({
        walletAddress: account.address,
        accountId: afState.accountId,
        accountCapId: afState.accountCapId,
        marketId: activeMarket.marketId,
        leverage,
        collateralChange: preview.collateralChange,
      });
      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) {
        onNotify('error', 'Leverage Check Failed', sim.errorMessage || 'Simulation aborted.');
        return;
      }
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      onNotify(
        'success',
        `Leverage Updated to ${leverage}x`,
        `${activeMarket.symbol}-PERP position adjusted on-chain.`,
        'Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
      await refreshAccount();
    } catch (err: any) {
      onNotify('error', 'Set Leverage Failed', err?.message || 'Could not update leverage.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const buildOrderSlTp = (): AfSlTpConfig | undefined => {
    if (!enableSlTp) return undefined;
    const tp = Number(tpPriceInput);
    const sl = Number(slPriceInput);
    if (!(tp > 0) && !(sl > 0)) return undefined;
    return {
      takeProfitPrice: tp > 0 ? tp : undefined,
      stopLossPrice: sl > 0 ? sl : undefined,
      triggerPriceType: slTpTriggerType,
    };
  };

  const executePerpOrder = async () => {
    if (!account?.address) {
      onNotify('info', 'Wallet Required', 'Connect your Sui wallet in the top bar.');
      return;
    }
    if (!activeMarket) return;
    if (!afState?.accountId) {
      await handleCreateAccount();
      return;
    }

    if (estContracts <= 0 || effectiveNotionalUsd < activeMarket.minOrderUsdValue) {
      onNotify(
        'warning',
        'Order Below Minimum',
        `Minimum notional size for ${activeMarket.symbol}-PERP is $${activeMarket.minOrderUsdValue}.`
      );
      return;
    }

    if (!reduceOnly && marginNum > afState.availableCollateralUsd * 0.995) {
      onNotify(
        'warning',
        'Insufficient Free Margin',
        `Available collateral is $${afState.availableCollateralUsd.toFixed(2)}. Deposit USDC or lower margin.`
      );
      return;
    }

    if (orderMode === 'limit' && !(Number(limitPrice) > 0)) {
      onNotify('warning', 'Limit Price Required', 'Enter a valid Limit Price or click a row in the orderbook.');
      return;
    }
    if (orderMode === 'stop') {
      if (!(Number(stopTriggerPrice) > 0)) {
        onNotify('warning', 'Trigger Price Required', 'Enter a valid Stop trigger price.');
        return;
      }
      if (stopIsLimit && !(Number(stopLimitPrice) > 0)) {
        onNotify('warning', 'Stop Limit Price Required', 'Enter a valid limit execution price.');
        return;
      }
    }
    if (orderMode === 'scale') {
      const s = Number(scaleStartPrice);
      const e = Number(scaleEndPrice);
      if (!(s > 0) || !(e > 0) || s === e) {
        onNotify('warning', 'Invalid Scale Range', 'Enter distinct Start and End prices.');
        return;
      }
    }

    const orderSide: 0 | 1 = side === 'long' ? 0 : 1;
    const hasPosition = afState.positionMarketIds.includes(activeMarket.marketId);
    const collateralChange = reduceOnly ? 0 : Number(marginNum.toFixed(4));
    const suiEquivMist = BigInt(
      Math.max(0, Math.round((effectiveNotionalUsd / Math.max(0.2, suiIndexPrice)) * 1e9))
    );
    const feeMist = reduceOnly ? 0n : calcFeeUnits(suiEquivMist, traderTier.feeRate);
    const slTp = buildOrderSlTp();

    const modeLabel = orderMode.toUpperCase();
    const digest = await runPerpTx(
      async () => {
        if (orderMode === 'market') {
          return buildPlaceMarketOrderTx({
            walletAddress: account.address,
            accountId: afState.accountId!,
            accountCapId: afState.accountCapId,
            marketId: activeMarket.marketId,
            side: orderSide,
            sizeContracts: estContracts,
            lotSize: activeMarket.lotSize,
            leverage: effectiveOrderLev,
            reduceOnly,
            collateralChange,
            hasPosition,
            cancelSlTp: false,
            slippage: slippagePct / 100,
            slTp,
            feeMist,
            refSharePct: refTier.revSharePct,
          });
        }
        if (orderMode === 'limit') {
          return buildPlaceLimitOrderTx({
            walletAddress: account.address,
            accountId: afState.accountId!,
            accountCapId: afState.accountCapId,
            marketId: activeMarket.marketId,
            side: orderSide,
            sizeContracts: estContracts,
            priceUsd: Number(limitPrice),
            lotSize: activeMarket.lotSize,
            tickSize: activeMarket.tickSize,
            orderType: limitOrderType,
            leverage: effectiveOrderLev,
            reduceOnly,
            collateralChange,
            hasPosition,
            cancelSlTp: false,
            slTp,
            feeMist,
            refSharePct: refTier.revSharePct,
          });
        }
        if (orderMode === 'scale') {
          return buildPlaceScaleOrderTx({
            walletAddress: account.address,
            accountId: afState.accountId!,
            accountCapId: afState.accountCapId,
            marketId: activeMarket.marketId,
            side: orderSide,
            totalSizeContracts: estContracts,
            startPriceUsd: Number(scaleStartPrice),
            endPriceUsd: Number(scaleEndPrice),
            numberOfOrders: scaleCount,
            lotSize: activeMarket.lotSize,
            tickSize: activeMarket.tickSize,
            orderType: limitOrderType,
            leverage: effectiveOrderLev,
            reduceOnly,
            collateralChange,
            hasPosition,
            feeMist,
            refSharePct: refTier.revSharePct,
          });
        }
        if (orderMode === 'stop') {
          return buildPlaceStopOrderTx({
            walletAddress: account.address,
            accountId: afState.accountId!,
            accountCapId: afState.accountCapId,
            marketId: activeMarket.marketId,
            side: orderSide,
            sizeContracts: estContracts,
            lotSize: activeMarket.lotSize,
            tickSize: activeMarket.tickSize,
            triggerPriceUsd: Number(stopTriggerPrice),
            triggerIfGeStopIndexPrice: stopTriggerAbove,
            triggerPriceType: stopTriggerSource,
            reduceOnly,
            limitPriceUsd: stopIsLimit ? Number(stopLimitPrice) : undefined,
            limitOrderType: 0,
            feeMist,
            refSharePct: refTier.revSharePct,
          });
        }
        return buildCreateTwapOrderTx({
          walletAddress: account.address,
          accountId: afState.accountId!,
          accountCapId: afState.accountCapId,
          marketId: activeMarket.marketId,
          side: orderSide,
          sizeContracts: estContracts,
          lotSize: activeMarket.lotSize,
          reduceOnly,
          chunksAmount: twapChunks,
          executionGapMs: twapGapSec * 1000,
          maxSlippageBps: twapMaxSlipBps,
          feeMist,
          refSharePct: refTier.revSharePct,
        });
      },
      `${modeLabel} ${side === 'long' ? 'Long' : 'Short'} ${activeMarket.symbol}-PERP Submitted`,
      `${estContracts.toFixed(3)} ${activeMarket.symbol} @ $${fmtPrice(executionPriceEst)} (${effectiveOrderLev}x)`
    );

    if (digest) {
      const nextVol = addWalletVolumeUsd(account.address, effectiveNotionalUsd);
      onVolumeUpdated?.(nextVol);
      fetch('/api/record-swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          digest,
          address: account.address,
          fromToken: `${marginNum.toFixed(2)} USDC`,
          toToken: `${activeMarket.symbol}-PERP ${effectiveOrderLev}x`,
          fromAmount: marginNum,
          toAmount: estContracts.toFixed(3),
          volumeUsd: effectiveNotionalUsd,
          feeRate: traderTier.feeRate,
          tierName: traderTier.name,
          swapMode: `AFTERMATH_${modeLabel}`,
          referrer: activeRef,
        }),
      }).catch(() => {});

      onTradeRecorded({
        fromToken: 'USDC',
        toToken: `${activeMarket.symbol}-PERP`,
        fromAmount: reduceOnly ? 'Reduce' : marginNum.toFixed(2),
        toAmount: `${estContracts.toFixed(2)} (${effectiveOrderLev}x ${modeLabel})`,
        volumeUsd: effectiveNotionalUsd,
        digest,
        orderType: 'PERPS',
      });

      if (orderMode === 'stop' && afSig) loadSignedOrders('stops');
      if (orderMode === 'twap' && afSig) loadSignedOrders('twap');
    }
  };

  const handleClosePosition = async (pos: AfPositionInfo, fraction = 1) => {
    if (!account?.address || !afState?.accountId) return;
    const mkt = marketsById[pos.marketId];
    if (!mkt) return;
    const closeSide: 0 | 1 = pos.baseAssetAmount > 0 ? 1 : 0;
    const closeSize = Math.abs(pos.baseAssetAmount) * fraction;
    await runPerpTx(
      () =>
        buildPlaceMarketOrderTx({
          walletAddress: account.address,
          accountId: afState.accountId!,
          accountCapId: afState.accountCapId,
          marketId: mkt.marketId,
          side: closeSide,
          sizeContracts: closeSize,
          lotSize: mkt.lotSize,
          leverage: Math.max(1, Math.min(mkt.maxLeverage, Math.round(pos.leverage))),
          reduceOnly: true,
          collateralChange: 0,
          hasPosition: true,
          cancelSlTp: fraction >= 0.99,
          slippage: 0.03,
        }),
      `Closed ${Math.round(fraction * 100)}% ${mkt.symbol}-PERP`,
      `Est. PnL: ${pos.unrealizedPnlUsd >= 0 ? '+' : ''}$${(pos.unrealizedPnlUsd * fraction).toFixed(2)}`
    );
  };

  const handleSubmitPositionSlTp = async () => {
    if (!account?.address || !afState?.accountId || !slTpModalPos) return;
    const mkt = marketsById[slTpModalPos.marketId];
    if (!mkt) return;
    const tp = Number(modalTp);
    const sl = Number(modalSl);
    if (!(tp > 0) && !(sl > 0)) {
      onNotify('warning', 'Price Required', 'Set at least a Take Profit or Stop Loss trigger price.');
      return;
    }
    const posSide: 0 | 1 = slTpModalPos.baseAssetAmount > 0 ? 0 : 1;
    const digest = await runPerpTx(
      () =>
        buildPlaceSlTpTx({
          walletAddress: account.address,
          accountId: afState.accountId!,
          accountCapId: afState.accountCapId,
          marketId: mkt.marketId,
          positionSide: posSide,
          sizeContracts: Math.abs(slTpModalPos.baseAssetAmount),
          lotSize: mkt.lotSize,
          takeProfitPrice: tp > 0 ? tp : undefined,
          stopLossPrice: sl > 0 ? sl : undefined,
          triggerPriceType: modalTriggerSrc,
        }),
      `TP / SL Set on ${mkt.symbol}-PERP`,
      `${tp > 0 ? `TP $${tp}` : ''} ${sl > 0 ? `SL $${sl}` : ''}`.trim()
    );
    if (digest) {
      setSlTpModalPos(null);
      if (afSig) loadSignedOrders();
    }
  };

  const handleSubmitPositionMargin = async () => {
    if (!account?.address || !afState?.accountId || !marginModalPos) return;
    const mkt = marketsById[marginModalPos.marketId];
    const amt = Number(marginModalAmt);
    if (!mkt || !(amt > 0)) return;
    const digest = await runPerpTx(
      () =>
        marginModalDir === 'add'
          ? buildAllocateCollateralTx({
              walletAddress: account.address,
              accountId: afState.accountId!,
              accountCapId: afState.accountCapId,
              marketId: mkt.marketId,
              amountUsdc: amt,
            })
          : buildDeallocateCollateralTx({
              walletAddress: account.address,
              accountId: afState.accountId!,
              accountCapId: afState.accountCapId,
              marketId: mkt.marketId,
              amountUsdc: amt,
            }),
      `${marginModalDir === 'add' ? 'Added' : 'Removed'} $${amt.toFixed(2)} Margin`,
      `${mkt.symbol}-PERP position collateral updated.`
    );
    if (digest) {
      setMarginModalPos(null);
      setMarginModalAmt('');
    }
  };

  const handleCancelPendingOrders = async (marketId: string, orderIds: string[]) => {
    if (!account?.address || !afState?.accountId || orderIds.length === 0) return;
    const mkt = marketsById[marketId];
    await runPerpTx(
      () =>
        buildCancelOrdersTx({
          walletAddress: account.address,
          accountId: afState.accountId!,
          accountCapId: afState.accountCapId,
          marketId,
          orderIds,
        }),
      `Cancelled ${orderIds.length} ${mkt?.symbol || ''}-PERP Order${orderIds.length > 1 ? 's' : ''}`,
      'Order(s) removed from the on-chain book.'
    );
  };

  const handleCancelStopOrder = async (stopOrderId: string) => {
    if (!account?.address || !afState?.accountId) return;
    const d = await runPerpTx(
      () =>
        buildCancelStopOrdersTx({
          walletAddress: account.address,
          accountId: afState.accountId!,
          accountCapId: afState.accountCapId,
          stopOrderIds: [stopOrderId],
        }),
      'Stop / TP-SL Order Cancelled',
      'Conditional trigger removed.'
    );
    if (d && afSig) loadSignedOrders();
  };

  const handleCancelTwapOrder = async (twapOrderId: string) => {
    if (!account?.address || !afState?.accountId) return;
    const d = await runPerpTx(
      () =>
        buildCancelTwapOrdersTx({
          walletAddress: account.address,
          accountId: afState.accountId!,
          accountCapId: afState.accountCapId,
          twapOrderIds: [twapOrderId],
        }),
      'TWAP Order Cancelled',
      'Scheduled TWAP execution stopped.'
    );
    if (d && afSig) loadSignedOrders();
  };

  const handleOrderbookPriceClick = (price: number) => {
    const formatted = price >= 1000 ? price.toFixed(2) : price >= 10 ? price.toFixed(3) : price.toFixed(4);
    if (orderMode === 'stop') {
      setStopTriggerPrice(formatted);
      setStopTriggerAbove(price >= markPrice);
    } else if (orderMode === 'scale') {
      if (!scaleStartPrice) setScaleStartPrice(formatted);
      else setScaleEndPrice(formatted);
    } else {
      setLimitPrice(formatted);
      if (orderMode === 'market') setOrderMode('limit');
    }
  };

  return (
    <div className="w-full overflow-x-hidden bg-[#000000] border-b border-[#1A1E26] animate-panel-in">
      {/* Main Institutional DeepBook-Pro Flush Grid */}
      <div className="w-full grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_265px_325px] xl:grid-cols-[minmax(0,1fr)_290px_345px]">
        {/* 1. Live Perp Market Ribbon (Row 1, Cols 1-2) */}
        <div className="min-w-0 lg:col-span-2 lg:col-start-1 lg:row-start-1 bg-[#000000] border-b lg:border-r border-[#1A1E26] px-3 py-2 flex flex-wrap items-center justify-between gap-2.5 relative z-20">
          <div className="min-w-0 flex items-center gap-1 flex-wrap">
            {orderedMarkets.slice(0, 5).map((m) => {
              const active = activeMarket?.symbol === m.symbol;
              return (
                <button
                  key={m.marketId}
                  type="button"
                  onClick={() => setSelectedSymbol(m.symbol)}
                  className={`px-2.5 py-1 rounded text-xs font-mono whitespace-nowrap flex items-center gap-1.5 transition-colors ${
                    active
                      ? 'bg-[#2B7FFF]/15 text-white border border-[#2B7FFF]/60 font-bold'
                      : 'text-[#848E9C] hover:text-white hover:bg-white/[0.04] border border-transparent'
                  }`}
                >
                  <span>{m.symbol}-PERP</span>
                  <span className={`text-[11px] ${active ? 'text-[#60A5FA]' : 'text-slate-500'}`}>
                    {m.maxLeverage}x
                  </span>
                </button>
              );
            })}

            {/* Searchable Categorized All-Markets Picker */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setMarketQuery('');
                  setShowMarketPicker((v) => !v);
                }}
                className={`px-2.5 py-1 rounded text-xs font-mono whitespace-nowrap flex items-center gap-1.5 border transition-colors ${
                  showMarketPicker
                    ? 'bg-[#2B7FFF]/20 border-[#2B7FFF] text-white font-bold'
                    : 'bg-[#090B10] hover:bg-[#10141D] border-[#1E232D] text-slate-200 font-semibold'
                }`}
              >
                <span>All ({orderedMarkets.length})</span>
                <ChevronDown className="w-3.5 h-3.5 text-[#848E9C]" />
              </button>
              {showMarketPicker && (
                <div className="absolute left-0 top-full mt-1.5 w-80 sm:w-[460px] bg-[#07090D] border border-[#232834] rounded-lg shadow-2xl p-3 z-50">
                  <div className="relative mb-2.5">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                    <input
                      type="text"
                      autoFocus
                      value={marketQuery}
                      onChange={(e) => setMarketQuery(e.target.value)}
                      placeholder="Search 72 markets (BTC, SUI, NVDA, TSLA, XAUT, US100)..."
                      className="w-full pl-8 pr-3 py-1.5 rounded bg-[#000000] border border-[#1E232D] text-xs font-mono text-white outline-none focus:border-[#2B7FFF]"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1 mb-2.5">
                    {(
                      [
                        { id: 'all', label: `All (${orderedMarkets.length})` },
                        { id: 'crypto', label: 'Crypto' },
                        { id: 'equities', label: 'Stocks / RWA' },
                        { id: 'commodities', label: 'Commodities' },
                        { id: 'fx_indices', label: 'Indices & FX' },
                      ] as const
                    ).map((cat) => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setMarketCategory(cat.id)}
                        className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-colors ${
                          marketCategory === cat.id
                            ? 'bg-[#2B7FFF] text-white'
                            : 'bg-[#0E1118] text-[#848E9C] hover:text-white'
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-[#161A22]">
                    {filteredPickerMarkets.map((m) => {
                      const cat = getPerpCategory(m.symbol);
                      const catTag =
                        cat === 'equities'
                          ? 'RWA'
                          : cat === 'commodities'
                            ? 'CMD'
                            : cat === 'fx_indices'
                              ? 'IDX'
                              : 'CRYP';
                      return (
                        <button
                          key={m.marketId}
                          type="button"
                          onClick={() => {
                            setSelectedSymbol(m.symbol);
                            setShowMarketPicker(false);
                          }}
                          className={`w-full px-2.5 py-2 flex items-center justify-between text-xs font-mono hover:bg-white/[0.04] ${
                            m.symbol === activeMarket?.symbol ? 'bg-[#2B7FFF]/15 text-[#60A5FA]' : 'text-slate-200'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-bold">{m.symbol}-PERP</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-300">
                              {m.maxLeverage}x
                            </span>
                            <span className="text-[10px] px-1 py-0.5 rounded bg-white/[0.04] text-slate-400">
                              {catTag}
                            </span>
                          </div>
                          <div className="text-right tabular-nums shrink-0">
                            <div className="text-white">${fmtPrice(m.markPrice)}</div>
                            <div
                              className={`text-[11px] ${
                                m.priceChange24hPct >= 0 ? 'text-[#08D189]' : 'text-[#F0525E]'
                              }`}
                            >
                              {m.priceChange24hPct >= 0 ? '+' : ''}
                              {m.priceChange24hPct.toFixed(2)}%
                            </div>
                          </div>
                        </button>
                      );
                    })}
                    {filteredPickerMarkets.length === 0 && (
                      <div className="py-4 text-center text-xs text-slate-400 font-mono">
                        No matching Aftermath markets.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {activeMarket && (
            <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono tabular-nums">
              <div>
                <div className="text-[10px] text-[#7B8494]">Mark Price</div>
                <div className="text-white font-semibold">${fmtPrice(markPrice)}</div>
              </div>
              <div>
                <div className="text-[10px] text-[#7B8494]">Oracle Price</div>
                <div className="text-slate-200">${fmtPrice(activeMarket.indexPrice)}</div>
              </div>
              <div>
                <div className="text-[10px] text-[#7B8494]">24h Change</div>
                <div
                  className={
                    activeMarket.priceChange24hPct >= 0 ? 'pnl-green font-semibold' : 'pnl-red font-semibold'
                  }
                >
                  {activeMarket.priceChange24hPct >= 0 ? '+' : ''}
                  {activeMarket.priceChange24hPct.toFixed(2)}%
                </div>
              </div>
              <div className="hidden sm:block">
                <div className="text-[10px] text-[#7B8494]">24h Volume</div>
                <div className="text-slate-200">
                  ${Math.round(activeMarket.volume24hUsd).toLocaleString()}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#7B8494]">Funding / 1h</div>
                <div className="text-[#60A5FA]">
                  {(activeMarket.estimatedFundingRate * 100).toFixed(4)}%
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 2. Chart Pane (Row 2, Col 1) */}
        <div className="lg:col-start-1 lg:row-start-2 bg-[#000000] border-b lg:border-r border-[#1A1E26] flex flex-col min-w-0">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1A1E26] bg-[#000000]">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setChartTab('chart')}
                className={`text-xs font-mono pb-0.5 border-b-2 transition-colors ${
                  chartTab === 'chart'
                    ? 'text-white border-[#2B7FFF] font-semibold'
                    : 'text-[#848E9C] border-transparent hover:text-white'
                }`}
              >
                Price Chart
              </button>
              <button
                type="button"
                onClick={() => setChartTab('funding')}
                className={`text-xs font-mono pb-0.5 border-b-2 transition-colors ${
                  chartTab === 'funding'
                    ? 'text-white border-[#2B7FFF] font-semibold'
                    : 'text-[#848E9C] border-transparent hover:text-white'
                }`}
              >
                Funding ({fundingHistory.length})
              </button>
            </div>
            <span className="text-[11px] font-mono text-[#7B8494]">
              Feed: <span className="text-slate-300">{candleSourceLabel}</span>
            </span>
          </div>

          {chartTab === 'chart' ? (
            <ProCandleChart
              symbolLabel={`${activeMarket?.symbol || selectedSymbol}-PERP · Aftermath`}
              sourceLabel={candleSourceLabel}
              candles={candles}
              timeframe={timeframe}
              onTimeframeChange={setTimeframe}
              isLoading={candlesLoading}
              livePrice={markPrice}
              tvSymbol={resolveTradingViewSymbol(activeMarket?.symbol || selectedSymbol)}
              heightClass="h-[430px] lg:h-[520px] xl:h-[550px]"
            />
          ) : (
            <div className="p-3 h-[465px] lg:h-[555px] xl:h-[585px] overflow-y-auto bg-[#000000]">
              <div className="text-xs font-semibold text-white mb-2">
                {activeMarket?.symbol}-PERP Hourly Funding Rate History
              </div>
              {fundingHistory.length === 0 ? (
                <div className="text-xs text-slate-400 font-mono py-8 text-center">
                  No historical funding snapshots returned yet.
                </div>
              ) : (
                <div className="divide-y divide-[#161A22] text-xs font-mono">
                  {fundingHistory
                    .slice()
                    .reverse()
                    .map((pt, idx) => (
                      <div key={idx} className="py-1.5 flex justify-between">
                        <span className="text-slate-400">
                          {pt.timestamp > 0 ? new Date(pt.timestamp).toLocaleString() : '—'}
                        </span>
                        <span className={pt.fundingRate >= 0 ? 'pnl-green' : 'pnl-red'}>
                          {pt.fundingRate >= 0 ? '+' : ''}
                          {(pt.fundingRate * 100).toFixed(5)}% / 1h
                        </span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 3. Order Book & Trades Pane (Row 2, Col 2) */}
        <div className="min-w-0 lg:col-start-2 lg:row-start-2 bg-[#000000] border-b lg:border-r border-[#1A1E26] flex flex-col h-[465px] lg:h-[590px] xl:h-[620px] overflow-hidden">
          <div className="px-3 py-2 border-b border-[#1A1E26] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setBookTab('book')}
                className={`text-xs font-semibold pb-0.5 border-b-2 transition-colors ${
                  bookTab === 'book'
                    ? 'text-white border-[#2B7FFF]'
                    : 'text-[#848E9C] border-transparent hover:text-white'
                }`}
              >
                Order Book
              </button>
              <button
                type="button"
                onClick={() => setBookTab('trades')}
                className={`text-xs font-semibold pb-0.5 border-b-2 transition-colors ${
                  bookTab === 'trades'
                    ? 'text-white border-[#2B7FFF]'
                    : 'text-[#848E9C] border-transparent hover:text-white'
                }`}
              >
                Trades
              </button>
            </div>
            <span className="text-[10px] font-mono text-[#7B8494]">
              {bookTab === 'book' ? 'Click → price' : `${marketTrades.length}`}
            </span>
          </div>

          {bookTab === 'book' ? (
            <>
              <div className="grid grid-cols-3 text-[11px] font-mono text-[#7B8494] px-2.5 py-1.5 border-b border-[#12151C]">
                <span>Price</span>
                <span className="text-right">Size</span>
                <span className="text-right">Total</span>
              </div>
              <div className="flex-1 min-h-0 flex flex-col justify-between px-1.5 py-1 text-[11px] font-mono tabular-nums overflow-hidden">
                <div className="flex-1 min-h-0 flex flex-col justify-end space-y-[2px] overflow-hidden">
                  {orderbook.asks.slice(-11).map((lv, i) => (
                    <button
                      key={`a-${i}`}
                      type="button"
                      onClick={() => handleOrderbookPriceClick(lv.price)}
                      className="w-full relative grid grid-cols-3 py-[2px] px-1.5 overflow-hidden hover:bg-white/[0.06] text-left cursor-pointer"
                    >
                      <span
                        className="absolute right-0 top-0 bottom-0 bg-[#F0525E]/18"
                        style={{
                          width: `${Math.min(100, (lv.totalSize / Math.max(1, orderbook.asks[0]?.totalSize || 1)) * 100)}%`,
                        }}
                      />
                      <span className="relative text-[#F0525E] font-medium">{fmtPrice(lv.price)}</span>
                      <span className="relative text-right text-slate-200">{lv.size.toFixed(2)}</span>
                      <span className="relative text-right text-[#848E9C]">{lv.totalSize.toFixed(1)}</span>
                    </button>
                  ))}
                </div>

                <div className="py-1 px-2 my-1 border-y border-[#1A1E26] bg-[#06070A] flex items-center justify-between text-[11px] font-mono shrink-0">
                  <span className="text-white font-bold">${fmtPrice(markPrice)}</span>
                  <span className="text-[10px] text-[#7B8494]">Spread / Mark</span>
                </div>

                <div className="flex-1 min-h-0 flex flex-col justify-start space-y-[2px] overflow-hidden">
                  {orderbook.bids.slice(0, 11).map((lv, i) => (
                    <button
                      key={`b-${i}`}
                      type="button"
                      onClick={() => handleOrderbookPriceClick(lv.price)}
                      className="w-full relative grid grid-cols-3 py-[2px] px-1.5 overflow-hidden hover:bg-white/[0.06] text-left cursor-pointer"
                    >
                      <span
                        className="absolute right-0 top-0 bottom-0 bg-[#08D189]/18"
                        style={{
                          width: `${Math.min(100, (lv.totalSize / Math.max(1, orderbook.bids.slice(-1)[0]?.totalSize || 1)) * 100)}%`,
                        }}
                      />
                      <span className="relative text-[#08D189] font-medium">{fmtPrice(lv.price)}</span>
                      <span className="relative text-right text-slate-200">{lv.size.toFixed(2)}</span>
                      <span className="relative text-right text-[#848E9C]">{lv.totalSize.toFixed(1)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5 text-[11px] font-mono tabular-nums">
              <div className="grid grid-cols-3 text-[#7B8494] pb-1 border-b border-[#161A22]">
                <span>Price</span>
                <span className="text-right">Size</span>
                <span className="text-right">Time</span>
              </div>
              {marketTrades.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-400">No recent fills.</div>
              ) : (
                marketTrades.map((t, idx) => (
                  <div key={`${t.txDigest}-${idx}`} className="grid grid-cols-3 py-1 px-1 hover:bg-white/[0.04]">
                    <span className={t.side === 0 ? 'pnl-green' : 'pnl-red'}>
                      ${fmtPrice(t.orderPrice)}
                    </span>
                    <span className="text-right text-slate-200">{t.sizeFilled.toFixed(3)}</span>
                    <span className="text-right text-[#848E9C]">
                      {t.timestamp > 0 ? new Date(t.timestamp).toLocaleTimeString([], { hour12: false }) : '—'}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* 4. Right Full-Height Order Ticket (Col 3, Rows 1-3) */}
        <div className="min-w-0 overflow-hidden lg:col-start-3 lg:row-start-1 lg:row-span-3 bg-[#000000] border-b lg:border-b-0 border-[#1A1E26] p-3 space-y-2.5">
          {/* Account Banner */}
          <div className="bg-[#06070A] border border-[#1B1F27] rounded-md p-2.5 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300 font-semibold">
                Perps Account {afState?.accountId ? `#${afState.accountId.replace('n', '')}` : ''}
              </span>
              <button
                type="button"
                onClick={() => refreshAccount()}
                className="p-1 rounded hover:bg-white/[0.08] text-[#848E9C] hover:text-white"
                title="Refresh account"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            </div>
            <div className="flex items-center justify-between text-xs font-mono tabular-nums">
              <span className="text-[#7B8494]">Free Margin</span>
              <span className="text-white font-bold">
                ${(afState?.availableCollateralUsd ?? 0).toFixed(2)} USDC
              </span>
            </div>
            {afState?.accountId ? (
              <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setCollateralAmt(walletUsdc > 0 ? Math.min(walletUsdc, 10).toFixed(2) : '');
                    setCollateralModal('deposit');
                  }}
                  className="py-1.5 rounded bg-[#2B7FFF] hover:bg-[#3C8BFF] text-white text-xs font-bold flex items-center justify-center gap-1 transition-colors"
                >
                  <ArrowDownToLine className="w-3 h-3" />
                  DEPOSIT
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCollateralAmt((afState?.availableCollateralUsd || 0).toFixed(2));
                    setCollateralModal('withdraw');
                  }}
                  className="py-1.5 rounded bg-[#0C0E13] hover:bg-[#141821] text-white text-xs font-bold flex items-center justify-center gap-1 border border-[#232834] transition-colors"
                >
                  <ArrowUpFromLine className="w-3 h-3" />
                  WITHDRAW
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={!account || isCollateralBusy}
                onClick={handleCreateAccount}
                className="w-full py-1.5 rounded btn-deepbook text-xs font-bold"
              >
                {!account
                  ? 'Connect Wallet to Create Perp Account'
                  : isCollateralBusy
                    ? 'Creating...'
                    : 'Create On-Chain Perp Account'}
              </button>
            )}
          </div>

          {/* Long / Short */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => setSide('long')}
              className={`py-2 rounded font-bold text-xs uppercase tracking-wide transition-colors border ${
                side === 'long'
                  ? 'bg-[#2B7FFF]/15 border-[#2B7FFF] text-white'
                  : 'bg-[#090B10] border-[#1A1E26] text-[#848E9C] hover:text-white'
              }`}
            >
              Buy / Long
            </button>
            <button
              type="button"
              onClick={() => setSide('short')}
              className={`py-2 rounded font-bold text-xs uppercase tracking-wide transition-colors border ${
                side === 'short'
                  ? 'bg-[#F0525E]/15 border-[#F0525E] text-white'
                  : 'bg-[#090B10] border-[#1A1E26] text-[#848E9C] hover:text-white'
              }`}
            >
              Sell / Short
            </button>
          </div>

          {/* 5 Order Mode Tabs */}
          <div className="grid grid-cols-5 gap-1 p-0.5 rounded bg-[#07090D] border border-[#1B1F27] text-xs font-mono">
            {(['market', 'limit', 'stop', 'scale', 'twap'] as OrderMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setOrderMode(m)}
                className={`py-1.5 rounded capitalize transition-colors ${
                  orderMode === m
                    ? 'bg-[#2B7FFF] text-white font-bold'
                    : 'text-[#848E9C] hover:text-white'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Leverage Slider + Open Position Leverage Sync Guard */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-slate-300">
                Leverage (Max {activeMarket?.maxLeverage || 20}x)
              </span>
              <span className="text-[#60A5FA] font-bold tabular-nums">{leverage}x</span>
            </div>
            <input
              type="range"
              min={1}
              max={activeMarket?.maxLeverage || 20}
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="w-full accent-[#2B7FFF] cursor-pointer"
            />
            {leverageNeedsApply && activePosition && (
              <div className="flex items-center justify-between gap-2 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1 text-xs font-mono">
                <span className="text-amber-300">
                  Pos open @ {Math.round(activePosition.leverage)}x
                </span>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleApplyLeverage}
                  className="px-2 py-0.5 rounded bg-amber-400 hover:bg-amber-300 text-black font-bold"
                >
                  Apply {leverage}x
                </button>
              </div>
            )}
          </div>

          {/* Mode-Specific Price / Condition Inputs */}
          {orderMode === 'limit' && (
            <div className="panel-carbon-sub rounded-md p-2.5 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-300 font-mono">
                <span>Limit Price (USD)</span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setLimitPrice(markPrice > 0 ? fmtPrice(markPrice).replace(/,/g, '') : '')}
                    className="px-1.5 py-0.5 rounded bg-white/[0.08] hover:bg-white/[0.14] text-white"
                  >
                    Mid
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const p = side === 'long' ? orderbook.bestBid || markPrice : orderbook.bestAsk || markPrice;
                      if (p > 0) setLimitPrice(fmtPrice(p).replace(/,/g, ''));
                    }}
                    className="px-1.5 py-0.5 rounded bg-[#2B7FFF]/20 text-[#60A5FA]"
                  >
                    Best
                  </button>
                </div>
              </div>
              <input
                type="number"
                step="any"
                min="0"
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder={markPrice > 0 ? fmtPrice(markPrice) : '0.00'}
                className="w-full bg-[#000000] border border-[#1E232D] rounded px-2.5 py-1.5 text-sm font-mono text-white outline-none focus:border-[#2B7FFF]"
              />
              <div className="grid grid-cols-4 gap-1 text-xs font-mono">
                {([
                  [0, 'GTC'],
                  [2, 'PostOnly'],
                  [3, 'IOC'],
                  [1, 'FOK'],
                ] as [AfOrderType, string][]).map(([val, lbl]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setLimitOrderType(val)}
                    className={`py-1 rounded border ${
                      limitOrderType === val
                        ? 'bg-[#2B7FFF]/20 border-[#2B7FFF] text-white font-bold'
                        : 'bg-[#07090D] border-[#1A1E26] text-[#848E9C] hover:text-white'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
          )}

          {orderMode === 'stop' && (
            <div className="panel-carbon-sub rounded-md p-2.5 space-y-2 text-xs font-mono">
              <div className="grid grid-cols-2 gap-1 text-xs">
                <button
                  type="button"
                  onClick={() => setStopIsLimit(false)}
                  className={`py-1 rounded ${
                    !stopIsLimit ? 'bg-[#2B7FFF] text-white font-bold' : 'bg-white/[0.06] text-slate-300'
                  }`}
                >
                  Stop Market
                </button>
                <button
                  type="button"
                  onClick={() => setStopIsLimit(true)}
                  className={`py-1 rounded ${
                    stopIsLimit ? 'bg-[#2B7FFF] text-white font-bold' : 'bg-white/[0.06] text-slate-300'
                  }`}
                >
                  Stop Limit
                </button>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span>Trigger Price</span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setStopTriggerAbove(true)}
                    className={`px-1.5 py-0.5 rounded ${
                      stopTriggerAbove ? 'bg-[#08D189]/20 text-[#08D189] font-bold' : 'bg-white/[0.06] text-slate-400'
                    }`}
                  >
                    {'>='} Above
                  </button>
                  <button
                    type="button"
                    onClick={() => setStopTriggerAbove(false)}
                    className={`px-1.5 py-0.5 rounded ${
                      !stopTriggerAbove ? 'bg-[#F0525E]/20 text-[#F0525E] font-bold' : 'bg-white/[0.06] text-slate-400'
                    }`}
                  >
                    {'<='} Below
                  </button>
                </div>
              </div>
              <input
                type="number"
                step="any"
                min="0"
                value={stopTriggerPrice}
                onChange={(e) => {
                  setStopTriggerPrice(e.target.value);
                  const n = Number(e.target.value);
                  if (n > 0 && markPrice > 0) setStopTriggerAbove(n >= markPrice);
                }}
                placeholder={`Trigger @ (${fmtPrice(markPrice)})`}
                className="w-full bg-[#000000] border border-[#1E232D] rounded px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#2B7FFF]"
              />
              {stopIsLimit && (
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={stopLimitPrice}
                  onChange={(e) => setStopLimitPrice(e.target.value)}
                  placeholder="Limit Execution Price (USD)"
                  className="w-full bg-[#000000] border border-[#1E232D] rounded px-2.5 py-1.5 text-sm text-white outline-none focus:border-[#2B7FFF]"
                />
              )}
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Trigger By</span>
                <div className="flex gap-1">
                  {([
                    [2, 'Mark'],
                    [0, 'Index'],
                    [1, 'Book'],
                  ] as [AfTriggerPriceType, string][]).map(([val, lbl]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setStopTriggerSource(val)}
                      className={`px-1.5 py-0.5 rounded ${
                        stopTriggerSource === val ? 'bg-[#2B7FFF] text-white font-bold' : 'bg-white/[0.06]'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {orderMode === 'scale' && (
            <div className="panel-carbon-sub rounded-md p-2.5 space-y-2 text-xs font-mono">
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <span className="text-xs text-slate-400 block mb-0.5">Start Price ($)</span>
                  <input
                    type="number"
                    step="any"
                    value={scaleStartPrice}
                    onChange={(e) => setScaleStartPrice(e.target.value)}
                    placeholder={markPrice > 0 ? fmtPrice(markPrice * 0.96) : '0.00'}
                    className="w-full bg-[#000000] border border-[#1E232D] rounded px-2 py-1 text-white outline-none focus:border-[#2B7FFF]"
                  />
                </div>
                <div>
                  <span className="text-xs text-slate-400 block mb-0.5">End Price ($)</span>
                  <input
                    type="number"
                    step="any"
                    value={scaleEndPrice}
                    onChange={(e) => setScaleEndPrice(e.target.value)}
                    placeholder={markPrice > 0 ? fmtPrice(markPrice * 0.9) : '0.00'}
                    className="w-full bg-[#000000] border border-[#1E232D] rounded px-2 py-1 text-white outline-none focus:border-[#2B7FFF]"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300">Rungs: {scaleCount}</span>
                <input
                  type="range"
                  min={2}
                  max={15}
                  value={scaleCount}
                  onChange={(e) => setScaleCount(Number(e.target.value))}
                  className="w-28 accent-[#2B7FFF]"
                />
              </div>
              <div className="grid grid-cols-2 gap-1 text-xs">
                {([
                  [0, 'Standard (GTC)'],
                  [2, 'Post Only'],
                ] as [AfOrderType, string][]).map(([val, lbl]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setLimitOrderType(val)}
                    className={`py-1 rounded border ${
                      limitOrderType === val
                        ? 'bg-[#2B7FFF]/20 border-[#2B7FFF] text-white font-bold'
                        : 'bg-[#07090D] border-[#1A1E26] text-[#848E9C]'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
          )}

          {orderMode === 'twap' && (
            <div className="panel-carbon-sub rounded-md p-2.5 space-y-2 text-xs font-mono">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300">Slices: {twapChunks}x</span>
                <input
                  type="range"
                  min={2}
                  max={25}
                  value={twapChunks}
                  onChange={(e) => setTwapChunks(Number(e.target.value))}
                  className="w-32 accent-[#2B7FFF]"
                />
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300">Interval</span>
                <div className="flex gap-1">
                  {[30, 60, 300, 900].map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => setTwapGapSec(sec)}
                      className={`px-1.5 py-0.5 rounded ${
                        twapGapSec === sec ? 'bg-[#2B7FFF] text-white font-bold' : 'bg-white/[0.06] text-slate-300'
                      }`}
                    >
                      {sec < 60 ? `${sec}s` : `${sec / 60}m`}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300">Max Slippage</span>
                <div className="flex gap-1">
                  {[
                    [50, '0.5%'],
                    [150, '1.5%'],
                    [300, '3%'],
                  ].map(([bps, lbl]) => (
                    <button
                      key={bps}
                      type="button"
                      onClick={() => setTwapMaxSlipBps(Number(bps))}
                      className={`px-1.5 py-0.5 rounded ${
                        twapMaxSlipBps === bps ? 'bg-[#2B7FFF] text-white font-bold' : 'bg-white/[0.06] text-slate-300'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Est. Duration</span>
                <span className="text-white">
                  {Math.round((twapChunks * twapGapSec) / 60)}m ({twapMaxSlipBps / 100}% max slip)
                </span>
              </div>
            </div>
          )}

          {/* Margin / Reduce Size Input */}
          <div className="panel-carbon-sub rounded-md p-2.5 space-y-1.5">
            <div className="flex justify-between text-xs text-slate-300">
              <span>{reduceOnly ? `Close Size (${activeMarket?.symbol || 'PERP'})` : 'Margin (USDC)'}</span>
              <span className="font-mono text-white">
                {reduceOnly && activePosition
                  ? `Pos: ${Math.abs(activePosition.baseAssetAmount).toFixed(3)}`
                  : `Size: ${estContracts.toFixed(3)} ${activeMarket?.symbol || ''}`}
              </span>
            </div>
            <input
              type="number"
              min="0"
              step="any"
              value={reduceOnly ? reduceContracts : marginUsdc}
              onChange={(e) =>
                reduceOnly ? setReduceContracts(e.target.value) : setMarginUsdc(e.target.value)
              }
              className="w-full bg-transparent text-lg font-mono tabular-nums font-bold text-white outline-none"
            />
            <div className="grid grid-cols-4 gap-1">
              {[0.25, 0.5, 0.75, 1].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => {
                    if (reduceOnly && activePosition) {
                      setReduceContracts((Math.abs(activePosition.baseAssetAmount) * pct).toFixed(4));
                    } else {
                      const usable = Math.max(
                        0,
                        (afState?.availableCollateralUsd || 0) * (pct === 1 ? 0.94 : pct)
                      );
                      setMarginUsdc(usable.toFixed(2));
                    }
                  }}
                  className="py-1 rounded bg-[#07090D] border border-[#1A1E26] hover:border-[#2B7FFF]/60 text-[11px] font-mono text-slate-200 transition-colors"
                >
                  {pct === 1 ? (reduceOnly ? '100%' : 'MAX') : `${pct * 100}%`}
                </button>
              ))}
            </div>
          </div>

          {/* Toggles: Reduce-Only + TP/SL + Slippage */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono px-0.5">
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-200 select-none">
              <input
                type="checkbox"
                checked={reduceOnly}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setReduceOnly(checked);
                  if (checked && activePosition) {
                    setSide(activePosition.baseAssetAmount > 0 ? 'short' : 'long');
                    setReduceContracts(Math.abs(activePosition.baseAssetAmount).toFixed(4));
                  }
                }}
                className="accent-[#2B7FFF]"
              />
              <span>Reduce Only</span>
            </label>

            {(orderMode === 'market' || orderMode === 'limit') && (
              <label className="flex items-center gap-1.5 cursor-pointer text-slate-200 select-none">
                <input
                  type="checkbox"
                  checked={enableSlTp}
                  onChange={(e) => setEnableSlTp(e.target.checked)}
                  className="accent-[#2B7FFF]"
                />
                <span>TP / SL</span>
              </label>
            )}

            {orderMode === 'market' && (
              <div className="flex items-center gap-1">
                <span className="text-slate-400">Slip:</span>
                {[0.5, 1.5, 3].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setSlippagePct(v)}
                    className={`px-1.5 py-0.5 rounded ${
                      slippagePct === v ? 'bg-[#2B7FFF] text-white font-bold' : 'bg-white/[0.06] text-slate-400'
                    }`}
                  >
                    {v}%
                  </button>
                ))}
              </div>
            )}
          </div>

          {enableSlTp && (orderMode === 'market' || orderMode === 'limit') && (
            <div className="panel-carbon-sub rounded-md p-2.5 space-y-1.5 text-xs font-mono">
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <span className="text-xs pnl-green block mb-0.5">Take Profit ($)</span>
                  <input
                    type="number"
                    step="any"
                    value={tpPriceInput}
                    onChange={(e) => setTpPriceInput(e.target.value)}
                    placeholder={
                      markPrice > 0
                        ? fmtPrice(side === 'long' ? markPrice * 1.15 : markPrice * 0.85)
                        : 'Optional'
                    }
                    className="w-full bg-[#000000] border border-[#1E232D] rounded px-2 py-1 text-white outline-none focus:border-[#08D189]"
                  />
                </div>
                <div>
                  <span className="text-xs pnl-red block mb-0.5">Stop Loss ($)</span>
                  <input
                    type="number"
                    step="any"
                    value={slPriceInput}
                    onChange={(e) => setSlPriceInput(e.target.value)}
                    placeholder={
                      markPrice > 0
                        ? fmtPrice(side === 'long' ? markPrice * 0.92 : markPrice * 1.08)
                        : 'Optional'
                    }
                    className="w-full bg-[#000000] border border-[#1E232D] rounded px-2 py-1 text-white outline-none focus:border-[#F0525E]"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Trigger Source</span>
                <div className="flex gap-1">
                  {([
                    [2, 'Mark'],
                    [0, 'Index'],
                    [1, 'Book'],
                  ] as [AfTriggerPriceType, string][]).map(([val, lbl]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setSlTpTriggerType(val)}
                      className={`px-1.5 py-0.5 rounded ${
                        slTpTriggerType === val ? 'bg-[#2B7FFF] text-white font-bold' : 'bg-white/[0.06]'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Cost & Fee Summary */}
          <div className="panel-carbon-sub rounded-md p-2.5 space-y-1 text-xs font-mono tabular-nums">
            <div className="flex justify-between text-slate-300">
              <span>Notional Value</span>
              <span className="text-white font-semibold">${effectiveNotionalUsd.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-300">
              <span>Est. Liq Price</span>
              <span className="text-amber-300">{estLiqPrice > 0 ? `$${fmtPrice(estLiqPrice)}` : '—'}</span>
            </div>
            <div className="flex justify-between text-slate-300">
              <span>Volt Tier Fee ({traderTier.name})</span>
              <span className="text-[#60A5FA]">
                {reduceOnly ? '0.00% (Reduce)' : `${(traderTier.feeRate * 100).toFixed(2)}%`}
              </span>
            </div>
          </div>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={executePerpOrder}
            className={`w-full py-2.5 rounded font-bold text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-2 ${
              side === 'long'
                ? 'bg-[#2B7FFF] hover:bg-[#3C8BFF] text-white'
                : 'bg-[#F0525E] hover:bg-[#FF6370] text-white'
            } disabled:opacity-50`}
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>
              {!account
                ? 'Connect Wallet'
                : !afState?.accountId
                  ? 'Create Perp Account'
                  : isSubmitting
                    ? 'Confirming...'
                    : `${orderMode.toUpperCase()} ${side === 'long' ? 'BUY / LONG' : 'SELL / SHORT'} ${activeMarket?.symbol || 'PERP'}`}
            </span>
          </button>
        </div>

        {/* 5. Bottom Account Dock (Row 3, Cols 1-2 directly below Chart & Orderbook!) */}
        <div className="min-w-0 lg:col-span-2 lg:col-start-1 lg:row-start-3 bg-[#000000] lg:border-r border-[#1A1E26] p-3 sm:px-4 space-y-3 min-h-[210px]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1A1E26] pb-2">
            <div className="flex items-center gap-3 flex-wrap">
              {([
                ['positions', `Positions (${afState?.positions.length || 0})`],
                ['orders', `Open Orders (${afState?.pendingOrders.length || 0})`],
                ['stops', `Stop / TP-SL (${stopOrders.length})`],
                ['twap', `TWAP Orders (${twapOrders.length})`],
                ['history', 'History'],
              ] as [BottomTab, string][]).map(([tabId, label]) => (
                <button
                  key={tabId}
                  type="button"
                  onClick={() => setBottomTab(tabId)}
                  className={`pb-1 text-xs font-mono border-b-2 transition-colors ${
                    bottomTab === tabId
                      ? 'text-white border-[#2B7FFF] font-semibold'
                      : 'text-[#848E9C] border-transparent hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

          <div className="flex items-center gap-4 text-xs font-mono tabular-nums text-slate-300">
            <span>
              Equity:{' '}
              <span className="text-white font-bold">${(afState?.totalEquityUsd ?? 0).toFixed(2)}</span>
            </span>
            <span>
              uPnL:{' '}
              <span
                className={
                  (afState?.totalUnrealizedPnlUsd ?? 0) >= 0 ? 'pnl-green font-bold' : 'pnl-red font-bold'
                }
              >
                {(afState?.totalUnrealizedPnlUsd ?? 0) >= 0 ? '+' : ''}$
                {(afState?.totalUnrealizedPnlUsd ?? 0).toFixed(2)}
              </span>
            </span>
            <span className="hidden sm:inline">
              Funding:{' '}
              <span className="text-slate-200">
                ${(afState?.totalUnrealizedFundingsUsd ?? 0).toFixed(4)}
              </span>
            </span>
          </div>
        </div>

        {/* Tab 1: Open Positions */}
        {bottomTab === 'positions' &&
          (!afState || afState.positions.length === 0 ? (
            <div className="text-xs text-slate-400 font-mono py-4 text-center">
              {account ? 'No active perpetual positions open.' : 'Connect wallet to view Aftermath positions.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono tabular-nums">
                <thead>
                  <tr className="text-slate-400 text-left border-b border-white/[0.08]">
                    <th className="py-1.5">Market</th>
                    <th className="py-1.5">Side / Lev</th>
                    <th className="py-1.5">Size</th>
                    <th className="py-1.5">Entry</th>
                    <th className="py-1.5">Liq. Price</th>
                    <th className="py-1.5">Margin</th>
                    <th className="py-1.5">uPnL / ROI</th>
                    <th className="py-1.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {afState.positions.map((pos) => {
                    const mkt = marketsById[pos.marketId];
                    const isLong = pos.baseAssetAmount > 0;
                    const roi = pos.collateralUsd > 0 ? (pos.unrealizedPnlUsd / pos.collateralUsd) * 100 : 0;
                    return (
                      <tr key={pos.marketId} className="text-slate-200">
                        <td className="py-2 font-bold text-white">{mkt?.symbol || 'PERP'}-PERP</td>
                        <td className="py-2">
                          <span className={isLong ? 'pnl-green font-bold' : 'pnl-red font-bold'}>
                            {isLong ? 'LONG' : 'SHORT'} {Math.round(pos.leverage)}x
                          </span>
                        </td>
                        <td className="py-2">{Math.abs(pos.baseAssetAmount).toFixed(3)}</td>
                        <td className="py-2">${fmtPrice(pos.entryPrice)}</td>
                        <td className="py-2 text-amber-300">
                          {pos.liquidationPrice > 0 ? `$${fmtPrice(pos.liquidationPrice)}` : '—'}
                        </td>
                        <td className="py-2">${pos.collateralUsd.toFixed(2)}</td>
                        <td className={`py-2 font-bold ${pos.unrealizedPnlUsd >= 0 ? 'pnl-green' : 'pnl-red'}`}>
                          {pos.unrealizedPnlUsd >= 0 ? '+' : ''}${pos.unrealizedPnlUsd.toFixed(2)}{' '}
                          <span className="text-xs opacity-85">
                            ({roi >= 0 ? '+' : ''}
                            {roi.toFixed(1)}%)
                          </span>
                        </td>
                        <td className="py-2 text-right">
                          <div className="inline-flex items-center gap-1 flex-wrap justify-end">
                            <button
                              type="button"
                              onClick={() => {
                                setSlTpModalPos(pos);
                                setModalTp('');
                                setModalSl('');
                              }}
                              className="px-2 py-1 rounded bg-[#2B7FFF]/15 hover:bg-[#2B7FFF]/25 text-[#60A5FA] border border-[#2B7FFF]/35 inline-flex items-center gap-1"
                            >
                              <ShieldAlert className="w-3 h-3" />
                              TP/SL
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setMarginModalPos(pos);
                                setMarginModalDir('add');
                                setMarginModalAmt('');
                              }}
                              className="px-2 py-1 rounded bg-white/[0.07] hover:bg-white/[0.14] text-white inline-flex items-center gap-1"
                            >
                              <SlidersHorizontal className="w-3 h-3" />
                              Margin
                            </button>
                            <button
                              type="button"
                              disabled={isSubmitting}
                              onClick={() => handleClosePosition(pos, 0.5)}
                              className="px-2 py-1 rounded bg-white/[0.07] hover:bg-white/[0.14] text-slate-200"
                            >
                              50%
                            </button>
                            <button
                              type="button"
                              disabled={isSubmitting}
                              onClick={() => handleClosePosition(pos, 1)}
                              className="px-2 py-1 rounded bg-[#F0525E]/20 hover:bg-[#F0525E]/35 text-[#F0525E] border border-[#F0525E]/35"
                            >
                              Close
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                onTradeRecorded({
                                  fromToken: 'USDC',
                                  toToken: `${mkt?.symbol || 'SUI'}-PERP`,
                                  fromAmount: pos.collateralUsd.toFixed(2),
                                  toAmount: `${Math.abs(pos.baseAssetAmount).toFixed(2)} (${Math.round(pos.leverage)}x)`,
                                  volumeUsd: Math.abs(pos.quoteAssetNotionalAmount),
                                  profitUsd: pos.unrealizedPnlUsd,
                                  profitPct: roi,
                                  digest: 'active-position',
                                  orderType: 'PERPS',
                                })
                              }
                              className="px-2 py-1 rounded bg-[#2B7FFF]/15 hover:bg-[#2B7FFF]/25 text-[#60A5FA] border border-[#2B7FFF]/35 inline-flex items-center gap-1"
                            >
                              <Share2 className="w-3 h-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

        {/* Tab 2: Resting Limit Orders */}
        {bottomTab === 'orders' &&
          (!afState || afState.pendingOrders.length === 0 ? (
            <div className="text-xs text-slate-400 font-mono py-4 text-center">
              No active resting Limit orders on the Aftermath book.
            </div>
          ) : (
            <div className="overflow-x-auto space-y-2">
              <div className="flex justify-end gap-2">
                {Array.from(new Set(afState.pendingOrders.map((o) => o.marketId))).map((mId) => {
                  const ids = afState.pendingOrders.filter((o) => o.marketId === mId).map((o) => o.orderId);
                  return (
                    <button
                      key={mId}
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => handleCancelPendingOrders(mId, ids)}
                      className="px-2.5 py-1 rounded bg-[#F0525E]/15 hover:bg-[#F0525E]/25 text-[#F0525E] border border-[#F0525E]/35 text-xs font-mono font-bold transition-colors"
                    >
                      Cancel All {marketsById[mId]?.symbol || ''} ({ids.length})
                    </button>
                  );
                })}
              </div>
              <table className="w-full text-xs font-mono tabular-nums">
                <thead>
                  <tr className="text-[#6B7280] text-[10px] uppercase tracking-wider text-left border-b border-[#1A1E26]">
                    <th className="py-1.5">Market</th>
                    <th className="py-1.5">Side</th>
                    <th className="py-1.5">Limit Price</th>
                    <th className="py-1.5">Remaining / Initial</th>
                    <th className="py-1.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1A1E26]">
                  {afState.pendingOrders.map((ord) => {
                    const mkt = marketsById[ord.marketId];
                    const isBid = ord.side === 0;
                    return (
                      <tr key={ord.orderId} className="text-slate-200 hover:bg-[#0C0E13] transition-colors">
                        <td className="py-2 font-bold text-white">{mkt?.symbol || 'PERP'}-PERP</td>
                        <td className={`py-2 font-bold ${isBid ? 'pnl-green' : 'pnl-red'}`}>
                          {isBid ? 'BUY / LONG' : 'SELL / SHORT'}
                        </td>
                        <td className="py-2 text-white">${fmtPrice(ord.price)}</td>
                        <td className="py-2">
                          {ord.currentSize.toFixed(3)} / {ord.initialSize.toFixed(3)}
                        </td>
                        <td className="py-2 text-right">
                          <button
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => handleCancelPendingOrders(ord.marketId, [ord.orderId])}
                            className="px-2.5 py-1 rounded bg-[#F0525E]/15 hover:bg-[#F0525E]/25 text-[#F0525E] border border-[#F0525E]/35 transition-colors"
                          >
                            Cancel
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

        {/* Tab 3: Stop & TP/SL Orders (Signed session auth) */}
        {bottomTab === 'stops' && (
          <div className="space-y-2">
            {!afSig ? (
              <div className="py-5 text-center space-y-2">
                <p className="text-xs text-slate-300 font-mono">
                  Aftermath protects off-chain Stop & TP/SL trigger queues with a 1-time session signature.
                </p>
                <button
                  type="button"
                  disabled={!account || !afState?.accountId || isLoadingSigned}
                  onClick={() => loadSignedOrders('stops')}
                  className="px-4 py-2 rounded-lg btn-deepbook text-xs font-bold inline-flex items-center gap-1.5"
                >
                  {isLoadingSigned ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <KeyRound className="w-3.5 h-3.5" />
                  )}
                  Load Active Stop & TP/SL Orders
                </button>
              </div>
            ) : stopOrders.length === 0 ? (
              <div className="text-xs text-slate-400 font-mono py-4 text-center flex items-center justify-center gap-3">
                <span>No active Stop or TP/SL trigger orders.</span>
                <button
                  type="button"
                  onClick={() => loadSignedOrders('stops')}
                  className="text-[#60A5FA] hover:underline"
                >
                  Refresh
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="text-slate-400 text-left border-b border-white/[0.08]">
                      <th className="py-1.5">Market</th>
                      <th className="py-1.5">Type / Side</th>
                      <th className="py-1.5">Size</th>
                      <th className="py-1.5">Trigger Conditions</th>
                      <th className="py-1.5">State</th>
                      <th className="py-1.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {stopOrders.map((so) => {
                      const mkt = marketsById[so.marketId];
                      return (
                        <tr key={so.objectId} className="text-slate-200">
                          <td className="py-2 font-bold text-white">{mkt?.symbol || 'PERP'}-PERP</td>
                          <td className="py-2">
                            <span className={so.side === 0 ? 'pnl-green font-bold' : 'pnl-red font-bold'}>
                              {so.slTp ? 'TP/SL' : 'STOP'} · {so.side === 0 ? 'LONG' : 'SHORT'}
                            </span>
                          </td>
                          <td className="py-2">{so.size.toFixed(3)}</td>
                          <td className="py-2">
                            {so.slTp
                              ? `${so.slTp.takeProfitPrice ? `TP $${fmtPrice(so.slTp.takeProfitPrice)} ` : ''}${so.slTp.stopLossPrice ? `SL $${fmtPrice(so.slTp.stopLossPrice)}` : ''}`
                              : so.nonSlTp
                                ? `${so.nonSlTp.triggerIfGeStopIndexPrice ? '>=' : '<='} $${fmtPrice(so.nonSlTp.stopIndexPrice)}${so.limitPrice ? ` → Limit $${fmtPrice(so.limitPrice)}` : ''}`
                                : '—'}
                          </td>
                          <td className="py-2 uppercase text-xs text-[#60A5FA]">{so.orderState}</td>
                          <td className="py-2 text-right">
                            <button
                              type="button"
                              disabled={isSubmitting}
                              onClick={() => handleCancelStopOrder(so.objectId)}
                              className="px-2.5 py-1 rounded bg-[#F0525E]/20 hover:bg-[#F0525E]/35 text-[#F0525E] border border-[#F0525E]/35"
                            >
                              Cancel
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 4: TWAP Orders (Signed session auth) */}
        {bottomTab === 'twap' && (
          <div className="space-y-2">
            {!afSig ? (
              <div className="py-5 text-center space-y-2">
                <p className="text-xs text-slate-300 font-mono">
                  Sign once per session to inspect & manage scheduled Aftermath TWAP executions.
                </p>
                <button
                  type="button"
                  disabled={!account || !afState?.accountId || isLoadingSigned}
                  onClick={() => loadSignedOrders('twap')}
                  className="px-4 py-2 rounded-lg btn-deepbook text-xs font-bold inline-flex items-center gap-1.5"
                >
                  {isLoadingSigned ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <KeyRound className="w-3.5 h-3.5" />
                  )}
                  Load Active TWAP Orders
                </button>
              </div>
            ) : twapOrders.length === 0 ? (
              <div className="text-xs text-slate-400 font-mono py-4 text-center flex items-center justify-center gap-3">
                <span>No active TWAP schedules.</span>
                <button
                  type="button"
                  onClick={() => loadSignedOrders('twap')}
                  className="text-[#60A5FA] hover:underline"
                >
                  Refresh
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="text-slate-400 text-left border-b border-white/[0.08]">
                      <th className="py-1.5">Market</th>
                      <th className="py-1.5">Side</th>
                      <th className="py-1.5">Progress</th>
                      <th className="py-1.5">Slices / Gap</th>
                      <th className="py-1.5">Status</th>
                      <th className="py-1.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {twapOrders.map((tw) => {
                      const mkt = marketsById[tw.marketId];
                      return (
                        <tr key={tw.twapOrderObjectId} className="text-slate-200">
                          <td className="py-2 font-bold text-white">{mkt?.symbol || 'PERP'}-PERP</td>
                          <td className={`py-2 font-bold ${tw.side === 0 ? 'pnl-green' : 'pnl-red'}`}>
                            {tw.side === 0 ? 'LONG' : 'SHORT'}
                          </td>
                          <td className="py-2">
                            {tw.processedSize.toFixed(3)} / {tw.totalSize.toFixed(3)}
                          </td>
                          <td className="py-2">
                            {tw.chunksAmount}x every {Math.round(tw.executionGapMs / 1000)}s
                          </td>
                          <td className="py-2 uppercase text-xs text-[#60A5FA]">{tw.orderState}</td>
                          <td className="py-2 text-right">
                            <button
                              type="button"
                              disabled={isSubmitting}
                              onClick={() => handleCancelTwapOrder(tw.twapOrderObjectId)}
                              className="px-2.5 py-1 rounded bg-[#F0525E]/20 hover:bg-[#F0525E]/35 text-[#F0525E] border border-[#F0525E]/35"
                            >
                              Cancel
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 5: Order & Margin History */}
        {bottomTab === 'history' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setHistorySubTab('orders')}
                className={`px-2.5 py-1 rounded text-xs font-mono ${
                  historySubTab === 'orders'
                    ? 'bg-white/[0.12] text-white font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Order History ({orderHistory.length})
              </button>
              <button
                type="button"
                onClick={() => setHistorySubTab('collateral')}
                className={`px-2.5 py-1 rounded text-xs font-mono ${
                  historySubTab === 'collateral'
                    ? 'bg-white/[0.12] text-white font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Collateral & Margin ({collateralHistory.length})
              </button>
            </div>

            {historySubTab === 'orders' ? (
              orderHistory.length === 0 ? (
                <div className="text-xs text-slate-400 font-mono py-4 text-center">
                  No perpetual order fills recorded yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono tabular-nums">
                    <thead>
                      <tr className="text-slate-400 text-left border-b border-white/[0.08]">
                        <th className="py-1.5">Time</th>
                        <th className="py-1.5">Market</th>
                        <th className="py-1.5">Event</th>
                        <th className="py-1.5">Size @ Price</th>
                        <th className="py-1.5">PnL / Fee</th>
                        <th className="py-1.5 text-right">Tx</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06]">
                      {orderHistory.map((h, i) => (
                        <tr key={`${h.txDigest}-${i}`} className="text-slate-200">
                          <td className="py-1.5 text-slate-400">
                            {h.timestamp > 0 ? new Date(h.timestamp).toLocaleString() : '—'}
                          </td>
                          <td className="py-1.5 font-bold text-white">
                            {marketsById[h.marketId]?.symbol || 'PERP'}-PERP
                          </td>
                          <td className="py-1.5">
                            <span className={h.side === 0 ? 'pnl-green' : h.side === 1 ? 'pnl-red' : 'text-slate-300'}>
                              {h.eventType}
                            </span>
                          </td>
                          <td className="py-1.5">
                            {h.size !== undefined ? `${h.size.toFixed(3)} @ $${fmtPrice(h.price || 0)}` : '—'}
                          </td>
                          <td className="py-1.5">
                            {h.pnl !== undefined ? (
                              <span className={h.pnl >= 0 ? 'pnl-green' : 'pnl-red'}>
                                {h.pnl >= 0 ? '+' : ''}${h.pnl.toFixed(3)}
                              </span>
                            ) : (
                              '—'
                            )}
                            {h.fees !== undefined ? ` / $${h.fees.toFixed(4)}` : ''}
                          </td>
                          <td className="py-1.5 text-right">
                            {h.txDigest && (
                              <a
                                href={`https://suiscan.xyz/mainnet/tx/${h.txDigest}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-[#60A5FA] hover:underline"
                              >
                                {h.txDigest.slice(0, 6)}...
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : collateralHistory.length === 0 ? (
              <div className="text-xs text-slate-400 font-mono py-4 text-center">
                No margin / collateral events recorded yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="text-slate-400 text-left border-b border-white/[0.08]">
                      <th className="py-1.5">Time</th>
                      <th className="py-1.5">Event</th>
                      <th className="py-1.5">Collateral Δ</th>
                      <th className="py-1.5">USD Value</th>
                      <th className="py-1.5 text-right">Tx</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.06]">
                    {collateralHistory.map((c, i) => (
                      <tr key={`${c.txDigest}-${i}`} className="text-slate-200">
                        <td className="py-1.5 text-slate-400">
                          {c.timestamp > 0 ? new Date(c.timestamp).toLocaleString() : '—'}
                        </td>
                        <td className="py-1.5">{c.eventType}</td>
                        <td className={`py-1.5 font-bold ${c.collateralChange >= 0 ? 'pnl-green' : 'pnl-red'}`}>
                          {c.collateralChange >= 0 ? '+' : ''}
                          {c.collateralChange.toFixed(4)} USDC
                        </td>
                        <td className="py-1.5">${c.collateralChangeUsd.toFixed(4)}</td>
                        <td className="py-1.5 text-right">
                          {c.txDigest && (
                            <a
                              href={`https://suiscan.xyz/mainnet/tx/${c.txDigest}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[#60A5FA] hover:underline"
                            >
                              {c.txDigest.slice(0, 6)}...
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
      </div>

      {/* Deposit / Withdraw Collateral Modal */}
      {collateralModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="panel-carbon w-full max-w-sm rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">
                {collateralModal === 'deposit' ? 'Deposit USDC Collateral' : 'Withdraw Free USDC'}
              </h3>
              <button
                type="button"
                onClick={() => setCollateralModal(null)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="panel-carbon-sub rounded-xl p-3 space-y-2">
              <div className="flex justify-between text-xs text-slate-300 font-mono">
                <span>{collateralModal === 'deposit' ? 'Wallet USDC' : 'Available Perp Margin'}</span>
                <span className="inline-flex items-center gap-1 text-white">
                  <Wallet className="w-3 h-3" />
                  {collateralModal === 'deposit'
                    ? walletUsdc.toFixed(2)
                    : (afState?.availableCollateralUsd ?? 0).toFixed(2)}{' '}
                  USDC
                </span>
              </div>
              <input
                type="number"
                step="any"
                min="0"
                value={collateralAmt}
                onChange={(e) => setCollateralAmt(e.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent text-2xl font-mono font-bold text-white outline-none"
              />
            </div>
            <button
              type="button"
              disabled={isCollateralBusy || !(Number(collateralAmt) > 0)}
              onClick={handleCollateralSubmit}
              className="w-full py-2.5 rounded-xl btn-deepbook font-bold text-sm"
            >
              {isCollateralBusy
                ? 'Confirm in Wallet...'
                : collateralModal === 'deposit'
                  ? 'Deposit to Aftermath Account'
                  : 'Withdraw to Wallet'}
            </button>
          </div>
        </div>
      )}

      {/* Position TP / SL Modal */}
      {slTpModalPos && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="panel-carbon w-full max-w-sm rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">
                Set TP / SL · {marketsById[slTpModalPos.marketId]?.symbol || 'PERP'}-PERP
              </h3>
              <button
                type="button"
                onClick={() => setSlTpModalPos(null)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="text-xs font-mono text-slate-300 flex justify-between panel-carbon-sub p-2.5 rounded-lg">
              <span>Entry: ${fmtPrice(slTpModalPos.entryPrice)}</span>
              <span>Mark: ${fmtPrice(marketsById[slTpModalPos.marketId]?.markPrice || markPrice)}</span>
            </div>
            <div className="space-y-3 text-xs font-mono">
              <div>
                <label className="pnl-green block mb-1">Take Profit Trigger ($)</label>
                <input
                  type="number"
                  step="any"
                  value={modalTp}
                  onChange={(e) => setModalTp(e.target.value)}
                  placeholder="Optional TP Price"
                  className="w-full bg-[#000000] border border-[#1E232D] rounded px-3 py-2 text-white outline-none focus:border-[#08D189]"
                />
              </div>
              <div>
                <label className="pnl-red block mb-1">Stop Loss Trigger ($)</label>
                <input
                  type="number"
                  step="any"
                  value={modalSl}
                  onChange={(e) => setModalSl(e.target.value)}
                  placeholder="Optional SL Price"
                  className="w-full bg-[#000000] border border-[#1E232D] rounded px-3 py-2 text-white outline-none focus:border-[#F0525E]"
                />
              </div>
              <div className="flex items-center justify-between text-slate-300">
                <span>Trigger Type</span>
                <div className="flex gap-1">
                  {([
                    [2, 'Mark'],
                    [0, 'Index'],
                    [1, 'Book'],
                  ] as [AfTriggerPriceType, string][]).map(([val, lbl]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setModalTriggerSrc(val)}
                      className={`px-2 py-1 rounded ${
                        modalTriggerSrc === val ? 'bg-[#2B7FFF] text-white font-bold' : 'bg-white/[0.06]'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleSubmitPositionSlTp}
              className="w-full py-2.5 rounded btn-deepbook font-bold text-sm"
            >
              {isSubmitting ? 'Signing Transaction...' : 'Confirm TP / SL On-Chain'}
            </button>
          </div>
        </div>
      )}

      {/* Position Add / Remove Margin Modal */}
      {marginModalPos && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="panel-carbon w-full max-w-sm rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">
                Manage Margin · {marketsById[marginModalPos.marketId]?.symbol || 'PERP'}-PERP
              </h3>
              <button
                type="button"
                onClick={() => setMarginModalPos(null)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-xs font-mono">
              <button
                type="button"
                onClick={() => setMarginModalDir('add')}
                className={`py-2 rounded font-bold ${
                  marginModalDir === 'add' ? 'bg-[#08D189] text-black' : 'bg-white/[0.06] text-slate-300'
                }`}
              >
                Add Margin
              </button>
              <button
                type="button"
                onClick={() => setMarginModalDir('remove')}
                className={`py-2 rounded font-bold ${
                  marginModalDir === 'remove' ? 'bg-[#2B7FFF] text-white' : 'bg-white/[0.06] text-slate-300'
                }`}
              >
                Remove Margin
              </button>
            </div>
            <div className="panel-carbon-sub rounded-xl p-3 space-y-1.5 text-xs font-mono">
              <div className="flex justify-between text-slate-300">
                <span>{marginModalDir === 'add' ? 'Account Free USDC' : 'Pos Free Margin'}</span>
                <span className="text-white">
                  $
                  {(marginModalDir === 'add'
                    ? afState?.availableCollateralUsd ?? 0
                    : marginModalPos.freeMarginUsd
                  ).toFixed(2)}
                </span>
              </div>
              <input
                type="number"
                step="any"
                min="0"
                value={marginModalAmt}
                onChange={(e) => setMarginModalAmt(e.target.value)}
                placeholder="0.00 USDC"
                className="w-full bg-transparent text-2xl font-mono font-bold text-white outline-none"
              />
            </div>
            <button
              type="button"
              disabled={isSubmitting || !(Number(marginModalAmt) > 0)}
              onClick={handleSubmitPositionMargin}
              className="w-full py-2.5 rounded-xl btn-deepbook font-bold text-sm"
            >
              {isSubmitting
                ? 'Confirm in Wallet...'
                : marginModalDir === 'add'
                  ? 'Allocate Margin to Position'
                  : 'Return Margin to Account'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
