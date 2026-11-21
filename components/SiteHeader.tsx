import "@/app/nav-portfolio.css";
import { TG_URL, X_URL } from "@/lib/config";
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
          href={TG_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Voltswap Telegram & Whale Alerts"
          title="Voltswap Telegram & Whale Alerts (@voltswap_org)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
          </svg>
        </a>
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
