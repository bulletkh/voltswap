"use client";

import { Providers } from "@/app/providers";
import { MarketView } from "./MarketView";

export function MarketPanel() {
  return (
    <Providers>
      <MarketView />
    </Providers>
  );
}
