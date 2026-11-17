"use client";

import { useEffect } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { Providers } from "@/app/providers";
import { OWNER } from "@/lib/owner-address";

function Inner() {
  const account = useCurrentAccount();
  const address = account?.address?.toLowerCase();

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

  return (
    <>
      {address === OWNER && (
        <a className="owner-link" href="/owner">
          Cabinet
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
