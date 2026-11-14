import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ArrowDownUp,
  ChevronDown,
  Loader2,
  SlidersHorizontal,
  ShieldCheck,
  Wallet,
  X,
  RefreshCw,
  CheckCircle2,
  BarChart2,
  Bot,
  Search,
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowRight,
  Zap,
  Layers,
} from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { POPULAR_TOKENS, type Token } from '../constants';
import {
  extractTxDigest,
  fetchWalletBalances,
  readBalanceFromMap,
  safeNormalizeCoinType,
} from '../suiClient';
import { simulateTxBeforeWallet } from '../suiSimulate';
import { buildBestSwapTx, fetchBestSwapQuote, type SmartSwapQuote } from '../smartSwap';
import {
  addWalletVolumeUsd,
  calcFeeUnits,
  getValidReferrerForSender,
  resolveReferralTier,
  resolveTraderTier,
} from '../voltFee';
import { useSyncedWalletVolume } from '../onChainVolume';
import {
  buildCancelDeepBookOrderTx,
  buildCreateAndDepositManagerTx,
  buildDepositManagerTx,
  buildPlaceDeepBookLimitOrderTx,
  buildPlaceDeepBookMarketOrderTx,
  buildWithdrawAllManagersAndCancelTx,
  DEFAULT_DEEPBOOK_POOLS,
  discoverBalanceManagers,
  fetchAllDeepBookManagerStates,
  fetchDeepBookCandles,
  fetchDeepBookOrderbook,
  fetchDeepBookPools,
  fetchDeepBookTrades,
  fetchPythOraclePrice,
  fetchVoltSpotReferrals,
  type DeepBookCandle,
  type DeepBookManagerState,
  type DeepBookOpenOrder,
  type DeepBookOrderbook,
  type DeepBookPoolMeta,
  type DeepBookTrade,
  type VoltSpotReferral,
} from '../deepbookV3';
import { fetchSwapPairCandles } from '../spotCandles';
import { ProCandleChart, type ChartTimeframe } from './ProCandleChart';
import type { PnlTradeData } from '../PnlShareModal';
import { AiCopilotModal } from './AiCopilotModal';

export type SwapMode = 'market' | 'limit';

interface SwapWorkspaceProps {
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

const SUI_TOKENS = POPULAR_TOKENS.filter((t) => t.chain === 'sui');

export const AGGREGATED_PROTOCOLS = [
  { id: 'cetus', name: 'Cetus CLMM', note: 'Concentrated AMM' },
  { id: 'bluefin', name: 'Bluefin / 7K', note: 'Tide RFQ & AMM' },
  { id: 'deepbook', name: 'DeepBook v3', note: 'Native CLOB' },
  { id: 'turbos', name: 'Turbos', note: 'CLMM' },
  { id: 'aftermath', name: 'Aftermath', note: 'Multi-Asset' },
  { id: 'flowx', name: 'FlowX', note: 'Ecosystem DEX' },
  { id: 'kriya', name: 'Kriya', note: 'AMM & CLOB' },
] as const;

const SYMBOL_LOGO_OVERRIDES: Record<string, string> = {
  SUI: '/tokens/sui.svg',
  USDC: '/tokens/usdc.svg',
  WUSDC: '/tokens/usdc.svg',
  USDT: '/tokens/usdt.svg',
  WUSDT: '/tokens/usdt.svg',
  DEEP: '/tokens/deep.svg',
  WAL: '/tokens/wal.svg',
  XBTC: '/tokens/btc.svg',
  HBTC: '/tokens/btc.svg',
  LZWBTC: '/tokens/btc.svg',
  WBTC: '/tokens/btc.svg',
  BWETH: '/tokens/eth.svg',
  BETH: '/tokens/eth.svg',
  WETH: '/tokens/eth.svg',
  NS: '/tokens/ns.svg',
  SEND: '/tokens/send.svg',
  BUCK: '/tokens/buck.svg',
  NAVX: '/tokens/navx.svg',
  SCA: '/tokens/sca.svg',
  HASUI: '/tokens/hasui.svg',
  VSUI: '/tokens/vsui.png',
  AFSUI: '/tokens/afsui.svg',
  CETUS: '/tokens/cetus.svg',
  BLUE: '/tokens/blue.png',
  FUD: '/tokens/fud.svg',
  BLUB: '/tokens/blub.svg',
};

function resolveTokenLogo(symbol: string, coinId?: string): string | null {
  const symUpper = symbol.toUpperCase().trim();
  if (SYMBOL_LOGO_OVERRIDES[symUpper]) return SYMBOL_LOGO_OVERRIDES[symUpper];
  const matched = SUI_TOKENS.find(
    (t) =>
      t.symbol.toUpperCase() === symUpper ||
      (coinId && safeNormalizeCoinType(t.address) === safeNormalizeCoinType(coinId))
  );
  return matched?.logo || null;
}

function fmtClobPrice(px: number): string {
  if (!Number.isFinite(px) || px <= 0) return '—';
  if (px >= 1000) return px.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (px >= 1) return px.toFixed(4);
  if (px >= 0.01) return px.toFixed(4);
  return px.toFixed(6);
}

const TokenBadgeIcon: React.FC<{ symbol: string; coinId?: string; sizeClass?: string }> = ({
  symbol,
  coinId,
  sizeClass = 'w-5 h-5',
}) => {
  const [broken, setBroken] = useState(false);
  const src = resolveTokenLogo(symbol, coinId);
  if (!src || broken) {
    return (
      <span
        className={`${sizeClass} rounded-full bg-[#131823] border border-[#2B7FFF]/40 flex items-center justify-center text-[9px] font-bold font-mono text-[#60A5FA] shrink-0`}
      >
        {symbol.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={symbol}
      onError={() => setBroken(true)}
      className={`${sizeClass} rounded-full object-cover bg-[#0C0E13] border border-white/10 shrink-0`}
    />
  );
};

const PairBadgeIcons: React.FC<{ pool: DeepBookPoolMeta; size?: 'sm' | 'md' }> = ({
  pool,
  size = 'md',
}) => {
  const cls = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  return (
    <span className="inline-flex items-center -space-x-1.5 shrink-0">
      <TokenBadgeIcon symbol={pool.baseSymbol} coinId={pool.baseCoinId} sizeClass={cls} />
      <TokenBadgeIcon symbol={pool.quoteSymbol} coinId={pool.quoteCoinId} sizeClass={cls} />
    </span>
  );
};

export const SwapWorkspace: React.FC<SwapWorkspaceProps> = ({
  onNotify,
  onTradeRecorded,
  onVolumeUpdated,
}) => {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();

  const [mode, setMode] = useState<SwapMode>('market');
  const [balances, setBalances] = useState<Record<string, bigint>>({});

  // Market Swap state
  const [fromToken, setFromToken] = useState<Token>(
    SUI_TOKENS.find((t) => t.symbol === 'SUI') || SUI_TOKENS[0]
  );
  const [toToken, setToToken] = useState<Token>(
    SUI_TOKENS.find((t) => t.symbol === 'USDC') || SUI_TOKENS[1]
  );
  const [amountIn, setAmountIn] = useState<string>('1');
  const [slippagePct, setSlippagePct] = useState<number>(0.5);
  const [showSettings, setShowSettings] = useState(false);
  const [showMarketChart, setShowMarketChart] = useState<boolean>(false);
  const [showAiCopilot, setShowAiCopilot] = useState(false);
  const [tokenPickerFor, setTokenPickerFor] = useState<'from' | 'to' | null>(null);
  const [tokenQuery, setTokenQuery] = useState('');

  const [quote, setQuote] = useState<SmartSwapQuote | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [isSwapping, setIsSwapping] = useState(false);

  // Lite Limit Order state (inside Swap card, Cetus/Jupiter UX backed by DeepBook v3)
  const [swapCardTab, setSwapCardTab] = useState<'market' | 'limit'>('market');
  const [liteLimitRate, setLiteLimitRate] = useState<string>('');
  const [liteRateInverted, setLiteRateInverted] = useState<boolean>(false);
  const [liteExpiryMs, setLiteExpiryMs] = useState<number>(7 * 86400 * 1000);
  const [isPlacingLiteLimit, setIsPlacingLiteLimit] = useState(false);

  // DeepBook v3 Limit Terminal state
  const [pools, setPools] = useState<DeepBookPoolMeta[]>(DEFAULT_DEEPBOOK_POOLS);
  const [activePool, setActivePool] = useState<DeepBookPoolMeta>(DEFAULT_DEEPBOOK_POOLS[0]);
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('15m');
  const [candles, setCandles] = useState<DeepBookCandle[]>([]);
  const [candlesLoading, setCandlesLoading] = useState(false);
  const [chartMeta, setChartMeta] = useState<{ label: string; source: string }>({
    label: 'SUI / USDC',
    source: 'DeepBook v3',
  });
  const [orderbook, setOrderbook] = useState<DeepBookOrderbook>({
    bids: [],
    asks: [],
    midPrice: 0,
    spreadPct: 0,
  });
  const [trades, setTrades] = useState<DeepBookTrade[]>([]);
  const [oraclePrice, setOraclePrice] = useState<number | null>(null);
  const [bookTab, setBookTab] = useState<'book' | 'trades'>('book');

  const [managerIds, setManagerIds] = useState<string[]>([]);
  const [managerStates, setManagerStates] = useState<DeepBookManagerState[]>([]);
  const [spotReferrals, setSpotReferrals] = useState<Record<string, VoltSpotReferral>>({});
  const [spotOrderStyle, setSpotOrderStyle] = useState<'market' | 'limit'>('market');
  const [spotMarketSlippage, setSpotMarketSlippage] = useState<number>(1.5);
  const [limitSide, setLimitSide] = useState<'buy' | 'sell'>('buy');
  const [limitPrice, setLimitPrice] = useState<string>('');
  const [limitQty, setLimitQty] = useState<string>('1');
  const [qtyCurrency, setQtyCurrency] = useState<'base' | 'quote'>('base');
  const [postOnly, setPostOnly] = useState(false);
  const [spotTif, setSpotTif] = useState<'GTC' | 'IOC' | 'FOK' | 'POST_ONLY'>('GTC');
  const [payFeesWithDeep, setPayFeesWithDeep] = useState<boolean>(false);
  const [bookTickMult, setBookTickMult] = useState<number>(1);
  const [bookSizeUnit, setBookSizeUnit] = useState<'base' | 'quote'>('base');
  const [isPlacingLimit, setIsPlacingLimit] = useState(false);
  const [depositCoinSide, setDepositCoinSide] = useState<'base' | 'quote'>('quote');
  const [depositAmt, setDepositAmt] = useState<string>('');
  const [isVaultBusy, setIsVaultBusy] = useState(false);


  // DeepBook Pair Dropdown & Spot Dock tab state
  const [showPoolDropdown, setShowPoolDropdown] = useState(false);
  const [poolSearch, setPoolSearch] = useState('');
  const [poolQuoteFilter, setPoolQuoteFilter] = useState<'all' | 'usdc' | 'sui' | 'bluechip'>('all');
  const [spotDockTab, setSpotDockTab] = useState<'orders' | 'history'>('orders');
  const [spotHistory, setSpotHistory] = useState<
    Array<{
      id: string;
      poolName: string;
      side: 'buy' | 'sell';
      style: string;
      price: number;
      qty: number;
      baseSymbol: string;
      quoteSymbol: string;
      digest: string;
      ts: number;
    }>
  >([]);
  const [showSpotVaultModal, setShowSpotVaultModal] = useState<'deposit' | 'withdraw' | null>(null);
  const poolDropdownRef = useRef<HTMLDivElement>(null);

  // Tier & Referral (synced with Sui Mainnet + Aftermath on-chain volume)
  const { volumeUsd: walletVolumeUsd } = useSyncedWalletVolume(account?.address);
  const activeReferrer = useMemo(() => getValidReferrerForSender(account?.address), [account?.address]);
  const traderTier = useMemo(
    () => resolveTraderTier(walletVolumeUsd, Boolean(activeReferrer)),
    [walletVolumeUsd, activeReferrer]
  );
  const refTier = useMemo(() => resolveReferralTier(walletVolumeUsd), [walletVolumeUsd]);

  const refreshBalances = useCallback(async () => {
    if (!account?.address) {
      setBalances({});
      return;
    }
    try {
      const map = await fetchWalletBalances(account.address);
      setBalances(map);
    } catch {
      // keep existing
    }
  }, [account?.address]);

  useEffect(() => {
    refreshBalances();
  }, [refreshBalances]);

  // Live Market Swap Quote (Cetus Aggregator)
  useEffect(() => {
    if (mode !== 'market') return;
    const val = Number(amountIn);
    if (!Number.isFinite(val) || val <= 0 || fromToken.address === toToken.address) {
      setQuote(null);
      setQuoteError(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsQuoting(true);
      setQuoteError(null);
      try {
        const atomic = BigInt(Math.floor(val * Math.pow(10, fromToken.decimals)));
        const q = await fetchBestSwapQuote({
          fromCoinType: fromToken.address,
          toCoinType: toToken.address,
          amountInAtomic: atomic,
          feeRate: traderTier.feeRate,
        });
        if (!cancelled) setQuote(q);
      } catch (err: any) {
        if (!cancelled) {
          setQuote(null);
          setQuoteError(err?.message || 'No liquidity route found');
        }
      } finally {
        if (!cancelled) setIsQuoting(false);
      }
    }, 320);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mode, amountIn, fromToken, toToken, traderTier.feeRate]);

  // Load DeepBook v3 Pools & native Spot Referral caps once
  useEffect(() => {
    fetchDeepBookPools().then((list) => {
      setPools(list);
      setActivePool((curr) => list.find((p) => p.poolName === curr.poolName) || list[0]);
    });
    fetchVoltSpotReferrals().then(setSpotReferrals).catch(() => {});
  }, []);

  // Close CLOB dropdown on click outside or mode change
  useEffect(() => {
    setShowPoolDropdown(false);
    setPoolQuoteFilter('all');
  }, [mode]);

  useEffect(() => {
    if (!showPoolDropdown) return;
    const onDown = (e: MouseEvent) => {
      if (poolDropdownRef.current && !poolDropdownRef.current.contains(e.target as Node)) {
        setShowPoolDropdown(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showPoolDropdown]);

  // Load DeepBook Candles (needed in Limit/Margin mode OR when Market chart toggle is on)
  const chartPoolName = useMemo(() => {
    if (mode !== 'market') return activePool.poolName;
    const pair1 = `${fromToken.symbol.toUpperCase()}_${toToken.symbol.toUpperCase()}`;
    const pair2 = `${toToken.symbol.toUpperCase()}_${fromToken.symbol.toUpperCase()}`;
    const found = pools.find((p) => p.poolName === pair1 || p.poolName === pair2);
    return found?.poolName || `${fromToken.symbol.toUpperCase()}_${toToken.symbol.toUpperCase()}`;
  }, [mode, activePool.poolName, fromToken.symbol, toToken.symbol, pools]);

  useEffect(() => {
    if (mode === 'market' && !showMarketChart) return;
    let cancelled = false;
    setCandlesLoading(true);
    setCandles([]);

    const load = async () => {
      try {
        if (mode === 'market') {
          const res = await fetchSwapPairCandles({
            fromSymbol: fromToken.symbol,
            toSymbol: toToken.symbol,
            timeframe,
            pools,
            limit: 150,
          });
          if (!cancelled) {
            setChartMeta({ label: res.label, source: res.source });
            setCandles(res.candles);
          }
        } else {
          const dbTf = timeframe === '30m' ? '15m' : timeframe;
          const dbCandles = await fetchDeepBookCandles(chartPoolName, dbTf, 150).catch(() => []);
          if (!cancelled && dbCandles.length >= 5) {
            setChartMeta({ label: chartPoolName.replace('_', ' / '), source: 'DeepBook v3' });
            setCandles(dbCandles);
          } else if (!cancelled) {
            const fb = await fetchSwapPairCandles({
              fromSymbol: activePool.baseSymbol,
              toSymbol: activePool.quoteSymbol,
              timeframe,
              pools,
              limit: 150,
            });
            if (!cancelled) {
              setChartMeta({
                label: chartPoolName.replace('_', ' / '),
                source: fb.candles.length > 0 ? `${fb.source} (Ref)` : 'DeepBook v3',
              });
              setCandles(fb.candles.length > 0 ? fb.candles : dbCandles);
            }
          }
        }
      } finally {
        if (!cancelled) setCandlesLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [chartPoolName, timeframe, mode, showMarketChart, fromToken.symbol, toToken.symbol, pools, activePool.baseSymbol, activePool.quoteSymbol]);

  // Poll DeepBook L2 Orderbook & Recent Trades in Limit & Margin modes
  useEffect(() => {
    setQtyCurrency('base');
    setLimitQty(String(Math.max(activePool.minSize || 0.01, activePool.baseSymbol === 'SUI' ? 1 : activePool.minSize || 0.01)));
  }, [activePool.poolName, activePool.minSize, activePool.baseSymbol]);

  useEffect(() => {
    if (mode === 'market') return;
    let cancelled = false;
    setOraclePrice(null);
    const loadBook = async () => {
      try {
        const [ob, tr, pythPx] = await Promise.all([
          fetchDeepBookOrderbook(activePool.poolName, 24),
          fetchDeepBookTrades(activePool.poolName, 25),
          fetchPythOraclePrice(activePool.baseSymbol, activePool.quoteSymbol),
        ]);
        if (!cancelled) {
          setOrderbook(ob);
          setTrades(tr);
          setOraclePrice(pythPx);
          setLimitPrice((prev) => (prev === '' && ob.midPrice > 0 ? ob.midPrice.toFixed(4) : prev));
        }
      } catch {
        // ignore transient poll errors
      }
    };
    loadBook();
    const id = setInterval(loadBook, 4500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [mode, activePool.poolName, activePool.baseSymbol, activePool.quoteSymbol]);

  // Spot History (local per-wallet order execution log)
  useEffect(() => {
    if (!account?.address) {
      setSpotHistory([]);
      return;
    }
    try {
      const raw = localStorage.getItem(`volt_spot_hist_${account.address}`);
      setSpotHistory(raw ? JSON.parse(raw) : []);
    } catch {
      setSpotHistory([]);
    }
  }, [account?.address]);

  const recordSpotHistory = useCallback(
    (entry: {
      poolName: string;
      side: 'buy' | 'sell';
      style: string;
      price: number;
      qty: number;
      baseSymbol: string;
      quoteSymbol: string;
      digest: string;
    }) => {
      if (!account?.address) return;
      const item = { ...entry, id: `${entry.digest}_${Date.now()}`, ts: Date.now() };
      setSpotHistory((prev) => {
        const next = [item, ...prev].slice(0, 40);
        try {
          localStorage.setItem(`volt_spot_hist_${account.address}`, JSON.stringify(next));
        } catch {
          // ignore storage quota
        }
        return next;
      });
    },
    [account?.address]
  );

  // Grouped Order Book by selected Tick multiplier
  const groupedOrderbook = useMemo(() => {
    if (bookTickMult <= 1) return orderbook;
    const step = Math.max(1e-8, (activePool.tickSize || 0.0001) * bookTickMult);
    const groupSide = (
      levels: typeof orderbook.asks,
      isAsk: boolean
    ): typeof orderbook.asks => {
      const buckets = new Map<number, number>();
      for (const lv of levels) {
        const bucket = isAsk
          ? Math.ceil(lv.price / step) * step
          : Math.floor(lv.price / step) * step;
        const key = Number(bucket.toFixed(8));
        buckets.set(key, (buckets.get(key) || 0) + lv.size);
      }
      const sorted = Array.from(buckets.entries())
        .map(([price, size]) => ({ price, size, totalSize: 0 }))
        .sort((a, b) => (isAsk ? a.price - b.price : b.price - a.price));
      let running = 0;
      for (const row of sorted) {
        running += row.size;
        row.totalSize = running;
      }
      return isAsk ? sorted.reverse() : sorted;
    };
    return {
      ...orderbook,
      asks: groupSide(orderbook.asks, true),
      bids: groupSide(orderbook.bids, false),
    };
  }, [orderbook, bookTickMult, activePool.tickSize]);


  // Discover & sync DeepBook v3 BalanceManagers + Open Orders
  const refreshDeepBookAccount = useCallback(async () => {
    if (!account?.address || (mode !== 'limit' && swapCardTab !== 'limit')) {
      setManagerIds([]);
      setManagerStates([]);
      return;
    }
    try {
      const ids = await discoverBalanceManagers(account.address);
      setManagerIds(ids);
      if (ids.length > 0) {
        const states = await fetchAllDeepBookManagerStates(account.address, ids, activePool);
        setManagerStates(states);
      } else {
        setManagerStates([]);
      }
    } catch {
      // ignore transient errors
    }
  }, [account?.address, mode, swapCardTab, activePool]);

  const managerState = useMemo(() => {
    if (managerStates.length === 0) return null;
    const preferred =
      limitSide === 'buy'
        ? [...managerStates].sort((a, b) => (b.quoteBalance + b.settledQuote) - (a.quoteBalance + a.settledQuote))[0]
        : [...managerStates].sort((a, b) => (b.baseBalance + b.settledBase) - (a.baseBalance + a.settledBase))[0];
    return preferred || managerStates[0];
  }, [managerStates, limitSide]);

  const vaultSummary = useMemo(() => {
    const freeBase = managerStates.reduce((s, m) => s + m.baseBalance, 0);
    const freeQuote = managerStates.reduce((s, m) => s + m.quoteBalance, 0);
    const settledBase = managerStates.reduce((s, m) => s + m.settledBase, 0);
    const settledQuote = managerStates.reduce((s, m) => s + m.settledQuote, 0);
    const openOrders = managerStates.flatMap((m) => m.openOrders);
    return { freeBase, freeQuote, settledBase, settledQuote, openOrders };
  }, [managerStates]);

  useEffect(() => {
    refreshDeepBookAccount();
  }, [refreshDeepBookAccount]);

  const fromBal = account?.address
    ? readBalanceFromMap(balances, fromToken.address, fromToken.decimals)
    : 0;
  const toBal = account?.address
    ? readBalanceFromMap(balances, toToken.address, toToken.decimals)
    : 0;

  const formattedOut = useMemo(() => {
    if (!quote) return '0.0';
    const num = Number(quote.amountOutAtomic) / Math.pow(10, toToken.decimals);
    return num >= 1 ? num.toFixed(4) : num.toFixed(6);
  }, [quote, toToken.decimals]);

  // Match (fromToken, toToken) to a live DeepBook v3 CLOB pool for Lite Limit Orders
  const matchedLitePool = useMemo(() => {
    const norm = (s: string) => s.toUpperCase().trim().replace(/^W(?=USDC|USDT|BTC|ETH)/, '');
    const f = norm(fromToken.symbol);
    const t = norm(toToken.symbol);
    for (const p of pools) {
      const b = norm(p.baseSymbol);
      const q = norm(p.quoteSymbol);
      if (b === f && q === t) return { pool: p, isBid: false };
      if (q === f && b === t) return { pool: p, isBid: true };
    }
    return null;
  }, [pools, fromToken.symbol, toToken.symbol]);

  // Live market rate for Lite Limit (quote per base, or fallback from aggregator quote)
  const liteMarketPoolPrice = useMemo(() => {
    if (matchedLitePool?.pool.lastPrice && matchedLitePool.pool.lastPrice > 0) {
      return matchedLitePool.pool.lastPrice;
    }
    const inNum = Number(amountIn);
    if (quote && Number.isFinite(inNum) && inNum > 0) {
      const outNum = Number(quote.amountOutAtomic) / Math.pow(10, toToken.decimals);
      if (outNum > 0) {
        return matchedLitePool?.isBid ? inNum / outNum : outNum / inNum;
      }
    }
    return 0;
  }, [matchedLitePool, quote, amountIn, toToken.decimals]);

  // Auto-fill Lite Limit rate when switching pairs or entering Limit tab
  useEffect(() => {
    if (swapCardTab !== 'limit') return;
    if (liteMarketPoolPrice > 0) {
      const disp = liteRateInverted ? 1 / liteMarketPoolPrice : liteMarketPoolPrice;
      setLiteLimitRate(disp >= 1 ? disp.toFixed(4) : disp.toFixed(6));
    }
  }, [fromToken.address, toToken.address, swapCardTab, liteRateInverted, liteMarketPoolPrice > 0]);

  const litePoolPriceNum = useMemo(() => {
    const r = Number(liteLimitRate);
    if (!Number.isFinite(r) || r <= 0) return 0;
    return liteRateInverted ? 1 / r : r;
  }, [liteLimitRate, liteRateInverted]);

  const liteReceiveAmount = useMemo(() => {
    const pay = Number(amountIn);
    if (!Number.isFinite(pay) || pay <= 0 || litePoolPriceNum <= 0) return 0;
    if (matchedLitePool) {
      return matchedLitePool.isBid ? pay / litePoolPriceNum : pay * litePoolPriceNum;
    }
    return liteRateInverted ? pay / litePoolPriceNum : pay * litePoolPriceNum;
  }, [amountIn, litePoolPriceNum, matchedLitePool, liteRateInverted]);

  const executePlaceLiteLimit = async () => {
    if (!account?.address) {
      onNotify('info', 'Wallet Required', 'Connect your Sui wallet to place a Limit Order.');
      return;
    }
    if (!matchedLitePool) {
      onNotify(
        'warning',
        'Pair Not on DeepBook CLOB',
        `${fromToken.symbol}/${toToken.symbol} is not listed on DeepBook v3 CLOB. Switch to Market (7 DEXs) for instant swap.`
      );
      return;
    }
    const payAmt = Number(amountIn);
    if (!Number.isFinite(payAmt) || payAmt <= 0 || litePoolPriceNum <= 0) {
      onNotify('warning', 'Invalid Limit Order', 'Enter a valid amount and target rate.');
      return;
    }
    const { pool, isBid } = matchedLitePool;
    const baseQty = isBid ? payAmt / litePoolPriceNum : payAmt;
    if (baseQty < pool.minSize) {
      onNotify(
        'warning',
        'Order Below Minimum Size',
        `Minimum order size for ${pool.baseSymbol}/${pool.quoteSymbol} is ${pool.minSize} ${pool.baseSymbol}.`
      );
      return;
    }

    setIsPlacingLiteLimit(true);
    try {
      const suiPrice = pool.baseSymbol === 'SUI' ? litePoolPriceNum : 0.8;
      const notionalUsd =
        pool.quoteSymbol === 'USDC'
          ? litePoolPriceNum * baseQty
          : pool.baseSymbol === 'SUI'
            ? baseQty * suiPrice
            : litePoolPriceNum * baseQty * suiPrice;
      const suiEquivMist = BigInt(Math.max(0, Math.round((notionalUsd / Math.max(0.2, suiPrice)) * 1e9)));
      const feeMist = calcFeeUnits(suiEquivMist, traderTier.feeRate);

      const matchedMgr = managerStates.find(
        (m) => (isBid ? m.quoteBalance : m.baseBalance) > 0
      ) || managerStates[0];

      const existingDep = isBid
        ? matchedMgr?.quoteBalance ?? 0
        : matchedMgr?.baseBalance ?? 0;

      const expireTimestampMs = liteExpiryMs > 0 ? Date.now() + liteExpiryMs : undefined;

      const tx = buildPlaceDeepBookLimitOrderTx({
        owner: account.address,
        managerId: matchedMgr?.managerId || managerIds[0] || null,
        pool,
        price: litePoolPriceNum,
        quantity: baseQty,
        isBid,
        postOnly: false,
        existingManagerDepositCoin: existingDep,
        payWithDeep: (matchedMgr?.deepBalance ?? 0) >= 0.5,
        feeMist,
        refSharePct: refTier.revSharePct,
        spotReferralId: spotReferrals[pool.poolName]?.referralId || null,
        existingManagerReferralId: matchedMgr?.referralId || null,
        expireTimestampMs,
      });

      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) {
        onNotify('error', 'Limit Order Rejected', sim.errorMessage || 'Preflight simulation aborted.');
        return;
      }

      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);

      const nextVol = addWalletVolumeUsd(account.address, notionalUsd);
      onVolumeUpdated?.(nextVol);

      onNotify(
        'success',
        'Limit Order Placed',
        `${isBid ? 'BUY' : 'SELL'} ${baseQty.toFixed(3)} ${pool.baseSymbol} @ ${litePoolPriceNum.toFixed(4)} ${pool.quoteSymbol}`,
        'Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
      onTradeRecorded({
        fromToken: fromToken.symbol,
        toToken: toToken.symbol,
        fromAmount: payAmt.toFixed(4),
        toAmount: liteReceiveAmount.toFixed(4),
        volumeUsd: notionalUsd,
        digest,
        orderType: 'LIMIT',
      });
      await Promise.all([refreshDeepBookAccount(), refreshBalances()]);
    } catch (err: any) {
      onNotify('error', 'Limit Order Failed', err?.message || 'Failed to place limit order.');
    } finally {
      setIsPlacingLiteLimit(false);
    }
  };

  const executeMarketSwap = async () => {
    if (!account?.address) {
      onNotify('info', 'Wallet Required', 'Connect your Sui wallet in the top bar first.');
      return;
    }
    if (!quote) return;
    const val = Number(amountIn);
    const atomic = BigInt(Math.floor(val * Math.pow(10, fromToken.decimals)));
    if (atomic <= 0n) return;

    setIsSwapping(true);
    try {
      let tx = await buildBestSwapTx({
        sender: account.address,
        fromCoinType: fromToken.address,
        amountInAtomic: atomic,
        quote,
        slippage: slippagePct / 100,
        refSharePct: refTier.revSharePct,
      });

      let sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) {
        const fallbackQuote: SmartSwapQuote | null =
          quote.provider === 'Cetus' && quote.aftermathRoute
            ? { ...quote, provider: 'Aftermath' }
            : quote.provider === 'Aftermath' && quote.cetusQuote
              ? { ...quote, provider: 'Cetus' }
              : null;
        if (fallbackQuote) {
          tx = await buildBestSwapTx({
            sender: account.address,
            fromCoinType: fromToken.address,
            amountInAtomic: atomic,
            quote: fallbackQuote,
            slippage: slippagePct / 100,
            refSharePct: refTier.revSharePct,
          });
          sim = await simulateTxBeforeWallet(tx, { sender: account.address });
        }
      }
      if (!sim.ok) {
        onNotify('error', 'Preflight Check Failed', sim.errorMessage || 'Transaction aborted.');
        return;
      }

      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);

      const estUsd =
        fromToken.symbol === 'USDC'
          ? val
          : toToken.symbol === 'USDC'
            ? Number(formattedOut)
            : val * (fromToken.priceUsd || 0.8);

      const nextVol = addWalletVolumeUsd(account.address, estUsd);
      onVolumeUpdated?.(nextVol);

      fetch('/api/record-swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          digest,
          address: account.address,
          fromToken: fromToken.symbol,
          toToken: toToken.symbol,
          fromAmount: amountIn,
          toAmount: formattedOut,
          volumeUsd: estUsd,
          feeRate: traderTier.feeRate,
          tierName: traderTier.name,
          tierEmoji: traderTier.badgeEmoji,
          swapMode: 'MARKET',
          referrer: activeReferrer,
        }),
      }).catch(() => {});

      onNotify(
        'success',
        'Swap Executed',
        `${amountIn} ${fromToken.symbol} → ${formattedOut} ${toToken.symbol}`,
        'View on Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
      onTradeRecorded({
        fromToken: fromToken.symbol,
        toToken: toToken.symbol,
        fromAmount: amountIn,
        toAmount: formattedOut,
        volumeUsd: estUsd,
        digest,
        orderType: 'SWAP',
      });
      refreshBalances();
    } catch (err: any) {
      onNotify('error', 'Swap Rejected', err?.message || 'Wallet rejected transaction.');
    } finally {
      setIsSwapping(false);
    }
  };

  const executePlaceLimit = async () => {
    if (!account?.address) {
      onNotify('info', 'Wallet Required', 'Connect your Sui wallet to place DeepBook v3 orders.');
      return;
    }
    const p = Number(limitPrice);
    const rawQ = Number(limitQty);
    const q = qtyCurrency === 'quote' && p > 0 ? rawQ / p : rawQ;
    if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(q) || q < activePool.minSize) {
      onNotify(
        'warning',
        'Invalid Order Params',
        `Enter valid price and quantity ≥ ${activePool.minSize} ${activePool.baseSymbol}.`
      );
      return;
    }

    setIsPlacingLimit(true);
    try {
      const suiPrice = orderbook.midPrice > 0 && activePool.baseSymbol === 'SUI' ? orderbook.midPrice : 0.82;
      const notionalUsd =
        activePool.quoteSymbol === 'USDC'
          ? p * q
          : activePool.baseSymbol === 'SUI'
            ? q * suiPrice
            : p * q * suiPrice;
      const suiEquivMist = BigInt(Math.max(0, Math.round((notionalUsd / Math.max(0.2, suiPrice)) * 1e9)));
      const feeMist = calcFeeUnits(suiEquivMist, traderTier.feeRate);

      const existingDep =
        limitSide === 'buy'
          ? managerState?.quoteBalance ?? 0
          : managerState?.baseBalance ?? 0;

      const tx = buildPlaceDeepBookLimitOrderTx({
        owner: account.address,
        managerId: managerState?.managerId || managerIds[0] || null,
        pool: activePool,
        price: p,
        quantity: q,
        isBid: limitSide === 'buy',
        postOnly: spotTif === 'POST_ONLY' || postOnly,
        orderType: spotTif,
        existingManagerDepositCoin: existingDep,
        payWithDeep: payFeesWithDeep,
        feeMist,
        refSharePct: refTier.revSharePct,
        spotReferralId: spotReferrals[activePool.poolName]?.referralId || null,
        existingManagerReferralId: managerState?.referralId || null,
      });

      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) {
        onNotify('error', 'DeepBook Order Rejected', sim.errorMessage || 'Simulation aborted.');
        return;
      }

      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);

      const nextVol = addWalletVolumeUsd(account.address, notionalUsd);
      onVolumeUpdated?.(nextVol);

      fetch('/api/record-swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          digest,
          address: account.address,
          fromToken: limitSide === 'buy' ? activePool.quoteSymbol : activePool.baseSymbol,
          toToken: limitSide === 'buy' ? activePool.baseSymbol : activePool.quoteSymbol,
          fromAmount: limitSide === 'buy' ? (p * q).toFixed(4) : q,
          toAmount: limitSide === 'buy' ? q : (p * q).toFixed(4),
          volumeUsd: notionalUsd,
          feeRate: traderTier.feeRate,
          tierName: traderTier.name,
          swapMode: 'DEEPBOOK_LIMIT',
          referrer: activeReferrer,
        }),
      }).catch(() => {});

      onNotify(
        'success',
        'DeepBook v3 Limit Placed',
        `${limitSide === 'buy' ? 'BUY' : 'SELL'} ${q} ${activePool.baseSymbol} @ ${p} ${activePool.quoteSymbol}`,
        'Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
      onTradeRecorded({
        fromToken: activePool.baseSymbol,
        toToken: activePool.quoteSymbol,
        fromAmount: String(q),
        toAmount: (p * q).toFixed(4),
        volumeUsd: notionalUsd,
        digest,
        orderType: 'LIMIT',
      });
      recordSpotHistory({
        poolName: activePool.poolName,
        side: limitSide,
        style: `LIMIT (${spotTif})`,
        price: p,
        qty: q,
        baseSymbol: activePool.baseSymbol,
        quoteSymbol: activePool.quoteSymbol,
        digest,
      });
      await Promise.all([refreshDeepBookAccount(), refreshBalances()]);
    } catch (err: any) {
      onNotify('error', 'Order Failed', err?.message || 'Failed to place DeepBook v3 order.');
    } finally {
      setIsPlacingLimit(false);
    }
  };

  const handleCancelOrder = async (ord: DeepBookOpenOrder) => {
    const targetManagerId = ord.managerId || managerState?.managerId || managerIds[0];
    if (!account?.address || !targetManagerId) return;
    setIsVaultBusy(true);
    try {
      const tx = buildCancelDeepBookOrderTx({
        owner: account.address,
        managerId: targetManagerId,
        poolName: activePool.poolName,
        orderId: ord.orderId,
        baseSymbol: activePool.baseSymbol,
        quoteSymbol: activePool.quoteSymbol,
        withdrawAfterCancel: true,
      });
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      onNotify(
        'success',
        'Order Cancelled & Settled',
        'Cancelled DeepBook order and returned funds to your wallet.',
        'Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
      await Promise.all([refreshDeepBookAccount(), refreshBalances()]);
    } catch (err: any) {
      onNotify('error', 'Cancel Failed', err?.message || 'Could not cancel order.');
    } finally {
      setIsVaultBusy(false);
    }
  };

  const executePlaceSpotMarket = async () => {
    if (!account?.address) {
      onNotify('info', 'Wallet Required', 'Connect your Sui wallet to trade DeepBook v3 Spot CLOB.');
      return;
    }
    const rawQ = Number(limitQty);
    const estPrice =
      limitSide === 'buy'
        ? orderbook.asks[0]?.price || orderbook.midPrice
        : orderbook.bids[0]?.price || orderbook.midPrice;
    const q = qtyCurrency === 'quote' && estPrice > 0 ? rawQ / estPrice : rawQ;

    if (!Number.isFinite(q) || q < activePool.minSize || !Number.isFinite(estPrice) || estPrice <= 0) {
      onNotify(
        'warning',
        'Invalid Spot Market Order',
        `Enter quantity >= ${activePool.minSize} ${activePool.baseSymbol} with active orderbook liquidity.`
      );
      return;
    }

    setIsPlacingLimit(true);
    try {
      const suiPrice = orderbook.midPrice > 0 && activePool.baseSymbol === 'SUI' ? orderbook.midPrice : 0.82;
      const notionalUsd =
        activePool.quoteSymbol === 'USDC'
          ? estPrice * q
          : activePool.baseSymbol === 'SUI'
            ? q * suiPrice
            : estPrice * q * suiPrice;
      const feeBps = Math.round(traderTier.feeRate * 10_000);

      const tx = buildPlaceDeepBookMarketOrderTx({
        owner: account.address,
        pool: activePool,
        managerId: managerState?.managerId || managerIds[0],
        managerBaseBalance: managerState?.baseBalance ?? 0,
        managerQuoteBalance: managerState?.quoteBalance ?? 0,
        quantity: q,
        estPrice,
        slippagePct: spotMarketSlippage,
        isBid: limitSide === 'buy',
        payWithDeep: payFeesWithDeep,
        settleToWallet: true,
        feeBps,
        spotReferralId: spotReferrals[activePool.poolName]?.referralId || null,
        existingManagerReferralId: managerState?.referralId || null,
      });

      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) {
        onNotify(
          'error',
          'Spot CLOB Preflight Failed',
          sim.errorMessage || sim.rawError || 'Transaction would fail on-chain (check balance or book depth).'
        );
        setIsPlacingLimit(false);
        return;
      }

      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      const nextVol = addWalletVolumeUsd(account.address, notionalUsd);
      onVolumeUpdated?.(nextVol);

      onNotify(
        'success',
        `DeepBook Spot ${limitSide === 'buy' ? 'Buy' : 'Sell'} Executed`,
        `Filled ~${q} ${activePool.baseSymbol} at ~$${estPrice.toFixed(4)} and settled straight to wallet.`,
        'Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
      onTradeRecorded({
        fromToken: limitSide === 'buy' ? activePool.quoteSymbol : activePool.baseSymbol,
        toToken: limitSide === 'buy' ? activePool.baseSymbol : activePool.quoteSymbol,
        fromAmount: limitSide === 'buy' ? (q * estPrice).toFixed(4) : q.toFixed(4),
        toAmount: limitSide === 'buy' ? q.toFixed(4) : (q * estPrice).toFixed(4),
        volumeUsd: notionalUsd,
        digest,
        orderType: 'SWAP',
      });
      recordSpotHistory({
        poolName: activePool.poolName,
        side: limitSide,
        style: 'MARKET',
        price: estPrice,
        qty: q,
        baseSymbol: activePool.baseSymbol,
        quoteSymbol: activePool.quoteSymbol,
        digest,
      });
      await Promise.all([refreshDeepBookAccount(), refreshBalances()]);
    } catch (err: any) {
      onNotify('error', 'Spot Order Rejected', err?.message || 'Transaction rejected by wallet.');
    } finally {
      setIsPlacingLimit(false);
    }
  };

  const handleDepositManager = async () => {
    const targetManagerId = managerState?.managerId || managerIds[0];
    if (!account?.address) return;
    const amt = Number(depositAmt);
    if (!Number.isFinite(amt) || amt <= 0) return;
    const isBaseSide = depositCoinSide === 'base';
    const coinKey = isBaseSide ? activePool.baseSymbol : activePool.quoteSymbol;
    setIsVaultBusy(true);
    try {
      const tx = targetManagerId
        ? buildDepositManagerTx({
            owner: account.address,
            managerId: targetManagerId,
            coinKey,
            amount: amt,
          })
        : buildCreateAndDepositManagerTx({
            owner: account.address,
            coinType: isBaseSide ? activePool.baseCoinId : activePool.quoteCoinId,
            decimals: isBaseSide ? activePool.baseDecimals : activePool.quoteDecimals,
            amount: amt,
            spotReferralId: spotReferrals[activePool.poolName]?.referralId || null,
          });
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      setDepositAmt('');
      onNotify(
        'success',
        'Deposited to BalanceManager',
        `+${amt} ${coinKey} available for instant limit orders.`,
        'Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
      await Promise.all([refreshDeepBookAccount(), refreshBalances()]);
    } catch (err: any) {
      onNotify('error', 'Deposit Failed', err?.message || 'Could not deposit to BalanceManager.');
    } finally {
      setIsVaultBusy(false);
    }
  };

  const handleWithdrawManagerAll = async (cancelOpenOrders = false) => {
    if (!account?.address || managerStates.length === 0) return;
    const targets = managerStates
      .filter(
        (m) =>
          m.baseBalance > 0 ||
          m.quoteBalance > 0 ||
          m.settledBase > 0 ||
          m.settledQuote > 0 ||
          (cancelOpenOrders && m.openOrders.length > 0)
      )
      .map((m) => ({
        managerId: m.managerId,
        openOrderIds: cancelOpenOrders ? m.openOrders.map((o) => o.orderId) : [],
      }));

    const finalTargets =
      targets.length > 0
        ? targets
        : [{ managerId: managerStates[0].managerId, openOrderIds: [] }];

    setIsVaultBusy(true);
    try {
      const tx = buildWithdrawAllManagersAndCancelTx({
        owner: account.address,
        pool: activePool,
        managers: finalTargets,
      });
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      onNotify(
        'success',
        cancelOpenOrders ? 'Orders Cancelled & Funds Withdrawn' : 'Withdrawn to Wallet',
        `All ${activePool.baseSymbol}/${activePool.quoteSymbol} funds across ${finalTargets.length} DeepBook vault(s) returned to your wallet.`,
        'Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
      await Promise.all([refreshDeepBookAccount(), refreshBalances()]);
    } catch (err: any) {
      onNotify('error', 'Withdraw Failed', err?.message || 'Nothing to withdraw or tx aborted.');
    } finally {
      setIsVaultBusy(false);
    }
  };

  const filteredTokens = useMemo(() => {
    const q = tokenQuery.trim().toLowerCase();
    if (!q) return SUI_TOKENS;
    return SUI_TOKENS.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) ||
        t.name.toLowerCase().includes(q) ||
        safeNormalizeCoinType(t.address).toLowerCase().includes(q)
    );
  }, [tokenQuery]);

  const limitWalletBaseBal = account?.address
    ? readBalanceFromMap(balances, activePool.baseCoinId, activePool.baseDecimals)
    : 0;
  const limitWalletQuoteBal = account?.address
    ? readBalanceFromMap(balances, activePool.quoteCoinId, activePool.quoteDecimals)
    : 0;

  const activeClobPoolList = pools;

  const filteredClobPools = useMemo(() => {
    const q = poolSearch.trim().toLowerCase();
    const bluechips = new Set(['SUI', 'XBTC', 'HBTC', 'LZWBTC', 'WBTC', 'BWETH', 'BETH', 'DEEP', 'WAL', 'CETUS']);
    return activeClobPoolList.filter((p) => {
      if (poolQuoteFilter === 'usdc' && !['USDC', 'WUSDC', 'USDSUI', 'SUIUSDE', 'AUSD'].includes(p.quoteSymbol)) {
        return false;
      }
      if (poolQuoteFilter === 'sui' && p.quoteSymbol !== 'SUI') return false;
      if (poolQuoteFilter === 'bluechip' && !bluechips.has(p.baseSymbol)) return false;
      if (!q) return true;
      return (
        p.poolName.toLowerCase().includes(q) ||
        `${p.baseSymbol}/${p.quoteSymbol}`.toLowerCase().includes(q) ||
        p.baseSymbol.toLowerCase().includes(q) ||
        p.quoteSymbol.toLowerCase().includes(q)
      );
    });
  }, [activeClobPoolList, poolQuoteFilter, poolSearch]);

  return (
    <div className="w-full overflow-x-hidden">
      {/* Sub-navigation bar */}
      {/* MODE 1: INSTITUTIONAL INSTANT SWAP STAGE */}
      {mode === 'market' && (
        <div className="max-w-[1280px] mx-auto px-3 sm:px-6 py-5 sm:py-7 animate-panel-in">
          <div
            className={`grid gap-5 items-start ${
              showMarketChart ? 'grid-cols-1 lg:grid-cols-12' : 'grid-cols-1'
            }`}
          >
            {showMarketChart && (
              <div className="lg:col-span-7 xl:col-span-8 bg-[#000000] border border-[#2E384C] rounded-xl overflow-hidden">
                <ProCandleChart
                  symbolLabel={chartMeta.label}
                  sourceLabel={chartMeta.source}
                  candles={candles}
                  timeframe={timeframe}
                  onTimeframeChange={setTimeframe}
                  isLoading={candlesLoading}
                  heightClass="h-[420px] lg:h-[500px]"
                />
              </div>
            )}

            <div
              className={
                showMarketChart
                  ? 'lg:col-span-5 xl:col-span-4 w-full space-y-3'
                  : 'w-full max-w-[470px] mx-auto space-y-3'
              }
            >
              {/* Compact Quick-Pairs & Utility Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[
                    { from: 'SUI', to: 'USDC' },
                    { from: 'DEEP', to: 'SUI' },
                    { from: 'WAL', to: 'USDC' },
                    { from: 'CETUS', to: 'SUI' },
                  ].map((pair) => {
                    const isCurrent =
                      fromToken.symbol === pair.from && toToken.symbol === pair.to;
                    return (
                      <button
                        key={`${pair.from}-${pair.to}`}
                        type="button"
                        onClick={() => {
                          const f = SUI_TOKENS.find((t) => t.symbol === pair.from);
                          const t = SUI_TOKENS.find((t) => t.symbol === pair.to);
                          if (f && t) {
                            setFromToken(f);
                            setToToken(t);
                          }
                        }}
                        className={`px-2 py-1 rounded-md text-[11px] font-mono font-semibold border transition-all ${
                          isCurrent
                            ? 'bg-[#2B7FFF]/15 border-[#2B7FFF]/50 text-[#60A5FA]'
                            : 'bg-[#080B10] border-[#263246] text-slate-400 hover:text-white hover:border-[#3A4863]'
                        }`}
                      >
                        {pair.from}/{pair.to}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowAiCopilot(true)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#080B10] border border-[#2D374B] text-[11px] font-semibold text-slate-200 hover:border-[#2B7FFF]/60 hover:text-white transition-colors"
                    title="Open AI Trading Copilot"
                  >
                    <Bot className="w-3.5 h-3.5 text-[#60A5FA]" />
                    <span>AI</span>
                  </button>
                  <span
                    className="px-2 py-1 rounded-md bg-[#080B10] border border-[#2D374B] text-[11px] font-mono text-slate-300"
                    title={`Trader Tier: ${traderTier.name}`}
                  >
                    {traderTier.badgeEmoji} <span className="text-[#60A5FA] font-bold">{(traderTier.feeRate * 100).toFixed(2)}%</span>
                  </span>
                  {activeReferrer && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#08D189]/10 border border-[#08D189]/35 text-[10px] font-mono text-[#08D189] font-semibold">
                      <CheckCircle2 className="w-3 h-3" />
                      Ref
                    </span>
                  )}
                </div>
              </div>
              <div className="panel-carbon rounded-xl p-4 sm:p-5 space-y-3 border border-[#2E384C]">
                {/* Top Controls */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-white tracking-tight">Best-Price Swap</span>
                    <span className="text-[11px] font-mono text-[#08D189] px-2 py-0.5 rounded bg-[#08D189]/10 border border-[#08D189]/30 font-semibold">
                      Best Route
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowMarketChart((v) => !v)}
                      className={`p-2 rounded-lg border text-xs transition-all ${
                        showMarketChart
                          ? 'bg-[#2B7FFF]/20 border-[#2B7FFF]/50 text-[#60A5FA]'
                          : 'bg-[#0C0E13] border-[#2D374B] text-slate-400 hover:text-white'
                      }`}
                      title="Toggle live price chart"
                    >
                      <BarChart2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowSettings((v) => !v)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0C0E13] border border-[#2D374B] text-xs font-mono text-slate-300 hover:text-white hover:border-[#2B7FFF]/40 transition-colors"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span>{slippagePct}%</span>
                    </button>
                  </div>
                </div>

                {/* Sub-toggle: Market (7 DEXs) | Lite Limit | Pro Terminal */}
                <div className="flex items-center gap-1.5">
                  <div className="flex-1 grid grid-cols-2 p-1 rounded-lg bg-[#06080C] border border-[#263246] gap-1">
                    <button
                      type="button"
                      onClick={() => setSwapCardTab('market')}
                      className={`py-1.5 rounded-md text-xs font-semibold font-mono flex items-center justify-center gap-1 transition-all ${
                        swapCardTab === 'market'
                          ? 'bg-[#2B7FFF] text-white shadow-sm'
                          : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                      }`}
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>Market (7 DEXs)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSwapCardTab('limit')}
                      className={`py-1.5 rounded-md text-xs font-semibold font-mono flex items-center justify-center gap-1 transition-all ${
                        swapCardTab === 'limit'
                          ? 'bg-[#2B7FFF] text-white shadow-sm'
                          : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                      }`}
                    >
                      <span>Limit</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMode('limit')}
                    className="px-2.5 py-2 rounded-lg bg-[#0C0E13] hover:bg-[#141923] border border-[#2D374B] hover:border-[#2B7FFF]/50 text-xs font-mono font-semibold text-[#60A5FA] transition-colors shrink-0"
                    title="Open Full Pro Orderbook & Chart Terminal"
                  >
                    Pro ↗
                  </button>
                </div>

                {showSettings && (
                  <div className="bg-[#0C0E13] border border-[#2D374B] rounded-lg p-3 flex items-center justify-between gap-2 animate-panel-in">
                    <span className="text-xs font-medium text-slate-300">Max Slippage</span>
                    <div className="flex items-center gap-1.5">
                      {[0.1, 0.5, 1.0].map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setSlippagePct(v)}
                          className={`px-2 py-1 rounded text-xs font-mono ${
                            slippagePct === v
                              ? 'bg-[#2B7FFF]/20 text-[#60A5FA] border border-[#2B7FFF]/45 font-semibold'
                              : 'bg-[#12151C] text-slate-300 hover:text-white border border-[#2D374B]'
                          }`}
                        >
                          {v}%
                        </button>
                      ))}
                      <div className="flex items-center bg-[#000000] rounded px-2 py-1 border border-[#2D374B] focus-within:border-[#2B7FFF]/60">
                        <input
                          type="number"
                          min="0.05"
                          max="25"
                          step="0.1"
                          value={slippagePct}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            if (Number.isFinite(v) && v >= 0.05 && v <= 25) setSlippagePct(v);
                          }}
                          className="w-11 bg-transparent text-right text-xs font-mono text-white outline-none"
                        />
                        <span className="text-xs font-mono text-slate-400 ml-0.5">%</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* You Pay */}
                <div className="bg-[#0C0E13] border border-[#2D374B] focus-within:border-[#2B7FFF]/60 rounded-xl p-3.5 space-y-2 transition-colors">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="font-medium">You Pay</span>
                    <div className="flex items-center gap-1.5 font-mono tabular-nums text-xs">
                      <Wallet className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-slate-300">{fromBal.toFixed(fromToken.decimals > 6 ? 4 : 2)}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setAmountIn((fromBal * 0.5).toFixed(fromToken.decimals > 6 ? 4 : 2))
                        }
                        className="px-2 py-0.5 rounded bg-white/[0.06] hover:bg-white/[0.12] text-[11px] text-white font-semibold transition-colors"
                      >
                        HALF
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const maxAmt = fromToken.symbol === 'SUI' ? Math.max(0, fromBal - 0.05) : fromBal;
                          setAmountIn(maxAmt.toFixed(fromToken.decimals > 6 ? 4 : 2));
                        }}
                        className="px-2 py-0.5 rounded bg-[#2B7FFF]/15 hover:bg-[#2B7FFF]/25 text-[11px] text-[#60A5FA] font-bold transition-colors"
                      >
                        MAX
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={amountIn}
                      onChange={(e) => setAmountIn(e.target.value)}
                      placeholder="0.0"
                      className="w-full bg-transparent text-2xl sm:text-[26px] font-mono tabular-nums font-bold text-white outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setTokenQuery('');
                        setTokenPickerFor('from');
                      }}
                      className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#121620] hover:bg-[#191E2B] border border-[#38445B] text-sm font-bold text-white transition-colors"
                    >
                      <img
                        src={fromToken.logo}
                        alt={fromToken.symbol}
                        className="w-5 h-5 rounded-full"
                      />
                      <span>{fromToken.symbol}</span>
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    </button>
                  </div>
                </div>

                {/* Flip */}
                <div className="flex justify-center -my-1.5 relative z-10">
                  <button
                    type="button"
                    onClick={() => {
                      setFromToken(toToken);
                      setToToken(fromToken);
                    }}
                    className="p-2 rounded-lg bg-[#06070A] border border-[#222734] text-slate-300 hover:text-[#60A5FA] hover:border-[#2B7FFF] transition-all hover:rotate-180 duration-300"
                    title="Flip pair"
                  >
                    <ArrowDownUp className="w-4 h-4" />
                  </button>
                </div>

                {/* You Receive */}
                <div className="bg-[#0C0E13] border border-[#2D374B] rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="font-medium">You Receive</span>
                    <div className="flex items-center gap-1.5 font-mono tabular-nums text-xs">
                      <Wallet className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-slate-300">{toBal.toFixed(toToken.decimals > 6 ? 4 : 2)}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-2xl sm:text-[26px] font-mono tabular-nums font-bold text-white truncate">
                      {swapCardTab === 'limit' ? (
                        liteReceiveAmount > 0 ? (
                          liteReceiveAmount >= 1 ? liteReceiveAmount.toFixed(4) : liteReceiveAmount.toFixed(6)
                        ) : (
                          '0.0'
                        )
                      ) : isQuoting ? (
                        <span className="text-slate-400 text-base">Quoting...</span>
                      ) : (
                        formattedOut
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setTokenQuery('');
                        setTokenPickerFor('to');
                      }}
                      className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#121620] hover:bg-[#191E2B] border border-[#38445B] text-sm font-bold text-white transition-colors"
                    >
                      <img src={toToken.logo} alt={toToken.symbol} className="w-5 h-5 rounded-full" />
                      <span>{toToken.symbol}</span>
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    </button>
                  </div>
                </div>

                {swapCardTab === 'market' ? (
                  <>
                    {/* Route & Fee Details */}
                <div className="bg-[#000000] border border-[#2D374B] rounded-lg p-3 space-y-2.5 text-xs font-mono">
                  {/* Optimal Execution Route Visualizer */}
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-slate-400 font-mono flex items-center gap-1">
                        <Layers className="w-3.5 h-3.5 text-[#2B7FFF]" />
                        <span>Execution Route</span>
                      </span>
                      {quote ? (
                        <div className="flex items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded bg-[#2B7FFF]/15 text-[#60A5FA] border border-[#2B7FFF]/35 text-[11px] font-bold">
                            {quote.provider === 'Cetus' ? 'Cetus Engine (incl. Bluefin/7K)' : 'Aftermath Engine'}
                          </span>
                          {quote.savingsPct > 0.001 && (
                            <span className="text-[11px] font-bold text-[#08D189] bg-[#08D189]/15 border border-[#08D189]/30 px-1.5 py-0.5 rounded">
                              +{quote.savingsPct.toFixed(2)}%
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </div>

                    {quote && quote.dexHops.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap p-2 rounded-lg bg-[#06080C] border border-[#242D3D]">
                        <span className="px-1.5 py-0.5 rounded bg-[#10141E] text-white font-bold text-[11px]">
                          {fromToken.symbol}
                        </span>
                        {quote.dexHops.map((hop, idx) => (
                          <React.Fragment key={idx}>
                            <ArrowRight className="w-3 h-3 text-[#2B7FFF] shrink-0" />
                            <span className="px-1.5 py-0.5 rounded bg-[#2B7FFF]/15 border border-[#2B7FFF]/30 text-[#60A5FA] text-[10px] font-bold truncate max-w-[140px]">
                              {hop}
                            </span>
                          </React.Fragment>
                        ))}
                        <ArrowRight className="w-3 h-3 text-[#08D189] shrink-0" />
                        <span className="px-1.5 py-0.5 rounded bg-[#08D189]/15 border border-[#08D189]/30 text-[#08D189] font-bold text-[11px]">
                          {toToken.symbol}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Multi-Aggregator Parallel Race */}
                  {quote && quote.alternatives.some((a) => a.amountOutAtomic > 0n) && (
                    <div className="pt-1 border-t border-[#1F2735]">
                      <div className="text-[11px] text-slate-400 mb-1.5 flex items-center justify-between">
                        <span>Quotes Race (Live Comparison)</span>
                        <span className="text-[10px] text-slate-500">Auto-routed to best</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        {quote.alternatives.map((alt) => {
                          const isWinner = alt.provider === quote.provider;
                          const outVal =
                            alt.amountOutAtomic > 0n
                              ? Number(alt.amountOutAtomic) / Math.pow(10, toToken.decimals)
                              : 0;
                          return (
                            <div
                              key={alt.provider}
                              className={`p-2 rounded-lg border transition-all ${
                                isWinner
                                  ? 'bg-[#2B7FFF]/10 border-[#2B7FFF]/50 text-white'
                                  : 'bg-[#06080C] border-[#222A38] text-slate-400'
                              }`}
                            >
                              <div className="flex items-center justify-between text-[11px] mb-0.5">
                                <span className={isWinner ? 'text-[#60A5FA] font-bold' : 'text-slate-400'}>
                                  {alt.provider === 'Cetus' ? 'Cetus + Bluefin/7K' : 'Aftermath Router'}
                                </span>
                                {isWinner && (
                                  <span className="text-[9px] font-bold text-[#08D189] bg-[#08D189]/15 px-1 py-0.2 rounded uppercase">
                                    Winner
                                  </span>
                                )}
                              </div>
                              <div className="text-xs font-bold font-mono text-white">
                                {outVal > 0 ? (outVal >= 1 ? outVal.toFixed(4) : outVal.toFixed(6)) : 'No Route'}{' '}
                                <span className="text-[10px] text-slate-400 font-normal">{toToken.symbol}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Fee & Slippage info */}
                  <div className="pt-1 border-t border-[#1F2735] space-y-1">
                    <div className="flex justify-between text-slate-400">
                      <span>Volt Tier Fee ({traderTier.name})</span>
                      <span className="text-[#60A5FA] font-semibold tabular-nums">
                        {(traderTier.feeRate * 100).toFixed(2)}%
                        {activeReferrer ? ` (${Math.round(refTier.revSharePct * 100)}% → Ref)` : ''}
                      </span>
                    </div>
                    {quote && (
                      <>
                        <div className="flex justify-between text-slate-400">
                          <span>Minimum Received ({slippagePct}% slip)</span>
                          <span className="text-slate-200 font-semibold tabular-nums">
                            {(() => {
                              const outVal = Number(quote.amountOutAtomic) / Math.pow(10, toToken.decimals);
                              const minOut = outVal * Math.max(0, 1 - slippagePct / 100);
                              return `${minOut >= 1 ? minOut.toFixed(4) : minOut.toFixed(6)} ${toToken.symbol}`;
                            })()}
                          </span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>Price Impact</span>
                          <span
                            className={`tabular-nums font-semibold ${
                              quote.priceImpactPct > 2 ? 'text-amber-400' : 'text-[#08D189]'
                            }`}
                          >
                            {quote.priceImpactPct.toFixed(2)}%
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {quoteError && (
                  <div className="text-xs text-[#F0525E] bg-[#F0525E]/12 border border-[#F0525E]/35 rounded-lg px-3 py-2">
                    {quoteError}
                  </div>
                )}

                {(() => {
                  const payNum = Number(amountIn) || 0;
                  const isSamePair = fromToken.address === toToken.address;
                  const isInsufficientBal = Boolean(account?.address) && payNum > 0 && payNum > fromBal * 1.0001;
                  const swapDisabled = isSwapping || isQuoting || !quote || isSamePair || isInsufficientBal;
                  const swapLabel = !account
                    ? 'Connect Wallet to Swap'
                    : isSamePair
                      ? 'Select different tokens'
                      : isInsufficientBal
                        ? `Insufficient ${fromToken.symbol} Balance`
                        : isSwapping
                          ? 'Confirm in Wallet...'
                          : `Swap ${fromToken.symbol} for ${toToken.symbol}`;
                  return (
                    <button
                      type="button"
                      disabled={swapDisabled}
                      onClick={executeMarketSwap}
                      className="w-full py-3.5 rounded-lg btn-deepbook disabled:bg-[#121620] disabled:text-slate-500 disabled:shadow-none font-bold text-sm tracking-wide transition-all flex items-center justify-center gap-2"
                    >
                      {isSwapping && <Loader2 className="w-4 h-4 animate-spin" />}
                      <span>{swapLabel}</span>
                    </button>
                  );
                })()}
                  </>
                ) : (
                  <div className="space-y-3 animate-panel-in">
                    {/* Cetus/Jupiter Style 2-Column Rate + Expiry Row */}
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                      <div className="sm:col-span-7 bg-[#0C0E13] border border-[#2D374B] focus-within:border-[#2B7FFF]/60 rounded-xl p-3 space-y-1.5 transition-colors">
                        <div className="flex items-center justify-between text-[11px] text-slate-400">
                          <span className="font-medium truncate">
                            {matchedLitePool
                              ? `${matchedLitePool.isBid ? 'Buy' : 'Sell'} ${matchedLitePool.pool.baseSymbol} at rate`
                              : `Rate`}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (liteMarketPoolPrice > 0) {
                                const disp = liteRateInverted ? 1 / liteMarketPoolPrice : liteMarketPoolPrice;
                                setLiteLimitRate(disp >= 1 ? disp.toFixed(4) : disp.toFixed(6));
                              }
                            }}
                            className="px-1.5 py-0.5 rounded bg-[#141923] hover:bg-[#1C2331] border border-[#2E384C] text-[10px] font-mono text-[#60A5FA] font-semibold transition-colors"
                          >
                            Market
                          </button>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={liteLimitRate}
                            onChange={(e) => setLiteLimitRate(e.target.value)}
                            placeholder="0.0000"
                            className="w-full min-w-0 bg-transparent text-base font-mono font-bold tabular-nums text-white outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const curr = Number(liteLimitRate);
                              if (Number.isFinite(curr) && curr > 0) {
                                const inv = 1 / curr;
                                setLiteLimitRate(inv >= 1 ? inv.toFixed(4) : inv.toFixed(6));
                              }
                              setLiteRateInverted((v) => !v);
                            }}
                            className="shrink-0 inline-flex items-center gap-1 text-xs font-mono text-slate-300 hover:text-white px-1.5 py-0.5 rounded bg-white/[0.04] hover:bg-white/[0.08] transition-colors"
                            title="Invert rate"
                          >
                            <span>
                              {matchedLitePool
                                ? liteRateInverted
                                  ? matchedLitePool.pool.baseSymbol
                                  : matchedLitePool.pool.quoteSymbol
                                : liteRateInverted
                                  ? fromToken.symbol
                                  : toToken.symbol}
                            </span>
                            <ArrowDownUp className="w-3 h-3 text-[#60A5FA] rotate-90" />
                          </button>
                        </div>
                      </div>

                      <div className="sm:col-span-5 bg-[#0C0E13] border border-[#2D374B] rounded-xl p-3 space-y-1.5">
                        <div className="text-[11px] text-slate-400 font-medium">Expires in</div>
                        <select
                          value={liteExpiryMs}
                          onChange={(e) => setLiteExpiryMs(Number(e.target.value))}
                          className="w-full bg-transparent text-sm font-bold text-white outline-none cursor-pointer"
                        >
                          <option value={3600 * 1000} className="bg-[#0C0E13]">1 Hour</option>
                          <option value={86400 * 1000} className="bg-[#0C0E13]">24 Hours</option>
                          <option value={7 * 86400 * 1000} className="bg-[#0C0E13]">7 Days</option>
                          <option value={30 * 86400 * 1000} className="bg-[#0C0E13]">30 Days</option>
                          <option value={0} className="bg-[#0C0E13]">Never (GTC)</option>
                        </select>
                      </div>
                    </div>

                    {/* Execution status */}
                    {matchedLitePool ? (
                      <div className="bg-[#000000] border border-[#2D374B] rounded-lg px-3 py-2 text-[11px] font-mono flex items-center justify-between text-slate-300">
                        <span className="flex items-center gap-1.5 text-[#08D189]">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>DeepBook v3 CLOB · 1-Tx Auto</span>
                        </span>
                        <span className="text-slate-400">
                          Fee: {(traderTier.feeRate * 100).toFixed(2)}%
                        </span>
                      </div>
                    ) : (
                      <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 text-[11px] text-amber-300">
                        {fromToken.symbol}/{toToken.symbol} is not listed on DeepBook v3 CLOB yet. Switch to{' '}
                        <button
                          type="button"
                          onClick={() => setSwapCardTab('market')}
                          className="underline font-bold text-white"
                        >
                          Market (7 DEXs)
                        </button>{' '}
                        or pick a DeepBook pair (SUI, USDC, DEEP, WAL, BTC, ETH, CETUS).
                      </div>
                    )}

                    {(() => {
                      const payNum = Number(amountIn) || 0;
                      const estBaseQty =
                        matchedLitePool && litePoolPriceNum > 0
                          ? matchedLitePool.isBid
                            ? payNum / litePoolPriceNum
                            : payNum
                          : 0;
                      const isZero = !amountIn || payNum <= 0 || litePoolPriceNum <= 0;
                      const isBelowMin = Boolean(matchedLitePool && !isZero && estBaseQty < matchedLitePool.pool.minSize);
                      const isInsufficient = Boolean(account?.address && !isZero && payNum > fromBal * 1.0001);
                      const liteDisabled =
                        isPlacingLiteLimit || !matchedLitePool || isZero || isBelowMin || isInsufficient;
                      const liteLabel = !account
                        ? 'Connect Wallet to Place Limit'
                        : isZero
                          ? 'Enter an amount'
                          : isBelowMin && matchedLitePool
                            ? `Min ${matchedLitePool.pool.minSize} ${matchedLitePool.pool.baseSymbol}`
                            : isInsufficient
                              ? `Insufficient ${fromToken.symbol} Balance`
                              : isPlacingLiteLimit
                                ? 'Confirm in Wallet...'
                                : `Place Limit ${matchedLitePool?.isBid ? 'Buy' : 'Sell'} Order`;
                      return (
                        <button
                          type="button"
                          disabled={liteDisabled}
                          onClick={executePlaceLiteLimit}
                          className="w-full py-3.5 rounded-lg btn-deepbook disabled:bg-[#121620] disabled:text-slate-500 disabled:shadow-none font-bold text-sm tracking-wide transition-all flex items-center justify-center gap-2"
                        >
                          {isPlacingLiteLimit && <Loader2 className="w-4 h-4 animate-spin" />}
                          <span>{liteLabel}</span>
                        </button>
                      );
                    })()}

                    {/* Compact Active Limit Orders List */}
                    {account && vaultSummary.openOrders.length > 0 && (
                      <div className="bg-[#06080C] border border-[#263246] rounded-lg p-2.5 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                          <span>Active Limit Orders ({vaultSummary.openOrders.length})</span>
                          <button
                            type="button"
                            onClick={() => setMode('limit')}
                            className="text-[#60A5FA] hover:underline"
                          >
                            Manage in Pro →
                          </button>
                        </div>
                        <div className="space-y-1 max-h-32 overflow-y-auto">
                          {vaultSummary.openOrders.map((ord) => (
                            <div
                              key={ord.orderId}
                              className="flex items-center justify-between text-[11px] font-mono bg-[#000000] px-2 py-1.5 rounded border border-[#1E2532]"
                            >
                              <div className="flex items-center gap-1.5">
                                <span className={ord.isBid ? 'text-[#08D189] font-bold' : 'text-[#F0525E] font-bold'}>
                                  {ord.isBid ? 'BUY' : 'SELL'}
                                </span>
                                <span className="text-white">
                                  {ord.quantity.toFixed(2)} @ {ord.price.toFixed(4)}
                                </span>
                              </div>
                              <button
                                type="button"
                                disabled={isVaultBusy}
                                onClick={() => handleCancelOrder(ord)}
                                className="text-[#F0525E] hover:underline font-semibold"
                              >
                                Cancel
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Compact 7-DEX Best-Price Engine & Pro Shortcut Strip */}
              <div className="rounded-xl bg-[#06080C] border border-[#242E40] px-3.5 py-2.5 space-y-2">
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="inline-flex items-center gap-1.5 text-[#08D189] font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#08D189] animate-pulse" />
                    7 Sui DEXs Racing
                  </span>
                  <button
                    type="button"
                    onClick={() => setMode('limit')}
                    className="text-slate-400 hover:text-[#60A5FA] transition-colors font-sans font-semibold"
                  >
                    Orderbook &amp; Candles → Pro
                  </button>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {AGGREGATED_PROTOCOLS.map((p) => (
                    <span
                      key={p.id}
                      className="px-1.5 py-0.5 rounded bg-[#0C1018] border border-[#222C3E] text-[10px] font-mono text-slate-300"
                      title={`${p.name} (${p.note})`}
                    >
                      {p.name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODE 2: BENTO DEEPBOOK-PRO SPOT CLOB TERMINAL */}
      {mode === 'limit' && (
        <div className="w-full overflow-x-hidden bg-[#000000] animate-panel-in">
          <div className="w-full p-1.5 sm:p-2 gap-1.5 sm:gap-2 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_265px_325px] xl:grid-cols-[minmax(0,1fr)_290px_345px]">
            {/* Cols 1-2, Row 1: DeepBook Alpha Pair Dropdown + 24h Ticker Strip */}
            <div className="min-w-0 relative z-20 lg:col-start-1 lg:col-span-2 lg:row-start-1 terminal-pane rounded-xl px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0 flex-wrap" ref={poolDropdownRef}>
                <button
                  type="button"
                  onClick={() => setMode('market')}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#06070A] border border-[#323D52] hover:border-[#2B7FFF]/60 text-xs font-semibold text-slate-200 hover:text-white transition-colors"
                  title="Back to Lite Swap"
                >
                  <span>← Lite</span>
                </button>
                {/* Searchable Pair Dropdown Trigger */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setPoolSearch('');
                      setShowPoolDropdown((v) => !v);
                    }}
                    className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-xs transition-all ${
                      showPoolDropdown
                        ? 'bg-[#0C1220] border-[#2B7FFF] text-white'
                        : 'bg-[#06070A] border-[#323D52] hover:border-[#2B7FFF]/60 text-white'
                    }`}
                  >
                    <PairBadgeIcons pool={activePool} size="md" />
                    <span className="font-bold font-mono tracking-tight">
                      {activePool.baseSymbol}/{activePool.quoteSymbol}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#2B7FFF]/15 text-[#60A5FA] font-semibold">
                      {activeClobPoolList.length} Pairs
                    </span>
                    <ChevronDown className={`w-3.5 h-3.5 text-[#8E98A8] transition-transform ${showPoolDropdown ? 'rotate-180' : ''}`} />
                  </button>

                  {showPoolDropdown && (
                    <div className="absolute left-0 top-full mt-1.5 w-[310px] sm:w-[490px] bg-[#07090D] border border-[#38445B] rounded-lg shadow-2xl p-3 z-50">
                      <div className="relative mb-2.5">
                        <Search className="w-3.5 h-3.5 text-[#8E98A8] absolute left-2.5 top-2.5" />
                        <input
                          type="text"
                          autoFocus
                          value={poolSearch}
                          onChange={(e) => setPoolSearch(e.target.value)}
                          placeholder={`Search ${activeClobPoolList.length} live DeepBook v3 CLOB pairs...`}
                          className="w-full pl-8 pr-3 py-1.5 rounded bg-[#000000] border border-[#323D52] text-xs font-mono text-white outline-none focus:border-[#2B7FFF]"
                        />
                      </div>

                      <div className="flex flex-wrap gap-1 mb-2.5">
                        {[
                          { id: 'all', label: `All (${activeClobPoolList.length})` },
                          { id: 'bluechip', label: 'Bluechips' },
                          { id: 'usdc', label: 'USDC / Stables' },
                          { id: 'sui', label: 'SUI Pairs' },
                        ].map((tab) => (
                          <button
                            key={tab.id}
                            type="button"
                            onClick={() => setPoolQuoteFilter(tab.id as any)}
                            className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-colors ${
                              poolQuoteFilter === tab.id
                                ? 'bg-[#2B7FFF] text-white'
                                : 'bg-[#0C0E13] text-[#8E98A8] hover:text-white'
                            }`}
                          >
                            {tab.label}
                          </button>
                        ))}
                      </div>

                      <div className="grid grid-cols-12 px-2 pb-1.5 text-[10px] font-mono uppercase text-[#8E98A8] border-b border-[#2A3346]">
                        <span className="col-span-5">Market</span>
                        <span className="col-span-3 text-right">Last Price</span>
                        <span className="col-span-2 text-right">24h %</span>
                        <span className="col-span-2 text-right">24h Vol</span>
                      </div>

                      <div className="max-h-72 overflow-y-auto divide-y divide-[#283142]">
                        {filteredClobPools.map((pool) => {
                          const isSelected = pool.poolName === activePool.poolName;
                          const chg = pool.change24hPct;
                          return (
                            <button
                              key={pool.poolName}
                              type="button"
                              onClick={() => {
                                setActivePool(pool);
                                setLimitPrice('');
                                setShowPoolDropdown(false);
                              }}
                              className={`w-full grid grid-cols-12 items-center px-2 py-2 text-left text-xs font-mono transition-colors ${
                                isSelected ? 'bg-[#2B7FFF]/14' : 'hover:bg-white/[0.04]'
                              }`}
                            >
                              <div className="col-span-5 flex items-center gap-2 min-w-0">
                                <PairBadgeIcons pool={pool} size="sm" />
                                <div className="truncate text-white font-semibold">
                                  {pool.baseSymbol}/{pool.quoteSymbol}
                                </div>
                              </div>
                              <div className="col-span-3 text-right text-white tabular-nums">
                                {pool.lastPrice ? fmtClobPrice(pool.lastPrice) : '—'}
                              </div>
                              <div
                                className={`col-span-2 text-right tabular-nums ${
                                  chg === undefined
                                    ? 'text-[#8E98A8]'
                                    : chg >= 0
                                      ? 'text-[#08D189]'
                                      : 'text-[#F0525E]'
                                }`}
                              >
                                {chg === undefined ? '—' : `${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%`}
                              </div>
                              <div className="col-span-2 text-right text-[#94A3B8] tabular-nums">
                                {pool.volume24hUsd
                                  ? pool.volume24hUsd >= 1e6
                                    ? `$${(pool.volume24hUsd / 1e6).toFixed(1)}M`
                                    : pool.volume24hUsd >= 1e3
                                      ? `$${(pool.volume24hUsd / 1e3).toFixed(0)}K`
                                      : `$${pool.volume24hUsd.toFixed(0)}`
                                  : '—'}
                              </div>
                            </button>
                          );
                        })}
                        {filteredClobPools.length === 0 && (
                          <div className="py-5 text-center text-xs font-mono text-[#8E98A8]">
                            No DeepBook CLOB pools match your filter.
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Quick Flagship Pair Pills */}
                <div className="hidden xl:flex items-center gap-1">
                  {activeClobPoolList.slice(0, 7).map((pool) => {
                    const active = activePool.poolName === pool.poolName;
                    return (
                      <button
                        key={pool.poolName}
                        type="button"
                        onClick={() => {
                          setActivePool(pool);
                          setLimitPrice('');
                        }}
                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-mono whitespace-nowrap transition-colors border ${
                          active
                            ? 'bg-[#2B7FFF]/15 text-[#60A5FA] border-[#2B7FFF]/50 font-bold'
                            : 'text-[#8E98A8] hover:text-white hover:bg-white/[0.04] border-transparent'
                        }`}
                      >
                        <TokenBadgeIcon symbol={pool.baseSymbol} coinId={pool.baseCoinId} sizeClass="w-3.5 h-3.5" />
                        <span>{pool.baseSymbol}/{pool.quoteSymbol}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 24h Live Market Ticker Strip */}
              <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums">
                <div>
                  <div className="text-[10px] text-[#8E98A8]">Mid / Last</div>
                  <div className="text-white font-bold">
                    {orderbook.midPrice > 0
                      ? fmtClobPrice(orderbook.midPrice)
                      : activePool.lastPrice
                        ? fmtClobPrice(activePool.lastPrice)
                        : '—'}
                  </div>
                </div>
                <div title="Live Pyth Hermes Oracle Price">
                  <div className="text-[10px] text-[#8E98A8]">Oracle Price</div>
                  <div className="text-[#60A5FA] font-bold">
                    {oraclePrice && oraclePrice > 0 ? fmtClobPrice(oraclePrice) : '—'}
                  </div>
                </div>
                {activePool.change24hPct !== undefined && (
                  <div>
                    <div className="text-[10px] text-[#8E98A8]">24h Change</div>
                    <div className={activePool.change24hPct >= 0 ? 'pnl-green font-semibold' : 'pnl-red font-semibold'}>
                      {activePool.change24hPct >= 0 ? '+' : ''}
                      {activePool.change24hPct.toFixed(2)}%
                    </div>
                  </div>
                )}
                {activePool.volume24hUsd !== undefined && (
                  <div className="hidden sm:block">
                    <div className="text-[10px] text-[#8E98A8]">24h Volume</div>
                    <div className="text-slate-200">
                      ${Math.round(activePool.volume24hUsd).toLocaleString()}
                    </div>
                  </div>
                )}
                <div>
                  <div className="text-[10px] text-[#8E98A8]">Spread</div>
                  <div className="text-slate-200">{orderbook.spreadPct.toFixed(3)}%</div>
                </div>
                <div className="hidden md:block">
                  <div className="text-[10px] text-[#8E98A8]">Book Depth</div>
                  <div className="text-[#60A5FA]">
                    {orderbook.bids.length} Bids / {orderbook.asks.length} Asks
                  </div>
                </div>
              </div>
            </div>

            {/* Col 1, Row 2: Wide Real DeepBook Candlestick Chart */}
            <div className="lg:col-start-1 lg:row-start-2 terminal-pane rounded-xl overflow-hidden min-w-0">
              <ProCandleChart
                symbolLabel={`${activePool.baseSymbol}/${activePool.quoteSymbol}`}
                sourceLabel="DeepBook v3 CLOB"
                candles={candles}
                timeframe={timeframe}
                onTimeframeChange={setTimeframe}
                isLoading={candlesLoading}
                heightClass="h-[430px] lg:h-[520px] xl:h-[550px]"
                livePrice={orderbook.midPrice}
              />
            </div>

            {/* Col 2, Row 2: Compact Live L2 Orderbook & Trades */}
            <div className="min-w-0 lg:col-start-2 lg:row-start-2 terminal-pane rounded-xl flex flex-col overflow-hidden h-[465px] lg:h-[556px] xl:h-[586px]">
              <div className="px-3 border-b border-[#2D374B] flex items-center gap-4 h-9 shrink-0">
                <button
                  type="button"
                  onClick={() => setBookTab('book')}
                  className={`h-full text-xs font-semibold border-b-2 transition-colors ${
                    bookTab === 'book'
                      ? 'border-[#2B7FFF] text-white'
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  Order Book
                </button>
                <button
                  type="button"
                  onClick={() => setBookTab('trades')}
                  className={`h-full text-xs font-semibold border-b-2 transition-colors ${
                    bookTab === 'trades'
                      ? 'border-[#2B7FFF] text-white'
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  Trades
                </button>
                {bookTab === 'book' && (
                  <div className="ml-auto flex items-center gap-1">
                    <select
                      value={bookTickMult}
                      onChange={(e) => setBookTickMult(Number(e.target.value))}
                      className="bg-[#06070A] border border-[#2D374B] rounded px-1.5 py-0.5 text-[10px] font-mono text-slate-300 outline-none cursor-pointer"
                      title="Order Book price grouping"
                    >
                      {[1, 10, 50, 100].map((m) => (
                        <option key={m} value={m} className="bg-[#06070A]">
                          {((activePool.tickSize || 0.0001) * m).toFixed(
                            m >= 100 ? 2 : m >= 10 ? 3 : 4
                          )}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setBookSizeUnit((u) => (u === 'base' ? 'quote' : 'base'))}
                      className="px-1.5 py-0.5 rounded bg-[#06070A] border border-[#2D374B] text-[10px] font-mono text-[#60A5FA] hover:border-[#2B7FFF]/60 transition-colors"
                      title="Toggle size display unit"
                    >
                      {bookSizeUnit === 'base' ? activePool.baseSymbol : activePool.quoteSymbol}
                    </button>
                  </div>
                )}
              </div>

              {bookTab === 'book' ? (
                <div className="flex-1 min-h-0 flex flex-col justify-between p-2 text-[11px] font-mono tabular-nums overflow-hidden">
                  <div className="grid grid-cols-3 text-slate-500 px-1.5 pb-1 text-[10px]">
                    <span>Price</span>
                    <span className="text-right">
                      Size ({bookSizeUnit === 'base' ? activePool.baseSymbol : activePool.quoteSymbol})
                    </span>
                    <span className="text-right">Total</span>
                  </div>

                  {/* Asks (13 dense levels) */}
                  <div className="space-y-0.5 overflow-hidden">
                    {groupedOrderbook.asks.slice(-13).map((lv, idx) => {
                      const maxTotal =
                        groupedOrderbook.asks[0]?.totalSize ||
                        groupedOrderbook.asks[groupedOrderbook.asks.length - 1]?.totalSize ||
                        1;
                      const pct = Math.min(100, (lv.totalSize / Math.max(1e-9, maxTotal)) * 100);
                      const dispSize = bookSizeUnit === 'base' ? lv.size : lv.size * lv.price;
                      const dispTotal = bookSizeUnit === 'base' ? lv.totalSize : lv.totalSize * lv.price;
                      return (
                        <button
                          key={`ask-${idx}`}
                          type="button"
                          onClick={() => {
                            setLimitPrice(lv.price.toString());
                          }}
                          className="relative w-full grid grid-cols-3 px-1.5 py-[2px] rounded hover:bg-white/[0.04] text-left transition-colors"
                        >
                          <div
                            className="absolute inset-y-0 right-0 bg-[#F0525E]/15 pointer-events-none"
                            style={{ width: `${pct}%` }}
                          />
                          <span className="relative text-[#F0525E] font-medium">{fmtClobPrice(lv.price)}</span>
                          <span className="relative text-right text-slate-200">{dispSize.toFixed(1)}</span>
                          <span className="relative text-right text-slate-400">
                            {dispTotal.toFixed(0)}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Spread Mid */}
                  <div className="py-1.5 px-2 my-1 bg-[#06070A] border-y border-[#2D374B] flex items-center justify-between">
                    <span className="text-xs font-bold text-white">
                      {orderbook.midPrice > 0 ? fmtClobPrice(orderbook.midPrice) : '—'}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Spread {orderbook.spreadPct.toFixed(3)}%
                    </span>
                  </div>

                  {/* Bids (13 dense levels) */}
                  <div className="space-y-0.5 overflow-hidden">
                    {groupedOrderbook.bids.slice(0, 13).map((lv, idx) => {
                      const maxTotal =
                        groupedOrderbook.bids[Math.min(12, groupedOrderbook.bids.length - 1)]?.totalSize || 1;
                      const pct = Math.min(100, (lv.totalSize / Math.max(1e-9, maxTotal)) * 100);
                      const dispSize = bookSizeUnit === 'base' ? lv.size : lv.size * lv.price;
                      const dispTotal = bookSizeUnit === 'base' ? lv.totalSize : lv.totalSize * lv.price;
                      return (
                        <button
                          key={`bid-${idx}`}
                          type="button"
                          onClick={() => {
                            setLimitPrice(lv.price.toString());
                          }}
                          className="relative w-full grid grid-cols-3 px-1.5 py-[2px] rounded hover:bg-white/[0.04] text-left transition-colors"
                        >
                          <div
                            className="absolute inset-y-0 right-0 bg-[#08D189]/15 pointer-events-none"
                            style={{ width: `${pct}%` }}
                          />
                          <span className="relative text-[#08D189] font-medium">{fmtClobPrice(lv.price)}</span>
                          <span className="relative text-right text-slate-200">{dispSize.toFixed(1)}</span>
                          <span className="relative text-right text-slate-400">
                            {dispTotal.toFixed(0)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex-1 p-2.5 overflow-y-auto text-[11px] font-mono tabular-nums space-y-0.5">
                  <div className="grid grid-cols-3 text-slate-500 px-1 pb-1">
                    <span>Price</span>
                    <span className="text-right">Size</span>
                    <span className="text-right">Time</span>
                  </div>
                  {trades.map((tr) => (
                    <div key={tr.tradeId} className="grid grid-cols-3 px-1 py-0.5">
                      <span className={tr.type === 'buy' ? 'text-[#08D189] font-medium' : 'text-[#F0525E] font-medium'}>
                        {fmtClobPrice(tr.price)}
                      </span>
                      <span className="text-right text-slate-200">{tr.baseVolume.toFixed(1)}</span>
                      <span className="text-right text-slate-400">
                        {new Date(tr.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Col 3, Rows 1-3: Full-Height Spot CLOB Order Ticket */}
            <div className="lg:col-start-3 lg:row-start-1 lg:row-span-3 terminal-pane rounded-xl overflow-hidden flex flex-col min-w-0">
              <div className="p-3 flex flex-col gap-3">
                <div className="space-y-3">
                    {/* Spot Order Type Switcher: Market | Limit */}
                    <div className="flex items-center justify-between gap-2 border-b border-[#2D374B] pb-1.5">
                      <div className="inline-flex items-center gap-3">
                        {(['market', 'limit'] as const).map((style) => (
                          <button
                            key={style}
                            type="button"
                            onClick={() => setSpotOrderStyle(style)}
                            className={`pb-1 text-xs font-semibold capitalize transition-all border-b-2 -mb-[7px] ${
                              spotOrderStyle === style
                                ? 'border-[#2B7FFF] text-white'
                                : 'border-transparent text-[#8E98A8] hover:text-white'
                            }`}
                          >
                            {style}
                          </button>
                        ))}
                      </div>
                      <span className="text-[11px] font-mono text-[#8E98A8]">
                        Spot CLOB · Auto-Settle
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => setLimitSide('buy')}
                        className={`py-2 rounded-md text-xs font-extrabold tracking-wide transition-all border ${
                          limitSide === 'buy'
                            ? 'bg-[#08D189]/20 border-[#08D189] text-[#08D189] shadow-[inset_0_0_12px_rgba(8,209,137,0.14)]'
                            : 'bg-[#06070A] text-[#94A3B8] hover:text-white border-[#323D52]'
                        }`}
                      >
                        BUY {activePool.baseSymbol}
                      </button>
                      <button
                        type="button"
                        onClick={() => setLimitSide('sell')}
                        className={`py-2 rounded-md text-xs font-extrabold tracking-wide transition-all border ${
                          limitSide === 'sell'
                            ? 'bg-[#F0525E]/20 border-[#F0525E] text-[#F0525E] shadow-[inset_0_0_12px_rgba(240,82,94,0.14)]'
                            : 'bg-[#06070A] text-[#94A3B8] hover:text-white border-[#323D52]'
                        }`}
                      >
                        SELL {activePool.baseSymbol}
                      </button>
                    </div>

                    {/* Price (Limit editable OR Market live book quote + slippage) */}
                    {spotOrderStyle === 'limit' ? (
                      <div className="bg-[#06070A] border border-[#323D52] focus-within:border-[#2B7FFF]/60 rounded-lg p-2.5 space-y-1 transition-colors">
                        <div className="flex justify-between text-xs text-[#8E98A8]">
                          <span>Limit Price</span>
                          <button
                            type="button"
                            onClick={() => orderbook.midPrice > 0 && setLimitPrice(orderbook.midPrice.toFixed(4))}
                            className="text-[#60A5FA] font-mono font-semibold hover:underline"
                          >
                            Mid {orderbook.midPrice > 0 ? fmtClobPrice(orderbook.midPrice) : ''}
                          </button>
                        </div>
                        <div className="flex items-center justify-between">
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={limitPrice}
                            onChange={(e) => setLimitPrice(e.target.value)}
                            placeholder="0.0000"
                            className="w-full bg-transparent text-lg font-mono font-bold tabular-nums text-white outline-none"
                          />
                          <span className="text-xs font-mono text-[#8E98A8]">{activePool.quoteSymbol}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-[#06070A] border border-[#323D52] rounded-lg p-2.5 space-y-2">
                        <div className="flex justify-between items-center text-xs text-[#8E98A8]">
                          <span>Market Execution Price</span>
                          <span className="font-mono font-bold text-[#60A5FA]">
                            ~{fmtClobPrice(
                              limitSide === 'buy'
                                ? orderbook.asks[0]?.price || orderbook.midPrice
                                : orderbook.bids[0]?.price || orderbook.midPrice
                            )}{' '}
                            {activePool.quoteSymbol}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-400">Slippage Cushion</span>
                          <div className="flex items-center gap-1">
                            {[0.5, 1.5, 3.0].map((s) => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => setSpotMarketSlippage(s)}
                                className={`px-2 py-0.5 rounded font-mono border ${
                                  spotMarketSlippage === s
                                    ? 'bg-[#2B7FFF]/18 text-[#60A5FA] border-[#2B7FFF]/45 font-semibold'
                                    : 'bg-[#0C0E13] text-slate-400 hover:text-white border-[#2D374B]'
                                }`}
                              >
                                {s}%
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Quantity with Base/Quote Toggle */}
                    <div className="bg-[#06070A] border border-[#2D374B] focus-within:border-[#2B7FFF]/60 rounded-lg p-2.5 space-y-2 transition-colors">
                      <div className="flex justify-between items-center text-xs text-slate-400">
                        <div className="flex items-center gap-1.5">
                          <span>Size</span>
                          <div className="inline-flex rounded bg-[#0C0E13] border border-[#263246] p-0.5 text-[10px] font-mono">
                            <button
                              type="button"
                              onClick={() => {
                                if (qtyCurrency === 'quote') {
                                  const refPx =
                                    spotOrderStyle === 'limit'
                                      ? Number(limitPrice) || orderbook.midPrice || 1
                                      : orderbook.midPrice || 1;
                                  const cur = Number(limitQty);
                                  if (Number.isFinite(cur) && cur > 0 && refPx > 0) {
                                    setLimitQty((cur / refPx).toFixed(3));
                                  }
                                  setQtyCurrency('base');
                                }
                              }}
                              className={`px-1.5 py-0.5 rounded font-semibold transition-colors ${
                                qtyCurrency === 'base'
                                  ? 'bg-[#2B7FFF] text-white'
                                  : 'text-slate-400 hover:text-white'
                              }`}
                            >
                              {activePool.baseSymbol}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (qtyCurrency === 'base') {
                                  const refPx =
                                    spotOrderStyle === 'limit'
                                      ? Number(limitPrice) || orderbook.midPrice || 1
                                      : orderbook.midPrice || 1;
                                  const cur = Number(limitQty);
                                  if (Number.isFinite(cur) && cur > 0 && refPx > 0) {
                                    setLimitQty((cur * refPx).toFixed(2));
                                  }
                                  setQtyCurrency('quote');
                                }
                              }}
                              className={`px-1.5 py-0.5 rounded font-semibold transition-colors ${
                                qtyCurrency === 'quote'
                                  ? 'bg-[#2B7FFF] text-white'
                                  : 'text-slate-400 hover:text-white'
                              }`}
                            >
                              {activePool.quoteSymbol}
                            </button>
                          </div>
                        </div>
                        <span className="font-mono tabular-nums">
                          Wallet:{' '}
                          {limitSide === 'buy'
                            ? `${limitWalletQuoteBal.toFixed(2)} ${activePool.quoteSymbol}`
                            : `${limitWalletBaseBal.toFixed(3)} ${activePool.baseSymbol}`}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={limitQty}
                          onChange={(e) => setLimitQty(e.target.value)}
                          placeholder="0.0"
                          className="w-full bg-transparent text-lg font-mono font-bold tabular-nums text-white outline-none"
                        />
                        <span className="text-xs font-mono text-slate-400">
                          {qtyCurrency === 'base' ? activePool.baseSymbol : activePool.quoteSymbol}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-1 pt-0.5">
                        {[0.25, 0.5, 0.75, 1].map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            onClick={() => {
                              const px =
                                spotOrderStyle === 'limit'
                                  ? Number(limitPrice) || orderbook.midPrice || 1
                                  : orderbook.midPrice || 1;
                              if (limitSide === 'buy') {
                                const walletQuote = Math.max(
                                  0,
                                  limitWalletQuoteBal - (activePool.quoteSymbol === 'SUI' ? 0.05 : 0)
                                );
                                const buySafety =
                                  1 -
                                  (spotOrderStyle === 'market' ? spotMarketSlippage / 100 + 0.01 : 0.01);
                                const quoteAmt = walletQuote * pct * buySafety;
                                setLimitQty(
                                  qtyCurrency === 'quote'
                                    ? quoteAmt.toFixed(2)
                                    : (quoteAmt / px).toFixed(2)
                                );
                              } else {
                                const walletBase = Math.max(
                                  0,
                                  limitWalletBaseBal - (activePool.baseSymbol === 'SUI' ? 0.05 : 0)
                                );
                                const baseAmt = walletBase * pct * 0.98;
                                setLimitQty(
                                  qtyCurrency === 'quote'
                                    ? (baseAmt * px).toFixed(2)
                                    : baseAmt.toFixed(2)
                                );
                              }
                            }}
                            className="py-1 rounded bg-[#0C0E13] hover:bg-[#141821] border border-[#2D374B] text-[11px] font-mono text-slate-300 transition-colors"
                          >
                            {Math.round(pct * 100)}%
                          </button>
                        ))}
                      </div>
                    </div>

                    {spotOrderStyle === 'limit' && (
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="text-slate-400 font-mono">TIF</span>
                        <div className="flex items-center gap-1">
                          {(
                            [
                              { id: 'GTC', label: 'GTC' },
                              { id: 'IOC', label: 'IOC' },
                              { id: 'FOK', label: 'FOK' },
                              { id: 'POST_ONLY', label: 'Post-Only' },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => {
                                setSpotTif(opt.id);
                                setPostOnly(opt.id === 'POST_ONLY');
                              }}
                              className={`px-2 py-1 rounded font-mono border transition-colors ${
                                spotTif === opt.id
                                  ? 'bg-[#2B7FFF]/20 border-[#2B7FFF]/60 text-[#60A5FA] font-semibold'
                                  : 'bg-[#0C0E13] border-[#2D374B] text-slate-400 hover:text-white'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                      <span className="flex items-center gap-1.5">
                        <span>Pay fees with DEEP</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#08D189]/10 border border-[#08D189]/30 text-[#08D189]">
                          Fee Discount
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={payFeesWithDeep}
                        onChange={(e) => setPayFeesWithDeep(e.target.checked)}
                        className="accent-[#2B7FFF] w-4 h-4"
                      />
                    </label>

                    {(() => {
                      const activePx =
                        spotOrderStyle === 'limit'
                          ? Number(limitPrice) || 0
                          : limitSide === 'buy'
                            ? orderbook.asks[0]?.price || orderbook.midPrice
                            : orderbook.bids[0]?.price || orderbook.midPrice;
                      const rawInput = Number(limitQty) || 0;
                      const baseQty = qtyCurrency === 'quote' && activePx > 0 ? rawInput / activePx : rawInput;
                      const quoteTotal = activePx * baseQty;
                      const payingNeeded = limitSide === 'buy' ? quoteTotal : baseQty;
                      const walletAvail =
                        limitSide === 'buy'
                          ? limitWalletQuoteBal + (managerState?.quoteBalance ?? 0)
                          : limitWalletBaseBal + (managerState?.baseBalance ?? 0);
                      const isZeroQty = !Number.isFinite(baseQty) || baseQty <= 0;
                      const isBelowMinSize = !isZeroQty && baseQty < activePool.minSize;
                      const isInsufficient = Boolean(account?.address) && !isZeroQty && payingNeeded > walletAvail * 1.0001;
                      const btnDisabled = isPlacingLimit || (Boolean(account?.address) && (isZeroQty || isBelowMinSize || isInsufficient || activePx <= 0));
                      const btnText = !account?.address
                        ? 'Connect Sui Wallet to Trade'
                        : isZeroQty
                          ? 'Enter an amount'
                          : isBelowMinSize
                            ? `Min ${activePool.minSize} ${activePool.baseSymbol}`
                            : isInsufficient
                              ? `Insufficient ${limitSide === 'buy' ? activePool.quoteSymbol : activePool.baseSymbol}`
                              : spotOrderStyle === 'market'
                                ? `Market ${limitSide === 'buy' ? 'Buy' : 'Sell'} ${activePool.baseSymbol} (Direct Wallet)`
                                : `Place Limit ${limitSide === 'buy' ? 'Buy' : 'Sell'} ${activePool.baseSymbol}`;

                      return (
                        <>
                          <div className="text-xs font-mono space-y-1.5 text-slate-400 pt-1 border-t border-[#2D374B]">
                            <div className="flex justify-between pt-1">
                              <span>You pay</span>
                              <span className="text-white font-semibold tabular-nums">
                                {limitSide === 'buy'
                                  ? `${quoteTotal.toFixed(4)} ${activePool.quoteSymbol}`
                                  : `${baseQty.toFixed(4)} ${activePool.baseSymbol}`}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span>You receive</span>
                              <span className="text-[#08D189] font-semibold tabular-nums">
                                {limitSide === 'buy'
                                  ? `${baseQty.toFixed(4)} ${activePool.baseSymbol}`
                                  : `${quoteTotal.toFixed(4)} ${activePool.quoteSymbol}`}
                              </span>
                            </div>
                            <div className="flex justify-between text-[11px]">
                              <span>Volt Fee ({traderTier.name})</span>
                              <span className="text-[#60A5FA] font-semibold">{(traderTier.feeRate * 100).toFixed(2)}%</span>
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={btnDisabled}
                            onClick={spotOrderStyle === 'market' ? executePlaceSpotMarket : executePlaceLimit}
                            className={`w-full py-3 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                              limitSide === 'buy'
                                ? 'btn-deepbook shadow-[0_0_16px_rgba(43,127,255,0.35)]'
                                : 'bg-[#F0525E] hover:bg-[#FF6370] text-white shadow-[0_0_16px_rgba(240,82,94,0.35)]'
                            } disabled:opacity-50`}
                          >
                            {isPlacingLimit && <Loader2 className="w-4 h-4 animate-spin" />}
                            <span>{btnText}</span>
                          </button>
                        </>
                      );
                    })()}

                    <div className="flex items-center justify-center gap-1.5 text-[11px] font-mono text-[#08D189] text-center pt-0.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>1-Tx Non-Custodial: Auto-draws from wallet · No pre-deposit required</span>
                    </div>
                  </div>

                  {/* Settled Funds & Vault Balances Notice */}
                  {(vaultSummary.freeBase > 0 || vaultSummary.freeQuote > 0 || vaultSummary.settledBase > 0 || vaultSummary.settledQuote > 0) ? (
                    <div className="bg-[#06080C] border border-[#222B3A] rounded-lg p-2.5 space-y-2 text-xs font-mono">
                      <div className="flex items-center justify-between text-[11px] text-[#8E98A8]">
                        <span className="flex items-center gap-1 text-slate-300">
                          <ShieldCheck className="w-3.5 h-3.5 text-[#60A5FA]" />
                          <span>Vault Settled Coins</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleWithdrawManagerAll(false)}
                          disabled={isVaultBusy}
                          className="text-[#08D189] hover:underline font-bold"
                        >
                          Claim to Wallet →
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 text-[11px] tabular-nums">
                        <div className="bg-[#000000] p-1.5 rounded border border-[#1E2532]">
                          <span className="text-slate-400">{activePool.baseSymbol}: </span>
                          <span className="text-white font-bold">{(vaultSummary.freeBase + vaultSummary.settledBase).toFixed(3)}</span>
                        </div>
                        <div className="bg-[#000000] p-1.5 rounded border border-[#1E2532]">
                          <span className="text-slate-400">{activePool.quoteSymbol}: </span>
                          <span className="text-white font-bold">{(vaultSummary.freeQuote + vaultSummary.settledQuote).toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] font-mono text-[#6E7B91] text-center border-t border-[#1C2330] pt-2">
                      DeepBook v3 Institutional CLOB · Zero Custodial Risk
                    </div>
                  )}
                </div>
            </div>

            {/* Cols 1-2, Row 3: Bottom Dock (Open Spot Limit Orders & BalanceManager Vault) */}
            <div className="lg:col-start-1 lg:col-span-2 lg:row-start-3 terminal-pane rounded-xl overflow-hidden min-w-0">
              <div className="p-3.5 sm:p-4 min-h-[210px] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#2D374B] pb-2">
                    <div className="flex flex-wrap items-center gap-4">
                      <button
                        type="button"
                        onClick={() => setSpotDockTab('orders')}
                        className={`pb-1 text-xs font-mono border-b-2 -mb-[9px] transition-colors ${
                          spotDockTab === 'orders'
                            ? 'border-[#2B7FFF] text-white font-semibold'
                            : 'border-transparent text-[#8E98A8] hover:text-white'
                        }`}
                      >
                        Open Limit Orders ({vaultSummary.openOrders.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setSpotDockTab('history')}
                        className={`pb-1 text-xs font-mono border-b-2 -mb-[9px] transition-colors ${
                          spotDockTab === 'history'
                            ? 'border-[#2B7FFF] text-white font-semibold'
                            : 'border-transparent text-[#8E98A8] hover:text-white'
                        }`}
                      >
                        History ({spotHistory.length})
                      </button>
                      {vaultSummary.openOrders.length > 0 && (
                        <button
                          type="button"
                          onClick={() => handleWithdrawManagerAll(true)}
                          disabled={isVaultBusy}
                          className="px-2.5 py-0.5 rounded bg-[#F0525E]/15 hover:bg-[#F0525E]/25 border border-[#F0525E]/35 text-[#F0525E] text-[11px] font-semibold"
                        >
                          Cancel All &amp; Withdraw
                        </button>
                      )}
                      {(vaultSummary.settledBase > 0 || vaultSummary.settledQuote > 0) && (
                        <button
                          type="button"
                          onClick={() => handleWithdrawManagerAll(false)}
                          disabled={isVaultBusy}
                          className="px-2.5 py-0.5 rounded bg-[#08D189]/15 border border-[#08D189]/35 text-[#08D189] text-[11px] font-mono"
                        >
                          Claim Settled ({vaultSummary.settledBase.toFixed(4)} {activePool.baseSymbol} /{' '}
                          {vaultSummary.settledQuote.toFixed(4)} {activePool.quoteSymbol})
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={refreshDeepBookAccount}
                      className="text-[#8E98A8] hover:text-white p-1.5 rounded hover:bg-white/[0.06]"
                      title="Refresh DeepBook state"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {spotDockTab === 'history' ? (
                    !account ? (
                      <div className="text-xs text-[#8E98A8] py-8 text-center font-mono">
                        Connect your Sui wallet to view your Spot CLOB order &amp; fill history.
                      </div>
                    ) : spotHistory.length === 0 ? (
                      <div className="text-xs text-[#8E98A8] py-8 text-center font-mono">
                        No Spot CLOB executions recorded in this session yet. Place a Market or Limit order to populate history.
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs font-mono tabular-nums">
                          <thead>
                            <tr className="text-[#8E98A8] border-b border-[#2D374B]">
                              <th className="text-left py-2">Market</th>
                              <th className="text-left py-2">Type</th>
                              <th className="text-left py-2">Side</th>
                              <th className="text-right py-2">Price</th>
                              <th className="text-right py-2">Size</th>
                              <th className="text-right py-2">Time</th>
                              <th className="text-right py-2">Tx</th>
                            </tr>
                          </thead>
                          <tbody>
                            {spotHistory.map((item) => (
                              <tr key={item.id} className="border-b border-[#2D374B]/60">
                                <td className="py-2 text-white font-semibold">
                                  {item.baseSymbol}/{item.quoteSymbol}
                                </td>
                                <td className="py-2 text-slate-300">{item.style}</td>
                                <td className={`py-2 font-semibold ${item.side === 'buy' ? 'text-[#08D189]' : 'text-[#F0525E]'}`}>
                                  {item.side.toUpperCase()}
                                </td>
                                <td className="text-right py-2 text-white">{fmtClobPrice(item.price)}</td>
                                <td className="text-right py-2 text-slate-200">
                                  {item.qty.toFixed(4)} {item.baseSymbol}
                                </td>
                                <td className="text-right py-2 text-slate-400">
                                  {new Date(item.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </td>
                                <td className="text-right py-2">
                                  <a
                                    href={`https://suiscan.xyz/mainnet/tx/${item.digest}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[#60A5FA] hover:underline"
                                  >
                                    Suiscan ↗
                                  </a>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                  ) : !account ? (
                    <div className="text-xs text-[#8E98A8] py-8 text-center font-mono">
                      Connect your Sui wallet to view open DeepBook v3 limit orders across {pools.length} live pairs.
                    </div>
                  ) : vaultSummary.openOrders.length === 0 ? (
                    <div className="text-xs text-[#8E98A8] py-8 text-center font-mono">
                      No open limit orders on {activePool.baseSymbol}/{activePool.quoteSymbol}. Click any price in the Order Book or enter a Limit Price to place an order.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs font-mono tabular-nums">
                        <thead>
                          <tr className="text-[#8E98A8] border-b border-[#2D374B]">
                            <th className="text-left py-2">Side</th>
                            <th className="text-right py-2">Price ({activePool.quoteSymbol})</th>
                            <th className="text-right py-2">Qty ({activePool.baseSymbol})</th>
                            <th className="text-right py-2">Filled</th>
                            <th className="text-right py-2">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vaultSummary.openOrders.map((ord) => (
                            <tr key={`${ord.managerId || ''}_${ord.orderId}`} className="border-b border-[#2D374B]/60">
                              <td className={`py-2 font-semibold ${ord.isBid ? 'text-[#08D189]' : 'text-[#F0525E]'}`}>
                                {ord.isBid ? 'BUY' : 'SELL'}
                              </td>
                              <td className="text-right py-2 text-white">{fmtClobPrice(ord.price)}</td>
                              <td className="text-right py-2 text-slate-200">{ord.quantity.toFixed(4)}</td>
                              <td className="text-right py-2 text-slate-400">{ord.filledQuantity.toFixed(4)}</td>
                              <td className="text-right py-2">
                                <button
                                  type="button"
                                  disabled={isVaultBusy}
                                  onClick={() => handleCancelOrder(ord)}
                                  className="px-2.5 py-1 rounded bg-[#F0525E]/15 hover:bg-[#F0525E]/25 text-[#F0525E] text-xs font-semibold"
                                >
                                  Cancel &amp; Settle
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
            </div>
          </div>
        </div>
      )}

      {/* Token Picker Modal */}
      {tokenPickerFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="panel-carbon rounded-xl w-full max-w-md p-5 space-y-3.5 border border-[#2E384C] animate-panel-in">
            <div className="flex items-center justify-between">
              <span className="text-base font-bold text-white">Select Token</span>
              <button
                type="button"
                onClick={() => setTokenPickerFor(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="text"
              autoFocus
              value={tokenQuery}
              onChange={(e) => setTokenQuery(e.target.value)}
              placeholder="Search symbol or coin type..."
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#0C0E13] border border-[#2D374B] text-sm text-white outline-none focus:border-[#2B7FFF]"
            />
            <div className="max-h-80 overflow-y-auto space-y-1">
              {filteredTokens.map((t) => {
                const bal = account?.address ? readBalanceFromMap(balances, t.address, t.decimals) : 0;
                return (
                  <button
                    key={t.address + t.symbol}
                    type="button"
                    onClick={() => {
                      if (tokenPickerFor === 'from') {
                        if (t.address === toToken.address) setToToken(fromToken);
                        setFromToken(t);
                      } else {
                        if (t.address === fromToken.address) setFromToken(toToken);
                        setToToken(t);
                      }
                      setTokenPickerFor(null);
                    }}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-white/[0.06] text-left transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <img src={t.logo} alt={t.symbol} className="w-7 h-7 rounded-full" />
                      <div>
                        <div className="text-sm font-bold text-white">{t.symbol}</div>
                        <div className="text-xs text-slate-400">{t.name}</div>
                      </div>
                    </div>
                    <span className="text-xs font-mono tabular-nums text-slate-300">
                      {bal > 0 ? bal.toFixed(4) : '0'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Spot CLOB BalanceManager Deposit / Withdraw Modal */}
      {showSpotVaultModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="panel-carbon rounded-xl w-full max-w-md p-5 space-y-4 border border-[#2B7FFF]/35 animate-panel-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {showSpotVaultModal === 'deposit' ? (
                  <ArrowDownToLine className="w-4 h-4 text-[#2B7FFF]" />
                ) : (
                  <ArrowUpFromLine className="w-4 h-4 text-[#08D189]" />
                )}
                <h3 className="text-base font-bold text-white">
                  {showSpotVaultModal === 'deposit'
                    ? 'Deposit to DeepBook BalanceManager'
                    : 'Withdraw from BalanceManager'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSpotVaultModal(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {showSpotVaultModal === 'deposit' ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-1.5 bg-[#06070A] p-1 rounded-lg border border-[#323D52]">
                  <button
                    type="button"
                    onClick={() => setDepositCoinSide('quote')}
                    className={`py-1.5 rounded text-xs font-bold transition-colors ${
                      depositCoinSide === 'quote'
                        ? 'bg-[#2B7FFF] text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {activePool.quoteSymbol}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDepositCoinSide('base')}
                    className={`py-1.5 rounded text-xs font-bold transition-colors ${
                      depositCoinSide === 'base'
                        ? 'bg-[#2B7FFF] text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {activePool.baseSymbol}
                  </button>
                </div>

                <div className="bg-[#06070A] border border-[#323D52] rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>
                      Amount (
                      {depositCoinSide === 'base' ? activePool.baseSymbol : activePool.quoteSymbol})
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (!account?.address) return;
                        const bal =
                          depositCoinSide === 'base'
                            ? readBalanceFromMap(
                                balances,
                                activePool.baseCoinId,
                                activePool.baseDecimals
                              )
                            : readBalanceFromMap(
                                balances,
                                activePool.quoteCoinId,
                                activePool.quoteDecimals
                              );
                        const safe =
                          depositCoinSide === 'base' && activePool.baseSymbol === 'SUI'
                            ? Math.max(0, bal - 0.05)
                            : bal;
                        if (safe > 0) setDepositAmt(safe.toFixed(4));
                      }}
                      className="text-[#60A5FA] hover:text-white font-mono"
                    >
                      Wallet:{' '}
                      {account?.address
                        ? (depositCoinSide === 'base'
                            ? readBalanceFromMap(
                                balances,
                                activePool.baseCoinId,
                                activePool.baseDecimals
                              )
                            : readBalanceFromMap(
                                balances,
                                activePool.quoteCoinId,
                                activePool.quoteDecimals
                              )
                          ).toFixed(4)
                        : '0.0000'}{' '}
                      (MAX)
                    </button>
                  </div>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={depositAmt}
                    onChange={(e) => setDepositAmt(e.target.value)}
                    placeholder="10.00"
                    className="w-full bg-transparent text-xl font-bold font-mono text-white outline-none"
                  />
                </div>

                {!managerState && managerIds.length === 0 && (
                  <div className="text-[11px] font-mono text-[#60A5FA] bg-[#2B7FFF]/10 border border-[#2B7FFF]/30 rounded-lg px-3 py-2">
                    No BalanceManager detected — this transaction will create, register, and fund your non-custodial vault in 1 atomic signature.
                  </div>
                )}

                <button
                  type="button"
                  disabled={isVaultBusy || !account || !depositAmt || Number(depositAmt) <= 0}
                  onClick={async () => {
                    await handleDepositManager();
                    setShowSpotVaultModal(null);
                  }}
                  className="w-full py-2.5 rounded-lg btn-deepbook text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-45"
                >
                  {isVaultBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ArrowDownToLine className="w-4 h-4" />
                  )}
                  <span>
                    {!account
                      ? 'Connect Wallet to Deposit'
                      : !managerState && managerIds.length === 0
                        ? `Create Vault & Deposit ${depositCoinSide === 'base' ? activePool.baseSymbol : activePool.quoteSymbol}`
                        : `Deposit ${depositCoinSide === 'base' ? activePool.baseSymbol : activePool.quoteSymbol}`}
                  </span>
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-[#06070A] border border-[#323D52] rounded-lg p-3 space-y-1.5 text-xs font-mono tabular-nums">
                  <div className="flex justify-between text-slate-400">
                    <span>Free {activePool.baseSymbol}</span>
                    <span className="text-white font-bold">{vaultSummary.freeBase.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Free {activePool.quoteSymbol}</span>
                    <span className="text-white font-bold">{vaultSummary.freeQuote.toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Unclaimed Settled</span>
                    <span className="text-[#08D189]">
                      {vaultSummary.settledBase.toFixed(4)} {activePool.baseSymbol} · {vaultSummary.settledQuote.toFixed(4)} {activePool.quoteSymbol}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isVaultBusy || (!managerState && managerIds.length === 0)}
                    onClick={async () => {
                      await handleWithdrawManagerAll(false);
                      setShowSpotVaultModal(null);
                    }}
                    className="w-full py-2.5 rounded-lg btn-deepbook text-xs font-bold disabled:opacity-45"
                  >
                    Withdraw Free &amp; Settled
                  </button>
                  <button
                    type="button"
                    disabled={isVaultBusy || vaultSummary.openOrders.length === 0}
                    onClick={async () => {
                      await handleWithdrawManagerAll(true);
                      setShowSpotVaultModal(null);
                    }}
                    className="w-full py-2.5 rounded-lg bg-[#F0525E]/15 hover:bg-[#F0525E]/25 border border-[#F0525E]/40 text-xs font-bold text-[#F0525E] disabled:opacity-45"
                  >
                    Cancel All &amp; Withdraw
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <AiCopilotModal
        isOpen={showAiCopilot}
        initialTab="grid"
        onClose={() => setShowAiCopilot(false)}
        defaultPool={activePool}
        defaultCandles={candles}
        marginPosition={null}
        marginRiskConfig={null}
        onNotify={onNotify}
        onDeployed={async () => {
          await Promise.all([refreshDeepBookAccount(), refreshBalances()]);
        }}
      />
    </div>
  );
};
