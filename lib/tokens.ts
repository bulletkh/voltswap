export type Token = {
  symbol: string;
  name: string;
  type: string;
  decimals: number;
  iconUrl?: string | null;
  /** token whose on-chain icon is reused when this token has none */
  iconFrom?: string;
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
  {
    symbol: "USDY",
    name: "Ondo US Dollar Yield",
    type: "0x960b531667636f39e85867775f52f6b1f220a058c4de786905bdf761e06a56bb::usdy::USDY",
    decimals: 6,
  },
  {
    symbol: "WBTC",
    name: "Wrapped Bitcoin",
    type: "0x0041f9f9344cac094454cd574e333c4fdb132d7bcc9379bcd4aab485b2a63942::wbtc::WBTC",
    decimals: 8,
  },
  {
    symbol: "MBTC",
    name: "Merlin's Seal BTC",
    type: "0xd1a91b46bd6d966b62686263609074ad16cfdffc63c31a4775870a2d54d20c6b::mbtc::MBTC",
    decimals: 8,
  },
  {
    symbol: "LBTC",
    name: "Lombard BTC",
    type: "0x3e8e9423d80e1774a7ca128fccd8bf5f1f7753be658c5e645929037f7c819040::lbtc::LBTC",
    decimals: 8,
  },
  {
    symbol: "xBTC",
    name: "OKX Wrapped BTC",
    type: "0x876a4b7bce8aeaef60464c11f4026903e9afacab79b9b142686158aa86560b50::xbtc::XBTC",
    decimals: 8,
  },
  {
    symbol: "TBTC",
    name: "tBTC",
    type: "0x77045f1b9f811a7a8fb9ebd085b5b0c55c5cb0d1520ff55f7037f89b5da9f5f1::TBTC::TBTC",
    decimals: 8,
  },
  {
    symbol: "suiWBTC",
    name: "Sui Bridged WBTC",
    type: "0xaafb102dd0902f5055cadecd687fb5b71ca82ef0e0285d90afde828ec58ca96b::btc::BTC",
    decimals: 8,
  },
  {
    symbol: "suiETH",
    name: "Sui Bridged Ether",
    type: "0xd0e89b2af5e4910726fbcd8b8dd37bb79b29e5f83f7491bca830e94f7f226d29::eth::ETH",
    decimals: 8,
  },
  {
    symbol: "FDUSD",
    name: "First Digital USD",
    type: "0xf16e6b723f242ec745dfd7634ad072c42d5c1d9ac9d62a39c381303eaa57693a::fdusd::FDUSD",
    decimals: 6,
  },
  {
    symbol: "AUSD",
    name: "Agora Dollar",
    type: "0x2053d08c1e2bd02791056171aab0fd12bd7cd7efad2ab8f6b9c8902f14df2ff2::ausd::AUSD",
    decimals: 6,
  },
  {
    symbol: "USDsui",
    name: "USDsui",
    type: "0x44f838219cf67b058f3b37907b655f226153c18e33dfcd0da559a844fea9b1c1::usdsui::USDSUI",
    decimals: 6,
  },
  {
    symbol: "BUCK",
    name: "Bucket BUCK Stablecoin",
    type: "0xce7ff77a83ea0cb6fd39bd8748e2ec89a3f41e8efdc3f4eb123e0ca37b184db2::buck::BUCK",
    decimals: 9,
  },
  {
    symbol: "USDB",
    name: "Bucket USD",
    type: "0xe14726c336e81b32328e92afc37345d159f5b550b09fa92bd43640cfdd0a0cfd::usdb::USDB",
    decimals: 6,
  },
  {
    symbol: "wUSDC",
    name: "USD Coin (Wormhole Ethereum)",
    type: "0x5d4b302506645c37ff133b98c4b50a5ae14841659738d6d733d59d0d217a93bf::coin::COIN",
    decimals: 6,
    iconFrom: USDC_TYPE,
  },
  {
    symbol: "wUSDT",
    name: "Tether (Wormhole Ethereum)",
    type: "0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c::coin::COIN",
    decimals: 6,
    iconFrom: USDT_TYPE,
  },
  {
    symbol: "wETH",
    name: "Ether (Wormhole)",
    type: "0xaf8cd5edc19c4512f4259f0bee101a40d41ebed738ade5874359610ef8eeced5::coin::COIN",
    decimals: 8,
    iconFrom: "0xd0e89b2af5e4910726fbcd8b8dd37bb79b29e5f83f7491bca830e94f7f226d29::eth::ETH",
  },
  {
    symbol: "wSOL",
    name: "Solana (Wormhole)",
    type: "0xb7844e289a8410e50fb3ca48d69eb9cf29e27d223ef90353fe1bd8e27ff8f3f8::coin::COIN",
    decimals: 8,
  },
  {
    symbol: "XAUM",
    name: "Matrixdock Gold",
    type: "0x9d297676e7a4b771ab023291377b2adfaa4938fb9080b8d12430e4b108b836a9::xaum::XAUM",
    decimals: 9,
  },
  {
    symbol: "haSUI",
    name: "Haedal Staked SUI",
    type: "0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI",
    decimals: 9,
  },
  {
    symbol: "vSUI",
    name: "Volo Staked SUI",
    type: "0x549e8b69270defbfafd4f94e17ec44cdbdd99820b33bda2278dea3b9a32d3f55::cert::CERT",
    decimals: 9,
  },
  {
    symbol: "afSUI",
    name: "Aftermath Staked SUI",
    type: "0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI",
    decimals: 9,
  },
  {
    symbol: "sSUI",
    name: "Spring Staked SUI",
    type: "0x83556891f4a0f233ce7b05cfe7f957d4020492a34f5405b2cb9377d060bef4bf::spring_sui::SPRING_SUI",
    decimals: 9,
  },
  {
    symbol: "eSUI",
    name: "Ember SUI",
    type: "0x66629328922d609cf15af779719e248ae0e63fe0b9d9739623f763b33a9c97da::esui::ESUI",
    decimals: 9,
  },
  {
    symbol: "MAGMA",
    name: "Magma Finance",
    type: "0x9f854b3ad20f8161ec0886f15f4a1752bf75d22261556f14cc8d3a1c5d50e529::magma::MAGMA",
    decimals: 9,
  },
  {
    symbol: "MMT",
    name: "Momentum",
    type: "0x35169bc93e1fddfcf3a82a9eae726d349689ed59e4b065369af8789fe59f8608::mmt::MMT",
    decimals: 9,
  },
  {
    symbol: "NAVX",
    name: "NAVI Protocol",
    type: "0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX",
    decimals: 9,
  },
  {
    symbol: "SEND",
    name: "Suilend",
    type: "0xb45fcfcc2cc07ce0702cc2d229621e046c906ef14d9b25e8e4d25f6e8763fef7::send::SEND",
    decimals: 6,
  },
  {
    symbol: "HAEDAL",
    name: "Haedal Protocol",
    type: "0x3a304c7feba2d819ea57c3542d68439ca2c386ba02159c740f7b406e592c62ea::haedal::HAEDAL",
    decimals: 9,
  },
  {
    symbol: "NS",
    name: "SuiNS Token",
    type: "0x5145494a5f5100e645e4b0aa950fa6b68f614e8c59e17bc5ded3495123a79178::ns::NS",
    decimals: 6,
  },
  {
    symbol: "SCA",
    name: "Scallop",
    type: "0x7016aae72cfc67f2fadf55769c0a7dd54291a583b63051a5ed71081cce836ac6::sca::SCA",
    decimals: 9,
  },
  {
    symbol: "BLUE",
    name: "Bluefin",
    type: "0xe1b45a0e641b9955a20aa0ad1c1f4ad86aad8afb07296d4085e349a50e90bdca::blue::BLUE",
    decimals: 9,
  },
  {
    symbol: "IKA",
    name: "Ika",
    type: "0x7262fb2f7a3a14c888c438a3cd9b912469a58cf60f367352c46584262e8299aa::ika::IKA",
    decimals: 9,
  },
  {
    symbol: "TURBOS",
    name: "Turbos Finance",
    type: "0x5d1f47ea69bb0de31c313d7acf89b890dbb8991ea8e03c6c355171f84bb1ba4a::turbos::TURBOS",
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
