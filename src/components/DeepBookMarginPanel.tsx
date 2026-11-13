import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpDown,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import {
  buildDeepBookMarginOrderTx,
  buildMarginCancelTx,
  buildMarginCloseAndRepayTx,
  buildMarginRepayTx,
  buildMarginWithdrawCollateralTx,
  fetchMarginPoolConfig,
  fetchMarginPositionForPool,
  type MarginManagerPosition,
  type MarginPoolRiskConfig,
} from '../deepbookMargin';
import type { DeepBookPoolMeta } from '../deepbookV3';
import { extractTxDigest, readBalanceFromMap } from '../suiClient';
import { simulateTxBeforeWallet } from '../suiSimulate';
import { addWalletVolumeUsd, calcFeeUnits } from '../voltFee';
import type { PnlTradeData } from '../PnlShareModal';

interface DeepBookMarginTicketProps {
  pool: DeepBookPoolMeta;
  midPrice: number;
  selectedBookPrice: string;
  balances: Record<string, bigint>;
  feeRate: number;
  refSharePct: number;
  riskConfig: MarginPoolRiskConfig | null;
  position: MarginManagerPosition | null;
  onSuccessRefresh: () => void;
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

export const DeepBookMarginTicket: React.FC<DeepBookMarginTicketProps> = ({
  pool,
  midPrice,
  selectedBookPrice,
  balances,
  feeRate,
  refSharePct,
  riskConfig,
  position,
  onSuccessRefresh,
  onNotify,
  onTradeRecorded,
  onVolumeUpdated,
}) => {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();

  const [side, setSide] = useState<'long' | 'short'>('long');
  const [orderStyle, setOrderStyle] = useState<'market' | 'limit'>('market');
  const [collateralSide, setCollateralSide] = useState<'quote' | 'base'>('quote');
  const [collateralInput, setCollateralInput] = useState<string>('5');
  const [leverage, setLeverage] = useState<number>(2.0);
  const [limitPriceInput, setLimitPriceInput] = useState<string>('');
  const [enableTpSl, setEnableTpSl] = useState<boolean>(false);
  const [tpPriceInput, setTpPriceInput] = useState<string>('');
  const [slPriceInput, setSlPriceInput] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    if (selectedBookPrice) {
      setLimitPriceInput(selectedBookPrice);
    }
  }, [selectedBookPrice]);

  useEffect(() => {
    if (orderStyle === 'limit' && !limitPriceInput && midPrice > 0) {
      setLimitPriceInput(midPrice.toFixed(4));
    }
  }, [orderStyle, midPrice, limitPriceInput]);

  const walletBaseBal = account?.address
    ? readBalanceFromMap(balances, pool.baseCoinId, pool.baseDecimals)
    : 0;
  const walletQuoteBal = account?.address
    ? readBalanceFromMap(balances, pool.quoteCoinId, pool.quoteDecimals)
    : 0;

  const maxLev = riskConfig?.maxLeverageSafe ?? 4.5;
  const execPrice =
    orderStyle === 'limit' && Number(limitPriceInput) > 0 ? Number(limitPriceInput) : midPrice;

  const collateralAmt = Number(collateralInput) || 0;
  const quoteUsdFactor =
    pool.quoteSymbol === 'USDC' || pool.quoteSymbol === 'SUIUSDE'
      ? 1
      : position?.quotePythPriceUsd || 1;
  const baseUsdFactor =
    position?.basePythPriceUsd && position.basePythPriceUsd > 0
      ? position.basePythPriceUsd
      : execPrice * quoteUsdFactor;

  const collateralQuoteVal =
    collateralSide === 'quote' ? collateralAmt : collateralAmt * Math.max(0.0001, execPrice);

  const borrowQuoteTarget = side === 'long' ? collateralQuoteVal * Math.max(0, leverage - 1) : 0;
  const borrowBaseTarget =
    side === 'short' && execPrice > 0
      ? (collateralQuoteVal * Math.max(0, leverage - 1)) / execPrice
      : 0;
  const borrowAmount = side === 'long' ? borrowQuoteTarget : borrowBaseTarget;

  // Order quantity in Base asset with safety cushion for taker fees
  const orderQuantityBase = useMemo(() => {
    if (execPrice <= 0 || collateralQuoteVal <= 0) return 0;
    const rawQty =
      side === 'long'
        ? collateralSide === 'quote'
          ? ((collateralAmt + borrowQuoteTarget) * 0.99) / execPrice
          : (borrowQuoteTarget * 0.99) / execPrice
        : collateralSide === 'base'
          ? (collateralAmt + borrowBaseTarget) * 0.99
          : borrowBaseTarget * 0.99;

    const steps = Math.floor(rawQty / pool.lotSize);
    return Number((steps * pool.lotSize).toFixed(6));
  }, [
    execPrice,
    collateralQuoteVal,
    side,
    collateralSide,
    collateralAmt,
    borrowQuoteTarget,
    borrowBaseTarget,
    pool.lotSize,
  ]);

  // Projected risk ratio after opening: (Total Collateral + Borrowed) / Borrowed
  const projectedRiskRatio = useMemo(() => {
    if (leverage <= 1.01) return 99;
    return leverage / (leverage - 1);
  }, [leverage]);

  const minBorrowThreshold =
    side === 'long' ? riskConfig?.minBorrowQuote ?? 0.1 : riskConfig?.minBorrowBase ?? 0.1;

  const belowMinBorrow = borrowAmount > 0 && borrowAmount < minBorrowThreshold;
  const belowMinQty = orderQuantityBase < pool.minSize;
  const exceedsLiquidity =
    side === 'long'
      ? Boolean(riskConfig && borrowAmount > riskConfig.quoteAvailableLiquidity)
      : Boolean(riskConfig && borrowAmount > riskConfig.baseAvailableLiquidity);

  const notionalUsd =
    (orderQuantityBase > 0 ? orderQuantityBase * baseUsdFactor : 0) ||
    collateralQuoteVal * leverage * quoteUsdFactor;

  const handleOpenMarginPosition = async () => {
    if (!account?.address) {
      onNotify('warning', 'Wallet Not Connected', 'Please connect a Sui wallet first.');
      return;
    }
    if (collateralAmt <= 0 || belowMinQty || belowMinBorrow || exceedsLiquidity) {
      onNotify(
        'warning',
        'Check Order Parameters',
        belowMinBorrow
          ? `Minimum borrow is ${minBorrowThreshold} ${
              side === 'long' ? pool.quoteSymbol : pool.baseSymbol
            }. Increase collateral or leverage.`
          : exceedsLiquidity
            ? 'Requested borrow exceeds available DeepBook MarginPool liquidity.'
            : `Order size must meet pool minimum ${pool.minSize} ${pool.baseSymbol}.`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const suiPriceApprox =
        pool.baseSymbol === 'SUI' && baseUsdFactor > 0 ? baseUsdFactor : 0.85;
      const suiInputUsd =
        collateralSide === 'base' ? collateralAmt * baseUsdFactor : collateralAmt * quoteUsdFactor;
      const feeUnits = calcFeeUnits(
        BigInt(Math.round((suiInputUsd / Math.max(0.05, suiPriceApprox)) * 1e9)),
        feeRate
      );
      const safeFeeMist =
        walletBaseBal > 0.05 && pool.baseSymbol === 'SUI'
          ? feeUnits
          : feeUnits > 50_000_000n
            ? 50_000_000n
            : feeUnits;

      const tx = buildDeepBookMarginOrderTx({
        owner: account.address,
        pool,
        existingManagerId: position?.managerId ?? null,
        side,
        orderStyle,
        collateralSide,
        depositCollateralAmount: collateralAmt,
        borrowAmount,
        orderQuantityBase,
        limitPrice: orderStyle === 'limit' ? Number(limitPriceInput) : undefined,
        tpPrice: enableTpSl && Number(tpPriceInput) > 0 ? Number(tpPriceInput) : undefined,
        slPrice: enableTpSl && Number(slPriceInput) > 0 ? Number(slPriceInput) : undefined,
        feeMist: safeFeeMist > 0n ? safeFeeMist : 0n,
        refSharePct,
      });

      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) {
        throw new Error(sim.errorMessage || 'Margin order simulation failed.');
      }

      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);

      const newVol = addWalletVolumeUsd(account.address, Math.max(1, notionalUsd));
      onVolumeUpdated?.(newVol);

      onTradeRecorded({
        fromToken: `${leverage.toFixed(1)}x Collateral (${
          collateralSide === 'quote' ? pool.quoteSymbol : pool.baseSymbol
        })`,
        toToken: `${pool.baseSymbol} ${side === 'long' ? 'Margin Long' : 'Margin Short'}`,
        fromAmount: collateralAmt.toFixed(3),
        toAmount: `${orderQuantityBase.toFixed(3)} ${pool.baseSymbol}`,
        volumeUsd: notionalUsd,
        feeSavedUsd: Number((notionalUsd * Math.max(0.0005, 0.0025 - feeRate)).toFixed(2)),
        digest: digest || undefined,
        orderType: 'PERPS',
      });

      onNotify(
        'success',
        `DeepBook Margin ${side === 'long' ? 'Long' : 'Short'} Executed`,
        `${leverage.toFixed(1)}x ${orderQuantityBase.toFixed(3)} ${pool.baseSymbol} on DeepBook v3 CLOB.`,
        digest ? 'View on Suiscan' : undefined,
        digest ? `https://suiscan.xyz/mainnet/tx/${digest}` : undefined
      );

      onSuccessRefresh();
    } catch (err: any) {
      onNotify(
        'error',
        'Margin Order Reverted',
        err?.message || 'Unable to execute DeepBook Margin order.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="panel-carbon rounded-2xl p-4 flex flex-col justify-between gap-3.5 h-full">
      <div className="space-y-3.5">
        {/* Long / Short Toggle */}
        <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-[#0B1017] border border-white/[0.08]">
          <button
            type="button"
            onClick={() => setSide('long')}
            className={`py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5 transition-all ${
              side === 'long'
                ? 'bg-[#00D98B] text-[#04120F] shadow-[0_0_20px_rgba(0,217,139,0.28)]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            <span>Margin Long</span>
          </button>
          <button
            type="button"
            onClick={() => setSide('short')}
            className={`py-2.5 rounded-lg text-sm font-bold flex items-center justify-center gap-1.5 transition-all ${
              side === 'short'
                ? 'bg-[#F6465D] text-white shadow-[0_0_20px_rgba(246,70,93,0.28)]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <TrendingDown className="w-4 h-4" />
            <span>Margin Short</span>
          </button>
        </div>

        {/* Market / Limit Order Sub-Tabs */}
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex rounded-xl bg-[#0A0C10] border border-white/[0.08] p-1">
            {(['market', 'limit'] as const).map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => setOrderStyle(style)}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold capitalize transition-all ${
                  orderStyle === style
                    ? 'bg-[#D7F626]/15 text-[#D7F626] border border-[#D7F626]/35'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {style}
              </button>
            ))}
          </div>

          <span className="text-xs font-mono text-[#D7F626]">
            {riskConfig
              ? `APR ${
                  side === 'long'
                    ? riskConfig.quoteBorrowAprPct.toFixed(2)
                    : riskConfig.baseBorrowAprPct.toFixed(2)
                }%`
              : 'Live APR'}
          </span>
        </div>

        {/* Collateral Input + Asset Toggle */}
        <div className="panel-carbon-sub rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-300">
            <span className="font-medium">Collateral Deposit</span>
            <button
              type="button"
              onClick={() => setCollateralSide((prev) => (prev === 'quote' ? 'base' : 'quote'))}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-[#D7F626] font-mono font-semibold"
            >
              <ArrowUpDown className="w-3 h-3" />
              <span>{collateralSide === 'quote' ? pool.quoteSymbol : pool.baseSymbol}</span>
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <input
              type="number"
              min="0"
              step="any"
              value={collateralInput}
              onChange={(e) => setCollateralInput(e.target.value)}
              placeholder="0.00"
              className="w-full bg-transparent text-lg font-mono font-bold tabular-nums text-white outline-none"
            />
            <button
              type="button"
              onClick={() => {
                const bal = collateralSide === 'quote' ? walletQuoteBal : walletBaseBal;
                const reserve = collateralSide === 'base' && pool.baseSymbol === 'SUI' ? 0.15 : 0;
                const usable = Math.max(0, bal - reserve);
                setCollateralInput(usable > 0 ? usable.toFixed(3) : '0');
              }}
              className="text-xs font-mono px-2.5 py-1 rounded-lg bg-[#D7F626]/15 text-[#D7F626] hover:bg-[#D7F626]/25 font-semibold shrink-0"
            >
              MAX (
              {(collateralSide === 'quote' ? walletQuoteBal : walletBaseBal).toFixed(2)})
            </button>
          </div>
        </div>

        {/* Leverage Slider (Live Risk Ratio Safe) */}
        <div className="panel-carbon-sub rounded-xl p-3 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300 font-medium">Spot Margin Leverage</span>
            <span className="font-mono font-bold text-[#D7F626] text-sm">
              {leverage.toFixed(1)}x{' '}
              <span className="text-slate-400 text-xs font-normal">/ {maxLev.toFixed(1)}x max</span>
            </span>
          </div>
          <input
            type="range"
            min="1.1"
            max={maxLev}
            step="0.1"
            value={leverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            className="w-full carbon-slider"
          />
          <div className="grid grid-cols-4 gap-1.5">
            {[1.5, 2.0, 3.0, Number(Math.min(maxLev, 4.5).toFixed(1))].map((lv) => (
              <button
                key={lv}
                type="button"
                onClick={() => setLeverage(lv)}
                className={`py-1 rounded-lg text-xs font-mono font-semibold transition-all ${
                  Math.abs(leverage - lv) < 0.05
                    ? 'bg-[#D7F626]/20 text-[#D7F626] border border-[#D7F626]/40'
                    : 'bg-white/[0.04] hover:bg-white/[0.08] text-slate-300'
                }`}
              >
                {lv.toFixed(1)}x
              </button>
            ))}
          </div>
        </div>

        {/* Limit Price Input when Limit selected */}
        {orderStyle === 'limit' && (
          <div className="panel-carbon-sub rounded-xl p-3 space-y-1.5">
            <div className="flex justify-between text-xs text-slate-300">
              <span>Limit Execution Price</span>
              <button
                type="button"
                onClick={() => midPrice > 0 && setLimitPriceInput(midPrice.toFixed(4))}
                className="text-[#D7F626] font-mono hover:underline"
              >
                Mid {midPrice > 0 ? midPrice.toFixed(4) : ''}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <input
                type="number"
                min="0"
                step="any"
                value={limitPriceInput}
                onChange={(e) => setLimitPriceInput(e.target.value)}
                placeholder="0.0000"
                className="w-full bg-transparent text-base font-mono tabular-nums text-white outline-none"
              />
              <span className="text-xs font-mono text-slate-400">{pool.quoteSymbol}</span>
            </div>
          </div>
        )}

        {/* Atomic On-Chain Conditional TP / SL Toggle */}
        <div className="space-y-2">
          <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
            <span className="font-medium">Attach On-Chain TP / SL (DeepBook TPSL)</span>
            <input
              type="checkbox"
              checked={enableTpSl}
              onChange={(e) => setEnableTpSl(e.target.checked)}
              className="accent-[#D7F626] w-4 h-4"
            />
          </label>

          {enableTpSl && (
            <div className="grid grid-cols-2 gap-2">
              <div className="panel-carbon-sub rounded-xl p-2.5 space-y-1">
                <div className="text-xs text-[#00E599] font-medium">Take Profit</div>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={tpPriceInput}
                  onChange={(e) => setTpPriceInput(e.target.value)}
                  placeholder={midPrice > 0 ? (midPrice * (side === 'long' ? 1.15 : 0.85)).toFixed(3) : 'TP'}
                  className="w-full bg-transparent text-sm font-mono tabular-nums text-white outline-none"
                />
              </div>
              <div className="panel-carbon-sub rounded-xl p-2.5 space-y-1">
                <div className="text-xs text-[#FF5E7A] font-medium">Stop Loss</div>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={slPriceInput}
                  onChange={(e) => setSlPriceInput(e.target.value)}
                  placeholder={midPrice > 0 ? (midPrice * (side === 'long' ? 0.9 : 1.1)).toFixed(3) : 'SL'}
                  className="w-full bg-transparent text-sm font-mono tabular-nums text-white outline-none"
                />
              </div>
            </div>
          )}
        </div>

        {/* Metrics Summary */}
        <div className="rounded-xl bg-[#0B1017] border border-white/[0.08] p-3 space-y-1.5 text-xs font-mono">
          <div className="flex justify-between">
            <span className="text-slate-400">Borrowed from MarginPool</span>
            <span className="text-white font-semibold tabular-nums">
              {borrowAmount.toFixed(3)} {side === 'long' ? pool.quoteSymbol : pool.baseSymbol}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">CLOB Position Size</span>
            <span className="text-[#D7F626] font-bold tabular-nums">
              {orderQuantityBase.toFixed(3)} {pool.baseSymbol}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Est. Risk Ratio / Liq Floor</span>
            <span
              className={`font-semibold tabular-nums ${
                projectedRiskRatio >= 1.35 ? 'text-[#00E599]' : 'text-amber-400'
              }`}
            >
              {projectedRiskRatio >= 50 ? 'Safe' : `${projectedRiskRatio.toFixed(2)}x`} /{' '}
              {(riskConfig?.liquidationRiskRatio ?? 1.1).toFixed(2)}x
            </span>
          </div>
        </div>

        {(belowMinBorrow || exceedsLiquidity) && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-500/15 border border-amber-500/30 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              {exceedsLiquidity
                ? `Available ${side === 'long' ? pool.quoteSymbol : pool.baseSymbol} MarginPool liquidity is lower than requested borrow.`
                : `Borrow amount (${borrowAmount.toFixed(3)}) is below pool minimum (${minBorrowThreshold}).`}
            </span>
          </div>
        )}
      </div>

      <button
        type="button"
        disabled={
          isSubmitting ||
          !account?.address ||
          belowMinQty ||
          belowMinBorrow ||
          exceedsLiquidity
        }
        onClick={handleOpenMarginPosition}
        className={`w-full py-3.5 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-45 ${
          side === 'long'
            ? 'bg-[#00D98B] hover:bg-[#12E89B] text-[#05120D] shadow-[0_0_24px_rgba(0,217,139,0.28)]'
            : 'bg-[#F6465D] text-white shadow-[0_0_22px_rgba(246,70,93,0.3)] hover:bg-[#ff566c]'
        }`}
      >
        {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
        <span>
          {!account?.address
            ? 'Connect Wallet for Margin'
            : isSubmitting
              ? 'Submitting Atomic Margin PTB...'
              : `${position ? 'Increase' : 'Open'} ${leverage.toFixed(1)}x ${
                  side === 'long' ? 'Margin Long' : 'Margin Short'
                }`}
        </span>
      </button>
    </div>
  );
};

interface DeepBookMarginAccountBarProps {
  pool: DeepBookPoolMeta;
  position: MarginManagerPosition | null;
  riskConfig: MarginPoolRiskConfig | null;
  isLoading: boolean;
  onRefresh: () => void;
  onNotify: (
    type: 'success' | 'error' | 'info' | 'warning',
    title: string,
    message: string,
    actionLabel?: string,
    actionUrl?: string
  ) => void;
}

export const DeepBookMarginAccountBar: React.FC<DeepBookMarginAccountBarProps> = ({
  pool,
  position,
  riskConfig,
  isLoading,
  onRefresh,
  onNotify,
}) => {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [withdrawAsset, setWithdrawAsset] = useState<'base' | 'quote'>('quote');
  const [withdrawAmt, setWithdrawAmt] = useState<string>('');

  const runAction = async (label: string, buildFn: () => ReturnType<typeof buildMarginRepayTx>) => {
    if (!account?.address) return;
    setBusyAction(label);
    try {
      const tx = buildFn();
      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) throw new Error(sim.errorMessage || `${label} simulation failed`);
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      onNotify(
        'success',
        `${label} Complete`,
        `Confirmed on Sui Mainnet DeepBook Margin.`,
        digest ? 'View on Suiscan' : undefined,
        digest ? `https://suiscan.xyz/mainnet/tx/${digest}` : undefined
      );
      onRefresh();
    } catch (err: any) {
      onNotify('error', `${label} Failed`, err?.message || 'Transaction aborted.');
    } finally {
      setBusyAction(null);
    }
  };

  if (!account?.address) {
    return (
      <div className="panel-carbon rounded-2xl p-5 flex items-center justify-between">
        <div className="space-y-1">
          <div className="text-sm font-bold text-white">DeepBook v3 Margin Manager</div>
          <p className="text-xs text-slate-300">
            Connect your wallet to inspect isolated MarginManager health, debt, open orders, and conditional TP/SL triggers.
          </p>
        </div>
        <span className="text-xs font-mono px-3 py-1.5 rounded-lg bg-[#D7F626]/15 text-[#D7F626] border border-[#D7F626]/30">
          1-TX Atomic Setup
        </span>
      </div>
    );
  }

  const hasDebt = Boolean(position && (position.baseDebt > 0 || position.quoteDebt > 0));
  const closeQty = position
    ? position.quoteDebt > 0
      ? Math.max(0, position.baseAsset - pool.minSize * 0.05)
      : position.baseDebt
    : 0;

  return (
    <div className="panel-carbon rounded-2xl p-4 sm:p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-white">
            Isolated Margin Manager ({pool.poolName.replace('_', '/')})
          </span>
          {position ? (
            <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-[#D7F626]/15 text-[#D7F626] border border-[#D7F626]/30">
              {position.managerId.slice(0, 8)}...{position.managerId.slice(-6)}
            </span>
          ) : (
            <span className="text-xs font-mono text-slate-400">
              Auto-created in 1 TX on your first trade
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-[#0A0C10] border border-white/[0.1] text-slate-200 hover:border-[#D7F626]/40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Position</span>
        </button>
      </div>

      {position ? (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
          {/* Health + Assets & Debts */}
          <div className="xl:col-span-5 grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs font-mono">
            <div className="panel-carbon-sub rounded-xl p-3">
              <div className="text-slate-400 mb-1 font-sans">Risk Ratio</div>
              <div
                className={`text-base font-bold ${
                  position.riskRatio === 0 || position.riskRatio >= 1.5
                    ? 'text-[#00E599]'
                    : position.riskRatio >= (riskConfig?.minBorrowRiskRatio ?? 1.25)
                      ? 'text-amber-300'
                      : 'text-[#FF5E7A]'
                }`}
              >
                {hasDebt ? `${position.riskRatio.toFixed(2)}x` : 'No Debt'}
              </div>
            </div>
            <div className="panel-carbon-sub rounded-xl p-3">
              <div className="text-slate-400 mb-1 font-sans">{pool.baseSymbol} Asset / Debt</div>
              <div className="text-sm font-bold text-white">{position.baseAsset.toFixed(4)}</div>
              <div className="text-xs text-[#FF5E7A]">Debt: {position.baseDebt.toFixed(4)}</div>
            </div>
            <div className="panel-carbon-sub rounded-xl p-3">
              <div className="text-slate-400 mb-1 font-sans">{pool.quoteSymbol} Asset / Debt</div>
              <div className="text-sm font-bold text-white">{position.quoteAsset.toFixed(4)}</div>
              <div className="text-xs text-[#FF5E7A]">Debt: {position.quoteDebt.toFixed(4)}</div>
            </div>
          </div>

          {/* Open Margin Orders & TP/SL */}
          <div className="xl:col-span-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-300">
              <span>
                Open Orders ({position.openOrders.length}) · Conditional TP/SL (
                {position.conditionalOrderIds.length})
              </span>
              {position.conditionalOrderIds.length > 0 && (
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() =>
                    runAction('Cancel TP/SL', () =>
                      buildMarginCancelTx({
                        owner: account.address,
                        pool,
                        managerId: position.managerId,
                        clearConditionalTpSl: true,
                      })
                    )
                  }
                  className="text-xs font-mono text-[#FF5E7A] hover:underline"
                >
                  Clear TP/SL
                </button>
              )}
            </div>

            {position.openOrders.length === 0 ? (
              <div className="panel-carbon-sub rounded-xl px-3 py-2.5 text-xs text-slate-400">
                No resting margin limit orders.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-28 overflow-y-auto">
                {position.openOrders.map((ord) => (
                  <div
                    key={ord.orderId}
                    className="panel-carbon-sub rounded-xl px-3 py-2 flex items-center justify-between text-xs font-mono"
                  >
                    <span className={ord.isBid ? 'text-[#00E599] font-bold' : 'text-[#FF5E7A] font-bold'}>
                      {ord.isBid ? 'LONG' : 'SHORT'} {ord.quantity.toFixed(2)} @ {ord.price.toFixed(4)}
                    </span>
                    <button
                      type="button"
                      disabled={busyAction !== null}
                      onClick={() =>
                        runAction('Cancel Order', () =>
                          buildMarginCancelTx({
                            owner: account.address,
                            pool,
                            managerId: position.managerId,
                            orderId: ord.orderId,
                          })
                        )
                      }
                      className="text-slate-300 hover:text-white inline-flex items-center gap-1"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Cancel</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Close & Repay + Withdraw Collateral */}
          <div className="xl:col-span-3 space-y-2">
            <div className="flex gap-2">
              {position.quoteDebt > 0 && closeQty >= pool.minSize && (
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() =>
                    runAction('Close Long & Repay', () =>
                      buildMarginCloseAndRepayTx({
                        owner: account.address,
                        pool,
                        managerId: position.managerId,
                        closeDirection: 'sellBaseToRepayQuote',
                        quantityBase: Number(closeQty.toFixed(4)),
                      })
                    )
                  }
                  className="flex-1 py-2 px-3 rounded-xl bg-[#F6465D]/20 border border-[#F6465D]/40 text-[#FF5E7A] text-xs font-bold hover:bg-[#F6465D]/30"
                >
                  Close & Repay
                </button>
              )}
              {position.baseDebt > 0 && position.baseDebt >= pool.minSize && (
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() =>
                    runAction('Close Short & Repay', () =>
                      buildMarginCloseAndRepayTx({
                        owner: account.address,
                        pool,
                        managerId: position.managerId,
                        closeDirection: 'buyBaseToRepayBase',
                        quantityBase: Number(position.baseDebt.toFixed(4)),
                      })
                    )
                  }
                  className="flex-1 py-2 px-3 rounded-xl bg-[#D7F626]/20 border border-[#D7F626]/40 text-[#D7F626] text-xs font-bold hover:bg-[#D7F626]/30"
                >
                  Close & Repay
                </button>
              )}
              {hasDebt && (
                <button
                  type="button"
                  disabled={busyAction !== null}
                  onClick={() =>
                    runAction('Repay Debt', () =>
                      buildMarginRepayTx({
                        owner: account.address,
                        pool,
                        managerId: position.managerId,
                        debtSide: position.quoteDebt > 0 ? 'quote' : 'base',
                      })
                    )
                  }
                  className="py-2 px-3 rounded-xl bg-white/[0.06] border border-white/[0.12] text-white text-xs font-semibold hover:bg-white/[0.12]"
                >
                  Repay All
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setWithdrawAsset((prev) => (prev === 'quote' ? 'base' : 'quote'))}
                className="px-2.5 py-2 rounded-lg bg-[#0A0C10] border border-white/[0.1] text-xs font-mono text-[#D7F626]"
              >
                {withdrawAsset === 'quote' ? pool.quoteSymbol : pool.baseSymbol}
              </button>
              <input
                type="number"
                min="0"
                step="any"
                value={withdrawAmt}
                onChange={(e) => setWithdrawAmt(e.target.value)}
                placeholder="Withdraw amt"
                className="flex-1 min-w-0 px-2.5 py-2 rounded-lg bg-[#0A0C10] border border-white/[0.1] text-xs font-mono text-white outline-none"
              />
              <button
                type="button"
                disabled={busyAction !== null || !(Number(withdrawAmt) > 0)}
                onClick={() =>
                  runAction('Withdraw Collateral', () =>
                    buildMarginWithdrawCollateralTx({
                      owner: account.address,
                      pool,
                      managerId: position.managerId,
                      asset: withdrawAsset,
                      amount: Number(withdrawAmt),
                    })
                  )
                }
                className="px-3 py-2 rounded-lg bg-white/[0.08] hover:bg-white/[0.16] text-xs font-bold text-white disabled:opacity-40"
              >
                Withdraw
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-300">
          <div className="inline-flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-[#D7F626]" />
            <span>
              Available {pool.baseSymbol} Liquidity:{' '}
              <strong className="text-white font-mono">
                {riskConfig ? riskConfig.baseAvailableLiquidity.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}
              </strong>{' '}
              · Available {pool.quoteSymbol}:{' '}
              <strong className="text-white font-mono">
                {riskConfig ? riskConfig.quoteAvailableLiquidity.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}
              </strong>
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 text-[#00E599] font-mono">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Non-custodial Isolated MarginManager (up to {riskConfig?.maxLeverageSafe ?? 4.5}x)
          </span>
        </div>
      )}
    </div>
  );
};

export async function loadMarginWorkspaceData(owner: string | undefined, pool: DeepBookPoolMeta) {
  const [riskConfig, position] = await Promise.all([
    fetchMarginPoolConfig(pool.poolName).catch(() => null),
    owner ? fetchMarginPositionForPool(owner, pool).catch(() => null) : Promise.resolve(null),
  ]);
  return { riskConfig, position };
}
