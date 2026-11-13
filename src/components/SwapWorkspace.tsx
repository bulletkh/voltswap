import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  buildWithdrawAllManagerTx,
  DEFAULT_DEEPBOOK_POOLS,
  discoverBalanceManagers,
  fetchDeepBookCandles,
  fetchDeepBookManagerState,
  fetchDeepBookOrderbook,
  fetchDeepBookPools,
  fetchDeepBookTrades,
  type DeepBookCandle,
  type DeepBookManagerState,
  type DeepBookOrderbook,
  type DeepBookPoolMeta,
  type DeepBookTrade,
} from '../deepbookV3';
import { ProCandleChart, type ChartTimeframe } from './ProCandleChart';
import {
  DeepBookMarginAccountBar,
  DeepBookMarginTicket,
  loadMarginWorkspaceData,
} from './DeepBookMarginPanel';
import {
  filterMarginEnabledPools,
  type MarginManagerPosition,
  type MarginPoolRiskConfig,
} from '../deepbookMargin';
import type { PnlTradeData } from '../PnlShareModal';

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
  const [showMarketChart, setShowMarketChart] = useState(false);
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
  const [orderbook, setOrderbook] = useState<DeepBookOrderbook>({
    bids: [],
    asks: [],
    midPrice: 0,
    spreadPct: 0,
  });
  const [trades, setTrades] = useState<DeepBookTrade[]>([]);
  const [bookTab, setBookTab] = useState<'book' | 'trades'>('book');

  const [managerIds, setManagerIds] = useState<string[]>([]);
  const [managerState, setManagerState] = useState<DeepBookManagerState | null>(null);
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

  const marginPools = useMemo(() => filterMarginEnabledPools(pools), [pools]);

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

  // Load DeepBook v3 Pools once
  useEffect(() => {
    fetchDeepBookPools().then((list) => {
      setPools(list);
      setActivePool((curr) => list.find((p) => p.poolName === curr.poolName) || list[0]);
    });
  }, []);

  // Load DeepBook Candles (needed in Limit/Margin mode OR when Market chart toggle is on)
  const chartPoolName = useMemo(() => {
    if (mode !== 'market') return activePool.poolName;
    const pair1 = `${fromToken.symbol.toUpperCase()}_${toToken.symbol.toUpperCase()}`;
    const pair2 = `${toToken.symbol.toUpperCase()}_${fromToken.symbol.toUpperCase()}`;
    const found = pools.find((p) => p.poolName === pair1 || p.poolName === pair2);
    return found?.poolName || 'SUI_USDC';
  }, [mode, activePool.poolName, fromToken.symbol, toToken.symbol, pools]);

  useEffect(() => {
    if (mode === 'market' && !showMarketChart) return;
    let cancelled = false;
    setCandlesLoading(true);
    fetchDeepBookCandles(chartPoolName, timeframe, 120)
      .then((c) => {
        if (!cancelled) setCandles(c);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setCandlesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chartPoolName, timeframe, mode, showMarketChart]);

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

  // Discover & sync DeepBook v3 BalanceManager + Open Orders
  const refreshDeepBookAccount = useCallback(async () => {
    if (!account?.address || mode !== 'limit') {
      setManagerIds([]);
      setManagerState(null);
      return;
    }
    try {
      const ids = await discoverBalanceManagers(account.address);
      setManagerIds(ids);
      if (ids.length > 0) {
        const state = await fetchDeepBookManagerState(account.address, ids[0], activePool);
        setManagerState(state);
      } else {
        setManagerState(null);
      }
    } catch {
      // ignore transient errors
    }
  }, [account?.address, mode, activePool]);

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
        managerId: managerIds[0] || null,
        pool: activePool,
        price: p,
        quantity: q,
        isBid: limitSide === 'buy',
        postOnly,
        existingManagerDepositCoin: existingDep,
        payWithDeep: (managerState?.deepBalance ?? 0) >= 0.5,
        feeMist,
        refSharePct: refTier.revSharePct,
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

  const handleCancelOrder = async (orderId: string) => {
    if (!account?.address || !managerIds[0]) return;
    setIsVaultBusy(true);
    try {
      const tx = buildCancelDeepBookOrderTx({
        owner: account.address,
        managerId: managerIds[0],
        poolName: activePool.poolName,
        orderId,
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

  const handleDepositManager = async () => {
    if (!account?.address || !managerIds[0]) return;
    const amt = Number(depositAmt);
    if (!Number.isFinite(amt) || amt <= 0) return;
    const coinKey = depositCoinSide === 'base' ? activePool.baseSymbol : activePool.quoteSymbol;
    setIsVaultBusy(true);
    try {
      const tx = buildDepositManagerTx({
        owner: account.address,
        managerId: managerIds[0],
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

  const handleWithdrawManagerAll = async () => {
    if (!account?.address || !managerIds[0]) return;
    setIsVaultBusy(true);
    try {
      const tx = buildWithdrawAllManagerTx({
        owner: account.address,
        managerId: managerIds[0],
        poolName: activePool.poolName,
        coinKeys: [activePool.baseSymbol, activePool.quoteSymbol],
      });
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      onNotify(
        'success',
        'Withdrawn to Wallet',
        `Settled and free ${activePool.baseSymbol}/${activePool.quoteSymbol} moved to your wallet.`,
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

  return (
    <div className="w-full space-y-4">
      {/* Sub-navigation bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center p-1.5 rounded-2xl panel-carbon gap-1">
          <button
            type="button"
            onClick={() => setMode('market')}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
              mode === 'market'
                ? 'bg-[#00E0B8]/20 text-[#2AF5D2] border border-[#00E0B8]/40 shadow-[0_0_16px_rgba(0,224,184,0.16)]'
                : 'text-slate-300 hover:text-white border border-transparent'
            }`}
          >
            Swap
          </button>
          <button
            type="button"
            onClick={() => setMode('limit')}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
              mode === 'limit'
                ? 'bg-[#00E0B8]/20 text-[#2AF5D2] border border-[#00E0B8]/40 shadow-[0_0_16px_rgba(0,224,184,0.16)]'
                : 'text-slate-300 hover:text-white border border-transparent'
            }`}
          >
            <span>Limit</span>
            <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-white/[0.08] text-slate-200">
              DeepBook v3
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMode('margin')}
            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
              mode === 'margin'
                ? 'bg-[#00E0B8]/20 text-[#2AF5D2] border border-[#00E0B8]/40 shadow-[0_0_16px_rgba(0,224,184,0.16)]'
                : 'text-slate-300 hover:text-white border border-transparent'
            }`}
          >
            <span>Margin</span>
            <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-[#00E0B8]/15 text-[#2AF5D2]">
              4.5x CLOB
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2.5 text-xs sm:text-sm font-mono text-slate-300">
          <span className="px-3.5 py-2 rounded-xl panel-carbon">
            {traderTier.badgeEmoji} <span className="text-white font-semibold">{traderTier.name}</span> ·{' '}
            <span className="text-[#2AF5D2] font-bold">{(traderTier.feeRate * 100).toFixed(2)}%</span>
          </span>
          {activeReferrer && (
            <span className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#00D98B]/15 border border-[#00D98B]/30 text-[#00E599] font-semibold">
              <CheckCircle2 className="w-4 h-4" />
              Ref Split Active
            </span>
          )}
        </div>
      </div>

      {/* MODE 1: CETUS-PRO CLEAN MARKET SWAP */}
      {mode === 'market' && (
        <div
          className={`grid gap-5 items-start ${
            showMarketChart ? 'grid-cols-1 lg:grid-cols-12' : 'grid-cols-1'
          }`}
        >
          {showMarketChart && (
            <div className="lg:col-span-7 xl:col-span-8">
              <ProCandleChart
                symbolLabel={`${chartPoolName.replace('_', ' / ')}`}
                sourceLabel="DeepBook v3 Feed"
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
                : 'w-full max-w-[500px] mx-auto pt-3'
            }
          >
            <div className="panel-carbon rounded-2xl p-5 space-y-3.5">
              {/* Top Controls */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-base font-bold text-white">Swap</span>
                  <span className="text-xs font-mono text-[#2AF5D2] px-2.5 py-0.5 rounded-lg bg-[#00E0B8]/15 border border-[#00E0B8]/30">
                    Cetus + Aftermath
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowMarketChart((v) => !v)}
                    className={`p-2 rounded-xl border text-xs transition-all ${
                      showMarketChart
                        ? 'bg-[#00E0B8]/20 border-[#00E0B8]/40 text-[#2AF5D2]'
                        : 'bg-[#0B1017] border-white/[0.1] text-slate-300 hover:text-white'
                    }`}
                    title="Toggle live price chart"
                  >
                    <BarChart2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSettings((v) => !v)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#0B1017] border border-white/[0.1] text-xs font-mono text-slate-200 hover:text-white"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>{slippagePct}%</span>
                  </button>
                </div>
              </div>

              {showSettings && (
                <div className="panel-carbon-sub rounded-xl p-3 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-300">Max Slippage</span>
                  <div className="flex items-center gap-1.5">
                    {[0.1, 0.5, 1.0].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setSlippagePct(v)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-mono ${
                          slippagePct === v
                            ? 'bg-[#00E0B8]/20 text-[#2AF5D2] border border-[#00E0B8]/40 font-semibold'
                            : 'bg-white/[0.06] text-slate-300 hover:text-white'
                        }`}
                      >
                        {v}%
                      </button>
                    ))}
                    <div className="flex items-center bg-white/[0.06] rounded-lg px-2 py-1 border border-white/[0.08]">
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
                        className="w-12 bg-transparent text-right text-xs font-mono text-white outline-none"
                      />
                      <span className="text-xs font-mono text-slate-400 ml-0.5">%</span>
                    </div>
                  </div>
                </div>
              )}

              {/* You Pay */}
              <div className="panel-carbon-sub rounded-2xl p-4 space-y-2.5">
                <div className="flex items-center justify-between text-xs sm:text-sm text-slate-300">
                  <span className="font-medium">You Pay</span>
                  <div className="flex items-center gap-2 font-mono tabular-nums text-xs">
                    <Wallet className="w-3.5 h-3.5 text-slate-400" />
                    <span>{fromBal.toFixed(fromToken.decimals > 6 ? 4 : 2)}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setAmountIn((fromBal * 0.5).toFixed(fromToken.decimals > 6 ? 4 : 2))
                      }
                      className="px-2 py-0.5 rounded-md bg-white/[0.08] hover:bg-white/[0.15] text-xs text-white font-semibold"
                    >
                      HALF
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const maxAmt = fromToken.symbol === 'SUI' ? Math.max(0, fromBal - 0.05) : fromBal;
                        setAmountIn(maxAmt.toFixed(fromToken.decimals > 6 ? 4 : 2));
                      }}
                      className="px-2 py-0.5 rounded-md bg-[#00E0B8]/20 hover:bg-[#00E0B8]/30 text-xs text-[#2AF5D2] font-bold"
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
                    className="w-full bg-transparent text-2xl sm:text-3xl font-mono tabular-nums font-bold text-white outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setTokenQuery('');
                      setTokenPickerFor('from');
                    }}
                    className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#161E29] hover:bg-[#1E2837] border border-white/[0.12] text-sm font-bold text-white transition-colors"
                  >
                    <img
                      src={fromToken.logo}
                      alt={fromToken.symbol}
                      className="w-6 h-6 rounded-full"
                    />
                    <span>{fromToken.symbol}</span>
                    <ChevronDown className="w-4 h-4 text-slate-300" />
                  </button>
                </div>
              </div>

              {/* Flip */}
              <div className="flex justify-center -my-2 relative z-10">
                <button
                  type="button"
                  onClick={() => {
                    setFromToken(toToken);
                    setToToken(fromToken);
                  }}
                  className="p-2.5 rounded-xl bg-[#151D27] border border-white/[0.12] text-white hover:text-[#2AF5D2] hover:border-[#00E0B8]/45 transition-colors shadow-lg"
                >
                  <ArrowDownUp className="w-4 h-4" />
                </button>
              </div>

              {/* You Receive */}
              <div className="panel-carbon-sub rounded-2xl p-4 space-y-2.5">
                <div className="flex items-center justify-between text-xs sm:text-sm text-slate-300">
                  <span className="font-medium">You Receive</span>
                  <div className="flex items-center gap-2 font-mono tabular-nums text-xs">
                    <Wallet className="w-3.5 h-3.5 text-slate-400" />
                    <span>{toBal.toFixed(toToken.decimals > 6 ? 4 : 2)}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-2xl sm:text-3xl font-mono tabular-nums font-bold text-white truncate">
                    {isQuoting ? (
                      <span className="text-slate-400 text-lg">Quoting...</span>
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
                    className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#161E29] hover:bg-[#1E2837] border border-white/[0.12] text-sm font-bold text-white transition-colors"
                  >
                    <img src={toToken.logo} alt={toToken.symbol} className="w-6 h-6 rounded-full" />
                    <span>{toToken.symbol}</span>
                    <ChevronDown className="w-4 h-4 text-slate-300" />
                  </button>
                </div>
              </div>

              {/* Route & Fee Details */}
              <div className="panel-carbon-sub rounded-2xl p-3.5 space-y-2 text-xs font-mono">
                <div className="flex items-center justify-between gap-2 text-slate-300">
                  <span>Best Aggregator</span>
                  <div className="flex items-center gap-2">
                    {quote ? (
                      <>
                        <span className="px-2 py-0.5 rounded-md bg-[#00E0B8]/15 text-[#2AF5D2] border border-[#00E0B8]/30 text-xs font-bold">
                          {quote.provider === 'Cetus' ? 'Cetus (incl. Bluefin)' : 'Aftermath Router'}
                        </span>
                        {quote.savingsPct > 0.001 && (
                          <span className="text-xs font-bold text-[#00E599]">
                            +{quote.savingsPct.toFixed(2)}%
                          </span>
                        )}
                      </>
                    ) : (
                      <span>—</span>
                    )}
                  </div>
                </div>
                <div className="flex justify-between text-slate-300">
                  <span>DEX Hops</span>
                  <span className="text-white truncate max-w-[240px]">
                    {quote ? quote.dexHops.join(' + ') : '—'}
                  </span>
                </div>
                {quote && quote.alternatives.some((a) => a.amountOutAtomic > 0n) && (
                  <div className="flex items-center justify-between gap-2 pt-0.5 text-xs text-slate-400">
                    <span>Quotes Race</span>
                    <div className="flex items-center gap-2.5 tabular-nums">
                      {quote.alternatives.map((alt) => (
                        <span
                          key={alt.provider}
                          className={
                            alt.provider === quote.provider
                              ? 'text-[#00E599] font-semibold'
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
                <div className="flex justify-between text-slate-300">
                  <span>Volt Tier Fee ({traderTier.name})</span>
                  <span className="text-[#2AF5D2] font-semibold tabular-nums">
                    {(traderTier.feeRate * 100).toFixed(2)}%
                    {activeReferrer ? ` (${Math.round(refTier.revSharePct * 100)}% → Ref)` : ''}
                  </span>
                </div>
                {quote && (
                  <div className="flex justify-between text-slate-300">
                    <span>Price Impact</span>
                    <span
                      className={`tabular-nums font-semibold ${
                        quote.priceImpactPct > 2 ? 'text-amber-400' : 'text-[#00E599]'
                      }`}
                    >
                      {quote.priceImpactPct.toFixed(2)}%
                    </span>
                  </div>
                )}
              </div>

              {quoteError && (
                <div className="text-xs text-[#FF4D6A] bg-[#F6465D]/15 border border-[#F6465D]/35 rounded-xl px-3.5 py-2.5">
                  {quoteError}
                </div>
              )}

              <button
                type="button"
                disabled={isSwapping || isQuoting || !quote}
                onClick={executeMarketSwap}
                className="w-full py-3.5 rounded-2xl btn-deepbook disabled:bg-white/[0.08] disabled:text-slate-400 disabled:shadow-none font-bold text-base transition-all flex items-center justify-center gap-2"
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
      )}

      {/* MODE 2 & 3: WIDESCREEN DEEPBOOK v3 CLOB (PRO LIMIT + MARGIN TRADING) */}
      {(mode === 'limit' || mode === 'margin') && (
        <div className="space-y-3.5">
          {/* DeepBook v3 Pool Ribbon */}
          <div className="panel-carbon rounded-2xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {(mode === 'margin' && marginPools.length > 0 ? marginPools : pools).map((pool) => (
                <button
                  key={pool.poolName}
                  type="button"
                  onClick={() => {
                    setActivePool(pool);
                    setLimitPrice('');
                    setSelectedBookPrice('');
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs sm:text-sm font-mono whitespace-nowrap transition-all ${
                    activePool.poolName === pool.poolName
                      ? 'bg-[#00E0B8]/20 text-[#2AF5D2] border border-[#00E0B8]/40 font-bold'
                      : 'text-slate-300 hover:text-white hover:bg-white/[0.06] border border-transparent'
                  }`}
                >
                  {pool.baseSymbol}/{pool.quoteSymbol}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-5 text-xs sm:text-sm font-mono tabular-nums">
              <div>
                <span className="text-slate-400 mr-1.5">Mid:</span>
                <span className="text-white font-bold">
                  {orderbook.midPrice > 0 ? orderbook.midPrice.toFixed(4) : '—'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 mr-1.5">Spread:</span>
                <span className="text-slate-200">{orderbook.spreadPct.toFixed(3)}%</span>
              </div>
              {mode === 'margin' && marginRiskConfig && (
                <>
                  <div>
                    <span className="text-slate-400 mr-1.5">Max Lev:</span>
                    <span className="text-[#2AF5D2] font-bold">
                      {marginRiskConfig.maxLeverageSafe.toFixed(1)}x
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 mr-1.5">Borrow APR:</span>
                    <span className="text-white">
                      {marginRiskConfig.quoteBorrowAprPct.toFixed(2)}%
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Full-Width 12-Column DeepBook CLOB Workspace (Wide Chart + L2 Book + Ticket) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-stretch">
            {/* Left: Wide Real DeepBook Candlestick Chart */}
            <div className="lg:col-span-6 xl:col-span-7">
              <ProCandleChart
                symbolLabel={`${activePool.baseSymbol}/${activePool.quoteSymbol}`}
                sourceLabel={mode === 'margin' ? 'DeepBook v3 Margin' : 'DeepBook v3 CLOB'}
                candles={candles}
                timeframe={timeframe}
                onTimeframeChange={setTimeframe}
                isLoading={candlesLoading}
                heightClass="h-[420px] lg:h-[520px] xl:h-[560px]"
                livePrice={orderbook.midPrice}
              />
            </div>

            {/* Middle: Compact Live L2 Orderbook & Trades */}
            <div className="lg:col-span-3 xl:col-span-2 panel-carbon rounded-2xl flex flex-col overflow-hidden h-[480px] lg:h-[572px] xl:h-[612px]">
              <div className="px-3.5 py-2.5 border-b border-white/[0.08] flex items-center gap-2 bg-[#0F151E]">
                <button
                  type="button"
                  onClick={() => setBookTab('book')}
                  className={`text-xs font-bold px-2.5 py-1 rounded-lg ${
                    bookTab === 'book'
                      ? 'bg-[#00E0B8]/20 text-[#2AF5D2]'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Order Book
                </button>
                <button
                  type="button"
                  onClick={() => setBookTab('trades')}
                  className={`text-xs font-bold px-2.5 py-1 rounded-lg ${
                    bookTab === 'trades'
                      ? 'bg-[#00E0B8]/20 text-[#2AF5D2]'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Trades
                </button>
              </div>

              {bookTab === 'book' ? (
                <div className="flex-1 flex flex-col justify-between p-2.5 text-xs font-mono tabular-nums overflow-hidden">
                  <div className="grid grid-cols-3 text-slate-400 px-1 pb-1 text-xs">
                    <span>Price</span>
                    <span className="text-right">Size</span>
                    <span className="text-right">Total</span>
                  </div>

                  {/* Asks */}
                  <div className="space-y-0.5 overflow-hidden">
                    {orderbook.asks.slice(-10).map((lv, idx) => {
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
                          className="relative w-full grid grid-cols-3 px-1.5 py-0.5 rounded hover:bg-white/[0.05] text-left"
                        >
                          <div
                            className="absolute inset-y-0 right-0 bg-[#F6465D]/20 pointer-events-none"
                            style={{ width: `${pct}%` }}
                          />
                          <span className="relative text-[#FF4D6A] font-semibold">{lv.price.toFixed(4)}</span>
                          <span className="relative text-right text-white">{lv.size.toFixed(1)}</span>
                          <span className="relative text-right text-slate-300">
                            {lv.totalSize.toFixed(0)}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Spread Mid */}
                  <div className="py-1.5 px-2.5 my-1 rounded-xl bg-[#0B1017] border border-white/[0.08] flex items-center justify-between">
                    <span className="text-sm font-bold text-white">
                      {orderbook.midPrice > 0 ? orderbook.midPrice.toFixed(4) : '—'}
                    </span>
                    <span className="text-xs text-slate-300">
                      {orderbook.spreadPct.toFixed(2)}%
                    </span>
                  </div>

                  {/* Bids */}
                  <div className="space-y-0.5 overflow-hidden">
                    {orderbook.bids.slice(0, 10).map((lv, idx) => {
                      const maxTotal = orderbook.bids[Math.min(9, orderbook.bids.length - 1)]?.totalSize || 1;
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
                          className="relative w-full grid grid-cols-3 px-1.5 py-0.5 rounded hover:bg-white/[0.05] text-left"
                        >
                          <div
                            className="absolute inset-y-0 right-0 bg-[#00D98B]/20 pointer-events-none"
                            style={{ width: `${pct}%` }}
                          />
                          <span className="relative text-[#00E599] font-semibold">{lv.price.toFixed(4)}</span>
                          <span className="relative text-right text-white">{lv.size.toFixed(1)}</span>
                          <span className="relative text-right text-slate-300">
                            {lv.totalSize.toFixed(0)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex-1 p-2.5 overflow-y-auto text-xs font-mono tabular-nums space-y-1">
                  <div className="grid grid-cols-3 text-slate-400 px-1 pb-1">
                    <span>Price</span>
                    <span className="text-right">Size</span>
                    <span className="text-right">Time</span>
                  </div>
                  {trades.map((tr) => (
                    <div key={tr.tradeId} className="grid grid-cols-3 px-1 py-0.5">
                      <span className={tr.type === 'buy' ? 'text-[#00E599] font-semibold' : 'text-[#FF4D6A] font-semibold'}>
                        {tr.price.toFixed(4)}
                      </span>
                      <span className="text-right text-white">{tr.baseVolume.toFixed(1)}</span>
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

            {/* Right: Either Spot Limit Ticket OR DeepBook v3 Margin Trading Ticket */}
            <div className="lg:col-span-3">
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
                <div className="panel-carbon rounded-2xl p-4 flex flex-col justify-between gap-3.5 h-full">
                  <div className="space-y-3.5">
                    <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#0B1017] border border-white/[0.08]">
                      <button
                        type="button"
                        onClick={() => setLimitSide('buy')}
                        className={`py-2.5 rounded-lg text-sm font-bold transition-colors ${
                          limitSide === 'buy'
                            ? 'bg-[#00D98B] text-[#04120F] shadow-[0_0_16px_rgba(0,217,139,0.28)]'
                            : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        Buy {activePool.baseSymbol}
                      </button>
                      <button
                        type="button"
                        onClick={() => setLimitSide('sell')}
                        className={`py-2.5 rounded-lg text-sm font-bold transition-colors ${
                          limitSide === 'sell'
                            ? 'bg-[#F6465D] text-white shadow-[0_0_16px_rgba(246,70,93,0.28)]'
                            : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        Sell {activePool.baseSymbol}
                      </button>
                    </div>

                    {/* Price */}
                    <div className="panel-carbon-sub rounded-xl p-3 space-y-1.5">
                      <div className="flex justify-between text-xs text-slate-300">
                        <span>Limit Price</span>
                        <button
                          type="button"
                          onClick={() => orderbook.midPrice > 0 && setLimitPrice(orderbook.midPrice.toFixed(4))}
                          className="text-[#2AF5D2] font-mono font-semibold hover:underline"
                        >
                          Mid {orderbook.midPrice > 0 ? orderbook.midPrice.toFixed(4) : ''}
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
                        <span className="text-xs font-mono text-slate-400">{activePool.quoteSymbol}</span>
                      </div>
                    </div>

                    {/* Quantity */}
                    <div className="panel-carbon-sub rounded-xl p-3 space-y-2">
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
                      <div className="grid grid-cols-4 gap-1.5 pt-1">
                        {[0.25, 0.5, 0.75, 1].map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            onClick={() => {
                              const px = Number(limitPrice) || orderbook.midPrice || 1;
                              if (limitSide === 'buy') {
                                const totalQuote =
                                  limitWalletQuoteBal + (managerState?.quoteBalance ?? 0);
                                setLimitQty(((totalQuote * pct * 0.98) / px).toFixed(2));
                              } else {
                                const totalBase =
                                  Math.max(0, limitWalletBaseBal - (activePool.baseSymbol === 'SUI' ? 0.08 : 0)) +
                                  (managerState?.baseBalance ?? 0);
                                setLimitQty((totalBase * pct * 0.98).toFixed(2));
                              }
                            }}
                            className="py-1.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] text-xs font-mono text-slate-300"
                          >
                            {Math.round(pct * 100)}%
                          </button>
                        ))}
                      </div>
                    </div>

                    <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
                      <span>Post-Only (Maker Rebate)</span>
                      <input
                        type="checkbox"
                        checked={postOnly}
                        onChange={(e) => setPostOnly(e.target.checked)}
                        className="accent-[#00E0B8] w-4 h-4"
                      />
                    </label>

                    <div className="text-xs font-mono space-y-1.5 text-slate-300 pt-1">
                      <div className="flex justify-between">
                        <span>Order Total</span>
                        <span className="text-white font-semibold tabular-nums">
                          {((Number(limitPrice) || 0) * (Number(limitQty) || 0)).toFixed(4)}{' '}
                          {activePool.quoteSymbol}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Volt Fee ({traderTier.name})</span>
                        <span className="text-[#2AF5D2] font-semibold">{(traderTier.feeRate * 100).toFixed(2)}%</span>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isPlacingLimit}
                      onClick={executePlaceLimit}
                      className={`w-full py-3.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 ${
                        limitSide === 'buy'
                          ? 'bg-gradient-to-r from-[#00E0B8] to-[#00C2FF] text-[#041214] shadow-[0_0_20px_rgba(0,224,184,0.28)]'
                          : 'bg-[#F6465D] hover:bg-[#FF5B72] text-white shadow-[0_0_20px_rgba(246,70,93,0.28)]'
                      } disabled:opacity-50`}
                    >
                      {isPlacingLimit && <Loader2 className="w-4 h-4 animate-spin" />}
                      <span>
                        {managerIds.length === 0
                          ? `Create Vault & Place ${limitSide === 'buy' ? 'Buy' : 'Sell'}`
                          : `Place Limit ${limitSide === 'buy' ? 'Buy' : 'Sell'}`}
                      </span>
                    </button>
                  </div>

                  {/* DeepBook BalanceManager Custody Summary */}
                  <div className="panel-carbon-sub rounded-xl p-3 space-y-2 border-t border-white/[0.1]">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-300 flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-[#2AF5D2]" />
                        <span>DeepBook BalanceManager</span>
                      </span>
                      <span className="font-mono text-white">
                        {managerIds[0] ? `${managerIds[0].slice(0, 6)}...` : '1-Tx Auto'}
                      </span>
                    </div>

                    {managerState && (
                      <>
                        <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
                          <div className="bg-[#121821] rounded-lg px-2.5 py-1.5 border border-white/[0.08]">
                            <div className="text-slate-400">{activePool.baseSymbol}</div>
                            <div className="text-white font-semibold">{managerState.baseBalance.toFixed(4)}</div>
                          </div>
                          <div className="bg-[#121821] rounded-lg px-2.5 py-1.5 border border-white/[0.08]">
                            <div className="text-slate-400">{activePool.quoteSymbol}</div>
                            <div className="text-white font-semibold">{managerState.quoteBalance.toFixed(4)}</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <select
                            value={depositCoinSide}
                            onChange={(e) => setDepositCoinSide(e.target.value as 'base' | 'quote')}
                            className="bg-[#121821] border border-white/[0.12] rounded-lg px-2 py-1.5 text-xs font-mono text-white outline-none"
                          >
                            <option value="quote">{activePool.quoteSymbol}</option>
                            <option value="base">{activePool.baseSymbol}</option>
                          </select>
                          <input
                            type="number"
                            placeholder="Amt"
                            value={depositAmt}
                            onChange={(e) => setDepositAmt(e.target.value)}
                            className="w-full min-w-0 bg-[#121821] border border-white/[0.12] rounded-lg px-2.5 py-1.5 text-xs font-mono text-white outline-none"
                          />
                          <button
                            type="button"
                            disabled={isVaultBusy || !depositAmt}
                            onClick={handleDepositManager}
                            className="px-2.5 py-1.5 rounded-lg bg-white/[0.1] hover:bg-white/[0.18] text-xs font-semibold text-white shrink-0"
                          >
                            Dep
                          </button>
                          <button
                            type="button"
                            disabled={isVaultBusy}
                            onClick={handleWithdrawManagerAll}
                            className="px-2.5 py-1.5 rounded-lg btn-deepbook text-xs shrink-0"
                            title="Withdraw all & settled funds to wallet"
                          >
                            Withdraw
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Dock: Open Spot Limit Orders OR Isolated Margin Manager Account */}
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
            <div className="panel-carbon rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-white">
                    Open Limit Orders ({managerState?.openOrders.length ?? 0})
                  </span>
                  {managerState && (managerState.settledBase > 0 || managerState.settledQuote > 0) && (
                    <button
                      type="button"
                      onClick={handleWithdrawManagerAll}
                      disabled={isVaultBusy}
                      className="px-3 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-mono"
                    >
                      Claim Settled ({managerState.settledBase.toFixed(4)} {activePool.baseSymbol} /{' '}
                      {managerState.settledQuote.toFixed(4)} {activePool.quoteSymbol})
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  onClick={refreshDeepBookAccount}
                  className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/[0.06]"
                  title="Refresh DeepBook state"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              {!account ? (
                <div className="text-sm text-slate-400 py-4 text-center">
                  Connect your Sui wallet to view open DeepBook v3 limit orders.
                </div>
              ) : !managerState || managerState.openOrders.length === 0 ? (
                <div className="text-sm text-slate-400 py-4 text-center">
                  No open limit orders on {activePool.baseSymbol}/{activePool.quoteSymbol}.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs sm:text-sm font-mono tabular-nums">
                    <thead>
                      <tr className="text-slate-400 border-b border-white/[0.08]">
                        <th className="text-left py-2">Side</th>
                        <th className="text-right py-2">Price ({activePool.quoteSymbol})</th>
                        <th className="text-right py-2">Qty ({activePool.baseSymbol})</th>
                        <th className="text-right py-2">Filled</th>
                        <th className="text-right py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {managerState.openOrders.map((ord) => (
                        <tr key={ord.orderId} className="border-b border-white/[0.04]">
                          <td className={`py-2.5 font-semibold ${ord.isBid ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {ord.isBid ? 'BUY' : 'SELL'}
                          </td>
                          <td className="text-right py-2.5 text-white">{ord.price.toFixed(4)}</td>
                          <td className="text-right py-2.5 text-slate-200">{ord.quantity.toFixed(4)}</td>
                          <td className="text-right py-2.5 text-slate-400">{ord.filledQuantity.toFixed(4)}</td>
                          <td className="text-right py-2.5">
                            <button
                              type="button"
                              disabled={isVaultBusy}
                              onClick={() => handleCancelOrder(ord.orderId)}
                              className="px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 text-xs font-semibold"
                            >
                              Cancel & Settle
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
      )}

      {/* Token Picker Modal */}
      {tokenPickerFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="panel-carbon rounded-2xl w-full max-w-md p-5 space-y-3.5">
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
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#0B1017] border border-white/[0.12] text-sm text-white outline-none focus:border-[#00E0B8]"
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
    </div>
  );
};
