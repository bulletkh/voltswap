import { X_URL } from "@/lib/config";

export function DocPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Voltswap home">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M13.5 2 5 13.5h6L10 22l9-12.5h-6.2L13.5 2Z" fill="currentColor" />
          </svg>
          Voltswap
        </a>
        <a className="back" href="/">Back to swap</a>
      </header>
      <main className="doc">
        <h1>{title}</h1>
        <p className="doc-date">Last updated {updated}</p>
        {children}
      </main>
      <footer className="foot">
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
