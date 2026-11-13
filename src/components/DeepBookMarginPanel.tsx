import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpDown,
  ArrowUpFromLine,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import {
  buildDeepBookMarginOrderTx,
  buildMarginAttachTpSlTx,
  buildMarginCancelTx,
  buildMarginCloseAndRepayTx,
  buildMarginDepositCollateralTx,
  buildMarginRepayTx,
  buildMarginWithdrawCollateralTx,
  computeMarginHealthMetrics,
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
  const [showMarginVaultModal, setShowMarginVaultModal] = useState<'deposit' | 'withdraw' | null>(null);
  const [vaultAssetSide, setVaultAssetSide] = useState<'quote' | 'base'>('quote');
  const [vaultAmt, setVaultAmt] = useState<string>('');
  const [isVaultBusy, setIsVaultBusy] = useState<boolean>(false);

  const handleMarginVaultSubmit = async (mode: 'deposit' | 'withdraw') => {
    if (!account?.address) return;
    const amt = Number(vaultAmt);
    if (!Number.isFinite(amt) || amt <= 0) return;
    if (mode === 'withdraw' && !position?.managerId) return;
    setIsVaultBusy(true);
    try {
      const tx =
        mode === 'deposit'
          ? buildMarginDepositCollateralTx({
              owner: account.address,
              pool,
              managerId: position?.managerId ?? null,
              assetSide: vaultAssetSide,
              amount: amt,
            })
          : buildMarginWithdrawCollateralTx({
              owner: account.address,
              pool,
              managerId: position!.managerId,
              asset: vaultAssetSide,
              amount: amt,
            });
      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) {
        throw new Error(sim.errorMessage || `Margin ${mode} simulation failed.`);
      }
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      onNotify(
        'success',
        mode === 'deposit'
          ? position?.managerId
            ? 'Margin Collateral Deposited'
            : 'Margin Vault Created & Funded'
          : 'Margin Collateral Withdrawn',
        `${amt} ${vaultAssetSide === 'base' ? pool.baseSymbol : pool.quoteSymbol} ${
          mode === 'deposit' ? 'deposited to' : 'withdrawn from'
        } isolated MarginManager.`,
        digest ? 'View on Suiscan' : undefined,
        digest ? `https://suiscan.xyz/mainnet/tx/${digest}` : undefined
      );
      setVaultAmt('');
      setShowMarginVaultModal(null);
      onSuccessRefresh();
    } catch (err: any) {
      onNotify(
        'error',
        `Margin ${mode === 'deposit' ? 'Deposit' : 'Withdraw'} Failed`,
        err?.message || `Unable to ${mode} collateral.`
      );
    } finally {
      setIsVaultBusy(false);
    }
  };

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
    <div className="bg-[#000000] p-3 flex flex-col gap-3">
      {/* Compact Isolated Margin Vault Banner (Direct Deposit / Withdraw) */}
      <div className="bg-[#06070A] border border-[#1E232D] hover:border-[#2B7FFF]/40 rounded-lg px-2.5 py-2 space-y-2 text-xs transition-colors">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <ShieldCheck className="w-3.5 h-3.5 text-[#60A5FA] shrink-0" />
            <span className="font-semibold text-white truncate">
              Margin Vault{' '}
              <span className="text-[#8E98A8] font-mono font-normal">
                ({position?.managerId ? `#${position.managerId.slice(0, 6)}...` : '1-Tx Auto'})
              </span>
            </span>
          </div>
          <span className="text-[11px] font-mono text-[#8E98A8] tabular-nums shrink-0">
            {position
              ? `${position.baseAsset.toFixed(2)} ${pool.baseSymbol} · ${position.quoteAsset.toFixed(2)} ${pool.quoteSymbol}`
              : 'Isolated 4.5x'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setShowMarginVaultModal('deposit')}
            className="py-1.5 rounded btn-deepbook text-[11px] font-bold flex items-center justify-center gap-1"
          >
            <ArrowDownToLine className="w-3.5 h-3.5" />
            <span>DEPOSIT</span>
          </button>
          <button
            type="button"
            disabled={!account || !position || isVaultBusy}
            onClick={() => setShowMarginVaultModal('withdraw')}
            className="py-1.5 rounded bg-[#10131A] hover:bg-[#171C26] border border-[#262C3B] text-[11px] font-bold text-slate-200 hover:text-white flex items-center justify-center gap-1 disabled:opacity-45 transition-colors"
          >
            <ArrowUpFromLine className="w-3.5 h-3.5" />
            <span>WITHDRAW</span>
          </button>
        </div>
      </div>

      <div className="space-y-2.5">
        {/* Long / Short Toggle */}
        <div className="grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={() => setSide('long')}
            className={`py-2 rounded-md text-xs font-extrabold uppercase tracking-wide flex items-center justify-center gap-1.5 transition-all border ${
              side === 'long'
                ? 'bg-[#08D189]/20 text-[#08D189] border-[#08D189] shadow-[inset_0_0_12px_rgba(8,209,137,0.14)]'
                : 'bg-[#06070A] text-[#94A3B8] hover:text-white border-[#1E232D]'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Margin Long</span>
          </button>
          <button
            type="button"
            onClick={() => setSide('short')}
            className={`py-2 rounded-md text-xs font-extrabold uppercase tracking-wide flex items-center justify-center gap-1.5 transition-all border ${
              side === 'short'
                ? 'bg-[#F0525E]/20 text-[#F0525E] border-[#F0525E] shadow-[inset_0_0_12px_rgba(240,82,94,0.14)]'
                : 'bg-[#06070A] text-[#94A3B8] hover:text-white border-[#1E232D]'
            }`}
          >
            <TrendingDown className="w-3.5 h-3.5" />
            <span>Margin Short</span>
          </button>
        </div>

        {/* Market / Limit Order Sub-Tabs */}
        <div className="flex items-center justify-between gap-2 border-b border-[#1A1E26] pb-1.5">
          <div className="inline-flex items-center gap-3">
            {(['market', 'limit'] as const).map((style) => (
              <button
                key={style}
                type="button"
                onClick={() => setOrderStyle(style)}
                className={`pb-1 text-xs font-semibold capitalize transition-all border-b-2 -mb-[7px] ${
                  orderStyle === style
                    ? 'border-[#2B7FFF] text-white'
                    : 'border-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                {style}
              </button>
            ))}
          </div>

          <span className="text-[11px] font-mono text-[#60A5FA]">
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
        <div className="bg-[#06070A] border border-[#1A1E26] focus-within:border-[#2B7FFF]/60 rounded-lg p-2.5 space-y-1.5 transition-colors">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="font-medium">Collateral Deposit</span>
            <button
              type="button"
              onClick={() => setCollateralSide((prev) => (prev === 'quote' ? 'base' : 'quote'))}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#0C0E13] border border-[#1A1E26] hover:border-[#2B7FFF]/40 text-[#60A5FA] font-mono font-semibold text-[11px]"
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
              className="text-[11px] font-mono px-2 py-1 rounded bg-[#2B7FFF]/15 text-[#60A5FA] hover:bg-[#2B7FFF]/25 font-semibold shrink-0"
            >
              MAX (
              {(collateralSide === 'quote' ? walletQuoteBal : walletBaseBal).toFixed(2)})
            </button>
          </div>
        </div>

        {/* Leverage Slider (Live Risk Ratio Safe) */}
        <div className="bg-[#06070A] border border-[#1A1E26] rounded-lg p-2.5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 font-medium">Spot Margin Leverage</span>
            <span className="font-mono font-bold text-[#60A5FA] text-sm">
              {leverage.toFixed(1)}x{' '}
              <span className="text-slate-500 text-xs font-normal">/ {maxLev.toFixed(1)}x max</span>
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
          <div className="grid grid-cols-4 gap-1">
            {[1.5, 2.0, 3.0, Number(Math.min(maxLev, 4.5).toFixed(1))].map((lv) => (
              <button
                key={lv}
                type="button"
                onClick={() => setLeverage(lv)}
                className={`py-1 rounded text-[11px] font-mono font-semibold transition-all border ${
                  Math.abs(leverage - lv) < 0.05
                    ? 'bg-[#2B7FFF]/18 text-[#60A5FA] border-[#2B7FFF]/45'
                    : 'bg-[#0C0E13] hover:bg-[#12151C] text-slate-400 border-[#1A1E26]'
                }`}
              >
                {lv.toFixed(1)}x
              </button>
            ))}
          </div>
        </div>

        {/* Limit Price Input when Limit selected */}
        {orderStyle === 'limit' && (
          <div className="bg-[#06070A] border border-[#1A1E26] focus-within:border-[#2B7FFF]/60 rounded-lg p-2.5 space-y-1 transition-colors">
            <div className="flex justify-between text-xs text-slate-400">
              <span>Limit Execution Price</span>
              <button
                type="button"
                onClick={() => midPrice > 0 && setLimitPriceInput(midPrice.toFixed(4))}
                className="text-[#60A5FA] font-mono hover:underline"
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
          <label className="flex items-center justify-between text-xs text-slate-300 cursor-pointer">
            <span className="font-medium">Attach On-Chain TP / SL (DeepBook TPSL)</span>
            <input
              type="checkbox"
              checked={enableTpSl}
              onChange={(e) => setEnableTpSl(e.target.checked)}
              className="accent-[#2B7FFF] w-4 h-4"
            />
          </label>

          {enableTpSl && (
            <div className="grid grid-cols-2 gap-1.5">
              <div className="bg-[#06070A] border border-[#1A1E26] focus-within:border-[#08D189]/60 rounded-lg p-2 space-y-1">
                <div className="text-[11px] text-[#08D189] font-medium">Take Profit</div>
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
              <div className="bg-[#06070A] border border-[#1A1E26] focus-within:border-[#F0525E]/60 rounded-lg p-2 space-y-1">
                <div className="text-[11px] text-[#F0525E] font-medium">Stop Loss</div>
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
        <div className="rounded-lg bg-[#06070A] border border-[#1A1E26] p-2.5 space-y-1.5 text-xs font-mono">
          <div className="flex justify-between">
            <span className="text-slate-400">Borrowed from MarginPool</span>
            <span className="text-white font-semibold tabular-nums">
              {borrowAmount.toFixed(3)} {side === 'long' ? pool.quoteSymbol : pool.baseSymbol}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">CLOB Position Size</span>
            <span className="text-[#60A5FA] font-bold tabular-nums">
              {orderQuantityBase.toFixed(3)} {pool.baseSymbol}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Est. Risk Ratio / Liq Floor</span>
            <span
              className={`font-semibold tabular-nums ${
                projectedRiskRatio >= 1.35 ? 'text-[#08D189]' : 'text-amber-400'
              }`}
            >
              {projectedRiskRatio >= 50 ? 'Safe' : `${projectedRiskRatio.toFixed(2)}x`} /{' '}
              {(riskConfig?.liquidationRiskRatio ?? 1.1).toFixed(2)}x
            </span>
          </div>
        </div>

        {(belowMinBorrow || exceedsLiquidity) && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-500/12 border border-amber-500/30 px-2.5 py-2 text-xs text-amber-300">
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
        className={`w-full py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all disabled:opacity-45 ${
          side === 'long'
            ? 'btn-deepbook'
            : 'bg-[#F0525E] hover:bg-[#FF6370] text-white'
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

      {/* Isolated Margin Vault Deposit / Withdraw Modal */}
      {showMarginVaultModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="panel-carbon rounded-xl w-full max-w-md p-5 space-y-4 border border-[#2B7FFF]/35 animate-panel-in">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {showMarginVaultModal === 'deposit' ? (
                  <ArrowDownToLine className="w-4 h-4 text-[#2B7FFF]" />
                ) : (
                  <ArrowUpFromLine className="w-4 h-4 text-[#08D189]" />
                )}
                <h3 className="text-base font-bold text-white">
                  {showMarginVaultModal === 'deposit'
                    ? 'Deposit Isolated Margin Collateral'
                    : 'Withdraw Margin Collateral'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowMarginVaultModal(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5 bg-[#06070A] p-1 rounded-lg border border-[#1E232D]">
              <button
                type="button"
                onClick={() => setVaultAssetSide('quote')}
                className={`py-1.5 rounded text-xs font-bold transition-colors ${
                  vaultAssetSide === 'quote'
                    ? 'bg-[#2B7FFF] text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {pool.quoteSymbol}
              </button>
              <button
                type="button"
                onClick={() => setVaultAssetSide('base')}
                className={`py-1.5 rounded text-xs font-bold transition-colors ${
                  vaultAssetSide === 'base'
                    ? 'bg-[#2B7FFF] text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {pool.baseSymbol}
              </button>
            </div>

            <div className="bg-[#06070A] border border-[#1E232D] rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>
                  Amount ({vaultAssetSide === 'base' ? pool.baseSymbol : pool.quoteSymbol})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (showMarginVaultModal === 'deposit') {
                      const bal = vaultAssetSide === 'base' ? walletBaseBal : walletQuoteBal;
                      const safe =
                        vaultAssetSide === 'base' && pool.baseSymbol === 'SUI'
                          ? Math.max(0, bal - 0.05)
                          : bal;
                      if (safe > 0) setVaultAmt(safe.toFixed(4));
                    } else if (position) {
                      const avail =
                        vaultAssetSide === 'base' ? position.baseAsset : position.quoteAsset;
                      if (avail > 0) setVaultAmt((avail * 0.99).toFixed(4));
                    }
                  }}
                  className="text-[#60A5FA] hover:text-white font-mono"
                >
                  {showMarginVaultModal === 'deposit'
                    ? `Wallet: ${(vaultAssetSide === 'base' ? walletBaseBal : walletQuoteBal).toFixed(4)}`
                    : `Vault: ${(vaultAssetSide === 'base' ? position?.baseAsset ?? 0 : position?.quoteAsset ?? 0).toFixed(4)}`}{' '}
                  (MAX)
                </button>
              </div>
              <input
                type="number"
                min="0"
                step="any"
                value={vaultAmt}
                onChange={(e) => setVaultAmt(e.target.value)}
                placeholder="10.00"
                className="w-full bg-transparent text-xl font-bold font-mono text-white outline-none"
              />
            </div>

            {!position && showMarginVaultModal === 'deposit' && (
              <div className="text-[11px] font-mono text-[#60A5FA] bg-[#2B7FFF]/10 border border-[#2B7FFF]/30 rounded-lg px-3 py-2">
                No {pool.poolName} MarginManager yet — creates, funds &amp; shares your isolated margin vault in 1 atomic TX.
              </div>
            )}

            <button
              type="button"
              disabled={
                isVaultBusy ||
                !account ||
                !vaultAmt ||
                Number(vaultAmt) <= 0 ||
                (showMarginVaultModal === 'withdraw' && !position)
              }
              onClick={() => handleMarginVaultSubmit(showMarginVaultModal)}
              className="w-full py-2.5 rounded-lg btn-deepbook text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-45"
            >
              {isVaultBusy && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>
                {!account
                  ? 'Connect Wallet'
                  : showMarginVaultModal === 'deposit'
                    ? position
                      ? `Deposit ${vaultAssetSide === 'base' ? pool.baseSymbol : pool.quoteSymbol}`
                      : `Create Vault & Deposit ${vaultAssetSide === 'base' ? pool.baseSymbol : pool.quoteSymbol}`
                    : `Withdraw ${vaultAssetSide === 'base' ? pool.baseSymbol : pool.quoteSymbol}`}
              </span>
            </button>
          </div>
        </div>
      )}
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
  const [dockTab, setDockTab] = useState<'position' | 'liquidity'>('position');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [withdrawAsset, setWithdrawAsset] = useState<'base' | 'quote'>('quote');
  const [withdrawAmt, setWithdrawAmt] = useState<string>('');
  const [collatAsset, setCollatAsset] = useState<'base' | 'quote'>('quote');
  const [collatAmt, setCollatAmt] = useState<string>('');
  const [tpTriggerInput, setTpTriggerInput] = useState<string>('');
  const [slTriggerInput, setSlTriggerInput] = useState<string>('');
  const [tpSlSide, setTpSlSide] = useState<'long' | 'short'>('long');

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
      setCollatAmt('');
      setTpTriggerInput('');
      setSlTriggerInput('');
      onRefresh();
    } catch (err: any) {
      onNotify('error', `${label} Failed`, err?.message || 'Transaction aborted.');
    } finally {
      setBusyAction(null);
    }
  };

  const liquidityCards = (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs font-mono tabular-nums">
      <div className="rounded-md bg-[#06070A] border border-[#1E232D] p-2.5">
        <div className="text-[11px] text-[#8E98A8] mb-1">Pool Liquidity ({pool.baseSymbol})</div>
        <div className="text-white font-bold text-sm">
          {riskConfig
            ? riskConfig.baseAvailableLiquidity.toLocaleString(undefined, { maximumFractionDigits: 1 })
            : '—'}{' '}
          <span className="text-[11px] text-[#8E98A8] font-normal">{pool.baseSymbol}</span>
        </div>
        <div className="text-[11px] text-[#60A5FA] mt-0.5">
          Borrow APR {riskConfig ? `${riskConfig.baseBorrowAprPct.toFixed(2)}%` : '—'}
        </div>
      </div>
      <div className="rounded-md bg-[#06070A] border border-[#1E232D] p-2.5">
        <div className="text-[11px] text-[#8E98A8] mb-1">Pool Liquidity ({pool.quoteSymbol})</div>
        <div className="text-white font-bold text-sm">
          {riskConfig
            ? riskConfig.quoteAvailableLiquidity.toLocaleString(undefined, { maximumFractionDigits: 1 })
            : '—'}{' '}
          <span className="text-[11px] text-[#8E98A8] font-normal">{pool.quoteSymbol}</span>
        </div>
        <div className="text-[11px] text-[#60A5FA] mt-0.5">
          Borrow APR {riskConfig ? `${riskConfig.quoteBorrowAprPct.toFixed(2)}%` : '—'}
        </div>
      </div>
      <div className="rounded-md bg-[#06070A] border border-[#1E232D] p-2.5">
        <div className="text-[11px] text-[#8E98A8] mb-1">Risk Ratio Thresholds</div>
        <div className="text-white font-bold text-sm">
          Open {(riskConfig?.minOpenRiskRatio ?? 1.18).toFixed(2)}x · Borrow{' '}
          {(riskConfig?.minBorrowRiskRatio ?? 1.25).toFixed(2)}x
        </div>
        <div className="text-[11px] text-[#F0525E] mt-0.5">
          Liq Floor {(riskConfig?.liquidationRiskRatio ?? 1.1).toFixed(2)}x
        </div>
      </div>
      <div className="rounded-md bg-[#06070A] border border-[#1E232D] p-2.5">
        <div className="text-[11px] text-[#8E98A8] mb-1">Custody &amp; Max Leverage</div>
        <div className="text-[#08D189] font-bold text-sm">
          Up to {(riskConfig?.maxLeverageSafe ?? 4.5).toFixed(1)}x Isolated
        </div>
        <div className="text-[11px] text-[#8E98A8] mt-0.5">
          1-TX Atomic MarginManager
        </div>
      </div>
    </div>
  );

  if (!account?.address) {
    return (
      <div className="bg-[#000000] p-3.5 sm:p-4 space-y-3 min-h-[210px]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1A1E26] pb-2">
          <div className="flex items-center gap-4 text-xs font-mono">
            <span className="pb-1 border-b-2 border-[#2B7FFF] text-white font-semibold -mb-[9px]">
              Isolated Margin Manager ({pool.poolName.replace('_', '/')})
            </span>
            <span className="text-[#8E98A8]">Connect wallet for 1-TX atomic position setup</span>
          </div>
          <span className="text-[11px] font-mono px-2.5 py-0.5 rounded bg-[#2B7FFF]/15 text-[#60A5FA] border border-[#2B7FFF]/35">
            DeepBook v3 MarginRegistry
          </span>
        </div>
        {liquidityCards}
      </div>
    );
  }

  const hasDebt = Boolean(position && (position.baseDebt > 0 || position.quoteDebt > 0));
  const healthMetrics = computeMarginHealthMetrics(position, riskConfig);
  const defaultCloseQty = position
    ? healthMetrics.inferredSide === 'long'
      ? Math.max(pool.minSize, position.baseAsset)
      : Math.max(
          pool.minSize,
          position.baseDebt > 0
            ? position.baseDebt
            : position.quoteAsset / Math.max(0.0001, position.basePythPriceUsd)
        )
    : pool.minSize;
  const closeQty = position
    ? position.quoteDebt > 0
      ? Math.max(0, position.baseAsset - pool.minSize * 0.05)
      : position.baseDebt
    : 0;

  return (
    <div className="bg-[#000000] p-3.5 sm:p-4 space-y-3.5 min-h-[210px]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1A1E26] pb-2">
        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={() => setDockTab('position')}
            className={`pb-1 text-xs font-mono border-b-2 -mb-[9px] transition-colors ${
              dockTab === 'position'
                ? 'border-[#2B7FFF] text-white font-semibold'
                : 'border-transparent text-[#8E98A8] hover:text-white'
            }`}
          >
            Margin Position ({position ? 'Active' : '0'})
          </button>
          <button
            type="button"
            onClick={() => setDockTab('liquidity')}
            className={`pb-1 text-xs font-mono border-b-2 -mb-[9px] transition-colors ${
              dockTab === 'liquidity'
                ? 'border-[#2B7FFF] text-white font-semibold'
                : 'border-transparent text-[#8E98A8] hover:text-white'
            }`}
          >
            MarginPool Liquidity &amp; Rules
          </button>
          {position ? (
            <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#2B7FFF]/15 text-[#60A5FA] border border-[#2B7FFF]/35">
              {position.managerId.slice(0, 8)}...{position.managerId.slice(-6)}
            </span>
          ) : (
            <span className="text-[11px] font-mono text-[#8E98A8]">
              1-TX auto-created on first trade
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded bg-[#06070A] border border-[#1E232D] text-slate-300 hover:border-[#2B7FFF]/50 hover:text-white transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh Position</span>
        </button>
      </div>

      {dockTab === 'liquidity' ? (
        liquidityCards
      ) : position ? (
        <div className="space-y-3">
          {/* Live Health Factor Gauge + Est. Liquidation + Standalone Pro Controls */}
          <div className="rounded-lg bg-[#06070A] border border-[#1A1E26] p-3 grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
            <div className="lg:col-span-4 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400 font-medium">Margin Health Gauge</span>
                <span
                  className={`font-mono font-bold tabular-nums ${
                    healthMetrics.status === 'healthy'
                      ? 'text-[#08D189]'
                      : healthMetrics.status === 'caution'
                        ? 'text-amber-400'
                        : 'text-[#F0525E]'
                  }`}
                >
                  {hasDebt
                    ? `${healthMetrics.riskRatio.toFixed(2)}x (${healthMetrics.healthBufferPct.toFixed(1)}% buffer)`
                    : 'Healthy · 0 Debt'}
                </span>
              </div>
              <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    healthMetrics.status === 'healthy'
                      ? 'bg-gradient-to-r from-[#2B7FFF] to-[#08D189]'
                      : healthMetrics.status === 'caution'
                        ? 'bg-amber-400'
                        : 'bg-[#F0525E]'
                  }`}
                  style={{ width: `${Math.round(healthMetrics.barProgressPct)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 tabular-nums">
                <span>Liq Floor: {healthMetrics.liquidationRiskRatio.toFixed(2)}x</span>
                <span>
                  {healthMetrics.estLiquidationPrice !== null
                    ? `Est. Liq $${healthMetrics.estLiquidationPrice.toFixed(3)} (${healthMetrics.distanceToLiqPct?.toFixed(1)}%)`
                    : `Net Equity $${healthMetrics.netEquityUsd.toFixed(2)}`}
                </span>
              </div>
            </div>

            <div className="lg:col-span-4 flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded p-0.5 bg-[#000000] border border-[#1A1E26] text-[11px] font-mono">
                <button
                  type="button"
                  onClick={() => setCollatAsset('quote')}
                  className={`px-2 py-1 rounded ${
                    collatAsset === 'quote' ? 'bg-[#2B7FFF]/20 text-[#60A5FA]' : 'text-slate-400'
                  }`}
                >
                  {pool.quoteSymbol}
                </button>
                <button
                  type="button"
                  onClick={() => setCollatAsset('base')}
                  className={`px-2 py-1 rounded ${
                    collatAsset === 'base' ? 'bg-[#2B7FFF]/20 text-[#60A5FA]' : 'text-slate-400'
                  }`}
                >
                  {pool.baseSymbol}
                </button>
              </div>
              <input
                type="number"
                min="0"
                step="any"
                value={collatAmt}
                onChange={(e) => setCollatAmt(e.target.value)}
                placeholder={`Add ${collatAsset === 'quote' ? pool.quoteSymbol : pool.baseSymbol}`}
                className="w-24 px-2 py-1.5 rounded bg-[#000000] border border-[#1A1E26] text-xs font-mono text-white outline-none focus:border-[#2B7FFF]"
              />
              <button
                type="button"
                disabled={busyAction !== null || !(parseFloat(collatAmt) > 0)}
                onClick={() =>
                  runAction('Add Margin Collateral', () =>
                    buildMarginDepositCollateralTx({
                      owner: account.address,
                      pool,
                      managerId: position.managerId,
                      assetSide: collatAsset,
                      amount: parseFloat(collatAmt),
                    })
                  )
                }
                className="px-2.5 py-1.5 rounded text-xs font-semibold bg-[#2B7FFF]/18 border border-[#2B7FFF]/45 text-[#60A5FA] hover:bg-[#2B7FFF]/28 disabled:opacity-45"
              >
                {busyAction === 'Add Margin Collateral' ? '...' : '+ Collateral'}
              </button>
            </div>

            <div className="lg:col-span-4 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setTpSlSide((s) => (s === 'long' ? 'short' : 'long'))}
                className={`px-2 py-1.5 rounded text-[11px] font-mono border ${
                  tpSlSide === 'long'
                    ? 'bg-[#08D189]/15 border-[#08D189]/35 text-[#08D189]'
                    : 'bg-[#F0525E]/15 border-[#F0525E]/35 text-[#F0525E]'
                }`}
                title="Click to toggle Close Long vs Close Short TP/SL direction"
              >
                {tpSlSide.toUpperCase()}
              </button>
              <input
                type="number"
                min="0"
                step="any"
                value={tpTriggerInput}
                onChange={(e) => setTpTriggerInput(e.target.value)}
                placeholder="TP $"
                className="w-20 px-2 py-1.5 rounded bg-[#000000] border border-[#1A1E26] text-xs font-mono text-[#08D189] placeholder:text-slate-500 outline-none focus:border-[#08D189]"
              />
              <input
                type="number"
                min="0"
                step="any"
                value={slTriggerInput}
                onChange={(e) => setSlTriggerInput(e.target.value)}
                placeholder="SL $"
                className="w-20 px-2 py-1.5 rounded bg-[#000000] border border-[#1A1E26] text-xs font-mono text-[#F0525E] placeholder:text-slate-500 outline-none focus:border-[#F0525E]"
              />
              <button
                type="button"
                disabled={
                  busyAction !== null ||
                  !(parseFloat(tpTriggerInput) > 0 || parseFloat(slTriggerInput) > 0)
                }
                onClick={() =>
                  runAction('Attach Conditional TP/SL', () =>
                    buildMarginAttachTpSlTx({
                      owner: account.address,
                      pool,
                      managerId: position.managerId,
                      side: tpSlSide,
                      quantity: defaultCloseQty,
                      tpPrice: parseFloat(tpTriggerInput) > 0 ? parseFloat(tpTriggerInput) : undefined,
                      slPrice: parseFloat(slTriggerInput) > 0 ? parseFloat(slTriggerInput) : undefined,
                    })
                  )
                }
                className="px-2.5 py-1.5 rounded text-xs font-semibold bg-[#121620] border border-[#232938] text-white hover:border-[#2B7FFF]/50 disabled:opacity-45"
              >
                {busyAction === 'Attach Conditional TP/SL' ? '...' : 'Set TP/SL'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 items-start">
          {/* Health + Assets & Debts */}
          <div className="xl:col-span-5 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono">
            <div className="bg-[#06070A] border border-[#1A1E26] rounded-lg p-2.5">
              <div className="text-slate-400 mb-1 font-sans">Risk Ratio</div>
              <div
                className={`text-base font-bold ${
                  position.riskRatio === 0 || position.riskRatio >= 1.5
                    ? 'text-[#08D189]'
                    : position.riskRatio >= (riskConfig?.minBorrowRiskRatio ?? 1.25)
                      ? 'text-amber-300'
                      : 'text-[#F0525E]'
                }`}
              >
                {hasDebt ? `${position.riskRatio.toFixed(2)}x` : 'No Debt'}
              </div>
            </div>
            <div className="bg-[#06070A] border border-[#1A1E26] rounded-lg p-2.5">
              <div className="text-slate-400 mb-1 font-sans">{pool.baseSymbol} Asset / Debt</div>
              <div className="text-sm font-bold text-white">{position.baseAsset.toFixed(4)}</div>
              <div className="text-xs text-[#F0525E]">Debt: {position.baseDebt.toFixed(4)}</div>
            </div>
            <div className="bg-[#06070A] border border-[#1A1E26] rounded-lg p-2.5">
              <div className="text-slate-400 mb-1 font-sans">{pool.quoteSymbol} Asset / Debt</div>
              <div className="text-sm font-bold text-white">{position.quoteAsset.toFixed(4)}</div>
              <div className="text-xs text-[#F0525E]">Debt: {position.quoteDebt.toFixed(4)}</div>
            </div>
          </div>

          {/* Open Margin Orders & TP/SL */}
          <div className="xl:col-span-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400">
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
                  className="text-xs font-mono text-[#F0525E] hover:underline"
                >
                  Clear TP/SL
                </button>
              )}
            </div>

            {position.openOrders.length === 0 ? (
              <div className="bg-[#06070A] border border-[#1A1E26] rounded-lg px-3 py-2.5 text-xs text-slate-500">
                No resting margin limit orders.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-28 overflow-y-auto">
                {position.openOrders.map((ord) => (
                  <div
                    key={ord.orderId}
                    className="bg-[#06070A] border border-[#1A1E26] rounded-lg px-3 py-2 flex items-center justify-between text-xs font-mono"
                  >
                    <span className={ord.isBid ? 'text-[#08D189] font-bold' : 'text-[#F0525E] font-bold'}>
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
                  className="flex-1 py-2 px-3 rounded-lg bg-[#F0525E]/15 border border-[#F0525E]/40 text-[#F0525E] text-xs font-bold hover:bg-[#F0525E]/25"
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
                  className="flex-1 py-2 px-3 rounded-lg bg-[#2B7FFF]/18 border border-[#2B7FFF]/45 text-[#60A5FA] text-xs font-bold hover:bg-[#2B7FFF]/28"
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
                  className="py-2 px-3 rounded-lg bg-[#0C0E13] border border-[#1A1E26] text-white text-xs font-semibold hover:bg-[#141821]"
                >
                  Repay All
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setWithdrawAsset((prev) => (prev === 'quote' ? 'base' : 'quote'))}
                className="px-2.5 py-1.5 rounded bg-[#06070A] border border-[#1A1E26] text-xs font-mono text-[#60A5FA]"
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
                className="flex-1 min-w-0 px-2.5 py-1.5 rounded bg-[#06070A] border border-[#1A1E26] text-xs font-mono text-white outline-none focus:border-[#2B7FFF]/60"
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
                className="px-3 py-1.5 rounded bg-[#121620] hover:bg-[#1A202E] border border-[#232938] text-xs font-bold text-white disabled:opacity-40"
              >
                Withdraw
              </button>
            </div>
          </div>
        </div>
        </div>
      ) : (
        <div className="space-y-3">
          {liquidityCards}
          <div className="flex items-center justify-between text-xs text-[#8E98A8] px-0.5">
            <span>
              No open margin position on <strong className="text-white">{pool.baseSymbol}/{pool.quoteSymbol}</strong>. Enter collateral &amp; choose leverage on the right ticket to deploy.
            </span>
            <span className="inline-flex items-center gap-1.5 text-[#08D189] font-mono shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Up to {(riskConfig?.maxLeverageSafe ?? 4.5).toFixed(1)}x Isolated
            </span>
          </div>
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
