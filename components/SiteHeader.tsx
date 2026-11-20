import "@/app/nav-portfolio.css";
import { X_URL } from "@/lib/config";
import { ConnectSlot } from "./ClientOnly";

export function SiteHeader({ active }: { active: "swap" | "market" | "portfolio" | "whales" | "partner" | "owner" }) {
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="Voltswap home">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M13.5 2 5 13.5h6L10 22l9-12.5h-6.2L13.5 2Z" fill="currentColor" />
        </svg>
        <span className="brand-name"><b>Volt</b>swap</span>
      </a>
      <nav className="topnav" aria-label="Main">
        <a href="/" aria-current={active === "swap" ? "page" : undefined}>Swap</a>
        <a href="/whales" aria-current={active === "whales" ? "page" : undefined}>Radar</a>
        <a href="/market" aria-current={active === "market" ? "page" : undefined}>Market</a>
        <a href="/portfolio" aria-current={active === "portfolio" ? "page" : undefined}>Portfolio</a>
        <a href="/partner" aria-current={active === "partner" ? "page" : undefined}>Partner</a>
      </nav>
      <div className="topbar-actions">
        <a
          className="x-link"
          href={X_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Voltswap on X"
          title="Voltswap on X (@voltswap)"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </a>
        <ConnectSlot />
      </div>
    </header>
  );
}
