import React, { useState, useMemo } from 'react';
import {
  Trophy,
  Award,
  Crown,
  Users,
  Share2,
  Check,
  ExternalLink,
  Zap,
  TrendingUp,
  ShieldCheck,
  ChevronRight,
  Calculator,
  Flame,
  ArrowRight,
  Gift,
  Coins,
  Copy,
  MessageSquare,
  Send,
  FileText,
  Lock,
  Unlock,
  Clock,
  ArrowDownToLine,
  Search,
  Sparkles,
  CheckCircle2,
  Wallet
} from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { TRADER_TIERS, TraderTierConfig } from './constants';

export interface TierConfig {
  id: 'scout' | 'commander' | 'syndicate';
  name: string;
  level: number;
  badgeEmoji: string;
  revShare: number; // 50, 60, 70
  minRefs: number;
  maxRefs: number | null;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  badgeGlow: string;
  tagline: string;
  perks: string[];
}

export const TIERS: TierConfig[] = [
  {
    id: 'scout',
    name: 'Volt Scout',
    level: 1,
    badgeEmoji: '🥉',
    revShare: 25,
    minRefs: 1,
    maxRefs: 9,
    badgeBg: 'bg-amber-500/10',
    badgeBorder: 'border-amber-500/30',
    badgeText: 'text-amber-400',
    badgeGlow: 'shadow-[0_0_20px_rgba(245,158,11,0.15)]',
    tagline: 'Starter tier for individual traders & crypto circles',
    perks: [
      '25% instant protocol fee rev share on every swap',
      'Direct on-chain payout in swap token (USDC / SUI / etc.)',
      'Plankton rank (-20% fee) for all your invited referrals',
      'Real-time transaction confirmation on SuiScan'
    ]
  },
  {
    id: 'commander',
    name: 'Volt Commander',
    level: 2,
    badgeEmoji: '🥈',
    revShare: 35,
    minRefs: 10,
    maxRefs: 99,
    badgeBg: 'bg-cyan-500/10',
    badgeBorder: 'border-cyan-500/30',
    badgeText: 'text-cyan-400',
    badgeGlow: 'shadow-[0_0_20px_rgba(6,182,212,0.2)]',
    tagline: 'Empowered tier for Telegram channels, alpha callers & KOLs',
    perks: [
      '35% protocol fee rev share (+10% permanent bonus)',
      'Direct on-chain payout without any lockups or minimums',
      'Priority Whale Radar alerts feed in @volt_swap',
      'Dedicated Commander verified badge in Volt community'
    ]
  },
  {
    id: 'syndicate',
    name: 'Whale Syndicate',
    level: 3,
    badgeEmoji: '👑',
    revShare: 50,
    minRefs: 100,
    maxRefs: null,
    badgeBg: 'bg-volt/10',
    badgeBorder: 'border-volt/40',
    badgeText: 'text-volt',
    badgeGlow: 'shadow-[0_0_25px_rgba(215,246,38,0.25)]',
    tagline: 'Apex tier for large trading syndicates, DEX brokers & top communities',
    perks: [
      '50% maximum rev share (50/50 fee split with protocol)',
      'Custom vanity referral link (e.g. voltswap.org/?ref=alpha)',
      'Official Volt Protocol Ambassador status & co-marketing on @voltswap',
      'Direct routing integration for private broker volume'
    ]
  }
];

interface AffiliatesHubProps {
  onBackToSwap?: () => void;
}

export const AffiliatesHub: React.FC<AffiliatesHubProps> = ({ onBackToSwap }) => {
  const currentAccount = useCurrentAccount();
  const [hubTab, setHubTab] = useState<'trader' | 'affiliate'>('trader');
  const [copiedLink, setCopiedLink] = useState(false);
  const [vanityAlias, setVanityAlias] = useState('');

  // User Cumulative Trading Volume & Cashback
  const totalUserVolume = useMemo(() => {
    try {
      const saved = localStorage.getItem('volt_my_swaps');
      if (!saved) return 0;
      const list = JSON.parse(saved);
      return Array.isArray(list) ? list.reduce((acc: number, s: any) => acc + (s.volumeUsd || 0), 0) : 0;
    } catch (_) {
      return 0;
    }
  }, []);

  const totalCashbackEarned = useMemo(() => {
    try {
      const saved = localStorage.getItem('volt_my_swaps');
      if (!saved) return 0;
      const list = JSON.parse(saved);
      return Array.isArray(list) ? list.reduce((acc: number, s: any) => acc + (s.cashbackUsd || 0), 0) : 0;
    } catch (_) {
      return 0;
    }
  }, []);

  const socialUnlocked = useMemo(() => {
    try {
      return localStorage.getItem('volt_social_discount') === 'true';
    } catch (_) {
      return false;
    }
  }, []);

  const userTraderTier = useMemo(() => {
    if (totalUserVolume >= 1000000) return TRADER_TIERS[5]; // 👑 Leviathan ($1,000,000+)
    if (totalUserVolume >= 250000) return TRADER_TIERS[4];  // 🐋 Blue Whale ($250,000 - $1,000,000)
    if (totalUserVolume >= 50000) return TRADER_TIERS[3];   // 🦈 Shark ($50,000 - $250,000)
    if (totalUserVolume >= 10000) return TRADER_TIERS[2];   // 🐬 Dolphin ($10,000 - $50,000)
    if (totalUserVolume >= 1000 || socialUnlocked) return TRADER_TIERS[1]; // 🦐 Plankton
    return TRADER_TIERS[0]; // ⚪ Guest
  }, [totalUserVolume, socialUnlocked]);

  const nextTraderTier = useMemo(() => {
    if (userTraderTier.id === 'guest') return TRADER_TIERS[1];
    if (userTraderTier.id === 'plankton') return TRADER_TIERS[2];
    if (userTraderTier.id === 'dolphin') return TRADER_TIERS[3];
    if (userTraderTier.id === 'shark') return TRADER_TIERS[4];
    if (userTraderTier.id === 'whale') return TRADER_TIERS[5];
    return null;
  }, [userTraderTier]);

  const traderProgressPct = useMemo(() => {
    if (!nextTraderTier || !nextTraderTier.minVolumeUsd) return 100;
    if (userTraderTier.id === 'guest') {
      return Math.min(100, (totalUserVolume / 1000) * 100);
    }
    const prevMin = userTraderTier.minVolumeUsd;
    const target = nextTraderTier.minVolumeUsd;
    const range = target - prevMin;
    const current = totalUserVolume - prevMin;
    return Math.min(100, Math.max(0, (current / range) * 100));
  }, [userTraderTier, nextTraderTier, totalUserVolume]);
  
  // Stored or simulated referrals count
  const [simulatedRefs, setSimulatedRefs] = useState<number>(() => {
    const saved = localStorage.getItem('volt_affiliate_refs_count');
    return saved ? parseInt(saved, 10) : 1;
  });

  // Calculator State
  const [calcTraders, setCalcTraders] = useState<number>(15);
  const [calcVolumePerTrader, setCalcVolumePerTrader] = useState<number>(10000);

  // Determine current user tier
  const currentTier = useMemo(() => {
    if (simulatedRefs >= 100) return TIERS[2];
    if (simulatedRefs >= 10) return TIERS[1];
    return TIERS[0];
  }, [simulatedRefs]);

  // Next tier progress
  const nextTier = useMemo(() => {
    if (currentTier.id === 'scout') return TIERS[1];
    if (currentTier.id === 'commander') return TIERS[2];
    return null;
  }, [currentTier]);

  const progressPercent = useMemo(() => {
    if (currentTier.id === 'syndicate') return 100;
    if (currentTier.id === 'commander') {
      const current = simulatedRefs - 10;
      const target = 90; // 100 - 10
      return Math.min(100, Math.max(0, Math.round((current / target) * 100)));
    }
    // scout: 1 to 10
    return Math.min(100, Math.max(0, Math.round((simulatedRefs / 10) * 100)));
  }, [currentTier, simulatedRefs]);

  // Claimable Rewards & Analytics State (Threshold $10 USD)
  const [claimableBalance, setClaimableBalance] = useState<number>(() => {
    const saved = localStorage.getItem('volt_affiliate_claimable_usd');
    if (saved) return parseFloat(saved);
    return simulatedRefs >= 100 ? 142.85 : simulatedRefs >= 10 ? 28.50 : 6.40;
  });

  const [totalClaimed, setTotalClaimed] = useState<number>(() => {
    const saved = localStorage.getItem('volt_affiliate_total_claimed_usd');
    return saved ? parseFloat(saved) : 45.00;
  });

  const [isClaiming, setIsClaiming] = useState<boolean>(false);
  const [claimSuccessModal, setClaimSuccessModal] = useState<{ amount: number; txDigest: string } | null>(null);
  const [refSearchQuery, setRefSearchQuery] = useState<string>('');
  const [activeRefSubTab, setActiveRefSubTab] = useState<'traders' | 'feed'>('traders');

  // Pagination states (5 items per page)
  const [tradersPage, setTradersPage] = useState<number>(1);
  const [feedPage, setFeedPage] = useState<number>(1);
  const PAGE_SIZE = 5;

  // Referred Traders Roster (LTV Breakdown)
  const [referralTraders, setReferralTraders] = useState(() => [
    {
      address: '0x7211...ab12',
      fullAddress: '0x7211d7a33c32b8a848fd5d87dc0630b7d40d3d324856a748aff454c2955cab12',
      tier: '🦐 Plankton',
      swapsCount: 14,
      totalVolumeUsd: 12450,
      earnedUsd: 7.78,
      lastActive: '5m ago'
    },
    {
      address: '0x3f4a...91ce',
      fullAddress: '0x3f4ae8b71234b8a848fd5d87dc0630b7d40d3d324856a748aff454c2955c91ce',
      tier: '🦐 Plankton',
      swapsCount: 6,
      totalVolumeUsd: 4800,
      earnedUsd: 3.00,
      lastActive: '32m ago'
    },
    {
      address: '0x91bb...10a4',
      fullAddress: '0x91bb4c09d332b8a848fd5d87dc0630b7d40d3d324856a748aff454c2955c10a4',
      tier: '🐬 Dolphin',
      swapsCount: 22,
      totalVolumeUsd: 31200,
      earnedUsd: 19.50,
      lastActive: '2h ago'
    },
    {
      address: '0xbc41...77d8',
      fullAddress: '0xbc41e772d332b8a848fd5d87dc0630b7d40d3d324856a748aff454c2955c77d8',
      tier: '🦐 Plankton',
      swapsCount: 3,
      totalVolumeUsd: 1100,
      earnedUsd: 0.69,
      lastActive: '6h ago'
    },
    {
      address: '0x55aa...33b9',
      fullAddress: '0x55aa4819d332b8a848fd5d87dc0630b7d40d3d324856a748aff454c2955c33b9',
      tier: '🦐 Plankton',
      swapsCount: 8,
      totalVolumeUsd: 6200,
      earnedUsd: 3.88,
      lastActive: '12h ago'
    },
    {
      address: '0xd8e1...44ff',
      fullAddress: '0xd8e19c01d332b8a848fd5d87dc0630b7d40d3d324856a748aff454c2955c44ff',
      tier: '🦈 Shark',
      swapsCount: 41,
      totalVolumeUsd: 68500,
      earnedUsd: 42.81,
      lastActive: '1d ago'
    },
    {
      address: '0x10f7...88cc',
      fullAddress: '0x10f719ebd332b8a848fd5d87dc0630b7d40d3d324856a748aff454c2955c88cc',
      tier: '🐬 Dolphin',
      swapsCount: 17,
      totalVolumeUsd: 18400,
      earnedUsd: 11.50,
      lastActive: '1d ago'
    },
    {
      address: '0x44a2...99ee',
      fullAddress: '0x44a27f8cd332b8a848fd5d87dc0630b7d40d3d324856a748aff454c2955c99ee',
      tier: '🦐 Plankton',
      swapsCount: 5,
      totalVolumeUsd: 3200,
      earnedUsd: 2.00,
      lastActive: '2d ago'
    }
  ]);

  // Live Referral Swaps Feed
  const [referralFeed, setReferralFeed] = useState(() => [
    {
      id: 'rf-1',
      time: 'Just now',
      address: '0x7211...ab12',
      pair: 'SUI ➔ USDC',
      volumeUsd: 1250,
      feeUsd: 3.12,
      earnedUsd: 0.78,
      digest: 'E2y4mQv8W9Lp3xKz88nB477a1'
    },
    {
      id: 'rf-2',
      time: '18m ago',
      address: '0x3f4a...91ce',
      pair: 'DEEP ➔ SUI',
      volumeUsd: 800,
      feeUsd: 2.00,
      earnedUsd: 0.50,
      digest: '7XqB5z2nKm9yW1vR34pT91d2'
    },
    {
      id: 'rf-3',
      time: '45m ago',
      address: '0x91bb...10a4',
      pair: 'SUI ➔ WAL',
      volumeUsd: 4500,
      feeUsd: 11.25,
      earnedUsd: 2.81,
      digest: '9HjR7k2mLp4qW8zC55sX84c3'
    },
    {
      id: 'rf-4',
      time: '2h ago',
      address: '0xbc41...77d8',
      pair: 'CETUS ➔ USDC',
      volumeUsd: 600,
      feeUsd: 1.50,
      earnedUsd: 0.38,
      digest: '4PnT3x8wZc6mL2yQ11rV29e4'
    },
    {
      id: 'rf-5',
      time: '4h ago',
      address: '0x55aa...33b9',
      pair: 'SUI ➔ DEEP',
      volumeUsd: 1500,
      feeUsd: 3.75,
      earnedUsd: 0.94,
      digest: '3JmK9p4xVc8qL1zT77sN51b2'
    },
    {
      id: 'rf-6',
      time: '7h ago',
      address: '0xd8e1...44ff',
      pair: 'USDC ➔ SUI',
      volumeUsd: 8200,
      feeUsd: 20.50,
      earnedUsd: 5.12,
      digest: '8YtP2w7nMc5mL9xR44qK62c3'
    },
    {
      id: 'rf-7',
      time: '12h ago',
      address: '0x10f7...88cc',
      pair: 'WAL ➔ SUI',
      volumeUsd: 2400,
      feeUsd: 6.00,
      earnedUsd: 1.50,
      digest: '6BvL4m8xZk2pQ9tW11sY73d4'
    },
    {
      id: 'rf-8',
      time: '1d ago',
      address: '0x44a2...99ee',
      pair: 'SUI ➔ CETUS',
      volumeUsd: 950,
      feeUsd: 2.38,
      earnedUsd: 0.59,
      digest: '2KpX7z1nWm8yL4vR55pT84e5'
    }
  ]);

  // Simulate incoming referral swap
  const handleSimulateSwap = () => {
    const swapVol = 1000;
    const feeUsd = swapVol * 0.0025; // 0.25% average fee
    const cutUsd = feeUsd * (currentTier.revShare / 100);
    const newBal = Number((claimableBalance + cutUsd).toFixed(2));
    setClaimableBalance(newBal);
    localStorage.setItem('volt_affiliate_claimable_usd', newBal.toFixed(2));

    const newEvent = {
      id: 'rf-' + Date.now(),
      time: 'Just now',
      address: '0x7211...ab12',
      pair: 'SUI ➔ USDC',
      volumeUsd: swapVol,
      feeUsd: feeUsd,
      earnedUsd: cutUsd,
      digest: '5KqT9w' + Math.random().toString(36).substring(2, 7) + '88xP'
    };
    setReferralFeed(prev => [newEvent, ...prev.slice(0, 9)]);

    // Update trader
    setReferralTraders(prev => prev.map(t => {
      if (t.address === '0x7211...ab12') {
        return {
          ...t,
          swapsCount: t.swapsCount + 1,
          totalVolumeUsd: t.totalVolumeUsd + swapVol,
          earnedUsd: Number((t.earnedUsd + cutUsd).toFixed(2)),
          lastActive: 'Just now'
        };
      }
      return t;
    }));
  };

  // Claim All Handler
  const handleClaimAll = () => {
    if (claimableBalance < 10.00 || isClaiming) return;
    setIsClaiming(true);
    setTimeout(() => {
      const amountClaimed = claimableBalance;
      const newTotal = Number((totalClaimed + amountClaimed).toFixed(2));
      setTotalClaimed(newTotal);
      setClaimableBalance(0);
      setIsClaiming(false);
      localStorage.setItem('volt_affiliate_claimable_usd', '0.00');
      localStorage.setItem('volt_affiliate_total_claimed_usd', newTotal.toFixed(2));
      setClaimSuccessModal({
        amount: amountClaimed,
        txDigest: '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
      });
    }, 1200);
  };

  // Filtered & Paginated Traders (5 per page)
  const filteredTraders = useMemo(() => {
    if (!refSearchQuery.trim()) return referralTraders;
    const q = refSearchQuery.toLowerCase();
    return referralTraders.filter(t => t.address.toLowerCase().includes(q) || t.fullAddress.toLowerCase().includes(q));
  }, [referralTraders, refSearchQuery]);

  const totalTradersPages = Math.max(1, Math.ceil(filteredTraders.length / PAGE_SIZE));
  const paginatedTraders = useMemo(() => {
    const start = (tradersPage - 1) * PAGE_SIZE;
    return filteredTraders.slice(start, start + PAGE_SIZE);
  }, [filteredTraders, tradersPage]);

  // Paginated Feed (5 per page)
  const totalFeedPages = Math.max(1, Math.ceil(referralFeed.length / PAGE_SIZE));
  const paginatedFeed = useMemo(() => {
    const start = (feedPage - 1) * PAGE_SIZE;
    return referralFeed.slice(start, start + PAGE_SIZE);
  }, [referralFeed, feedPage]);

  // Personal referral link
  const refCode = vanityAlias.trim() || (currentAccount ? currentAccount.address : 'partner');
  const referralUrl = `https://voltswap.org/?ref=${refCode}`;

  const copyRefLink = () => {
    navigator.clipboard.writeText(referralUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const shareOnX = () => {
    const text = encodeURIComponent(
      `⚡ Trade on @voltswap with the lowest fees on Sui (0.03%), live whale radar & DeepBook v3 routing.\n\nUse my link for a permanent 20% fee discount:\n${referralUrl}`
    );
    window.open(`https://twitter.com/intent/tweet?text=${text}`, '_blank');
  };

  const shareOnTelegram = () => {
    const text = encodeURIComponent(
      `⚡ Swap on Volt Protocol (@volt_swap) — premier Sui aggregator with on-chain Whale Radar & 20% permanent fee discount via my link:\n${referralUrl}`
    );
    window.open(`https://t.me/share/url?url=${encodeURIComponent(referralUrl)}&text=${text}`, '_blank');
  };

  // Promo Marketing Templates
  const [activeTemplate, setActiveTemplate] = useState<'tg' | 'x' | 'chat'>('tg');
  const [copiedTemplate, setCopiedTemplate] = useState<string | null>(null);

  const telegramPostText = `⚡️ Premier Smart Trading Terminal on Sui — Volt Protocol

If you swap $SUI, $DEEP, $NS, or meme tokens through standalone Cetus or Turbos pools, you lose up to 1.5% in hidden slippage (MEV/Price Impact).

Volt Protocol solves this at the Move PTB architecture layer:
• Split-Routing: Splits orders across DeepBook v3 CLOB and AMM liquidity pools in a single atomic transaction.
• Real-Time Whale Radar: Tracks smart-money accumulation clusters with 1-click execution.
• Limit Orders, DCA, and Perps Margin with zero slippage.

🎁 Use my referral link to get a permanent 20% discount on protocol fees:
👉 ${referralUrl}

Alerts: @volt_swap | X: @voltswap`;

  const xPostText = `Why swapping on a single AMM pool on @SuiNetwork is officially obsolete:

On a 10,000 $SUI swap:
❌ Single AMM pool: -1.42% price impact ($8,858 received)
✅ @voltswap atomic PTB split: 0.04% slippage ($8,982 received)
💰 Net saved: +$124 in a single 390ms transaction!

Volt dynamically routes across @DeepBookonSui CLOB + concentrated AMMs and includes a live Whale & Smart Money flow radar.

Get a permanent 20% fee discount using my referral link:
🔗 ${referralUrl}`;

  const chatPostText = `Found the best routing price on Sui — Volt Protocol terminal (@volt_swap). Built-in Whale Radar + atomic order routing between DeepBook v3 and Cetus.

Grab this link for a 20% permanent fee discount:
${referralUrl}`;

  const copyTemplate = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedTemplate(id);
    setTimeout(() => setCopiedTemplate(null), 2000);
  };

  // Calculator outputs
  const calcTotalMonthlyVolume = calcTraders * calcVolumePerTrader;
  // Avg protocol fee rate = 0.25% base rate
  const calcTotalProtocolFee = calcTotalMonthlyVolume * 0.0025;
  const calcTier = calcTraders >= 100 ? TIERS[2] : calcTraders >= 10 ? TIERS[1] : TIERS[0];
  const calcMonthlyEarnings = (calcTotalProtocolFee * (calcTier.revShare / 100));
  const calcAnnualEarnings = calcMonthlyEarnings * 12;

  return (
    <div className="w-full max-w-6xl mx-auto space-y-7 pb-16 animate-fadeIn">
      {/* 2-TAB SEGMENTED SWITCHER: TRADER VOLUME RANKS vs AFFILIATE RANKS */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#121622] border border-white/10 rounded-3xl p-3 px-4 shadow-xl">
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => setHubTab('trader')}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-mono font-bold transition-all cursor-pointer ${
              hubTab === 'trader'
                ? 'bg-volt text-black shadow-volt-glow'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <TrendingUp className="w-4 h-4" /> 🐬 Trader Volume Ranks (Fee Discounts)
          </button>
          <button
            onClick={() => setHubTab('affiliate')}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-mono font-bold transition-all cursor-pointer ${
              hubTab === 'affiliate'
                ? 'bg-volt text-black shadow-volt-glow'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Trophy className="w-4 h-4" /> 🏆 Affiliate Ranks (25-50% RevShare)
          </button>
        </div>

        {onBackToSwap && (
          <button
            onClick={onBackToSwap}
            className="text-xs font-mono text-gray-400 hover:text-volt flex items-center gap-1 cursor-pointer transition-colors"
          >
            ← Back to Swap Terminal
          </button>
        )}
      </div>

      {/* VIEW 1: TRADER VOLUME LADDER & DIRECT CASHBACK */}
      {hubTab === 'trader' && (
        <div className="space-y-6">
          {/* TRADER OVERVIEW HERO */}
          <div className="bg-[#121622] border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
            <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
              <div className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <span className="px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-mono font-bold flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5" /> Sui Trader Volume Ladder
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-mono font-bold">
                    Up to -88% Fee Discount
                  </span>
                </div>

                <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                  Climb from <span className="text-emerald-400">Plankton</span> to <span className="text-volt">Leviathan</span>
                </h1>

                <p className="text-xs sm:text-sm text-gray-400 max-w-2xl leading-relaxed">
                  Every swap you execute on Volt Protocol automatically accumulates cumulative volume. As your volume grows across $1,000, $10,000, $50,000, $250,000 and $1,000,000+, your protocol fees drop down to 0.03% (lowest on Sui) with instant on-chain execution.
                </p>
              </div>

              {/* ACTIVE ACCOUNT BADGE CARD */}
              <div className="w-full lg:w-auto shrink-0 bg-[#0c0f17] border border-white/10 rounded-2xl p-4 sm:p-5 flex flex-col gap-3 min-w-[280px]">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-gray-400 uppercase tracking-wider">Your Trader Rank</span>
                  <span className={`text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full border ${userTraderTier.badgeBg} ${userTraderTier.badgeBorder} ${userTraderTier.badgeText}`}>
                    {userTraderTier.badgeEmoji} {userTraderTier.name}
                  </span>
                </div>

                <div className="flex items-baseline justify-between border-b border-white/5 pb-2.5">
                  <div>
                    <span className="text-2xl font-black text-white">
                      ${totalUserVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                    <span className="text-xs text-gray-400 font-mono ml-1">USD Volume</span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-emerald-400 font-bold font-mono">
                      -{userTraderTier.discountPct}%
                    </span>
                    <span className="text-[10px] text-gray-500 block font-mono">Fee Discount</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="text-gray-400">Next Rank:</span>
                    <span className="text-volt font-bold">
                      {nextTraderTier ? `${nextTraderTier.badgeEmoji} ${nextTraderTier.name} ($${nextTraderTier.minVolumeUsd.toLocaleString()})` : 'MAX RANK (👑 Leviathan)'}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-white/5 overflow-hidden border border-white/5">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-400 via-volt to-emerald-400 rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(5, Math.min(100, traderProgressPct))}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* TRADER TIERS MATRIX (6 CARDS IN 2 ROWS OF 3 WIDE CARDS) */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-extrabold text-white flex items-center gap-2">
                <Award className="w-5 h-5 text-volt" /> 6 Trader Volume Tiers & VIP Benefits
              </h3>
              <span className="text-xs font-mono text-gray-400 hidden sm:inline-block">
                On-Chain Volume Progression across 10 Sui DEXes
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {TRADER_TIERS.map((tier) => {
                const isCurrent = userTraderTier.id === tier.id;
                return (
                  <div
                    key={tier.id}
                    className={`rounded-3xl p-6 flex flex-col justify-between border transition-all ${
                      isCurrent
                        ? `${tier.badgeBg} ${tier.badgeBorder} ${tier.badgeGlow} scale-[1.02] border-2 shadow-2xl`
                        : 'bg-[#121622] border-white/10 hover:border-white/20 hover:bg-[#151a28]'
                    }`}
                  >
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-3xl">{tier.badgeEmoji}</span>
                        {isCurrent ? (
                          <span className="text-xs font-mono font-black bg-volt text-black px-3 py-1 rounded-full shadow-volt-glow">
                            CURRENT STATUS
                          </span>
                        ) : totalUserVolume >= tier.minVolumeUsd ? (
                          <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-0.5 rounded-full">
                            UNLOCKED
                          </span>
                        ) : null}
                      </div>

                      <div>
                        <h4 className="text-lg font-extrabold text-white">{tier.name}</h4>
                        <div className="text-sm text-volt font-mono font-bold mt-0.5">
                          {tier.nextTierVolumeUsd ? `$${tier.minVolumeUsd.toLocaleString()} – $${tier.nextTierVolumeUsd.toLocaleString()} USD` : `$${tier.minVolumeUsd.toLocaleString()}+ USD Volume`}
                        </div>
                      </div>

                      <div className="p-3.5 rounded-2xl bg-black/50 border border-white/10 space-y-2 text-xs font-mono">
                        <div className="flex justify-between items-center">
                          <span className="text-gray-400">Protocol Swap Fee:</span>
                          <span className="text-volt font-bold text-base">{(tier.feeRate * 100).toFixed(2)}%</span>
                        </div>
                        <div className="flex justify-between items-center pt-1 border-t border-white/5">
                          <span className="text-gray-400">Effective Discount:</span>
                          <span className="text-emerald-400 font-black text-sm">
                            {tier.discountPct > 0 ? `-${tier.discountPct}% Discount` : 'Base Standard'}
                          </span>
                        </div>
                      </div>

                      <p className="text-xs text-gray-300 leading-relaxed min-h-[36px]">
                        {tier.tagline}
                      </p>
                    </div>

                    <div className="mt-5 pt-3.5 border-t border-white/10 text-xs font-mono">
                      {isCurrent ? (
                        <span className="text-volt font-bold flex items-center gap-1.5">
                          <Check className="w-4 h-4 text-volt" /> Active Rank in Terminal
                        </span>
                      ) : totalUserVolume >= tier.minVolumeUsd ? (
                        <span className="text-emerald-400 font-bold">
                          ✅ Unlocked & Available
                        </span>
                      ) : (
                        <span className="text-gray-400">
                          Requires <strong className="text-white">${(tier.minVolumeUsd - totalUserVolume).toLocaleString()}</strong> more volume
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* TRADER TIERS PROTOCOL EXPLAINER */}
          <div className="bg-[#121622] border border-white/10 rounded-3xl p-6 shadow-xl space-y-3">
            <h4 className="text-sm font-extrabold text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" /> How Trader Volume Tiers Operate
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-gray-300">
              <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 space-y-1">
                <span className="font-bold text-white block">1. 100% On-Chain PTB Tracking</span>
                <p className="text-gray-400 text-[11px] leading-relaxed">
                  Your wallet address automatically tracks trading volume on every swap executed through DeepBook v3, Cetus, Turbos and Bluefin.
                </p>
              </div>
              <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 space-y-1">
                <span className="font-bold text-white block">2. Automatic Tier Progression</span>
                <p className="text-gray-400 text-[11px] leading-relaxed">
                  Once your volume crosses $1,000, $10,000, $50,000, $250,000 or $1,000,000, your lower fee tier activates immediately in the terminal.
                </p>
              </div>
              <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 space-y-1">
                <span className="font-bold text-white block">3. Up to -88% Fee Reduction</span>
                <p className="text-gray-400 text-[11px] leading-relaxed">
                  Enjoy institutional-grade execution with fees dropping from standard 0.25% down to 0.03% (absolute minimum on entire Sui Network).
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* VIEW 2: AFFILIATE RANKS & REVSHARE SYNDICATE */}
      {hubTab === 'affiliate' && (
        <div className="space-y-6">
      {/* TOP HEADER & ACCOUNT OVERVIEW */}
      <div className="bg-[#121622] border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-volt/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="px-3 py-1 rounded-full bg-volt/10 border border-volt/30 text-volt text-xs font-mono font-bold flex items-center gap-1.5">
                <Trophy className="w-3.5 h-3.5" /> Volt Partner & Growth Syndicate
              </span>
              <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-mono font-bold">
                Up to 50% Rev Share
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Earn <span className="text-volt">25% to 50%</span> of Every Swap Fee on Sui
            </h1>

            <p className="text-xs sm:text-sm text-gray-400 max-w-2xl leading-relaxed">
              Every swap routed through Volt Protocol generates an on-chain fee. Invite traders, Telegram communities, or fellow whales and receive your share directly inside the same transaction block — 100% on-chain, zero delays, zero KYC.
            </p>
          </div>

          {/* ACTIVE ACCOUNT BADGE CARD */}
          <div className="w-full lg:w-auto shrink-0 bg-[#0c0f17] border border-white/10 rounded-2xl p-4 sm:p-5 flex flex-col gap-3 min-w-[280px]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono text-gray-400 uppercase tracking-wider">Your Rank</span>
              <span className={`text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full border ${currentTier.badgeBg} ${currentTier.badgeBorder} ${currentTier.badgeText}`}>
                {currentTier.badgeEmoji} {currentTier.name}
              </span>
            </div>

            <div className="flex items-baseline justify-between border-b border-white/5 pb-2.5">
              <span className="text-2xl font-black text-white">{currentTier.revShare}%</span>
              <span className="text-xs text-gray-400 font-mono">Protocol Fee Share</span>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-mono text-gray-400">
                <span>Active Referrals:</span>
                <span className="text-white font-bold">{simulatedRefs} traders</span>
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono text-gray-400">
                <span>Next Milestone:</span>
                <span className="text-cyan-400 font-bold">
                  {nextTier ? `${nextTier.minRefs} refs (${nextTier.revShare}%)` : 'MAX RANK (50%)'}
                </span>
              </div>
            </div>

            {/* Quick Demo Stepper for Testing Ranks */}
            <div className="pt-2 border-t border-white/5 flex items-center justify-between gap-1">
              <span className="text-[10px] text-gray-500 font-mono">Test Rank:</span>
              <div className="flex items-center gap-1">
                {[
                  { label: '1 (25%)', val: 1 },
                  { label: '10 (35%)', val: 10 },
                  { label: '100 (50%)', val: 100 }
                ].map((s) => (
                  <button
                    key={s.val}
                    onClick={() => {
                      setSimulatedRefs(s.val);
                      localStorage.setItem('volt_affiliate_refs_count', s.val.toString());
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono transition-all ${
                      simulatedRefs === s.val
                        ? 'bg-volt text-black font-bold'
                        : 'bg-white/5 text-gray-400 hover:text-white'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* PROGRESS TO NEXT RANK */}
        {nextTier && (
          <div className="mt-6 pt-5 border-t border-white/5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono mb-2">
              <span className="text-gray-300 flex items-center gap-2">
                <span>Level Progress:</span>
                <span className="text-white font-bold">{simulatedRefs} / {nextTier.minRefs} Referrals</span>
              </span>
              <span className="text-cyan-400 font-bold">
                Invite {Math.max(0, nextTier.minRefs - simulatedRefs)} more traders to unlock {nextTier.badgeEmoji} {nextTier.name} ({nextTier.revShare}% Rev Share)
              </span>
            </div>
            <div className="w-full h-2.5 rounded-full bg-black/60 overflow-hidden border border-white/10">
              <div
                className="h-full bg-gradient-to-r from-amber-500 via-cyan-400 to-volt transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* 1. CLAIMABLE REWARDS VAULT & MINIMUM WITHDRAWAL ($10 USD) */}
      <div className="bg-[#121622] border border-volt/30 rounded-3xl p-6 sm:p-7 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-volt/10 rounded-full blur-3xl pointer-events-none" />
        
        <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-volt/15 border border-volt/30 text-volt text-xs font-mono font-bold flex items-center gap-1.5">
                <Coins className="w-3.5 h-3.5" /> Affiliate Rewards Vault
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-white/5 border border-white/10 text-gray-300 text-[11px] font-mono">
                Min Claim Threshold: $10.00 USD
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Claimable Revenue Share
            </h2>
            <p className="text-xs text-gray-400 max-w-xl leading-relaxed">
              Fees from your invited traders accumulate in your partner vault. When your balance reaches the $10.00 threshold, claim your earnings in native SUI or USDC directly into your connected wallet in a single atomic transaction.
            </p>
          </div>

          <div className="w-full lg:w-auto shrink-0 bg-[#0c0f17] border border-white/10 rounded-2xl p-5 flex flex-col gap-3 min-w-[300px]">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-mono text-gray-400 uppercase tracking-wider">Unclaimed Balance</span>
              <span className="text-xs font-mono text-emerald-400 font-bold">
                Total Claimed: ${totalClaimed.toFixed(2)}
              </span>
            </div>

            <div className="flex items-baseline gap-2">
              <span className="text-3xl sm:text-4xl font-black text-volt">
                ${claimableBalance.toFixed(2)}
              </span>
              <span className="text-xs font-mono text-gray-400">USD</span>
              <span className="text-xs font-mono text-cyan-400 ml-auto font-semibold">
                (~{(claimableBalance / 0.84).toFixed(2)} SUI)
              </span>
            </div>

            {/* Threshold Progress Bar */}
            <div className="space-y-1 pt-1">
              <div className="flex justify-between text-[10px] font-mono">
                <span className={claimableBalance >= 10 ? 'text-emerald-400 font-bold' : 'text-gray-400'}>
                  {claimableBalance >= 10 ? '✅ Ready to Claim to Wallet' : `Threshold: $${claimableBalance.toFixed(2)} / $10.00 USD`}
                </span>
                <span className="text-volt font-bold">
                  {Math.min(100, Math.round((claimableBalance / 10) * 100))}%
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-black/60 overflow-hidden border border-white/5">
                <div
                  className={`h-full transition-all duration-500 rounded-full ${
                    claimableBalance >= 10
                      ? 'bg-gradient-to-r from-emerald-400 via-volt to-emerald-400'
                      : 'bg-gradient-to-r from-cyan-500 to-amber-500'
                  }`}
                  style={{ width: `${Math.min(100, Math.max(5, (claimableBalance / 10) * 100))}%` }}
                />
              </div>
            </div>

            {/* Claim Actions */}
            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={handleClaimAll}
                disabled={claimableBalance < 10.00 || isClaiming}
                className={`flex-1 py-3 px-4 rounded-xl font-extrabold text-xs sm:text-sm font-mono transition-all flex items-center justify-center gap-2 ${
                  claimableBalance >= 10.00 && !isClaiming
                    ? 'bg-gradient-to-r from-sky-500 to-cyan-400 hover:from-sky-400 hover:to-cyan-300 text-slate-950 font-black shadow-[0_0_20px_rgba(56,189,248,0.25)] cursor-pointer active:scale-[0.98]'
                    : 'bg-white/5 border border-white/10 text-gray-500 cursor-not-allowed'
                }`}
              >
                {isClaiming ? (
                  <span className="animate-pulse flex items-center gap-1.5">
                    <Zap className="w-4 h-4 text-volt animate-spin" /> Processing PTB Claim...
                  </span>
                ) : claimableBalance >= 10.00 ? (
                  <>
                    <ArrowDownToLine className="w-4 h-4" /> Claim ${claimableBalance.toFixed(2)} USD
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4 text-gray-500" /> Min $10.00 to Claim
                  </>
                )}
              </button>

              <button
                onClick={handleSimulateSwap}
                title="Simulate a swap by one of your referrals"
                className="px-3 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-cyan-300 text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer transition-all shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5 text-volt" /> +$0.78 Test Swap
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 2. TRANSPARENCY LEDGER & REFERRAL ANALYTICS */}
      <div className="bg-[#121622] border border-white/10 rounded-3xl p-6 sm:p-7 shadow-xl space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base sm:text-lg font-extrabold text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-volt" /> Referral Analytics & Transparency Ledger
            </h3>
            <p className="text-xs text-gray-400">
              Track invited wallets, on-chain volumes traded, and your revenue share breakdown.
            </p>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="flex items-center p-1 rounded-2xl bg-[#090b12] border border-white/10 shrink-0">
              <button
                onClick={() => setActiveRefSubTab('traders')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold font-mono transition-all cursor-pointer ${
                  activeRefSubTab === 'traders'
                    ? 'bg-volt text-black shadow-sm'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                👥 Invited Wallets ({referralTraders.length})
              </button>
              <button
                onClick={() => setActiveRefSubTab('feed')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold font-mono transition-all cursor-pointer ${
                  activeRefSubTab === 'feed'
                    ? 'bg-volt text-black shadow-sm'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                ⚡ Live Commission Feed ({referralFeed.length})
              </button>
            </div>
          </div>
        </div>

        {/* SUBTAB 1: TRADERS LIST (LTV BREAKDOWN) */}
        {activeRefSubTab === 'traders' && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by wallet address (0x...)..."
                value={refSearchQuery}
                onChange={(e) => {
                  setRefSearchQuery(e.target.value);
                  setTradersPage(1);
                }}
                className="w-full bg-black/40 border border-white/10 rounded-xl pl-9 pr-3 py-2 text-xs font-mono text-gray-200 outline-none focus:border-volt/50"
              />
            </div>

            <div className="overflow-x-auto max-h-[360px] overflow-y-auto rounded-2xl border border-white/5 scrollbar-thin scrollbar-thumb-white/10">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#090b12] text-gray-400 uppercase text-[10px] tracking-wider border-b border-white/5 sticky top-0 z-10">
                  <tr>
                    <th className="py-3 px-4">Referred Trader</th>
                    <th className="py-3 px-4">Trader Rank</th>
                    <th className="py-3 px-4 text-center">Swaps</th>
                    <th className="py-3 px-4 text-right">Volume Traded</th>
                    <th className="py-3 px-4 text-right">Your Revenue Share ({currentTier.revShare}%)</th>
                    <th className="py-3 px-4 text-right">Last Active</th>
                    <th className="py-3 px-4 text-center">Explorer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 bg-black/20">
                  {paginatedTraders.map((t, idx) => (
                    <tr key={idx} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-4 font-bold text-white flex items-center gap-2">
                        <Wallet className="w-3.5 h-3.5 text-volt shrink-0" />
                        <span>{t.address}</span>
                      </td>
                      <td className="py-3 px-4 text-gray-300">
                        <span className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[11px]">
                          {t.tier}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center text-gray-300">
                        {t.swapsCount}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-white">
                        ${t.totalVolumeUsd.toLocaleString()} USD
                      </td>
                      <td className="py-3 px-4 text-right font-extrabold text-emerald-400">
                        +${t.earnedUsd.toFixed(2)} USD
                      </td>
                      <td className="py-3 px-4 text-right text-gray-400 text-[11px]">
                        {t.lastActive}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <a
                          href={`https://suiscan.xyz/mainnet/account/${t.fullAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-cyan-400 text-[10px] transition-colors"
                        >
                          Suiscan <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </td>
                    </tr>
                  ))}
                  {paginatedTraders.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-gray-500 font-mono text-xs">
                        No matching wallets found for "{refSearchQuery}".
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Traders Pagination Bar (5 per page) */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs font-mono text-gray-400">
              <span>
                Showing <strong className="text-white">{filteredTraders.length === 0 ? 0 : (tradersPage - 1) * PAGE_SIZE + 1}</strong>–
                <strong className="text-white">{Math.min(tradersPage * PAGE_SIZE, filteredTraders.length)}</strong> of{' '}
                <strong className="text-white">{filteredTraders.length}</strong> wallets (5 per page)
              </span>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setTradersPage(p => Math.max(1, p - 1))}
                  disabled={tradersPage <= 1}
                  className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-gray-300 cursor-pointer"
                >
                  ← Prev
                </button>

                {Array.from({ length: totalTradersPages }, (_, i) => i + 1).map((pg) => (
                  <button
                    key={pg}
                    onClick={() => setTradersPage(pg)}
                    className={`w-7 h-7 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                      tradersPage === pg
                        ? 'bg-volt text-black shadow-sm'
                        : 'bg-white/5 border border-white/10 text-gray-400 hover:text-white'
                    }`}
                  >
                    {pg}
                  </button>
                ))}

                <button
                  onClick={() => setTradersPage(p => Math.min(totalTradersPages, p + 1))}
                  disabled={tradersPage >= totalTradersPages}
                  className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-gray-300 cursor-pointer"
                >
                  Next →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* SUBTAB 2: LIVE FEED OF RECENT COMMISSIONS */}
        {activeRefSubTab === 'feed' && (
          <div className="space-y-3">
            <div className="overflow-x-auto max-h-[360px] overflow-y-auto rounded-2xl border border-white/5 scrollbar-thin scrollbar-thumb-white/10">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-[#090b12] text-gray-400 uppercase text-[10px] tracking-wider border-b border-white/5 sticky top-0 z-10">
                  <tr>
                    <th className="py-3 px-4">Time</th>
                    <th className="py-3 px-4">Trader</th>
                    <th className="py-3 px-4">Pair</th>
                    <th className="py-3 px-4 text-right">Swap Volume</th>
                    <th className="py-3 px-4 text-right">Protocol Fee</th>
                    <th className="py-3 px-4 text-right">Your Cut ({currentTier.revShare}%)</th>
                    <th className="py-3 px-4 text-center">Status</th>
                    <th className="py-3 px-4 text-center">PTB Digest</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 bg-black/20">
                  {paginatedFeed.map((item) => (
                    <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="py-3 px-4 text-gray-400 flex items-center gap-1.5">
                        <Clock className="w-3 h-3 text-gray-500" />
                        <span>{item.time}</span>
                      </td>
                      <td className="py-3 px-4 font-bold text-white">
                        {item.address}
                      </td>
                      <td className="py-3 px-4 text-cyan-300 font-bold">
                        {item.pair}
                      </td>
                      <td className="py-3 px-4 text-right text-gray-200">
                        ${item.volumeUsd.toLocaleString()} USD
                      </td>
                      <td className="py-3 px-4 text-right text-gray-400">
                        ${item.feeUsd.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right font-black text-emerald-400">
                        +${item.earnedUsd.toFixed(2)} USD
                      </td>
                      <td className="py-3 px-4 text-center">
                        <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-[10px] font-bold">
                          Accumulated
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center">
                        <a
                          href={`https://suiscan.xyz/mainnet/tx/${item.digest}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-cyan-400 text-[10px] transition-colors"
                        >
                          {item.digest.slice(0, 8)}... <ExternalLink className="w-2.5 h-2.5" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Feed Pagination Bar (5 per page) */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2 text-xs font-mono text-gray-400">
              <span>
                Showing <strong className="text-white">{referralFeed.length === 0 ? 0 : (feedPage - 1) * PAGE_SIZE + 1}</strong>–
                <strong className="text-white">{Math.min(feedPage * PAGE_SIZE, referralFeed.length)}</strong> of{' '}
                <strong className="text-white">{referralFeed.length}</strong> events (5 per page)
              </span>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setFeedPage(p => Math.max(1, p - 1))}
                  disabled={feedPage <= 1}
                  className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-gray-300 cursor-pointer"
                >
                  ← Prev
                </button>

                {Array.from({ length: totalFeedPages }, (_, i) => i + 1).map((pg) => (
                  <button
                    key={pg}
                    onClick={() => setFeedPage(pg)}
                    className={`w-7 h-7 rounded-lg font-bold text-xs transition-all cursor-pointer ${
                      feedPage === pg
                        ? 'bg-volt text-black shadow-sm'
                        : 'bg-white/5 border border-white/10 text-gray-400 hover:text-white'
                    }`}
                  >
                    {pg}
                  </button>
                ))}

                <button
                  onClick={() => setFeedPage(p => Math.min(totalFeedPages, p + 1))}
                  disabled={feedPage >= totalFeedPages}
                  className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-gray-300 cursor-pointer"
                >
                  Next →
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* THREE RANK TIERS MATRIX */}
      <div>
        <div className="flex items-center justify-between mb-4 px-1">
          <div>
            <h2 className="text-lg font-extrabold text-white flex items-center gap-2">
              <Award className="w-5 h-5 text-volt" /> Partner Ranks & Perks Matrix
            </h2>
            <p className="text-xs text-gray-400">
              Automatic tier upgrades as your referral network grows on Sui.
            </p>
          </div>
          <span className="hidden sm:inline-block text-xs font-mono text-gray-400">
            Instant On-Chain PTB Settlement
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {TIERS.map((tier) => {
            const isCurrent = currentTier.id === tier.id;
            return (
              <div
                key={tier.id}
                className={`rounded-3xl p-5 sm:p-6 transition-all flex flex-col justify-between border relative overflow-hidden ${
                  isCurrent
                    ? `${tier.badgeBg} ${tier.badgeBorder} ${tier.badgeGlow} scale-[1.02]`
                    : 'bg-[#121622] border-white/10 hover:border-white/20'
                }`}
              >
                {isCurrent && (
                  <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-volt text-black text-[10px] font-black uppercase tracking-wider">
                    Your Current Rank
                  </div>
                )}

                <div>
                  <div className="flex items-center gap-2.5 mb-3">
                    <span className="text-2xl">{tier.badgeEmoji}</span>
                    <div>
                      <h3 className="text-base font-extrabold text-white">{tier.name}</h3>
                      <span className="text-[11px] font-mono text-gray-400">
                        {tier.maxRefs ? `${tier.minRefs} – ${tier.maxRefs} Referrals` : `${tier.minRefs}+ Referrals`}
                      </span>
                    </div>
                  </div>

                  <div className="my-4 p-3 rounded-2xl bg-black/30 border border-white/5 flex items-baseline justify-between">
                    <span className="text-xs text-gray-400 font-mono">Revenue Share</span>
                    <span className={`text-2xl font-black ${tier.badgeText}`}>{tier.revShare}%</span>
                  </div>

                  <p className="text-xs text-gray-400 mb-4 leading-relaxed">
                    {tier.tagline}
                  </p>

                  <div className="space-y-2 border-t border-white/5 pt-3">
                    {tier.perks.map((perk, i) => (
                      <div key={i} className="flex items-start gap-2 text-[11px] text-gray-300">
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{perk}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-white/5">
                  <div className={`w-full py-2 rounded-xl text-center text-xs font-bold font-mono transition-all ${
                    isCurrent
                      ? 'bg-volt text-black shadow-volt-glow'
                      : 'bg-white/5 text-gray-400'
                  }`}>
                    {isCurrent ? '⚡ Active & Earning' : tier.minRefs > simulatedRefs ? `Requires ${tier.minRefs} Referrals` : 'Unlocked'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>


      {/* VIRAL SHARE TOOLKIT */}
      <div className="bg-[#121622] border border-volt/25 rounded-3xl p-6 sm:p-7 shadow-xl">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-extrabold text-white flex items-center gap-2">
              <Share2 className="w-4 h-4 text-volt" /> Your Referral Link & Promotion Toolkit
            </h3>
            <p className="text-xs text-gray-400">
              Traders who use your link receive an instant 20% discount on all trading fees.
            </p>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              onClick={shareOnX}
              className="flex-1 sm:flex-none px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>Share on X (@voltswap)</span>
            </button>
            <button
              onClick={shareOnTelegram}
              className="flex-1 sm:flex-none px-3.5 py-2 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <span>Telegram (@volt_swap)</span>
            </button>
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-center gap-3">
          <div className="relative w-full">
            <input
              type="text"
              readOnly
              value={referralUrl}
              className="w-full bg-black/50 border border-white/10 rounded-2xl px-4 py-3 text-xs sm:text-sm font-mono text-gray-200 outline-none selection:bg-volt selection:text-black"
            />
          </div>

          <button
            onClick={copyRefLink}
            className="w-full md:w-auto shrink-0 px-6 py-3 rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-400 hover:from-sky-400 hover:to-cyan-300 text-slate-950 font-black text-xs sm:text-sm shadow-[0_0_20px_rgba(56,189,248,0.25)] transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            {copiedLink ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
            {copiedLink ? 'Copied to Clipboard!' : 'Copy Referral Link'}
          </button>
        </div>

        {/* Vanity Tag customization */}
        <div className="mt-4 pt-3 border-t border-white/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="text-gray-400 font-mono">
            Custom Vanity Code (optional):
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-gray-500 font-mono text-[11px]">voltswap.org/?ref=</span>
            <input
              type="text"
              placeholder="e.g. crypto_alpha"
              value={vanityAlias}
              onChange={(e) => setVanityAlias(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
              className="bg-black/40 border border-white/10 rounded-xl px-2.5 py-1 text-xs font-mono text-volt outline-none w-36"
            />
          </div>
        </div>
      </div>

      {/* READY-TO-USE PROMO TEMPLATES & MARKETING KIT */}
      <div className="bg-[#121622] border border-white/10 rounded-3xl p-6 sm:p-7 shadow-xl space-y-4">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="space-y-1 max-w-xl">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-400 text-[10px] font-mono font-bold uppercase tracking-wider">
                1-Click Viral Kit
              </span>
            </div>
            <h3 className="text-base sm:text-lg font-extrabold text-white flex items-center gap-2 mt-1">
              <FileText className="w-5 h-5 text-volt" /> Ready-to-Use Promo Templates
            </h3>
            <p className="text-xs text-gray-400">
              Battle-tested, high-converting copy used by top crypto affiliates. Choose your target channel, copy in 1 click, and share with your audience.
            </p>
          </div>

          {/* Template Tabs */}
          <div className="flex items-center gap-1 p-1 rounded-2xl bg-[#090b12] border border-white/10 shrink-0 w-full sm:w-auto overflow-hidden">
            <button
              onClick={() => setActiveTemplate('tg')}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                activeTemplate === 'tg'
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-sm'
                  : 'border-transparent text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Send className="w-3.5 h-3.5" /> Telegram Post
            </button>
            <button
              onClick={() => setActiveTemplate('x')}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                activeTemplate === 'x'
                  ? 'bg-volt/20 text-volt border-volt/40 shadow-sm'
                  : 'border-transparent text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Share2 className="w-3.5 h-3.5" /> X / Twitter
            </button>
            <button
              onClick={() => setActiveTemplate('chat')}
              className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                activeTemplate === 'chat'
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 shadow-sm'
                  : 'border-transparent text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" /> Chat / DM
            </button>
          </div>
        </div>

        {/* Selected Template Preview Box */}
        <div className="p-4 sm:p-5 rounded-2xl bg-black/50 border border-white/10 relative group">
          <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/5 text-[11px] font-mono text-gray-400">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>
                {activeTemplate === 'tg' && 'Telegram Channel & Alpha Groups Template'}
                {activeTemplate === 'x' && 'Twitter / X High-Converting Hook (English)'}
                {activeTemplate === 'chat' && 'Fast Chat / Direct Message Recommendation'}
              </span>
            </div>
            <span className="text-gray-500">Auto-injects your live link</span>
          </div>

          <pre className="text-xs font-mono text-gray-200 whitespace-pre-wrap leading-relaxed select-all selection:bg-volt selection:text-black">
            {activeTemplate === 'tg' && telegramPostText}
            {activeTemplate === 'x' && xPostText}
            {activeTemplate === 'chat' && chatPostText}
          </pre>

          <div className="mt-4 pt-3 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="text-[11px] text-gray-400 font-mono">
              Includes <span className="text-emerald-400 font-bold">20% fee discount hook</span> to maximize conversions.
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={() => {
                  const txt = activeTemplate === 'tg' ? telegramPostText : activeTemplate === 'x' ? xPostText : chatPostText;
                  copyTemplate(txt, activeTemplate);
                }}
                className="flex-1 sm:flex-none px-4 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-400 hover:from-sky-400 hover:to-cyan-300 text-slate-950 font-black text-xs shadow-[0_0_20px_rgba(56,189,248,0.25)] transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {copiedTemplate === activeTemplate ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copiedTemplate === activeTemplate ? 'Copied to Clipboard!' : 'Copy Template Text'}
              </button>

              {activeTemplate === 'tg' && (
                <button
                  onClick={shareOnTelegram}
                  className="px-3.5 py-2 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 font-bold text-xs transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" /> Forward to TG
                </button>
              )}

              {activeTemplate === 'x' && (
                <button
                  onClick={shareOnX}
                  className="px-3.5 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold text-xs transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" /> Post to X
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* INTERACTIVE EARNINGS CALCULATOR */}
      <div className="bg-[#121622] border border-white/10 rounded-3xl p-6 sm:p-7 shadow-xl">
        <div className="flex items-center gap-2.5 mb-4">
          <Calculator className="w-5 h-5 text-volt" />
          <div>
            <h3 className="text-base font-extrabold text-white">
              Affiliate Revenue & Cashflow Calculator
            </h3>
            <p className="text-xs text-gray-400">
              Estimate your monthly passive crypto income based on your invited trading audience.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          {/* INPUT CONTROLS (7 COLS) */}
          <div className="lg:col-span-7 space-y-5">
            {/* Control 1: Number of Traders */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-gray-300">Active Invited Traders:</span>
                <span className="text-volt font-bold text-sm">{calcTraders} traders</span>
              </div>
              <input
                type="range"
                min="1"
                max="250"
                step="1"
                value={calcTraders}
                onChange={(e) => setCalcTraders(parseInt(e.target.value, 10))}
                className="w-full accent-volt h-2 bg-black/60 rounded-lg cursor-pointer"
              />
              <div className="flex items-center gap-1.5 pt-1">
                {[5, 15, 50, 100, 200].map((num) => (
                  <button
                    key={num}
                    onClick={() => setCalcTraders(num)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono transition-all ${
                      calcTraders === num
                        ? 'bg-volt text-black font-bold'
                        : 'bg-white/5 text-gray-400 hover:text-white'
                    }`}
                  >
                    {num}
                  </button>
                ))}
              </div>
            </div>

            {/* Control 2: Average Monthly Volume per Trader */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-gray-300">Avg Monthly Volume / Trader:</span>
                <span className="text-cyan-400 font-bold text-sm">${calcVolumePerTrader.toLocaleString()} USD</span>
              </div>
              <input
                type="range"
                min="1000"
                max="50000"
                step="1000"
                value={calcVolumePerTrader}
                onChange={(e) => setCalcVolumePerTrader(parseInt(e.target.value, 10))}
                className="w-full accent-cyan-400 h-2 bg-black/60 rounded-lg cursor-pointer"
              />
              <div className="flex items-center gap-1.5 pt-1">
                {[2000, 5000, 10000, 25000, 50000].map((vol) => (
                  <button
                    key={vol}
                    onClick={() => setCalcVolumePerTrader(vol)}
                    className={`px-2 py-1 rounded-lg text-[11px] font-mono transition-all ${
                      calcVolumePerTrader === vol
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-bold'
                        : 'bg-white/5 text-gray-400 hover:text-white'
                    }`}
                  >
                    ${vol >= 1000 ? `${vol / 1000}k` : vol}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* CALCULATED OUTPUT CARD (5 COLS) */}
          <div className="lg:col-span-5 bg-gradient-to-b from-[#161c2c] to-[#0d1017] border border-volt/30 rounded-2xl p-5 flex flex-col justify-between gap-4 shadow-2xl">
            <div>
              <div className="flex items-center justify-between text-xs text-gray-400 font-mono mb-1">
                <span>Qualified Rank:</span>
                <span className={`font-bold ${calcTier.badgeText}`}>
                  {calcTier.badgeEmoji} {calcTier.name} ({calcTier.revShare}%)
                </span>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-400 font-mono mb-3 pb-3 border-b border-white/5">
                <span>Total Monthly Volume:</span>
                <span className="text-white font-bold">${calcTotalMonthlyVolume.toLocaleString()} USD</span>
              </div>

              <div className="space-y-1">
                <span className="text-[11px] font-mono text-gray-400 uppercase tracking-wider block">
                  Estimated Monthly Cashflow
                </span>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl sm:text-4xl font-black text-volt">
                    ${calcMonthlyEarnings.toFixed(2)}
                  </span>
                  <span className="text-xs font-mono text-gray-400">USD / mo</span>
                </div>
                <p className="text-[11px] text-emerald-400 font-mono">
                  ~${calcAnnualEarnings.toFixed(0)} USD / year (paid in SUI / USDC)
                </p>
              </div>
            </div>

            <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 text-[11px] text-gray-400 font-mono flex items-center gap-2">
              <Zap className="w-4 h-4 text-volt shrink-0" />
              <span>Paid instantly on-chain inside every trade. No withdrawal fees.</span>
            </div>
          </div>
        </div>
      </div>

      {/* HOW ON-CHAIN REVENUE SHARE WORKS */}
      <div className="bg-[#121622] border border-white/10 rounded-3xl p-6 sm:p-7 shadow-xl space-y-4">
        <h3 className="text-base font-extrabold text-white flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-400" /> How It Works & Transparency
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-gray-300">
          <div className="p-4 rounded-2xl bg-black/30 border border-white/5 space-y-1.5">
            <span className="font-bold text-white block">1. Share Your Link</span>
            <p className="text-gray-400 leading-relaxed">
              Send your personal ref link to friends or channels. When they connect their Sui wallet, your address is attached in their transaction metadata.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-black/30 border border-white/5 space-y-1.5">
            <span className="font-bold text-white block">2. They Trade with Discount</span>
            <p className="text-gray-400 leading-relaxed">
              Your referrals save 20% on terminal swap fees (paying 0.20% flat instead of standard 0.25%), giving them a direct financial incentive to use your link.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-black/30 border border-white/5 space-y-1.5">
            <span className="font-bold text-white block">3. 25%–50% Direct Payout</span>
            <p className="text-gray-400 leading-relaxed">
              Every swap executes through a Sui Programmable Transaction Block (PTB). Your revenue share is routed straight into your wallet on-chain.
            </p>
          </div>
        </div>
      </div>
        </div>
      )}

      {/* CLAIM SUCCESS MODAL */}
      {claimSuccessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="w-full max-w-md bg-[#12151d] border border-volt/40 rounded-3xl p-6 shadow-2xl relative space-y-4 text-center">
            <div className="w-14 h-14 mx-auto rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <h3 className="text-xl font-black text-white">Rewards Claimed!</h3>
              <p className="text-xs text-gray-400">
                Your accumulated referral revenue has been sent directly to your connected Sui wallet.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-black/40 border border-white/10 space-y-1 font-mono">
              <span className="text-xs text-gray-400 uppercase">Amount Withdrawn</span>
              <div className="text-3xl font-black text-volt">
                +${claimSuccessModal.amount.toFixed(2)} USD
              </div>
              <span className="text-xs text-emerald-400">
                (~{(claimSuccessModal.amount / 0.84).toFixed(2)} SUI)
              </span>
            </div>

            <div className="text-xs text-gray-400 font-mono text-left bg-black/30 p-3 rounded-xl border border-white/5 break-all">
              <span className="text-gray-500 block text-[10px]">On-Chain Transaction Digest:</span>
              <a
                href={`https://suiscan.xyz/mainnet/tx/${claimSuccessModal.txDigest}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-cyan-400 hover:underline flex items-center gap-1 mt-1"
              >
                <span>{claimSuccessModal.txDigest.slice(0, 24)}...</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            </div>

            <button
              onClick={() => setClaimSuccessModal(null)}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-400 hover:from-sky-400 hover:to-cyan-300 text-slate-950 font-black text-sm shadow-[0_0_20px_rgba(56,189,248,0.25)] cursor-pointer transition-all"
            >
              Done
            </button>
          </div>
        </div>
      )}

    </div>
  );
};
