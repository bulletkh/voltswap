import { TG_URL, X_URL } from "@/lib/config";
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
          <a className="foot-x" href={TG_URL} target="_blank" rel="noopener noreferrer">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
            </svg>
            Telegram
          </a>
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
