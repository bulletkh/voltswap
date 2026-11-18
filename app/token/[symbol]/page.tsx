import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/SiteHeader";
import { TokenSlot } from "@/components/ClientOnly";
import { TOKENS } from "@/lib/tokens";
import { BLURBS, PAIRS } from "@/lib/seo";

export const dynamicParams = false;

export function generateStaticParams() {
  return TOKENS.map((t) => ({ symbol: t.symbol }));
}

type Props = { params: Promise<{ symbol: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const t = TOKENS.find((x) => x.symbol === decodeURIComponent(symbol));
  if (!t) return {};
  return {
    title: `${t.name} (${t.symbol}) price and swap · Voltswap`,
    description: `Live ${t.symbol} price, 30-day chart and large swaps on Sui. Swap ${t.name} at the best route across Sui exchanges.`,
    alternates: { canonical: `/token/${t.symbol}` },
    openGraph: { title: `${t.name} (${t.symbol}) · Voltswap`, description: `Live ${t.symbol} price and swap on Sui.`, url: `https://voltswap.org/token/${t.symbol}` },
    twitter: { card: "summary_large_image", title: `${t.name} (${t.symbol}) · Voltswap` },
  };
}

export default async function TokenPage({ params }: Props) {
  const { symbol } = await params;
  const token = TOKENS.find((x) => x.symbol === decodeURIComponent(symbol));
  if (!token) notFound();
  return (
    <>
      <SiteHeader active="market" />
      <main className="page-narrow">
        <TokenSlot token={token} />
        <section className="doc-date" style={{ marginTop: 24 }}>
          <h2 style={{ font: "700 18px/1.25 var(--display)", margin: "0 0 8px" }}>About {token.name} ({token.symbol})</h2>
          <p>
            {BLURBS[token.symbol] ?? `${token.name} (${token.symbol}) is a token on the Sui network.`} Voltswap shows its live price,
            a 30-day chart and recent large swaps, and lets you swap it at the best route across Sui exchanges.
          </p>
          <p>
            {PAIRS.filter((p) => p.from.symbol === token.symbol || p.to.symbol === token.symbol).slice(0, 4).map((p) => (
              <span key={p.slug}><a href={`/swap/${p.slug}`}>Swap {p.from.symbol} to {p.to.symbol}</a>{" · "}</span>
            ))}
            <a href="/guides/how-to-swap-on-sui">How to swap on Sui</a>
          </p>
        </section>
      </main>
      <footer className="foot">
        <p>Market data is informational only. This is not financial advice.</p>
        <nav aria-label="Guides">
          <a href="/guides">Guides</a>
          <a href="/guides/how-to-swap-on-sui">How to swap on Sui</a>
          <a href="/swap/sui-to-usdc">SUI to USDC</a>
        </nav>
        <nav aria-label="Legal">
          <a href="/terms">Terms of use</a>
          <a href="/risks">Risks</a>
        </nav>
      </footer>
    </>
  );
}
