import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { MergePanel } from "@/components/MergePanel";
import { TG_URL, X_URL } from "@/lib/config";

export const metadata: Metadata = {
  title: "Merge Sui Coins & Reclaim SUI · Voltswap",
  description:
    "Free Sui wallet cleaner: merge fragmented coin objects and burn zero-balance dust coins in one click to reclaim locked SUI storage rebates.",
};

export default function MergePage() {
  return (
    <>
      <SiteHeader active="merge" />
      <main className="page-narrow">
        <h1 className="page-title">Merge Coins & Reclaim SUI</h1>
        <p className="page-lead">
          Consolidate fragmented coin objects and destroy empty dust coins in one transaction (0% fee) to reclaim locked SUI storage rebates.
        </p>
        <MergePanel />
      </main>
      <footer className="foot">
        <p>Coins are read from the public Sui network. Non-custodial, 0% Voltswap fee.</p>
        <nav aria-label="Legal">
          <a className="foot-x" href={TG_URL} target="_blank" rel="noopener noreferrer">Telegram</a>
          <a className="foot-x" href={X_URL} target="_blank" rel="noopener noreferrer">X</a>
          <a href="/terms">Terms</a>
          <a href="/risks">Risks</a>
        </nav>
      </footer>
    </>
  );
}
