import type { Metadata } from "next";
import { SeoShell } from "@/components/SeoPage";
import { GUIDES, PAIRS } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Sui swap guides: how to swap, slippage, fees",
  description: "Plain guides to swapping tokens on Sui: how to swap, how to get the best price, slippage and fees, plus pages for the most traded pairs.",
  alternates: { canonical: "/guides" },
};

export default function Guides() {
  return (
    <SeoShell crumbs={[{ name: "Voltswap", href: "/" }, { name: "Guides", href: "/guides" }]}>
      <h1>Sui swap guides</h1>
      <p>Short, practical explanations for swapping tokens on Sui.</p>
      <ul>
        {GUIDES.map((g) => (
          <li key={g.slug}><a href={`/guides/${g.slug}`}>{g.h1}</a></li>
        ))}
      </ul>
      <h2>Popular swaps</h2>
      <ul>
        {PAIRS.map((p) => (
          <li key={p.slug}><a href={`/swap/${p.slug}`}>Swap {p.from.symbol} to {p.to.symbol}</a></li>
        ))}
      </ul>
    </SeoShell>
  );
}
