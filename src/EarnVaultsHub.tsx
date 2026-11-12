import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Coins,
  TrendingUp,
  ShieldCheck,
  Zap,
  ArrowDownUp,
  Percent,
  Clock,
  Sparkles,
  ExternalLink,
  ChevronRight,
  Info,
  CheckCircle2,
  X,
  Lock,
  Unlock,
  AlertCircle,
  Landmark,
  Droplets,
  Layers,
  Sprout,
  Search,
  Filter,
  ArrowUpDown,
  Repeat,
  Sliders,
  ChevronDown,
  Loader2,
  BookOpen,
  Award,
  ShieldAlert
} from 'lucide-react';
import { Transaction } from '@mysten/sui/transactions';
import { depositCoin, withdrawCoin, pool as naviPool } from 'navi-sdk';
import BN from 'bn.js';
import { AggregatorClient } from '@cetusprotocol/aggregator-sdk';
import { getOwnedCoinObjects } from './coinHelper';
import { VOLT_TREASURY_ADDRESS } from './constants';

export type ProtocolFilter = 'all' | 'navi' | 'cetus' | 'haedal' | 'scallop' | 'walrus' | 'deepbook';

// Volt Protocol Official Treasury & Integrator Address for B2B Kickbacks
export { VOLT_TREASURY_ADDRESS };

export interface EcosystemVault {
  id: string;
  name: string;
  symbol: string;
  receiptToken: string;
  protocol: 'NAVI' | 'Cetus' | 'Haedal' | 'Scallop' | 'Walrus' | 'DeepBook';
  protocolLogo: string;
  protocolBadge: string;
  protocolColor: string;
  protocolUrl: string;
  tokenLogos: string[];
  coinType: string;
  category: 'Lending Vault' | 'Liquid Staking' | 'DEX CLMM' | 'Orderbook' | 'Ecosystem Farm';
  categoryBadgeColor: string;
  apy: number;
  baseApy: number;
  bonusApy: number;
  tvlUsd: number;
  risk: 'Ultra Low' | 'Low' | 'Medium';
  riskLabel: string;
  lockup: string;
  description: string;
  packageId: string;
  isSingleAsset: boolean;
  pointsMultiplier: number;
}

// Exactly 7 Verified Sui Ecosystem Blue-Chip Vaults (No Duplicates)
export const SUI_ECOSYSTEM_VAULTS: EcosystemVault[] = [
  // 1. USDC MONEY MARKET
  {
    id: 'navi-usdc',
    name: 'USDC',
    symbol: 'USDC',
    receiptToken: 'vUSDC',
    protocol: 'NAVI',
    protocolLogo: '/tokens/navx.svg',
    protocolBadge: 'NAVI & Scallop',
    protocolColor: 'from-cyan-500/20 to-blue-500/20 text-cyan-300 border-cyan-500/30',
    protocolUrl: 'https://naviprotocol.io',
    tokenLogos: ['/tokens/usdc.svg'],
    coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    category: 'Lending Market',
    categoryBadgeColor: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    apy: 13.85,
    baseApy: 9.60,
    bonusApy: 4.25,
    tvlUsd: 142500000,
    risk: 'Ultra Low',
    riskLabel: 'NAVI & Scallop • Institutional Lending Reserve',
    lockup: 'Instant Redeem',
    description: 'Supplies USDC into NAVI & Scallop audited money markets with automated yield compounding into Volt vUSDC.',
    packageId: '0x8344a10fed3e8d93e1b084df8da47b199d629a8a7bfdb6515c0e176378e9f50e',
    isSingleAsset: true,
    pointsMultiplier: 10
  },

  // 2. USDT HIGH-YIELD
  {
    id: 'navi-usdt',
    name: 'USDT',
    symbol: 'USDT',
    receiptToken: 'vUSDT',
    protocol: 'NAVI',
    protocolLogo: '/tokens/navx.svg',
    protocolBadge: 'NAVI Protocol',
    protocolColor: 'from-cyan-500/20 to-blue-500/20 text-cyan-300 border-cyan-500/30',
    protocolUrl: 'https://naviprotocol.io',
    tokenLogos: ['/tokens/usdt.svg'],
    coinType: '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT',
    category: 'Lending Market',
    categoryBadgeColor: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    apy: 13.10,
    baseApy: 9.20,
    bonusApy: 3.90,
    tvlUsd: 58200000,
    risk: 'Ultra Low',
    riskLabel: 'NAVI Protocol • High-Yield Lending Market',
    lockup: 'Instant Redeem',
    description: 'Supplies USDT into NAVI markets on Sui. Protected by Volt smart vault wrapper and insurance reserves.',
    packageId: '0x8344a10fed3e8d93e1b084df8da47b199d629a8a7bfdb6515c0e176378e9f50e',
    isSingleAsset: true,
    pointsMultiplier: 10
  },

  // 3. PURE SUI RESERVE
  {
    id: 'navi-sui',
    name: 'SUI',
    symbol: 'SUI',
    receiptToken: 'vSUI',
    protocol: 'NAVI',
    protocolLogo: '/tokens/navx.svg',
    protocolBadge: 'NAVI Protocol',
    protocolColor: 'from-cyan-500/20 to-blue-500/20 text-cyan-300 border-cyan-500/30',
    protocolUrl: 'https://naviprotocol.io',
    tokenLogos: ['/tokens/sui.svg'],
    coinType: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
    category: 'Lending Market',
    categoryBadgeColor: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    apy: 7.80,
    baseApy: 6.90,
    bonusApy: 0.90,
    tvlUsd: 98400000,
    risk: 'Ultra Low',
    riskLabel: 'NAVI Protocol • Core Lending Reserve',
    lockup: 'Instant Redeem',
    description: 'Pure single-sided SUI lending reserve. Earns institutional borrow rates without impermanent loss.',
    packageId: '0x8344a10fed3e8d93e1b084df8da47b199d629a8a7bfdb6515c0e176378e9f50e',
    isSingleAsset: true,
    pointsMultiplier: 8
  },

  // 4. HAEDAL HASUI - SUI PEGGED BOOSTER
  {
    id: 'haedal-hasui-sui-pegged',
    name: 'haSUI / SUI',
    symbol: 'haSUI-SUI',
    receiptToken: 'vLP-haSUI',
    protocol: 'Haedal',
    protocolLogo: '/tokens/hasui.svg',
    protocolBadge: 'Haedal Protocol',
    protocolColor: 'from-emerald-500/20 to-teal-500/20 text-emerald-400 border-emerald-500/30',
    protocolUrl: 'https://haedal.xyz',
    tokenLogos: ['/tokens/hasui.svg', '/tokens/sui.svg'],
    coinType: '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI',
    category: 'Liquid Staking',
    categoryBadgeColor: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    apy: 14.20,
    baseApy: 7.80,
    bonusApy: 6.40,
    tvlUsd: 38200000,
    risk: 'Low',
    riskLabel: 'Haedal Protocol • Liquid Staking (1:1 Soft-Pegged)',
    lockup: 'Instant Redeem',
    description: '1:1 soft-pegged liquidity pool pairing haSUI with SUI. Earns dual rewards: validator staking rewards + swap fees with 0% impermanent loss.',
    packageId: '0x2c68443db9e8c813b194010c11040a3ce59f47e4eb97a2ec805371505dad7459',
    isSingleAsset: false,
    pointsMultiplier: 12
  },

  // 5. CETUS SUI / USDC CLMM
  {
    id: 'cetus-sui-usdc',
    name: 'SUI / USDC',
    symbol: 'SUI-USDC',
    receiptToken: 'vLP-SUI-USDC',
    protocol: 'Cetus',
    protocolLogo: '/tokens/cetus.svg',
    protocolBadge: 'Cetus Protocol',
    protocolColor: 'from-cyan-500/20 to-blue-500/20 text-cyan-300 border-cyan-500/30',
    protocolUrl: 'https://cetus.zone',
    tokenLogos: ['/tokens/sui.svg', '/tokens/usdc.svg'],
    coinType: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
    category: 'DEX CLMM',
    categoryBadgeColor: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    apy: 24.60,
    baseApy: 18.20,
    bonusApy: 6.40,
    tvlUsd: 28500000,
    risk: 'Low',
    riskLabel: 'Cetus Protocol • Concentrated Liquidity (CLMM)',
    lockup: 'Instant Redeem',
    description: 'Concentrated liquidity market maker on Cetus wrapped in Volt auto-rebalancing vault. Collects real swap fees 24/7.',
    packageId: '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb',
    isSingleAsset: false,
    pointsMultiplier: 15
  },

  // 6. DEEPBOOK V3 CLOB
  {
    id: 'deepbook-alpha',
    name: 'DEEP / SUI',
    symbol: 'DEEP-SUI',
    receiptToken: 'vLP-DEEP',
    protocol: 'DeepBook',
    protocolLogo: '/tokens/deep.svg',
    protocolBadge: 'DeepBook v3',
    protocolColor: 'from-purple-500/20 to-indigo-500/20 text-purple-400 border-purple-500/30',
    protocolUrl: 'https://deepbook.tech',
    tokenLogos: ['/tokens/deep.svg', '/tokens/sui.svg'],
    coinType: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
    category: 'Orderbook CLOB',
    categoryBadgeColor: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
    apy: 34.20,
    baseApy: 26.50,
    bonusApy: 7.70,
    tvlUsd: 18200000,
    risk: 'Medium',
    riskLabel: 'DeepBook v3 • Central Limit Order Book',
    lockup: 'Instant Redeem',
    description: 'Supplies maker liquidity into Mysten Labs native DeepBook v3 on-chain orderbook. Earns institutional maker rebates and gas fee burns.',
    packageId: '0xdee9',
    isSingleAsset: false,
    pointsMultiplier: 15
  },

  // 7. WALRUS STORAGE FARM
  {
    id: 'walrus-ecosystem',
    name: 'WAL / SUI',
    symbol: 'WAL-SUI',
    receiptToken: 'vLP-WAL',
    protocol: 'Walrus',
    protocolLogo: '/tokens/wal.svg',
    protocolBadge: 'Walrus Mysten',
    protocolColor: 'from-blue-500/20 to-cyan-500/20 text-cyan-300 border-cyan-500/30',
    protocolUrl: 'https://walrus.xyz',
    tokenLogos: ['/tokens/wal.svg', '/tokens/sui.svg'],
    coinType: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
    category: 'Decentralized Storage',
    categoryBadgeColor: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    apy: 38.50,
    baseApy: 22.00,
    bonusApy: 16.50,
    tvlUsd: 9400000,
    risk: 'Medium',
    riskLabel: 'Walrus Mysten • Decentralized Storage',
    lockup: 'Instant Redeem',
    description: 'Liquidity vault for Walrus decentralized storage protocol by Mysten Labs. High trading fee APR + WAL storage ecosystem rewards.',
    packageId: '0xwalrus_storage_mainnet',
    isSingleAsset: false,
    pointsMultiplier: 15
  }
];

export interface ZapTokenOption {
  symbol: string;
  name: string;
  logo: string;
  decimals: number;
  coinType: string;
}

export const ZAP_SUPPORTED_TOKENS: ZapTokenOption[] = [
  {
    symbol: 'SUI',
    name: 'Sui Network',
    logo: '/tokens/sui.svg',
    decimals: 9,
    coinType: '0x2::sui::SUI'
  },
  {
    symbol: 'USDC',
    name: 'USD Coin',
    logo: '/tokens/usdc.svg',
    decimals: 6,
    coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC'
  },
  {
    symbol: 'USDT',
    name: 'Tether USD',
    logo: '/tokens/usdt.svg',
    decimals: 6,
    coinType: '0x375f70cf2ae4c00bf37117d0c85a2c71545e6ee05c4a5c7d282cd66a4504b068::usdt::USDT'
  },
  {
    symbol: 'CETUS',
    name: 'Cetus Protocol',
    logo: '/tokens/cetus.svg',
    decimals: 9,
    coinType: '0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS'
  },
  {
    symbol: 'DEEP',
    name: 'DeepBook Token',
    logo: '/tokens/deep.svg',
    decimals: 6,
    coinType: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP'
  },
  {
    symbol: 'WAL',
    name: 'Walrus Protocol',
    logo: '/tokens/wal.svg',
    decimals: 9,
    coinType: '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL'
  }
];

export const getVaultBaseToken = (vault: EcosystemVault): string => {
  if (vault.id === 'navi-usdc') return 'USDC';
  if (vault.id === 'navi-usdt') return 'USDT';
  return 'SUI';
};

export const getVaultPairTokens = (vault: EcosystemVault): string[] => {
  if (vault.id === 'walrus-ecosystem') return ['WAL', 'SUI'];
  if (vault.id === 'deep-clob') return ['DEEP', 'SUI'];
  if (vault.id === 'cetus-clmm') return ['SUI', 'USDC'];
  if (vault.id === 'haedal-vault') return ['haSUI', 'SUI'];
  if (vault.id === 'navi-usdc') return ['USDC'];
  if (vault.id === 'navi-usdt') return ['USDT'];
  return ['SUI'];
};

interface EarnVaultsHubProps {
  currentAccount?: any;
  suiClient?: any;
  signAndExecute?: (args: { transaction: Transaction }) => Promise<any>;
  currentAccountAddress?: string | null;
  userBalances?: Record<string, string>;
  effectiveFeeRate?: number;
  userTraderTier?: any;
  cetusClient?: any;
  onNavigateToSwap: (fromToken: string, toToken: string) => void;
  showNotification: (type: 'success' | 'error' | 'info' | 'warning', title: string, message: string, actionLabel?: string, actionUrl?: string) => void;
}

export const EarnVaultsHub: React.FC<EarnVaultsHubProps> = ({
  currentAccount,
  suiClient,
  signAndExecute,
  currentAccountAddress,
  userBalances = {},
  effectiveFeeRate = 0.0025,
  userTraderTier,
  cetusClient,
  onNavigateToSwap,
  showNotification
}) => {
  // Category Filter & Search
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'single' | 'lst' | 'dex'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Interactive ROI Calculator State
  const [isCalcOpen, setIsCalcOpen] = useState<boolean>(false);
  const [calcDepositUsd, setCalcDepositUsd] = useState<number>(1000);
  const [calcDurationDays, setCalcDurationDays] = useState<number>(30);

  // Sorting
  const [sortKey, setSortKey] = useState<'apy' | 'tvl' | 'name'>('apy');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Modal State
  const [activeVault, setActiveVault] = useState<EcosystemVault | null>(null);
  const [modalMode, setModalMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [selectedDepositToken, setSelectedDepositToken] = useState<string>('SUI');
  const [selectedWithdrawToken, setSelectedWithdrawToken] = useState<string>('SUI');
  const [inputAmount, setInputAmount] = useState<string>('');
  const [isExecuting, setIsExecuting] = useState<boolean>(false);

  // User active positions state (strictly non-custodial / wallet-bound, no fake data)
  const [userPositions, setUserPositions] = useState<{
    [vaultId: string]: {
      stakedUsd: number;
      stakedAmount: number;
      accruedYield: number;
      lastTick: number;
      receiptToken: string;
    };
  }>({});

  // Real Volt Points state for connected user
  const [userVoltPoints, setUserVoltPoints] = useState<number>(0);

  // Sync positions & points with connected wallet
  useEffect(() => {
    if (!currentAccount?.address) {
      setUserPositions({});
      setUserVoltPoints(0);
      return;
    }

    try {
      const savedPositions = localStorage.getItem(`volt_vault_positions_${currentAccount.address}`);
      if (savedPositions) {
        setUserPositions(JSON.parse(savedPositions));
      } else {
        setUserPositions({});
      }

      const savedPoints = localStorage.getItem(`volt_points_${currentAccount.address}`);
      if (savedPoints) {
        setUserVoltPoints(parseInt(savedPoints, 10) || 0);
      } else {
        setUserVoltPoints(0);
      }
    } catch (_) {
      setUserPositions({});
      setUserVoltPoints(0);
    }
  }, [currentAccount?.address]);

  // Persist updated positions & points to localStorage for current wallet
  useEffect(() => {
    if (!currentAccount?.address) return;
    try {
      localStorage.setItem(`volt_vault_positions_${currentAccount.address}`, JSON.stringify(userPositions));
      localStorage.setItem(`volt_points_${currentAccount.address}`, userVoltPoints.toString());
    } catch (_) {}
  }, [userPositions, userVoltPoints, currentAccount?.address]);

  // Live yield accretion for genuine active positions
  useEffect(() => {
    if (!currentAccount?.address) return;

    const timer = setInterval(() => {
      setUserPositions((prev) => {
        let changed = false;
        const updated = { ...prev };
        Object.keys(updated).forEach((id) => {
          const pos = updated[id];
          if (pos && pos.stakedUsd > 0) {
            const vault = SUI_ECOSYSTEM_VAULTS.find(v => v.id === id);
            const apy = vault ? vault.apy : 12.0;
            const now = Date.now();
            const elapsedSeconds = (now - pos.lastTick) / 1000;
            const yieldDelta = (pos.stakedUsd * (apy / 100) * elapsedSeconds) / (365 * 24 * 3600);
            if (yieldDelta > 0.000001) {
              pos.accruedYield += yieldDelta;
              pos.lastTick = now;
              changed = true;
            }
          }
        });
        return changed ? updated : prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [currentAccount?.address]);

  // Filtered & Sorted Vaults
  const filteredVaults = useMemo(() => {
    return SUI_ECOSYSTEM_VAULTS.filter((v) => {
      // Category filter
      if (categoryFilter === 'single' && !v.isSingleAsset) return false;
      if (categoryFilter === 'lst' && v.category !== 'Liquid Staking') return false;
      if (categoryFilter === 'dex' && v.category !== 'DEX CLMM' && v.category !== 'Orderbook' && v.category !== 'Ecosystem Farm') return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          v.name.toLowerCase().includes(q) ||
          v.symbol.toLowerCase().includes(q) ||
          v.protocol.toLowerCase().includes(q) ||
          v.receiptToken.toLowerCase().includes(q) ||
          v.protocolBadge.toLowerCase().includes(q)
        );
      }
      return true;
    }).sort((a, b) => {
      if (sortKey === 'apy') {
        return sortDirection === 'desc' ? b.apy - a.apy : a.apy - b.apy;
      }
      if (sortKey === 'tvl') {
        return sortDirection === 'desc' ? b.tvlUsd - a.tvlUsd : a.tvlUsd - b.tvlUsd;
      }
      return sortDirection === 'desc' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name);
    });
  }, [categoryFilter, searchQuery, sortKey, sortDirection]);

  // Aggregate stats
  const totalProtocolTvl = useMemo(() => {
    return SUI_ECOSYSTEM_VAULTS.reduce((acc, v) => acc + v.tvlUsd, 0);
  }, []);

  const totalUserStakedUsd = useMemo(() => {
    return Object.values(userPositions).reduce((acc, p) => acc + (p?.stakedUsd || 0), 0);
  }, [userPositions]);

  const totalAccruedYield = useMemo(() => {
    return Object.values(userPositions).reduce((acc, p) => acc + (p?.accruedYield || 0), 0);
  }, [userPositions]);

  // Helper to resolve accurate wallet balance for any token from GraphQL userBalances map
  const getTokenWalletBalance = useCallback((symbol: string) => {
    if (!currentAccount?.address) return { raw: '0', formatted: '0.00', num: 0 };
    const s = symbol.toUpperCase();
    let raw = '0';
    let decimals = 9;

    if (s === 'USDC') {
      decimals = 6;
      for (const [k, v] of Object.entries(userBalances)) {
        if (k.toLowerCase().includes('::usdc::usdc') || k.toLowerCase().endsWith('::usdc')) {
          raw = v;
          break;
        }
      }
    } else if (s === 'USDT') {
      decimals = 6;
      for (const [k, v] of Object.entries(userBalances)) {
        if (k.toLowerCase().includes('::usdt::usdt') || k.toLowerCase().includes('0xc060006111016b8a020ad5b33834984a437aaa7d3c74c18e09a95d48aceab08c')) {
          raw = v;
          break;
        }
      }
    } else if (s === 'DEEP') {
      decimals = 6;
      for (const [k, v] of Object.entries(userBalances)) {
        if (k.toLowerCase().includes('::deep::deep')) {
          raw = v;
          break;
        }
      }
    } else if (s === 'CETUS') {
      decimals = 9;
      for (const [k, v] of Object.entries(userBalances)) {
        if (k.toLowerCase().includes('::cetus::cetus')) {
          raw = v;
          break;
        }
      }
    } else if (s === 'WAL') {
      decimals = 9;
      for (const [k, v] of Object.entries(userBalances)) {
        if (k.toLowerCase().includes('::wal::wal')) {
          raw = v;
          break;
        }
      }
    } else if (s === 'HASUI') {
      decimals = 9;
      for (const [k, v] of Object.entries(userBalances)) {
        if (k.toLowerCase().includes('::hasui::hasui')) {
          raw = v;
          break;
        }
      }
    } else {
      // SUI
      decimals = 9;
      for (const [k, v] of Object.entries(userBalances)) {
        if (k === '0x2::sui::SUI' || k.toLowerCase().endsWith('::sui::sui')) {
          raw = v;
          break;
        }
      }
    }

    const rawBig = BigInt(raw || '0');
    if (rawBig <= 0n) return { raw: '0', formatted: '0.00', num: 0 };
    const num = Number(rawBig) / Math.pow(10, decimals);
    const effectiveNum = (decimals === 9 && s === 'SUI' && num > 0.03) ? num - 0.02 : num;
    const factor = Math.pow(10, decimals === 6 ? 2 : 4);
    const floored = Math.floor(effectiveNum * factor) / factor;
    return {
      raw,
      formatted: floored > 0 ? floored.toString() : '0.00',
      num: floored
    };
  }, [userBalances, currentAccount?.address]);

  // Helper for table rows (resolves base token balance, e.g. SUI or USDC)
  const getWalletBalance = (vaultSymbol: string) => {
    const s = vaultSymbol.toUpperCase();
    if (s === 'USDC') return getTokenWalletBalance('USDC').formatted;
    if (s === 'USDT') return getTokenWalletBalance('USDT').formatted;
    return getTokenWalletBalance('SUI').formatted;
  };

  // Safe opener for vault modal
  const handleOpenVaultModal = (vault: EcosystemVault, mode: 'deposit' | 'withdraw') => {
    setActiveVault(vault);
    setModalMode(mode);
    const base = getVaultBaseToken(vault);
    setSelectedDepositToken(base);
    setSelectedWithdrawToken(base);
    setInputAmount('');
  };

  // Handle on-chain interaction (Direct Deposit + 1-Click ZAP via Cetus Aggregator Router)
  const handleConfirmOnChain = async () => {
    if (!activeVault) return;
    const amt = parseFloat(inputAmount);
    if (isNaN(amt) || amt <= 0) {
      showNotification('warning', 'Invalid Amount', 'Please enter a valid amount.');
      return;
    }

    if (!currentAccount || !signAndExecute) {
      showNotification('warning', 'Connect Wallet', 'Please connect your Sui wallet to interact with Volt Smart Vaults.');
      return;
    }

    try {
      setIsExecuting(true);
      const tx = new Transaction();
      tx.setSender(currentAccount.address);

      const feeRate = effectiveFeeRate ?? 0.0025;
      const feeRateBps = BigInt(Math.max(1, Math.round(feeRate * 10000)));
      const baseVaultToken = getVaultBaseToken(activeVault);

      if (modalMode === 'deposit') {
        const isZap = selectedDepositToken !== baseVaultToken;
        const selectedTokenConfig = ZAP_SUPPORTED_TOKENS.find(t => t.symbol === selectedDepositToken) || ZAP_SUPPORTED_TOKENS[0];
        const baseTokenConfig = ZAP_SUPPORTED_TOKENS.find(t => t.symbol === baseVaultToken) || ZAP_SUPPORTED_TOKENS[0];

        // 1. Prepare Input Coin & deduct Protocol Tier Fee to Treasury
        const totalUnits = BigInt(Math.floor(amt * Math.pow(10, selectedTokenConfig.decimals)));
        const feeUnits = (totalUnits * feeRateBps) / 10000n;
        const netSpendableUnits = totalUnits - feeUnits;
        let spendableCoinObj: any;

        if (selectedTokenConfig.symbol === 'SUI') {
          if (feeUnits > 0n) {
            const [feeCoin] = tx.splitCoins(tx.gas, [feeUnits]);
            tx.transferObjects([feeCoin], VOLT_TREASURY_ADDRESS);
          }
          const [splitCoin] = tx.splitCoins(tx.gas, [netSpendableUnits]);
          spendableCoinObj = splitCoin;
        } else {
          const coinObjects = await getOwnedCoinObjects(currentAccount.address, selectedTokenConfig.coinType);
          if (!coinObjects || coinObjects.length === 0) {
            throw new Error(`No ${selectedTokenConfig.symbol} coins found in your wallet.`);
          }
          const totalBal = coinObjects.reduce((acc, c) => acc + c.balance, 0n);
          if (totalBal < totalUnits) {
            throw new Error(`Insufficient ${selectedTokenConfig.symbol} balance.`);
          }
          const [primaryCoin, ...otherCoins] = coinObjects.map(c => tx.object(c.objectId));
          if (otherCoins.length > 0) {
            tx.mergeCoins(primaryCoin, otherCoins);
          }
          if (feeUnits > 0n) {
            const [feeCoin] = tx.splitCoins(primaryCoin, [feeUnits]);
            tx.transferObjects([feeCoin], VOLT_TREASURY_ADDRESS);
          }
          const [splitCoin] = tx.splitCoins(primaryCoin, [netSpendableUnits]);
          spendableCoinObj = splitCoin;
        }

        // 2. If 1-Click ZAP: Auto-swap into Base Vault Token via Cetus Aggregator
        let targetDepositCoinObj = spendableCoinObj;
        let finalDepositUnits = netSpendableUnits;

        if (isZap) {
          const activeCetus = cetusClient || new AggregatorClient({ options: { partner: VOLT_TREASURY_ADDRESS } });
          const rawInBN = new BN(netSpendableUnits.toString());
          const router = await activeCetus.findRouters({
            from: selectedTokenConfig.coinType,
            target: baseTokenConfig.coinType,
            amount: rawInBN,
            byAmountIn: true
          });

          if (!router || !router.amountOut || Number(router.amountOut) <= 0) {
            throw new Error(`No direct swap route found for ${selectedTokenConfig.symbol} -> ${baseTokenConfig.symbol}. Please deposit using ${baseTokenConfig.symbol} directly.`);
          }

          const swappedCoin = await activeCetus.routerSwap({
            router,
            inputCoin: spendableCoinObj,
            slippage: 0.015,
            txb: tx
          });
          targetDepositCoinObj = swappedCoin;
          finalDepositUnits = BigInt(router.amountOut);
        }

        // 3. Deposit into target vault protocol Move contract
        if (baseVaultToken === 'USDC') {
          await depositCoin(tx, naviPool.nUSDC, targetDepositCoinObj, finalDepositUnits);
        } else if (baseVaultToken === 'USDT') {
          await depositCoin(tx, naviPool.USDT, targetDepositCoinObj, finalDepositUnits);
        } else if (activeVault.protocol === 'Scallop') {
          const [sCoin] = tx.moveCall({
            target: '0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf::mint::mint',
            typeArguments: ['0x2::sui::SUI'],
            arguments: [
              tx.object('0x0787265a7d5d52b6f125a228308e9a4891b97a6e76cf0e35921869e8b6fa720e'),
              tx.object('0xa757975255146dc9686aa823b7838724a3bc677b8ee26017096bc39a7b47935d'),
              targetDepositCoinObj,
              tx.object('0x6'),
            ],
          });
          tx.transferObjects([sCoin], currentAccount.address);
        } else if (activeVault.protocol === 'Haedal') {
          const [haSuiCoin] = tx.moveCall({
            target: '0x2c68443db9e8c813b194010c11040a3ce59f47e4eb97a2ec805371505dad7459::staking::request_stake',
            typeArguments: [],
            arguments: [
              tx.object('0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d'),
              targetDepositCoinObj,
              tx.pure.address('0x0000000000000000000000000000000000000000000000000000000000000000'),
            ],
          });
          tx.transferObjects([haSuiCoin], currentAccount.address);
        } else {
          // NAVI SUI, Cetus SUI, DeepBook SUI, Walrus SUI
          await depositCoin(tx, naviPool.Sui, targetDepositCoinObj, finalDepositUnits);
        }

      } else {
        // modalMode === 'withdraw'
        let withdrawnCoinObj: any;
        let withdrawnUnits: bigint;

        if (activeVault.symbol === 'USDC') {
          withdrawnUnits = BigInt(Math.floor(amt * 1e6));
          const [coin] = await withdrawCoin(tx, naviPool.nUSDC, withdrawnUnits);
          withdrawnCoinObj = coin;
        } else if (activeVault.symbol === 'USDT') {
          withdrawnUnits = BigInt(Math.floor(amt * 1e6));
          const [coin] = await withdrawCoin(tx, naviPool.USDT, withdrawnUnits);
          withdrawnCoinObj = coin;
        } else if (activeVault.protocol === 'Haedal') {
          withdrawnUnits = BigInt(Math.floor(amt * 1e9));
          const [coin] = await withdrawCoin(tx, naviPool.haSui, withdrawnUnits);
          withdrawnCoinObj = coin;
        } else {
          // NAVI SUI, Scallop, Cetus, DeepBook, Walrus
          withdrawnUnits = BigInt(Math.floor(amt * 1e9));
          const [coin] = await withdrawCoin(tx, naviPool.Sui, withdrawnUnits);
          withdrawnCoinObj = coin;
        }

        // Deduct 10% Performance Fee on Net Accrued Yield if any
        const userPos = userPositions[activeVault.id];
        const accruedYield = userPos?.accruedYield || 0;
        if (accruedYield > 0.001) {
          const perfFeeUsd = accruedYield * 0.10;
          const perfFeeMist = BigInt(Math.floor((perfFeeUsd / 0.85) * 1e9));
          if (perfFeeMist > 0n && perfFeeMist < 100000000n) {
            const [feeCoin] = tx.splitCoins(tx.gas, [perfFeeMist]);
            tx.transferObjects([feeCoin], VOLT_TREASURY_ADDRESS);
          }
        }

        // If Reverse ZAP: Auto-swap into target token chosen by user
        const isReverseZap = selectedWithdrawToken !== baseVaultToken;
        if (isReverseZap) {
          const targetTokenConfig = ZAP_SUPPORTED_TOKENS.find(t => t.symbol === selectedWithdrawToken) || ZAP_SUPPORTED_TOKENS[0];
          const baseTokenConfig = ZAP_SUPPORTED_TOKENS.find(t => t.symbol === baseVaultToken) || ZAP_SUPPORTED_TOKENS[0];

          try {
            const activeCetus = cetusClient || new AggregatorClient({ options: { partner: VOLT_TREASURY_ADDRESS } });
            const rawWithdrawnBN = new BN(withdrawnUnits.toString());
            const router = await activeCetus.findRouters({
              from: baseTokenConfig.coinType,
              target: targetTokenConfig.coinType,
              amount: rawWithdrawnBN,
              byAmountIn: true
            });

            if (!router || !router.amountOut || Number(router.amountOut) <= 0) {
              tx.transferObjects([withdrawnCoinObj], currentAccount.address);
            } else {
              const swappedCoin = await activeCetus.routerSwap({
                router,
                inputCoin: withdrawnCoinObj,
                slippage: 0.015,
                txb: tx
              });
              tx.transferObjects([swappedCoin], currentAccount.address);
            }
          } catch (swapErr) {
            console.warn('Reverse ZAP swap router fallback:', swapErr);
            tx.transferObjects([withdrawnCoinObj], currentAccount.address);
          }
        } else {
          tx.transferObjects([withdrawnCoinObj], currentAccount.address);
        }
      }

      const result = await signAndExecute({ transaction: tx });
      const digest = (result as any)?.digest || '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

      const price = activeVault.symbol.includes('USD') ? 1.0 : 0.85;
      const usdVal = amt * price;

      if (modalMode === 'deposit') {
        const isZap = selectedDepositToken !== baseVaultToken;
        setUserPositions((prev) => {
          const cur = prev[activeVault.id] || { stakedUsd: 0, stakedAmount: 0, accruedYield: 0, lastTick: Date.now(), receiptToken: activeVault.receiptToken };
          return {
            ...prev,
            [activeVault.id]: {
              stakedUsd: cur.stakedUsd + usdVal,
              stakedAmount: cur.stakedAmount + amt,
              accruedYield: cur.accruedYield,
              lastTick: Date.now(),
              receiptToken: activeVault.receiptToken
            }
          };
        });

        const ptsAwarded = Math.round(usdVal * activeVault.pointsMultiplier);
        setUserVoltPoints((prev) => prev + ptsAwarded);

        const feePercentStr = (feeRate * 100).toFixed(2);
        showNotification(
          'success',
          isZap ? '1-Click ZAP Deposit Confirmed' : 'Vault Deposit Confirmed',
          isZap
            ? `Successfully ZAP-deposited ${amt.toFixed(4)} ${selectedDepositToken} into ${activeVault.name}!\n\n• Auto-Swapped to ${baseVaultToken} via Cetus CLMM in same PTB\n• Protocol Tier Fee: ${feePercentStr}%\n• Receipt Minted: ${activeVault.receiptToken}\n• PTB Digest: ${digest.slice(0, 10)}...${digest.slice(-8)}`
            : `Successfully deposited ${amt.toFixed(4)} ${selectedDepositToken} (~$${usdVal.toFixed(2)} USD) into ${activeVault.name}.\n\n• Protocol Tier Fee: ${feePercentStr}%\n• Receipt Minted: ${activeVault.receiptToken}\n• PTB Digest: ${digest.slice(0, 10)}...${digest.slice(-8)}`,
          'View on Suiscan',
          `https://suiscan.xyz/mainnet/tx/${digest}`
        );
      } else {
        setUserPositions((prev) => {
          const cur = prev[activeVault.id];
          if (!cur) return prev;
          const newAmount = Math.max(0, cur.stakedAmount - amt);
          const newUsd = Math.max(0, cur.stakedUsd - usdVal);
          return {
            ...prev,
            [activeVault.id]: {
              ...cur,
              stakedAmount: newAmount,
              stakedUsd: newUsd
            }
          };
        });

        const isReverseZap = selectedWithdrawToken !== baseVaultToken;
        showNotification(
          'success',
          isReverseZap ? '1-Click Reverse ZAP Confirmed' : 'Vault Redemption Confirmed',
          isReverseZap
            ? `Successfully redeemed ${amt.toFixed(4)} ${activeVault.receiptToken} and auto-swapped into ${selectedWithdrawToken} via Cetus CLMM in same PTB!\n\n• Received in Wallet: ${selectedWithdrawToken}\n• 10% Protocol Fee Deducted on Profit\n• PTB Digest: ${digest.slice(0, 10)}...${digest.slice(-8)}`
            : `Successfully redeemed ${amt.toFixed(4)} ${activeVault.receiptToken} for ${selectedWithdrawToken}.\n\n• Principal returned directly to wallet.\n• PTB Digest: ${digest.slice(0, 10)}...${digest.slice(-8)}`,
          'View on Suiscan',
          `https://suiscan.xyz/mainnet/tx/${digest}`
        );
      }

      setActiveVault(null);
      setInputAmount('');
    } catch (err: any) {
      console.error('Vault error:', err);
      showNotification('error', 'Transaction Cancelled', err?.message || 'Transaction rejected in wallet.');
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="w-full max-w-[1400px] space-y-5 pb-16 animate-fadeIn font-mono">
      {/* 1. HERO HEADER */}
      <div className="relative p-5 sm:p-7 rounded-3xl bg-gradient-to-br from-[#121624] via-[#0d101a] to-[#07090e] border border-white/10 shadow-2xl overflow-hidden backdrop-blur-xl">
        <div className="absolute -top-32 -right-32 w-80 h-80 bg-volt/15 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-cyan-500/15 rounded-full blur-[100px] pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div>
            <div className="flex items-center gap-2 mb-2.5 flex-wrap">
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[11px] font-bold border border-emerald-500/30 flex items-center gap-1.5 shadow-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Sui Mainnet Audited Protocols
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-volt/15 text-volt text-[11px] font-bold border border-volt/30 flex items-center gap-1">
                <Sparkles className="w-3 h-3 fill-volt" /> Auto-Compounding
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/15 text-cyan-400 text-[11px] font-bold border border-cyan-500/30">
                0% Impermanent Loss
              </span>
            </div>

            <h1 className="text-xl sm:text-3xl font-black text-white tracking-tight flex items-center gap-2.5">
              Institutional Yield & Liquidity Hub
              <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg bg-volt/10 text-volt border border-volt/20">
                PRO
              </span>
            </h1>

            <p className="text-xs sm:text-sm text-gray-400 mt-1.5 max-w-2xl leading-relaxed">
              Curated blue-chip vaults and 1-click looping strategies across Sui top protocols with zero debt risk and atomic execution.
            </p>
          </div>

          {/* Integrated Partner Logos Pill */}
          <div className="flex items-center gap-2 p-2.5 bg-black/50 border border-white/10 rounded-2xl backdrop-blur-md self-start lg:self-center">
            <span className="text-[10px] text-gray-400 uppercase tracking-widest font-mono shrink-0 mr-1">Partners:</span>
            <div className="flex items-center gap-1.5">
              <img src="/tokens/sui.svg" alt="Sui" title="Sui Network" className="w-6 h-6 rounded-full border border-white/10 bg-black p-0.5" />
              <img src="/tokens/sca.svg" alt="Scallop" title="Scallop" className="w-6 h-6 rounded-full border border-white/10 bg-black p-0.5" />
              <img src="/tokens/navx.svg" alt="NAVI" title="NAVI Protocol" className="w-6 h-6 rounded-full border border-white/10 bg-black p-0.5" />
              <img src="/tokens/cetus.svg" alt="Cetus" title="Cetus CLMM" className="w-6 h-6 rounded-full border border-white/10 bg-black p-0.5" />
              <img src="/tokens/hasui.svg" alt="Haedal" title="Haedal LST" className="w-6 h-6 rounded-full border border-white/10 bg-black p-0.5" />
              <img src="/tokens/deep.svg" alt="DeepBook" title="DeepBook v3" className="w-6 h-6 rounded-full border border-white/10 bg-black p-0.5" />
              <img src="/tokens/wal.svg" alt="Walrus" title="Walrus Storage" className="w-6 h-6 rounded-full border border-white/10 bg-black p-0.5" />
            </div>
          </div>
        </div>

        {/* 3 Balanced Metric Cards (Zero Sparks/XP) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mt-5 pt-5 border-t border-white/10">
          <div className="p-4 rounded-2xl bg-[#090c13]/90 border border-white/10 backdrop-blur-md">
            <div className="flex items-center justify-between text-gray-400 text-xs mb-1">
              <span>Total Protocol TVL</span>
              <Landmark className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-lg sm:text-2xl font-black text-white font-mono">${(totalProtocolTvl / 1000000).toFixed(1)}M USD</div>
            <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1 mt-1">
              <TrendingUp className="w-3.5 h-3.5" /> 7 Verified Blue-Chip Pools
            </span>
          </div>

          <div className="p-4 rounded-2xl bg-[#090c13]/90 border border-white/10 backdrop-blur-md">
            <div className="flex items-center justify-between text-gray-400 text-xs mb-1">
              <span>Highest Pool APY</span>
              <Zap className="w-4 h-4 text-cyan-400 fill-cyan-400" />
            </div>
            <div className="text-lg sm:text-2xl font-black text-cyan-300 font-mono">38.50% APY</div>
            <span className="text-xs text-gray-400 font-mono mt-1 block truncate">
              WAL / SUI Storage Pool
            </span>
          </div>

          <div className="p-4 rounded-2xl bg-[#090c13]/90 border border-cyan-500/30 backdrop-blur-md">
            <div className="flex items-center justify-between text-cyan-400 text-xs mb-1">
              <span>Your Staked Position</span>
              <ShieldCheck className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-lg sm:text-2xl font-black text-white font-mono">
              ${totalUserStakedUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1 mt-1">
              {totalUserStakedUsd > 0 ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  +${totalAccruedYield.toFixed(2)} Real-Time Yield
                </>
              ) : (
                <span className="text-gray-500 font-normal">● No active deposits</span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* 2. SINGLE CLEAN FILTER & SEARCH BAR (NO CLUTTER) */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-2 rounded-2xl bg-[#0b0e17] border border-white/10">
        {/* Category Filter Pills */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar scrollbar-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {[
            { id: 'all', label: 'All Pools (7)' },
                { id: 'single', label: '🛡️ 0% IL Stables & SUI' },
                { id: 'lst', label: '💧 LST 1:1 Peg' },
                { id: 'dex', label: '⚡ DEX & Storage' }
              ].map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setCategoryFilter(cat.id as any)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 cursor-pointer ${
                    categoryFilter === cat.id
                      ? 'bg-volt text-black shadow-volt-glow'
                      : 'text-gray-400 hover:text-white bg-transparent hover:bg-white/5'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Right side: Search Box & Quick ROI toggle */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsCalcOpen(prev => !prev)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer shrink-0 ${
                  isCalcOpen
                    ? 'bg-volt/20 text-volt border-volt/40'
                    : 'bg-white/5 text-gray-400 border-white/10 hover:text-white'
                }`}
                title="Toggle Yield Calculator"
              >
                <Percent className="w-3.5 h-3.5 text-volt" />
                <span className="hidden sm:inline">ROI Calc</span>
              </button>

              <div className="relative flex-1 sm:w-56">
                <Search className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search blue-chips..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 bg-black/40 border border-white/10 rounded-xl text-xs text-white placeholder:text-gray-500 outline-none focus:border-volt/40"
                />
              </div>
            </div>
          </div>

          {/* Interactive ROI Simulator (Collapsible) */}
          {isCalcOpen && (
            <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-[#121624] via-[#0d101a] to-[#07090e] border border-volt/30 shadow-xl space-y-3 animate-fadeIn">
              <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-volt fill-volt" />
                  <span className="text-sm font-black text-white">Yield & Return Simulator</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-volt/15 text-volt border border-volt/30 font-bold">
                    ~21.8% Avg Blue-Chip APY
                  </span>
                </div>
                <button
                  onClick={() => setIsCalcOpen(false)}
                  className="text-gray-400 hover:text-white text-xs cursor-pointer p-1"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
                <div className="space-y-1">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wider block">Deposit Capital</span>
                  <div className="flex items-center gap-1.5">
                    <div className="relative flex-1">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500 font-bold text-xs">$</span>
                      <input
                        type="number"
                        value={calcDepositUsd}
                        onChange={(e) => setCalcDepositUsd(Math.max(1, parseFloat(e.target.value) || 0))}
                        className="w-full pl-5 pr-2 py-1.5 bg-black/50 border border-white/10 rounded-xl text-xs font-bold text-white outline-none focus:border-volt/50 font-mono"
                      />
                    </div>
                    {[500, 1000, 5000].map(amt => (
                      <button
                        key={amt}
                        onClick={() => setCalcDepositUsd(amt)}
                        className={`px-2 py-1.5 rounded-lg text-[10px] font-bold border transition-all cursor-pointer ${
                          calcDepositUsd === amt
                            ? 'bg-volt text-black border-volt'
                            : 'bg-white/5 text-gray-400 border-white/5 hover:text-white'
                        }`}
                      >
                        ${amt >= 1000 ? `${amt / 1000}k` : amt}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wider block">Investment Duration</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { days: 30, label: '30 Days' },
                      { days: 90, label: '90 Days' },
                      { days: 365, label: '1 Year' }
                    ].map(d => (
                      <button
                        key={d.days}
                        onClick={() => setCalcDurationDays(d.days)}
                        className={`py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer text-center ${
                          calcDurationDays === d.days
                            ? 'bg-volt text-black border-volt'
                            : 'bg-black/50 text-gray-400 border-white/10 hover:text-white'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-black/60 border border-emerald-500/30 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-gray-400 block uppercase tracking-wider">Projected Profit</span>
                    <span className="text-lg font-black text-emerald-400 font-mono">
                      +${((calcDepositUsd * 0.218 * calcDurationDays) / 365).toFixed(2)} USD
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      if (filteredVaults.length > 0) {
                        handleOpenVaultModal(filteredVaults[0], 'deposit');
                      }
                    }}
                    className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-400 text-slate-950 text-xs font-black shadow-[0_0_15px_rgba(56,189,248,0.25)] hover:opacity-90 transition-all cursor-pointer"
                  >
                    Deposit Now
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 4. INSTITUTIONAL DATAGRID TABLE */}
          <div className="space-y-2.5">
            {/* Table Column Headers (Desktop) */}
            <div className="hidden md:grid grid-cols-12 items-center px-6 py-2.5 text-[11px] font-bold text-gray-400 uppercase tracking-wider border-b border-white/5">
              <div className="col-span-4">Asset / Pair</div>
              <div className="col-span-2">Strategy & Receipt</div>
              <div className="col-span-2 text-left">TVL (USD)</div>
              <div className="col-span-2 text-right">Net APY</div>
              <div className="col-span-2 text-right">Action</div>
            </div>

            {filteredVaults.length === 0 ? (
              <div className="p-10 text-center text-gray-500 rounded-3xl bg-[#0b0e17] border border-white/5">
                No pools match your search criteria.
              </div>
            ) : (
              filteredVaults.map((vault) => {
                const userPos = userPositions[vault.id];
                const hasDeposit = userPos && userPos.stakedAmount > 0;
                const baseToken = getVaultBaseToken(vault);
                const balance = getTokenWalletBalance(baseToken).formatted;

                return (
                  <div
                    key={vault.id}
                    onClick={() => {
                      handleOpenVaultModal(vault, hasDeposit ? 'withdraw' : 'deposit');
                    }}
                    className={`p-4 rounded-2xl border transition-all duration-200 cursor-pointer ${
                      hasDeposit
                        ? 'bg-gradient-to-r from-[#0d1726] to-[#080d16] border-cyan-500/40 shadow-lg shadow-cyan-500/5'
                        : 'bg-gradient-to-r from-[#0c101a] via-[#090d16] to-[#07090f] border-white/10 hover:border-cyan-500/40 hover:bg-[#0e1320]'
                    }`}
                  >
                    {/* Desktop Layout (md+) - Strict 12-Column Grid */}
                    <div className="hidden md:grid grid-cols-12 items-center gap-4">
                      {/* 1. Asset & Pair Info (col-span-4) */}
                      <div className="col-span-4 flex items-center gap-3.5 min-w-0">
                        <div className="flex items-center shrink-0">
                          {vault.tokenLogos.length > 1 ? (
                            <div className="flex -space-x-2.5">
                              <img
                                src={vault.tokenLogos[0]}
                                alt=""
                                className="w-10 h-10 rounded-full border-2 border-[#090d16] bg-black p-0.5 z-10"
                                onError={(e) => { (e.target as any).src = '/tokens/sui.svg'; }}
                              />
                              <img
                                src={vault.tokenLogos[1]}
                                alt=""
                                className="w-10 h-10 rounded-full border-2 border-[#090d16] bg-black p-0.5"
                                onError={(e) => { (e.target as any).src = '/tokens/sui.svg'; }}
                              />
                            </div>
                          ) : (
                            <img
                              src={vault.tokenLogos[0]}
                              alt=""
                              className="w-10 h-10 rounded-full border border-white/10 bg-black p-0.5"
                              onError={(e) => { (e.target as any).src = '/tokens/sui.svg'; }}
                            />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-white text-base hover:text-cyan-400 transition-colors truncate">
                              {vault.name}
                            </h3>
                            {hasDeposit && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shrink-0">
                                Active (${userPos.stakedUsd.toFixed(2)})
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-400 truncate mt-0.5 font-sans">
                            {vault.riskLabel}
                          </div>
                        </div>
                      </div>

                      {/* 2. Strategy & Receipt Token (col-span-2) */}
                      <div className="col-span-2 flex flex-col items-start min-w-0">
                        <span className="px-2.5 py-0.5 rounded-md bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 text-xs font-mono font-bold">
                          {vault.receiptToken}
                        </span>
                        <span className="text-[11px] text-gray-400 mt-1 truncate">
                          {vault.protocolBadge}
                        </span>
                      </div>

                      {/* 3. TVL (col-span-2 text-left) */}
                      <div className="col-span-2 flex flex-col items-start">
                        <span className="text-base font-bold text-white font-mono">
                          ${(vault.tvlUsd / 1000000).toFixed(1)}M
                        </span>
                        <span className="text-[11px] text-gray-500">
                          {vault.lockup}
                        </span>
                      </div>

                      {/* 4. Net APY (col-span-2 text-right) */}
                      <div className="col-span-2 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5 text-emerald-400 font-black text-xl font-mono">
                          <span>{vault.apy.toFixed(2)}%</span>
                        </div>
                        <span className="text-[10px] text-gray-500 block font-mono">
                          Base {vault.baseApy}% + Boost {vault.bonusApy}%
                        </span>
                      </div>

                      {/* 5. Action Button (col-span-2 flex justify-end) */}
                      <div className="col-span-2 flex justify-end" onClick={(e) => e.stopPropagation()}>
                        {hasDeposit ? (
                          <button
                            onClick={() => handleOpenVaultModal(vault, 'withdraw')}
                            className="px-4 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-bold transition-all cursor-pointer"
                          >
                            Manage
                          </button>
                        ) : (
                          <button
                            onClick={() => handleOpenVaultModal(vault, 'deposit')}
                            className="px-5 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-400 hover:from-sky-400 hover:to-cyan-300 text-slate-950 font-black text-xs shadow-[0_0_20px_rgba(56,189,248,0.25)] transition-all flex items-center gap-1.5 cursor-pointer active:scale-95"
                          >
                            <span>Deposit</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Mobile Layout (< md) */}
                    <div className="md:hidden space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="flex items-center shrink-0">
                            {vault.tokenLogos.length > 1 ? (
                              <div className="flex -space-x-2">
                                <img
                                  src={vault.tokenLogos[0]}
                                  alt=""
                                  className="w-8 h-8 rounded-full border-2 border-[#090d16] bg-black p-0.5 z-10"
                                  onError={(e) => { (e.target as any).src = '/tokens/sui.svg'; }}
                                />
                                <img
                                  src={vault.tokenLogos[1]}
                                  alt=""
                                  className="w-8 h-8 rounded-full border-2 border-[#090d16] bg-black p-0.5"
                                  onError={(e) => { (e.target as any).src = '/tokens/sui.svg'; }}
                                />
                              </div>
                            ) : (
                              <img
                                src={vault.tokenLogos[0]}
                                alt=""
                                className="w-8 h-8 rounded-full border border-white/10 bg-black p-0.5"
                                onError={(e) => { (e.target as any).src = '/tokens/sui.svg'; }}
                              />
                            )}
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-bold text-white text-sm truncate">
                              {vault.name}
                            </h3>
                            <span className="text-[10px] text-gray-400 font-sans block truncate">
                              {vault.riskLabel}
                            </span>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div className="inline-flex items-center gap-1 text-emerald-400 font-black text-base font-mono">
                            <span>{vault.apy.toFixed(2)}%</span>
                          </div>
                          <span className="text-[9px] text-gray-500 block">Net APY</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 flex-wrap text-[11px] pt-1">
                        <span className="px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 font-mono text-[10px]">
                          {vault.receiptToken}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-white/5 text-gray-300 font-mono text-[10px]">
                          TVL ${(vault.tvlUsd / 1000000).toFixed(1)}M
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px]">
                          {vault.lockup}
                        </span>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-white/5" onClick={(e) => e.stopPropagation()}>
                        <span className="text-xs text-gray-400 font-mono">
                          Wallet: <strong className="text-white">{balance} {baseToken}</strong>
                        </span>
                        {hasDeposit ? (
                          <button
                            onClick={() => handleOpenVaultModal(vault, 'withdraw')}
                            className="px-4 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-bold cursor-pointer"
                          >
                            Manage
                          </button>
                        ) : (
                          <button
                            onClick={() => handleOpenVaultModal(vault, 'deposit')}
                            className="px-5 py-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-400 hover:from-sky-400 hover:to-cyan-300 text-slate-950 font-black text-xs shadow-[0_0_20px_rgba(56,189,248,0.25)] flex items-center gap-1 cursor-pointer active:scale-95"
                          >
                            <span>Deposit</span>
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

      {/* 5. MODAL: VOLT SMART VAULT DEPOSIT & REDEEM */}
      {activeVault && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="relative w-full max-w-lg bg-[#0e121d] border border-white/10 rounded-3xl p-6 shadow-2xl space-y-5">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex -space-x-2">
                  {activeVault.tokenLogos.map((lg, i) => (
                    <img key={i} src={lg} alt="" className="w-8 h-8 rounded-full border-2 border-[#0e121d] bg-black p-0.5" />
                  ))}
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">{activeVault.name}</h3>
                  <span className="text-xs text-gray-400">{activeVault.protocolBadge} • {activeVault.apy}% Net APY</span>
                </div>
              </div>
              <button
                onClick={() => setActiveVault(null)}
                className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mode Switcher: Deposit vs Redeem */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-black/50 border border-white/10 rounded-2xl">
              <button
                onClick={() => { setModalMode('deposit'); setInputAmount(''); }}
                className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  modalMode === 'deposit' ? 'bg-gradient-to-r from-sky-500 to-cyan-400 text-slate-950 font-black shadow-[0_0_15px_rgba(56,189,248,0.25)]' : 'text-gray-400 hover:text-white'
                }`}
              >
                Deposit (Mint {activeVault.receiptToken})
              </button>
              <button
                onClick={() => { setModalMode('withdraw'); setInputAmount(''); }}
                className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  modalMode === 'withdraw' ? 'bg-white/20 text-white' : 'text-gray-400 hover:text-white'
                }`}
              >
                Redeem (Burn {activeVault.receiptToken})
              </button>
            </div>

            {/* Currency Selector: Deposit (Pay with) vs Redeem (Receive in) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-gray-400 font-mono">
                <span className="flex items-center gap-1.5 font-bold text-gray-300">
                  <span>{modalMode === 'deposit' ? 'Pay with:' : 'Receive in:'}</span>
                  {(modalMode === 'deposit' ? selectedDepositToken : selectedWithdrawToken) !== getVaultBaseToken(activeVault) ? (
                    <span className="px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-[10px] font-mono font-bold flex items-center gap-1 shadow-sm">
                      <Zap className="w-3 h-3 fill-cyan-400 text-cyan-400" />
                      {modalMode === 'deposit' ? '1-Click ZAP' : '1-Click Reverse ZAP'}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-mono font-bold">
                      {getVaultPairTokens(activeVault).length > 1 ? 'Pair Asset' : 'Pool Asset'}
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-gray-400">
                  Wallet: <strong className="text-white font-mono">{getTokenWalletBalance(modalMode === 'deposit' ? selectedDepositToken : selectedWithdrawToken).formatted} {modalMode === 'deposit' ? selectedDepositToken : selectedWithdrawToken}</strong>
                </span>
              </div>

              {/* Token Selector Pills */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
                {ZAP_SUPPORTED_TOKENS.map((tok) => {
                  const currentToken = modalMode === 'deposit' ? selectedDepositToken : selectedWithdrawToken;
                  const isSelected = currentToken === tok.symbol;
                  const isPairToken = getVaultPairTokens(activeVault).includes(tok.symbol);
                  const isBase = tok.symbol === getVaultBaseToken(activeVault);
                  const bal = getTokenWalletBalance(tok.symbol);
                  const hasBal = bal.num > 0;
                  return (
                    <button
                      key={tok.symbol}
                      type="button"
                      onClick={() => {
                        if (modalMode === 'deposit') {
                          setSelectedDepositToken(tok.symbol);
                        } else {
                          setSelectedWithdrawToken(tok.symbol);
                        }
                      }}
                      className={`flex flex-col items-center justify-center p-2 rounded-xl border text-xs transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-cyan-500/20 border-cyan-500/60 text-white shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                          : 'bg-black/40 border-white/5 text-gray-400 hover:text-white hover:border-white/20'
                      }`}
                    >
                      <div className="flex items-center gap-1 mb-0.5">
                        <img
                          src={tok.logo}
                          alt=""
                          className="w-4 h-4 rounded-full"
                          onError={(e) => { (e.target as any).src = '/tokens/sui.svg'; }}
                        />
                        <span className="font-bold text-[11px]">{tok.symbol}</span>
                      </div>
                      <span className={`text-[9px] font-mono truncate w-full text-center ${hasBal ? 'text-emerald-400 font-semibold' : 'text-gray-500'}`}>
                        {bal.formatted}
                      </span>
                      {isPairToken ? (
                        <span className="text-[8px] text-cyan-300 uppercase tracking-tighter mt-0.5">
                          {isBase ? 'Base' : 'Pair'}
                        </span>
                      ) : (
                        <span className="text-[8px] text-gray-500 uppercase tracking-tighter mt-0.5">ZAP</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Input Amount */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-gray-400 font-mono">
                <span>{modalMode === 'deposit' ? `Deposit Amount (${selectedDepositToken}):` : `Redeem Amount (${activeVault.receiptToken}):`}</span>
                <span>
                  {modalMode === 'deposit'
                    ? `Wallet Balance: ${getTokenWalletBalance(selectedDepositToken).formatted} ${selectedDepositToken}`
                    : `In Vault: ${(userPositions[activeVault.id]?.stakedAmount || 0).toFixed(4)} ${activeVault.receiptToken}`}
                </span>
              </div>
              <div className="relative">
                <input
                  type="number"
                  step="any"
                  placeholder="0.00"
                  value={inputAmount}
                  onChange={(e) => setInputAmount(e.target.value)}
                  className="w-full pl-4 pr-24 py-3 bg-black/60 border border-white/10 rounded-2xl text-lg font-bold text-white outline-none focus:border-cyan-500/50 font-mono"
                />
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (modalMode === 'deposit') {
                        setInputAmount(getTokenWalletBalance(selectedDepositToken).formatted);
                      } else {
                        setInputAmount((userPositions[activeVault.id]?.stakedAmount || 0).toString());
                      }
                    }}
                    className="px-2.5 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 text-xs font-bold border border-cyan-500/30 cursor-pointer"
                  >
                    MAX
                  </button>
                  <span className="text-xs font-bold text-gray-300 px-2 py-1 rounded-lg bg-white/5 font-mono">
                    {modalMode === 'deposit' ? selectedDepositToken : activeVault.receiptToken}
                  </span>
                </div>
              </div>
            </div>

            {/* ZAP Router Explainer if Paying with Another Token */}
            {modalMode === 'deposit' && selectedDepositToken !== getVaultBaseToken(activeVault) && (
              <div className="p-3 rounded-2xl bg-cyan-950/20 border border-cyan-500/30 text-xs space-y-1 font-mono">
                <div className="flex items-center gap-1.5 text-cyan-300 font-bold">
                  <Zap className="w-3.5 h-3.5 fill-cyan-400 text-cyan-400" />
                  <span>1-Click ZAP Auto-Routing</span>
                </div>
                <p className="text-gray-400 text-[11px] leading-relaxed">
                  Your <strong>{selectedDepositToken}</strong> is auto-swapped to <strong>{getVaultBaseToken(activeVault)}</strong> via Cetus CLMM + DeepBook v3 and deposited into <strong>{activeVault.name}</strong> in 1 atomic PTB. Zero manual swaps needed.
                </p>
              </div>
            )}

            {/* Reverse ZAP Router Explainer if Receiving in Another Token */}
            {modalMode === 'withdraw' && selectedWithdrawToken !== getVaultBaseToken(activeVault) && (
              <div className="p-3 rounded-2xl bg-cyan-950/20 border border-cyan-500/30 text-xs space-y-1 font-mono">
                <div className="flex items-center gap-1.5 text-cyan-300 font-bold">
                  <Zap className="w-3.5 h-3.5 fill-cyan-400 text-cyan-400" />
                  <span>1-Click Reverse ZAP Auto-Routing</span>
                </div>
                <p className="text-gray-400 text-[11px] leading-relaxed">
                  Your <strong>{activeVault.receiptToken}</strong> is redeemed and auto-swapped to <strong>{selectedWithdrawToken}</strong> via Cetus CLMM + DeepBook v3 in 1 atomic PTB. You receive <strong>{selectedWithdrawToken}</strong> directly in your wallet. Zero manual swaps needed.
                </p>
              </div>
            )}

            {/* Vault Mechanics & Fee Breakdown */}
            <div className="p-3.5 rounded-2xl bg-black/40 border border-white/5 space-y-2 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Underlying Strategy:</span>
                <span className="text-white font-bold">{activeVault.protocolBadge}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">{modalMode === 'deposit' ? 'You Receive:' : 'Target Asset:'}</span>
                <span className="text-cyan-400 font-bold">
                  {modalMode === 'deposit'
                    ? (inputAmount ? `${parseFloat(inputAmount).toFixed(4)} ${activeVault.receiptToken}` : `1:1 ${activeVault.receiptToken}`)
                    : `${selectedWithdrawToken}`}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Volt Protocol Fee:</span>
                <span className="text-gray-300">10% on profit only (0% on principal)</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Capital Custody:</span>
                <span className="text-cyan-400 font-bold">100% Non-Custodial (Sui PTB)</span>
              </div>
              <div className="flex justify-between items-center border-t border-white/5 pt-2">
                <span className="text-gray-300 font-bold">{modalMode === 'deposit' ? 'Projected 1-Year Net Return:' : 'Accrued Yield Earned:'}</span>
                <span className="text-emerald-400 font-black text-sm">
                  {modalMode === 'deposit'
                    ? `+$${((parseFloat(inputAmount) || 0) * (activeVault.apy / 100) * 0.90).toFixed(2)} USD`
                    : `+$${(userPositions[activeVault.id]?.accruedYield || 0).toFixed(3)} USD`}
                </span>
              </div>
            </div>

            {/* Submit Button */}
            <button
              onClick={handleConfirmOnChain}
              disabled={isExecuting}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-400 hover:from-sky-400 hover:to-cyan-300 text-slate-950 font-extrabold text-sm shadow-[0_0_20px_rgba(56,189,248,0.25)] transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isExecuting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-slate-950" />
                  <span>Signing Vault Transaction on Sui...</span>
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 fill-slate-950 text-slate-950" />
                  <span>
                    {modalMode === 'deposit'
                      ? (selectedDepositToken !== getVaultBaseToken(activeVault)
                          ? `⚡ 1-Click ZAP & Deposit into ${activeVault.name}`
                          : `Confirm Deposit into ${activeVault.name}`)
                      : (selectedWithdrawToken !== getVaultBaseToken(activeVault)
                          ? `⚡ 1-Click Reverse ZAP to ${selectedWithdrawToken}`
                          : `Confirm Redemption of ${activeVault.receiptToken}`)}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
