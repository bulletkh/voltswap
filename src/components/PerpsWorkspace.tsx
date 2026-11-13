import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Loader2, RefreshCw, Share2, Wallet, X, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import {
  AF_USDC_COIN_TYPE,
  buildCreateAccountTx,
  buildDepositCollateralTx,
  buildPlaceMarketOrderTx,
  buildWithdrawCollateralTx,
  fetchAftermathAccountState,
  fetchAftermathMarkets,
  fetchAftermathOrderbook,
  type AfAccountState,
  type AfMarketInfo,
  type AfMarketOrderbook,
  type AfPositionInfo,
} from '../aftermathPerps';
import { extractTxDigest, fetchWalletBalances, readBalanceFromMap } from '../suiClient';
import { simulateTxBeforeWallet } from '../suiSimulate';
import {
  addWalletVolumeUsd,
  calcFeeUnits,
  getValidReferrerForSender,
  getWalletVolumeUsd,
  resolveReferralTier,
  resolveTraderTier,
} from '../voltFee';
import { fetchDeepBookCandles, type DeepBookCandle } from '../deepbookV3';
import { ProCandleChart, type ChartTimeframe } from './ProCandleChart';
import type { PnlTradeData } from '../PnlShareModal';

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

const FEATURED_PERP_SYMBOLS = ['SUI', 'BTC', 'ETH', 'SOL', 'WAL', 'DEEP', 'XRP', 'DOGE'];

async function fetchPerpCandles(symbol: string, tf: ChartTimeframe): Promise<DeepBookCandle[]> {
  const clean = symbol.replace('-PERP', '').toUpperCase();
  if (clean === 'SUI' || clean === 'WAL' || clean === 'DEEP') {
    try {
      const dbCandles = await fetchDeepBookCandles(`${clean}_USDC`, tf, 120);
      if (dbCandles.length > 5) return dbCandles;
    } catch {
      // fall through to Binance public market feed
    }
  }
  const res = await fetch(
    `https://api.binance.com/api/v3/klines?symbol=${clean}USDT&interval=${tf}&limit=120`
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
}

export const PerpsWorkspace: React.FC<PerpsWorkspaceProps> = ({
  onNotify,
  onTradeRecorded,
  onVolumeUpdated,
}) => {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();

  const [marketsMap, setMarketsMap] = useState<Record<string, AfMarketInfo>>({});
  const [selectedSymbol, setSelectedSymbol] = useState<string>('SUI');
  const [orderbook, setOrderbook] = useState<AfMarketOrderbook>({
    bids: [],
    asks: [],
    bestBid: 0,
    bestAsk: 0,
    midPrice: 0,
  });
  const [candles, setCandles] = useState<DeepBookCandle[]>([]);
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('15m');
  const [candlesLoading, setCandlesLoading] = useState(false);

  const [afState, setAfState] = useState<AfAccountState | null>(null);
  const [walletUsdc, setWalletUsdc] = useState<number>(0);

  const [side, setSide] = useState<'long' | 'short'>('long');
  const [leverage, setLeverage] = useState<number>(10);
  const [marginUsdc, setMarginUsdc] = useState<string>('0.5');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [collateralModal, setCollateralModal] = useState<'deposit' | 'withdraw' | null>(null);
  const [collateralAmt, setCollateralAmt] = useState<string>('');
  const [isCollateralBusy, setIsCollateralBusy] = useState(false);

  const walletVol = useMemo(() => getWalletVolumeUsd(account?.address), [account?.address]);
  const activeRef = useMemo(() => getValidReferrerForSender(account?.address), [account?.address]);
  const traderTier = useMemo(() => resolveTraderTier(walletVol, Boolean(activeRef)), [walletVol, activeRef]);
  const refTier = useMemo(() => resolveReferralTier(walletVol), [walletVol]);

  // Load markets periodically
  useEffect(() => {
    let cancelled = false;
    const loadMarkets = async () => {
      try {
        const m = await fetchAftermathMarkets();
        if (!cancelled) setMarketsMap(m);
      } catch {
        // ignore transient errors
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

  const activeMarket = marketsMap[selectedSymbol] || orderedMarkets[0] || null;

  // Keep leverage strictly within Aftermath market.maxLeverage (prevents MoveAbort 2003)
  useEffect(() => {
    if (activeMarket && leverage > activeMarket.maxLeverage) {
      setLeverage(activeMarket.maxLeverage);
    }
  }, [activeMarket, leverage]);

  // Orderbook poll
  useEffect(() => {
    if (!activeMarket?.marketId) return;
    let cancelled = false;
    const loadBook = async () => {
      try {
        const ob = await fetchAftermathOrderbook(activeMarket.marketId);
        if (!cancelled) setOrderbook(ob);
      } catch {
        // ignore
      }
    };
    loadBook();
    const id = setInterval(loadBook, 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeMarket?.marketId]);

  // Candles load
  useEffect(() => {
    let cancelled = false;
    setCandlesLoading(true);
    fetchPerpCandles(selectedSymbol, timeframe)
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
  }, [selectedSymbol, timeframe]);

  const refreshAccount = useCallback(async () => {
    if (!account?.address) {
      setAfState(null);
      setWalletUsdc(0);
      return;
    }
    try {
      const [state, bals] = await Promise.all([
        fetchAftermathAccountState(account.address),
        fetchWalletBalances(account.address),
      ]);
      setAfState(state);
      setWalletUsdc(readBalanceFromMap(bals, AF_USDC_COIN_TYPE, 6));
    } catch {
      // ignore
    }
  }, [account?.address]);

  useEffect(() => {
    refreshAccount();
    const id = setInterval(refreshAccount, 8000);
    return () => clearInterval(id);
  }, [refreshAccount]);

  const markPrice =
    orderbook.midPrice || activeMarket?.markPrice || activeMarket?.indexPrice || 0;
  const marginNum = Math.max(0, Number(marginUsdc) || 0);
  const notionalUsd = marginNum * leverage;
  const estContracts = markPrice > 0 ? notionalUsd / markPrice : 0;
  const estLiqPrice =
    markPrice > 0
      ? side === 'long'
        ? markPrice * (1 - 0.88 / leverage)
        : markPrice * (1 + 0.88 / leverage)
      : 0;

  const suiIndexPrice = marketsMap['SUI']?.indexPrice || 0.82;

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
    if (marginNum <= 0 || notionalUsd < activeMarket.minOrderUsdValue) {
      onNotify(
        'warning',
        'Order Below Minimum',
        `Minimum notional size for ${activeMarket.symbol}-PERP is $${activeMarket.minOrderUsdValue}.`
      );
      return;
    }
    if (marginNum > afState.availableCollateralUsd * 0.99) {
      onNotify(
        'warning',
        'Insufficient Free Margin',
        `Available collateral is $${afState.availableCollateralUsd.toFixed(2)}. Deposit USDC or use a 94% max buffer.`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const suiEquivMist = BigInt(
        Math.max(0, Math.round((notionalUsd / Math.max(0.2, suiIndexPrice)) * 1e9))
      );
      const feeMist = calcFeeUnits(suiEquivMist, traderTier.feeRate);
      const hasPosition = afState.positionMarketIds.includes(activeMarket.marketId);

      const tx = await buildPlaceMarketOrderTx({
        walletAddress: account.address,
        accountId: afState.accountId,
        marketId: activeMarket.marketId,
        side: side === 'long' ? 0 : 1,
        sizeContracts: estContracts,
        lotSize: activeMarket.lotSize,
        leverage,
        reduceOnly: false,
        collateralChange: Number(marginNum.toFixed(4)),
        hasPosition,
        cancelSlTp: false,
        slippage: 0.025,
        feeMist,
        refSharePct: refTier.revSharePct,
      });

      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) {
        onNotify('error', 'Preflight Check Failed', sim.errorMessage || 'Transaction would abort.');
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
          fromToken: `${marginNum.toFixed(2)} USDC`,
          toToken: `${activeMarket.symbol}-PERP ${leverage}x`,
          fromAmount: marginNum,
          toAmount: estContracts.toFixed(3),
          volumeUsd: notionalUsd,
          feeRate: traderTier.feeRate,
          tierName: traderTier.name,
          swapMode: 'AFTERMATH_PERP',
          referrer: activeRef,
        }),
      }).catch(() => {});

      onNotify(
        'success',
        `${side === 'long' ? 'Long' : 'Short'} ${activeMarket.symbol}-PERP Opened`,
        `${estContracts.toFixed(3)} ${activeMarket.symbol} @ ${leverage}x ($${notionalUsd.toFixed(2)})`,
        'Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
      onTradeRecorded({
        fromToken: 'USDC',
        toToken: `${activeMarket.symbol}-PERP`,
        fromAmount: marginNum.toFixed(2),
        toAmount: `${estContracts.toFixed(2)} (${leverage}x)`,
        volumeUsd: notionalUsd,
        digest,
        orderType: 'PERPS',
      });
      await refreshAccount();
    } catch (err: any) {
      onNotify('error', 'Order Execution Failed', err?.message || 'Could not execute perp order.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClosePosition = async (pos: AfPositionInfo) => {
    if (!account?.address || !afState?.accountId) return;
    const mkt = Object.values(marketsMap).find((m) => m.marketId === pos.marketId);
    if (!mkt) return;

    setIsSubmitting(true);
    try {
      const closeSide: 0 | 1 = pos.baseAssetAmount > 0 ? 1 : 0;
      const closeSize = Math.abs(pos.baseAssetAmount);
      const tx = await buildPlaceMarketOrderTx({
        walletAddress: account.address,
        accountId: afState.accountId,
        marketId: mkt.marketId,
        side: closeSide,
        sizeContracts: closeSize,
        lotSize: mkt.lotSize,
        leverage: Math.max(1, Math.min(mkt.maxLeverage, Math.round(pos.leverage))),
        reduceOnly: true,
        collateralChange: 0,
        hasPosition: true,
        cancelSlTp: true,
        slippage: 0.03,
      });

      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      onNotify(
        'success',
        `Closed ${mkt.symbol}-PERP Position`,
        `PnL: ${pos.unrealizedPnlUsd >= 0 ? '+' : ''}$${pos.unrealizedPnlUsd.toFixed(2)}`,
        'Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
      await refreshAccount();
    } catch (err: any) {
      onNotify('error', 'Close Failed', err?.message || 'Could not close position.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full space-y-3">
      {/* Live Perp Market Ribbon */}
      <div className="panel-carbon rounded-lg px-3 py-2 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {orderedMarkets.slice(0, 10).map((m) => {
            const active = activeMarket?.symbol === m.symbol;
            return (
              <button
                key={m.marketId}
                type="button"
                onClick={() => setSelectedSymbol(m.symbol)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-mono whitespace-nowrap flex items-center gap-1.5 transition-all ${
                  active
                    ? 'bg-[#1D63FF] text-white shadow-[0_0_16px_rgba(29,99,255,0.45)] font-bold'
                    : 'text-slate-300 hover:text-white hover:bg-white/[0.06] border border-transparent'
                }`}
              >
                <span>{m.symbol}-PERP</span>
                <span className={`text-[10px] ${active ? 'text-blue-100' : 'text-slate-400'}`}>
                  {m.maxLeverage}x
                </span>
              </button>
            );
          })}
        </div>

        {activeMarket && (
          <div className="flex flex-wrap items-center gap-4 text-xs font-mono tabular-nums">
            <div>
              <span className="text-slate-400 mr-1">Mark</span>
              <span className="text-white font-bold">
                ${markPrice.toFixed(markPrice >= 100 ? 2 : 4)}
              </span>
            </div>
            <div>
              <span className="text-slate-400 mr-1">24h</span>
              <span
                className={
                  activeMarket.priceChange24hPct >= 0
                    ? 'text-[#00E599] font-semibold'
                    : 'text-[#FF4D6A] font-semibold'
                }
              >
                {activeMarket.priceChange24hPct >= 0 ? '+' : ''}
                {activeMarket.priceChange24hPct.toFixed(2)}%
              </span>
            </div>
            <div className="hidden md:block">
              <span className="text-slate-400 mr-1">24h Vol</span>
              <span className="text-white font-semibold">
                ${(activeMarket.volume24hUsd / 1e6).toFixed(2)}M
              </span>
            </div>
            <div className="hidden sm:block">
              <span className="text-slate-400 mr-1">Funding/1h</span>
              <span className="text-[#00E599] font-semibold">
                {(activeMarket.estimatedFundingRate * 100).toFixed(4)}%
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 3-Column Aftermath/Bluefin Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
        {/* Left: Candle Chart */}
        <div className="lg:col-span-6">
          <ProCandleChart
            symbolLabel={`${activeMarket?.symbol || selectedSymbol}-PERP`}
            sourceLabel="Aftermath Perpetuals"
            candles={candles}
            timeframe={timeframe}
            onTimeframeChange={setTimeframe}
            isLoading={candlesLoading}
            heightClass="h-[340px] lg:h-[465px]"
            livePrice={markPrice}
          />
        </div>

        {/* Middle: Live Aftermath L2 Orderbook */}
        <div className="lg:col-span-3 panel-carbon rounded-lg flex flex-col overflow-hidden h-[440px] lg:h-[515px]">
          <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between">
            <span className="text-xs font-semibold text-white">Aftermath Orderbook</span>
            <span className="text-[10px] font-mono text-slate-400">Live CLOB</span>
          </div>
          <div className="flex-1 flex flex-col justify-between p-2 text-[11px] font-mono tabular-nums overflow-hidden">
            <div className="grid grid-cols-3 text-slate-500 px-1 pb-1">
              <span>Price (USD)</span>
              <span className="text-right">Size</span>
              <span className="text-right">Sum</span>
            </div>

            <div className="space-y-0.5">
              {orderbook.asks.slice(-8).map((lv, i) => {
                const max = orderbook.asks[0]?.totalSize || 1;
                const w = Math.min(100, (lv.totalSize / Math.max(1e-9, max)) * 100);
                return (
                  <div key={`a-${i}`} className="relative grid grid-cols-3 px-1.5 py-0.5 rounded">
                    <div
                      className="absolute inset-y-0 right-0 bg-[#F6465D]/20"
                      style={{ width: `${w}%` }}
                    />
                    <span className="relative text-[#FF4D6A] font-semibold">
                      {lv.price.toFixed(lv.price >= 100 ? 2 : 4)}
                    </span>
                    <span className="relative text-right text-white">{lv.size.toFixed(2)}</span>
                    <span className="relative text-right text-slate-300">
                      {lv.totalSize.toFixed(1)}
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="py-1.5 px-2 my-1 rounded bg-[#05080F] border border-white/[0.1] flex items-center justify-between">
              <span className="text-xs font-bold text-white">
                ${markPrice.toFixed(markPrice >= 100 ? 2 : 4)}
              </span>
              <span className="text-[10px] text-slate-300">Index</span>
            </div>

            <div className="space-y-0.5">
              {orderbook.bids.slice(0, 8).map((lv, i) => {
                const max = orderbook.bids[Math.min(7, orderbook.bids.length - 1)]?.totalSize || 1;
                const w = Math.min(100, (lv.totalSize / Math.max(1e-9, max)) * 100);
                return (
                  <div key={`b-${i}`} className="relative grid grid-cols-3 px-1.5 py-0.5 rounded">
                    <div
                      className="absolute inset-y-0 right-0 bg-[#00D98B]/20"
                      style={{ width: `${w}%` }}
                    />
                    <span className="relative text-[#00E599] font-semibold">
                      {lv.price.toFixed(lv.price >= 100 ? 2 : 4)}
                    </span>
                    <span className="relative text-right text-white">{lv.size.toFixed(2)}</span>
                    <span className="relative text-right text-slate-300">
                      {lv.totalSize.toFixed(1)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right: Order Ticket & Account Equity */}
        <div className="lg:col-span-3 panel-carbon rounded-lg p-3 flex flex-col justify-between gap-3">
          <div className="space-y-3">
            {/* Long / Short */}
            <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#05080F] border border-white/[0.08]">
              <button
                type="button"
                onClick={() => setSide('long')}
                className={`py-2 rounded text-xs font-bold transition-colors ${
                  side === 'long'
                    ? 'bg-[#00D98B] text-[#02060A] shadow-[0_0_16px_rgba(0,217,139,0.28)]'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Long / Buy
              </button>
              <button
                type="button"
                onClick={() => setSide('short')}
                className={`py-2 rounded text-xs font-bold transition-colors ${
                  side === 'short'
                    ? 'bg-[#F6465D] text-white shadow-[0_0_16px_rgba(246,70,93,0.28)]'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Short / Sell
              </button>
            </div>

            {/* Leverage */}
            <div className="panel-carbon-sub rounded-lg p-2.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-300">
                  Leverage (Max {activeMarket?.maxLeverage ?? 14}x)
                </span>
                <span className="font-mono font-bold text-[#4BA3FF]">{leverage}x</span>
              </div>
              <input
                type="range"
                min={1}
                max={activeMarket?.maxLeverage ?? 14}
                step={1}
                value={leverage}
                onChange={(e) => setLeverage(Number(e.target.value))}
                className="w-full carbon-slider"
              />
            </div>

            {/* Margin USDC Input */}
            <div className="panel-carbon-sub rounded-lg p-2.5 space-y-1.5">
              <div className="flex justify-between text-[11px] text-slate-400">
                <span>Margin Collateral</span>
                <span className="font-mono tabular-nums">
                  Free: ${(afState?.availableCollateralUsd ?? 0).toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={marginUsdc}
                  onChange={(e) => setMarginUsdc(e.target.value)}
                  className="w-full bg-transparent text-base font-mono tabular-nums text-white outline-none"
                />
                <span className="text-xs font-mono text-slate-400">USDC</span>
              </div>
              <div className="grid grid-cols-4 gap-1 pt-1">
                {[0.25, 0.5, 0.75, 0.94].map((ratio, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      const free = afState?.availableCollateralUsd ?? 0;
                      setMarginUsdc((free * ratio).toFixed(2));
                    }}
                    className="py-1 rounded bg-white/[0.04] hover:bg-white/[0.08] text-[10px] font-mono text-slate-300"
                  >
                    {idx === 3 ? 'MAX' : `${Math.round(ratio * 100)}%`}
                  </button>
                ))}
              </div>
            </div>

            {/* Summary */}
            <div className="text-xs font-mono space-y-1 text-slate-400">
              <div className="flex justify-between">
                <span>Position Size</span>
                <span className="text-white tabular-nums">
                  {estContracts.toFixed(3)} {activeMarket?.symbol || selectedSymbol}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Notional Value</span>
                <span className="text-white tabular-nums">${notionalUsd.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Est. Liq. Price</span>
                <span className="text-amber-400 tabular-nums">${estLiqPrice.toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span>Volt Fee ({traderTier.name})</span>
                <span className="text-[#4BA3FF] font-semibold">{(traderTier.feeRate * 100).toFixed(2)}%</span>
              </div>
            </div>

            <button
              type="button"
              disabled={isSubmitting || isCollateralBusy}
              onClick={executePerpOrder}
              className={`w-full py-2.5 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-2 ${
                side === 'long'
                  ? 'bg-[#00D98B] hover:bg-[#1EE89F] text-[#02060A] shadow-[0_0_18px_rgba(0,217,139,0.28)]'
                  : 'bg-[#F6465D] hover:bg-[#FF5B72] text-white shadow-[0_0_18px_rgba(246,70,93,0.28)]'
              } disabled:opacity-50`}
            >
              {(isSubmitting || isCollateralBusy) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>
                {!account
                  ? 'Connect Wallet'
                  : !afState?.accountId
                    ? 'Create Perps Account'
                    : `${side === 'long' ? 'Open Long' : 'Open Short'} ${activeMarket?.symbol || selectedSymbol}`}
              </span>
            </button>
          </div>

          {/* Account Margin Equity Card */}
          <div className="panel-carbon-sub rounded-lg p-2.5 space-y-2 border-t border-white/[0.06]">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">
                Account {afState?.accountId ? `#${afState.accountId.replace('n', '')}` : 'Unregistered'}
              </span>
              <span className="font-mono text-slate-300 tabular-nums">
                Wallet: {walletUsdc.toFixed(2)} USDC
              </span>
            </div>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono tabular-nums">
              <div className="bg-[#05080F] border border-white/[0.08] rounded px-2 py-1">
                <div className="text-[10px] text-slate-400">Equity</div>
                <div className="text-white font-bold">
                  ${(afState?.totalEquityUsd ?? 0).toFixed(2)}
                </div>
              </div>
              <div className="bg-[#05080F] border border-white/[0.08] rounded px-2 py-1">
                <div className="text-[10px] text-slate-400">Free Margin</div>
                <div className="text-[#00E599] font-bold">
                  ${(afState?.availableCollateralUsd ?? 0).toFixed(2)}
                </div>
              </div>
            </div>
            {afState?.accountId && (
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setCollateralAmt('');
                    setCollateralModal('deposit');
                  }}
                  className="py-1.5 rounded bg-[#1D63FF] hover:bg-[#2E74FF] text-xs font-bold text-white flex items-center justify-center gap-1"
                >
                  <ArrowDownToLine className="w-3 h-3 text-white" />
                  Deposit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCollateralAmt((afState?.availableCollateralUsd ?? 0).toFixed(2));
                    setCollateralModal('withdraw');
                  }}
                  className="py-1.5 rounded bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.12] text-xs font-bold text-white flex items-center justify-center gap-1"
                >
                  <ArrowUpFromLine className="w-3 h-3 text-[#00E599]" />
                  Withdraw
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Positions Dock */}
      <div className="panel-carbon rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-white">
            Open Positions ({afState?.positions.length ?? 0})
          </span>
          <button
            type="button"
            onClick={refreshAccount}
            className="text-slate-400 hover:text-white p-1"
            title="Refresh positions"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {!afState || afState.positions.length === 0 ? (
          <div className="text-xs text-slate-500 py-4 text-center">
            {account
              ? 'No active perpetual positions on Aftermath.'
              : 'Connect your wallet to view Aftermath Perpetuals positions.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono tabular-nums">
              <thead>
                <tr className="text-slate-500 border-b border-white/[0.06]">
                  <th className="text-left py-2">Market</th>
                  <th className="text-left py-2">Side</th>
                  <th className="text-right py-2">Size</th>
                  <th className="text-right py-2">Entry</th>
                  <th className="text-right py-2">Liq. Price</th>
                  <th className="text-right py-2">uPnL</th>
                  <th className="text-right py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {afState.positions.map((pos) => {
                  const mkt = Object.values(marketsMap).find((m) => m.marketId === pos.marketId);
                  const isLong = pos.baseAssetAmount > 0;
                  return (
                    <tr key={pos.marketId} className="border-b border-white/[0.04]">
                      <td className="py-2 font-semibold text-white">
                        {mkt?.symbol || 'PERP'} · {pos.leverage.toFixed(1)}x
                      </td>
                      <td className={`py-2 font-semibold ${isLong ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {isLong ? 'LONG' : 'SHORT'}
                      </td>
                      <td className="text-right py-2 text-slate-200">
                        {Math.abs(pos.baseAssetAmount).toFixed(4)}
                      </td>
                      <td className="text-right py-2 text-slate-200">${pos.entryPrice.toFixed(4)}</td>
                      <td className="text-right py-2 text-amber-400">
                        ${pos.liquidationPrice.toFixed(4)}
                      </td>
                      <td
                        className={`text-right py-2 font-semibold ${
                          pos.unrealizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {pos.unrealizedPnlUsd >= 0 ? '+' : ''}${pos.unrealizedPnlUsd.toFixed(2)}
                      </td>
                      <td className="text-right py-2 space-x-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            onTradeRecorded({
                              fromToken: 'USDC',
                              toToken: `${mkt?.symbol || 'SUI'}-PERP`,
                              fromAmount: pos.collateralUsd.toFixed(2),
                              toAmount: `${Math.abs(pos.baseAssetAmount).toFixed(2)}`,
                              volumeUsd: Math.abs(pos.quoteAssetNotionalAmount),
                              profitUsd: pos.unrealizedPnlUsd,
                              profitPct:
                                pos.collateralUsd > 0
                                  ? (pos.unrealizedPnlUsd / pos.collateralUsd) * 100
                                  : 0,
                              orderType: 'PERPS',
                            })
                          }
                          className="px-2 py-1 rounded bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 inline-flex items-center gap-1"
                        >
                          <Share2 className="w-3 h-3" />
                          Card
                        </button>
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => handleClosePosition(pos)}
                          className="px-2 py-1 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-400"
                        >
                          Close Market
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

      {/* Deposit / Withdraw Modal */}
      {collateralModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="panel-carbon rounded-xl w-full max-w-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white">
                {collateralModal === 'deposit' ? 'Deposit USDC to Perps' : 'Withdraw USDC to Wallet'}
              </span>
              <button
                type="button"
                onClick={() => setCollateralModal(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="panel-carbon-sub rounded-lg p-3 space-y-1">
              <div className="flex justify-between text-xs text-slate-400">
                <span>Amount (USDC)</span>
                  <button
                  type="button"
                  onClick={() =>
                    setCollateralAmt(
                      (collateralModal === 'deposit'
                        ? walletUsdc
                        : afState?.availableCollateralUsd ?? 0
                      ).toFixed(2)
                    )
                  }
                  className="text-[#4BA3FF] font-mono inline-flex items-center gap-1 font-semibold"
                >
                  <Wallet className="w-3 h-3" />
                  Max{' '}
                  {(collateralModal === 'deposit'
                    ? walletUsdc
                    : afState?.availableCollateralUsd ?? 0
                  ).toFixed(2)}
                </button>
              </div>
              <input
                type="number"
                min="0"
                step="any"
                autoFocus
                value={collateralAmt}
                onChange={(e) => setCollateralAmt(e.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent text-xl font-mono font-bold text-white outline-none"
              />
            </div>
            <button
              type="button"
              disabled={isCollateralBusy || !collateralAmt}
              onClick={handleCollateralSubmit}
              className="w-full py-2.5 rounded-lg btn-deepbook disabled:opacity-50 font-bold text-sm flex items-center justify-center gap-2"
            >
              {isCollateralBusy && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>
                {collateralModal === 'deposit' ? 'Confirm Deposit' : 'Confirm Withdraw'}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
