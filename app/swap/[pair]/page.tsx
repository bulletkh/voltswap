import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Faqs, JsonLd, SeoShell } from "@/components/SeoPage";
import { BLURBS, PAIRS, SEO_UPDATED, SITE, pairBySlug } from "@/lib/seo";

export const dynamicParams = false;
export const generateStaticParams = () => PAIRS.map((p) => ({ pair: p.slug }));

type Props = { params: Promise<{ pair: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = pairBySlug((await params).pair);
  if (!p) return {};
  const title = `Swap ${p.from.symbol} to ${p.to.symbol} on Sui · best route`;
  const description = `Swap ${p.from.name} (${p.from.symbol}) for ${p.to.name} (${p.to.symbol}) on Sui at the best route across Sui exchanges. Non-custodial, quote before you sign.`;
  return {
    title,
    description,
    alternates: { canonical: `/swap/${p.slug}` },
    openGraph: { title, description, url: `${SITE}/swap/${p.slug}` },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PairPage({ params }: Props) {
  const p = pairBySlug((await params).pair);
  if (!p) notFound();
  const { from, to } = p;
  const faq = [
    {
      q: `How do I swap ${from.symbol} to ${to.symbol} on Sui?`,
      a: `Open Voltswap, connect your Sui wallet, pick ${from.symbol} as the token you pay and ${to.symbol} as the token you receive, enter an amount, check the quote and approve the transaction in your wallet.`,
    },
    {
      q: `What is the best rate for ${from.symbol} to ${to.symbol}?`,
      a: `The rate changes every few seconds with pool liquidity. Voltswap searches the major Sui exchanges for each quote and shows the route with the highest amount you receive.`,
    },
    {
      q: `Do I need SUI to swap ${from.symbol}?`,
      a: `Yes, a small amount. Network gas is paid in SUI, usually a fraction of a cent per swap.`,
    },
  ];
  const others = PAIRS.filter((x) => x.slug !== p.slug && (x.from.symbol === from.symbol || x.to.symbol === to.symbol)).slice(0, 6);
  return (
    <SeoShell crumbs={[{ name: "Voltswap", href: "/" }, { name: "Guides", href: "/guides" }, { name: `${from.symbol} to ${to.symbol}`, href: `/swap/${p.slug}` }]}>
      <JsonLd data={{ "@context": "https://schema.org", "@type": "WebPage", name: `Swap ${from.symbol} to ${to.symbol} on Sui`, url: `${SITE}/swap/${p.slug}`, dateModified: "2026-11-19" }} />
      <h1>Swap {from.symbol} to {to.symbol} on Sui</h1>
      <p className="doc-date">Last updated {SEO_UPDATED}</p>
      <p>
        Trade {from.name} for {to.name} straight from your wallet. Voltswap compares the Sui exchanges and shows the route that
        returns the most {to.symbol} before you sign anything.
      </p>
      <p><a className="mk-swap" href={`/?from=${from.symbol}&to=${to.symbol}`}>Swap {from.symbol} to {to.symbol}</a></p>
      <h2>About the two tokens</h2>
      <p>{BLURBS[from.symbol]}</p>
      <p>{BLURBS[to.symbol]}</p>
      <h2>How the swap works</h2>
      <p>
        Your {from.symbol} stays in your wallet until you approve the transaction. The swap runs as one atomic transaction: it either
        completes and sends {to.symbol} to your wallet, or fails and leaves everything as it was. You set a slippage limit and see the
        minimum {to.symbol} you will receive before you sign.
      </p>
      <p>
        Costs are network gas in SUI, the fee of each pool on the route, and Voltswap&apos;s fee, which is shown on the swap screen.
        Read <a href="/guides/sui-swap-fees">what a swap on Sui really costs</a> and{" "}
        <a href="/guides/sui-slippage-explained">how slippage works</a> before a large trade.
      </p>
      <Faqs items={faq} />
      <h2>More swaps</h2>
      <ul>
        {others.map((x) => (
          <li key={x.slug}><a href={`/swap/${x.slug}`}>Swap {x.from.symbol} to {x.to.symbol}</a></li>
        ))}
        <li><a href={`/token/${to.symbol}`}>{to.name} price and chart</a></li>
        <li><a href="/guides/how-to-swap-on-sui">How to swap on Sui</a></li>
      </ul>
      <p className="doc-date">Not financial advice. See <a href="/risks">Risks</a>.</p>
    </SeoShell>
  );
}
