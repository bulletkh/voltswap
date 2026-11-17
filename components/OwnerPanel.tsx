"use client";

import { Providers } from "@/app/providers";
import { OwnerView } from "./OwnerView";

export function OwnerPanel() {
  return (
    <Providers>
      <OwnerView />
    </Providers>
  );
}
