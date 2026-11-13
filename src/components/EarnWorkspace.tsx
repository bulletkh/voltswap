import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import {
  buildDeepBookMarginSupplyTx,
  buildDeepBookMarginWithdrawTx,
  buildEarnZapTx,
  fetchDeepBookMarginVaults,
  fetchLstVaultStats,
  fetchUserDeepBookMarginPositions,
  fetchVoltMarginSupplyReferrals,
  LST_VAULT_OPTIONS,
  USDC_COIN_TYPE,
  type DeepBookMarginVault,
  type EarnFilterTab,
  type LstVaultLiveStat,
  type UserMarginPosition,
  type VoltMarginSupplyReferral,
} from '../earnPools';
import { extractTxDigest, fetchWalletBalances, readBalanceFromMap, SUI_COIN_TYPE } from '../suiClient';
import { simulateTxBeforeWallet } from '../suiSimulate';
import {
  addWalletVolumeUsd,
  getValidReferrerForSender,
  resolveReferralTier,
  resolveTraderTier,
} from '../voltFee';
import { useSyncedWalletVolume } from '../onChainVolume';
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
  | { kind: 'margin'; op: 'supply' | 'withdraw'; coinKey: string }
  | { kind: 'lst'; op: 'stake' | 'unstake'; symbol: string };

export const EarnWorkspace: React.FC<EarnWorkspaceProps> = ({
  onNotify,
  onTradeRecorded,
  onVolumeUpdated,
}) => {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const ticketRef = useRef<HTMLDivElement | null>(null);

  const [tab, setTab] = useState<EarnFilterTab>('onsite');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'tvl' | 'apy'>('tvl');

  const [marginVaults, setMarginVaults] = useState<DeepBookMarginVault[]>([]);
  const [lstStats, setLstStats] = useState<LstVaultLiveStat[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [supplierCapIds, setSupplierCapIds] = useState<string[]>([]);
  const [marginPositions, setMarginPositions] = useState<Record<string, UserMarginPosition>>({});
  const [marginReferrals, setMarginReferrals] = useState<
    Record<string, VoltMarginSupplyReferral | undefined>
  >({});

  // Interactive Ticket State
  const [selected, setSelected] = useState<SelectedAction>({
    kind: 'margin',
    op: 'supply',
    coinKey: 'USDC',
  });
  const [lstSettlementCoin, setLstSettlementCoin] = useState<'SUI' | 'USDC'>('SUI');
  const [amountInput, setAmountInput] = useState<string>('1');
  const [isExecuting, setIsExecuting] = useState(false);

  const { volumeUsd: volUsd } = useSyncedWalletVolume(account?.address);
  const activeReferrer = useMemo(
    () => getValidReferrerForSender(account?.address),
    [account?.address]
  );
  const traderTier = useMemo(
    () => resolveTraderTier(volUsd, Boolean(activeReferrer)),
    [volUsd, activeReferrer]
  );
  const refTier = useMemo(() => resolveReferralTier(volUsd), [volUsd]);

  const loadAllYieldData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [margins, lsts, refs] = await Promise.all([
        fetchDeepBookMarginVaults().catch(() => []),
        fetchLstVaultStats().catch(() => []),
        fetchVoltMarginSupplyReferrals().catch(() => ({})),
      ]);
      setMarginVaults(margins);
      setLstStats(lsts);
      setMarginReferrals(refs);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshUserPortfolio = useCallback(async () => {
    if (!account?.address) {
      setBalances({});
      setSupplierCapIds([]);
      setMarginPositions({});
      return;
    }
    const [balMap, posData] = await Promise.all([
      fetchWalletBalances(account.address).catch(() => ({})),
      fetchUserDeepBookMarginPositions(account.address).catch(() => ({
        supplierCapIds: [],
        positions: {},
      })),
    ]);
    setBalances(balMap);
    setSupplierCapIds(posData.supplierCapIds);
    setMarginPositions(posData.positions);
  }, [account?.address]);

  useEffect(() => {
    loadAllYieldData();
  }, [loadAllYieldData]);

  useEffect(() => {
    refreshUserPortfolio();
  }, [refreshUserPortfolio]);

  const selectVaultAction = (next: SelectedAction) => {
    setSelected(next);
    if (next.kind === 'lst') {
      const meta = LST_VAULT_OPTIONS.find((x) => x.symbol === next.symbol);
      if (meta) setLstSettlementCoin(meta.basePayCoin);
    }
    if (next.kind === 'margin' && next.op === 'withdraw') {
      const pos = marginPositions[next.coinKey];
      setAmountInput(pos && pos.suppliedAmount > 0 ? String(pos.suppliedAmount) : '');
    } else if (next.kind === 'lst' && next.op === 'unstake') {
      const meta = LST_VAULT_OPTIONS.find((x) => x.symbol === next.symbol);
      const held =
        meta && account?.address ? readBalanceFromMap(balances, meta.coinType, meta.decimals) : 0;
      setAmountInput(held > 0 ? held.toFixed(4) : '');
    } else {
      setAmountInput('1');
    }
    ticketRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // Resolve currently focused vault details
  const activeMarginVault = useMemo(() => {
    if (selected.kind !== 'margin') return null;
    return marginVaults.find((v) => v.coinKey === selected.coinKey) || marginVaults[0] || null;
  }, [selected, marginVaults]);

  const activeLstVault = useMemo(() => {
    if (selected.kind !== 'lst') return null;
    return (
      lstStats.find((l) => l.symbol === selected.symbol) ||
      lstStats[0] || {
        ...LST_VAULT_OPTIONS[0],
        apyPct: LST_VAULT_OPTIONS[0].defaultApyPct,
        tvlUsd: 0,
        exchangeRateToBase: null,
      }
    );
  }, [selected, lstStats]);

  // Compute available balance for active operation
  const availableActionBalance = useMemo(() => {
    if (!account?.address) return 0;
    if (selected.kind === 'margin' && activeMarginVault) {
      if (selected.op === 'supply') {
        return readBalanceFromMap(balances, activeMarginVault.coinType, activeMarginVault.decimals);
      }
      return marginPositions[activeMarginVault.coinKey]?.suppliedAmount ?? 0;
    }
    if (selected.kind === 'lst' && activeLstVault) {
      if (selected.op === 'stake') {
        const payCoinType = lstSettlementCoin === 'USDC' ? USDC_COIN_TYPE : SUI_COIN_TYPE;
        const payDec = lstSettlementCoin === 'USDC' ? 6 : 9;
        return readBalanceFromMap(balances, payCoinType, payDec);
      }
      return readBalanceFromMap(balances, activeLstVault.coinType, activeLstVault.decimals);
    }
    return 0;
  }, [
    account?.address,
    selected,
    activeMarginVault,
    activeLstVault,
    balances,
    marginPositions,
    lstSettlementCoin,
  ]);

  const summaryMetrics = useMemo(() => {
    const marginTvl = marginVaults.reduce((s, v) => s + v.tvlUsd, 0);
    const topMarginApr = marginVaults.reduce((m, v) => Math.max(m, v.supplyAprPct), 0);
    const topLstApy = lstStats.reduce((m, l) => Math.max(m, l.apyPct), 0);
    const userMarginUsd = marginVaults.reduce((s, v) => {
      const pos = marginPositions[v.coinKey];
      return s + (pos ? pos.suppliedAmount * v.priceUsd : 0);
    }, 0);
    const userLstUsd = account?.address
      ? lstStats.reduce((s, l) => {
          const bal = readBalanceFromMap(balances, l.coinType, l.decimals);
          const unitUsd =
            l.category === 'rwa' ? 1 : (marginVaults.find((m) => m.symbol === 'SUI')?.priceUsd ?? 0.81);
          return s + bal * (l.exchangeRateToBase ?? 1) * unitUsd;
        }, 0)
      : 0;
    return {
      marginTvl,
      topMarginApr,
      topLstApy,
      userTotalUsd: userMarginUsd + userLstUsd,
    };
  }, [marginVaults, lstStats, marginPositions, balances, account?.address]);

  const filteredMargins = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? marginVaults.filter(
          (v) => v.symbol.toLowerCase().includes(q) || v.name.toLowerCase().includes(q)
        )
      : marginVaults;
    return [...list].sort((a, b) =>
      sortBy === 'apy' ? b.supplyAprPct - a.supplyAprPct : b.tvlUsd - a.tvlUsd
    );
  }, [marginVaults, search, sortBy]);

  const filteredLsts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base =
      lstStats.length > 0
        ? lstStats
        : LST_VAULT_OPTIONS.map((o) => ({
            ...o,
            apyPct: o.defaultApyPct,
            tvlUsd: 0,
            exchangeRateToBase: null,
          }));
    const list = q
      ? base.filter(
          (l) =>
            l.symbol.toLowerCase().includes(q) ||
            l.protocol.toLowerCase().includes(q) ||
            l.name.toLowerCase().includes(q)
        )
      : base;
    return [...list].sort((a, b) => (sortBy === 'apy' ? b.apyPct - a.apyPct : b.tvlUsd - a.tvlUsd));
  }, [lstStats, search, sortBy]);

  const handleSetPct = (pct: number) => {
    if (availableActionBalance <= 0) return;
    let target = availableActionBalance * pct;
    const isGasAsset =
      selected.kind === 'margin'
        ? selected.op === 'supply' && activeMarginVault?.symbol === 'SUI'
        : selected.op === 'stake' && lstSettlementCoin === 'SUI';
    if (pct >= 0.99 && isGasAsset) {
      target = Math.max(0, availableActionBalance - 0.05);
    }
    setAmountInput(target > 0 ? target.toFixed(target >= 100 ? 2 : 4) : '0');
  };

  const executeOnSiteAction = async () => {
    if (!account?.address) {
      onNotify('info', 'Wallet Required', 'Connect your Sui wallet to deposit or stake.');
      return;
    }
    const amtNum = Number(amountInput);
    if (!Number.isFinite(amtNum) || amtNum <= 0) {
      onNotify('warning', 'Invalid Amount', 'Enter a valid positive amount.');
      return;
    }

    setIsExecuting(true);
    try {
      if (selected.kind === 'margin' && activeMarginVault) {
        if (selected.op === 'supply') {
          const { tx, netDepositHuman } = buildDeepBookMarginSupplyTx({
            sender: account.address,
            coinKey: activeMarginVault.coinKey,
            coinType: activeMarginVault.coinType,
            decimals: activeMarginVault.decimals,
            amountHuman: amtNum,
            existingSupplierCapId:
              marginPositions[activeMarginVault.coinKey]?.supplierCapId ||
              supplierCapIds[0] ||
              null,
            referralId: marginReferrals[activeMarginVault.coinKey]?.referralId || null,
          });

          const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
          if (!sim.ok) {
            onNotify('error', 'Preflight Check Failed', sim.errorMessage || 'Supply aborted.');
            return;
          }

          const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
          const digest = extractTxDigest(res);
          const estUsd = amtNum * activeMarginVault.priceUsd;
          const nextVol = addWalletVolumeUsd(account.address, estUsd);
          onVolumeUpdated?.(nextVol);

          fetch('/api/record-swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              digest,
              address: account.address,
              fromToken: activeMarginVault.symbol,
              toToken: `dbMargin-${activeMarginVault.symbol}`,
              fromAmount: amtNum,
              toAmount: netDepositHuman,
              volumeUsd: estUsd,
              feeRate: traderTier.feeRate,
              tierName: traderTier.name,
              swapMode: 'DEEPBOOK_MARGIN_SUPPLY',
              referrer: activeReferrer,
            }),
          }).catch(() => {});

          onNotify(
            'success',
            `Supplied ${netDepositHuman.toFixed(4)} ${activeMarginVault.symbol}`,
            `Earning ${activeMarginVault.supplyAprPct.toFixed(2)}% APR in DeepBook v3 Vault.`,
            'Suiscan',
            `https://suiscan.xyz/mainnet/tx/${digest}`
          );
          onTradeRecorded({
            fromToken: activeMarginVault.symbol,
            toToken: `${activeMarginVault.symbol} Vault`,
            fromAmount: amtNum.toFixed(4),
            toAmount: netDepositHuman.toFixed(4),
            volumeUsd: estUsd,
            digest,
            orderType: 'SWAP',
          });
        } else {
          const pos = marginPositions[activeMarginVault.coinKey];
          if (!pos || pos.suppliedAmount <= 0) {
            onNotify(
              'warning',
              'No Active Deposit',
              `You have no supplied ${activeMarginVault.symbol} position to withdraw.`
            );
            return;
          }
          const withdrawAll = amtNum >= pos.suppliedAmount * 0.995;
          const tx = buildDeepBookMarginWithdrawTx({
            sender: account.address,
            coinKey: activeMarginVault.coinKey,
            supplierCapId: pos.supplierCapId,
            amountHuman: withdrawAll ? undefined : amtNum,
            withdrawAll,
          });

          const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
          if (!sim.ok) {
            onNotify('error', 'Preflight Check Failed', sim.errorMessage || 'Withdraw aborted.');
            return;
          }

          const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
          const digest = extractTxDigest(res);
          onNotify(
            'success',
            `Withdrew ${amtNum.toFixed(4)} ${activeMarginVault.symbol}`,
            'Principal + accrued interest returned directly to your wallet.',
            'Suiscan',
            `https://suiscan.xyz/mainnet/tx/${digest}`
          );
        }
      } else if (selected.kind === 'lst' && activeLstVault) {
        const baseType = lstSettlementCoin === 'USDC' ? USDC_COIN_TYPE : SUI_COIN_TYPE;
        const baseDec = lstSettlementCoin === 'USDC' ? 6 : 9;
        const fromType = selected.op === 'stake' ? baseType : activeLstVault.coinType;
        const toType = selected.op === 'stake' ? activeLstVault.coinType : baseType;
        const inDec = selected.op === 'stake' ? baseDec : activeLstVault.decimals;
        const outDec = selected.op === 'stake' ? activeLstVault.decimals : baseDec;
        const outSym = selected.op === 'stake' ? activeLstVault.symbol : lstSettlementCoin;
        const inSym = selected.op === 'stake' ? lstSettlementCoin : activeLstVault.symbol;

        const atomic = BigInt(Math.floor(amtNum * Math.pow(10, inDec)));
        const { tx, expectedOutAtomic } = await buildEarnZapTx({
          sender: account.address,
          inputCoinType: fromType,
          targetCoinType: toType,
          amountInAtomic: atomic,
          feeRate: traderTier.feeRate,
          refSharePct: refTier.revSharePct,
        });

        const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
        if (!sim.ok) {
          onNotify('error', 'Preflight Check Failed', sim.errorMessage || 'Transaction aborted.');
          return;
        }

        const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
        const digest = extractTxDigest(res);
        const outHuman = (Number(expectedOutAtomic) / Math.pow(10, outDec)).toFixed(4);
        const suiPx = marginVaults.find((m) => m.symbol === 'SUI')?.priceUsd ?? 0.81;
        const estUsd =
          inSym === 'USDC' || inSym === 'USDY' || inSym === 'BUCK' ? amtNum : amtNum * suiPx;

        const nextVol = addWalletVolumeUsd(account.address, estUsd);
        onVolumeUpdated?.(nextVol);

        onNotify(
          'success',
          selected.op === 'stake'
            ? `Staked ${outHuman} ${outSym}`
            : `Redeemed ${outHuman} ${outSym}`,
          `Executed ${inSym} -> ${outSym} atomically inside VoltSwap PTB.`,
          'Suiscan',
          `https://suiscan.xyz/mainnet/tx/${digest}`
        );
        onTradeRecorded({
          fromToken: inSym,
          toToken: outSym,
          fromAmount: amtNum.toFixed(4),
          toAmount: outHuman,
          volumeUsd: estUsd,
          digest,
          orderType: 'SWAP',
        });
      }

      await Promise.all([loadAllYieldData(), refreshUserPortfolio()]);
    } catch (err: any) {
      onNotify('error', 'Action Failed', err?.message || 'Transaction rejected.');
    } finally {
      setIsExecuting(false);
    }
  };

  const estYieldPerYear = useMemo(() => {
    const amt = Number(amountInput) || 0;
    if (amt <= 0) return null;
    if (selected.kind === 'margin' && activeMarginVault) {
      return {
        apr: activeMarginVault.supplyAprPct,
        estUsdYr: amt * activeMarginVault.priceUsd * (activeMarginVault.supplyAprPct / 100),
      };
    }
    if (selected.kind === 'lst' && activeLstVault) {
      const suiPx = marginVaults.find((m) => m.symbol === 'SUI')?.priceUsd ?? 0.81;
      const baseUsd =
        lstSettlementCoin === 'USDC' || activeLstVault.category === 'rwa' ? amt : amt * suiPx;
      return {
        apr: activeLstVault.apyPct,
        estUsdYr: baseUsd * (activeLstVault.apyPct / 100),
      };
    }
    return null;
  }, [amountInput, selected, activeMarginVault, activeLstVault, lstSettlementCoin, marginVaults]);

  return (
    <div className="w-full space-y-4 animate-panel-in">
      {/* Top Joined Institutional 4-Cell KPI Strip */}
      <div className="bg-[#06070A] border border-[#2E384C] rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[#2D374B] overflow-hidden">
        <div className="p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">DeepBook On-Site Vault TVL</div>
          <div className="text-2xl font-mono tabular-nums font-bold text-white mt-1">
            ${summaryMetrics.marginTvl >= 1e6
              ? `${(summaryMetrics.marginTvl / 1e6).toFixed(2)}M`
              : `${(summaryMetrics.marginTvl / 1e3).toFixed(1)}K`}
          </div>
          <div className="text-xs font-mono text-[#60A5FA] mt-0.5">
            {marginVaults.length} Native On-Chain Vaults
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Top Lending Supply APR</div>
          <div className="text-2xl font-mono tabular-nums font-bold text-[#08D189] mt-1">
            {summaryMetrics.topMarginApr > 0 ? `${summaryMetrics.topMarginApr.toFixed(2)}%` : '—'}
          </div>
          <div className="text-xs font-mono text-slate-400 mt-0.5">Real Borrower Interest</div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Top Staking &amp; RWA Yield</div>
          <div className="text-2xl font-mono tabular-nums font-bold text-[#08D189] mt-1">
            {summaryMetrics.topLstApy > 0 ? `${summaryMetrics.topLstApy.toFixed(2)}%` : '—'}
          </div>
          <div className="text-xs font-mono text-slate-400 mt-0.5">
            haSUI · afSUI · vSUI · sSUI · USDY
          </div>
        </div>

        <div className="p-4">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Your On-Site Deposits</div>
          <div className="text-2xl font-mono tabular-nums font-bold text-white mt-1">
            ${summaryMetrics.userTotalUsd.toFixed(2)}
          </div>
          <div className="text-xs font-mono text-[#60A5FA] mt-0.5">
            {supplierCapIds.length > 0
              ? `SupplierCap Active (${supplierCapIds.length})`
              : account
                ? 'Zero-custody Sui PTB'
                : 'Connect wallet to view'}
          </div>
        </div>
      </div>

      {/* Main Layout: Left Interactive Pools Table (8 cols) + Right On-Site Execution Ticket (4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        <div className="lg:col-span-8 space-y-4">
          {/* Sub-Tabs & Filter Bar */}
          <div className="bg-[#06070A] border border-[#2E384C] rounded-xl p-2.5 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  { id: 'onsite', label: 'All On-Site Vaults' },
                  { id: 'margin', label: 'DeepBook Lending' },
                  { id: 'lst', label: 'Staking & RWA' },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    tab === item.id
                      ? 'bg-[#2B7FFF] text-white font-bold shadow-[0_0_12px_rgba(43,127,255,0.28)]'
                      : 'text-slate-400 hover:text-white hover:bg-white/[0.04]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search asset..."
                  className="pl-8 pr-3 py-1.5 rounded-lg bg-[#000000] border border-[#2D374B] text-xs text-white placeholder:text-slate-500 outline-none focus:border-[#2B7FFF] w-36 sm:w-44"
                />
              </div>
              <button
                type="button"
                onClick={loadAllYieldData}
                className="p-2 rounded-lg bg-[#000000] border border-[#2D374B] text-slate-400 hover:text-white hover:border-[#2B7FFF]/50 transition-colors"
                title="Refresh live rates"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* SECTION 1: DeepBook v3 Margin Lending Vaults (On-Site Supply & Withdraw) */}
          {(tab === 'onsite' || tab === 'margin') && (
            <div className="bg-[#06070A] border border-[#2E384C] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#2D374B] flex flex-wrap items-center justify-between gap-2 bg-[#000000]">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-[#60A5FA]" />
                  <span className="text-sm font-bold text-white">
                    DeepBook v3 Margin Lending Vaults
                  </span>
                  <span className="px-2 py-0.5 rounded bg-[#08D189]/12 text-[#08D189] border border-[#08D189]/30 text-[11px] font-mono font-semibold">
                    ON-SITE EXECUTION
                  </span>
                </div>
                <span className="text-xs font-mono text-slate-400">
                  Direct Supply &amp; Withdraw on VoltSwap
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-[#2D374B] bg-[#000000]">
                      <th className="text-left px-4 py-2.5 font-semibold">Vault Asset</th>
                      <th className="text-right px-3 py-2.5 font-semibold">
                        <button
                          type="button"
                          onClick={() => setSortBy('tvl')}
                          className={sortBy === 'tvl' ? 'text-[#60A5FA]' : 'hover:text-white'}
                        >
                          Supplied TVL
                        </button>
                      </th>
                      <th className="text-right px-3 py-2.5 font-semibold hidden sm:table-cell">
                        Utilization
                      </th>
                      <th className="text-right px-3 py-2.5 font-semibold">
                        <button
                          type="button"
                          onClick={() => setSortBy('apy')}
                          className={sortBy === 'apy' ? 'text-[#60A5FA]' : 'hover:text-white'}
                        >
                          Supply APR
                        </button>
                      </th>
                      <th className="text-right px-3 py-2.5 font-semibold hidden md:table-cell">
                        My Deposit
                      </th>
                      <th className="text-right px-4 py-2.5 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums divide-y divide-[#2D374B]/70">
                    {filteredMargins.map((v) => {
                      const pos = marginPositions[v.coinKey];
                      const hasDep = Boolean(pos && pos.suppliedAmount > 0.000001);
                      const isRowFocused =
                        selected.kind === 'margin' && selected.coinKey === v.coinKey;
                      return (
                        <tr
                          key={v.coinKey}
                          className={`transition-colors ${
                            isRowFocused ? 'bg-[#2B7FFF]/10' : 'hover:bg-white/[0.02]'
                          }`}
                        >
                          <td className="px-4 py-3 font-sans">
                            <div className="flex items-center gap-2.5">
                              <img src={v.logo} alt={v.symbol} className="w-6 h-6 rounded-full" />
                              <div>
                                <div className="font-bold text-white">{v.symbol}</div>
                                <div className="text-[11px] text-slate-400">
                                  Borrow {v.borrowAprPct.toFixed(2)}%
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <div className="text-white font-semibold">
                              ${v.tvlUsd >= 1e6
                                ? `${(v.tvlUsd / 1e6).toFixed(2)}M`
                                : v.tvlUsd >= 1000
                                  ? `${(v.tvlUsd / 1e3).toFixed(1)}K`
                                  : v.tvlUsd.toFixed(0)}
                            </div>
                            <div className="text-[11px] text-slate-400">
                              {v.totalSupply >= 1e6
                                ? `${(v.totalSupply / 1e6).toFixed(2)}M`
                                : v.totalSupply >= 1000
                                  ? `${(v.totalSupply / 1e3).toFixed(1)}K`
                                  : v.totalSupply.toFixed(3)}{' '}
                              {v.symbol}
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right hidden sm:table-cell">
                            <div className="text-white">{v.utilizationPct.toFixed(1)}%</div>
                            <div className="w-16 h-1.5 rounded-full bg-white/[0.08] ml-auto mt-1 overflow-hidden">
                              <div
                                className="h-full bg-[#2B7FFF]"
                                style={{ width: `${Math.min(100, v.utilizationPct)}%` }}
                              />
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-[#08D189] text-sm">
                            {v.supplyAprPct.toFixed(2)}%
                          </td>
                          <td className="px-3 py-3 text-right hidden md:table-cell">
                            {hasDep ? (
                              <span className="text-[#08D189] font-semibold">
                                {pos!.suppliedAmount.toFixed(4)} {v.symbol}
                              </span>
                            ) : (
                              <span className="text-slate-500">0.00</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right font-sans">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  selectVaultAction({
                                    kind: 'margin',
                                    op: 'supply',
                                    coinKey: v.coinKey,
                                  })
                                }
                                className="px-3 py-1.5 rounded-md btn-deepbook font-bold text-xs transition-colors"
                              >
                                Supply
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  selectVaultAction({
                                    kind: 'margin',
                                    op: 'withdraw',
                                    coinKey: v.coinKey,
                                  })
                                }
                                className={`px-2.5 py-1.5 rounded-md border text-xs font-semibold transition-colors ${
                                  hasDep
                                    ? 'border-[#08D189]/45 text-[#08D189] hover:bg-[#08D189]/15'
                                    : 'border-[#323D52] text-slate-300 hover:text-white hover:bg-white/[0.05]'
                                }`}
                              >
                                Withdraw
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* SECTION 2: Liquid Staking & RWA Yield Vaults (On-Site Stake & Unstake) */}
          {(tab === 'onsite' || tab === 'lst') && (
            <div className="bg-[#06070A] border border-[#2E384C] rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-[#2D374B] flex flex-wrap items-center justify-between gap-2 bg-[#000000]">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-[#08D189]" />
                  <span className="text-sm font-bold text-white">
                    Sui Liquid Staking &amp; Treasury Yield
                  </span>
                  <span className="px-2 py-0.5 rounded bg-[#08D189]/12 text-[#08D189] border border-[#08D189]/30 text-[11px] font-mono font-semibold">
                    1-CLICK STAKE &amp; REDEEM
                  </span>
                </div>
                <span className="text-xs font-mono text-slate-400">
                  Cetus Aggregator PTB
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-[#2D374B] bg-[#000000]">
                      <th className="text-left px-4 py-2.5 font-semibold">Yield Token</th>
                      <th className="text-left px-3 py-2.5 font-semibold hidden sm:table-cell">
                        Protocol
                      </th>
                      <th className="text-right px-3 py-2.5 font-semibold">Live Rate</th>
                      <th className="text-right px-3 py-2.5 font-semibold">Est. APY</th>
                      <th className="text-right px-3 py-2.5 font-semibold hidden md:table-cell">
                        My Balance
                      </th>
                      <th className="text-right px-4 py-2.5 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono tabular-nums divide-y divide-[#2D374B]/70">
                    {filteredLsts.map((item) => {
                      const held = account?.address
                        ? readBalanceFromMap(balances, item.coinType, item.decimals)
                        : 0;
                      const isRowFocused =
                        selected.kind === 'lst' && selected.symbol === item.symbol;
                      return (
                        <tr
                          key={item.symbol}
                          className={`transition-colors ${
                            isRowFocused ? 'bg-[#2B7FFF]/10' : 'hover:bg-white/[0.02]'
                          }`}
                        >
                          <td className="px-4 py-3 font-sans">
                            <div className="flex items-center gap-2.5">
                              <img src={item.logo} alt={item.symbol} className="w-6 h-6 rounded-full" />
                              <div>
                                <div className="font-bold text-white">{item.symbol}</div>
                                <div className="text-xs text-slate-400 sm:hidden">
                                  {item.protocol}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 font-sans text-slate-300 hidden sm:table-cell">
                            {item.protocol}
                          </td>
                          <td className="px-3 py-3 text-right text-slate-300">
                            {item.exchangeRateToBase
                              ? `1 = ${item.exchangeRateToBase.toFixed(4)} ${item.basePayCoin}`
                              : '—'}
                          </td>
                          <td className="px-3 py-3 text-right font-bold text-[#08D189] text-sm">
                            {item.apyPct.toFixed(2)}%
                          </td>
                          <td className="px-3 py-3 text-right hidden md:table-cell">
                            <span className={held > 0.0001 ? 'text-white font-semibold' : 'text-slate-500'}>
                              {held > 0.0001 ? held.toFixed(4) : '0.00'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-sans">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  selectVaultAction({
                                    kind: 'lst',
                                    op: 'stake',
                                    symbol: item.symbol,
                                  })
                                }
                                className="px-3 py-1.5 rounded-md btn-deepbook font-bold text-xs transition-colors"
                              >
                                {item.category === 'rwa' ? 'Deposit' : 'Stake'}
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  selectVaultAction({
                                    kind: 'lst',
                                    op: 'unstake',
                                    symbol: item.symbol,
                                  })
                                }
                                className={`px-2.5 py-1.5 rounded-md border text-xs font-semibold transition-colors ${
                                  held > 0.0001
                                    ? 'border-[#08D189]/45 text-[#08D189] hover:bg-[#08D189]/15'
                                    : 'border-[#323D52] text-slate-300 hover:text-white hover:bg-white/[0.05]'
                                }`}
                              >
                                {item.category === 'rwa' ? 'Redeem' : 'Unstake'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Right Sticky Execution Ticket (Always Interactive On-Site) */}
        <div
          ref={ticketRef}
          className="lg:col-span-4 bg-[#06070A] border border-[#2E384C] rounded-xl p-4 space-y-4 lg:sticky lg:top-16"
        >
          {/* Mode Switcher */}
          {selected.kind === 'margin' && activeMarginVault ? (
            <>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <img
                    src={activeMarginVault.logo}
                    alt={activeMarginVault.symbol}
                    className="w-7 h-7 rounded-full"
                  />
                  <div>
                    <div className="text-sm font-bold text-white">{activeMarginVault.name}</div>
                    <div className="text-xs font-mono text-[#08D189]">
                      {activeMarginVault.supplyAprPct.toFixed(2)}% Live Supply APR
                    </div>
                  </div>
                </div>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#2B7FFF]/15 text-[#60A5FA] border border-[#2B7FFF]/40">
                  DeepBook v3
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#000000] border border-[#2D374B]">
                <button
                  type="button"
                  onClick={() =>
                    selectVaultAction({
                      kind: 'margin',
                      op: 'supply',
                      coinKey: activeMarginVault.coinKey,
                    })
                  }
                  className={`py-2 rounded text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    selected.op === 'supply'
                      ? 'bg-[#2B7FFF] text-white font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <ArrowDownToLine className="w-3.5 h-3.5" />
                  <span>Supply</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    selectVaultAction({
                      kind: 'margin',
                      op: 'withdraw',
                      coinKey: activeMarginVault.coinKey,
                    })
                  }
                  className={`py-2 rounded text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    selected.op === 'withdraw'
                      ? 'bg-[#08D189] text-[#02060A]'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <ArrowUpFromLine className="w-3.5 h-3.5" />
                  <span>Withdraw</span>
                </button>
              </div>
            </>
          ) : (
            activeLstVault && (
              <>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <img
                      src={activeLstVault.logo}
                      alt={activeLstVault.symbol}
                      className="w-7 h-7 rounded-full"
                    />
                    <div>
                      <div className="text-sm font-bold text-white">{activeLstVault.name}</div>
                      <div className="text-xs font-mono text-[#08D189]">
                        {activeLstVault.apyPct.toFixed(2)}% Est. APY
                      </div>
                    </div>
                  </div>
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#08D189]/12 text-[#08D189] border border-[#08D189]/30">
                    On-Site PTB
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-[#000000] border border-[#2D374B]">
                  <button
                    type="button"
                    onClick={() =>
                      selectVaultAction({
                        kind: 'lst',
                        op: 'stake',
                        symbol: activeLstVault.symbol,
                      })
                    }
                    className={`py-2 rounded text-xs font-bold transition-all ${
                      selected.op === 'stake'
                        ? 'bg-[#2B7FFF] text-white font-bold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {activeLstVault.category === 'rwa' ? 'Deposit' : 'Stake'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      selectVaultAction({
                        kind: 'lst',
                        op: 'unstake',
                        symbol: activeLstVault.symbol,
                      })
                    }
                    className={`py-2 rounded text-xs font-bold transition-all ${
                      selected.op === 'unstake'
                        ? 'bg-[#08D189] text-[#02060A]'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {activeLstVault.category === 'rwa' ? 'Redeem' : 'Unstake'}
                  </button>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">
                    {selected.op === 'stake' ? 'Pay With:' : 'Redeem Into:'}
                  </span>
                  <div className="flex items-center gap-1">
                    {(['SUI', 'USDC'] as const).map((sym) => (
                      <button
                        key={sym}
                        type="button"
                        onClick={() => setLstSettlementCoin(sym)}
                        className={`px-2.5 py-1 rounded font-mono text-xs font-semibold ${
                          lstSettlementCoin === sym
                            ? 'bg-[#2B7FFF] text-white'
                            : 'bg-[#000000] text-slate-300 border border-[#2D374B]'
                        }`}
                      >
                        {sym}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )
          )}

          {/* Amount Input Card */}
          <div className="bg-[#000000] border border-[#2D374B] focus-within:border-[#2B7FFF]/60 rounded-lg p-3.5 space-y-2 transition-colors">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400">
                {selected.kind === 'margin' && selected.op === 'withdraw'
                  ? 'Deposited Balance'
                  : 'Wallet Balance'}
              </span>
              <span className="text-white font-semibold tabular-nums">
                {availableActionBalance.toFixed(4)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="any"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
                placeholder="0.00"
                className="flex-1 min-w-0 bg-transparent text-2xl font-mono font-bold text-white outline-none"
              />
              <span className="px-2.5 py-1 rounded bg-[#0C0E13] border border-[#2D374B] text-xs font-mono font-bold text-white">
                {selected.kind === 'margin'
                  ? activeMarginVault?.symbol || 'USDC'
                  : selected.op === 'stake'
                    ? lstSettlementCoin
                    : activeLstVault?.symbol || 'haSUI'}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-1.5 pt-1">
              {[0.25, 0.5, 0.75, 1].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => handleSetPct(p)}
                  className="py-1 rounded bg-[#0C0E13] hover:bg-[#2B7FFF]/20 border border-[#2D374B] text-xs font-mono font-semibold text-slate-300 hover:text-white transition-colors"
                >
                  {p === 1 ? 'MAX' : `${p * 100}%`}
                </button>
              ))}
            </div>
          </div>

          {/* Transparent Estimates & Volt Fee Breakdown */}
          <div className="bg-[#000000] border border-[#2D374B] rounded-lg p-3 space-y-2 text-xs font-mono">
            {estYieldPerYear && (
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Est. Yield / Year</span>
                <span className="text-[#08D189] font-bold">
                  +${estYieldPerYear.estUsdYr.toFixed(2)} ({estYieldPerYear.apr.toFixed(2)}%)
                </span>
              </div>
            )}
            <div className="flex items-center justify-between">
              <span className="text-slate-400">
                {selected.kind === 'margin'
                  ? 'Vault Deposit Fee'
                  : `Volt Tier Fee (${traderTier.name})`}
              </span>
              <span className="text-[#60A5FA] font-semibold">
                {selected.kind === 'margin'
                  ? selected.op === 'withdraw'
                    ? '0.00% (Free Withdraw)'
                    : '0.00% (100% Principal · DeepBook Ref)'
                  : `${(traderTier.feeRate * 100).toFixed(2)}%`}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Custody Model</span>
              <span className="text-[#08D189] inline-flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                Wallet / SupplierCap
              </span>
            </div>
          </div>

          <button
            type="button"
            disabled={isExecuting}
            onClick={executeOnSiteAction}
            className={`w-full py-3 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 ${
              (selected.kind === 'margin' && selected.op === 'withdraw') ||
              (selected.kind === 'lst' && selected.op === 'unstake')
                ? 'bg-[#08D189] hover:bg-[#0DE295] text-[#02060A]'
                : 'btn-deepbook'
            }`}
          >
            {isExecuting && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>
              {!account
                ? 'Connect Sui Wallet'
                : isExecuting
                  ? 'Confirm in Wallet...'
                  : selected.kind === 'margin'
                    ? selected.op === 'supply'
                      ? `Supply ${activeMarginVault?.symbol || ''} to Vault`
                      : `Withdraw ${activeMarginVault?.symbol || ''}`
                    : selected.op === 'stake'
                      ? `Stake ${lstSettlementCoin} -> ${activeLstVault?.symbol || ''}`
                      : `Redeem ${activeLstVault?.symbol || ''} -> ${lstSettlementCoin}`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
