"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { FEE_RATE, FEE_RECEIVER } from "@/lib/config";
import type { RanksPayload } from "@/lib/owner";
import {
  ACTIVE_REFERRAL_MIN_USD,
  PARTNER_MIN_VOLUME_USD,
  PARTNER_TIERS,
  TRADER_TIERS,
  VOLUME_EVENT,
  effectiveSwapFeeRate,
  formatFeePct,
  getOptimisticVolume,
  getValidReferrerForSender,
  normalizeSuiAddress,
  resolvePartnerTier,
  resolveTraderTier,
  syncOptimisticVolume,
} from "@/lib/ranks";

type Tab = "leaderboard" | "ranks" | "partners";

const usd = (v: number) => {
  if (!Number.isFinite(v) || v <= 0) return "$0";
  if (v < 0.01) return "$" + v.toLocaleString("en-US", { maximumSignificantDigits: 2, maximumFractionDigits: 6 });
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: v < 100 ? 2 : 0, maximumFractionDigits: v < 100 ? 2 : 0 });
};

const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);

export function PartnerView() {
  const account = useCurrentAccount();
  const address = normalizeSuiAddress(account?.address);
  const [data, setData] = useState<RanksPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [optVol, setOptVol] = useState(0);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<Tab>("leaderboard");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (address) qs.set("wallet", address);
      const storedRef = getValidReferrerForSender(address, FEE_RECEIVER);
      if (storedRef) qs.set("ref", storedRef);
      const r = await fetch(`/api/ranks${qs.toString() ? `?${qs.toString()}` : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? String(r.status));
      const payload = j as RanksPayload;
      setData(payload);
      if (address && payload.wallet) {
        setOptVol(syncOptimisticVolume(address, payload.wallet.volume));
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load on-chain ranks.");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    setOptVol(getOptimisticVolume(address));
    const onVol = () => setOptVol(getOptimisticVolume(address));
    window.addEventListener(VOLUME_EVENT, onVol);
    void load();
    return () => window.removeEventListener(VOLUME_EVENT, onVol);
  }, [address, load]);

  const volumeUsd = useMemo(
    () => Math.max(data?.wallet?.volume ?? 0, optVol),
    [data?.wallet?.volume, optVol],
  );
  const activeRefs = data?.wallet?.activeReferrals ?? 0;
  const referredVol = data?.wallet?.referredVolume ?? 0;
  const combinedVol = volumeUsd + referredVol;
  const hasActiveRef = Boolean(data?.referrer?.active);
  const traderTier = useMemo(() => resolveTraderTier(volumeUsd, hasActiveRef), [volumeUsd, hasActiveRef]);
  const partnerTier = useMemo(
    () => resolvePartnerTier(address, volumeUsd, activeRefs, referredVol),
    [address, volumeUsd, activeRefs, referredVol],
  );
  const effFee = effectiveSwapFeeRate(FEE_RATE, traderTier);

  const nextPartner = useMemo(() => {
    const idx = PARTNER_TIERS.findIndex((p) => p.id === partnerTier.id);
    if (idx < 0 || idx >= PARTNER_TIERS.length - 1) return null;
    return PARTNER_TIERS[idx + 1];
  }, [partnerTier.id]);

  const partnerProgPct = useMemo(() => {
    if (!nextPartner || !partnerTier.active) return 0;
    const refPct = nextPartner.minActiveRefs > 0 ? (activeRefs / nextPartner.minActiveRefs) * 100 : 0;
    const volPct = nextPartner.minVolumeUsd > 0 ? (combinedVol / nextPartner.minVolumeUsd) * 100 : 0;
    return Math.min(100, Math.max(0, Math.max(refPct, volPct)));
  }, [nextPartner, partnerTier.active, activeRefs, combinedVol]);

  const nextTrader = useMemo(() => {
    const idx = TRADER_TIERS.findIndex((t) => t.id === traderTier.id);
    return idx >= 0 && idx < TRADER_TIERS.length - 1 ? TRADER_TIERS[idx + 1] : null;
  }, [traderTier.id]);

  const traderPct = useMemo(() => {
    if (!nextTrader) return 100;
    const floor = traderTier.minVolumeUsd;
    const span = nextTrader.minVolumeUsd - floor;
    if (span <= 0) return 100;
    return Math.min(100, Math.max(0, ((volumeUsd - floor) / span) * 100));
  }, [volumeUsd, traderTier.minVolumeUsd, nextTrader]);

  const unlockPct = Math.min(100, Math.max(0, (volumeUsd / PARTNER_MIN_VOLUME_USD) * 100));

  const refLink = address ? `https://voltswap.org/?ref=${address}` : "https://voltswap.org/?ref=<YOUR_SUI_ADDRESS>";

  async function copyLink() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(refLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* ignore clipboard denial */
    }
  }

  function shareOnX() {
    if (!address) return;
    const txt = `Swap on @SuiNetwork at the best price with instant -20% Plankton fee discount on @voltswap ⚡\n\nUse my partner link:\n${refLink}`;
    window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(txt)}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="pt">
      <div className="pt-grid">
        {/* Card 1: Trader Rank */}
        <section className="card pt-card">
          <div className="pt-head">
            <span className="tk-sub">Your Trader Rank</span>
            <button type="button" className="ow-btn" onClick={() => void load()} disabled={loading}>
              {loading ? "Syncing…" : "Refresh"}
            </button>
          </div>

          <div className="pt-hero-row">
            <div
              className={`rank-badge-lg rank-${traderTier.id}`}
              style={{ "--rk-color": traderTier.color, "--rk-glow": traderTier.glow } as React.CSSProperties}
            >
              <span className="rank-emoji-lg" aria-hidden="true">{traderTier.emoji}</span>
              <div>
                <strong>{address ? traderTier.name : "Connect wallet"}</strong>
                <span>
                  {address
                    ? `${formatFeePct(effFee)} swap fee${traderTier.discountPct > 0 ? ` (-${traderTier.discountPct}%)` : ""}`
                    : "Unlock glowing ranks & up to 100% fee rebates"}
                </span>
              </div>
            </div>
          </div>

          <div className="pt-mini-kpis">
            <div>
              <span>Your volume</span>
              <strong>{address ? usd(volumeUsd) : "—"}</strong>
            </div>
            <div>
              <span>Swaps</span>
              <strong>{address ? (data?.wallet?.swaps ?? 0) : "—"}</strong>
            </div>
            <div>
              <span>Global rank</span>
              <strong>{address && data?.wallet?.rank ? `#${data.wallet.rank}` : "—"}</strong>
            </div>
          </div>

          <div className="pt-prog-wrap">
            <div className="pt-prog-labels">
              <span>{nextTrader ? `Next: ${nextTrader.emoji} ${nextTrader.name} (-${nextTrader.discountPct}%)` : "Maximum rank reached"}</span>
              <span>
                {nextTrader
                  ? `${usd(volumeUsd)} / ${usd(nextTrader.minVolumeUsd)}`
                  : "0.00% fee unlocked"}
              </span>
            </div>
            <div className="pt-bar">
              <i
                style={{
                  width: `${address ? traderPct : 0}%`,
                  background: `linear-gradient(90deg, ${traderTier.color}, #ffd60a)`,
                }}
              />
            </div>
          </div>
        </section>

        {/* Card 2: Partner Referral Cabinet */}
        <section className="card pt-card">
          <div className="pt-head">
            <span className="tk-sub">Partner Rev-Share Cabinet</span>
            <span
              className={`pt-status-pill ${partnerTier.active ? "active" : "locked"}`}
              style={{ "--rk-color": partnerTier.color, "--rk-glow": partnerTier.glow } as React.CSSProperties}
            >
              {partnerTier.emoji} {partnerTier.active ? `${partnerTier.name} · ${Math.round(partnerTier.revSharePct * 100)}%` : `Swap $${PARTNER_MIN_VOLUME_USD} to activate`}
            </span>
          </div>

          {address && !partnerTier.active ? (
            <div className="pt-unlock-box">
              <div className="pt-prog-labels">
                <span>Activate 25% Instant Rev-Share</span>
                <strong>{usd(volumeUsd)} / ${PARTNER_MIN_VOLUME_USD}</strong>
              </div>
              <div className="pt-bar">
                <i style={{ width: `${unlockPct}%`, background: "linear-gradient(90deg, #38bdf8, #ffd60a)" }} />
              </div>
              <p className="pt-note">
                Complete at least <b>${PARTNER_MIN_VOLUME_USD}</b> in swap volume on Voltswap to activate your{" "}
                <b>25% Volt Scout</b> on-chain payouts.{" "}
                <a href="/" className="pt-inline-cta">Swap now →</a>
              </p>
            </div>
          ) : (
            <p className="pt-note">
              Share your link below. Invited traders immediately get <b>🦐 Plankton (-20% fee)</b>, and your{" "}
              <b>{partnerTier.active ? `${Math.round(partnerTier.revSharePct * 100)}%` : "25%–50%"}</b> fee share settles{" "}
              <b>instantly on-chain</b> in the exact same Sui transaction.
            </p>
          )}

          <div className="pt-link-row">
            <code className="pt-code">{refLink}</code>
            <button type="button" className="pt-copy" onClick={() => void copyLink()} disabled={!address}>
              {copied ? "Copied ✓" : "Copy"}
            </button>
            <button type="button" className="ow-btn" onClick={shareOnX} disabled={!address}>
              Share 𝕏
            </button>
          </div>

          {address && partnerTier.active && nextPartner && (
            <div className="pt-prog-wrap" style={{ marginTop: 0 }}>
              <div className="pt-prog-labels">
                <span>
                  Next: {nextPartner.emoji} {nextPartner.name} ({Math.round(nextPartner.revSharePct * 100)}%)
                </span>
                <span>
                  {activeRefs} / {nextPartner.minActiveRefs} active refs (≥${ACTIVE_REFERRAL_MIN_USD}) · or {usd(combinedVol)} / {usd(nextPartner.minVolumeUsd)}
                </span>
              </div>
              <div className="pt-bar">
                <i
                  style={{
                    width: `${partnerProgPct}%`,
                    background: `linear-gradient(90deg, ${partnerTier.color}, ${nextPartner.color})`,
                  }}
                />
              </div>
            </div>
          )}

          <div className="pt-mini-kpis pt-ref-kpis">
            <div title={`Active referrals (swapped ≥ $${ACTIVE_REFERRAL_MIN_USD}) / total invited`}>
              <span>Active refs</span>
              <strong>
                {address
                  ? `${activeRefs}${
                      (data?.wallet?.invitedWallets ?? 0) > activeRefs
                        ? ` / ${data?.wallet?.invitedWallets}`
                        : ""
                    }`
                  : "—"}
              </strong>
            </div>
            <div>
              <span>Ref swaps</span>
              <strong>{address ? (data?.wallet?.referredSwaps ?? 0) : "—"}</strong>
            </div>
            <div>
              <span>Ref volume</span>
              <strong>{address ? usd(referredVol) : "—"}</strong>
            </div>
            <div>
              <span>Earned</span>
              <strong className="ow-big">{address ? usd(data?.wallet?.refEarnedUsd ?? 0) : "—"}</strong>
            </div>
          </div>
        </section>
      </div>

      {error && <p className="notice">{error}</p>}

      {/* Sub-tabs: Top-50 Leaderboard | Trader Ranks | Partner Tiers */}
      <section className="card pt-board">
        <div className="ow-top">
          <div className="wh-tabs pt-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "leaderboard"} className={tab === "leaderboard" ? "on" : ""} onClick={() => setTab("leaderboard")}>
              Top-50 Volume
            </button>
            <button type="button" role="tab" aria-selected={tab === "ranks"} className={tab === "ranks" ? "on" : ""} onClick={() => setTab("ranks")}>
              Trader Ranks (6)
            </button>
            <button type="button" role="tab" aria-selected={tab === "partners"} className={tab === "partners" ? "on" : ""} onClick={() => setTab("partners")}>
              Partner Tiers (25–50%)
            </button>
          </div>
          <span className="pt-meta">
            {data ? `${data.totalWallets} on-chain swappers indexed` : "Reading Sui mainnet…"}
          </span>
        </div>

        {tab === "leaderboard" && (
          <>
            <p className="pt-note">
              Real on-chain swap volume on Voltswap. <b>Top 1–10</b> qualify for <b>50% Lifetime Whale Syndicate</b> and{" "}
              <b>Top 11–50</b> unlock <b>40% VIP Founding Partner</b> in the 30-Day Sprint.
            </p>
            {data && data.leaderboard.length > 0 ? (
              <ol className="pf-list pt-lb">
                {data.leaderboard.map((row) => {
                  const t = resolveTraderTier(row.volume, false);
                  const isMe = address && row.address === address;
                  const zone =
                    row.rank <= 10
                      ? { label: "👑 Top 10 · 50%", cls: "zone-top10" }
                      : { label: "⚡ Top 50 · 40%", cls: "zone-top50" };
                  return (
                    <li key={row.address} className={isMe ? "is-me" : undefined}>
                      <span className="pt-rank-num">#{row.rank}</span>
                      <div className="pf-name">
                        <div className="pt-addr-row">
                          <a href={`https://suiscan.xyz/mainnet/account/${row.address}`} target="_blank" rel="noreferrer">
                            {short(row.address)}
                          </a>
                          {isMe && <span className="pt-you">You</span>}
                          <span
                            className={`rank-chip rank-${t.id}`}
                            style={{ "--rk-color": t.color, "--rk-glow": t.glow } as React.CSSProperties}
                          >
                            {t.emoji} {t.name}
                          </span>
                        </div>
                        <span>{row.swaps} {row.swaps === 1 ? "swap" : "swaps"}</span>
                      </div>
                      <div className="pf-val">
                        <strong>{usd(row.volume)}</strong>
                        <span className={`pt-zone ${zone.cls}`}>{zone.label}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="pf-note">{loading ? "Loading on-chain leaderboard…" : "No verified swaps indexed yet — be #1!"}</p>
            )}
          </>
        )}

        {tab === "ranks" && (
          <div className="pt-tier-grid">
            {TRADER_TIERS.map((t) => {
              const isCur = address && traderTier.id === t.id;
              const feeStr = formatFeePct(effectiveSwapFeeRate(FEE_RATE, t));
              return (
                <article
                  key={t.id}
                  className={`pt-tier-card rank-${t.id}${isCur ? " current" : ""}`}
                  style={{ "--rk-color": t.color, "--rk-glow": t.glow } as React.CSSProperties}
                >
                  <div className="pt-tier-top">
                    <span className="pt-tier-emoji" aria-hidden="true">{t.emoji}</span>
                    <div>
                      <h3>{t.name}</h3>
                      <span className="pt-tier-vol">
                        {t.minVolumeUsd === 0 ? "Starting tier" : `${usd(t.minVolumeUsd)}+ volume`}
                      </span>
                    </div>
                    {isCur && <span className="pt-you">Active</span>}
                  </div>
                  <div className="pt-tier-fee">
                    <b>{feeStr}</b>
                    <span>{t.discountPct > 0 ? `-${t.discountPct}% discount` : "Base fee"}</span>
                  </div>
                  <p>{t.tagline}</p>
                </article>
              );
            })}
          </div>
        )}

        {tab === "partners" && (
          <>
            <p className="pt-note">
              Unlock higher instant rev-share automatically by bringing <b>active referrals</b> (each swapping ≥ ${ACTIVE_REFERRAL_MIN_USD}) <b>OR</b> by personal + referred volume — no Zealy required.
            </p>
            <div className="pt-tier-grid pt-partner-grid">
              {PARTNER_TIERS.filter((p) => p.id !== "locked").map((p) => {
                const isCur = address && partnerTier.id === p.id;
                const unlockHeadline =
                  p.minActiveRefs > 0
                    ? `${p.minActiveRefs}+ active refs or ${usd(p.minVolumeUsd)}+ vol`
                    : `$${PARTNER_MIN_VOLUME_USD}+ personal swap`;
                return (
                  <article
                    key={p.id}
                    className={`pt-tier-card${isCur ? " current" : ""}`}
                    style={{ "--rk-color": p.color, "--rk-glow": p.glow } as React.CSSProperties}
                  >
                    <div className="pt-tier-top">
                      <span className="pt-tier-emoji" aria-hidden="true">{p.emoji}</span>
                      <div>
                        <h3>{p.name}</h3>
                        <span className="pt-tier-vol">{unlockHeadline}</span>
                      </div>
                      {isCur && <span className="pt-you">Your Tier</span>}
                    </div>
                    <div className="pt-tier-fee">
                      <b>{Math.round(p.revSharePct * 100)}%</b>
                      <span>instant on-chain PTB split</span>
                    </div>
                    <p>{p.requirement}</p>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
