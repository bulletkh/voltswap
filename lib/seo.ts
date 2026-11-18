import { TOKENS, type Token } from "./tokens";

export const SITE = "https://voltswap.org";
export const SEO_UPDATED = "19 November 2026";

/** One-paragraph plain descriptions for the tokens we write pair pages about. */
export const BLURBS: Record<string, string> = {
  SUI: "SUI is the native token of the Sui network. You need a little of it in every wallet to pay network gas, and it is the base asset most Sui pools are priced against.",
  USDC: "USDC is a dollar stablecoin issued natively on Sui by Circle. It is the most common way to hold a dollar value on Sui and the deepest stable pool against SUI.",
  suiUSDT: "suiUSDT is Tether's dollar stablecoin bridged to Sui. It trades against SUI and USDC and is useful when a protocol or exchange asks for USDT.",
  CETUS: "CETUS is the token of Cetus, one of the largest exchanges on Sui. Its liquidity sits mostly in CETUS/SUI and CETUS/USDC pools.",
  DEEP: "DEEP is the token of DeepBook, Sui's on-chain order book. It is used to pay trading fees on DeepBook and has its own pools on several Sui exchanges.",
  WAL: "WAL is the token of Walrus, a decentralized storage network built on Sui. It is used to pay for storage and to stake with storage nodes.",
  NAVX: "NAVX is the token of NAVI Protocol, a lending market on Sui.",
  haSUI: "haSUI is Haedal's liquid staking token. It represents staked SUI that keeps earning staking rewards while you hold it.",
  vSUI: "vSUI is Volo's liquid staking token. It represents staked SUI that keeps earning staking rewards while you hold it.",
  suiETH: "suiETH is Ether bridged to Sui, so you can hold ETH exposure on Sui without leaving the network.",
  suiWBTC: "suiWBTC is wrapped Bitcoin bridged to Sui, so you can hold BTC exposure on Sui without leaving the network.",
};

const slugOf = (s: string) => s.toLowerCase();
const find = (sym: string): Token | undefined => TOKENS.find((t) => t.symbol === sym);

const PAIR_SYMBOLS = ["USDC", "suiUSDT", "CETUS", "DEEP", "WAL", "NAVX", "haSUI", "vSUI", "suiETH", "suiWBTC"];

export type Pair = { slug: string; from: Token; to: Token };

function build(): Pair[] {
  const out: Pair[] = [];
  const sui = find("SUI");
  if (!sui) return out;
  for (const s of PAIR_SYMBOLS) {
    const t = find(s);
    if (!t) continue;
    out.push({ slug: `${slugOf("SUI")}-to-${slugOf(s)}`, from: sui, to: t });
    out.push({ slug: `${slugOf(s)}-to-${slugOf("SUI")}`, from: t, to: sui });
  }
  const usdc = find("USDC");
  const usdt = find("suiUSDT");
  if (usdc && usdt) {
    out.push({ slug: "usdc-to-suiusdt", from: usdc, to: usdt });
    out.push({ slug: "suiusdt-to-usdc", from: usdt, to: usdc });
  }
  return out;
}

export const PAIRS: Pair[] = build();
export const pairBySlug = (slug: string) => PAIRS.find((p) => p.slug === slug);

export type Faq = { q: string; a: string };
export type Section = { h: string; p: string[] };
export type Guide = {
  slug: string;
  title: string;
  h1: string;
  description: string;
  intro: string;
  sections: Section[];
  faq: Faq[];
  related: string[];
};

export const GUIDES: Guide[] = [
  {
    slug: "how-to-swap-on-sui",
    title: "How to swap tokens on Sui: a step-by-step guide",
    h1: "How to swap tokens on Sui",
    description:
      "Learn how to swap tokens on Sui in a few minutes: connect a wallet, pick two tokens, check the quote and slippage, and sign. A plain guide for first-time users.",
    intro:
      "Swapping on Sui means trading one token for another straight from your own wallet, with no account and no deposit. This guide walks through the whole process and the checks worth doing before you sign.",
    sections: [
      {
        h: "What you need before you start",
        p: [
          "A Sui wallet such as Slush, Suiet, Phantom or Backpack, with the tokens you want to trade. You also need a small amount of SUI in the same wallet to pay network gas. A typical swap costs a fraction of a cent in gas, so a dollar or two of SUI lasts a long time.",
          "Nothing is deposited anywhere. A swap is a single transaction that leaves your wallet with the tokens you asked for.",
        ],
      },
      {
        h: "Step by step",
        p: [
          "1. Open Voltswap and connect your wallet. Connecting only lets the site see your address and ask you to sign; it cannot move funds on its own.",
          "2. Choose the token you pay with and the token you want to receive. Enter an amount, or press Max to use your whole balance (Voltswap keeps a little SUI back for gas).",
          "3. Wait for the quote. Voltswap checks the major Sui exchanges and shows the route with the best result, the expected amount you receive and the minimum you are guaranteed.",
          "4. Review the numbers: the receive amount, the price impact, the fee and the slippage limit. If something looks off, change the amount or the slippage and the quote refreshes.",
          "5. Press Swap and approve the transaction in your wallet. It confirms in a second or two, and the new tokens appear in your wallet.",
        ],
      },
      {
        h: "What slippage means",
        p: [
          "Prices can move between the moment you see a quote and the moment your transaction runs. Slippage is the largest move you accept. If the price moves further than that, the transaction fails instead of giving you a worse deal, and you only lose the small gas fee. For major tokens like SUI and USDC, 0.5% is usually enough. Thin tokens may need more, but a high limit also leaves room for a bad fill.",
        ],
      },
      {
        h: "Checks that protect you",
        p: [
          "Compare the token symbol and full coin address when you add a token that is not on the default list, because anyone can create a token with a famous name. Start with a small amount the first time you use a new token. Never sign a transaction you did not start, and never share your recovery phrase with anyone.",
        ],
      },
    ],
    faq: [
      {
        q: "Do I need an account to swap on Sui?",
        a: "No. You connect a wallet, sign one transaction and the tokens arrive in the same wallet. There is nothing to register and nothing is held for you.",
      },
      {
        q: "How much does it cost to swap on Sui?",
        a: "You pay network gas, usually a fraction of a cent, plus the trading fees of the pools your swap passes through. Voltswap shows its own fee on the swap screen before you sign.",
      },
      {
        q: "Why did my swap fail?",
        a: "The most common reason is that the price moved past your slippage limit before the transaction ran. Other reasons are too little SUI left for gas or a quote that went stale. Refresh the quote and try again.",
      },
      {
        q: "Can I cancel a swap after I sign it?",
        a: "No. A confirmed transaction on Sui is final. Check the tokens and amounts before you press approve.",
      },
    ],
    related: ["best-sui-swap", "sui-slippage-explained", "sui-swap-fees"],
  },
  {
    slug: "best-sui-swap",
    title: "Best way to swap on Sui: how a DEX aggregator finds the best price",
    h1: "How to get the best price when you swap on Sui",
    description:
      "Why the same swap can cost different amounts on different Sui exchanges, how aggregators split orders across pools, and what to compare before you trade.",
    intro:
      "Sui has several large exchanges and many smaller pools. The same trade can return noticeably different amounts depending on where it runs. An aggregator closes that gap by searching all of them for you.",
    sections: [
      {
        h: "Why prices differ between exchanges",
        p: [
          "Every pool prices a trade from its own reserves. A pool with deep liquidity barely moves when you trade, while a shallow pool moves a lot. Two pools holding the same pair can also sit at slightly different prices until traders arbitrage them back together, which is why a quote on one exchange is rarely the best available.",
        ],
      },
      {
        h: "What an aggregator does",
        p: [
          "A DEX aggregator reads the pools of many exchanges, tests different routes and splits a large order across several pools so that each one is only pushed a little. A route can also go through an intermediate token, for example SUI to USDC to a smaller token, when that ends up cheaper than a direct pool. You sign one transaction and the whole route runs atomically: either every step succeeds or nothing happens.",
          "Voltswap uses this approach on Sui and shows the route it picked, so you can see which pools your trade passes through.",
        ],
      },
      {
        h: "What to compare",
        p: [
          "Look at the amount you receive, not at the quoted price alone, because fees and price impact are already inside it. Compare the minimum received, which shows the worst case your slippage limit allows. For large trades, check the price impact. If it is high, splitting the trade into two or three smaller ones over a few minutes can help.",
          "Also compare the fee the interface adds. Voltswap shows its fee on the swap screen before you sign, so there is nothing hidden in the quote.",
        ],
      },
      {
        h: "Staying safe",
        p: [
          "An aggregator only routes your trade; the tokens stay in your wallet and the swap runs through audited exchange contracts. You are still responsible for the tokens you pick, so verify the coin address of anything outside the default list.",
        ],
      },
    ],
    faq: [
      {
        q: "Is an aggregator better than swapping on a single exchange?",
        a: "Usually it returns the same or more, because it can use that exchange's pool and others at the same time. For tiny trades in the deepest pools the difference can be negligible.",
      },
      {
        q: "Does Voltswap hold my tokens?",
        a: "No. Voltswap is non-custodial. Your tokens stay in your wallet until the swap transaction you sign runs.",
      },
      {
        q: "Which Sui exchanges does Voltswap search?",
        a: "It searches the major Sui exchanges and order books through a routing engine and picks the best result for each quote.",
      },
    ],
    related: ["how-to-swap-on-sui", "sui-slippage-explained", "sui-swap-fees"],
  },
  {
    slug: "sui-slippage-explained",
    title: "Slippage on Sui explained: what to set and why swaps fail",
    h1: "Slippage on Sui, explained",
    description:
      "What slippage and price impact mean when you swap on Sui, what setting to use for major and thin tokens, and why a swap fails when the price moves.",
    intro:
      "Slippage is the difference between the price you expect and the price you get. Understanding it takes two minutes and saves you from both failed swaps and bad fills.",
    sections: [
      {
        h: "Slippage vs price impact",
        p: [
          "Price impact is the move caused by your own trade: the bigger the trade compared with the pool, the more the price shifts against you. Slippage is the extra move that happens because other traders act while your transaction is waiting. Price impact is known in the quote; slippage is the buffer you allow for the unknown.",
        ],
      },
      {
        h: "What to set",
        p: [
          "For SUI, USDC and other deep pairs, 0.5% is a sensible default. For small or volatile tokens, 1% to 3% may be needed for the swap to go through. Avoid very high limits: the swap will succeed, but a bot can push the price and take the difference, which is called a sandwich attack.",
        ],
      },
      {
        h: "Why a swap fails",
        p: [
          "If the final amount would be lower than your minimum received, the transaction reverts and you only pay the gas fee. That is the protection working as intended. Refresh the quote, and raise the limit slightly only if the token is volatile.",
        ],
      },
    ],
    faq: [
      {
        q: "What slippage should I use on Sui?",
        a: "0.5% for major pairs like SUI and USDC. Go up to 1–3% for thin or fast-moving tokens, and be careful above that.",
      },
      {
        q: "Do I lose money when a swap fails?",
        a: "You lose only the network gas fee, which is a fraction of a cent on Sui. Your tokens stay in your wallet.",
      },
    ],
    related: ["how-to-swap-on-sui", "best-sui-swap", "sui-swap-fees"],
  },
  {
    slug: "sui-swap-fees",
    title: "Sui swap fees: gas, pool fees and interface fees",
    h1: "What a swap on Sui really costs",
    description:
      "The three costs of a Sui swap: network gas, the trading fee of each pool, and the interface fee. How to read them in a quote and how to keep them low.",
    intro:
      "A swap on Sui has up to three cost layers. Knowing which is which makes quotes easy to compare.",
    sections: [
      {
        h: "Network gas",
        p: [
          "Every transaction pays gas in SUI. On Sui this is usually a fraction of a cent for a swap, and it does not depend on the size of your trade. You need a small SUI balance in your wallet even if you are trading other tokens.",
        ],
      },
      {
        h: "Pool fees",
        p: [
          "Each pool takes a fee from the trade, set by the pool: commonly from 0.01% on stable pairs up to 1% on volatile ones. These fees are already included in the amount you receive. A route through two pools pays two pool fees, which the aggregator weighs against the better price it finds.",
        ],
      },
      {
        h: "Interface fee",
        p: [
          "Some interfaces add their own fee on top. Voltswap charges a fee on each swap and shows the rate on the swap screen before you sign, taken from the tokens you receive. The quote you see is what lands in your wallet.",
        ],
      },
      {
        h: "Keeping costs low",
        p: [
          "Trade in deep pairs, avoid very small trades where fixed costs matter more, and split very large trades. Compare the final receive amount, not the headline price.",
        ],
      },
    ],
    faq: [
      {
        q: "Why is my received amount lower than price × amount?",
        a: "Pool fees, price impact and the interface fee are all taken from the amount you receive. The quote already includes them.",
      },
      {
        q: "Do I need SUI to swap other tokens?",
        a: "Yes. Gas is always paid in SUI, so keep a small balance in your wallet.",
      },
    ],
    related: ["how-to-swap-on-sui", "best-sui-swap", "sui-slippage-explained"],
  },
];

export const guideBySlug = (slug: string) => GUIDES.find((g) => g.slug === slug);
