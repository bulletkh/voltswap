import type { Metadata } from "next";
import { PortfolioSlot } from "@/components/ClientOnly";
import { SiteHeader } from "@/components/SiteHeader";
import { X_URL } from "@/lib/config";

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
          <a className="foot-x" href={X_URL} target="_blank" rel="noopener noreferrer">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            @voltswap
          </a>
          <a href="/terms">Terms of use</a>
          <a href="/risks">Risks</a>
        </nav>
      </footer>
    </>
  );
}
