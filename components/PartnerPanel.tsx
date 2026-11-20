"use client";

import { Providers } from "@/app/providers";
import { PartnerView } from "./PartnerView";

export function PartnerPanel() {
  return (
    <Providers>
      <PartnerView />
    </Providers>
  );
}
