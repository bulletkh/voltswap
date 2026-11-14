import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { usdcToRaw } from '@mysten/deepbook-v3/predict';
import {
  buildDeepBookMarginSupplyTx,
  buildDeepBookMarginWithdrawTx,
  fetchDeepBookMarginVaults,
  fetchUserDeepBookMarginPositions,
  fetchVoltMarginSupplyReferrals,
  USDC_COIN_TYPE,
  type DeepBookMarginVault,
  type EarnFilterTab,
  type UserMarginPosition,
  type VoltMarginSupplyReferral,
} from '../earnPools';
import {
  buildPredictPlpSupplyTx,
  buildPredictPlpWithdrawTx,
  fetchPredictPlpVault,
  fetchPredictProtocolStatus,
  type PredictPlpVaultState,
} from '../deepbookPredict';
import { extractTxDigest, fetchWalletBalances, readBalanceFromMap, SUI_COIN_TYPE } from '../suiClient';
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

type SelectedAction =
  | { kind: 'lending'; op: 'supply' | 'withdraw'; coinKey: string }
  | { kind: 'plp'; op: 'supply' | 'withdraw' };

const fmtUsd = (v: number): string => {
  if (!Number.isFinite(v) || v <= 0) return '$0.00';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(2)}K`;
  return `$${v.toFixed(2)}`;
};

const fmtUnits = (v: number, maxDecimals = 4): string => {
  if (!Number.isFinite(v) || v <= 0) return '0';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return v.toLocaleString(undefined, { maximumFractionDigits: maxDecimals });
};

const floorToDecimals = (val: number, decimals: number): number => {
  if (!Number.isFinite(val) || val <= 0) return 0;
  const factor = Math.pow(10, Math.min(9, Math.max(0, decimals)));
  return Math.floor(val * factor) / factor;
};

export const EarnWorkspace: React.FC<EarnWorkspaceProps> = ({
  onNotify,
  onTradeRecorded,
  onVolumeUpdated,
}) => {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();

  const [tab, setTab] = useState<EarnFilterTab>('all');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [lendingVaults, setLendingVaults] = useState<DeepBookMarginVault[]>([]);
  const [lendingPositions, setLendingPositions] = useState<Record<string, UserMarginPosition>>({});
  const [lendingReferrals, setLendingReferrals] = useState<
    Record<string, VoltMarginSupplyReferral>
  >({});
  const [plpVault, setPlpVault] = useState<PredictPlpVaultState | null>(null);
  const [predictReferrerId, setPredictReferrerId] = useState<string | undefined>(undefined);
  const [balances, setBalances] = useState<Record<string, bigint>>({});

  const [selected, setSelected] = useState<SelectedAction>({
    kind: 'lending',
    op: 'supply',
    coinKey: 'SUI',
  });
  const [amountInput, setAmountInput] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const requestIdRef = useRef(0);

  const loadData = useCallback(
    async (silent = false) => {
      const reqId = ++requestIdRef.current;
      if (silent) setIsRefreshing(true);
      else setIsLoading(true);

      try {
        const [vaults, refs, plp, proto, posRes, balMap] = await Promise.all([
          fetchDeepBookMarginVaults().catch(() => [] as DeepBookMarginVault[]),
          fetchVoltMarginSupplyReferrals().catch(
            () => ({} as Record<string, VoltMarginSupplyReferral>)
          ),
          fetchPredictPlpVault(account?.address).catch(() => null),
          fetchPredictProtocolStatus().catch(() => null),
          account?.address
            ? fetchUserDeepBookMarginPositions(account.address).catch(() => ({
                supplierCapIds: [] as string[],
                positions: {} as Record<string, UserMarginPosition>,
              }))
            : Promise.resolve({
                supplierCapIds: [] as string[],
                positions: {} as Record<string, UserMarginPosition>,
              }),
          account?.address
            ? fetchWalletBalances(account.address).catch(() => ({} as Record<string, bigint>))
            : Promise.resolve({} as Record<string, bigint>),
        ]);

        if (reqId !== requestIdRef.current) return;
        setLendingVaults(vaults);
        setLendingReferrals(refs);
        setPlpVault(plp);
        setPredictReferrerId(
          proto?.referrerWrapperExists ? proto.referrerWrapperId : undefined
        );
        setLendingPositions(posRes.positions || {});
        setBalances(balMap);

        if (
          selected.kind === 'lending' &&
          vaults.length > 0 &&
          !vaults.some((v) => v.coinKey === selected.coinKey)
        ) {
          setSelected({ kind: 'lending', op: 'supply', coinKey: vaults[0].coinKey });
        }
      } finally {
        if (reqId === requestIdRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [account?.address, selected]
  );

  useEffect(() => {
    loadData(false);
  }, [account?.address]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredLendingVaults = useMemo(() => {
    const q = search.trim().toLowerCase();
    return lendingVaults.filter(
      (v) =>
        !q ||
        v.symbol.toLowerCase().includes(q) ||
        v.name.toLowerCase().includes(q) ||
        String(v.coinKey).toLowerCase().includes(q)
    );
  }, [lendingVaults, search]);

  const activeLendingVault = useMemo(() => {
    if (selected.kind !== 'lending') return null;
    return lendingVaults.find((v) => v.coinKey === selected.coinKey) || lendingVaults[0] || null;
  }, [lendingVaults, selected]);

  const activeLendingPos = useMemo(() => {
    if (!activeLendingVault) return null;
    return lendingPositions[String(activeLendingVault.coinKey)] || null;
  }, [activeLendingVault, lendingPositions]);

  const walletUsdc = useMemo(() => readBalanceFromMap(balances, USDC_COIN_TYPE, 6), [balances]);

  const activeDecimals = useMemo(() => {
    if (selected.kind === 'plp') return 6;
    return activeLendingVault?.decimals ?? 9;
  }, [selected.kind, activeLendingVault]);

  const availableActionBalance = useMemo(() => {
    if (selected.kind === 'plp') {
      if (selected.op === 'withdraw') return plpVault?.userPlpShares ?? 0;
      return walletUsdc + (plpVault?.vaultAvailableUsdc ?? 0);
    }
    if (!activeLendingVault) return 0;
    if (selected.op === 'withdraw') return activeLendingPos?.suppliedAmount ?? 0;
    const rawBal = readBalanceFromMap(
      balances,
      activeLendingVault.coinType,
      activeLendingVault.decimals
    );
    if (activeLendingVault.coinType === SUI_COIN_TYPE) {
      return Math.max(0, rawBal - 0.02);
    }
    return rawBal;
  }, [selected, plpVault, walletUsdc, activeLendingVault, activeLendingPos, balances]);

  const parsedAmount = useMemo(() => {
    const n = Number(amountInput);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [amountInput]);

  const capLeft = useMemo(() => {
    if (selected.kind !== 'lending' || !activeLendingVault || activeLendingVault.supplyCap <= 0) {
      return null;
    }
    return Math.max(0, activeLendingVault.supplyCap - activeLendingVault.totalSupply);
  }, [selected.kind, activeLendingVault]);

  const poolAvailLiquidity = useMemo(() => {
    if (selected.kind !== 'lending' || !activeLendingVault) return null;
    return Math.max(0, activeLendingVault.totalSupply - activeLendingVault.totalBorrow);
  }, [selected.kind, activeLendingVault]);

  const validationError = useMemo(() => {
    if (parsedAmount <= 0) return null;
    if (parsedAmount > availableActionBalance + 1e-9) {
      return 'Amount exceeds your available balance.';
    }
    if (
      selected.kind === 'lending' &&
      selected.op === 'supply' &&
      capLeft !== null &&
      parsedAmount > capLeft
    ) {
      return `Exceeds pool supply cap (${fmtUnits(capLeft)} ${activeLendingVault?.symbol ?? ''} left).`;
    }
    if (
      selected.kind === 'lending' &&
      selected.op === 'withdraw' &&
      poolAvailLiquidity !== null &&
      parsedAmount > poolAvailLiquidity
    ) {
      return `Exceeds unborrowed pool liquidity (${fmtUnits(poolAvailLiquidity)} ${activeLendingVault?.symbol ?? ''} free).`;
    }
    if (
      selected.kind === 'plp' &&
      selected.op === 'withdraw' &&
      plpVault &&
      parsedAmount > plpVault.idleUsdc &&
      plpVault.idleUsdc > 0
    ) {
      return `Pool idle USDC is $${plpVault.idleUsdc.toFixed(2)} — excess enters withdrawal queue.`;
    }
    return null;
  }, [
    parsedAmount,
    availableActionBalance,
    selected,
    capLeft,
    poolAvailLiquidity,
    activeLendingVault,
    plpVault,
  ]);

  const hardBlocked = useMemo(() => {
    if (parsedAmount <= 0) return true;
    if (parsedAmount > availableActionBalance + 1e-9) return true;
    if (
      selected.kind === 'lending' &&
      selected.op === 'supply' &&
      capLeft !== null &&
      parsedAmount > capLeft
    ) {
      return true;
    }
    if (
      selected.kind === 'lending' &&
      selected.op === 'withdraw' &&
      poolAvailLiquidity !== null &&
      parsedAmount > poolAvailLiquidity
    ) {
      return true;
    }
    return false;
  }, [parsedAmount, availableActionBalance, selected, capLeft, poolAvailLiquidity]);

  const totalTvlUsd = useMemo(() => {
    const lendingTvl = lendingVaults.reduce((sum, v) => sum + (v.tvlUsd || 0), 0);
    return lendingTvl + (plpVault?.idleUsdc ?? 0);
  }, [lendingVaults, plpVault]);

  const topLendingApr = useMemo(
    () => lendingVaults.reduce((m, v) => Math.max(m, v.supplyAprPct || 0), 0),
    [lendingVaults]
  );

  const userTotalSuppliedUsd = useMemo(() => {
    return lendingVaults.reduce((sum, v) => {
      const pos = lendingPositions[String(v.coinKey)];
      if (!pos) return sum;
      return sum + pos.suppliedAmount * (v.priceUsd || 0);
    }, 0);
  }, [lendingVaults, lendingPositions]);

  const handleSetPct = (pct: number) => {
    const raw = availableActionBalance * pct;
    const floored = floorToDecimals(raw, activeDecimals);
    setAmountInput(floored > 0 ? String(floored) : '0');
  };

  const handleExecute = async () => {
    if (!account?.address) {
      onNotify('warning', 'Wallet Required', 'Connect your Sui wallet to continue.');
      return;
    }
    if (hardBlocked) return;

    const safeAmount = floorToDecimals(parsedAmount, activeDecimals);
    if (safeAmount <= 0) return;

    setIsSubmitting(true);
    try {
      if (selected.kind === 'plp') {
        if (selected.op === 'supply') {
          const tx = buildPredictPlpSupplyTx({
            sender: account.address,
            amountUsdc: safeAmount,
            hasAccount: Boolean(plpVault?.hasAccount),
            vaultAvailableUsdc: plpVault?.vaultAvailableUsdc ?? 0,
            referrerWrapperId: predictReferrerId,
          });
          const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
          if (!sim.ok) {
            onNotify('error', 'PLP Supply Preflight Failed', sim.errorMessage || 'Simulation failed.');
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
      } else if (activeLendingVault) {
        if (selected.op === 'supply') {
          const ref = lendingReferrals[String(activeLendingVault.coinKey)];
          const { tx } = buildDeepBookMarginSupplyTx({
            sender: account.address,
            coinKey: activeLendingVault.coinKey,
            amountHuman: safeAmount,
            existingSupplierCapId: activeLendingPos?.supplierCapId ?? null,
            referralId: ref?.referralId ?? null,
          });
          const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
          if (!sim.ok) {
            onNotify(
              'error',
              'Lending Supply Preflight Failed',
              sim.errorMessage || 'Simulation failed.'
            );
            return;
          }
          const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
          const digest = extractTxDigest(res);
          const notionalUsd = safeAmount * (activeLendingVault.priceUsd || 0);
          if (notionalUsd > 0) {
            const nextVol = addWalletVolumeUsd(account.address, notionalUsd);
            onVolumeUpdated?.(nextVol);
          }
          onNotify(
            'success',
            `Supplied ${activeLendingVault.symbol}`,
            `Deposited ${fmtUnits(safeAmount)} ${activeLendingVault.symbol} at ${activeLendingVault.supplyAprPct.toFixed(2)}% APR.`,
            'Suiscan',
            `https://suiscan.xyz/mainnet/tx/${digest}`
          );
          onTradeRecorded({
            fromToken: activeLendingVault.symbol,
            toToken: `db${activeLendingVault.symbol}`,
            fromAmount: fmtUnits(safeAmount),
            toAmount: `${activeLendingVault.supplyAprPct.toFixed(2)}% APR`,
            volumeUsd: notionalUsd,
            feeSavedUsd: 0,
            digest,
          });
          fetch('/api/record-swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sender: account.address,
              fromSymbol: activeLendingVault.symbol,
              toSymbol: `db${activeLendingVault.symbol}`,
              amountIn: fmtUnits(safeAmount),
              notionalUsd,
              feeRate: 0,
              digest,
              swapMode: 'DEEPBOOK_MARGIN_SUPPLY',
            }),
          }).catch(() => {});
        } else {
          if (!activeLendingPos?.supplierCapId) {
            onNotify(
              'warning',
              'No Active Position',
              `You have no supplied ${activeLendingVault.symbol} position to withdraw.`
            );
            return;
          }
          const withdrawAll = safeAmount >= activeLendingPos.suppliedAmount * 0.9999;
          const tx = buildDeepBookMarginWithdrawTx({
            sender: account.address,
            coinKey: activeLendingVault.coinKey,
            supplierCapId: activeLendingPos.supplierCapId,
            amountHuman: safeAmount,
            withdrawAll,
          });
          const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
          if (!sim.ok) {
            onNotify(
              'error',
              'Lending Withdraw Preflight Failed',
              sim.errorMessage || 'Simulation failed.'
            );
            return;
          }
          const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
          const digest = extractTxDigest(res);
          onNotify(
            'success',
            `Withdrew ${activeLendingVault.symbol}`,
            `Returned ${fmtUnits(safeAmount)} ${activeLendingVault.symbol} to your wallet.`,
            'Suiscan',
            `https://suiscan.xyz/mainnet/tx/${digest}`
          );
        }
      }

      setAmountInput('');
      await loadData(true);
    } catch (err: any) {
      onNotify('error', 'Transaction Cancelled', err?.message || 'Wallet rejected transaction.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const showPlpSection = tab === 'all' || tab === 'plp';
  const showLendingSection = tab === 'all' || tab === 'lending';

  return (
    <div className="space-y-4">
      {/* Header Summary Strip */}
      <div className="panel-carbon rounded-xl p-4 sm:p-5 border border-[#2D374B]">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#2B7FFF]/15 border border-[#2B7FFF]/40 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-[#60A5FA]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  DeepBook Native Earn
                </h1>
                <span className="px-2 py-0.5 rounded bg-[#2B7FFF]/15 border border-[#2B7FFF]/35 text-[10px] font-mono text-[#60A5FA]">
                  @mysten/deepbook-v3
                </span>
              </div>
              <p className="text-xs text-[#8E98A8]">
                Direct on-chain DeepBook Lending pools &amp; DeepBook Predict Liquidity Pool (PLP). Zero Volt fee.
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
            <div className="text-[11px] font-mono text-[#7B8494]">DeepBook Earn TVL</div>
            <div className="text-base font-mono font-bold text-white mt-0.5 tabular-nums">
              {fmtUsd(totalTvlUsd)}
            </div>
          </div>
          <div className="panel-carbon-sub rounded-lg p-3 border border-[#232B3B]">
            <div className="text-[11px] font-mono text-[#7B8494]">Top Lending APR</div>
            <div className="text-base font-mono font-bold text-[#08D189] mt-0.5 tabular-nums">
              {topLendingApr > 0 ? `${topLendingApr.toFixed(2)}%` : '—'}
            </div>
          </div>
          <div className="panel-carbon-sub rounded-lg p-3 border border-[#232B3B]">
            <div className="text-[11px] font-mono text-[#7B8494]">My Lending Supplied</div>
            <div className="text-base font-mono font-bold text-white mt-0.5 tabular-nums">
              {fmtUsd(userTotalSuppliedUsd)}
            </div>
          </div>
          <div className="panel-carbon-sub rounded-lg p-3 border border-[#232B3B]">
            <div className="text-[11px] font-mono text-[#7B8494]">My PLP Shares</div>
            <div className="text-base font-mono font-bold text-[#60A5FA] mt-0.5 tabular-nums">
              {plpVault ? fmtUnits(plpVault.userPlpShares, 2) : '0.00'} PLP
            </div>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#090B10] border border-[#2D374B]">
          {(
            [
              { id: 'all', label: 'All DeepBook' },
              { id: 'lending', label: `DeepBook Lending (${lendingVaults.length})` },
              { id: 'plp', label: 'Predict PLP' },
            ] as { id: EarnFilterTab; label: string }[]
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                tab === item.id
                  ? 'bg-[#2B7FFF]/20 text-[#60A5FA] border border-[#2B7FFF]/45'
                  : 'text-[#8E98A8] hover:text-white border border-transparent'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {showLendingSection && (
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-[#7B8494] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter Lending asset..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#090B10] border border-[#2D374B] text-xs font-mono text-white placeholder-[#5A6475] outline-none focus:border-[#2B7FFF]"
            />
          </div>
        )}
      </div>

      {/* Main Grid: Pools Left + Execution Card Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-8 space-y-4">
          {/* Predict PLP Card */}
          {showPlpSection && (
            <div
              className={`panel-carbon rounded-xl p-4 border transition-colors ${
                selected.kind === 'plp'
                  ? 'border-[#2B7FFF]/70 shadow-[0_0_20px_rgba(43,127,255,0.12)]'
                  : 'border-[#2D374B]'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#232B3B]">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-[#60A5FA]" />
                  <span className="text-sm font-bold text-white">
                    DeepBook Predict Liquidity Pool (PLP)
                  </span>
                  <span className="px-2 py-0.5 rounded bg-[#2B7FFF]/15 border border-[#2B7FFF]/35 text-[10px] font-mono text-[#60A5FA]">
                    OPTIONS MARKET MAKING
                  </span>
                </div>
                <span className="text-[11px] font-mono text-[#8E98A8]">
                  Earn Spread &amp; Binary Option Fees (USDC)
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-3 items-center">
                <div>
                  <div className="text-[11px] text-[#7B8494] font-mono">Pool Idle USDC</div>
                  <div className="text-sm font-mono font-bold text-white tabular-nums mt-0.5">
                    {plpVault ? fmtUsd(plpVault.idleUsdc) : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[#7B8494] font-mono">Total PLP Supply</div>
                  <div className="text-sm font-mono font-bold text-white tabular-nums mt-0.5">
                    {plpVault ? fmtUnits(plpVault.plpTotalSupply, 2) : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[#7B8494] font-mono">Pending Queue</div>
                  <div className="text-sm font-mono font-bold text-[#60A5FA] tabular-nums mt-0.5">
                    {plpVault
                      ? `${plpVault.supplyRequestsPending} in / ${plpVault.withdrawRequestsPending} out`
                      : '0 in / 0 out'}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-[#7B8494] font-mono">My PLP Shares</div>
                  <div className="text-sm font-mono font-bold text-[#08D189] tabular-nums mt-0.5">
                    {plpVault ? plpVault.userPlpShares.toFixed(2) : '0.00'}
                  </div>
                </div>
                <div className="col-span-2 sm:col-span-1 flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setSelected({ kind: 'plp', op: 'supply' });
                      setAmountInput('');
                    }}
                    className="px-3 py-1.5 rounded-lg btn-deepbook text-xs font-bold"
                  >
                    Supply USDC
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSelected({ kind: 'plp', op: 'withdraw' });
                      setAmountInput('');
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-[#0C0E13] border border-[#2D374B] hover:border-[#2B7FFF]/50 text-xs font-semibold text-slate-200"
                  >
                    Withdraw
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* DeepBook Lending Pools */}
          {showLendingSection && (
            <div className="panel-carbon rounded-xl border border-[#2D374B] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#232B3B] flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-white">
                    DeepBook Lending (Margin Pools)
                  </h2>
                  <p className="text-[11px] text-[#8E98A8]">
                    On-chain interest-bearing pools backed by DeepBook v3 borrowers.
                  </p>
                </div>
                <span className="text-[11px] font-mono text-[#60A5FA]">
                  {filteredLendingVaults.length} Pools
                </span>
              </div>

              {isLoading && lendingVaults.length === 0 ? (
                <div className="p-8 flex items-center justify-center gap-2 text-xs font-mono text-[#7B8494]">
                  <Loader2 className="w-4 h-4 animate-spin text-[#2B7FFF]" />
                  <span>Loading DeepBook Lending pools...</span>
                </div>
              ) : filteredLendingVaults.length === 0 ? (
                <div className="p-8 text-center text-xs font-mono text-[#7B8494]">
                  No DeepBook Lending pools match "{search}".
                </div>
              ) : (
                <div className="divide-y divide-[#1E2533]">
                  {filteredLendingVaults.map((v) => {
                    const pos = lendingPositions[String(v.coinKey)];
                    const isSelected =
                      selected.kind === 'lending' && selected.coinKey === String(v.coinKey);
                    const availLiq = Math.max(0, v.totalSupply - v.totalBorrow);

                    return (
                      <div
                        key={String(v.coinKey)}
                        className={`p-3.5 sm:p-4 transition-colors ${
                          isSelected ? 'bg-[#2B7FFF]/8' : 'hover:bg-white/[0.02]'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-[160px]">
                            <img
                              src={v.logo}
                              alt={v.symbol}
                              className="w-8 h-8 rounded-full bg-[#0C0E13] border border-[#2D374B] object-cover"
                            />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-sm font-bold text-white">{v.symbol}</span>
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#0C0E13] border border-[#2D374B] text-[#8E98A8]">
                                  DeepBook
                                </span>
                              </div>
                              <div className="text-[11px] text-[#7B8494]">{v.name}</div>
                            </div>
                          </div>

                          <div className="grid grid-cols-3 sm:grid-cols-4 gap-4 flex-1 min-w-[240px]">
                            <div>
                              <div className="text-[10px] font-mono text-[#7B8494]">Supply APR</div>
                              <div className="text-sm font-mono font-bold text-[#08D189] tabular-nums">
                                {v.supplyAprPct.toFixed(2)}%
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] font-mono text-[#7B8494]">TVL</div>
                              <div className="text-sm font-mono font-semibold text-white tabular-nums">
                                {fmtUsd(v.tvlUsd)}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] font-mono text-[#7B8494]">Util / Free</div>
                              <div className="text-xs font-mono text-slate-300 tabular-nums">
                                {v.utilizationPct.toFixed(1)}% · {fmtUnits(availLiq, 2)}
                              </div>
                            </div>
                            <div className="hidden sm:block">
                              <div className="text-[10px] font-mono text-[#7B8494]">My Supplied</div>
                              <div className="text-sm font-mono font-bold text-[#60A5FA] tabular-nums">
                                {pos ? `${fmtUnits(pos.suppliedAmount, 4)} ${v.symbol}` : '0'}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setSelected({
                                  kind: 'lending',
                                  op: 'supply',
                                  coinKey: String(v.coinKey),
                                });
                                setAmountInput('');
                              }}
                              className="px-3 py-1.5 rounded-lg btn-deepbook text-xs font-bold inline-flex items-center gap-1"
                            >
                              <ArrowDownToLine className="w-3 h-3" />
                              <span>Supply</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelected({
                                  kind: 'lending',
                                  op: 'withdraw',
                                  coinKey: String(v.coinKey),
                                });
                                setAmountInput('');
                              }}
                              className="px-2.5 py-1.5 rounded-lg bg-[#0C0E13] border border-[#2D374B] hover:border-[#2B7FFF]/50 text-xs font-semibold text-slate-200 inline-flex items-center gap-1"
                            >
                              <ArrowUpFromLine className="w-3 h-3" />
                              <span>Withdraw</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sticky Execution Panel */}
        <div className="lg:col-span-4 lg:sticky lg:top-20">
          <div className="panel-carbon rounded-xl p-4 border border-[#2D374B] space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-[#60A5FA]">
                  {selected.kind === 'plp' ? 'DeepBook Predict PLP' : 'DeepBook Lending'}
                </div>
                <h3 className="text-base font-bold text-white">
                  {selected.kind === 'plp'
                    ? selected.op === 'supply'
                      ? 'Supply USDC to PLP'
                      : 'Withdraw PLP Shares'
                    : `${selected.op === 'supply' ? 'Supply' : 'Withdraw'} ${
                        activeLendingVault?.symbol ?? ''
                      }`}
                </h3>
              </div>

              <div className="inline-flex rounded-lg bg-[#0C0E13] border border-[#2D374B] p-0.5">
                {(['supply', 'withdraw'] as const).map((op) => (
                  <button
                    key={op}
                    type="button"
                    onClick={() => {
                      setSelected((prev) => ({ ...prev, op }));
                      setAmountInput('');
                    }}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold capitalize transition-colors ${
                      selected.op === op
                        ? 'bg-[#2B7FFF]/20 text-[#60A5FA]'
                        : 'text-[#7B8494] hover:text-white'
                    }`}
                  >
                    {op}
                  </button>
                ))}
              </div>
            </div>

            <div className="panel-carbon-sub rounded-xl p-3 border border-[#232B3B] space-y-2">
              <div className="flex items-center justify-between text-[11px] font-mono text-[#8E98A8]">
                <span>
                  {selected.kind === 'plp'
                    ? selected.op === 'withdraw'
                      ? 'My PLP Shares'
                      : 'Wallet + Predict Vault'
                    : selected.op === 'withdraw'
                      ? 'Supplied Balance'
                      : 'Wallet Available'}
                </span>
                <span className="text-white font-semibold tabular-nums">
                  {fmtUnits(availableActionBalance, 4)}{' '}
                  {selected.kind === 'plp'
                    ? selected.op === 'withdraw'
                      ? 'PLP'
                      : 'USDC'
                    : activeLendingVault?.symbol ?? ''}
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
                  {selected.kind === 'plp'
                    ? selected.op === 'withdraw'
                      ? 'PLP'
                      : 'USDC'
                    : activeLendingVault?.symbol ?? '—'}
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

            {/* Pool Details */}
            <div className="space-y-1.5 text-xs font-mono bg-[#0C0E13] rounded-lg p-3 border border-[#232B3B]">
              {selected.kind === 'lending' && activeLendingVault ? (
                <>
                  <div className="flex justify-between">
                    <span className="text-[#7B8494]">Live Supply APR</span>
                    <span className="text-[#08D189] font-bold">
                      {activeLendingVault.supplyAprPct.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#7B8494]">Utilization</span>
                    <span className="text-white">{activeLendingVault.utilizationPct.toFixed(1)}%</span>
                  </div>
                  {capLeft !== null && (
                    <div className="flex justify-between">
                      <span className="text-[#7B8494]">Supply Cap Left</span>
                      <span className="text-white">
                        {fmtUnits(capLeft, 2)} {activeLendingVault.symbol}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-[#7B8494]">Volt Protocol Fee</span>
                    <span className="text-[#08D189]">0.00% (Native Referral)</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-[#7B8494]">Pool Idle USDC</span>
                    <span className="text-white">
                      {plpVault ? fmtUsd(plpVault.idleUsdc) : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#7B8494]">My PLP Shares</span>
                    <span className="text-[#60A5FA]">
                      {plpVault ? plpVault.userPlpShares.toFixed(2) : '0.00'} PLP
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#7B8494]">Volt Protocol Fee</span>
                    <span className="text-[#08D189]">0.00% (Native Referrer)</span>
                  </div>
                </>
              )}
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
                  : selected.kind === 'plp'
                    ? selected.op === 'supply'
                      ? 'Supply USDC to PLP'
                      : 'Withdraw PLP Shares'
                    : `${selected.op === 'supply' ? 'Supply' : 'Withdraw'} ${
                        activeLendingVault?.symbol ?? ''
                      }`}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
