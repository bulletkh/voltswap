import type { Metadata } from "next";
import { OwnerSlot } from "@/components/ClientOnly";
import { SiteHeader } from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Cabinet · Voltswap",
  robots: { index: false, follow: false },
};

export default function OwnerPage() {
  return (
    <>
      <SiteHeader active="owner" />
      <main className="page-narrow page-wide">
        <h1 className="page-title">Cabinet</h1>
        <p className="page-lead">Fees, volume and wallets, read from the chain.</p>
        <OwnerSlot />
      </main>
    </>
  );
}
