import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Award,
  Check,
  Copy,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { TRADER_TIERS } from '../constants';
import {
  fetchProtocolLeaderboard,
  useSyncedWalletVolume,
  type ProtocolLeaderboardData,
} from '../onChainVolume';
import {
  getValidReferrerForSender,
  REFERRAL_TIERS,
  resolveReferralTier,
  resolveTraderTier,
} from '../voltFee';

interface TiersReferralsWorkspaceProps {
  externalVolumeUsd?: number;
}

type TiersSubTab = 'traders' | 'referrers';

export const TiersReferralsWorkspace: React.FC<TiersReferralsWorkspaceProps> = ({
  externalVolumeUsd,
}) => {
  const account = useCurrentAccount();
  const [subTab, setSubTab] = useState<TiersSubTab>('traders');
  const [copied, setCopied] = useState(false);
  const [leaderboardData, setLeaderboardData] = useState<ProtocolLeaderboardData | null>(null);
  const [isLoadingBoard, setIsLoadingBoard] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingBoard(true);
    fetchProtocolLeaderboard(false)
      .then((data) => {
        if (!cancelled) setLeaderboardData(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoadingBoard(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const {
    volumeUsd: syncedVolumeUsd,
    summary,
    isSyncing,
    refresh: refreshOnChainVolume,
  } = useSyncedWalletVolume(account?.address);

  const volumeUsd = useMemo(
    () => Math.max(syncedVolumeUsd, externalVolumeUsd ?? 0),
    [syncedVolumeUsd, externalVolumeUsd]
  );
  const activeReferrer = useMemo(
    () => getValidReferrerForSender(account?.address),
    [account?.address]
  );
  const traderTier = useMemo(
    () => resolveTraderTier(volumeUsd, Boolean(activeReferrer)),
    [volumeUsd, activeReferrer]
  );
  const refTier = useMemo(() => resolveReferralTier(volumeUsd), [volumeUsd]);

  const originUrl =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://voltswap.org';
  const refUrl = account?.address
    ? `${originUrl}/?ref=${account.address}`
    : `${originUrl}/?ref=<YOUR_SUI_ADDRESS>`;

  const copyRefLink = () => {
    if (!account?.address) return;
    navigator.clipboard.writeText(refUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const progressPct = useMemo(() => {
    if (!traderTier.nextTierVolumeUsd) return 100;
    const span = traderTier.nextTierVolumeUsd - traderTier.minVolumeUsd;
    if (span <= 0) return 100;
    return Math.min(100, Math.max(0, ((volumeUsd - traderTier.minVolumeUsd) / span) * 100));
  }, [traderTier, volumeUsd]);

  return (
    <div className="max-w-6xl mx-auto w-full space-y-6 py-2">
      {/* Header + 2-Tab Sub-Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            {subTab === 'traders' ? 'Trader Fee Tiers' : 'Affiliate Revenue Share'}
          </h1>
          <p className="text-sm text-slate-300 mt-0.5">
            {subTab === 'traders'
              ? 'Volume-based fee rebates down to 0.03% across Market Swap, DeepBook Limit, Margin, Perps & Predict.'
              : 'Instant non-custodial PTB rev-share paid directly to your wallet on every referred trade.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {account?.address && (
            <button
              type="button"
              disabled={isSyncing}
              onClick={() => refreshOnChainVolume(true)}
              className="px-3.5 py-2.5 rounded-xl bg-[#06070A] border border-[#323D52] hover:border-[#2B7FFF]/50 text-xs font-mono text-slate-200 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
              title="Re-scan Sui Mainnet GraphQL & Aftermath trade history"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#60A5FA] ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing Chain...' : 'Sync On-Chain'}</span>
            </button>
          )}
          <div className="inline-flex items-center p-1 rounded-xl bg-[#06070A] border border-[#323D52] gap-1">
            <button
              type="button"
              onClick={() => setSubTab('traders')}
              className={`px-4 py-2 rounded-lg text-sm font-bold inline-flex items-center gap-2 transition-all ${
                subTab === 'traders'
                  ? 'btn-deepbook shadow-[0_0_16px_rgba(43,127,255,0.28)]'
                  : 'text-[#8E98A8] hover:text-white'
              }`}
            >
              <Award className="w-4 h-4" />
              <span>For Traders</span>
            </button>
            <button
              type="button"
              onClick={() => setSubTab('referrers')}
              className={`px-4 py-2 rounded-lg text-sm font-bold inline-flex items-center gap-2 transition-all ${
                subTab === 'referrers'
                  ? 'btn-deepbook shadow-[0_0_16px_rgba(43,127,255,0.28)]'
                  : 'text-[#8E98A8] hover:text-white'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>For Affiliates</span>
            </button>
          </div>
        </div>
      </div>

      {/* SUB-TAB 1: FOR TRADERS */}
      {subTab === 'traders' && (
        <div className="space-y-5">
          {/* Active Tier Hero Progress Card */}
          <div className="panel-carbon rounded-2xl p-5 sm:p-6 space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
              <div className="lg:col-span-5 flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-[#000000] border border-[#2B7FFF]/40 flex items-center justify-center text-3xl shadow-[0_0_24px_rgba(43,127,255,0.16)]">
                  {traderTier.badgeEmoji}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono uppercase tracking-wider text-[#60A5FA]">
                      Active Trader Tier
                    </span>
                    {account?.address && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#08D189]/15 border border-[#08D189]/35 text-[#08D189]">
                        {isSyncing ? 'Syncing…' : 'On-Chain Synced'}
                      </span>
                    )}
                  </div>
                  <div className="text-xl font-bold text-white mt-0.5">{traderTier.name}</div>
                  <div className="text-sm text-slate-300 font-mono tabular-nums mt-0.5">
                    Verified Volume:{' '}
                    <span className="text-white font-semibold">
                      ${volumeUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-5 space-y-2">
                <div className="flex justify-between text-sm font-mono text-slate-300">
                  <span>Progress to Next Tier</span>
                  <span className="text-white font-semibold">
                    {traderTier.nextTierVolumeUsd
                      ? `$${volumeUsd.toFixed(0)} / $${traderTier.nextTierVolumeUsd.toLocaleString()}`
                      : 'Maximum Tier Reached'}
                  </span>
                </div>
                <div className="w-full h-2.5 rounded-full bg-[#121620] overflow-hidden border border-[#323D52]">
                  <div
                    className="h-full bg-gradient-to-r from-[#2B7FFF] to-[#08D189] volt-shimmer transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                {activeReferrer && (
                  <div className="text-xs font-mono text-[#08D189] inline-flex items-center gap-1.5 pt-1">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>
                      Invited by {activeReferrer.slice(0, 8)}...{activeReferrer.slice(-6)} · -20%
                      Plankton fee rebate active automatically
                    </span>
                  </div>
                )}
              </div>

              <div className="lg:col-span-2 panel-carbon-sub rounded-xl p-3.5 text-center border border-[#2B7FFF]/35">
                <div className="text-xs text-[#8E98A8]">Your Protocol Fee</div>
                <div className="text-2xl font-mono font-bold text-[#60A5FA] mt-0.5">
                  {(traderTier.feeRate * 100).toFixed(2)}%
                </div>
                <div className="text-xs text-[#08D189] font-mono">
                  {traderTier.discountPct > 0 ? `-${traderTier.discountPct}% Rebate` : 'Base Rate'}
                </div>
              </div>
            </div>

            {account?.address && (
              <div className="pt-4 border-t border-[#2D374B] grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs font-mono">
                <div className="rounded-xl bg-[#000000] border border-[#2D374B] px-3 py-2">
                  <div className="text-[10px] text-slate-400 font-sans">Market Swaps</div>
                  <div className="text-white font-semibold tabular-nums mt-0.5">
                    ${(summary?.spotSwapVolumeUsd ?? 0).toFixed(2)}
                  </div>
                </div>
                <div className="rounded-xl bg-[#000000] border border-[#2D374B] px-3 py-2">
                  <div className="text-[10px] text-slate-400 font-sans">Spot CLOB</div>
                  <div className="text-[#60A5FA] font-semibold tabular-nums mt-0.5">
                    ${(summary?.clobVolumeUsd ?? 0).toFixed(2)}
                  </div>
                </div>
                <div className="rounded-xl bg-[#000000] border border-[#2D374B] px-3 py-2">
                  <div className="text-[10px] text-slate-400 font-sans">Margin 4.5x</div>
                  <div className="text-[#60A5FA] font-semibold tabular-nums mt-0.5">
                    ${(summary?.marginVolumeUsd ?? 0).toFixed(2)}
                  </div>
                </div>
                <div className="rounded-xl bg-[#000000] border border-[#2D374B] px-3 py-2">
                  <div className="text-[10px] text-slate-400 font-sans">Aftermath Perps</div>
                  <div className="text-white font-semibold tabular-nums mt-0.5">
                    ${(summary?.perpsVolumeUsd ?? 0).toFixed(2)}
                  </div>
                </div>
                <div className="rounded-xl bg-[#000000] border border-[#2D374B] px-3 py-2 col-span-2 sm:col-span-1">
                  <div className="text-[10px] text-slate-400 font-sans">Predict &amp; Earn</div>
                  <div className="text-[#08D189] font-semibold tabular-nums mt-0.5">
                    ${((summary?.predictVolumeUsd ?? 0) + (summary?.earnVolumeUsd ?? 0)).toFixed(2)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 6 Dynamic Trader Fee Tiers */}
          <div className="panel-carbon rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#323D52] flex flex-wrap items-center justify-between gap-2 bg-[#06070A]">
              <span className="text-base font-bold text-white flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-[#60A5FA]" />
                Volume Discount Schedule
              </span>
              <span className="text-xs text-[#8E98A8] font-mono">
                Applies across Market Swap · DeepBook Limit · Margin · Perps · Predict · Earn
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4 bg-[#000000]">
              {TRADER_TIERS.map((tier) => {
                const isActive = tier.id === traderTier.id;
                return (
                  <div
                    key={tier.id}
                    className={`rounded-xl p-4 space-y-2.5 border transition-all ${
                      isActive
                        ? 'bg-[#2B7FFF]/12 border-[#2B7FFF]/60 shadow-[0_0_24px_rgba(43,127,255,0.14)]'
                        : 'panel-carbon-interactive'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="text-2xl">{tier.badgeEmoji}</span>
                        <div>
                          <div className="text-sm font-bold text-white">{tier.name}</div>
                          <div className="text-xs font-mono text-[#8E98A8]">
                            {tier.minVolumeUsd === 0
                              ? 'Entry Tier'
                              : `$${tier.minVolumeUsd.toLocaleString()}+ Vol`}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`text-base font-mono font-bold ${
                          isActive ? 'text-[#60A5FA]' : 'text-white'
                        }`}
                      >
                        {(tier.feeRate * 100).toFixed(2)}%
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed">{tier.tagline}</p>

                    <div className="pt-1 flex flex-wrap gap-1.5">
                      {tier.discountPct > 0 && (
                        <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-[#2B7FFF]/15 text-[#60A5FA]">
                          -{tier.discountPct}% Discount
                        </span>
                      )}
                      {isActive && (
                        <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-[#08D189]/18 text-[#08D189] font-semibold">
                          Your Current Tier
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Verified On-Chain Trade Log (Sui Mainnet GraphQL + Aftermath History) */}
          {account?.address && (
            <div className="panel-carbon rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#323D52] flex flex-wrap items-center justify-between gap-2 bg-[#06070A]">
                <span className="text-sm font-bold text-white flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#08D189]" />
                  Verified On-Chain Activity ({summary?.trades.length ?? 0} fills / {summary?.txScannedCount ?? 0} txs scanned)
                </span>
                <span className="text-xs font-mono text-[#8E98A8]">
                  Persists across browsers &amp; devices
                </span>
              </div>

              {!summary || summary.trades.length === 0 ? (
                <div className="p-5 text-xs font-mono text-slate-400 bg-[#000000]">
                  {isSyncing
                    ? 'Scanning Sui Mainnet GraphQL & Aftermath Perpetuals history...'
                    : 'No swaps, CLOB/Margin fills, Perps, or Predict orders found in the latest 100 transactions for this address.'}
                </div>
              ) : (
                <div className="divide-y divide-[#2D374B] bg-[#000000] max-h-72 overflow-y-auto">
                  {summary.trades.slice(0, 12).map((t) => (
                    <div
                      key={t.digest}
                      className="px-5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs font-mono hover:bg-white/[0.02]"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="px-2 py-0.5 rounded bg-[#2B7FFF]/15 text-[#60A5FA] font-semibold text-[11px] shrink-0">
                          {t.channel}
                        </span>
                        <span className="text-white font-sans font-medium truncate">{t.label}</span>
                      </div>
                      <div className="flex items-center gap-4 tabular-nums shrink-0">
                        <span className="text-white font-semibold">${t.volumeUsd.toFixed(2)}</span>
                        <span className="text-slate-500 hidden sm:inline">
                          {t.timestampMs > 0
                            ? new Date(t.timestampMs).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                              })
                            : 'Mainnet'}
                        </span>
                        {!t.digest.startsWith('af-') && (
                          <a
                            href={`https://suiscan.xyz/mainnet/tx/${t.digest}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[#60A5FA] hover:underline"
                          >
                            <span>{t.digest.slice(0, 6)}...</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: FOR AFFILIATES / REFERRERS */}
      {subTab === 'referrers' && (
        <div className="space-y-5">
          {/* Invite Link Generator Hero */}
          <div className="panel-carbon rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-[#2B7FFF]/15 border border-[#2B7FFF]/40 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-[#60A5FA]" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">
                    Instant On-Chain PTB Revenue Share
                  </h2>
                  <p className="text-xs text-[#8E98A8]">
                    Your share executes inside the trader&apos;s transaction block — zero claim buttons, zero delays.
                  </p>
                </div>
              </div>

              <span className="text-sm font-mono font-bold px-3.5 py-1.5 rounded-xl bg-[#2B7FFF]/15 border border-[#2B7FFF]/40 text-[#60A5FA]">
                {refTier.name} · {Math.round(refTier.revSharePct * 100)}% Instant Split
              </span>
            </div>

            <div className="panel-carbon-sub rounded-xl p-4 space-y-3">
              <div className="text-xs font-medium text-slate-300">
                Your Permanent On-Chain Affiliate URL
              </div>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="text"
                  readOnly
                  value={refUrl}
                  className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#000000] border border-[#323D52] text-sm font-mono text-white outline-none"
                />
                <button
                  type="button"
                  disabled={!account?.address}
                  onClick={copyRefLink}
                  className="px-5 py-2.5 rounded-xl btn-deepbook disabled:opacity-40 font-bold text-sm inline-flex items-center justify-center gap-2 shrink-0"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>
                    {!account?.address
                      ? 'Connect Wallet to Copy'
                      : copied
                        ? 'Copied Referral Link'
                        : 'Copy Referral Link'}
                  </span>
                </button>
              </div>
            </div>

            {/* How Invitee Discount + Affiliate Payout Works */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="panel-carbon-sub rounded-xl p-3.5 space-y-1">
                <div className="font-bold text-white text-sm">1. Invitees Unlock -20% Off</div>
                <p className="text-slate-300 leading-relaxed">
                  Anyone connecting via your link automatically steps up to Plankton Tier (-20% lower fee).
                </p>
              </div>
              <div className="panel-carbon-sub rounded-xl p-3.5 space-y-1">
                <div className="font-bold text-white text-sm">2. Same-TX Atomic Settlement</div>
                <p className="text-slate-300 leading-relaxed">
                  Every Market Swap, Limit Order, Margin Order, Perp, or Zap splits your 25%–50% fee cut directly to your wallet.
                </p>
              </div>
              <div className="panel-carbon-sub rounded-xl p-3.5 space-y-1">
                <div className="font-bold text-white text-sm">3. Transparent Suiscan Proof</div>
                <p className="text-slate-300 leading-relaxed">
                  All payouts arrive as direct on-chain SUI / USDC coin transfers visible immediately on Suiscan.
                </p>
              </div>
            </div>
          </div>

          {account?.address && (
            <div className="panel-carbon rounded-2xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[#323D52] flex flex-wrap items-center justify-between gap-2 bg-[#06070A]">
                <span className="text-sm font-bold text-white">
                  On-Chain Affiliate Rev-Share Received ({summary?.referralPayouts.length ?? 0} payouts)
                </span>
                <span className="text-sm font-mono font-bold text-[#08D189] tabular-nums">
                  ${(summary?.referralEarnedUsd ?? 0).toFixed(4)} Earned
                </span>
              </div>

              {!summary || summary.referralPayouts.length === 0 ? (
                <div className="p-4 text-xs font-mono text-slate-400 bg-[#000000]">
                  No incoming fee-split payouts detected in the latest 30 transactions yet.
                </div>
              ) : (
                <div className="divide-y divide-[#2D374B] bg-[#000000] max-h-56 overflow-y-auto">
                  {summary.referralPayouts.map((p) => (
                    <div
                      key={`${p.digest}-${p.coinSymbol}`}
                      className="px-5 py-2.5 flex items-center justify-between text-xs font-mono"
                    >
                      <span className="text-slate-300">
                        From {p.traderAddress.slice(0, 6)}...{p.traderAddress.slice(-4)}
                      </span>
                      <div className="flex items-center gap-3 tabular-nums">
                        <span className="text-[#08D189] font-semibold">
                          +{p.amount.toFixed(4)} {p.coinSymbol} (${p.usdValue.toFixed(4)})
                        </span>
                        <a
                          href={`https://suiscan.xyz/mainnet/tx/${p.digest}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[#60A5FA] hover:underline"
                        >
                          <span>{p.digest.slice(0, 6)}...</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 3 Affiliate Syndicate Tiers */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {REFERRAL_TIERS.map((r) => {
              const isCurrent = r.name === refTier.name;
              return (
                <div
                  key={r.name}
                  className={`panel-carbon rounded-xl p-5 space-y-3 border transition-all ${
                    isCurrent
                      ? 'border-[#2B7FFF]/65 shadow-[0_0_24px_rgba(43,127,255,0.16)]'
                      : 'border-[#323D52]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-base font-bold text-white">{r.name}</span>
                    <span
                      className="text-xl font-mono font-bold"
                      style={{ color: isCurrent ? '#60A5FA' : r.badgeColor }}
                    >
                      {Math.round(r.revSharePct * 100)}%
                    </span>
                  </div>
                  <div className="text-xs font-mono text-[#8E98A8]">
                    Required Volume Threshold: ${r.minVolumeUsd.toLocaleString()}
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed">{r.description}</p>
                  {isCurrent && (
                    <div className="pt-1">
                      <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-[#2B7FFF]/15 text-[#60A5FA] font-semibold">
                        Active Affiliate Tier
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Live Protocol Volume Leaderboard (KV + Sui Mainnet GraphQL Verified) */}
      <div className="panel-carbon rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#323D52] flex flex-wrap items-center justify-between gap-2 bg-[#06070A]">
          <span className="text-sm font-bold text-white flex items-center gap-2">
            <Trophy className="w-4 h-4 text-[#2B7FFF]" />
            Verified Protocol Volume Leaderboard
          </span>
          <div className="flex items-center gap-3 text-xs font-mono">
            {leaderboardData && (
              <span className="text-[#8E98A8]">
                On-Chain Flow:{' '}
                <span className="text-white font-semibold">
                  ${leaderboardData.totalProtocolVolume.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                </span>
              </span>
            )}
            <span className="px-2 py-0.5 rounded bg-[#08D189]/12 border border-[#08D189]/30 text-[#08D189] text-[10px]">
              {leaderboardData?.source === 'kv+onchain' ? 'KV + Sui GraphQL' : 'Sui Mainnet GraphQL'}
            </span>
          </div>
        </div>

        {isLoadingBoard && !leaderboardData ? (
          <div className="p-5 text-xs font-mono text-slate-400 bg-[#000000]">
            Indexing verified Sui Mainnet protocol transactions...
          </div>
        ) : !leaderboardData || leaderboardData.leaderboard.length === 0 ? (
          <div className="p-5 text-xs font-mono text-slate-400 bg-[#000000]">
            No recent treasury-routed fills indexed in the latest window.
          </div>
        ) : (
          <div className="divide-y divide-[#2A3346] bg-[#000000]">
            {leaderboardData.leaderboard.slice(0, 8).map((row) => (
              <div
                key={row.fullAddress || row.address}
                className="px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs font-mono hover:bg-white/[0.02]"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`w-6 text-center font-bold ${
                      row.rank === 1
                        ? 'text-amber-400'
                        : row.rank === 2
                          ? 'text-slate-200'
                          : row.rank === 3
                            ? 'text-amber-600'
                            : 'text-[#8E98A8]'
                    }`}
                  >
                    #{row.rank}
                  </span>
                  <span className="text-white font-semibold">{row.address}</span>
                  <span className="px-2 py-0.5 rounded bg-[#2B7FFF]/12 text-[#60A5FA] text-[11px]">
                    {row.tier}
                  </span>
                </div>
                <div className="flex items-center gap-4 tabular-nums">
                  <span className="text-[#8E98A8]">{row.tradesCount} tx</span>
                  <span className="text-white font-bold">
                    ${row.volumeUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  {row.fullAddress && (
                    <a
                      href={`https://suiscan.xyz/mainnet/account/${row.fullAddress}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#60A5FA] hover:underline inline-flex items-center gap-1"
                    >
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer Verification Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-[#8E98A8] px-1 pt-1">
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#08D189]" />
          All fee splits execute atomically on Sui Mainnet without off-chain custody
        </span>
        {account?.address && (
          <a
            href={`https://suiscan.xyz/mainnet/account/${account.address}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[#60A5FA] hover:underline font-semibold"
          >
            <span>Inspect Payouts on Suiscan</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </div>
  );
};
