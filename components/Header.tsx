"use client";

import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { Providers } from "@/app/providers";

export function Header() {
  return (
    <Providers>
      <ConnectButton />
    </Providers>
  );
}
