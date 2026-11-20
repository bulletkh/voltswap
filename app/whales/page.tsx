import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { WhalesView } from "@/components/WhalesView";
import { X_URL } from "@/lib/config";

export const metadata: Metadata = {
  title: "Whale radar · Voltswap",
  description: "Large swaps on Sui in the last hour, live.",
};

export default function WhalesPage() {
  return (
    <>
      <SiteHeader active="whales" />
      <main className="page-narrow page-wide">
        <h1 className="page-title">Whale radar</h1>
        <p className="page-lead">Large swaps on Sui, live. Free and read-only.</p>
        <WhalesView />
      </main>
      <footer className="foot">
        <p>Public on-chain data, informational only. This is not financial advice.</p>
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
