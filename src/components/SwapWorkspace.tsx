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
  Sparkles,
  Bot,
  Search,
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
  getWalletVolumeUsd,
  resolveReferralTier,
  resolveTraderTier,
} from '../voltFee';
import {
  buildCancelDeepBookOrderTx,
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
import {
  DeepBookMarginAccountBar,
  DeepBookMarginTicket,
  loadMarginWorkspaceData,
} from './DeepBookMarginPanel';
import {
  discoverMarginEnabledPoolKeys,
  filterMarginEnabledPools,
  type MarginManagerPosition,
  type MarginPoolRiskConfig,
} from '../deepbookMargin';
import type { PnlTradeData } from '../PnlShareModal';
import { DustSweeperModal } from './DustSweeperModal';
import { AiCopilotModal } from './AiCopilotModal';

export type SwapMode = 'market' | 'limit' | 'margin';

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
  const [showMarketChart, setShowMarketChart] = useState<boolean>(() =>
    typeof window === 'undefined' ? true : window.innerWidth >= 1024
  );
  const [showDustSweeper, setShowDustSweeper] = useState(false);
  const [showAiCopilot, setShowAiCopilot] = useState(false);
  const [tokenPickerFor, setTokenPickerFor] = useState<'from' | 'to' | null>(null);
  const [tokenQuery, setTokenQuery] = useState('');

  const [quote, setQuote] = useState<SmartSwapQuote | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [isSwapping, setIsSwapping] = useState(false);

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
  const [bookTab, setBookTab] = useState<'book' | 'trades'>('book');

  const [managerIds, setManagerIds] = useState<string[]>([]);
  const [managerStates, setManagerStates] = useState<DeepBookManagerState[]>([]);
  const [spotReferrals, setSpotReferrals] = useState<Record<string, VoltSpotReferral>>({});
  const [spotOrderStyle, setSpotOrderStyle] = useState<'market' | 'limit'>('market');
  const [spotMarketSlippage, setSpotMarketSlippage] = useState<number>(1.5);
  const [limitSide, setLimitSide] = useState<'buy' | 'sell'>('buy');
  const [limitPrice, setLimitPrice] = useState<string>('');
  const [limitQty, setLimitQty] = useState<string>('1');
  const [postOnly, setPostOnly] = useState(false);
  const [isPlacingLimit, setIsPlacingLimit] = useState(false);
  const [depositCoinSide, setDepositCoinSide] = useState<'base' | 'quote'>('quote');
  const [depositAmt, setDepositAmt] = useState<string>('');
  const [isVaultBusy, setIsVaultBusy] = useState(false);

  // DeepBook v3 Margin Trading state
  const [marginRiskConfig, setMarginRiskConfig] = useState<MarginPoolRiskConfig | null>(null);
  const [marginPosition, setMarginPosition] = useState<MarginManagerPosition | null>(null);
  const [marginLoading, setMarginLoading] = useState(false);
  const [selectedBookPrice, setSelectedBookPrice] = useState<string>('');
  const [discoveredMarginKeys, setDiscoveredMarginKeys] = useState<string[]>([]);

  // DeepBook Pair Dropdown & Spot Dock tab state
  const [showPoolDropdown, setShowPoolDropdown] = useState(false);
  const [poolSearch, setPoolSearch] = useState('');
  const [poolQuoteFilter, setPoolQuoteFilter] = useState<'all' | 'usdc' | 'sui' | 'bluechip' | 'margin'>('all');
  const [spotDockTab, setSpotDockTab] = useState<'orders' | 'vault'>('orders');
  const poolDropdownRef = useRef<HTMLDivElement>(null);

  const marginPools = useMemo(
    () => filterMarginEnabledPools(pools, discoveredMarginKeys),
    [pools, discoveredMarginKeys]
  );

  const marginPoolNameSet = useMemo(
    () => new Set(marginPools.map((p) => p.poolName)),
    [marginPools]
  );

  useEffect(() => {
    if (mode === 'margin' && marginPools.length > 0) {
      if (!marginPools.some((p) => p.poolName === activePool.poolName)) {
        setActivePool(marginPools[0]);
      }
    }
  }, [mode, marginPools, activePool.poolName]);

  // Tier & Referral
  const walletVolumeUsd = useMemo(() => getWalletVolumeUsd(account?.address), [account?.address]);
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
      discoverMarginEnabledPoolKeys(list)
        .then(setDiscoveredMarginKeys)
        .catch(() => {});
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
    if (mode === 'market') return;
    let cancelled = false;
    const loadBook = async () => {
      try {
        const [ob, tr] = await Promise.all([
          fetchDeepBookOrderbook(activePool.poolName, 14),
          fetchDeepBookTrades(activePool.poolName, 20),
        ]);
        if (!cancelled) {
          setOrderbook(ob);
          setTrades(tr);
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
  }, [mode, activePool.poolName]);

  // Refresh DeepBook Margin state & risk config in Margin mode
  const refreshMarginAccount = useCallback(async () => {
    if (mode !== 'margin') return;
    setMarginLoading(true);
    try {
      const data = await loadMarginWorkspaceData(account?.address, activePool);
      setMarginRiskConfig(data.riskConfig);
      setMarginPosition(data.position);
    } finally {
      setMarginLoading(false);
    }
  }, [account?.address, mode, activePool]);

  useEffect(() => {
    refreshMarginAccount();
  }, [refreshMarginAccount]);

  // Discover & sync DeepBook v3 BalanceManagers + Open Orders
  const refreshDeepBookAccount = useCallback(async () => {
    if (!account?.address || mode !== 'limit') {
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
  }, [account?.address, mode, activePool]);

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
      const tx = await buildBestSwapTx({
        sender: account.address,
        fromCoinType: fromToken.address,
        amountInAtomic: atomic,
        quote,
        slippage: slippagePct / 100,
        refSharePct: refTier.revSharePct,
      });

      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
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
    const q = Number(limitQty);
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
        postOnly,
        existingManagerDepositCoin: existingDep,
        payWithDeep: (managerState?.deepBalance ?? 0) >= 0.5,
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
    const q = Number(limitQty);
    const estPrice =
      limitSide === 'buy'
        ? orderbook.asks[0]?.price || orderbook.midPrice
        : orderbook.bids[0]?.price || orderbook.midPrice;

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
        payWithDeep: false,
        settleToWallet: true,
        feeBps,
        spotReferralId: spotReferrals[activePool.poolName]?.referralId || null,
        existingManagerReferralId: managerState?.referralId || null,
      });

      const sim = await simulateTxBeforeWallet(tx);
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
      await Promise.all([refreshDeepBookAccount(), refreshBalances()]);
    } catch (err: any) {
      onNotify('error', 'Spot Order Rejected', err?.message || 'Transaction rejected by wallet.');
    } finally {
      setIsPlacingLimit(false);
    }
  };

  const handleDepositManager = async () => {
    const targetManagerId = managerState?.managerId || managerIds[0];
    if (!account?.address || !targetManagerId) return;
    const amt = Number(depositAmt);
    if (!Number.isFinite(amt) || amt <= 0) return;
    const coinKey = depositCoinSide === 'base' ? activePool.baseSymbol : activePool.quoteSymbol;
    setIsVaultBusy(true);
    try {
      const tx = buildDepositManagerTx({
        owner: account.address,
        managerId: targetManagerId,
        coinKey,
        amount: amt,
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

  const activeClobPoolList = useMemo(
    () => (mode === 'margin' && marginPools.length > 0 ? marginPools : pools),
    [mode, marginPools, pools]
  );

  const filteredClobPools = useMemo(() => {
    const q = poolSearch.trim().toLowerCase();
    const bluechips = new Set(['SUI', 'XBTC', 'HBTC', 'LZWBTC', 'WBTC', 'BWETH', 'BETH', 'DEEP', 'WAL']);
    return activeClobPoolList.filter((p) => {
      if (poolQuoteFilter === 'usdc' && !['USDC', 'WUSDC', 'USDSUI', 'SUIUSDE', 'AUSD'].includes(p.quoteSymbol)) {
        return false;
      }
      if (poolQuoteFilter === 'sui' && p.quoteSymbol !== 'SUI') return false;
      if (poolQuoteFilter === 'bluechip' && !bluechips.has(p.baseSymbol)) return false;
      if (poolQuoteFilter === 'margin' && !marginPoolNameSet.has(p.poolName)) return false;
      if (!q) return true;
      return (
        p.poolName.toLowerCase().includes(q) ||
        `${p.baseSymbol}/${p.quoteSymbol}`.toLowerCase().includes(q) ||
        p.baseSymbol.toLowerCase().includes(q) ||
        p.quoteSymbol.toLowerCase().includes(q)
      );
    });
  }, [activeClobPoolList, poolQuoteFilter, poolSearch, marginPoolNameSet]);

  return (
    <div className="w-full overflow-x-hidden">
      {/* Sub-navigation bar */}
      <div className="w-full border-b border-[#1A1E26] bg-[#000000] px-3 sm:px-5 py-2 flex flex-wrap items-center justify-between gap-2.5">
        <div className="inline-flex items-center p-0.5 rounded-lg bg-[#06070A] border border-[#1B1F27] gap-1">
          <button
            type="button"
            onClick={() => setMode('market')}
            className={`px-3.5 py-1.5 rounded-md text-xs sm:text-[13px] font-semibold transition-all ${
              mode === 'market'
                ? 'bg-[#2B7FFF] text-white shadow-[0_0_12px_rgba(43,127,255,0.28)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Swap
          </button>
          <button
            type="button"
            onClick={() => setMode('limit')}
            className={`px-3.5 py-1.5 rounded-md text-xs sm:text-[13px] font-semibold transition-all flex items-center gap-1.5 ${
              mode === 'limit'
                ? 'bg-[#2B7FFF] text-white shadow-[0_0_12px_rgba(43,127,255,0.28)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>Spot CLOB</span>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                mode === 'limit' ? 'bg-black/25 text-white' : 'bg-white/[0.06] text-slate-300'
              }`}
            >
              DeepBook v3
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMode('margin')}
            className={`px-3.5 py-1.5 rounded-md text-xs sm:text-[13px] font-semibold transition-all flex items-center gap-1.5 ${
              mode === 'margin'
                ? 'bg-[#2B7FFF] text-white shadow-[0_0_12px_rgba(43,127,255,0.28)]'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span>Margin</span>
            <span
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                mode === 'margin'
                  ? 'bg-black/25 text-white'
                  : 'bg-[#2B7FFF]/15 text-[#60A5FA]'
              }`}
            >
              4.5x CLOB
            </span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-300">
          <button
            type="button"
            onClick={() => setShowDustSweeper(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#06070A] border border-[#1E232D] text-slate-200 hover:border-[#08D189]/55 hover:text-white font-sans font-semibold text-xs transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#08D189]" />
            <span>Sweep Dust</span>
          </button>
          <button
            type="button"
            onClick={() => setShowAiCopilot(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#06070A] border border-[#1E232D] text-slate-200 hover:border-[#2B7FFF]/60 hover:text-white font-sans font-semibold text-xs transition-colors"
          >
            <Bot className="w-3.5 h-3.5 text-[#60A5FA]" />
            <span>AI Copilot</span>
          </button>
          <span className="px-2.5 py-1.5 rounded-md bg-[#06070A] border border-[#1E232D] text-xs">
            {traderTier.badgeEmoji} <span className="text-white font-semibold">{traderTier.name}</span> ·{' '}
            <span className="text-[#60A5FA] font-bold">{(traderTier.feeRate * 100).toFixed(2)}%</span>
          </span>
          {activeReferrer && (
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#08D189]/10 border border-[#08D189]/35 text-[#08D189] font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Ref Split Active
            </span>
          )}
        </div>
      </div>

      {/* MODE 1: INSTITUTIONAL INSTANT SWAP STAGE */}
      {mode === 'market' && (
        <div className="max-w-[1280px] mx-auto px-3 sm:px-6 py-6 animate-panel-in">
          <div
            className={`grid gap-5 items-start ${
              showMarketChart ? 'grid-cols-1 lg:grid-cols-12' : 'grid-cols-1'
            }`}
          >
            {showMarketChart && (
              <div className="lg:col-span-7 xl:col-span-8 bg-[#000000] border border-[#1B1F27] rounded-xl overflow-hidden">
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
                  ? 'lg:col-span-5 xl:col-span-4 w-full'
                  : 'w-full max-w-[460px] mx-auto pt-2'
              }
            >
              <div className="panel-carbon rounded-xl p-4 sm:p-5 space-y-3 border border-[#1B1F27]">
                {/* Top Controls */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-white tracking-tight">Instant Swap</span>
                    <span className="text-[11px] font-mono text-[#60A5FA] px-2 py-0.5 rounded bg-[#2B7FFF]/12 border border-[#2B7FFF]/30">
                      Cetus + Aftermath
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setShowMarketChart((v) => !v)}
                      className={`p-2 rounded-lg border text-xs transition-all ${
                        showMarketChart
                          ? 'bg-[#2B7FFF]/20 border-[#2B7FFF]/50 text-[#60A5FA]'
                          : 'bg-[#0C0E13] border-[#1A1E26] text-slate-400 hover:text-white'
                      }`}
                      title="Toggle live price chart"
                    >
                      <BarChart2 className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowSettings((v) => !v)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0C0E13] border border-[#1A1E26] text-xs font-mono text-slate-300 hover:text-white hover:border-[#2B7FFF]/40 transition-colors"
                    >
                      <SlidersHorizontal className="w-3.5 h-3.5" />
                      <span>{slippagePct}%</span>
                    </button>
                  </div>
                </div>

                {showSettings && (
                  <div className="bg-[#0C0E13] border border-[#1A1E26] rounded-lg p-3 flex items-center justify-between gap-2 animate-panel-in">
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
                              : 'bg-[#12151C] text-slate-300 hover:text-white border border-[#1A1E26]'
                          }`}
                        >
                          {v}%
                        </button>
                      ))}
                      <div className="flex items-center bg-[#000000] rounded px-2 py-1 border border-[#1A1E26] focus-within:border-[#2B7FFF]/60">
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
                <div className="bg-[#0C0E13] border border-[#1A1E26] focus-within:border-[#2B7FFF]/60 rounded-xl p-3.5 space-y-2 transition-colors">
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
                      className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#121620] hover:bg-[#191E2B] border border-[#232938] text-sm font-bold text-white transition-colors"
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
                <div className="bg-[#0C0E13] border border-[#1A1E26] rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="font-medium">You Receive</span>
                    <div className="flex items-center gap-1.5 font-mono tabular-nums text-xs">
                      <Wallet className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-slate-300">{toBal.toFixed(toToken.decimals > 6 ? 4 : 2)}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-2xl sm:text-[26px] font-mono tabular-nums font-bold text-white truncate">
                      {isQuoting ? (
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
                      className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#121620] hover:bg-[#191E2B] border border-[#232938] text-sm font-bold text-white transition-colors"
                    >
                      <img src={toToken.logo} alt={toToken.symbol} className="w-5 h-5 rounded-full" />
                      <span>{toToken.symbol}</span>
                      <ChevronDown className="w-4 h-4 text-slate-400" />
                    </button>
                  </div>
                </div>

                {/* Route & Fee Details */}
                <div className="bg-[#000000] border border-[#1A1E26] rounded-lg p-3 space-y-1.5 text-xs font-mono">
                  <div className="flex items-center justify-between gap-2 text-slate-400">
                    <span>Best Aggregator</span>
                    <div className="flex items-center gap-2">
                      {quote ? (
                        <>
                          <span className="px-2 py-0.5 rounded bg-[#2B7FFF]/15 text-[#60A5FA] border border-[#2B7FFF]/35 text-[11px] font-bold">
                            {quote.provider === 'Cetus' ? 'Cetus (incl. Bluefin)' : 'Aftermath Router'}
                          </span>
                          {quote.savingsPct > 0.001 && (
                            <span className="text-xs font-bold text-[#08D189]">
                              +{quote.savingsPct.toFixed(2)}%
                            </span>
                          )}
                        </>
                      ) : (
                        <span>—</span>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>DEX Hops</span>
                    <span className="text-white truncate max-w-[230px]">
                      {quote ? quote.dexHops.join(' + ') : '—'}
                    </span>
                  </div>
                  {quote && quote.alternatives.some((a) => a.amountOutAtomic > 0n) && (
                    <div className="flex items-center justify-between gap-2 pt-0.5 text-[11px] text-slate-400">
                      <span>Quotes Race</span>
                      <div className="flex items-center gap-2.5 tabular-nums">
                        {quote.alternatives.map((alt) => (
                          <span
                            key={alt.provider}
                            className={
                              alt.provider === quote.provider
                                ? 'text-[#08D189] font-semibold'
                                : 'text-slate-400'
                            }
                          >
                            {alt.provider}:{' '}
                            {alt.amountOutAtomic > 0n
                              ? (Number(alt.amountOutAtomic) / Math.pow(10, toToken.decimals)).toFixed(
                                  toToken.decimals > 6 ? 4 : 3
                                )
                              : 'N/A'}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex justify-between text-slate-400">
                    <span>Volt Tier Fee ({traderTier.name})</span>
                    <span className="text-[#60A5FA] font-semibold tabular-nums">
                      {(traderTier.feeRate * 100).toFixed(2)}%
                      {activeReferrer ? ` (${Math.round(refTier.revSharePct * 100)}% → Ref)` : ''}
                    </span>
                  </div>
                  {quote && (
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
                  )}
                </div>

                {quoteError && (
                  <div className="text-xs text-[#F0525E] bg-[#F0525E]/12 border border-[#F0525E]/35 rounded-lg px-3 py-2">
                    {quoteError}
                  </div>
                )}

                <button
                  type="button"
                  disabled={isSwapping || isQuoting || !quote}
                  onClick={executeMarketSwap}
                  className="w-full py-3.5 rounded-lg btn-deepbook disabled:bg-[#121620] disabled:text-slate-500 disabled:shadow-none font-bold text-sm tracking-wide transition-all flex items-center justify-center gap-2"
                >
                  {isSwapping && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>
                    {!account
                      ? 'Connect Wallet to Swap'
                      : isSwapping
                        ? 'Confirm in Wallet...'
                        : `Swap ${fromToken.symbol} for ${toToken.symbol}`}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODE 2 & 3: FLUSH DEEPBOOK-PRO CLOB TERMINAL (SPOT CLOB + MARGIN 4.5x) */}
      {(mode === 'limit' || mode === 'margin') && (
        <div className="w-full overflow-x-hidden bg-[#000000] border-b border-[#1A1E26] animate-panel-in">
          <div className="w-full grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_265px_325px] xl:grid-cols-[minmax(0,1fr)_290px_345px]">
            {/* Cols 1-2, Row 1: DeepBook Alpha Pair Dropdown + 24h Ticker Strip */}
            <div className="min-w-0 relative z-20 lg:col-start-1 lg:col-span-2 lg:row-start-1 bg-[#000000] border-b border-[#1A1E26] lg:border-r lg:border-[#1A1E26] px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0 flex-wrap" ref={poolDropdownRef}>
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
                        : 'bg-[#06070A] border-[#1E232D] hover:border-[#2B7FFF]/60 text-white'
                    }`}
                  >
                    <PairBadgeIcons pool={activePool} size="md" />
                    <span className="font-bold font-mono tracking-tight">
                      {activePool.baseSymbol}/{activePool.quoteSymbol}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#2B7FFF]/15 text-[#60A5FA] font-semibold">
                      {mode === 'margin'
                        ? `${(marginRiskConfig?.maxLeverageSafe ?? 4.5).toFixed(1)}x`
                        : `${activeClobPoolList.length} Pairs`}
                    </span>
                    <ChevronDown className={`w-3.5 h-3.5 text-[#8E98A8] transition-transform ${showPoolDropdown ? 'rotate-180' : ''}`} />
                  </button>

                  {showPoolDropdown && (
                    <div className="absolute left-0 top-full mt-1.5 w-[310px] sm:w-[490px] bg-[#07090D] border border-[#232834] rounded-lg shadow-2xl p-3 z-50">
                      <div className="relative mb-2.5">
                        <Search className="w-3.5 h-3.5 text-[#8E98A8] absolute left-2.5 top-2.5" />
                        <input
                          type="text"
                          autoFocus
                          value={poolSearch}
                          onChange={(e) => setPoolSearch(e.target.value)}
                          placeholder={
                            mode === 'margin'
                              ? `Search ${activeClobPoolList.length} margin-enabled DeepBook pools...`
                              : `Search ${activeClobPoolList.length} live DeepBook v3 CLOB pairs...`
                          }
                          className="w-full pl-8 pr-3 py-1.5 rounded bg-[#000000] border border-[#1E232D] text-xs font-mono text-white outline-none focus:border-[#2B7FFF]"
                        />
                      </div>

                      <div className="flex flex-wrap gap-1 mb-2.5">
                        {(mode === 'margin'
                          ? [
                              { id: 'all', label: `All (${activeClobPoolList.length})` },
                              { id: 'usdc', label: 'USDC Quote' },
                            ]
                          : [
                              { id: 'all', label: `All (${activeClobPoolList.length})` },
                              { id: 'bluechip', label: 'Bluechips' },
                              { id: 'usdc', label: 'USDC / Stables' },
                              { id: 'sui', label: 'SUI Pairs' },
                              { id: 'margin', label: `Margin (${marginPools.length})` },
                            ]
                        ).map((tab) => (
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

                      <div className="grid grid-cols-12 px-2 pb-1.5 text-[10px] font-mono uppercase text-[#8E98A8] border-b border-[#161A22]">
                        <span className="col-span-5">Market</span>
                        <span className="col-span-3 text-right">Last Price</span>
                        <span className="col-span-2 text-right">24h %</span>
                        <span className="col-span-2 text-right">24h Vol</span>
                      </div>

                      <div className="max-h-72 overflow-y-auto divide-y divide-[#141821]">
                        {filteredClobPools.map((pool) => {
                          const isSelected = pool.poolName === activePool.poolName;
                          const isMarginSupported = marginPoolNameSet.has(pool.poolName);
                          const chg = pool.change24hPct;
                          return (
                            <button
                              key={pool.poolName}
                              type="button"
                              onClick={() => {
                                setActivePool(pool);
                                setLimitPrice('');
                                setSelectedBookPrice('');
                                setShowPoolDropdown(false);
                              }}
                              className={`w-full grid grid-cols-12 items-center px-2 py-2 text-left text-xs font-mono transition-colors ${
                                isSelected ? 'bg-[#2B7FFF]/14' : 'hover:bg-white/[0.04]'
                              }`}
                            >
                              <div className="col-span-5 flex items-center gap-2 min-w-0">
                                <PairBadgeIcons pool={pool} size="sm" />
                                <div className="truncate">
                                  <div className="text-white font-semibold truncate">
                                    {pool.baseSymbol}/{pool.quoteSymbol}
                                  </div>
                                  {isMarginSupported && (
                                    <span className="text-[10px] text-[#60A5FA]">4.5x Margin</span>
                                  )}
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
                  {activeClobPoolList.slice(0, mode === 'margin' ? 6 : 5).map((pool) => {
                    const active = activePool.poolName === pool.poolName;
                    return (
                      <button
                        key={pool.poolName}
                        type="button"
                        onClick={() => {
                          setActivePool(pool);
                          setLimitPrice('');
                          setSelectedBookPrice('');
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
                {mode === 'margin' && marginRiskConfig && (
                  <>
                    <div>
                      <div className="text-[10px] text-[#8E98A8]">Max Lev</div>
                      <div className="text-[#60A5FA] font-bold">
                        {marginRiskConfig.maxLeverageSafe.toFixed(1)}x
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-[#8E98A8]">Borrow APR</div>
                      <div className="text-white">
                        {marginRiskConfig.quoteBorrowAprPct.toFixed(2)}%
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Col 1, Row 2: Wide Real DeepBook Candlestick Chart */}
            <div className="lg:col-start-1 lg:row-start-2 bg-[#000000] border-b lg:border-b-0 lg:border-r border-[#1A1E26] min-w-0">
              <ProCandleChart
                symbolLabel={`${activePool.baseSymbol}/${activePool.quoteSymbol}`}
                sourceLabel={mode === 'margin' ? 'DeepBook v3 Margin' : chartMeta.source}
                candles={candles}
                timeframe={timeframe}
                onTimeframeChange={setTimeframe}
                isLoading={candlesLoading}
                heightClass="h-[430px] lg:h-[520px] xl:h-[550px]"
                livePrice={orderbook.midPrice}
              />
            </div>

            {/* Col 2, Row 2: Compact Live L2 Orderbook & Trades */}
            <div className="min-w-0 lg:col-start-2 lg:row-start-2 bg-[#000000] border-b lg:border-b-0 lg:border-r border-[#1A1E26] flex flex-col overflow-hidden h-[465px] lg:h-[556px] xl:h-[586px]">
              <div className="px-3 border-b border-[#1A1E26] flex items-center gap-4 bg-[#000000] h-9 shrink-0">
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
              </div>

              {bookTab === 'book' ? (
                <div className="flex-1 min-h-0 flex flex-col justify-between p-2 text-[11px] font-mono tabular-nums overflow-hidden">
                  <div className="grid grid-cols-3 text-slate-500 px-1.5 pb-1 text-[11px]">
                    <span>Price</span>
                    <span className="text-right">Size</span>
                    <span className="text-right">Total</span>
                  </div>

                  {/* Asks */}
                  <div className="space-y-0.5 overflow-hidden">
                    {orderbook.asks.slice(-11).map((lv, idx) => {
                      const maxTotal =
                        orderbook.asks[0]?.totalSize || orderbook.asks[orderbook.asks.length - 1]?.totalSize || 1;
                      const pct = Math.min(100, (lv.totalSize / Math.max(1e-9, maxTotal)) * 100);
                      return (
                        <button
                          key={`ask-${idx}`}
                          type="button"
                          onClick={() => {
                            const val = lv.price.toString();
                            setLimitPrice(val);
                            setSelectedBookPrice(val);
                          }}
                          className="relative w-full grid grid-cols-3 px-1.5 py-[2.5px] rounded hover:bg-white/[0.04] text-left transition-colors"
                        >
                          <div
                            className="absolute inset-y-0 right-0 bg-[#F0525E]/15 pointer-events-none"
                            style={{ width: `${pct}%` }}
                          />
                          <span className="relative text-[#F0525E] font-medium">{fmtClobPrice(lv.price)}</span>
                          <span className="relative text-right text-slate-200">{lv.size.toFixed(1)}</span>
                          <span className="relative text-right text-slate-400">
                            {lv.totalSize.toFixed(0)}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Spread Mid */}
                  <div className="py-1.5 px-2 my-1 bg-[#06070A] border-y border-[#1A1E26] flex items-center justify-between">
                    <span className="text-xs font-bold text-white">
                      {orderbook.midPrice > 0 ? fmtClobPrice(orderbook.midPrice) : '—'}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Spread {orderbook.spreadPct.toFixed(2)}%
                    </span>
                  </div>

                  {/* Bids */}
                  <div className="space-y-0.5 overflow-hidden">
                    {orderbook.bids.slice(0, 11).map((lv, idx) => {
                      const maxTotal = orderbook.bids[Math.min(10, orderbook.bids.length - 1)]?.totalSize || 1;
                      const pct = Math.min(100, (lv.totalSize / Math.max(1e-9, maxTotal)) * 100);
                      return (
                        <button
                          key={`bid-${idx}`}
                          type="button"
                          onClick={() => {
                            const val = lv.price.toString();
                            setLimitPrice(val);
                            setSelectedBookPrice(val);
                          }}
                          className="relative w-full grid grid-cols-3 px-1.5 py-[2.5px] rounded hover:bg-white/[0.04] text-left transition-colors"
                        >
                          <div
                            className="absolute inset-y-0 right-0 bg-[#08D189]/15 pointer-events-none"
                            style={{ width: `${pct}%` }}
                          />
                          <span className="relative text-[#08D189] font-medium">{fmtClobPrice(lv.price)}</span>
                          <span className="relative text-right text-slate-200">{lv.size.toFixed(1)}</span>
                          <span className="relative text-right text-slate-400">
                            {lv.totalSize.toFixed(0)}
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

            {/* Col 3, Rows 1-3: Full-Height Order Ticket (Spot CLOB OR DeepBook Margin) */}
            <div className="lg:col-start-3 lg:row-start-1 lg:row-span-3 bg-[#000000] flex flex-col min-w-0">
              {mode === 'margin' ? (
                <DeepBookMarginTicket
                  pool={activePool}
                  midPrice={orderbook.midPrice}
                  selectedBookPrice={selectedBookPrice}
                  balances={balances}
                  feeRate={traderTier.feeRate}
                  refSharePct={refTier.revSharePct}
                  riskConfig={marginRiskConfig}
                  position={marginPosition}
                  onSuccessRefresh={() => {
                    refreshBalances();
                    refreshMarginAccount();
                  }}
                  onNotify={onNotify}
                  onTradeRecorded={onTradeRecorded}
                  onVolumeUpdated={onVolumeUpdated}
                />
              ) : (
                <div className="bg-[#000000] p-3 flex flex-col gap-3">
                  <div className="space-y-3">
                    {/* Spot Order Type Switcher: Market | Limit */}
                    <div className="flex items-center justify-between gap-2 border-b border-[#1A1E26] pb-1.5">
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
                            : 'bg-[#06070A] text-[#94A3B8] hover:text-white border-[#1E232D]'
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
                            : 'bg-[#06070A] text-[#94A3B8] hover:text-white border-[#1E232D]'
                        }`}
                      >
                        SELL {activePool.baseSymbol}
                      </button>
                    </div>

                    {/* Price (Limit editable OR Market live book quote + slippage) */}
                    {spotOrderStyle === 'limit' ? (
                      <div className="bg-[#06070A] border border-[#1E232D] focus-within:border-[#2B7FFF]/60 rounded-lg p-2.5 space-y-1 transition-colors">
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
                      <div className="bg-[#06070A] border border-[#1E232D] rounded-lg p-2.5 space-y-2">
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
                                    : 'bg-[#0C0E13] text-slate-400 hover:text-white border-[#1A1E26]'
                                }`}
                              >
                                {s}%
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Quantity */}
                    <div className="bg-[#06070A] border border-[#1A1E26] focus-within:border-[#2B7FFF]/60 rounded-lg p-2.5 space-y-2 transition-colors">
                      <div className="flex justify-between text-xs text-slate-400">
                        <span>Amount</span>
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
                        <span className="text-xs font-mono text-slate-400">{activePool.baseSymbol}</span>
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
                                const totalQuote =
                                  limitWalletQuoteBal + (managerState?.quoteBalance ?? 0);
                                setLimitQty(((totalQuote * pct * 0.97) / px).toFixed(2));
                              } else {
                                const totalBase =
                                  Math.max(0, limitWalletBaseBal - (activePool.baseSymbol === 'SUI' ? 0.08 : 0)) +
                                  (managerState?.baseBalance ?? 0);
                                setLimitQty((totalBase * pct * 0.98).toFixed(2));
                              }
                            }}
                            className="py-1 rounded bg-[#0C0E13] hover:bg-[#141821] border border-[#1A1E26] text-[11px] font-mono text-slate-300 transition-colors"
                          >
                            {Math.round(pct * 100)}%
                          </button>
                        ))}
                      </div>
                    </div>

                    {spotOrderStyle === 'limit' && (
                      <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                        <span>Post-Only (Maker Rebate)</span>
                        <input
                          type="checkbox"
                          checked={postOnly}
                          onChange={(e) => setPostOnly(e.target.checked)}
                          className="accent-[#2B7FFF] w-4 h-4"
                        />
                      </label>
                    )}

                    <div className="text-xs font-mono space-y-1.5 text-slate-400 pt-1 border-t border-[#1A1E26]">
                      <div className="flex justify-between pt-1">
                        <span>{spotOrderStyle === 'limit' ? 'Order Total' : 'Est. Total'}</span>
                        <span className="text-white font-semibold tabular-nums">
                          {((spotOrderStyle === 'limit'
                            ? Number(limitPrice) || 0
                            : limitSide === 'buy'
                              ? orderbook.asks[0]?.price || orderbook.midPrice
                              : orderbook.bids[0]?.price || orderbook.midPrice) *
                            (Number(limitQty) || 0)
                          ).toFixed(4)}{' '}
                          {activePool.quoteSymbol}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Volt Fee ({traderTier.name})</span>
                        <span className="text-[#60A5FA] font-semibold">{(traderTier.feeRate * 100).toFixed(2)}%</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isPlacingLimit}
                      onClick={spotOrderStyle === 'market' ? executePlaceSpotMarket : executePlaceLimit}
                      className={`w-full py-3 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                        limitSide === 'buy'
                          ? 'btn-deepbook'
                          : 'bg-[#F0525E] hover:bg-[#FF6370] text-white'
                      } disabled:opacity-50`}
                    >
                      {isPlacingLimit && <Loader2 className="w-4 h-4 animate-spin" />}
                      <span>
                        {spotOrderStyle === 'market'
                          ? `Market ${limitSide === 'buy' ? 'Buy' : 'Sell'} ${activePool.baseSymbol}`
                          : managerIds.length === 0
                            ? `Create Vault & Place ${limitSide === 'buy' ? 'Buy' : 'Sell'}`
                            : `Place Limit ${limitSide === 'buy' ? 'Buy' : 'Sell'}`}
                      </span>
                    </button>
                  </div>

                  {/* Compact BalanceManager Status Link (Full Deposit/Withdraw Dock Below) */}
                  <div className="bg-[#06070A] border border-[#1E232D] rounded-lg px-2.5 py-2 flex items-center justify-between gap-2 text-xs">
                    <div className="min-w-0 flex items-center gap-2">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#60A5FA] shrink-0" />
                      <div className="truncate">
                        <div className="text-slate-200 font-semibold truncate">
                          BalanceManager{' '}
                          <span className="text-[#8E98A8] font-mono font-normal">
                            ({managerIds.length > 1 ? `${managerIds.length} Vaults` : managerIds[0] ? `${managerIds[0].slice(0, 6)}...` : '1-Tx Auto'})
                          </span>
                        </div>
                        {managerState && (
                          <div className="text-[11px] font-mono text-[#8E98A8] tabular-nums">
                            Free: {vaultSummary.freeBase.toFixed(3)} {activePool.baseSymbol} · {vaultSummary.freeQuote.toFixed(2)} {activePool.quoteSymbol}
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSpotDockTab('vault')}
                      className="px-2 py-1 rounded bg-[#0C0E13] hover:bg-[#141821] border border-[#232834] text-[11px] font-mono text-[#60A5FA] shrink-0 transition-colors"
                    >
                      Manage ↓
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Cols 1-2, Row 3: Bottom Dock (Open Spot Limit Orders / BalanceManager Vault OR Isolated Margin Manager Account) */}
            <div className="lg:col-start-1 lg:col-span-2 lg:row-start-3 bg-[#000000] border-t lg:border-r border-[#1A1E26] min-w-0">
              {mode === 'margin' ? (
                <DeepBookMarginAccountBar
                  pool={activePool}
                  position={marginPosition}
                  riskConfig={marginRiskConfig}
                  isLoading={marginLoading}
                  onRefresh={refreshMarginAccount}
                  onNotify={onNotify}
                />
              ) : (
                <div className="p-3.5 sm:p-4 min-h-[210px] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1A1E26] pb-2">
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
                        onClick={() => setSpotDockTab('vault')}
                        className={`pb-1 text-xs font-mono border-b-2 -mb-[9px] transition-colors ${
                          spotDockTab === 'vault'
                            ? 'border-[#2B7FFF] text-white font-semibold'
                            : 'border-transparent text-[#8E98A8] hover:text-white'
                        }`}
                      >
                        BalanceManager Vault ({managerIds.length || 'Auto'})
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

                  {spotDockTab === 'vault' ? (
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center bg-[#06070A] border border-[#1E232D] rounded-lg p-3">
                      <div className="md:col-span-5 space-y-1.5">
                        <div className="flex items-center gap-2 text-xs font-semibold text-white">
                          <ShieldCheck className="w-4 h-4 text-[#60A5FA]" />
                          <span>Shared DeepBook BalanceManager Custody</span>
                        </div>
                        <p className="text-[11px] text-[#8E98A8] leading-snug">
                          Shared across all {pools.length} Spot pairs. Pre-deposit is optional — orders auto-draw from your wallet and Market orders auto-settle back to wallet.
                        </p>
                      </div>

                      <div className="md:col-span-3 grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
                        <div className="bg-[#000000] rounded px-2.5 py-2 border border-[#1E232D]">
                          <div className="text-[#8E98A8] text-[10px]">Free {activePool.baseSymbol}</div>
                          <div className="text-white font-bold">{vaultSummary.freeBase.toFixed(4)}</div>
                        </div>
                        <div className="bg-[#000000] rounded px-2.5 py-2 border border-[#1E232D]">
                          <div className="text-[#8E98A8] text-[10px]">Free {activePool.quoteSymbol}</div>
                          <div className="text-white font-bold">{vaultSummary.freeQuote.toFixed(4)}</div>
                        </div>
                      </div>

                      <div className="md:col-span-4 flex flex-wrap sm:flex-nowrap items-center gap-1.5">
                        <select
                          value={depositCoinSide}
                          onChange={(e) => setDepositCoinSide(e.target.value as 'base' | 'quote')}
                          className="bg-[#000000] border border-[#1E232D] rounded px-2 py-1.5 text-xs font-mono text-white outline-none"
                        >
                          <option value="quote">{activePool.quoteSymbol}</option>
                          <option value="base">{activePool.baseSymbol}</option>
                        </select>
                        <input
                          type="number"
                          placeholder="Amount"
                          value={depositAmt}
                          onChange={(e) => setDepositAmt(e.target.value)}
                          className="w-full min-w-0 bg-[#000000] border border-[#1E232D] focus:border-[#2B7FFF]/60 rounded px-2.5 py-1.5 text-xs font-mono text-white outline-none"
                        />
                        <button
                          type="button"
                          disabled={isVaultBusy || !depositAmt || !managerState}
                          onClick={handleDepositManager}
                          className="px-2.5 py-1.5 rounded bg-[#121620] hover:bg-[#1A202E] border border-[#232938] text-xs font-semibold text-white shrink-0 disabled:opacity-45"
                        >
                          Deposit
                        </button>
                        <button
                          type="button"
                          disabled={isVaultBusy || !managerState}
                          onClick={() => handleWithdrawManagerAll(false)}
                          className="px-2.5 py-1.5 rounded btn-deepbook text-xs shrink-0 disabled:opacity-45"
                          title="Withdraw unlocked & settled funds across all DeepBook vaults to wallet"
                        >
                          Withdraw All
                        </button>
                      </div>
                    </div>
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
                          <tr className="text-[#8E98A8] border-b border-[#1A1E26]">
                            <th className="text-left py-2">Side</th>
                            <th className="text-right py-2">Price ({activePool.quoteSymbol})</th>
                            <th className="text-right py-2">Qty ({activePool.baseSymbol})</th>
                            <th className="text-right py-2">Filled</th>
                            <th className="text-right py-2">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vaultSummary.openOrders.map((ord) => (
                            <tr key={`${ord.managerId || ''}_${ord.orderId}`} className="border-b border-[#1A1E26]/60">
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
              )}
            </div>
          </div>
        </div>
      )}

      {/* Token Picker Modal */}
      {tokenPickerFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="panel-carbon rounded-xl w-full max-w-md p-5 space-y-3.5 border border-[#1B1F27] animate-panel-in">
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
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#0C0E13] border border-[#1A1E26] text-sm text-white outline-none focus:border-[#2B7FFF]"
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

      <DustSweeperModal
        isOpen={showDustSweeper}
        onClose={() => setShowDustSweeper(false)}
        onSuccess={(msg) => {
          onNotify('success', 'Wallet Cleanup Complete', msg);
          refreshBalances();
        }}
      />

      <AiCopilotModal
        isOpen={showAiCopilot}
        initialTab={mode === 'margin' ? 'yield' : 'grid'}
        onClose={() => setShowAiCopilot(false)}
        defaultPool={activePool}
        defaultCandles={candles}
        marginPosition={marginPosition}
        marginRiskConfig={marginRiskConfig}
        onNotify={onNotify}
        onDeployed={async () => {
          await Promise.all([refreshDeepBookAccount(), refreshBalances()]);
        }}
      />
    </div>
  );
};
