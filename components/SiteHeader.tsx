import "@/app/nav-portfolio.css";
import { ConnectSlot } from "./ClientOnly";

export function SiteHeader({ active }: { active: "swap" | "market" | "portfolio" | "whales" }) {
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
      </nav>
      <ConnectSlot />
    </header>
  );
}
