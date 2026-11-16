import { SwapSlot } from "@/components/ClientOnly";
import { SiteHeader } from "@/components/SiteHeader";
import { FEE_ENABLED, FEE_RATE } from "@/lib/config";

export default function Home() {
  return (
    <>
      <SiteHeader active="swap" />

      <main className="stage">
        <section className="intro">
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
