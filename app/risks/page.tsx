import type { Metadata } from "next";
import { DocPage } from "@/components/DocPage";

export const metadata: Metadata = { title: "Risks · Voltswap" };

export default function Risks() {
  return (
    <DocPage title="Risks of swapping on Voltswap" updated="16 November 2026">
      <p>
        Swapping tokens on a blockchain carries risks that a bank or a card payment does not. Read
        this page before your first swap.
      </p>

      <h2>Transactions are final</h2>
      <p>
        Once a swap is confirmed on Sui, nobody can cancel or reverse it: not Voltswap, not your
        wallet, not the network. Check the tokens and the amounts before you sign.
      </p>

      <h2>Prices move</h2>
      <p>
        Token prices can change sharply within seconds. You may receive less than the quote, down
        to the minimum shown on the swap screen. Tokens with little liquidity move the most, and a
        large swap can move the price by itself.
      </p>

      <h2>Fake and worthless tokens</h2>
      <p>
        Anyone can create a token and give it the name of a well-known project. A token you add by
        address has not been checked by Voltswap. Compare the full coin address with the
        project&rsquo;s official site. Some tokens can be bought but not sold.
      </p>

      <h2>Smart contract risk</h2>
      <p>
        Swaps run through smart contracts written and operated by third parties. A bug or an attack
        in one of them can lead to a loss of funds, even if Voltswap itself works correctly.
      </p>

      <h2>Wallet security</h2>
      <p>
        Voltswap never asks for your recovery phrase or private key. Anyone who has them controls
        your funds. Make sure the address bar shows voltswap.org, and read each request in your
        wallet before approving it.
      </p>

      <h2>Network and service interruptions</h2>
      <p>
        The Sui network, the price sources or this site can slow down or be unavailable. A
        transaction can fail and still cost gas. Do not rely on being able to swap at a specific
        moment.
      </p>

      <h2>Law and taxes</h2>
      <p>
        Rules for crypto assets differ between countries and change often. A swap may be a taxable
        event where you live. You are responsible for knowing and following your local rules.
      </p>

      <h2>Only use what you can afford to lose</h2>
      <p>
        Crypto assets can lose most or all of their value. Do not swap money you need for living
        costs, and do not borrow to trade.
      </p>
    </DocPage>
  );
}
