export default function NotFound() {
  return (
    <>
      <header className="topbar">
        <a className="brand" href="/" aria-label="Voltswap home">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M13.5 2 5 13.5h6L10 22l9-12.5h-6.2L13.5 2Z" fill="currentColor" />
          </svg>
          Voltswap
        </a>
      </header>
      <main className="doc">
        <h1>Page not found</h1>
        <p>This address does not exist. Check the link, or go back to the swap.</p>
        <p>
          <a className="back" href="/">Back to swap</a>
        </p>
      </main>
    </>
  );
}
