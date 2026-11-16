import type { Metadata } from "next";
import { DocPage } from "@/components/DocPage";

export const metadata: Metadata = { title: "Terms of use · Voltswap" };

export default function Terms() {
  return (
    <DocPage title="Terms of use" updated="16 November 2026">
      <h2>What Voltswap is</h2>
      <p>
        Voltswap is a web interface for swapping tokens on the Sui blockchain. It finds a route
        across third-party liquidity pools and prepares a transaction for you to review and sign in
        your own wallet. Voltswap does not run those pools and is not a party to your trade.
      </p>

      <h2>You keep control of your funds</h2>
      <p>
        Voltswap is non-custodial. It never holds your tokens, your private keys or your recovery
        phrase, and it cannot move funds without a transaction that you sign. You are responsible
        for keeping your wallet secure and for every transaction you approve.
      </p>

      <h2>Fees</h2>
      <p>
        Voltswap charges a fee on each swap. The current rate is shown on the swap screen before
        you sign and is taken from the tokens you receive. Network gas and the fees of the
        underlying liquidity pools are separate and are set by those networks and protocols.
      </p>

      <h2>Quotes are estimates</h2>
      <p>
        The amount shown before you sign is a quote, not a guarantee. The final amount depends on
        market conditions when the transaction executes. Your slippage setting defines the minimum
        you accept; if the market moves further than that, the transaction fails and no swap
        happens.
      </p>

      <h2>Who may use Voltswap</h2>
      <p>
        You may use Voltswap only if doing so is legal where you live and you are old enough to
        enter a binding agreement there. You are responsible for following the laws and tax rules
        that apply to you. Do not use Voltswap if you are subject to sanctions or located in a
        place where this kind of service is prohibited.
      </p>

      <h2>Tokens</h2>
      <p>
        A token appearing in Voltswap, including any token you add by address, is not an
        endorsement or a recommendation. Anyone can create a token on Sui. Check what you are
        trading before you trade it.
      </p>

      <h2>No advice</h2>
      <p>
        Nothing on Voltswap is financial, investment, legal or tax advice. Dollar values shown next
        to amounts are approximate and for orientation only.
      </p>

      <h2>No warranty and limits of liability</h2>
      <p>
        Voltswap is provided as is, without warranties of any kind. It relies on third-party
        networks, smart contracts, price sources and wallets that Voltswap does not control and
        that can fail or change. To the extent the law allows, Voltswap is not liable for losses
        that result from using the interface, from those third parties, from market movements or
        from transactions you signed.
      </p>

      <h2>Changes</h2>
      <p>
        These terms may be updated. The date at the top shows the latest version. Continuing to use
        Voltswap after a change means you accept the updated terms.
      </p>
    </DocPage>
  );
}
