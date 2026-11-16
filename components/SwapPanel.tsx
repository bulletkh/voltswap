"use client";

import { Providers } from "@/app/providers";
import { SwapCard } from "./SwapCard";

export function SwapPanel() {
  return (
    <Providers>
      <SwapCard />
    </Providers>
  );
}
