import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { WhalesView } from "@/components/WhalesView";

export const metadata: Metadata = {
  title: "Whale radar · Voltswap",
  description: "Large swaps on Sui in the last hour, live.",
};

export default function WhalesPage() {
  return (
    <>
      <SiteHeader active="whales" />
      <main className="page-narrow">
        <h1 className="page-title">Whale radar</h1>
        <p className="page-lead">Large swaps on Sui, live. Free and read-only.</p>
        <WhalesView />
      </main>
      <footer className="foot">
        <p>Public on-chain data, informational only. This is not financial advice.</p>
        <nav aria-label="Legal">
          <a href="/terms">Terms of use</a>
          <a href="/risks">Risks</a>
        </nav>
      </footer>
    </>
  );
}
