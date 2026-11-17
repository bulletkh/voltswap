import { SwapSlot } from "@/components/ClientOnly";
import { SiteHeader } from "@/components/SiteHeader";
import { FEE_ENABLED, FEE_RATE } from "@/lib/config";

export default function Home() {
  return (
    <>
      <SiteHeader active="swap" />

      <main className="stage">
        <section className="intro">
          <span className="eyebrow">
            <i aria-hidden="true" />
            Live on Sui
          </span>
          <h1>One quote across every major Sui pool.</h1>
          <p>
            Voltswap splits your trade across liquidity pools and shows the exact route before you
            sign. It is non-custodial: your tokens never leave your wallet.
          </p>
          <p className="fine">
            {FEE_ENABLED
              ? `Fee: ${(FEE_RATE * 100).toFixed(2).replace(/\.?0+$/, "")}% of each swap, included in the quote.`
              : "No Voltswap fee is applied at the moment."}
          </p>
          <ul className="points">
            <li>Best route across pools</li>
            <li>Non-custodial</li>
            <li>Route shown before you sign</li>
          </ul>
          <svg className="route-art" viewBox="0 0 460 150" aria-hidden="true" focusable="false">
            <defs>
              <linearGradient id="vs-grad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#6f8dff" />
                <stop offset="1" stopColor="#ffd60a" />
              </linearGradient>
            </defs>
            <path className="rail" d="M40 75 C150 75 150 25 230 25 S330 75 420 75" />
            <path className="rail" d="M40 75 L420 75" />
            <path className="rail" d="M40 75 C150 75 150 125 230 125 S330 75 420 75" />
            <path className="flow" d="M40 75 C150 75 150 25 230 25 S330 75 420 75" />
            <path className="flow b" d="M40 75 L420 75" />
            <path className="flow c" d="M40 75 C150 75 150 125 230 125 S330 75 420 75" />
            <circle className="mid" cx="230" cy="25" r="5" />
            <circle className="mid" cx="230" cy="75" r="5" />
            <circle className="mid" cx="230" cy="125" r="5" />
            <circle className="node start" cx="40" cy="75" r="12" />
            <circle className="node end" cx="420" cy="75" r="12" />
            <text x="40" y="108" textAnchor="middle">YOU PAY</text>
            <text x="420" y="108" textAnchor="middle">YOU GET</text>
          </svg>
        </section>

        <SwapSlot />
      </main>

      <footer className="foot">
        <p>
          Swaps are executed on-chain and cannot be reversed. Token prices can move between quote
          and execution; slippage protection applies. This is not financial advice.
        </p>
        <nav aria-label="Legal">
          <a href="/terms">Terms of use</a>
          <a href="/risks">Risks</a>
        </nav>
      </footer>
    </>
  );
}
