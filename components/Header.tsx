"use client";

import { useEffect, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { Providers } from "@/app/providers";
import { FEE_RATE, FEE_RECEIVER } from "@/lib/config";
import { OWNER } from "@/lib/owner-address";
import type { RanksPayload } from "@/lib/owner";
import {
  VOLUME_EVENT,
  captureReferralFromUrl,
  effectiveSwapFeeRate,
  formatFeePct,
  getOptimisticVolume,
  getValidReferrerForSender,
  resolveTraderTier,
  syncOptimisticVolume,
} from "@/lib/ranks";

function Inner() {
  const account = useCurrentAccount();
  const address = account?.address?.toLowerCase();
  const [volumeUsd, setVolumeUsd] = useState(0);
  const [hasActiveRef, setHasActiveRef] = useState(false);

  // Capture ?ref=0x... on any landing route
  useEffect(() => {
    captureReferralFromUrl();
  }, []);

  // Load on-chain rank volume & live updates
  useEffect(() => {
    if (!address) {
      setVolumeUsd(0);
      setHasActiveRef(false);
      return;
    }
    setVolumeUsd(getOptimisticVolume(address));
    const onVol = () => setVolumeUsd(getOptimisticVolume(address));
    window.addEventListener(VOLUME_EVENT, onVol);

    let alive = true;
    const ref = getValidReferrerForSender(address, FEE_RECEIVER);
    const qs = new URLSearchParams({ wallet: address });
    if (ref) qs.set("ref", ref);
    void fetch(`/api/ranks?${qs.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: RanksPayload | null) => {
        if (!alive || !d) return;
        if (d.wallet) setVolumeUsd(syncOptimisticVolume(address, d.wallet.volume));
        setHasActiveRef(Boolean(d.referrer?.active));
      })
      .catch(() => {});

    return () => {
      alive = false;
      window.removeEventListener(VOLUME_EVENT, onVol);
    };
  }, [address]);

  // tell the owner (Telegram) when a new wallet connects; once per wallet per browser session
  useEffect(() => {
    if (!address || address === OWNER) return;
    try {
      const k = "vs:conn:" + address;
      if (window.sessionStorage.getItem(k)) return;
      window.sessionStorage.setItem(k, "1");
    } catch {
      /* storage unavailable: still notify once per mount */
    }
    void fetch("/api/notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "connect", address }) }).catch(() => {});
  }, [address]);

  const tier = address ? resolveTraderTier(volumeUsd, hasActiveRef) : null;
  const effFee = tier ? formatFeePct(effectiveSwapFeeRate(FEE_RATE, tier)) : null;

  return (
    <>
      {address === OWNER && (
        <a className="owner-link" href="/owner">
          Cabinet
        </a>
      )}
      {tier && (
        <a
          className={`rank-pill rank-${tier.id}`}
          href="/partner"
          style={
            {
              "--rk-color": tier.color,
              "--rk-glow": tier.glow,
            } as React.CSSProperties
          }
          title={`${tier.name} · ${effFee} swap fee · Open Partner & Ranks Cabinet`}
        >
          <span className="rank-emoji" aria-hidden="true">{tier.emoji}</span>
          <span className="rank-name">{tier.name}</span>
        </a>
      )}
      <ConnectButton />
    </>
  );
}

export function Header() {
  return (
    <Providers>
      <Inner />
    </Providers>
  );
}
