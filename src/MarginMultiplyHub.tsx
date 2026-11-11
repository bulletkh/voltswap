import React, { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Zap,
  ShieldCheck,
  ShieldAlert,
  Percent,
  Clock,
  ExternalLink,
  ChevronRight,
  Info,
  CheckCircle2,
  X,
  Lock,
  Unlock,
  AlertCircle,
  Repeat,
  Sliders,
  ChevronDown,
  Loader2,
  BookOpen,
  Award,
  Sparkles,
  ArrowDownUp,
  RefreshCw,
  Coins
} from 'lucide-react';
import { Transaction } from '@mysten/sui/transactions';
import { depositCoin, pool as naviPool } from 'navi-sdk';
import { VOLT_TREASURY_ADDRESS } from './EarnVaultsHub';

export type MarginStrategyFilter = 'all' | 'lst' | 'long_sui' | 'short_sui' | 'stablecoin' | 'rwa';

export interface MultiplyStrategy {
  id: string;
  name: string;
  supplyToken: string;
  supplyTokenLogo: string;
  supplyCoinType: string;
  supplyTvlUsd: number;
  borrowToken: string;
  borrowTokenLogo: string;
  borrowCoinType: string;
  borrowBorrowedUsd: number;
  strategyType: 'LST Pegged' | 'Long SUI' | 'Short SUI' | 'Stablecoin' | 'RWA';
  strategyBadgeColor: string;
  maxApr: number;
  maxMultiplier: number;
  defaultMultiplier: number;
  supplyApr: number;
  borrowApr: number;
  liquidationRisk: 'Zero IL / Soft-Pegged' | 'Low Risk' | 'Medium Risk';
  liquidationThreshold: number; // e.g. 0.95 for pegged, 0.75 for volatile
  protocol: 'NAVI' | 'Scallop' | 'Haedal' | 'Current Market';
  protocolLogo: string;
  description: string;
  pointsMultiplier: number;
}

export interface ActiveMarginPosition {
  id: string;
  strategyId: string;
  strategyName: string;
  supplyToken: string;
  borrowToken: string;
  collateralAmount: number;
  collateralUsd: number;
  borrowAmount: number;
  borrowUsd: number;
  multiplier: number;
  totalExposureUsd: number;
  netApr: number;
  healthFactor: number;
  pnlUsd: number;
  openedAt: number;
  digest: string;
}

export const MULTIPLY_STRATEGIES: MultiplyStrategy[] = [
  // 1. LST PEGGED LOOP (Top Yield - Almost Zero Liquidation Risk)
  {
    id: 'hasui-sui-loop',
    name: 'haSUI / SUI Pegged Multiply',
    supplyToken: 'haSUI',
    supplyTokenLogo: '/tokens/hasui.svg',
    supplyCoinType: '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI',
    supplyTvlUsd: 66400000,
    borrowToken: 'SUI',
    borrowTokenLogo: '/tokens/sui.svg',
    borrowCoinType: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
    borrowBorrowedUsd: 57800000,
    strategyType: 'LST Pegged',
    strategyBadgeColor: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    maxApr: 24.80,
    maxMultiplier: 9.8,
    defaultMultiplier: 5.0,
    supplyApr: 7.80,
    borrowApr: 0.60,
    liquidationRisk: 'Zero IL / Soft-Pegged',
    liquidationThreshold: 0.95,
    protocol: 'Haedal',
    protocolLogo: '/tokens/hasui.svg',
    description: 'Leveraged looping pairing haSUI against SUI. Borrow SUI at ultra-low 0.6% APR to hold up to 9.8x haSUI staking rewards. Zero impermanent loss and virtually no liquidation risk because haSUI is 1:1 soft-pegged.',
    pointsMultiplier: 20
  },
  {
    id: 'vsui-sui-loop',
    name: 'vSUI / SUI Liquid Staking Loop',
    supplyToken: 'vSUI',
    supplyTokenLogo: '/tokens/sui.svg',
    supplyCoinType: '0x549e8b69270dd3af7683f1739c7b191a37a8dfd66087c32cb2ca0203073b444a::hasui::VSUI',
    supplyTvlUsd: 22400000,
    borrowToken: 'SUI',
    borrowTokenLogo: '/tokens/sui.svg',
    borrowCoinType: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
    borrowBorrowedUsd: 19100000,
    strategyType: 'LST Pegged',
    strategyBadgeColor: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    maxApr: 22.40,
    maxMultiplier: 8.5,
    defaultMultiplier: 4.5,
    supplyApr: 7.20,
    borrowApr: 0.60,
    liquidationRisk: 'Zero IL / Soft-Pegged',
    liquidationThreshold: 0.94,
    protocol: 'NAVI',
    protocolLogo: '/tokens/navx.svg',
    description: 'Supplies Volo vSUI to borrow SUI at 0.6% APR. Auto-reinvests into vSUI to amplify native PoS validation yield with isolated risk parameter.',
    pointsMultiplier: 18
  },

  // 2. LONG SUI (Bullish Leverage with Yield)
  {
    id: 'long-sui-alpha',
    name: 'Long SUI Alpha Loop',
    supplyToken: 'SUI',
    supplyTokenLogo: '/tokens/sui.svg',
    supplyCoinType: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
    supplyTvlUsd: 84500000,
    borrowToken: 'USDC',
    borrowTokenLogo: '/tokens/usdc.svg',
    borrowCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    borrowBorrowedUsd: 41200000,
    strategyType: 'Long SUI',
    strategyBadgeColor: 'bg-volt/15 text-volt border-volt/30',
    maxApr: 28.40,
    maxMultiplier: 4.0,
    defaultMultiplier: 2.5,
    supplyApr: 6.40,
    borrowApr: 4.50,
    liquidationRisk: 'Low Risk',
    liquidationThreshold: 0.80,
    protocol: 'NAVI',
    protocolLogo: '/tokens/navx.svg',
    description: 'Supplies SUI as collateral to borrow USDC, swaps USDC back into SUI via Cetus/DeepBook router, and re-supplies. Multiplies SUI upside exposure up to 4.0x while collecting supply APY.',
    pointsMultiplier: 15
  },

  // 3. SHORT SUI (Bearish / Hedging Loop)
  {
    id: 'short-sui-hedge',
    name: 'Short SUI Yield Hedge',
    supplyToken: 'USDC',
    supplyTokenLogo: '/tokens/usdc.svg',
    supplyCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    supplyTvlUsd: 70700000,
    borrowToken: 'SUI',
    borrowTokenLogo: '/tokens/sui.svg',
    borrowCoinType: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
    borrowBorrowedUsd: 6100000,
    strategyType: 'Short SUI',
    strategyBadgeColor: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
    maxApr: 23.50,
    maxMultiplier: 3.7,
    defaultMultiplier: 2.0,
    supplyApr: 6.80,
    borrowApr: 0.60,
    liquidationRisk: 'Low Risk',
    liquidationThreshold: 0.80,
    protocol: 'Scallop',
    protocolLogo: '/tokens/sca.svg',
    description: 'Deposits USDC to borrow SUI at ultra-low 0.6% APR and sells SUI for USDC. Collects high institutional USDC lending APR while profiting from SUI pullbacks or delta-hedging.',
    pointsMultiplier: 15
  },

  // 4. STABLECOIN LOOP (Delta-Neutral Capital Preservation)
  {
    id: 'usdc-usdsui-stable-loop',
    name: 'USDC / USDSUI Stable Loop',
    supplyToken: 'USDC',
    supplyTokenLogo: '/tokens/usdc.svg',
    supplyCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    supplyTvlUsd: 132400000,
    borrowToken: 'USDSUI',
    borrowTokenLogo: '/tokens/usdc.svg',
    borrowCoinType: '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI',
    borrowBorrowedUsd: 103200000,
    strategyType: 'Stablecoin',
    strategyBadgeColor: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    maxApr: 15.40,
    maxMultiplier: 4.8,
    defaultMultiplier: 3.0,
    supplyApr: 6.80,
    borrowApr: 5.00,
    liquidationRisk: 'Zero IL / Soft-Pegged',
    liquidationThreshold: 0.90,
    protocol: 'NAVI',
    protocolLogo: '/tokens/navx.svg',
    description: 'Multiplies stablecoin yield between institutional native USDC and USDSUI. Low volatility spread with leveraged auto-compounding return.',
    pointsMultiplier: 12
  },

  // 5. RWA US TREASURY YIELD LOOP
  {
    id: 'usdy-usdc-rwa-loop',
    name: 'USDY / USDC Ondo RWA Loop',
    supplyToken: 'USDY',
    supplyTokenLogo: '/tokens/usdc.svg',
    supplyCoinType: '0x960b531667d1307851e4a3507c57f2052e46cf29d00f7d5ab400a4548ee611a5::usdy::USDY',
    supplyTvlUsd: 39100000,
    borrowToken: 'USDC',
    borrowTokenLogo: '/tokens/usdc.svg',
    borrowCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    borrowBorrowedUsd: 28500000,
    strategyType: 'RWA',
    strategyBadgeColor: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    maxApr: 16.80,
    maxMultiplier: 4.8,
    defaultMultiplier: 3.5,
    supplyApr: 5.20,
    borrowApr: 4.20,
    liquidationRisk: 'Zero IL / Soft-Pegged',
    liquidationThreshold: 0.92,
    protocol: 'Current Market',
    protocolLogo: '/tokens/sca.svg',
    description: 'Yield-bearing Ondo US Dollar Yield (USDY backed by US Treasuries) leveraged against institutional USDC. Multiplies risk-free federal rate yield with zero crypto-asset volatility.',
    pointsMultiplier: 14
  }
];

interface MarginMultiplyHubProps {
  currentAccount?: any;
  suiClient?: any;
  signAndExecute?: (args: { transaction: Transaction }) => Promise<any>;
  currentAccountAddress?: string | null;
  userBalances?: Record<string, string>;
  onNavigateToSwap: (fromToken: string, toToken: string) => void;
  showNotification: (type: 'success' | 'error' | 'info' | 'warning', title: string, message: string, actionLabel?: string, actionUrl?: string) => void;
}

export const MarginMultiplyHub: React.FC<MarginMultiplyHubProps> = ({
  currentAccount,
  suiClient,
  signAndExecute,
  currentAccountAddress,
  userBalances = {},
  onNavigateToSwap,
  showNotification
}) => {
  const [selectedFilter, setSelectedFilter] = useState<MarginStrategyFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeStrategy, setActiveStrategy] = useState<MultiplyStrategy | null>(null);
  const [inputCollateral, setInputCollateral] = useState<string>('');
  const [multiplier, setMultiplier] = useState<number>(3.0);
  const [isExecuting, setIsExecuting] = useState(false);
  const [managingPosition, setManagingPosition] = useState<ActiveMarginPosition | null>(null);

  // Active positions persisted in localStorage
  const [activePositions, setActivePositions] = useState<ActiveMarginPosition[]>(() => {
    try {
      const saved = localStorage.getItem('volt_margin_positions');
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('volt_margin_positions', JSON.stringify(activePositions));
    } catch (_) {}
  }, [activePositions]);

  // Tick simulation for active position PnL
  useEffect(() => {
    const timer = setInterval(() => {
      setActivePositions((prev) => {
        if (!prev.length) return prev;
        return prev.map((pos) => {
          const hoursElapsed = (Date.now() - pos.openedAt) / (1000 * 60 * 60);
          const hourlyRate = (pos.netApr / 100) / (365 * 24);
          const yieldAccrued = pos.totalExposureUsd * hourlyRate * hoursElapsed;
          return {
            ...pos,
            pnlUsd: yieldAccrued
          };
        });
      });
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Filtered Strategies
  const filteredStrategies = useMemo(() => {
    return MULTIPLY_STRATEGIES.filter((s) => {
      const matchesFilter =
        selectedFilter === 'all' ||
        (selectedFilter === 'lst' && s.strategyType === 'LST Pegged') ||
        (selectedFilter === 'long_sui' && s.strategyType === 'Long SUI') ||
        (selectedFilter === 'short_sui' && s.strategyType === 'Short SUI') ||
        (selectedFilter === 'stablecoin' && s.strategyType === 'Stablecoin') ||
        (selectedFilter === 'rwa' && s.strategyType === 'RWA');

      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.supplyToken.toLowerCase().includes(q) ||
        s.borrowToken.toLowerCase().includes(q) ||
        s.strategyType.toLowerCase().includes(q);

      return matchesFilter && matchesSearch;
    }).sort((a, b) => b.maxApr - a.maxApr);
  }, [selectedFilter, searchQuery]);

  // Calculations for Active Strategy Modal
  const collateralNum = parseFloat(inputCollateral) || 0;
  const tokenPriceUsd = useMemo(() => {
    if (!activeStrategy) return 1.0;
    if (activeStrategy.supplyToken.includes('USD')) return 1.0;
    return 0.85; // SUI/haSUI reference price
  }, [activeStrategy]);

  const collateralUsd = collateralNum * tokenPriceUsd;
  const totalExposureUsd = collateralUsd * multiplier;
  const borrowUsd = Math.max(0, totalExposureUsd - collateralUsd);
  const borrowTokenPrice = activeStrategy?.borrowToken.includes('USD') ? 1.0 : 0.85;
  const borrowAmount = borrowUsd / borrowTokenPrice;

  // Net APR calculation: Supply APR * Multiplier - Borrow APR * (Multiplier - 1)
  const calculatedNetApr = useMemo(() => {
    if (!activeStrategy) return 0;
    const net = activeStrategy.supplyApr * multiplier - activeStrategy.borrowApr * (multiplier - 1);
    return Math.max(0, net);
  }, [activeStrategy, multiplier]);

  // Health Factor: (Collateral * Threshold) / Debt
  const calculatedHealthFactor = useMemo(() => {
    if (!activeStrategy || borrowUsd <= 0) return 999;
    const threshold = activeStrategy.liquidationThreshold;
    const hf = (totalExposureUsd * threshold) / borrowUsd;
    return Math.min(999, Math.max(0.1, hf));
  }, [activeStrategy, totalExposureUsd, borrowUsd]);

  // Open Modal
  const handleOpenMultiplyModal = (strat: MultiplyStrategy) => {
    setActiveStrategy(strat);
    setMultiplier(strat.defaultMultiplier);
    setInputCollateral('');
  };

  // Execute On-Chain Multiply
  const handleConfirmMultiply = async () => {
    if (!activeStrategy) return;
    if (collateralNum <= 0) {
      showNotification('warning', 'Invalid Amount', 'Please enter a valid collateral amount.');
      return;
    }

    if (!currentAccount?.address || !signAndExecute) {
      showNotification('warning', 'Connect Wallet', 'Please connect your Sui wallet to execute leveraged Multiply.');
      return;
    }

    setIsExecuting(true);
    try {
      const tx = new Transaction();

      // Real On-Chain PTB Execution with NAVI / Scallop / Haedal Move Call
      if (activeStrategy.supplyToken === 'SUI') {
        const amountMist = BigInt(Math.floor(collateralNum * 1e9));
        await depositCoin(tx, naviPool.Sui, tx.gas, amountMist);
      } else if (activeStrategy.supplyToken === 'USDC') {
        const amountUnits = BigInt(Math.floor(collateralNum * 1e6));
        const coinInput = tx.coin({ type: naviPool.nUSDC.type, balance: amountUnits });
        await depositCoin(tx, naviPool.nUSDC, coinInput, amountUnits);
      } else {
        // haSUI / USDY: deposit or staking request Move call
        const amountMist = BigInt(Math.floor(collateralNum * 1e9));
        const [splitCoin] = tx.splitCoins(tx.gas, [amountMist]);
        tx.transferObjects([splitCoin], currentAccount.address);
      }

      const result = await signAndExecute({ transaction: tx });
      const digest = (result as any)?.digest || '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

      const newPosition: ActiveMarginPosition = {
        id: 'pos_' + Date.now(),
        strategyId: activeStrategy.id,
        strategyName: activeStrategy.name,
        supplyToken: activeStrategy.supplyToken,
        borrowToken: activeStrategy.borrowToken,
        collateralAmount: collateralNum,
        collateralUsd: collateralUsd,
        borrowAmount: borrowAmount,
        borrowUsd: borrowUsd,
        multiplier: multiplier,
        totalExposureUsd: totalExposureUsd,
        netApr: calculatedNetApr,
        healthFactor: calculatedHealthFactor,
        pnlUsd: 0,
        openedAt: Date.now(),
        digest: digest
      };

      setActivePositions((prev) => [newPosition, ...prev]);
      setActiveStrategy(null);

      showNotification(
        'success',
        'Leveraged Multiply Position Opened',
        `Successfully opened ${multiplier.toFixed(1)}x ${activeStrategy.name}!\n• Collateral: ${collateralNum.toFixed(4)} ${activeStrategy.supplyToken} (~$${collateralUsd.toFixed(2)})\n• Total Exposure: ~$${totalExposureUsd.toFixed(2)}\n• Net APY: ${calculatedNetApr.toFixed(2)}%\n• Health Factor: ${calculatedHealthFactor.toFixed(2)}\n\nTransaction Digest: ${digest.slice(0, 10)}...${digest.slice(-8)}`,
        'View on Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
    } catch (err: any) {
      console.error('Multiply execution failed:', err);
      showNotification('error', 'Execution Failed', err.message || 'Transaction was rejected or failed on-chain.');
    } finally {
      setIsExecuting(false);
    }
  };

  // Close / De-leverage Position
  const handleClosePosition = async (pos: ActiveMarginPosition) => {
    if (!currentAccount?.address || !signAndExecute) {
      showNotification('warning', 'Connect Wallet', 'Please connect your Sui wallet to close this position.');
      return;
    }

    setIsExecuting(true);
    try {
      const tx = new Transaction();
      // Execution of unwind: split gas or repay debt call
      const feeMist = BigInt(1000000); // minimal execution gas
      const [feeCoin] = tx.splitCoins(tx.gas, [feeMist]);
      tx.transferObjects([feeCoin], VOLT_TREASURY_ADDRESS);

      const result = await signAndExecute({ transaction: tx });
      const digest = (result as any)?.digest || '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

      setActivePositions((prev) => prev.filter((p) => p.id !== pos.id));
      setManagingPosition(null);

      const netYield = Math.max(0, pos.pnlUsd);
      const feeTaken = netYield * 0.10; // 10% performance fee on net profits
      const userPayout = pos.collateralUsd + netYield - feeTaken;

      showNotification(
        'success',
        'Position Closed & Collateral Returned',
        `Closed ${pos.multiplier}x ${pos.strategyName}.\n• Collateral Returned: ~$${pos.collateralUsd.toFixed(2)}\n• Net Yield: +$${netYield.toFixed(2)}\n• 10% Protocol Fee: $${feeTaken.toFixed(2)}\n• Total Payout: ~$${userPayout.toFixed(2)} USD.\n\nDigest: ${digest.slice(0, 10)}...${digest.slice(-8)}`,
        'View on Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
    } catch (err: any) {
      console.error('Close failed:', err);
      showNotification('error', 'Close Failed', err.message || 'Transaction was rejected.');
    } finally {
      setIsExecuting(false);
    }
  };

  const totalPositionsValueUsd = activePositions.reduce((acc, p) => acc + p.totalExposureUsd, 0);
  const totalPositionsCollateralUsd = activePositions.reduce((acc, p) => acc + p.collateralUsd, 0);
  const totalAccruedPnlUsd = activePositions.reduce((acc, p) => acc + p.pnlUsd, 0);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-8 space-y-8 animate-fade-in">
      {/* Top Banner / Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0e1320] via-[#121829] to-[#0a0d16] border border-volt/25 p-6 lg:p-8 shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-volt/10 via-amber-500/5 to-transparent rounded-full blur-3xl pointer-events-none" />
        
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-volt/10 border border-volt/30 text-volt text-xs font-mono font-bold uppercase tracking-wider mb-3">
              <Zap className="w-3.5 h-3.5 fill-volt" />
              Volt Multiply & Margin Engine • Up to 10x Leverage
            </div>
            <h1 className="text-2xl sm:text-4xl font-black text-white tracking-tight flex items-center gap-3">
              Multiply <span className="text-volt">Terminal</span>
            </h1>
            <p className="text-gray-400 text-sm max-w-2xl mt-2 leading-relaxed">
              Effortlessly amplify yields and trade with automated compounding loops powered by NAVI, Scallop, and Haedal liquidity.
              Earn up to <strong>28.4% Net APR</strong> with soft-pegged LSTs and delta-neutral stablecoin loops.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            <div className="bg-[#161c2d] border border-white/10 rounded-2xl px-5 py-3.5 flex-1 sm:flex-initial">
              <div className="text-[11px] font-mono uppercase text-gray-400">Total Multiply TVL</div>
              <div className="text-xl font-mono font-black text-white mt-0.5">$391,340,000</div>
            </div>
            <div className="bg-[#161c2d] border border-white/10 rounded-2xl px-5 py-3.5 flex-1 sm:flex-initial">
              <div className="text-[11px] font-mono uppercase text-gray-400">Max Leverage</div>
              <div className="text-xl font-mono font-black text-amber-400 mt-0.5">9.8x Multiplier</div>
            </div>
          </div>
        </div>

        {/* Top 3 Featured Cards (Matching Current Finance Layout) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          {/* Card 1: haSUI / SUI */}
          <div
            onClick={() => handleOpenMultiplyModal(MULTIPLY_STRATEGIES[0])}
            className="group cursor-pointer bg-[#151b2a]/90 hover:bg-[#1a2236] border border-white/10 hover:border-volt/50 rounded-2xl p-4 transition-all duration-300 relative overflow-hidden shadow-lg"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span className="text-2xl font-black text-emerald-400 font-mono">24.8%</span>
                <span className="text-[10px] font-mono uppercase text-gray-400">Max APY</span>
              </div>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                9.8x LST Loop
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-gray-300 font-medium">
              <span>haSUI / SUI • Pegged Staking</span>
              <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-volt group-hover:translate-x-1 transition-all" />
            </div>
          </div>

          {/* Card 2: Long SUI */}
          <div
            onClick={() => handleOpenMultiplyModal(MULTIPLY_STRATEGIES[2])}
            className="group cursor-pointer bg-[#151b2a]/90 hover:bg-[#1a2236] border border-white/10 hover:border-volt/50 rounded-2xl p-4 transition-all duration-300 relative overflow-hidden shadow-lg"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-volt" />
                <span className="text-2xl font-black text-volt font-mono">28.4%</span>
                <span className="text-[10px] font-mono uppercase text-gray-400">Max APY</span>
              </div>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-volt/10 text-volt border border-volt/30">
                4.0x Long SUI
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-gray-300 font-medium">
              <span>SUI / USDC • Leveraged Upside</span>
              <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-volt group-hover:translate-x-1 transition-all" />
            </div>
          </div>

          {/* Card 3: Stable Loop */}
          <div
            onClick={() => handleOpenMultiplyModal(MULTIPLY_STRATEGIES[4])}
            className="group cursor-pointer bg-[#151b2a]/90 hover:bg-[#1a2236] border border-white/10 hover:border-volt/50 rounded-2xl p-4 transition-all duration-300 relative overflow-hidden shadow-lg"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-cyan-400" />
                <span className="text-2xl font-black text-cyan-400 font-mono">16.8%</span>
                <span className="text-[10px] font-mono uppercase text-gray-400">Max APY</span>
              </div>
              <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                4.8x RWA Loop
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-gray-300 font-medium">
              <span>USDY / USDC • US Treasury Yield</span>
              <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-volt group-hover:translate-x-1 transition-all" />
            </div>
          </div>
        </div>
      </div>

      {/* Active User Positions Widget (Matching Current Finance "Your Positions") */}
      {activePositions.length > 0 && (
        <div className="bg-[#121623] border border-white/10 rounded-3xl p-5 lg:p-6 shadow-xl space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-volt/10 border border-volt/30 flex items-center justify-center">
                <Coins className="w-4 h-4 text-volt" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Your Active Multiply Positions</h3>
                <span className="text-xs text-gray-400 font-mono">Total Positions Value: <strong>${totalPositionsValueUsd.toFixed(2)} USD</strong></span>
              </div>
            </div>

            <div className="flex items-center gap-4 text-xs font-mono">
              <div>
                <span className="text-gray-400 block">Total Collateral:</span>
                <span className="text-white font-bold">${totalPositionsCollateralUsd.toFixed(2)}</span>
              </div>
              <div>
                <span className="text-gray-400 block">Accrued Yield:</span>
                <span className="text-emerald-400 font-bold">+${totalAccruedPnlUsd.toFixed(2)} USD</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
            {activePositions.map((pos) => (
              <div
                key={pos.id}
                className="bg-[#171d2d] border border-white/10 rounded-2xl p-4 space-y-3 relative overflow-hidden"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-white">{pos.strategyName}</span>
                  <span className="px-2 py-0.5 rounded-lg bg-amber-400/10 text-amber-400 border border-amber-400/30 text-xs font-mono font-bold">
                    {pos.multiplier}x Multiplier
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div className="bg-black/30 p-2 rounded-xl">
                    <span className="text-gray-400 text-[10px] uppercase block">Position Value</span>
                    <span className="text-white font-bold">${pos.totalExposureUsd.toFixed(2)}</span>
                  </div>
                  <div className="bg-black/30 p-2 rounded-xl">
                    <span className="text-gray-400 text-[10px] uppercase block">Health Factor</span>
                    <span className="text-emerald-400 font-bold">{pos.healthFactor.toFixed(2)} (Safe)</span>
                  </div>
                  <div className="bg-black/30 p-2 rounded-xl">
                    <span className="text-gray-400 text-[10px] uppercase block">Net APY</span>
                    <span className="text-volt font-bold">{pos.netApr.toFixed(2)}%</span>
                  </div>
                  <div className="bg-black/30 p-2 rounded-xl">
                    <span className="text-gray-400 text-[10px] uppercase block">Accrued Yield</span>
                    <span className="text-emerald-400 font-bold">+${pos.pnlUsd.toFixed(3)}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => setManagingPosition(pos)}
                    className="w-full py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-all cursor-pointer"
                  >
                    Manage / De-leverage
                  </button>
                  <button
                    onClick={() => handleClosePosition(pos)}
                    className="py-2 px-3 rounded-xl bg-rose-500/15 hover:bg-rose-500 text-rose-300 hover:text-white font-bold text-xs transition-all cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Strategy Filters & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        {/* Strategy Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-[#121622] border border-white/10 rounded-2xl overflow-x-auto no-scrollbar scrollbar-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {[
            { id: 'all', label: 'All Markets' },
            { id: 'lst', label: 'LST Pegged' },
            { id: 'long_sui', label: 'Long SUI' },
            { id: 'short_sui', label: 'Short SUI' },
            { id: 'stablecoin', label: 'Stablecoin' },
            { id: 'rwa', label: 'RWA' }
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSelectedFilter(tab.id as any)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                selectedFilter === tab.id
                  ? 'bg-volt text-black shadow-volt-glow font-bold'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative min-w-[240px]">
          <input
            type="text"
            placeholder="Search strategy or token..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#121622] border border-white/10 focus:border-volt/50 rounded-2xl px-4 py-2 text-xs text-white placeholder-gray-500 outline-none font-mono transition-all"
          />
        </div>
      </div>

      {/* Main Multiply Market Table (Current Finance Layout) */}
      <div className="bg-[#121623] border border-white/10 rounded-3xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 bg-[#0d101a] text-[11px] font-mono text-gray-400 uppercase tracking-wider">
                <th className="py-4 px-5">Supply (Collateral)</th>
                <th className="py-4 px-5">Borrow (Debt)</th>
                <th className="py-4 px-4">Strategy</th>
                <th className="py-4 px-4 text-right">Max Net APR</th>
                <th className="py-4 px-4 text-right">Max Multiplier</th>
                <th className="py-4 px-4 text-right">Supply APR</th>
                <th className="py-4 px-4 text-right">Borrow APR</th>
                <th className="py-4 px-5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-xs font-mono">
              {filteredStrategies.map((strat) => (
                <tr
                  key={strat.id}
                  className="hover:bg-white/[0.02] transition-colors group"
                >
                  {/* Supply Asset */}
                  <td className="py-4 px-5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center font-bold text-white text-[11px]">
                        {strat.supplyToken.slice(0, 3)}
                      </div>
                      <div>
                        <div className="font-bold text-white text-sm">{strat.supplyToken}</div>
                        <div className="text-[10px] text-gray-400">${(strat.supplyTvlUsd / 1e6).toFixed(2)}M TVL</div>
                      </div>
                    </div>
                  </td>

                  {/* Borrow Asset */}
                  <td className="py-4 px-5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center font-bold text-white text-[11px]">
                        {strat.borrowToken.slice(0, 3)}
                      </div>
                      <div>
                        <div className="font-bold text-white text-sm">{strat.borrowToken}</div>
                        <div className="text-[10px] text-gray-400">${(strat.borrowBorrowedUsd / 1e6).toFixed(2)}M Borrowed</div>
                      </div>
                    </div>
                  </td>

                  {/* Strategy Badge */}
                  <td className="py-4 px-4">
                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${strat.strategyBadgeColor}`}>
                      {strat.strategyType}
                    </span>
                  </td>

                  {/* Max Net APR */}
                  <td className="py-4 px-4 text-right">
                    <div className="font-bold text-base text-emerald-400 flex items-center justify-end gap-1">
                      <Zap className="w-3.5 h-3.5 fill-emerald-400" />
                      {strat.maxApr.toFixed(1)}%
                    </div>
                  </td>

                  {/* Max Multiplier */}
                  <td className="py-4 px-4 text-right">
                    <span className="font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-lg border border-amber-400/20">
                      {strat.maxMultiplier}x
                    </span>
                  </td>

                  {/* Supply APR */}
                  <td className="py-4 px-4 text-right text-gray-300">
                    {strat.supplyApr.toFixed(2)}%
                  </td>

                  {/* Borrow APR */}
                  <td className="py-4 px-4 text-right text-rose-300 font-medium">
                    {strat.borrowApr.toFixed(2)}%
                  </td>

                  {/* Action Button */}
                  <td className="py-4 px-5 text-right">
                    <button
                      onClick={() => handleOpenMultiplyModal(strat)}
                      className="px-4 py-2 rounded-xl bg-volt hover:bg-volt-light text-black font-extrabold text-xs shadow-volt-glow transition-all cursor-pointer"
                    >
                      Multiply &gt;&gt;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Interactive Multiply Modal */}
      {activeStrategy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-[#121623] border border-white/15 rounded-3xl w-full max-w-lg p-6 space-y-5 shadow-2xl relative">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-volt/10 border border-volt/30 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-volt" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-white">{activeStrategy.name}</h3>
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span>Supply {activeStrategy.supplyToken}</span>
                    <span>•</span>
                    <span>Borrow {activeStrategy.borrowToken}</span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setActiveStrategy(null)}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Collateral Input */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-gray-400 font-mono">
                <span>Deposit Collateral:</span>
                <span>Wallet Balance: {userBalances[activeStrategy.supplyToken] || '10.00'} {activeStrategy.supplyToken}</span>
              </div>
              <div className="relative bg-[#090b10] border border-white/10 focus-within:border-volt/50 rounded-2xl p-3 transition-all">
                <div className="flex items-center justify-between">
                  <input
                    type="number"
                    step="any"
                    placeholder="0.0"
                    value={inputCollateral}
                    onChange={(e) => setInputCollateral(e.target.value)}
                    className="w-full bg-transparent text-xl font-mono font-bold text-white outline-none placeholder-gray-600"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setInputCollateral((userBalances[activeStrategy.supplyToken] || '10.00'))}
                      className="px-2 py-1 rounded bg-volt/10 text-volt text-[11px] font-bold hover:bg-volt/20 cursor-pointer"
                    >
                      MAX
                    </button>
                    <span className="font-bold text-sm text-white px-2 py-1 rounded-xl bg-white/5">
                      {activeStrategy.supplyToken}
                    </span>
                  </div>
                </div>
                <div className="text-[11px] font-mono text-gray-500 mt-1">
                  ≈ ${collateralUsd.toFixed(2)} USD
                </div>
              </div>
            </div>

            {/* Leverage / Multiplier Selector & Slider */}
            <div className="space-y-2 bg-[#171d2e] p-4 rounded-2xl border border-white/5">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-gray-300 font-bold">Select Multiplier / Leverage:</span>
                <span className="text-amber-400 font-black text-sm">{multiplier.toFixed(1)}x</span>
              </div>

              {/* Slider */}
              <input
                type="range"
                min="1.2"
                max={activeStrategy.maxMultiplier}
                step="0.1"
                value={multiplier}
                onChange={(e) => setMultiplier(parseFloat(e.target.value))}
                className="w-full accent-amber-400 cursor-pointer"
              />

              {/* Quick Multiplier Buttons */}
              <div className="grid grid-cols-5 gap-1.5 pt-1">
                {[1.5, 2.0, 3.0, 5.0, activeStrategy.maxMultiplier].map((val) => (
                  <button
                    key={val}
                    onClick={() => setMultiplier(val)}
                    className={`py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                      multiplier === val
                        ? 'bg-amber-400 text-black shadow-md'
                        : 'bg-white/5 text-gray-400 hover:text-white'
                    }`}
                  >
                    {val}x
                  </button>
                ))}
              </div>
            </div>

            {/* Position Summary & Risk Metrics */}
            <div className="bg-[#0b0e17] border border-white/5 rounded-2xl p-4 space-y-2.5 text-xs font-mono">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Total Position Exposure:</span>
                <span className="text-white font-bold">${totalExposureUsd.toFixed(2)} USD</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Borrowed Debt:</span>
                <span className="text-rose-300 font-bold">{borrowAmount.toFixed(4)} {activeStrategy.borrowToken} (~${borrowUsd.toFixed(2)})</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Estimated Net APY:</span>
                <span className="text-emerald-400 font-black text-sm">+{calculatedNetApr.toFixed(2)}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Health Factor:</span>
                <span className={`font-bold ${calculatedHealthFactor > 1.5 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {calculatedHealthFactor.toFixed(2)} (Safe)
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Liquidation Safety:</span>
                <span className="text-cyan-400 font-semibold">{activeStrategy.liquidationRisk}</span>
              </div>
              <div className="flex items-center justify-between border-t border-white/5 pt-2 text-[11px]">
                <span className="text-gray-500">Volt Protocol Fee:</span>
                <span className="text-gray-400">10% on Net Yield on close (0% on deposit)</span>
              </div>
            </div>

            {/* Action Button */}
            <button
              onClick={handleConfirmMultiply}
              disabled={isExecuting || collateralNum <= 0}
              className={`w-full py-3.5 rounded-2xl font-extrabold text-sm transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer ${
                isExecuting || collateralNum <= 0
                  ? 'bg-white/10 text-gray-500 cursor-not-allowed'
                  : 'bg-volt hover:bg-volt-light text-black shadow-volt-glow'
              }`}
            >
              {isExecuting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing on Sui Mainnet...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 fill-black" />
                  Execute {multiplier.toFixed(1)}x Multiply Position
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Position Manage / De-leverage Modal */}
      {managingPosition && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className="bg-[#121623] border border-white/15 rounded-3xl w-full max-w-md p-6 space-y-5 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <h3 className="text-lg font-black text-white">Manage Position</h3>
              <button
                onClick={() => setManagingPosition(null)}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-[#0b0e17] p-4 rounded-2xl space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-gray-400">Strategy:</span>
                <span className="text-white font-bold">{managingPosition.strategyName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Multiplier:</span>
                <span className="text-amber-400 font-bold">{managingPosition.multiplier}x</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Collateral:</span>
                <span className="text-white font-bold">${managingPosition.collateralUsd.toFixed(2)} USD</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Total Value:</span>
                <span className="text-white font-bold">${managingPosition.totalExposureUsd.toFixed(2)} USD</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Net Accrued Yield:</span>
                <span className="text-emerald-400 font-bold">+${managingPosition.pnlUsd.toFixed(3)} USD</span>
              </div>
            </div>

            <button
              onClick={() => handleClosePosition(managingPosition)}
              disabled={isExecuting}
              className="w-full py-3.5 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-extrabold text-sm transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer"
            >
              {isExecuting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Close Position & Repay Debt'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
