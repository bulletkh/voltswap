import { PriceChart } from "@/components/PriceChart";
import { SwapSlot } from "@/components/ClientOnly";
import { SiteHeader } from "@/components/SiteHeader";
import { Ticker } from "@/components/Ticker";
import { FEE_ENABLED, FEE_RATE } from "@/lib/config";

const fee = (FEE_RATE * 100).toFixed(2).replace(/\.?0+$/, "");

const PERKS = [
  {
    title: "Best route, found for you",
    text: "Your trade is split across Sui's major pools to get the best rate available.",
    icon: "M4 12h4l3-8 4 16 3-8h2",
  },
  {
    title: "See it before you sign",
    text: "The exact route and the minimum you receive are shown before you confirm.",
    icon: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  },
  {
    title: "Your tokens stay yours",
    text: "Non-custodial. Swaps run from your wallet and tokens never leave it.",
    icon: "M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Zm-3 9 2 2 4-4",
  },
  {
    title: FEE_ENABLED ? `One fee: ${fee}%` : "No Voltswap fee",
    text: FEE_ENABLED ? "Already included in the quote you see, so the number you confirm is the number you get." : "No Voltswap fee is applied at the moment.",
    icon: "M12 2v20M17 6.5C16 5 14 4.5 12 4.5c-2.5 0-4.5 1.2-4.5 3.2 0 4.3 9 2.3 9 6.6 0 2-2 3.2-4.5 3.2-2.2 0-4.2-.7-5.2-2.3",
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader active="swap" />
      <Ticker />

      <main className="stage">
        <section className="intro">
          <span className="eyebrow">
            <i aria-hidden="true" />
            Live on Sui
          </span>
          <h1>Swap on Sui at the best price.</h1>
          <p className="lede">Voltswap checks every major pool and splits your trade for the best rate.</p>
        </section>

        <SwapSlot />
      </main>

      <div className="pc-wrap">
        <PriceChart />
      </div>

      <section className="perks" aria-label="Why Voltswap">
        {PERKS.map((p) => (
          <article key={p.title} className="perk">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={p.icon} />
            </svg>
            <h2>{p.title}</h2>
            <p>{p.text}</p>
          </article>
        ))}
      </section>

      <footer className="foot">
        <p>
          Swaps are executed on-chain and cannot be reversed. Token prices can move between quote
          and execution; slippage protection applies. This is not financial advice.
        </p>
        <nav aria-label="Guides">
          <a href="/guides">Guides</a>
          <a href="/guides/how-to-swap-on-sui">How to swap on Sui</a>
          <a href="/swap/sui-to-usdc">SUI to USDC</a>
        </nav>
        <nav aria-label="Legal">
          <a href="/terms">Terms of use</a>
          <a href="/risks">Risks</a>
        </nav>
      </footer>
    </>
  );
}
