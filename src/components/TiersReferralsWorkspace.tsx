import React, { useMemo, useState } from 'react';
import {
  Award,
  Check,
  Copy,
  ExternalLink,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  Users,
  Zap,
} from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { TRADER_TIERS } from '../constants';
import {
  getValidReferrerForSender,
  getWalletVolumeUsd,
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

  const volumeUsd = useMemo(
    () => externalVolumeUsd ?? getWalletVolumeUsd(account?.address),
    [externalVolumeUsd, account?.address]
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

  const refUrl = account?.address
    ? `https://voltswap.org/?ref=${account.address}`
    : 'https://voltswap.org/?ref=<YOUR_SUI_ADDRESS>';

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
              ? 'Volume-based fee rebates down to 0.03% across Market Swap, DeepBook Limit, Margin & Perps.'
              : 'Instant non-custodial PTB rev-share paid directly to your wallet on every referred trade.'}
          </p>
        </div>

        <div className="inline-flex items-center p-1.5 rounded-2xl panel-carbon self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setSubTab('traders')}
            className={`px-4 py-2 rounded-xl text-sm font-bold inline-flex items-center gap-2 transition-all ${
              subTab === 'traders'
                ? 'bg-gradient-to-r from-[#D7F626] to-[#B5E600] text-[#080A0D] shadow-[0_0_20px_rgba(0,224,184,0.28)]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Award className="w-4 h-4" />
            <span>For Traders</span>
          </button>
          <button
            type="button"
            onClick={() => setSubTab('referrers')}
            className={`px-4 py-2 rounded-xl text-sm font-bold inline-flex items-center gap-2 transition-all ${
              subTab === 'referrers'
                ? 'bg-gradient-to-r from-[#D7F626] to-[#B5E600] text-[#080A0D] shadow-[0_0_20px_rgba(0,224,184,0.28)]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>For Affiliates</span>
          </button>
        </div>
      </div>

      {/* SUB-TAB 1: FOR TRADERS */}
      {subTab === 'traders' && (
        <div className="space-y-5">
          {/* Active Tier Hero Progress Card */}
          <div className="panel-carbon rounded-2xl p-5 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
            <div className="lg:col-span-5 flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-[#0A0C10] border border-[#D7F626]/30 flex items-center justify-center text-3xl shadow-[0_0_24px_rgba(0,224,184,0.14)]">
                {traderTier.badgeEmoji}
              </div>
              <div>
                <div className="text-xs font-mono uppercase tracking-wider text-[#D7F626]">
                  Active Trader Tier
                </div>
                <div className="text-xl font-bold text-white mt-0.5">{traderTier.name}</div>
                <div className="text-sm text-slate-300 font-mono tabular-nums mt-0.5">
                  Tracked Volume:{' '}
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
              <div className="w-full h-2.5 rounded-full bg-white/[0.08] overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#D7F626] to-[#B5E600] transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              {activeReferrer && (
                <div className="text-xs font-mono text-[#00E599] inline-flex items-center gap-1.5 pt-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>
                    Invited by {activeReferrer.slice(0, 8)}...{activeReferrer.slice(-6)} · -20%
                    Plankton fee rebate active automatically
                  </span>
                </div>
              )}
            </div>

            <div className="lg:col-span-2 panel-carbon-sub rounded-xl p-3.5 text-center border border-[#D7F626]/25">
              <div className="text-xs text-slate-400">Your Protocol Fee</div>
              <div className="text-2xl font-mono font-bold text-[#D7F626] mt-0.5">
                {(traderTier.feeRate * 100).toFixed(2)}%
              </div>
              <div className="text-xs text-[#00E599] font-mono">
                {traderTier.discountPct > 0 ? `-${traderTier.discountPct}% Rebate` : 'Base Rate'}
              </div>
            </div>
          </div>

          {/* 6 Dynamic Trader Fee Tiers */}
          <div className="panel-carbon rounded-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-2 bg-[#0F151E]">
              <span className="text-base font-bold text-white flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-[#D7F626]" />
                Volume Discount Schedule
              </span>
              <span className="text-xs text-slate-300 font-mono">
                Applies across Market Swap · DeepBook Limit · Margin · Perps · Earn
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
              {TRADER_TIERS.map((tier) => {
                const isActive = tier.id === traderTier.id;
                return (
                  <div
                    key={tier.id}
                    className={`rounded-2xl p-4 space-y-2.5 border transition-all ${
                      isActive
                        ? 'bg-[#D7F626]/10 border-[#D7F626]/45 shadow-[0_0_24px_rgba(0,224,184,0.14)]'
                        : 'panel-carbon-sub hover:border-white/[0.16]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <span className="text-2xl">{tier.badgeEmoji}</span>
                        <div>
                          <div className="text-sm font-bold text-white">{tier.name}</div>
                          <div className="text-xs font-mono text-slate-400">
                            {tier.minVolumeUsd === 0
                              ? 'Entry Tier'
                              : `$${tier.minVolumeUsd.toLocaleString()}+ Vol`}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`text-base font-mono font-bold ${
                          isActive ? 'text-[#D7F626]' : 'text-white'
                        }`}
                      >
                        {(tier.feeRate * 100).toFixed(2)}%
                      </span>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed">{tier.tagline}</p>

                    <div className="pt-1 flex flex-wrap gap-1.5">
                      {tier.discountPct > 0 && (
                        <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-[#D7F626]/15 text-[#D7F626]">
                          -{tier.discountPct}% Discount
                        </span>
                      )}
                      {isActive && (
                        <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-[#00D98B]/20 text-[#00E599] font-semibold">
                          Your Current Tier
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: FOR AFFILIATES / REFERRERS */}
      {subTab === 'referrers' && (
        <div className="space-y-5">
          {/* Invite Link Generator Hero */}
          <div className="panel-carbon rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-[#D7F626]/15 border border-[#D7F626]/35 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-[#D7F626]" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">
                    Instant On-Chain PTB Revenue Share
                  </h2>
                  <p className="text-xs text-slate-300">
                    Your share executes inside the trader&apos;s transaction block — zero claim buttons, zero delays.
                  </p>
                </div>
              </div>

              <span className="text-sm font-mono font-bold px-3.5 py-1.5 rounded-xl bg-[#D7F626]/15 border border-[#D7F626]/35 text-[#D7F626]">
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
                  className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#070B10] border border-white/[0.12] text-sm font-mono text-white outline-none"
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

          {/* 3 Affiliate Syndicate Tiers */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {REFERRAL_TIERS.map((r) => {
              const isCurrent = r.name === refTier.name;
              return (
                <div
                  key={r.name}
                  className={`panel-carbon rounded-2xl p-5 space-y-3 border transition-all ${
                    isCurrent
                      ? 'border-[#D7F626]/55 shadow-[0_0_28px_rgba(0,224,184,0.16)]'
                      : 'border-white/[0.085]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-base font-bold text-white">{r.name}</span>
                    <span
                      className="text-xl font-mono font-bold"
                      style={{ color: isCurrent ? '#D7F626' : r.badgeColor }}
                    >
                      {Math.round(r.revSharePct * 100)}%
                    </span>
                  </div>
                  <div className="text-xs font-mono text-slate-300">
                    Required Volume Threshold: ${r.minVolumeUsd.toLocaleString()}
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed">{r.description}</p>
                  {isCurrent && (
                    <div className="pt-1">
                      <span className="text-xs font-mono px-2.5 py-1 rounded-lg bg-[#D7F626]/15 text-[#D7F626] font-semibold">
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

      {/* Footer Verification Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-slate-300 px-1 pt-1">
        <span className="inline-flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#00E599]" />
          All fee splits execute atomically on Sui Mainnet without off-chain custody
        </span>
        {account?.address && (
          <a
            href={`https://suiscan.xyz/mainnet/account/${account.address}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[#D7F626] hover:underline font-semibold"
          >
            <span>Inspect Payouts on Suiscan</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </div>
  );
};
