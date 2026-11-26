import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteHeader";
import { MergePanel } from "@/components/MergePanel";

export const metadata: Metadata = {
  title: "Merge Sui Coins & Reclaim SUI",
  description:
    "Free Sui wallet cleaner: merge fragmented coin objects and burn zero-balance dust coins in one click to reclaim locked SUI storage rebates.",
};

export default function MergePage() {
  return (
    <>
      <SiteHeader active="merge" />
      <MergePanel />
    </>
  );
}
