import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { usdcToRaw } from '@mysten/deepbook-v3/predict';
import { USDC_COIN_TYPE } from '../earnPools';
import {
  buildPredictPlpSupplyTx,
  buildPredictPlpWithdrawTx,
  fetchPredictPlpVault,
  fetchPredictProtocolStatus,
  type PredictPlpVaultState,
} from '../deepbookPredict';
import { extractTxDigest, fetchWalletBalances, readBalanceFromMap } from '../suiClient';
import { simulateTxBeforeWallet } from '../suiSimulate';
import { addWalletVolumeUsd } from '../voltFee';
import type { PnlTradeData } from '../PnlShareModal';

interface EarnWorkspaceProps {
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

const fmtUsd = (v: number): string => {
  if (!Number.isFinite(v) || v <= 0) return '$0.00';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(2)}K`;
  return `$${v.toFixed(2)}`;
};

const fmtUnits = (v: number, maxDecimals = 2): string => {
  if (!Number.isFinite(v) || v <= 0) return '0.00';
  return v.toLocaleString(undefined, { maximumFractionDigits: maxDecimals });
};

const floorToUsdc = (val: number): number => {
  if (!Number.isFinite(val) || val <= 0) return 0;
  return Math.floor(val * 1_000_000) / 1_000_000;
};

export const EarnWorkspace: React.FC<EarnWorkspaceProps> = ({
  onNotify,
  onTradeRecorded,
  onVolumeUpdated,
}) => {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [plpVault, setPlpVault] = useState<PredictPlpVaultState | null>(null);
  const [predictReferrerId, setPredictReferrerId] = useState<string | undefined>(undefined);
  const [balances, setBalances] = useState<Record<string, bigint>>({});

  const [op, setOp] = useState<'supply' | 'withdraw'>('supply');
  const [amountInput, setAmountInput] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const requestIdRef = useRef(0);

  const loadData = useCallback(
    async (silent = false) => {
      const reqId = ++requestIdRef.current;
      if (silent) setIsRefreshing(true);
      else setIsLoading(true);

      try {
        const [plp, proto, balMap] = await Promise.all([
          fetchPredictPlpVault(account?.address).catch(() => null),
          fetchPredictProtocolStatus().catch(() => null),
          account?.address
            ? fetchWalletBalances(account.address).catch(() => ({} as Record<string, bigint>))
            : Promise.resolve({} as Record<string, bigint>),
        ]);

        if (reqId !== requestIdRef.current) return;
        setPlpVault(plp);
        setPredictReferrerId(
          proto?.referrerWrapperExists ? proto.referrerWrapperId : undefined
        );
        setBalances(balMap);
      } finally {
        if (reqId === requestIdRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [account?.address]
  );

  useEffect(() => {
    loadData(false);
  }, [account?.address]); // eslint-disable-line react-hooks/exhaustive-deps

  const walletUsdc = useMemo(() => readBalanceFromMap(balances, USDC_COIN_TYPE, 6), [balances]);

  const availableActionBalance = useMemo(() => {
    if (op === 'withdraw') return plpVault?.userPlpShares ?? 0;
    return walletUsdc + (plpVault?.vaultAvailableUsdc ?? 0);
  }, [op, plpVault, walletUsdc]);

  const parsedAmount = useMemo(() => {
    const n = Number(amountInput);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amountInput]);

  const validationError = useMemo(() => {
    if (parsedAmount <= 0) return null;
    if (parsedAmount > availableActionBalance + 1e-6) {
      return 'Amount exceeds your available balance.';
    }
    if (
      op === 'withdraw' &&
      plpVault &&
      parsedAmount > plpVault.idleUsdc &&
      plpVault.idleUsdc > 0
    ) {
      return `Pool idle USDC is $${plpVault.idleUsdc.toFixed(2)} — excess enters withdrawal queue.`;
    }
    return null;
  }, [parsedAmount, availableActionBalance, op, plpVault]);

  const hardBlocked = useMemo(
    () => parsedAmount <= 0 || parsedAmount > availableActionBalance + 1e-6,
    [parsedAmount, availableActionBalance]
  );

  const handleSetPct = (pct: number) => {
    const floored = floorToUsdc(availableActionBalance * pct);
    setAmountInput(floored > 0 ? String(floored) : '0');
  };

  const handleExecute = async () => {
    if (!account?.address) {
      onNotify('warning', 'Wallet Required', 'Connect your Sui wallet to continue.');
      return;
    }
    if (hardBlocked) return;

    const safeAmount = floorToUsdc(parsedAmount);
    if (safeAmount <= 0) return;

    setIsSubmitting(true);
    try {
      if (op === 'supply') {
        const tx = buildPredictPlpSupplyTx({
          sender: account.address,
          amountUsdc: safeAmount,
          hasAccount: Boolean(plpVault?.hasAccount),
          vaultAvailableUsdc: plpVault?.vaultAvailableUsdc ?? 0,
          referrerWrapperId: predictReferrerId,
        });
        const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
        if (!sim.ok) {
          onNotify(
            'error',
            'PLP Supply Preflight Failed',
            sim.errorMessage || 'Simulation failed.'
          );
          return;
        }
        const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
        const digest = extractTxDigest(res);
        const nextVol = addWalletVolumeUsd(account.address, safeAmount);
        onVolumeUpdated?.(nextVol);
        onNotify(
          'success',
          'Supplied to DeepBook PLP',
          `Deposited ${safeAmount.toFixed(2)} USDC into DeepBook Predict Liquidity Pool.`,
          'Suiscan',
          `https://suiscan.xyz/mainnet/tx/${digest}`
        );
        onTradeRecorded({
          fromToken: 'USDC',
          toToken: 'PLP',
          fromAmount: safeAmount.toFixed(2),
          toAmount: `${safeAmount.toFixed(2)} USDC LP`,
          volumeUsd: safeAmount,
          feeSavedUsd: 0,
          digest,
        });
        fetch('/api/record-swap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sender: account.address,
            fromSymbol: 'USDC',
            toSymbol: 'PLP',
            amountIn: safeAmount.toFixed(2),
            notionalUsd: safeAmount,
            feeRate: 0,
            digest,
            swapMode: 'DEEPBOOK_PLP_SUPPLY',
          }),
        }).catch(() => {});
      } else {
        const sharesRaw = usdcToRaw(safeAmount);
        const tx = buildPredictPlpWithdrawTx({
          sender: account.address,
          sharesRaw,
        });
        const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
        if (!sim.ok) {
          onNotify(
            'error',
            'PLP Withdraw Preflight Failed',
            sim.errorMessage || 'Simulation failed.'
          );
          return;
        }
        const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
        const digest = extractTxDigest(res);
        onNotify(
          'success',
          'PLP Withdrawal Submitted',
          `Requested withdrawal of ${safeAmount.toFixed(2)} PLP shares to Predict Vault.`,
          'Suiscan',
          `https://suiscan.xyz/mainnet/tx/${digest}`
        );
      }

      setAmountInput('');
      await loadData(true);
    } catch (err: any) {
      onNotify('error', 'Transaction Cancelled', err?.message || 'Wallet rejected transaction.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header Summary Strip */}
      <div className="panel-carbon rounded-xl p-4 sm:p-5 border border-[#2D374B]">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#2B7FFF]/15 border border-[#2B7FFF]/40 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-[#60A5FA]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  DeepBook Predict Liquidity Pool (PLP)
                </h1>
                <span className="px-2 py-0.5 rounded bg-[#2B7FFF]/15 border border-[#2B7FFF]/35 text-[10px] font-mono text-[#60A5FA]">
                  @mysten/deepbook-v3/predict
                </span>
              </div>
              <p className="text-xs text-[#8E98A8]">
                Supply USDC to act as the on-chain market maker for DeepBook Predict binary options. Zero Volt fee.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0C0E13] border border-[#2D374B] hover:border-[#2B7FFF]/50 text-xs font-mono text-slate-300 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="panel-carbon-sub rounded-lg p-3 border border-[#232B3B]">
            <div className="text-[11px] font-mono text-[#7B8494]">Pool Idle USDC</div>
            <div className="text-base font-mono font-bold text-white mt-0.5 tabular-nums">
              {isLoading && !plpVault ? '—' : plpVault ? fmtUsd(plpVault.idleUsdc) : '$0.00'}
            </div>
          </div>
          <div className="panel-carbon-sub rounded-lg p-3 border border-[#232B3B]">
            <div className="text-[11px] font-mono text-[#7B8494]">Total PLP Supply</div>
            <div className="text-base font-mono font-bold text-white mt-0.5 tabular-nums">
              {plpVault ? fmtUnits(plpVault.plpTotalSupply, 2) : '—'}
            </div>
          </div>
          <div className="panel-carbon-sub rounded-lg p-3 border border-[#232B3B]">
            <div className="text-[11px] font-mono text-[#7B8494]">Pending Queue</div>
            <div className="text-base font-mono font-bold text-[#60A5FA] mt-0.5 tabular-nums">
              {plpVault
                ? `${plpVault.supplyRequestsPending} in / ${plpVault.withdrawRequestsPending} out`
                : '0 in / 0 out'}
            </div>
          </div>
          <div className="panel-carbon-sub rounded-lg p-3 border border-[#232B3B]">
            <div className="text-[11px] font-mono text-[#7B8494]">My PLP Shares</div>
            <div className="text-base font-mono font-bold text-[#08D189] mt-0.5 tabular-nums">
              {plpVault ? `${plpVault.userPlpShares.toFixed(2)} PLP` : '0.00 PLP'}
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Vault Info Left + Execution Card Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-7 space-y-4">
          <div className="panel-carbon rounded-xl p-5 border border-[#2D374B] space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#232B3B]">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-white">Options Market Making Vault</span>
                <span className="px-2 py-0.5 rounded bg-[#2B7FFF]/15 border border-[#2B7FFF]/35 text-[10px] font-mono text-[#60A5FA]">
                  USDC → PLP
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setOp('supply');
                    setAmountInput('');
                  }}
                  className="px-3 py-1.5 rounded-lg btn-deepbook text-xs font-bold inline-flex items-center gap-1"
                >
                  <ArrowDownToLine className="w-3 h-3" />
                  <span>Supply USDC</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOp('withdraw');
                    setAmountInput('');
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-[#0C0E13] border border-[#2D374B] hover:border-[#2B7FFF]/50 text-xs font-semibold text-slate-200 inline-flex items-center gap-1"
                >
                  <ArrowUpFromLine className="w-3 h-3" />
                  <span>Withdraw</span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="panel-carbon-sub rounded-lg p-3.5 border border-[#232B3B] space-y-1">
                <div className="font-semibold text-white">How Yield Is Generated</div>
                <p className="text-[#8E98A8] leading-relaxed">
                  PLP acts as the counterparty to all Above, Below, and Range binary options in
                  DeepBook Predict, earning spread and option settlement edge in USDC.
                </p>
              </div>
              <div className="panel-carbon-sub rounded-lg p-3.5 border border-[#232B3B] space-y-1">
                <div className="font-semibold text-white">Settlement &amp; Risk</div>
                <p className="text-[#8E98A8] leading-relaxed">
                  Share value floats with pool PnL after each 1m / 6m expiry. Withdrawals settle
                  from idle USDC or enter the settlement queue until active markets close.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Execution Panel */}
        <div className="lg:col-span-5">
          <div className="panel-carbon rounded-xl p-4 border border-[#2D374B] space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-[#60A5FA]">
                  DeepBook Predict PLP
                </div>
                <h3 className="text-base font-bold text-white">
                  {op === 'supply' ? 'Supply USDC to PLP' : 'Withdraw PLP Shares'}
                </h3>
              </div>

              <div className="inline-flex rounded-lg bg-[#0C0E13] border border-[#2D374B] p-0.5">
                {(['supply', 'withdraw'] as const).map((nextOp) => (
                  <button
                    key={nextOp}
                    type="button"
                    onClick={() => {
                      setOp(nextOp);
                      setAmountInput('');
                    }}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold capitalize transition-colors ${
                      op === nextOp
                        ? 'bg-[#2B7FFF]/20 text-[#60A5FA]'
                        : 'text-[#7B8494] hover:text-white'
                    }`}
                  >
                    {nextOp}
                  </button>
                ))}
              </div>
            </div>

            <div className="panel-carbon-sub rounded-xl p-3 border border-[#232B3B] space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono text-[#8E98A8]">
                <span>{op === 'withdraw' ? 'My PLP Shares' : 'Wallet + Predict Vault'}</span>
                <span className="text-white font-semibold tabular-nums">
                  {fmtUnits(availableActionBalance, 4)} {op === 'withdraw' ? 'PLP' : 'USDC'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={amountInput}
                  onChange={(e) => {
                    const clean = e.target.value.replace(',', '.').replace(/[^0-9.]/g, '');
                    const parts = clean.split('.');
                    setAmountInput(
                      parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : clean
                    );
                  }}
                  placeholder="0.00"
                  className="flex-1 min-w-0 bg-transparent text-2xl font-mono font-bold text-white outline-none"
                />
                <span className="px-2.5 py-1 rounded bg-[#0C0E13] border border-[#2D374B] text-xs font-mono font-bold text-white">
                  {op === 'withdraw' ? 'PLP' : 'USDC'}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-1.5 pt-1">
                {[0.25, 0.5, 0.75, 1].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => handleSetPct(pct)}
                    className="py-1 rounded bg-[#0C0E13] border border-[#2D374B] hover:border-[#2B7FFF]/60 text-[11px] font-mono text-slate-300 hover:text-white transition-colors"
                  >
                    {pct === 1 ? 'MAX' : `${pct * 100}%`}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 text-xs font-mono bg-[#0C0E13] rounded-lg p-3 border border-[#232B3B]">
              <div className="flex justify-between">
                <span className="text-[#7B8494]">Wallet USDC</span>
                <span className="text-white">{walletUsdc.toFixed(2)} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#7B8494]">Predict Vault USDC</span>
                <span className="text-white">
                  {(plpVault?.vaultAvailableUsdc ?? 0).toFixed(2)} USDC
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#7B8494]">Volt Protocol Fee</span>
                <span className="text-[#08D189]">0.00% (Native Referrer)</span>
              </div>
            </div>

            {validationError && (
              <div className="rounded-lg bg-[#F0525E]/10 border border-[#F0525E]/35 px-3 py-2 text-[11px] text-[#F0525E]">
                {validationError}
              </div>
            )}

            <button
              type="button"
              disabled={isSubmitting || (Boolean(account) && hardBlocked)}
              onClick={handleExecute}
              className="w-full py-2.5 rounded-xl btn-deepbook font-bold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-45 disabled:cursor-not-allowed"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>
                {!account
                  ? 'Connect Sui Wallet'
                  : op === 'supply'
                    ? 'Supply USDC to PLP'
                    : 'Withdraw PLP Shares'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
