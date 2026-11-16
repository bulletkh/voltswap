import type { Metadata } from "next";
import { MarketSlot } from "@/components/ClientOnly";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Market · Voltswap",
  description: "Live prices and 24-hour change for the main tokens on Sui.",
};

export default function MarketPage() {
  return (
    <>
      <SiteHeader active="market" />
      <main className="page-narrow">
        <h1 className="page-title">Market</h1>
        <p className="page-lead">Live prices and 24-hour change for the main Sui tokens.</p>
        <MarketSlot />
      </main>
      <footer className="foot">
        <p>Market data is informational only. This is not financial advice.</p>
        <nav aria-label="Legal">
          <a href="/terms">Terms of use</a>
          <a href="/risks">Risks</a>
        </nav>
      </footer>
    </>
  );
}
