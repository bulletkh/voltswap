import { X_URL } from "@/lib/config";
import { SiteHeader } from "./SiteHeader";

export type Crumb = { name: string; href: string };

export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

export function SeoShell({ crumbs, children }: { crumbs: Crumb[]; children: React.ReactNode }) {
  const list = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: "https://voltswap.org" + c.href,
    })),
  };
  return (
    <>
      <SiteHeader active="swap" />
      <JsonLd data={list} />
      <main className="doc">
        <nav aria-label="Breadcrumb" className="doc-date">
          {crumbs.map((c, i) => (
            <span key={c.href}>
              {i > 0 ? " / " : ""}
              {i < crumbs.length - 1 ? <a href={c.href}>{c.name}</a> : c.name}
            </span>
          ))}
        </nav>
        {children}
      </main>
      <footer className="foot">
        <nav aria-label="Guides">
          <a href="/guides">Guides</a>
          <a href="/market">Market</a>
          <a href="/whales">Radar</a>
        </nav>
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

export function Faqs({ items }: { items: { q: string; a: string }[] }) {
  const ld = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  return (
    <section>
      <JsonLd data={ld} />
      <h2>Frequently asked questions</h2>
      {items.map((f) => (
        <div key={f.q}>
          <h3 style={{ font: "600 16px/1.3 var(--display)", margin: "16px 0 4px" }}>{f.q}</h3>
          <p>{f.a}</p>
        </div>
      ))}
    </section>
  );
}
