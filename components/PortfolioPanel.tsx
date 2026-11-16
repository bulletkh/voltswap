"use client";

import { Providers } from "@/app/providers";
import { PortfolioView } from "./PortfolioView";

export function PortfolioPanel() {
  return (
    <Providers>
      <PortfolioView />
    </Providers>
  );
}
