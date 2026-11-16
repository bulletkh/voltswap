export type Token = {
  symbol: string;
  name: string;
  type: string;
  decimals: number;
  iconUrl?: string | null;
  /** true = added by the user by address, not on Voltswap's list */
  custom?: boolean;
};

export const SUI_TYPE = "0x2::sui::SUI";
export const USDC_TYPE =
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
export const USDT_TYPE =
  "0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT";

export const TOKENS: Token[] = [
  { symbol: "SUI", name: "Sui", type: SUI_TYPE, decimals: 9, iconUrl: "/sui-icon.svg" },
  { symbol: "USDC", name: "USD Coin", type: USDC_TYPE, decimals: 6 },
  { symbol: "suiUSDT", name: "Tether (Sui)", type: USDT_TYPE, decimals: 6 },
  {
    symbol: "CETUS",
    name: "Cetus",
    type: "0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS",
    decimals: 9,
  },
  {
    symbol: "DEEP",
    name: "DeepBook",
    type: "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP",
    decimals: 6,
  },
  {
    symbol: "WAL",
    name: "Walrus",
    type: "0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL",
    decimals: 9,
  },
];

const COIN_TYPE_RE = /^0x[0-9a-fA-F]{1,64}::[A-Za-z_][A-Za-z0-9_]*::[A-Za-z_][A-Za-z0-9_]*$/;

export function isCoinType(s: string): boolean {
  return COIN_TYPE_RE.test(s.trim());
}

const STORE_KEY = "voltswap:custom-tokens";

export function loadCustomTokens(): Token[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as Token[];
    return list
      .filter((t) => t && isCoinType(t.type) && typeof t.symbol === "string" && Number.isInteger(t.decimals))
      .map((t) => ({ ...t, custom: true }));
  } catch {
    return [];
  }
}

export function saveCustomTokens(list: Token[]) {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, 50)));
  } catch {
    /* storage unavailable: tokens stay for this visit only */
  }
}
