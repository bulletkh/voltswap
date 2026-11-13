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
import { buildCetusSwapTx, fetchCetusQuote, type CetusQuoteResult } from '../cetusSwap';
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
import type { PnlTradeData } from '../PnlShareModal';

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

  const [quote, setQuote] = useState<CetusQuoteResult | null>(null);
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
        const q = await fetchCetusQuote({
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

  // Load DeepBook Candles (needed in Limit mode OR when Market chart toggle is on)
  const chartPoolName = useMemo(() => {
    if (mode === 'limit') return activePool.poolName;
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

  // Poll DeepBook L2 Orderbook & Recent Trades in Limit mode
  useEffect(() => {
    if (mode !== 'limit') return;
    let cancelled = false;
    const loadBook = async () => {
      try {
        const [ob, tr] = await Promise.all([
          fetchDeepBookOrderbook(activePool.poolName, 12),
          fetchDeepBookTrades(activePool.poolName, 18),
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
      const tx = await buildCetusSwapTx({
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
    <div className="w-full space-y-3">
      {/* Sub-navigation bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center p-1 rounded-lg bg-[#101318] border border-white/[0.06]">
          <button
            type="button"
            onClick={() => setMode('market')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
              mode === 'market'
                ? 'bg-[#38BDF8]/15 text-[#38BDF8] border border-[#38BDF8]/30'
                : 'text-slate-400 hover:text-white border border-transparent'
            }`}
          >
            Market Swap
          </button>
          <button
            type="button"
            onClick={() => setMode('limit')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 ${
              mode === 'limit'
                ? 'bg-[#38BDF8]/15 text-[#38BDF8] border border-[#38BDF8]/30'
                : 'text-slate-400 hover:text-white border border-transparent'
            }`}
          >
            <span>Pro Limit</span>
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-white/[0.06] text-slate-300">
              DeepBook v3
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <span className="px-2.5 py-1 rounded-md bg-[#101318] border border-white/[0.06]">
            {traderTier.badgeEmoji} {traderTier.name} ·{' '}
            <span className="text-[#38BDF8]">{(traderTier.feeRate * 100).toFixed(2)}%</span>
          </span>
          {activeReferrer && (
            <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <CheckCircle2 className="w-3 h-3" />
              Ref Split Active
            </span>
          )}
        </div>
      </div>

      {/* MODE 1: CETUS-STYLE CLEAN MARKET SWAP */}
      {mode === 'market' && (
        <div
          className={`grid gap-4 items-start ${
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
            <div className="panel-carbon rounded-xl p-4 space-y-3">
              {/* Top Controls */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">Swap</span>
                  <span className="text-[11px] font-mono text-slate-400 px-1.5 py-0.5 rounded bg-white/[0.04]">
                    Cetus Aggregator
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowMarketChart((v) => !v)}
                    className={`p-1.5 rounded-md border text-xs transition-colors ${
                      showMarketChart
                        ? 'bg-[#38BDF8]/15 border-[#38BDF8]/30 text-[#38BDF8]'
                        : 'bg-[#0C0E12] border-white/[0.06] text-slate-400 hover:text-white'
                    }`}
                    title="Toggle live price chart"
                  >
                    <BarChart2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSettings((v) => !v)}
                    className="flex items-center gap-1 px-2 py-1 rounded-md bg-[#0C0E12] border border-white/[0.06] text-xs font-mono text-slate-300 hover:text-white"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>{slippagePct}%</span>
                  </button>
                </div>
              </div>

              {showSettings && (
                <div className="panel-carbon-sub rounded-lg p-2.5 flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-400">Max Slippage</span>
                  <div className="flex items-center gap-1">
                    {[0.1, 0.5, 1.0].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setSlippagePct(v)}
                        className={`px-2 py-1 rounded text-xs font-mono ${
                          slippagePct === v
                            ? 'bg-[#38BDF8] text-[#090B0E] font-semibold'
                            : 'bg-white/[0.04] text-slate-300 hover:text-white'
                        }`}
                      >
                        {v}%
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* You Pay */}
              <div className="panel-carbon-sub rounded-lg p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>You Pay</span>
                  <div className="flex items-center gap-1.5 font-mono tabular-nums">
                    <Wallet className="w-3 h-3" />
                    <span>{fromBal.toFixed(fromToken.decimals > 6 ? 4 : 2)}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setAmountIn((fromBal * 0.5).toFixed(fromToken.decimals > 6 ? 4 : 2))
                      }
                      className="px-1.5 py-0.5 rounded bg-white/[0.05] hover:bg-white/[0.1] text-[10px] text-slate-300"
                    >
                      HALF
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const maxAmt = fromToken.symbol === 'SUI' ? Math.max(0, fromBal - 0.05) : fromBal;
                        setAmountIn(maxAmt.toFixed(fromToken.decimals > 6 ? 4 : 2));
                      }}
                      className="px-1.5 py-0.5 rounded bg-white/[0.05] hover:bg-white/[0.1] text-[10px] text-[#38BDF8]"
                    >
                      MAX
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={amountIn}
                    onChange={(e) => setAmountIn(e.target.value)}
                    placeholder="0.0"
                    className="w-full bg-transparent text-2xl font-mono tabular-nums font-medium text-white outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setTokenQuery('');
                      setTokenPickerFor('from');
                    }}
                    className="shrink-0 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#161B24] hover:bg-[#1E2531] border border-white/[0.08] text-sm font-semibold text-white"
                  >
                    <img
                      src={fromToken.logo}
                      alt={fromToken.symbol}
                      className="w-5 h-5 rounded-full"
                    />
                    <span>{fromToken.symbol}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
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
                  className="p-2 rounded-lg bg-[#101318] border border-white/[0.1] text-slate-300 hover:text-[#38BDF8] hover:border-[#38BDF8]/40 transition-colors"
                >
                  <ArrowDownUp className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* You Receive */}
              <div className="panel-carbon-sub rounded-lg p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span>You Receive</span>
                  <div className="flex items-center gap-1.5 font-mono tabular-nums">
                    <Wallet className="w-3 h-3" />
                    <span>{toBal.toFixed(toToken.decimals > 6 ? 4 : 2)}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-2xl font-mono tabular-nums font-medium text-white truncate">
                    {isQuoting ? (
                      <span className="text-slate-500 text-lg">Quoting...</span>
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
                    className="shrink-0 inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#161B24] hover:bg-[#1E2531] border border-white/[0.08] text-sm font-semibold text-white"
                  >
                    <img src={toToken.logo} alt={toToken.symbol} className="w-5 h-5 rounded-full" />
                    <span>{toToken.symbol}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                </div>
              </div>

              {/* Route & Fee Details */}
              <div className="panel-carbon-sub rounded-lg p-3 space-y-1.5 text-xs font-mono">
                <div className="flex justify-between text-slate-400">
                  <span>Best Route</span>
                  <span className="text-slate-200 truncate max-w-[220px]">
                    {quote ? quote.dexHops.join(' + ') : '—'}
                  </span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Volt Tier Fee ({traderTier.name})</span>
                  <span className="text-[#38BDF8] tabular-nums">
                    {(traderTier.feeRate * 100).toFixed(2)}%
                    {activeReferrer ? ` (${Math.round(refTier.revSharePct * 100)}% → Ref)` : ''}
                  </span>
                </div>
                {quote && (
                  <div className="flex justify-between text-slate-400">
                    <span>Price Impact</span>
                    <span
                      className={`tabular-nums ${
                        quote.priceImpactPct > 2 ? 'text-amber-400' : 'text-emerald-400'
                      }`}
                    >
                      {quote.priceImpactPct.toFixed(2)}%
                    </span>
                  </div>
                )}
              </div>

              {quoteError && (
                <div className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                  {quoteError}
                </div>
              )}

              <button
                type="button"
                disabled={isSwapping || isQuoting || !quote}
                onClick={executeMarketSwap}
                className="w-full py-3 rounded-lg bg-[#38BDF8] hover:bg-[#56CCF9] disabled:bg-white/[0.06] disabled:text-slate-500 text-[#090B0E] font-semibold text-sm transition-colors flex items-center justify-center gap-2"
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

      {/* MODE 2: PRO LIMIT TERMINAL (DEEPBOOK v3 CLOB) */}
      {mode === 'limit' && (
        <div className="space-y-3">
          {/* DeepBook v3 Pool Ribbon */}
          <div className="panel-carbon rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {pools.map((pool) => (
                <button
                  key={pool.poolName}
                  type="button"
                  onClick={() => {
                    setActivePool(pool);
                    setLimitPrice('');
                  }}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-mono whitespace-nowrap transition-colors ${
                    activePool.poolName === pool.poolName
                      ? 'bg-[#38BDF8]/15 text-[#38BDF8] border border-[#38BDF8]/30 font-semibold'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.04] border border-transparent'
                  }`}
                >
                  {pool.baseSymbol}/{pool.quoteSymbol}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-4 text-xs font-mono tabular-nums">
              <div>
                <span className="text-slate-500 mr-1.5">Mid:</span>
                <span className="text-white font-semibold">
                  {orderbook.midPrice > 0 ? orderbook.midPrice.toFixed(4) : '—'}
                </span>
              </div>
              <div>
                <span className="text-slate-500 mr-1.5">Spread:</span>
                <span className="text-slate-300">{orderbook.spreadPct.toFixed(3)}%</span>
              </div>
            </div>
          </div>

          {/* 3-Column DeepBook CLOB Workspace */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
            {/* Left: Real DeepBook Candlestick Chart */}
            <div className="lg:col-span-6">
              <ProCandleChart
                symbolLabel={`${activePool.baseSymbol}/${activePool.quoteSymbol}`}
                sourceLabel="DeepBook v3 CLOB"
                candles={candles}
                timeframe={timeframe}
                onTimeframeChange={setTimeframe}
                isLoading={candlesLoading}
                heightClass="h-[340px] lg:h-[440px]"
                livePrice={orderbook.midPrice}
              />
            </div>

            {/* Middle: Live L2 Orderbook & Trades */}
            <div className="lg:col-span-3 panel-carbon rounded-lg flex flex-col overflow-hidden h-[440px] lg:h-[490px]">
              <div className="px-3 py-2 border-b border-white/[0.06] flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBookTab('book')}
                  className={`text-xs font-semibold px-2 py-1 rounded ${
                    bookTab === 'book' ? 'bg-white/[0.08] text-white' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Order Book
                </button>
                <button
                  type="button"
                  onClick={() => setBookTab('trades')}
                  className={`text-xs font-semibold px-2 py-1 rounded ${
                    bookTab === 'trades'
                      ? 'bg-white/[0.08] text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Recent Trades
                </button>
              </div>

              {bookTab === 'book' ? (
                <div className="flex-1 flex flex-col justify-between p-2 text-[11px] font-mono tabular-nums overflow-hidden">
                  <div className="grid grid-cols-3 text-slate-500 px-1 pb-1">
                    <span>Price ({activePool.quoteSymbol})</span>
                    <span className="text-right">Size</span>
                    <span className="text-right">Total</span>
                  </div>

                  {/* Asks */}
                  <div className="space-y-0.5 overflow-hidden">
                    {orderbook.asks.slice(-8).map((lv, idx) => {
                      const maxTotal =
                        orderbook.asks[0]?.totalSize || orderbook.asks[orderbook.asks.length - 1]?.totalSize || 1;
                      const pct = Math.min(100, (lv.totalSize / Math.max(1e-9, maxTotal)) * 100);
                      return (
                        <button
                          key={`ask-${idx}`}
                          type="button"
                          onClick={() => setLimitPrice(lv.price.toString())}
                          className="relative w-full grid grid-cols-3 px-1.5 py-0.5 rounded hover:bg-white/[0.04] text-left"
                        >
                          <div
                            className="absolute inset-y-0 right-0 bg-rose-500/12 pointer-events-none"
                            style={{ width: `${pct}%` }}
                          />
                          <span className="relative text-rose-400">{lv.price.toFixed(4)}</span>
                          <span className="relative text-right text-slate-200">{lv.size.toFixed(2)}</span>
                          <span className="relative text-right text-slate-400">
                            {lv.totalSize.toFixed(1)}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Spread Mid */}
                  <div className="py-1.5 px-2 my-1 rounded bg-[#0C0E12] border border-white/[0.05] flex items-center justify-between">
                    <span className="text-xs font-semibold text-white">
                      {orderbook.midPrice > 0 ? orderbook.midPrice.toFixed(4) : '—'}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      Spread {orderbook.spreadPct.toFixed(3)}%
                    </span>
                  </div>

                  {/* Bids */}
                  <div className="space-y-0.5 overflow-hidden">
                    {orderbook.bids.slice(0, 8).map((lv, idx) => {
                      const maxTotal = orderbook.bids[Math.min(7, orderbook.bids.length - 1)]?.totalSize || 1;
                      const pct = Math.min(100, (lv.totalSize / Math.max(1e-9, maxTotal)) * 100);
                      return (
                        <button
                          key={`bid-${idx}`}
                          type="button"
                          onClick={() => setLimitPrice(lv.price.toString())}
                          className="relative w-full grid grid-cols-3 px-1.5 py-0.5 rounded hover:bg-white/[0.04] text-left"
                        >
                          <div
                            className="absolute inset-y-0 right-0 bg-emerald-500/12 pointer-events-none"
                            style={{ width: `${pct}%` }}
                          />
                          <span className="relative text-emerald-400">{lv.price.toFixed(4)}</span>
                          <span className="relative text-right text-slate-200">{lv.size.toFixed(2)}</span>
                          <span className="relative text-right text-slate-400">
                            {lv.totalSize.toFixed(1)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex-1 p-2 overflow-y-auto text-[11px] font-mono tabular-nums space-y-1">
                  <div className="grid grid-cols-3 text-slate-500 px-1 pb-1">
                    <span>Price</span>
                    <span className="text-right">Size</span>
                    <span className="text-right">Time</span>
                  </div>
                  {trades.map((tr) => (
                    <div key={tr.tradeId} className="grid grid-cols-3 px-1 py-0.5">
                      <span className={tr.type === 'buy' ? 'text-emerald-400' : 'text-rose-400'}>
                        {tr.price.toFixed(4)}
                      </span>
                      <span className="text-right text-slate-200">{tr.baseVolume.toFixed(2)}</span>
                      <span className="text-right text-slate-500">
                        {new Date(tr.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Right: DeepBook v3 Limit Ticket + BalanceManager Vault */}
            <div className="lg:col-span-3 panel-carbon rounded-lg p-3 flex flex-col justify-between gap-3">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#0C0E12] border border-white/[0.05]">
                  <button
                    type="button"
                    onClick={() => setLimitSide('buy')}
                    className={`py-2 rounded text-xs font-semibold transition-colors ${
                      limitSide === 'buy'
                        ? 'bg-emerald-500 text-[#090B0E]'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Buy {activePool.baseSymbol}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLimitSide('sell')}
                    className={`py-2 rounded text-xs font-semibold transition-colors ${
                      limitSide === 'sell'
                        ? 'bg-rose-500 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Sell {activePool.baseSymbol}
                  </button>
                </div>

                {/* Price */}
                <div className="panel-carbon-sub rounded-lg p-2.5 space-y-1">
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>Limit Price</span>
                    <button
                      type="button"
                      onClick={() => orderbook.midPrice > 0 && setLimitPrice(orderbook.midPrice.toFixed(4))}
                      className="text-[#38BDF8] font-mono hover:underline"
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
                      className="w-full bg-transparent text-base font-mono tabular-nums text-white outline-none"
                    />
                    <span className="text-xs font-mono text-slate-400">{activePool.quoteSymbol}</span>
                  </div>
                </div>

                {/* Quantity */}
                <div className="panel-carbon-sub rounded-lg p-2.5 space-y-1.5">
                  <div className="flex justify-between text-[11px] text-slate-400">
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
                      className="w-full bg-transparent text-base font-mono tabular-nums text-white outline-none"
                    />
                    <span className="text-xs font-mono text-slate-400">{activePool.baseSymbol}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-1 pt-1">
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
                        className="py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-[10px] font-mono text-slate-300"
                      >
                        {Math.round(pct * 100)}%
                      </button>
                    ))}
                  </div>
                </div>

                <label className="flex items-center justify-between text-xs text-slate-400 cursor-pointer">
                  <span>Post-Only (Maker Rebate)</span>
                  <input
                    type="checkbox"
                    checked={postOnly}
                    onChange={(e) => setPostOnly(e.target.checked)}
                    className="accent-[#38BDF8]"
                  />
                </label>

                <div className="text-xs font-mono space-y-1 text-slate-400 pt-1">
                  <div className="flex justify-between">
                    <span>Order Total</span>
                    <span className="text-white tabular-nums">
                      {((Number(limitPrice) || 0) * (Number(limitQty) || 0)).toFixed(4)}{' '}
                      {activePool.quoteSymbol}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Volt Fee ({traderTier.name})</span>
                    <span className="text-[#38BDF8]">{(traderTier.feeRate * 100).toFixed(2)}%</span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={isPlacingLimit}
                  onClick={executePlaceLimit}
                  className={`w-full py-2.5 rounded-lg font-semibold text-xs transition-colors flex items-center justify-center gap-2 ${
                    limitSide === 'buy'
                      ? 'bg-emerald-500 hover:bg-emerald-400 text-[#090B0E]'
                      : 'bg-rose-500 hover:bg-rose-400 text-white'
                  } disabled:opacity-50`}
                >
                  {isPlacingLimit && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>
                    {managerIds.length === 0
                      ? `Create Vault & Place ${limitSide === 'buy' ? 'Buy' : 'Sell'}`
                      : `Place Limit ${limitSide === 'buy' ? 'Buy' : 'Sell'}`}
                  </span>
                </button>
              </div>

              {/* DeepBook BalanceManager Custody Summary */}
              <div className="panel-carbon-sub rounded-lg p-2.5 space-y-2 border-t border-white/[0.06]">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-400 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#38BDF8]" />
                    <span>DeepBook BalanceManager</span>
                  </span>
                  <span className="font-mono text-slate-300">
                    {managerIds[0] ? `${managerIds[0].slice(0, 6)}...` : '1-Tx Auto'}
                  </span>
                </div>

                {managerState && (
                  <>
                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono tabular-nums">
                      <div className="bg-[#101318] rounded px-2 py-1">
                        <div className="text-slate-500">{activePool.baseSymbol}</div>
                        <div className="text-white">{managerState.baseBalance.toFixed(4)}</div>
                      </div>
                      <div className="bg-[#101318] rounded px-2 py-1">
                        <div className="text-slate-500">{activePool.quoteSymbol}</div>
                        <div className="text-white">{managerState.quoteBalance.toFixed(4)}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <select
                        value={depositCoinSide}
                        onChange={(e) => setDepositCoinSide(e.target.value as 'base' | 'quote')}
                        className="bg-[#101318] border border-white/[0.08] rounded px-1.5 py-1 text-[11px] font-mono text-white outline-none"
                      >
                        <option value="quote">{activePool.quoteSymbol}</option>
                        <option value="base">{activePool.baseSymbol}</option>
                      </select>
                      <input
                        type="number"
                        placeholder="Amt"
                        value={depositAmt}
                        onChange={(e) => setDepositAmt(e.target.value)}
                        className="w-full min-w-0 bg-[#101318] border border-white/[0.08] rounded px-2 py-1 text-[11px] font-mono text-white outline-none"
                      />
                      <button
                        type="button"
                        disabled={isVaultBusy || !depositAmt}
                        onClick={handleDepositManager}
                        className="px-2 py-1 rounded bg-white/[0.08] hover:bg-white/[0.14] text-[11px] font-semibold text-white shrink-0"
                      >
                        Dep
                      </button>
                      <button
                        type="button"
                        disabled={isVaultBusy}
                        onClick={handleWithdrawManagerAll}
                        className="px-2 py-1 rounded bg-[#38BDF8]/15 hover:bg-[#38BDF8]/25 text-[#38BDF8] text-[11px] font-semibold shrink-0"
                        title="Withdraw all & settled funds to wallet"
                      >
                        Withdraw
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Open Orders & Settled Dock */}
          <div className="panel-carbon rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-white">
                  Open Limit Orders ({managerState?.openOrders.length ?? 0})
                </span>
                {managerState && (managerState.settledBase > 0 || managerState.settledQuote > 0) && (
                  <button
                    type="button"
                    onClick={handleWithdrawManagerAll}
                    disabled={isVaultBusy}
                    className="px-2.5 py-1 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-mono"
                  >
                    Claim Settled ({managerState.settledBase.toFixed(4)} {activePool.baseSymbol} /{' '}
                    {managerState.settledQuote.toFixed(4)} {activePool.quoteSymbol})
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={refreshDeepBookAccount}
                className="text-slate-400 hover:text-white p-1"
                title="Refresh DeepBook state"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            {!account ? (
              <div className="text-xs text-slate-500 py-4 text-center">
                Connect your Sui wallet to view open DeepBook v3 limit orders.
              </div>
            ) : !managerState || managerState.openOrders.length === 0 ? (
              <div className="text-xs text-slate-500 py-4 text-center">
                No open limit orders on {activePool.baseSymbol}/{activePool.quoteSymbol}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="text-slate-500 border-b border-white/[0.06]">
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
                        <td className={`py-2 font-semibold ${ord.isBid ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {ord.isBid ? 'BUY' : 'SELL'}
                        </td>
                        <td className="text-right py-2 text-white">{ord.price.toFixed(4)}</td>
                        <td className="text-right py-2 text-slate-200">{ord.quantity.toFixed(4)}</td>
                        <td className="text-right py-2 text-slate-400">{ord.filledQuantity.toFixed(4)}</td>
                        <td className="text-right py-2">
                          <button
                            type="button"
                            disabled={isVaultBusy}
                            onClick={() => handleCancelOrder(ord.orderId)}
                            className="px-2 py-1 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 text-[11px]"
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
        </div>
      )}

      {/* Token Picker Modal */}
      {tokenPickerFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="panel-carbon rounded-xl w-full max-w-md p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">Select Token</span>
              <button
                type="button"
                onClick={() => setTokenPickerFor(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <input
              type="text"
              autoFocus
              value={tokenQuery}
              onChange={(e) => setTokenQuery(e.target.value)}
              placeholder="Search symbol or coin type..."
              className="w-full px-3 py-2 rounded-lg bg-[#0C0E12] border border-white/[0.08] text-xs text-white outline-none focus:border-[#38BDF8]"
            />
            <div className="max-h-72 overflow-y-auto space-y-1">
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
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/[0.05] text-left"
                  >
                    <div className="flex items-center gap-2.5">
                      <img src={t.logo} alt={t.symbol} className="w-6 h-6 rounded-full" />
                      <div>
                        <div className="text-xs font-semibold text-white">{t.symbol}</div>
                        <div className="text-[11px] text-slate-400">{t.name}</div>
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
