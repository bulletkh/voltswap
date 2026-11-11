export const VOLT_TREASURY_ADDRESS = '0x7211d7a33c32b8a848fd5d87dc0630b7d40d3d324856a748aff454c2955cab12';

export interface Chain {
  id: string;
  name: string;
  logo: string;
  nativeToken: string;
}

export const SUPPORTED_CHAINS: Chain[] = [
  {
    id: 'sui',
    name: 'Sui',
    logo: '/tokens/sui.svg',
    nativeToken: 'SUI',
  },
  {
    id: 'solana',
    name: 'Solana',
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
    nativeToken: 'SOL',
  },
  {
    id: 'ethereum',
    name: 'Ethereum',
    logo: 'https://assets.coingecko.com/coins/images/279/standard/ethereum.png',
    nativeToken: 'ETH',
  },
  {
    id: 'arbitrum',
    name: 'Arbitrum',
    logo: 'https://assets.coingecko.com/coins/images/16547/standard/arbitrum-shield.png',
    nativeToken: 'ETH',
  },
  {
    id: 'base',
    name: 'Base',
    logo: 'https://raw.githubusercontent.com/base-org/brand-kit/main/logo/in-product/Base_Network_Logo.png',
    nativeToken: 'ETH',
  },
  {
    id: 'bsc',
    name: 'BNB Chain',
    logo: 'https://assets.coingecko.com/coins/images/825/standard/bnb-icon2_2x.png',
    nativeToken: 'BNB',
  },
  {
    id: 'polygon',
    name: 'Polygon',
    logo: 'https://assets.coingecko.com/coins/images/4713/standard/polygon.png',
    nativeToken: 'POL',
  }
];

export interface Token {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  logo: string;
  priceUsd?: number;
  chain?: string;
}

export const POPULAR_TOKENS: Token[] = [
  {
    symbol: 'SUI',
    name: 'Sui Network',
    address: '0x2::sui::SUI',
    decimals: 9,
    logo: '/tokens/sui.svg',
    priceUsd: 0.86,
    chain: 'sui'
  },
  {
    symbol: 'USDC',
    name: 'USD Coin (Native Circle)',
    address: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    decimals: 6,
    logo: '/tokens/usdc.svg',
    priceUsd: 1.00,
    chain: 'sui'
  },
  {
    symbol: 'USDT',
    name: 'Tether USD (Sui Bridge)',
    address: '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT',
    decimals: 6,
    logo: '/tokens/usdt.svg',
    priceUsd: 1.00,
    chain: 'sui'
  },
  {
    symbol: 'DEEP',
    name: 'DeepBook Token',
    address: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
    decimals: 6,
    logo: '/tokens/deep.png',
    priceUsd: 0.0145,
    chain: 'sui'
  },
  {
    symbol: 'CETUS',
    name: 'Cetus Protocol',
    address: '0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS',
    decimals: 9,
    logo: '/tokens/cetus.svg',
    priceUsd: 0.020,
    chain: 'sui'
  },
  {
    symbol: 'WAL',
    name: 'Walrus Protocol (Decentralized Storage)',
    address: '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL',
    decimals: 9,
    logo: '/tokens/wal.svg',
    priceUsd: 0.029,
    chain: 'sui'
  },
  {
    symbol: 'hBTC',
    name: 'Hashi Bitcoin (Native BTC on Sui)',
    address: '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN',
    decimals: 8,
    logo: '/tokens/btc.svg',
    priceUsd: 76200.00,
    chain: 'sui'
  },
  {
    symbol: 'XBTC',
    name: 'OKX Wrapped Bitcoin (Sui)',
    address: '0x876a4b7bce8aeaef60464c11f4026903e9afacab79b9b142686158aa86560b50::xbtc::XBTC',
    decimals: 8,
    logo: '/tokens/btc.svg',
    priceUsd: 75850.00,
    chain: 'sui'
  },
  {
    symbol: 'wBTC',
    name: 'Wrapped Bitcoin (Sui Native)',
    address: '0x027792d9fed7f9844eb4839566001bb6f6cb4804f66aa2da6fe1ee242d896881::coin::COIN',
    decimals: 8,
    logo: '/tokens/btc.svg',
    priceUsd: 75850.00,
    chain: 'sui'
  },
  {
    symbol: 'HAEDAL',
    name: 'Haedal Protocol',
    address: '0x3a304c7feba2d819ea57c3542d68439ca2c386ba02159c740f7b406e592c62ea::haedal::HAEDAL',
    decimals: 9,
    logo: '/tokens/hasui.png',
    priceUsd: 0.0255,
    chain: 'sui'
  },
  {
    symbol: 'BLUE',
    name: 'Bluefin Protocol',
    address: '0xe1b45a0e641b9955a20aa0ad1c1f4ad86aad8afb07296d4085e349a50e90bdca::blue::BLUE',
    decimals: 9,
    logo: '/tokens/blue.png',
    priceUsd: 0.085,
    chain: 'sui'
  },
  {
    symbol: 'SEND',
    name: 'Suilend Protocol',
    address: '0xb45fcfcc2cc07ce0702cc2d229621e046c906ef14d9b25e8e4d25f6e8763fef7::send::SEND',
    decimals: 6,
    logo: '/tokens/send.svg',
    priceUsd: 0.45,
    chain: 'sui'
  },
  {
    symbol: 'LOFI',
    name: 'LOFI the Yeti',
    address: '0xf22da9a24ad027cccb5f2d496cbe91de953d363513db08a3a734d361c7c17503::LOFI::LOFI',
    decimals: 9,
    logo: '/tokens/lofi.svg',
    priceUsd: 0.0089,
    chain: 'sui'
  },
  {
    symbol: 'NAVX',
    name: 'NAVI Protocol (#1 Lending)',
    address: '0xa99b8952d4f7d947ea77fe0ecdcc9e5fc0bcab2841d6e2a5aa00c3044e5544b5::navx::NAVX',
    decimals: 9,
    logo: '/tokens/navx.svg',
    priceUsd: 0.010,
    chain: 'sui'
  },
  {
    symbol: 'SCA',
    name: 'Scallop Money Market',
    address: '0x7016aae72cfc67f2fadf55769c0a7dd54291a583b63051a5ed71081cce836ac6::sca::SCA',
    decimals: 9,
    logo: '/tokens/sca.svg',
    priceUsd: 0.12,
    chain: 'sui'
  },
  {
    symbol: 'NS',
    name: 'SuiNS Domain Token',
    address: '0x5145494a5f5100e645e4b0aa950fa6b68f614e8c59e17bc5ded3495123a79178::ns::NS',
    decimals: 6,
    logo: '/tokens/ns.svg',
    priceUsd: 0.15,
    chain: 'sui'
  },
  {
    symbol: 'HIPPO',
    name: 'SuDeng (#1 Sui Meme)',
    address: '0x8993129d72e733985f7f1a00396cbd055bad6f817fee36576ce483c8bbb8b87b::sudeng::SUDENG',
    decimals: 9,
    logo: '/tokens/hippo.png',
    priceUsd: 0.008,
    chain: 'sui'
  },
  {
    symbol: 'BLUB',
    name: 'BLUB Fish Meme',
    address: '0xfa7ac3951fdca92c5200d468d31a365eb03b2be9936fde615e69f0c1274ad3a0::BLUB::BLUB',
    decimals: 2,
    logo: '/tokens/blub.png',
    priceUsd: 0.00000018,
    chain: 'sui'
  },
  {
    symbol: 'FUD',
    name: 'Fud the Pug Meme',
    address: '0x76cb819b01abed502bee8a702b4c2d547532c12f25001c9dea795a5e631c26f1::fud::FUD',
    decimals: 5,
    logo: '/tokens/fud.svg',
    priceUsd: 0.00000045,
    chain: 'sui'
  },
  {
    symbol: 'haSUI',
    name: 'Haedal Staked SUI',
    address: '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI',
    decimals: 9,
    logo: '/tokens/hasui.png',
    priceUsd: 0.92,
    chain: 'sui'
  },
  {
    symbol: 'afSUI',
    name: 'Aftermath Staked SUI',
    address: '0xf325ce1300e8dac124071d3152c5c5ee6174914f8bc2161e88329cf579246efc::afsui::AFSUI',
    decimals: 9,
    logo: '/tokens/afsui.svg',
    priceUsd: 0.92,
    chain: 'sui'
  },
  {
    symbol: 'BUCK',
    name: 'Bucket USD Stablecoin',
    address: '0xce7ff77a83ea0cb6fd39bd8748e2ec89a3f41e8efdc3f4eb123e0ca37b184db2::buck::BUCK',
    decimals: 9,
    logo: '/tokens/buck.svg',
    priceUsd: 1.00,
    chain: 'sui'
  }
];

export const CROSS_CHAIN_TOKENS: Token[] = [
  {
    symbol: 'SOL',
    name: 'Solana',
    address: 'So11111111111111111111111111111111111111112',
    decimals: 9,
    logo: '/tokens/sol.svg',
    priceUsd: 178.50,
    chain: 'solana'
  },
  {
    symbol: 'ETH',
    name: 'Ethereum',
    address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
    decimals: 18,
    logo: '/tokens/eth.svg',
    priceUsd: 2560.00,
    chain: 'ethereum'
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    decimals: 6,
    logo: '/tokens/usdc.svg',
    priceUsd: 1.00,
    chain: 'ethereum'
  },
  {
    symbol: 'USDT',
    name: 'Tether USD',
    address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
    decimals: 6,
    logo: '/tokens/usdt.svg',
    priceUsd: 1.00,
    chain: 'ethereum'
  },
  {
    symbol: 'SUI',
    name: 'Sui',
    address: '0x2::sui::SUI',
    decimals: 9,
    logo: '/tokens/sui.svg',
    priceUsd: 0.86,
    chain: 'sui'
  }
];

export interface TraderTierConfig {
  id: 'guest' | 'plankton' | 'dolphin' | 'shark' | 'whale' | 'leviathan';
  name: string;
  badgeEmoji: string;
  minVolumeUsd: number;
  nextTierVolumeUsd: number | null;
  feeRate: number;
  marketFeeRate: number;
  smartFeeRate: number;
  discountPct: number;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  badgeGlow: string;
  tagline: string;
  perks: string[];
}

export const TRADER_TIERS: TraderTierConfig[] = [
  {
    id: 'guest',
    name: 'Guest Trader',
    badgeEmoji: '⚪',
    minVolumeUsd: 0,
    nextTierVolumeUsd: 1000,
    feeRate: 0.0025,
    marketFeeRate: 0.0025,
    smartFeeRate: 0.0025,
    discountPct: 0,
    badgeBg: 'bg-white/5',
    badgeBorder: 'border-white/10',
    badgeText: 'text-gray-400',
    badgeGlow: '',
    tagline: 'Standard base tier for new wallets without active referral or volume',
    perks: ['Standard PTB DEX routing across 10 Sui pools', 'Live Whale Radar preview']
  },
  {
    id: 'plankton',
    name: 'Plankton',
    badgeEmoji: '🦐',
    minVolumeUsd: 1000,
    nextTierVolumeUsd: 10000,
    feeRate: 0.0020,
    marketFeeRate: 0.0020,
    smartFeeRate: 0.0020,
    discountPct: 20,
    badgeBg: 'bg-emerald-500/10',
    badgeBorder: 'border-emerald-500/25',
    badgeText: 'text-emerald-400',
    badgeGlow: 'shadow-[0_0_15px_rgba(16,185,129,0.2)]',
    tagline: 'Unlocked via Referral Link, Social Follow or $1,000 Volume',
    perks: ['-20% Fee Discount (0.20% flat rate)', 'Full Whale Tape & Cross-DEX Arb Access', 'Community Discord access']
  },
  {
    id: 'dolphin',
    name: 'Dolphin',
    badgeEmoji: '🐬',
    minVolumeUsd: 10000,
    nextTierVolumeUsd: 50000,
    feeRate: 0.0015,
    marketFeeRate: 0.0015,
    smartFeeRate: 0.0015,
    discountPct: 40,
    badgeBg: 'bg-cyan-500/10',
    badgeBorder: 'border-cyan-500/25',
    badgeText: 'text-cyan-400',
    badgeGlow: 'shadow-[0_0_15px_rgba(56,189,248,0.25)]',
    tagline: 'Active Scalper ($10,000 – $50,000 volume)',
    perks: ['-40% Fee Discount (0.15% flat rate)', 'Dolphin Badge in Terminal', 'Priority Route Splitting']
  },
  {
    id: 'shark',
    name: 'Shark',
    badgeEmoji: '🦈',
    minVolumeUsd: 50000,
    nextTierVolumeUsd: 250000,
    feeRate: 0.0010,
    marketFeeRate: 0.0010,
    smartFeeRate: 0.0010,
    discountPct: 60,
    badgeBg: 'bg-purple-500/10',
    badgeBorder: 'border-purple-500/25',
    badgeText: 'text-purple-400',
    badgeGlow: 'shadow-[0_0_20px_rgba(168,85,247,0.3)]',
    tagline: 'High-Volume Pro Trader ($50,000 – $250,000 volume)',
    perks: ['-60% Fee Discount (0.10% flat rate — DeepBook level)', 'Zero-Impact DeepBook v3 CLOB Routing', 'Alpha Telegram Whale Channel']
  },
  {
    id: 'whale',
    name: 'Blue Whale',
    badgeEmoji: '🐋',
    minVolumeUsd: 250000,
    nextTierVolumeUsd: 1000000,
    feeRate: 0.0006,
    marketFeeRate: 0.0006,
    smartFeeRate: 0.0006,
    discountPct: 76,
    badgeBg: 'bg-amber-500/15',
    badgeBorder: 'border-amber-500/40',
    badgeText: 'text-amber-400',
    badgeGlow: 'shadow-[0_0_25px_rgba(245,158,11,0.35)]',
    tagline: 'Heavy High-Roller ($250,000 – $1,000,000 volume)',
    perks: ['-76% Fee Discount (0.06% flat rate)', 'Golden VIP Terminal Frame', 'Direct Syndicate Broker Integration']
  },
  {
    id: 'leviathan',
    name: 'Leviathan ($1M Club)',
    badgeEmoji: '👑',
    minVolumeUsd: 1000000,
    nextTierVolumeUsd: null,
    feeRate: 0.0003,
    marketFeeRate: 0.0003,
    smartFeeRate: 0.0003,
    discountPct: 88,
    badgeBg: 'bg-gradient-to-r from-amber-500/20 via-volt/20 to-amber-500/20',
    badgeBorder: 'border-volt/60',
    badgeText: 'text-volt font-black',
    badgeGlow: 'shadow-[0_0_30px_rgba(234,252,109,0.4)]',
    tagline: 'Apex $1M Syndicate Legend — Absolute Lowest Fees on Entire Sui Network',
    perks: ['-88% Fee Discount (0.03% flat rate — Absolute Minimum on Sui)', 'Golden Crown VIP Terminal Status', 'Private Low-Latency RPC & Direct Move Execution']
  }
];
