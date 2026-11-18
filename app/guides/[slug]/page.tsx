import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Faqs, JsonLd, SeoShell } from "@/components/SeoPage";
import { GUIDES, SEO_UPDATED, SITE, guideBySlug } from "@/lib/seo";

export const dynamicParams = false;
export const generateStaticParams = () => GUIDES.map((g) => ({ slug: g.slug }));

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const g = guideBySlug((await params).slug);
  if (!g) return {};
  return {
    title: g.title,
    description: g.description,
    alternates: { canonical: `/guides/${g.slug}` },
    openGraph: { title: g.title, description: g.description, url: `${SITE}/guides/${g.slug}`, type: "article" },
    twitter: { card: "summary_large_image", title: g.title, description: g.description },
  };
}

export default async function Guide({ params }: Props) {
  const g = guideBySlug((await params).slug);
  if (!g) notFound();
  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: g.h1,
    description: g.description,
    dateModified: "2026-11-19",
    mainEntityOfPage: `${SITE}/guides/${g.slug}`,
    author: { "@type": "Organization", name: "Voltswap", url: SITE },
    publisher: { "@type": "Organization", name: "Voltswap", url: SITE },
  };
  return (
    <SeoShell crumbs={[{ name: "Voltswap", href: "/" }, { name: "Guides", href: "/guides" }, { name: g.h1, href: `/guides/${g.slug}` }]}>
      <JsonLd data={article} />
      <h1>{g.h1}</h1>
      <p className="doc-date">Last updated {SEO_UPDATED}</p>
      <p>{g.intro}</p>
      <p><a className="mk-swap" href="/">Open the swap</a></p>
      {g.sections.map((s) => (
        <section key={s.h}>
          <h2>{s.h}</h2>
          {s.p.map((t) => <p key={t}>{t}</p>)}
        </section>
      ))}
      <Faqs items={g.faq} />
      <h2>Keep reading</h2>
      <ul>
        {g.related.map((r) => {
          const x = guideBySlug(r);
          return x ? <li key={r}><a href={`/guides/${r}`}>{x.h1}</a></li> : null;
        })}
        <li><a href="/swap/sui-to-usdc">Swap SUI to USDC</a></li>
      </ul>
      <p className="doc-date">Not financial advice. See <a href="/risks">Risks</a>.</p>
    </SeoShell>
  );
}
