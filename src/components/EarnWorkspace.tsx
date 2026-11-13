import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { ExternalLink, Loader2, RefreshCw, Search, ShieldCheck, Zap } from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import {
  buildEarnZapTx,
  fetchSuiYieldOpportunities,
  SUI_LST_OPTIONS,
  USDC_COIN_TYPE,
  type EarnCategory,
  type LstOption,
  type SuiYieldOpportunity,
} from '../earnPools';
import { extractTxDigest, fetchWalletBalances, readBalanceFromMap, SUI_COIN_TYPE } from '../suiClient';
import { simulateTxBeforeWallet } from '../suiSimulate';
import {
  addWalletVolumeUsd,
  getWalletVolumeUsd,
  resolveReferralTier,
  resolveTraderTier,
} from '../voltFee';
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

export const EarnWorkspace: React.FC<EarnWorkspaceProps> = ({
  onNotify,
  onTradeRecorded,
  onVolumeUpdated,
}) => {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();

  const [pools, setPools] = useState<SuiYieldOpportunity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [category, setCategory] = useState<EarnCategory>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'tvl' | 'apy'>('tvl');

  // 1-Click Staking / Yield Zap State
  const [payAsset, setPayAsset] = useState<'SUI' | 'USDC'>('SUI');
  const [targetLst, setTargetLst] = useState<LstOption>(SUI_LST_OPTIONS[0]);
  const [zapAmt, setZapAmt] = useState<string>('1');
  const [isZapping, setIsZapping] = useState(false);
  const [balances, setBalances] = useState<Record<string, bigint>>({});

  const volUsd = useMemo(() => getWalletVolumeUsd(account?.address), [account?.address]);
  const traderTier = useMemo(() => resolveTraderTier(volUsd), [volUsd]);
  const refTier = useMemo(() => resolveReferralTier(volUsd), [volUsd]);

  const loadPools = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await fetchSuiYieldOpportunities();
      setPools(list);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPools();
  }, [loadPools]);

  useEffect(() => {
    if (!account?.address) {
      setBalances({});
      return;
    }
    fetchWalletBalances(account.address).then(setBalances).catch(() => {});
  }, [account?.address]);

  const payCoinType = payAsset === 'SUI' ? SUI_COIN_TYPE : USDC_COIN_TYPE;
  const payDecimals = payAsset === 'SUI' ? 9 : 6;
  const payBalance = account?.address
    ? readBalanceFromMap(balances, payCoinType, payDecimals)
    : 0;

  const filteredPools = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = pools.filter((p) => {
      if (category !== 'all' && p.category !== category) return false;
      if (q && !p.symbol.toLowerCase().includes(q) && !p.protocol.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
    return [...list].sort((a, b) => (sortBy === 'apy' ? b.apyTotal - a.apyTotal : b.tvlUsd - a.tvlUsd));
  }, [pools, category, search, sortBy]);

  const metrics = useMemo(() => {
    const totalTvl = pools.reduce((acc, p) => acc + p.tvlUsd, 0);
    const lendTop = pools.filter((p) => p.category === 'lending').reduce((m, p) => Math.max(m, p.apyTotal), 0);
    const lstTop = pools.filter((p) => p.category === 'lst').reduce((m, p) => Math.max(m, p.apyTotal), 0);
    const uniqueProtocols = new Set(pools.map((p) => p.protocol)).size;
    return { totalTvl, lendTop, lstTop, uniqueProtocols };
  }, [pools]);

  const executeLstZap = async () => {
    if (!account?.address) {
      onNotify('info', 'Wallet Required', 'Connect your Sui wallet to acquire yield-bearing assets.');
      return;
    }
    const amt = Number(zapAmt);
    if (!Number.isFinite(amt) || amt <= 0) return;
    const atomic = BigInt(Math.floor(amt * Math.pow(10, payDecimals)));

    setIsZapping(true);
    try {
      const { tx, expectedOutAtomic } = await buildEarnZapTx({
        sender: account.address,
        inputCoinType: payCoinType,
        targetCoinType: targetLst.coinType,
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
      const outHuman = (Number(expectedOutAtomic) / Math.pow(10, targetLst.decimals)).toFixed(4);
      const estUsd = payAsset === 'USDC' ? amt : amt * 0.82;
      const nextVol = addWalletVolumeUsd(account.address, estUsd);
      onVolumeUpdated?.(nextVol);

      onNotify(
        'success',
        `Acquired ${outHuman} ${targetLst.symbol}`,
        `Staked yield-bearing ${targetLst.symbol} via single PTB.`,
        'Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
      onTradeRecorded({
        fromToken: payAsset,
        toToken: targetLst.symbol,
        fromAmount: zapAmt,
        toAmount: outHuman,
        volumeUsd: estUsd,
        digest,
        orderType: 'SWAP',
      });
      fetchWalletBalances(account.address).then(setBalances).catch(() => {});
    } catch (err: any) {
      onNotify('error', 'Yield Zap Failed', err?.message || 'Transaction rejected.');
    } finally {
      setIsZapping(false);
    }
  };

  return (
    <div className="w-full space-y-4">
      {/* Summary Metrics Row (Computed strictly from live DefiLlama + Cetus data) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="panel-carbon rounded-lg p-3.5">
          <div className="text-[11px] text-slate-400">Tracked Sui Pool TVL</div>
          <div className="text-lg font-mono tabular-nums font-semibold text-white mt-1">
            ${(metrics.totalTvl / 1e6).toFixed(1)}M
          </div>
        </div>
        <div className="panel-carbon rounded-lg p-3.5">
          <div className="text-[11px] text-slate-400">Top Lending APY</div>
          <div className="text-lg font-mono tabular-nums font-semibold text-emerald-400 mt-1">
            {metrics.lendTop > 0 ? `${metrics.lendTop.toFixed(2)}%` : '—'}
          </div>
        </div>
        <div className="panel-carbon rounded-lg p-3.5">
          <div className="text-[11px] text-slate-400">Top LST Yield</div>
          <div className="text-lg font-mono tabular-nums font-semibold text-[#38BDF8] mt-1">
            {metrics.lstTop > 0 ? `${metrics.lstTop.toFixed(2)}%` : '—'}
          </div>
        </div>
        <div className="panel-carbon rounded-lg p-3.5">
          <div className="text-[11px] text-slate-400">Live Sui Protocols</div>
          <div className="text-lg font-mono tabular-nums font-semibold text-white mt-1">
            {metrics.uniqueProtocols || '—'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left/Main: Current Finance / Bluefin Pools Style Institutional Table */}
        <div className="lg:col-span-8 panel-carbon rounded-xl overflow-hidden">
          <div className="p-3 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {(
                [
                  { id: 'all', label: 'All Pools' },
                  { id: 'lending', label: 'Lending' },
                  { id: 'lst', label: 'Liquid Staking' },
                  { id: 'lp', label: 'DEX Pools' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setCategory(tab.id)}
                  className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    category === tab.id
                      ? 'bg-[#38BDF8]/15 text-[#38BDF8] border border-[#38BDF8]/30'
                      : 'text-slate-400 hover:text-white border border-transparent'
                  }`}
                >
                  {tab.label}
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
                  placeholder="Filter asset..."
                  className="pl-8 pr-3 py-1.5 rounded-md bg-[#0C0E12] border border-white/[0.08] text-xs text-white outline-none focus:border-[#38BDF8] w-36 sm:w-44"
                />
              </div>
              <button
                type="button"
                onClick={loadPools}
                className="p-1.5 rounded-md bg-[#0C0E12] border border-white/[0.08] text-slate-400 hover:text-white"
                title="Refresh live yields"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-white/[0.06] bg-[#0C0E12]/60">
                  <th className="text-left px-3.5 py-2.5 font-medium">Asset / Pool</th>
                  <th className="text-left px-3 py-2.5 font-medium">Protocol</th>
                  <th className="text-right px-3 py-2.5 font-medium">
                    <button
                      type="button"
                      onClick={() => setSortBy('tvl')}
                      className={sortBy === 'tvl' ? 'text-[#38BDF8]' : 'hover:text-white'}
                    >
                      TVL
                    </button>
                  </th>
                  <th className="text-right px-3 py-2.5 font-medium hidden sm:table-cell">Base APY</th>
                  <th className="text-right px-3 py-2.5 font-medium">
                    <button
                      type="button"
                      onClick={() => setSortBy('apy')}
                      className={sortBy === 'apy' ? 'text-[#38BDF8]' : 'hover:text-white'}
                    >
                      Total APY
                    </button>
                  </th>
                  <th className="text-right px-3.5 py-2.5 font-medium">Access</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums divide-y divide-white/[0.04]">
                {filteredPools.slice(0, 22).map((pool) => (
                  <tr key={pool.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-3.5 py-2.5 font-sans">
                      <div className="font-semibold text-white">{pool.symbol}</div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">
                        {pool.category}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-sans text-slate-300">{pool.protocol}</td>
                    <td className="px-3 py-2.5 text-right text-slate-200">
                      ${pool.tvlUsd >= 1e6 ? `${(pool.tvlUsd / 1e6).toFixed(2)}M` : `${(pool.tvlUsd / 1e3).toFixed(0)}K`}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-400 hidden sm:table-cell">
                      {pool.apyBase.toFixed(2)}%
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-emerald-400">
                      {pool.apyTotal.toFixed(2)}%
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-sans">
                      <a
                        href={pool.externalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-white/[0.05] hover:bg-[#38BDF8]/15 hover:text-[#38BDF8] text-slate-200 transition-colors"
                      >
                        <span>Open</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: 1-Click Liquid Staking / Yield Asset Zap */}
        <div className="lg:col-span-4 panel-carbon rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#38BDF8]" />
              <span className="text-sm font-semibold text-white">1-Click Yield Zap</span>
            </div>
            <span className="text-[10px] font-mono text-slate-400">Cetus PTB</span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Instantly acquire yield-bearing Sui liquid staking or savings tokens directly into your
            wallet in one atomic transaction.
          </p>

          {/* Select Yield Asset */}
          <div className="grid grid-cols-2 gap-1.5">
            {SUI_LST_OPTIONS.map((opt) => (
              <button
                key={opt.symbol}
                type="button"
                onClick={() => setTargetLst(opt)}
                className={`p-2 rounded-lg border text-left transition-colors ${
                  targetLst.symbol === opt.symbol
                    ? 'bg-[#38BDF8]/12 border-[#38BDF8]/40 text-white'
                    : 'bg-[#0C0E12] border-white/[0.06] text-slate-300 hover:border-white/[0.15]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <img src={opt.logo} alt={opt.symbol} className="w-5 h-5 rounded-full" />
                  <span className="text-xs font-semibold">{opt.symbol}</span>
                </div>
                <div className="text-[10px] text-slate-400 mt-1 truncate">{opt.protocol}</div>
              </button>
            ))}
          </div>

          {/* Input Amount */}
          <div className="panel-carbon-sub rounded-lg p-3 space-y-1.5">
            <div className="flex justify-between text-[11px] text-slate-400">
              <div className="flex items-center gap-1.5">
                {(['SUI', 'USDC'] as const).map((sym) => (
                  <button
                    key={sym}
                    type="button"
                    onClick={() => setPayAsset(sym)}
                    className={`px-2 py-0.5 rounded font-mono ${
                      payAsset === sym ? 'bg-white/[0.1] text-white' : 'text-slate-500 hover:text-white'
                    }`}
                  >
                    {sym}
                  </button>
                ))}
              </div>
              <span className="font-mono tabular-nums">Bal: {payBalance.toFixed(3)}</span>
            </div>
            <input
              type="number"
              min="0"
              step="any"
              value={zapAmt}
              onChange={(e) => setZapAmt(e.target.value)}
              className="w-full bg-transparent text-xl font-mono text-white outline-none"
            />
          </div>

          <div className="text-[11px] font-mono text-slate-400 flex items-center justify-between">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              Non-custodial wallet custody
            </span>
            <span className="text-[#38BDF8]">Fee {(traderTier.feeRate * 100).toFixed(2)}%</span>
          </div>

          <button
            type="button"
            disabled={isZapping}
            onClick={executeLstZap}
            className="w-full py-2.5 rounded-lg bg-[#38BDF8] hover:bg-[#56CCF9] disabled:opacity-50 text-[#090B0E] font-semibold text-xs flex items-center justify-center gap-2"
          >
            {isZapping && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            <span>Acquire {targetLst.symbol}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
