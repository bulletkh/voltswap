import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Coins,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import {
  buildCetusCollectFeesTx,
  buildCetusOpenAndAddLiquidityTx,
  buildCetusRemoveLiquidityTx,
  buildSuilendDepositTx,
  buildSuilendWithdrawTx,
  fetchCetusClmmPools,
  fetchSuilendReserves,
  fetchUserCetusPositions,
  fetchUserSuilendPositions,
  quoteCetusAddLiquidity,
  type CetusClmmPoolLive,
  type CetusUserPositionView,
  type SuilendReserveLive,
  type SuilendUserState,
} from '../nativeEarn';
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

type EarnSection = 'clmm' | 'suilend';
type RangePreset = 'tight' | 'balanced' | 'wide' | 'full';

const fmtUsd = (v: number): string => {
  if (!Number.isFinite(v) || v <= 0) return '$0.00';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(2)}K`;
  return `$${v.toFixed(2)}`;
};

const fmtUnits = (v: number, maxDecimals = 4): string => {
  if (!Number.isFinite(v) || v <= 0) return '0';
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
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

  const [section, setSection] = useState<EarnSection>('clmm');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Cetus CLMM state
  const [clmmPools, setClmmPools] = useState<CetusClmmPoolLive[]>([]);
  const [clmmPositions, setClmmPositions] = useState<CetusUserPositionView[]>([]);
  const [selectedPoolId, setSelectedPoolId] = useState<string>(
    '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105'
  );
  const [fixedCoin, setFixedCoin] = useState<'a' | 'b'>('b');
  const [rangeMode, setRangeMode] = useState<RangePreset>('balanced');
  const [clmmAmountInput, setClmmAmountInput] = useState<string>('');
  const [clmmQuote, setClmmQuote] = useState<{
    calc: any;
    addModeParams: any;
    amountAHuman: number;
    amountBHuman: number;
  } | null>(null);
  const [isQuotingClmm, setIsQuotingClmm] = useState(false);

  // Suilend Lending state
  const [reserves, setReserves] = useState<SuilendReserveLive[]>([]);
  const [suilendUser, setSuilendUser] = useState<SuilendUserState>({
    obligationId: null,
    obligationOwnerCapId: null,
    depositsByCoinType: {},
  });
  const [selectedReserveCoin, setSelectedReserveCoin] = useState<string>('');
  const [lendingOp, setLendingOp] = useState<'supply' | 'withdraw'>('supply');
  const [lendingAmountInput, setLendingAmountInput] = useState<string>('');

  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyPosId, setBusyPosId] = useState<string | null>(null);

  const reqIdRef = useRef(0);

  const loadAll = useCallback(
    async (silent = false) => {
      const reqId = ++reqIdRef.current;
      if (silent) setIsRefreshing(true);
      else setIsLoading(true);

      try {
        const [poolsRes, reservesRes, slUserRes, balMap] = await Promise.all([
          fetchCetusClmmPools().catch(() => [] as CetusClmmPoolLive[]),
          fetchSuilendReserves().catch(() => [] as SuilendReserveLive[]),
          account?.address
            ? fetchUserSuilendPositions(account.address).catch(() => ({
                obligationId: null,
                obligationOwnerCapId: null,
                depositsByCoinType: {},
              }))
            : Promise.resolve({
                obligationId: null,
                obligationOwnerCapId: null,
                depositsByCoinType: {},
              }),
          account?.address
            ? fetchWalletBalances(account.address).catch(() => ({} as Record<string, bigint>))
            : Promise.resolve({} as Record<string, bigint>),
        ]);

        if (reqId !== reqIdRef.current) return;
        setClmmPools(poolsRes);
        setReserves(reservesRes);
        setSuilendUser(slUserRes);
        setBalances(balMap);

        if (poolsRes.length > 0 && !poolsRes.some((p) => p.poolId === selectedPoolId)) {
          setSelectedPoolId(poolsRes[0].poolId);
        }
        if (
          reservesRes.length > 0 &&
          (!selectedReserveCoin || !reservesRes.some((r) => r.coinType === selectedReserveCoin))
        ) {
          setSelectedReserveCoin(reservesRes[0].coinType);
        }

        if (account?.address && poolsRes.length > 0) {
          const posList = await fetchUserCetusPositions(account.address, poolsRes).catch(
            () => [] as CetusUserPositionView[]
          );
          if (reqId === reqIdRef.current) {
            setClmmPositions(posList);
          }
        } else {
          setClmmPositions([]);
        }
      } finally {
        if (reqId === reqIdRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [account?.address, selectedPoolId, selectedReserveCoin]
  );

  useEffect(() => {
    loadAll(false);
  }, [account?.address]); // eslint-disable-line react-hooks/exhaustive-deps

  const activePool = useMemo(
    () => clmmPools.find((p) => p.poolId === selectedPoolId) || clmmPools[0] || null,
    [clmmPools, selectedPoolId]
  );

  const activeReserve = useMemo(
    () => reserves.find((r) => r.coinType === selectedReserveCoin) || reserves[0] || null,
    [reserves, selectedReserveCoin]
  );

  // Live quote for Cetus CLMM add liquidity
  const parsedClmmAmount = useMemo(() => {
    const n = Number(clmmAmountInput);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [clmmAmountInput]);

  useEffect(() => {
    if (section !== 'clmm' || !activePool || parsedClmmAmount <= 0) {
      setClmmQuote(null);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setIsQuotingClmm(true);
      try {
        const q = await quoteCetusAddLiquidity({
          poolMeta: activePool,
          fixedCoin,
          amountHuman: parsedClmmAmount,
          rangeMode,
          slippage: 0.015,
        });
        if (!cancelled) setClmmQuote(q);
      } catch {
        if (!cancelled) setClmmQuote(null);
      } finally {
        if (!cancelled) setIsQuotingClmm(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [section, activePool, parsedClmmAmount, fixedCoin, rangeMode]);

  const clmmWalletBalA = useMemo(() => {
    if (!activePool) return 0;
    const raw = readBalanceFromMap(balances, activePool.pool.coin_type_a, activePool.decimalsA);
    return activePool.pool.coin_type_a.endsWith('::sui::SUI') ? Math.max(0, raw - 0.02) : raw;
  }, [activePool, balances]);

  const clmmWalletBalB = useMemo(() => {
    if (!activePool) return 0;
    const raw = readBalanceFromMap(balances, activePool.pool.coin_type_b, activePool.decimalsB);
    return activePool.pool.coin_type_b.endsWith('::sui::SUI') ? Math.max(0, raw - 0.02) : raw;
  }, [activePool, balances]);

  useEffect(() => {
    if (!activePool) return;
    if (fixedCoin === 'b' && clmmWalletBalB <= 0 && clmmWalletBalA > 0) {
      setFixedCoin('a');
    } else if (fixedCoin === 'a' && clmmWalletBalA <= 0 && clmmWalletBalB > 0) {
      setFixedCoin('b');
    }
  }, [activePool?.poolId, clmmWalletBalA, clmmWalletBalB]); // eslint-disable-line react-hooks/exhaustive-deps

  const clmmValidationError = useMemo(() => {
    if (!activePool || !clmmQuote) return null;
    if (clmmQuote.amountAHuman > clmmWalletBalA + 1e-6) {
      return `Insufficient ${activePool.symbolA}: need ${fmtUnits(clmmQuote.amountAHuman, 4)}, have ${fmtUnits(clmmWalletBalA, 4)}.`;
    }
    if (clmmQuote.amountBHuman > clmmWalletBalB + 1e-6) {
      return `Insufficient ${activePool.symbolB}: need ${fmtUnits(clmmQuote.amountBHuman, 4)}, have ${fmtUnits(clmmWalletBalB, 4)}.`;
    }
    return null;
  }, [activePool, clmmQuote, clmmWalletBalA, clmmWalletBalB]);

  const lendingAvailableBal = useMemo(() => {
    if (!activeReserve) return 0;
    if (lendingOp === 'withdraw') {
      return suilendUser.depositsByCoinType[activeReserve.coinType] ?? 0;
    }
    const raw = readBalanceFromMap(balances, activeReserve.coinType, activeReserve.decimals);
    return activeReserve.coinType === SUI_COIN_TYPE ? Math.max(0, raw - 0.02) : raw;
  }, [activeReserve, lendingOp, suilendUser, balances]);

  const parsedLendingAmount = useMemo(() => {
    const n = Number(lendingAmountInput);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [lendingAmountInput]);

  const lendingValidationError = useMemo(() => {
    if (!activeReserve || parsedLendingAmount <= 0) return null;
    if (parsedLendingAmount > lendingAvailableBal + 1e-9) {
      return 'Amount exceeds your available balance.';
    }
    if (lendingOp === 'withdraw' && parsedLendingAmount > activeReserve.availableLiquidity) {
      return `Exceeds reserve free liquidity (${fmtUnits(activeReserve.availableLiquidity, 2)} ${activeReserve.symbol}).`;
    }
    return null;
  }, [activeReserve, parsedLendingAmount, lendingAvailableBal, lendingOp]);

  const filteredReserves = useMemo(() => {
    const q = search.trim().toLowerCase();
    return reserves.filter(
      (r) => !q || r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
    );
  }, [reserves, search]);

  const totalTvlUsd = useMemo(() => {
    const cTvl = clmmPools.reduce((s, p) => s + (p.tvlUsd || 0), 0);
    const sTvl = reserves.reduce((s, r) => s + (r.tvlUsd || 0), 0);
    return cTvl + sTvl;
  }, [clmmPools, reserves]);

  const topClmmApy = useMemo(
    () => clmmPools.reduce((m, p) => Math.max(m, p.totalApyPct || 0), 0),
    [clmmPools]
  );

  const topSuilendApr = useMemo(
    () => reserves.reduce((m, r) => Math.max(m, r.depositAprPct || 0), 0),
    [reserves]
  );

  const handleAddClmmLiquidity = async () => {
    if (!account?.address) {
      onNotify('warning', 'Wallet Required', 'Connect your Sui wallet to provide liquidity.');
      return;
    }
    if (!activePool || !clmmQuote || clmmValidationError) return;

    setIsSubmitting(true);
    try {
      const tx = await buildCetusOpenAndAddLiquidityTx({
        sender: account.address,
        poolId: activePool.poolId,
        calc: clmmQuote.calc,
        addModeParams: clmmQuote.addModeParams,
      });
      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) {
        onNotify('error', 'CLMM Preflight Failed', sim.errorMessage || 'Simulation failed.');
        return;
      }
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      onNotify(
        'success',
        `Added Liquidity to ${activePool.name}`,
        `Deposited ${fmtUnits(clmmQuote.amountAHuman, 4)} ${activePool.symbolA} + ${fmtUnits(clmmQuote.amountBHuman, 4)} ${activePool.symbolB}.`,
        'Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
      setClmmAmountInput('');
      setClmmQuote(null);
      await loadAll(true);
    } catch (err: any) {
      onNotify('error', 'CLMM Transaction Failed', err?.message || 'Wallet rejected transaction.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCollectFees = async (posView: CetusUserPositionView) => {
    if (!account?.address) return;
    const poolMatch = clmmPools.find(
      (p) => p.poolId.toLowerCase() === String(posView.position.pool).toLowerCase()
    );
    if (!poolMatch) return;
    setBusyPosId(posView.position.pos_object_id);
    try {
      const tx = await buildCetusCollectFeesTx({
        sender: account.address,
        pool: poolMatch.pool,
        positionId: posView.position.pos_object_id,
      });
      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) {
        onNotify('error', 'Collect Fees Failed', sim.errorMessage || 'Simulation failed.');
        return;
      }
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      onNotify(
        'success',
        'Collected Cetus Fees',
        `Claimed fees from ${posView.poolName}.`,
        'Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
      await loadAll(true);
    } catch (err: any) {
      onNotify('error', 'Collect Cancelled', err?.message || 'Transaction cancelled.');
    } finally {
      setBusyPosId(null);
    }
  };

  const handleCloseClmmPosition = async (posView: CetusUserPositionView) => {
    if (!account?.address) return;
    const poolMatch = clmmPools.find(
      (p) => p.poolId.toLowerCase() === String(posView.position.pool).toLowerCase()
    );
    if (!poolMatch) return;
    setBusyPosId(posView.position.pos_object_id);
    try {
      const tx = await buildCetusRemoveLiquidityTx({
        sender: account.address,
        pool: poolMatch.pool,
        position: posView.position,
      });
      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) {
        onNotify('error', 'Close Position Failed', sim.errorMessage || 'Simulation failed.');
        return;
      }
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      onNotify(
        'success',
        'Closed Cetus LP Position',
        `Withdrew liquidity and fees from ${posView.poolName}.`,
        'Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
      await loadAll(true);
    } catch (err: any) {
      onNotify('error', 'Close Cancelled', err?.message || 'Transaction cancelled.');
    } finally {
      setBusyPosId(null);
    }
  };

  const handleSuilendSubmit = async () => {
    if (!account?.address) {
      onNotify('warning', 'Wallet Required', 'Connect your Sui wallet to continue.');
      return;
    }
    if (!activeReserve || parsedLendingAmount <= 0 || lendingValidationError) return;

    const safeAmount = floorToDecimals(parsedLendingAmount, activeReserve.decimals);
    if (safeAmount <= 0) return;

    setIsSubmitting(true);
    try {
      if (lendingOp === 'supply') {
        const tx = await buildSuilendDepositTx({
          sender: account.address,
          coinType: activeReserve.coinType,
          amountHuman: safeAmount,
          decimals: activeReserve.decimals,
          obligationOwnerCapId: suilendUser.obligationOwnerCapId,
        });
        const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
        if (!sim.ok) {
          onNotify('error', 'Suilend Deposit Failed', sim.errorMessage || 'Simulation failed.');
          return;
        }
        const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
        const digest = extractTxDigest(res);
        const notionalUsd = safeAmount * (activeReserve.priceUsd || 0);
        if (notionalUsd > 0) {
          const nextVol = addWalletVolumeUsd(account.address, notionalUsd);
          onVolumeUpdated?.(nextVol);
        }
        onNotify(
          'success',
          `Deposited ${activeReserve.symbol} to Suilend`,
          `Supplied ${fmtUnits(safeAmount)} ${activeReserve.symbol} at ${activeReserve.depositAprPct.toFixed(2)}% APR.`,
          'Suiscan',
          `https://suiscan.xyz/mainnet/tx/${digest}`
        );
        onTradeRecorded({
          fromToken: activeReserve.symbol,
          toToken: `sl${activeReserve.symbol}`,
          fromAmount: fmtUnits(safeAmount),
          toAmount: `${activeReserve.depositAprPct.toFixed(2)}% APR`,
          volumeUsd: notionalUsd,
          feeSavedUsd: 0,
          digest,
        });
      } else {
        if (!suilendUser.obligationOwnerCapId || !suilendUser.obligationId) {
          onNotify('warning', 'No Suilend Position', 'No active Suilend obligation found.');
          return;
        }
        const tx = await buildSuilendWithdrawTx({
          sender: account.address,
          obligationOwnerCapId: suilendUser.obligationOwnerCapId,
          obligationId: suilendUser.obligationId,
          coinType: activeReserve.coinType,
          amountHuman: safeAmount,
          decimals: activeReserve.decimals,
        });
        const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
        if (!sim.ok) {
          onNotify('error', 'Suilend Withdraw Failed', sim.errorMessage || 'Simulation failed.');
          return;
        }
        const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
        const digest = extractTxDigest(res);
        onNotify(
          'success',
          `Withdrew ${activeReserve.symbol} from Suilend`,
          `Returned ${fmtUnits(safeAmount)} ${activeReserve.symbol} to your wallet.`,
          'Suiscan',
          `https://suiscan.xyz/mainnet/tx/${digest}`
        );
      }
      setLendingAmountInput('');
      await loadAll(true);
    } catch (err: any) {
      onNotify('error', 'Transaction Cancelled', err?.message || 'Wallet rejected transaction.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Summary Header */}
      <div className="panel-carbon rounded-xl p-4 sm:p-5 border border-[#2D374B]">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#2B7FFF]/15 border border-[#2B7FFF]/40 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-[#60A5FA]" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  Native Sui Yield: Cetus CLMM &amp; Suilend
                </h1>
                <span className="px-2 py-0.5 rounded bg-[#2B7FFF]/15 border border-[#2B7FFF]/35 text-[10px] font-mono text-[#60A5FA]">
                  Official On-Chain SDKs
                </span>
              </div>
              <p className="text-xs text-[#8E98A8]">
                High-APY Cetus CLMM liquidity pools &amp; Suilend single-asset lending executed directly via official SDKs.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => loadAll(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0C0E13] border border-[#2D374B] hover:border-[#2B7FFF]/50 text-xs font-mono text-slate-300 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="panel-carbon-sub rounded-lg p-3 border border-[#232B3B]">
            <div className="text-[11px] font-mono text-[#7B8494]">Combined Pools TVL</div>
            <div className="text-base font-mono font-bold text-white mt-0.5 tabular-nums">
              {isLoading && totalTvlUsd === 0 ? '—' : fmtUsd(totalTvlUsd)}
            </div>
          </div>
          <div className="panel-carbon-sub rounded-lg p-3 border border-[#232B3B]">
            <div className="text-[11px] font-mono text-[#7B8494]">Top Cetus CLMM APY</div>
            <div className="text-base font-mono font-bold text-[#08D189] mt-0.5 tabular-nums">
              {topClmmApy > 0 ? `${topClmmApy.toFixed(2)}%` : '—'}
            </div>
          </div>
          <div className="panel-carbon-sub rounded-lg p-3 border border-[#232B3B]">
            <div className="text-[11px] font-mono text-[#7B8494]">Top Suilend APR</div>
            <div className="text-base font-mono font-bold text-[#08D189] mt-0.5 tabular-nums">
              {topSuilendApr > 0 ? `${topSuilendApr.toFixed(2)}%` : '—'}
            </div>
          </div>
          <div className="panel-carbon-sub rounded-lg p-3 border border-[#232B3B]">
            <div className="text-[11px] font-mono text-[#7B8494]">Active LP Positions</div>
            <div className="text-base font-mono font-bold text-[#60A5FA] mt-0.5 tabular-nums">
              {clmmPositions.length} CLMM
            </div>
          </div>
        </div>
      </div>

      {/* Section Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1 p-1 rounded-lg bg-[#090B10] border border-[#2D374B]">
          <button
            type="button"
            onClick={() => setSection('clmm')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
              section === 'clmm'
                ? 'bg-[#2B7FFF]/20 text-[#60A5FA] border border-[#2B7FFF]/45'
                : 'text-[#8E98A8] hover:text-white border border-transparent'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Cetus CLMM LP ({clmmPools.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setSection('suilend')}
            className={`px-3.5 py-1.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
              section === 'suilend'
                ? 'bg-[#2B7FFF]/20 text-[#60A5FA] border border-[#2B7FFF]/45'
                : 'text-[#8E98A8] hover:text-white border border-transparent'
            }`}
          >
            <Coins className="w-3.5 h-3.5" />
            <span>Suilend Lending ({reserves.length})</span>
          </button>
        </div>

        {section === 'suilend' && (
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-[#7B8494] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter Suilend reserve..."
              className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#090B10] border border-[#2D374B] text-xs font-mono text-white placeholder-[#5A6475] outline-none focus:border-[#2B7FFF]"
            />
          </div>
        )}
      </div>

      {/* Main Content */}
      {section === 'clmm' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left: Cetus CLMM Pools + Active Positions */}
          <div className="lg:col-span-7 space-y-4">
            <div className="panel-carbon rounded-xl border border-[#2D374B] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#232B3B] flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-bold text-white">Cetus CLMM Pools</h2>
                  <p className="text-[11px] text-[#8E98A8]">
                    Concentrated liquidity pools via @cetusprotocol/sui-clmm-sdk
                  </p>
                </div>
                <span className="text-[11px] font-mono text-[#60A5FA]">24h Fee + Rewards</span>
              </div>

              {isLoading && clmmPools.length === 0 ? (
                <div className="p-8 flex items-center justify-center gap-2 text-xs font-mono text-[#7B8494]">
                  <Loader2 className="w-4 h-4 animate-spin text-[#2B7FFF]" />
                  <span>Loading Cetus CLMM pools...</span>
                </div>
              ) : (
                <div className="divide-y divide-[#1E2533]">
                  {clmmPools.map((p) => {
                    const isSel = activePool?.poolId === p.poolId;
                    return (
                      <button
                        key={p.poolId}
                        type="button"
                        onClick={() => {
                          setSelectedPoolId(p.poolId);
                          setClmmQuote(null);
                        }}
                        className={`w-full text-left p-3.5 sm:p-4 transition-colors flex flex-wrap items-center justify-between gap-3 ${
                          isSel ? 'bg-[#2B7FFF]/10' : 'hover:bg-white/[0.02]'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-[170px]">
                          <div className="flex items-center -space-x-2">
                            <img
                              src={p.logoA}
                              alt={p.symbolA}
                              className="w-7 h-7 rounded-full border border-[#2D374B] bg-[#0C0E13]"
                            />
                            <img
                              src={p.logoB}
                              alt={p.symbolB}
                              className="w-7 h-7 rounded-full border border-[#2D374B] bg-[#0C0E13]"
                            />
                          </div>
                          <div>
                            <div className="text-sm font-bold text-white">{p.name}</div>
                            <div className="text-[11px] font-mono text-[#7B8494]">
                              1 {p.priceBaseCoin === 'coin_b' ? p.symbolB : p.symbolA} ≈{' '}
                              {p.currentPrice.toFixed(4)}{' '}
                              {p.priceBaseCoin === 'coin_b' ? p.symbolA : p.symbolB}
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4 flex-1 min-w-[210px]">
                          <div>
                            <div className="text-[10px] font-mono text-[#7B8494]">Total APY</div>
                            <div className="text-sm font-mono font-bold text-[#08D189] tabular-nums">
                              {p.totalApyPct.toFixed(2)}%
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] font-mono text-[#7B8494]">TVL</div>
                            <div className="text-sm font-mono font-semibold text-white tabular-nums">
                              {fmtUsd(p.tvlUsd)}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] font-mono text-[#7B8494]">24h Vol</div>
                            <div className="text-xs font-mono text-slate-300 tabular-nums">
                              {fmtUsd(p.volume24hUsd)}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* User Active CLMM Positions */}
            {clmmPositions.length > 0 && (
              <div className="panel-carbon rounded-xl border border-[#2D374B] overflow-hidden">
                <div className="px-4 py-3 border-b border-[#232B3B] flex items-center justify-between">
                  <h3 className="text-sm font-bold text-white">My Cetus LP Positions</h3>
                  <span className="text-[11px] font-mono text-[#60A5FA]">
                    {clmmPositions.length} Active
                  </span>
                </div>
                <div className="divide-y divide-[#1E2533]">
                  {clmmPositions.map((pv) => (
                    <div
                      key={pv.position.pos_object_id}
                      className="p-3.5 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">{pv.poolName}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                              pv.inRange
                                ? 'bg-[#08D189]/15 text-[#08D189]'
                                : 'bg-amber-500/15 text-amber-400'
                            }`}
                          >
                            {pv.inRange ? 'In Range' : 'Out of Range'}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-[#8E98A8] mt-0.5">
                          Unclaimed Fees: {fmtUnits(pv.feeOwedA, 4)} {pv.symbolA} +{' '}
                          {fmtUnits(pv.feeOwedB, 4)} {pv.symbolB}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={busyPosId === pv.position.pos_object_id}
                          onClick={() => handleCollectFees(pv)}
                          className="px-2.5 py-1.5 rounded-lg bg-[#0C0E13] border border-[#2D374B] hover:border-[#2B7FFF]/50 text-xs font-semibold text-white disabled:opacity-45"
                        >
                          Claim Fees
                        </button>
                        <button
                          type="button"
                          disabled={busyPosId === pv.position.pos_object_id}
                          onClick={() => handleCloseClmmPosition(pv)}
                          className="px-2.5 py-1.5 rounded-lg bg-[#F0525E]/15 border border-[#F0525E]/40 hover:bg-[#F0525E]/25 text-xs font-semibold text-[#F0525E] disabled:opacity-45"
                        >
                          Close LP
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Cetus CLMM Add Liquidity Panel */}
          <div className="lg:col-span-5 lg:sticky lg:top-20">
            <div className="panel-carbon rounded-xl p-4 border border-[#2D374B] space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[#60A5FA]">
                    Cetus CLMM Liquidity
                  </div>
                  <h3 className="text-base font-bold text-white">
                    {activePool?.name || 'Select Pool'}
                  </h3>
                </div>
                {activePool && (
                  <span className="text-xs font-mono font-bold text-[#08D189]">
                    {activePool.totalApyPct.toFixed(2)}% APY
                  </span>
                )}
              </div>

              {/* Range Presets */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-mono text-[#8E98A8]">Price Range</div>
                <div className="grid grid-cols-4 gap-1.5">
                  {(
                    [
                      { id: 'tight', label: '±10%' },
                      { id: 'balanced', label: '±25%' },
                      { id: 'wide', label: '±50%' },
                      { id: 'full', label: 'Full' },
                    ] as { id: RangePreset; label: string }[]
                  ).map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setRangeMode(r.id)}
                      className={`py-1.5 rounded-lg text-xs font-mono font-semibold border transition-colors ${
                        rangeMode === r.id
                          ? 'bg-[#2B7FFF]/20 border-[#2B7FFF]/60 text-[#60A5FA]'
                          : 'bg-[#0C0E13] border-[#2D374B] text-slate-300 hover:text-white'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Anchor Coin + Amount */}
              <div className="panel-carbon-sub rounded-xl p-3 border border-[#232B3B] space-y-2">
                <div className="flex items-center justify-between text-[11px] font-mono text-[#8E98A8]">
                  <span>Deposit Amount ({fixedCoin === 'a' ? activePool?.symbolA : activePool?.symbolB})</span>
                  <div className="inline-flex rounded bg-[#0C0E13] border border-[#2D374B] p-0.5">
                    {(['a', 'b'] as const).map((side) => (
                      <button
                        key={side}
                        type="button"
                        onClick={() => setFixedCoin(side)}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          fixedCoin === side ? 'bg-[#2B7FFF]/25 text-[#60A5FA]' : 'text-[#7B8494]'
                        }`}
                      >
                        {side === 'a' ? activePool?.symbolA : activePool?.symbolB}
                      </button>
                    ))}
                  </div>
                </div>

                <input
                  type="text"
                  inputMode="decimal"
                  value={clmmAmountInput}
                  onChange={(e) => {
                    const clean = e.target.value.replace(',', '.').replace(/[^0-9.]/g, '');
                    const parts = clean.split('.');
                    setClmmAmountInput(
                      parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : clean
                    );
                  }}
                  placeholder="0.00"
                  className="w-full bg-transparent text-2xl font-mono font-bold text-white outline-none"
                />

                <div className="grid grid-cols-4 gap-1.5">
                  {[0.25, 0.5, 0.75, 1].map((pct) => {
                    const avail = fixedCoin === 'a' ? clmmWalletBalA : clmmWalletBalB;
                    const dec =
                      fixedCoin === 'a' ? (activePool?.decimalsA ?? 6) : (activePool?.decimalsB ?? 9);
                    return (
                      <button
                        key={pct}
                        type="button"
                        disabled={!activePool || avail <= 0}
                        onClick={() => {
                          const factor = Math.pow(10, Math.min(dec, 6));
                          const val = Math.floor(avail * pct * factor) / factor;
                          setClmmAmountInput(val > 0 ? String(val) : '');
                        }}
                        className="py-1 rounded bg-[#0C0E13] border border-[#2D374B] hover:border-[#2B7FFF]/50 text-[11px] font-mono text-slate-300 disabled:opacity-40"
                      >
                        {pct === 1 ? 'MAX' : `${pct * 100}%`}
                      </button>
                    );
                  })}
                </div>

                <div className="flex justify-between text-[11px] font-mono text-[#7B8494]">
                  <span>
                    {activePool?.symbolA}: {fmtUnits(clmmWalletBalA, 4)}
                  </span>
                  <span>
                    {activePool?.symbolB}: {fmtUnits(clmmWalletBalB, 4)}
                  </span>
                </div>
              </div>

              {account?.address &&
                activePool &&
                (clmmWalletBalA <= 0 || clmmWalletBalB <= 0) && (
                  <div className="rounded-lg bg-[#2B7FFF]/10 border border-[#2B7FFF]/30 px-3 py-2 text-[11px] text-[#93C5FD]">
                    CLMM in-range liquidity requires both {activePool.symbolA} and {activePool.symbolB}. Swap into the missing token in the Swap tab or select a pair you hold both sides of (e.g. USDC / SUI).
                  </div>
                )}

              {/* Required Pair Quote */}
              <div className="bg-[#0C0E13] rounded-lg p-3 border border-[#232B3B] space-y-1.5 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-[#7B8494]">Required {activePool?.symbolA}</span>
                  <span className="text-white">
                    {isQuotingClmm
                      ? 'Calculating...'
                      : clmmQuote
                        ? `${fmtUnits(clmmQuote.amountAHuman, 4)} ${activePool?.symbolA}`
                        : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#7B8494]">Required {activePool?.symbolB}</span>
                  <span className="text-white">
                    {isQuotingClmm
                      ? 'Calculating...'
                      : clmmQuote
                        ? `${fmtUnits(clmmQuote.amountBHuman, 4)} ${activePool?.symbolB}`
                        : '—'}
                  </span>
                </div>
              </div>

              {clmmValidationError && (
                <div className="rounded-lg bg-[#F0525E]/10 border border-[#F0525E]/35 px-3 py-2 text-[11px] text-[#F0525E]">
                  {clmmValidationError}
                </div>
              )}

              <button
                type="button"
                disabled={
                  isSubmitting ||
                  isQuotingClmm ||
                  (Boolean(account) && (!clmmQuote || Boolean(clmmValidationError)))
                }
                onClick={handleAddClmmLiquidity}
                className="w-full py-2.5 rounded-xl btn-deepbook font-bold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-45 disabled:cursor-not-allowed"
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>{!account ? 'Connect Sui Wallet' : 'Open CLMM LP Position'}</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* SUILEND LENDING SECTION */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          <div className="lg:col-span-8 panel-carbon rounded-xl border border-[#2D374B] overflow-hidden">
            <div className="px-4 py-3 border-b border-[#232B3B] flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-white">Suilend Lending Reserves</h2>
                <p className="text-[11px] text-[#8E98A8]">
                  Single-asset lending via official @suilend/sdk (no impermanent loss)
                </p>
              </div>
              <span className="text-[11px] font-mono text-[#60A5FA]">
                {filteredReserves.length} Markets
              </span>
            </div>

            {isLoading && reserves.length === 0 ? (
              <div className="p-8 flex items-center justify-center gap-2 text-xs font-mono text-[#7B8494]">
                <Loader2 className="w-4 h-4 animate-spin text-[#2B7FFF]" />
                <span>Loading Suilend reserves...</span>
              </div>
            ) : (
              <div className="divide-y divide-[#1E2533]">
                {filteredReserves.map((r) => {
                  const supplied = suilendUser.depositsByCoinType[r.coinType] ?? 0;
                  const isSel = activeReserve?.coinType === r.coinType;
                  return (
                    <div
                      key={r.coinType}
                      className={`p-3.5 sm:p-4 transition-colors flex flex-wrap items-center justify-between gap-3 ${
                        isSel ? 'bg-[#2B7FFF]/8' : 'hover:bg-white/[0.02]'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-[160px]">
                        <img
                          src={r.logo}
                          alt={r.symbol}
                          className="w-8 h-8 rounded-full bg-[#0C0E13] border border-[#2D374B] object-cover"
                        />
                        <div>
                          <div className="text-sm font-bold text-white">{r.symbol}</div>
                          <div className="text-[11px] text-[#7B8494]">{r.name}</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-4 flex-1 min-w-[230px]">
                        <div>
                          <div className="text-[10px] font-mono text-[#7B8494]">Supply APR</div>
                          <div className="text-sm font-mono font-bold text-[#08D189] tabular-nums">
                            {r.depositAprPct.toFixed(2)}%
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-mono text-[#7B8494]">TVL</div>
                          <div className="text-sm font-mono font-semibold text-white tabular-nums">
                            {fmtUsd(r.tvlUsd)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] font-mono text-[#7B8494]">Utilization</div>
                          <div className="text-xs font-mono text-slate-300 tabular-nums">
                            {r.utilizationPct.toFixed(1)}%
                          </div>
                        </div>
                        <div className="hidden sm:block">
                          <div className="text-[10px] font-mono text-[#7B8494]">My Supplied</div>
                          <div className="text-sm font-mono font-bold text-[#60A5FA] tabular-nums">
                            {supplied > 0 ? `${fmtUnits(supplied, 4)} ${r.symbol}` : '0'}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedReserveCoin(r.coinType);
                            setLendingOp('supply');
                            setLendingAmountInput('');
                          }}
                          className="px-3 py-1.5 rounded-lg btn-deepbook text-xs font-bold inline-flex items-center gap-1"
                        >
                          <ArrowDownToLine className="w-3 h-3" />
                          <span>Supply</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedReserveCoin(r.coinType);
                            setLendingOp('withdraw');
                            setLendingAmountInput('');
                          }}
                          className="px-2.5 py-1.5 rounded-lg bg-[#0C0E13] border border-[#2D374B] hover:border-[#2B7FFF]/50 text-xs font-semibold text-slate-200 inline-flex items-center gap-1"
                        >
                          <ArrowUpFromLine className="w-3 h-3" />
                          <span>Withdraw</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right: Suilend Deposit/Withdraw Panel */}
          <div className="lg:col-span-4 lg:sticky lg:top-20">
            <div className="panel-carbon rounded-xl p-4 border border-[#2D374B] space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[#60A5FA]">
                    Suilend Reserve
                  </div>
                  <h3 className="text-base font-bold text-white">
                    {lendingOp === 'supply' ? 'Supply' : 'Withdraw'} {activeReserve?.symbol ?? ''}
                  </h3>
                </div>
                <div className="inline-flex rounded-lg bg-[#0C0E13] border border-[#2D374B] p-0.5">
                  {(['supply', 'withdraw'] as const).map((op) => (
                    <button
                      key={op}
                      type="button"
                      onClick={() => {
                        setLendingOp(op);
                        setLendingAmountInput('');
                      }}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold capitalize ${
                        lendingOp === op ? 'bg-[#2B7FFF]/20 text-[#60A5FA]' : 'text-[#7B8494]'
                      }`}
                    >
                      {op}
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel-carbon-sub rounded-xl p-3 border border-[#232B3B] space-y-2">
                <div className="flex items-center justify-between text-[11px] font-mono text-[#8E98A8]">
                  <span>{lendingOp === 'withdraw' ? 'My Supplied' : 'Wallet Available'}</span>
                  <span className="text-white font-semibold tabular-nums">
                    {fmtUnits(lendingAvailableBal, 4)} {activeReserve?.symbol ?? ''}
                  </span>
                </div>

                <input
                  type="text"
                  inputMode="decimal"
                  value={lendingAmountInput}
                  onChange={(e) => {
                    const clean = e.target.value.replace(',', '.').replace(/[^0-9.]/g, '');
                    const parts = clean.split('.');
                    setLendingAmountInput(
                      parts.length > 2 ? `${parts[0]}.${parts.slice(1).join('')}` : clean
                    );
                  }}
                  placeholder="0.00"
                  className="w-full bg-transparent text-2xl font-mono font-bold text-white outline-none"
                />

                <div className="grid grid-cols-4 gap-1.5 pt-1">
                  {[0.25, 0.5, 0.75, 1].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => {
                        if (!activeReserve) return;
                        const floored = floorToDecimals(
                          lendingAvailableBal * pct,
                          activeReserve.decimals
                        );
                        setLendingAmountInput(floored > 0 ? String(floored) : '0');
                      }}
                      className="py-1 rounded bg-[#0C0E13] border border-[#2D374B] hover:border-[#2B7FFF]/60 text-[11px] font-mono text-slate-300 hover:text-white"
                    >
                      {pct === 1 ? 'MAX' : `${pct * 100}%`}
                    </button>
                  ))}
                </div>
              </div>

              {activeReserve && (
                <div className="bg-[#0C0E13] rounded-lg p-3 border border-[#232B3B] space-y-1.5 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className="text-[#7B8494]">Supply APR</span>
                    <span className="text-[#08D189] font-bold">
                      {activeReserve.depositAprPct.toFixed(2)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#7B8494]">Reserve Free Liquidity</span>
                    <span className="text-white">
                      {fmtUnits(activeReserve.availableLiquidity, 2)} {activeReserve.symbol}
                    </span>
                  </div>
                </div>
              )}

              {lendingValidationError && (
                <div className="rounded-lg bg-[#F0525E]/10 border border-[#F0525E]/35 px-3 py-2 text-[11px] text-[#F0525E]">
                  {lendingValidationError}
                </div>
              )}

              <button
                type="button"
                disabled={
                  isSubmitting ||
                  (Boolean(account) && (parsedLendingAmount <= 0 || Boolean(lendingValidationError)))
                }
                onClick={handleSuilendSubmit}
                className="w-full py-2.5 rounded-xl btn-deepbook font-bold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-45 disabled:cursor-not-allowed"
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>
                  {!account
                    ? 'Connect Sui Wallet'
                    : `${lendingOp === 'supply' ? 'Supply' : 'Withdraw'} ${
                        activeReserve?.symbol ?? ''
                      }`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
