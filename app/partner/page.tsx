import type { Metadata } from "next";
import { PartnerSlot } from "@/components/ClientOnly";
import { SiteHeader } from "@/components/SiteHeader";
import { X_URL } from "@/lib/config";

export const metadata: Metadata = {
  title: "Ranks & Partner Program · Voltswap",
  description:
    "Climb Voltswap trader ranks for up to 100% fee rebates and earn 25–50% instant on-chain Sui referral rev-share.",
};

export default function PartnerPage() {
  return (
    <>
      <SiteHeader active="partner" />
      <main className="page-narrow page-wide">
        <h1 className="page-title">Ranks &amp; Partner Program</h1>
        <p className="page-lead">
          Volume-based glowing ranks down to 0.00% fee, plus 25%–50% instant on-chain referral payouts on Sui.
        </p>
        <PartnerSlot />
      </main>
      <footer className="foot">
        <p>All volumes and partner payouts settle on-chain on Sui. This is not financial advice.</p>
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
