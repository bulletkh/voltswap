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
          <a href="/terms">Terms of use</a>
          <a href="/risks">Risks</a>
        </nav>
      </footer>
    </>
  );
}
