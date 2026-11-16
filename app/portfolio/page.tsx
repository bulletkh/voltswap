import type { Metadata } from "next";
import { PortfolioSlot } from "@/components/ClientOnly";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Portfolio · Voltswap",
  description: "See your Sui tokens and their estimated value in USD.",
};

export default function PortfolioPage() {
  return (
    <>
      <SiteHeader active="portfolio" />
      <main className="page-narrow">
        <h1 className="page-title">Your portfolio</h1>
        <p className="page-lead">Every token in your connected wallet, valued from live market quotes.</p>
        <PortfolioSlot />
      </main>
      <footer className="foot">
        <p>Balances are read from the public Sui network. This is not financial advice.</p>
        <nav aria-label="Legal">
          <a href="/terms">Terms of use</a>
          <a href="/risks">Risks</a>
        </nav>
      </footer>
    </>
  );
}
