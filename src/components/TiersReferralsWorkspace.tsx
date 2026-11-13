import React, { useMemo, useState } from 'react';
import { Check, Copy, ExternalLink, ShieldCheck, Users } from 'lucide-react';
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

export const TiersReferralsWorkspace: React.FC<TiersReferralsWorkspaceProps> = ({
  externalVolumeUsd,
}) => {
  const account = useCurrentAccount();
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
    <div className="w-full space-y-5">
      {/* Active Status + Referral Link Generator */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-5 panel-carbon rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Your Active Trader Tier</span>
            <span className="text-xs font-mono text-[#38BDF8]">
              {(traderTier.feeRate * 100).toFixed(2)}% Flat Fee
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-lg bg-[#0C0E12] border border-white/[0.08] flex items-center justify-center text-xl">
              {traderTier.badgeEmoji}
            </div>
            <div>
              <div className="text-base font-semibold text-white">{traderTier.name}</div>
              <div className="text-xs text-slate-400 font-mono tabular-nums">
                Tracked Volume: ${volumeUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] font-mono text-slate-400">
              <span>Next Tier Progress</span>
              <span>
                {traderTier.nextTierVolumeUsd
                  ? `$${volumeUsd.toFixed(0)} / $${traderTier.nextTierVolumeUsd.toLocaleString()}`
                  : 'Maximum Tier'}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full bg-[#38BDF8] transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {activeReferrer && (
            <div className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
              Invited by {activeReferrer.slice(0, 8)}...{activeReferrer.slice(-6)} · -20% Plankton
              discount unlocked automatically.
            </div>
          )}
        </div>

        <div className="lg:col-span-7 panel-carbon rounded-xl p-4 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[#38BDF8]" />
              <span className="text-sm font-semibold text-white">
                Instant On-Chain PTB Revenue Share
              </span>
            </div>
            <span className="text-xs font-mono text-emerald-400">
              {refTier.name} · {Math.round(refTier.revSharePct * 100)}% Split
            </span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Zero manual claiming and zero lockups. Whenever any trader executes a Market Swap,
            DeepBook v3 Limit Order, or Aftermath Perp via your link, the Sui Programmable
            Transaction Block splits {Math.round(refTier.revSharePct * 100)}% of the protocol fee
            directly to your wallet in the same transaction.
          </p>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              readOnly
              value={refUrl}
              className="flex-1 px-3 py-2 rounded-lg bg-[#0C0E12] border border-white/[0.08] text-xs font-mono text-slate-200 outline-none"
            />
            <button
              type="button"
              disabled={!account?.address}
              onClick={copyRefLink}
              className="px-4 py-2 rounded-lg bg-[#38BDF8] hover:bg-[#56CCF9] disabled:opacity-40 text-[#090B0E] font-semibold text-xs inline-flex items-center justify-center gap-1.5 shrink-0"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied Link' : 'Copy Referral Link'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 6 Dynamic Trader Fee Tiers */}
      <div className="panel-carbon rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
          <span className="text-sm font-semibold text-white">Dynamic Trader Volume Tiers</span>
          <span className="text-xs text-slate-400 font-mono">
            Applies across Swap, DeepBook Limit & Perps
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 divide-y sm:divide-y-0 sm:gap-px bg-white/[0.04]">
          {TRADER_TIERS.map((tier) => {
            const isActive = tier.id === traderTier.id;
            return (
              <div
                key={tier.id}
                className={`p-4 space-y-2 ${isActive ? 'bg-[#121822]' : 'bg-[#101318]'}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{tier.badgeEmoji}</span>
                    <span className="text-xs font-semibold text-white">{tier.name}</span>
                  </div>
                  <span
                    className={`text-xs font-mono font-semibold ${
                      isActive ? 'text-[#38BDF8]' : 'text-slate-300'
                    }`}
                  >
                    {(tier.feeRate * 100).toFixed(2)}%
                  </span>
                </div>
                <div className="text-[11px] font-mono text-slate-400">
                  Min Volume: ${tier.minVolumeUsd.toLocaleString()}
                  {tier.discountPct > 0 ? ` · -${tier.discountPct}%` : ''}
                </div>
                <p className="text-[11px] text-slate-500">{tier.tagline}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* 3 Referral Rev-Share Tiers */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {REFERRAL_TIERS.map((r) => {
          const isCurrent = r.name === refTier.name;
          return (
            <div
              key={r.name}
              className={`panel-carbon rounded-xl p-4 space-y-2 ${
                isCurrent ? 'border-[#38BDF8]/40' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-white">{r.name}</span>
                <span
                  className="text-sm font-mono font-bold"
                  style={{ color: r.badgeColor }}
                >
                  {Math.round(r.revSharePct * 100)}%
                </span>
              </div>
              <div className="text-[11px] font-mono text-slate-400">
                Threshold: ${r.minVolumeUsd.toLocaleString()}
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">{r.description}</p>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 px-1">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          All fee splits execute atomically on Sui Mainnet without off-chain custody
        </span>
        {account?.address && (
          <a
            href={`https://suiscan.xyz/mainnet/account/${account.address}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 hover:text-[#38BDF8]"
          >
            <span>Inspect Payouts on Suiscan</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
};
