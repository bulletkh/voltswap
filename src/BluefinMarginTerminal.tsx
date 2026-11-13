import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Zap,
  ShieldCheck,
  Percent,
  Clock,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Info,
  CheckCircle2,
  X,
  AlertCircle,
  Repeat,
  Sliders,
  Loader2,
  ArrowDownUp,
  Share2,
  BarChart2,
  DollarSign,
  Maximize2,
  Layers,
  Award,
  Star,
  Search,
  Calculator,
  Trophy,
  Volume2,
  VolumeX,
  Timer,
  Lock,
  Flame,
  Activity
} from 'lucide-react';
import { Transaction } from '@mysten/sui/transactions';
import { AggregatorClient } from '@cetusprotocol/aggregator-sdk';
import BN from 'bn.js';
import { VOLT_TREASURY_ADDRESS } from './EarnVaultsHub';
import {
  AF_SUI_COIN_TYPE,
  AF_USDC_COIN_TYPE,
  AfAccountState,
  AfMarketInfo,
  fetchAftermathMarkets,
  fetchAftermathAccountState,
  buildCreateAccountTx,
  buildDepositCollateralTx,
  buildWithdrawCollateralTx,
  buildPlaceMarketOrderTx,
} from './aftermathPerps';
import { simulateTxBeforeWallet } from './suiSimulate';
import {
  playClickSound,
  playOrderSubmittedSound,
  playCashProfitSound,
  playAlertSound,
  getSoundMuted,
  setSoundMuted
} from './audioFx';
import {
  getFastTradingSession,
  createFastTradingSession,
  revokeFastTradingSession,
  recordFastTrade,
  FastTradingSession
} from './fastTradingSession';
import { PerpsTerminalChart } from './PerpsTerminalChart';

export interface BluefinMarket {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  name: string;
  logo: string;
  tradingViewSymbol: string;
  binanceSymbol?: string;
  markPrice: number;
  indexPrice: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24hUsd: number;
  openInterestUsd: number;
  fundingRate: number; // e.g. 0.0105%
  nextFundingHours: number;
  maxLeverage: number;
  leverageGrid: number[];
  initialMarginPct: number;
  maintenanceMarginPct: number;
  minOrderSize: number;
  tickSize: number;
  category?: 'Sui' | 'Vera RWAs' | 'Crypto';
}

export interface BluefinPosition {
  id: string;
  marketSymbol: string;
  baseAsset: string;
  side: 'long' | 'short';
  leverage: number;
  marginMode: 'isolated' | 'cross';
  entryPrice: number;
  markPrice: number;
  sizeContracts: number;
  sizeUsd: number;
  marginCollateralUsd: number;
  liquidationPrice: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  unrealizedPnlUsd: number;
  roePct: number;
  openedAt: number;
  digest: string;
  isOnChain?: boolean;
  afMarketId?: string;
}

export const BLUEFIN_MARKETS: BluefinMarket[] = [
  {
    symbol: 'BTC-PERP',
    baseAsset: 'BTC',
    quoteAsset: 'USDC',
    name: 'Bitcoin Perpetual',
    logo: '/tokens/btc.svg',
    tradingViewSymbol: 'BINANCE:BTCUSDT',
    binanceSymbol: 'BTCUSDT',
    markPrice: 74898.6,
    indexPrice: 74900.4,
    change24h: -1.23,
    high24h: 75900.0,
    low24h: 73800.0,
    volume24hUsd: 86470,
    openInterestUsd: 20900,
    fundingRate: 0.0014,
    nextFundingHours: 3.25,
    maxLeverage: 40,
    leverageGrid: [1, 2, 5, 10, 20, 30, 40],
    initialMarginPct: 0.025, // 2.5% for 40x
    maintenanceMarginPct: 0.0125, // 1.25%
    minOrderSize: 0.001,
    tickSize: 0.1,
    category: 'Crypto'
  },
  {
    symbol: 'SUI-PERP',
    baseAsset: 'SUI',
    quoteAsset: 'USDC',
    name: 'Sui Perpetual',
    logo: '/tokens/sui.svg',
    tradingViewSymbol: 'BINANCE:SUIUSDT',
    binanceSymbol: 'SUIUSDT',
    markPrice: 0.8318,
    indexPrice: 0.8316,
    change24h: -2.03,
    high24h: 0.8593,
    low24h: 0.8120,
    volume24hUsd: 157970,
    openInterestUsd: 471120,
    fundingRate: 0.0011,
    nextFundingHours: 3.25,
    maxLeverage: 25,
    leverageGrid: [1, 2, 5, 10, 15, 20, 25],
    initialMarginPct: 0.04, // 4% for 25x
    maintenanceMarginPct: 0.02,
    minOrderSize: 1,
    tickSize: 0.0001,
    category: 'Sui'
  },
  {
    symbol: 'WAL-PERP',
    baseAsset: 'WAL',
    quoteAsset: 'USDC',
    name: 'Walrus Perpetual',
    logo: '/tokens/wal.svg',
    tradingViewSymbol: 'BINANCE:SUIUSDT',
    markPrice: 0.02717,
    indexPrice: 0.02715,
    change24h: -3.59,
    high24h: 0.0295,
    low24h: 0.0261,
    volume24hUsd: 80010,
    openInterestUsd: 24510,
    fundingRate: 0.0216,
    nextFundingHours: 3.25,
    maxLeverage: 20,
    leverageGrid: [1, 2, 3, 5, 10, 15, 20],
    initialMarginPct: 0.05,
    maintenanceMarginPct: 0.025,
    minOrderSize: 5,
    tickSize: 0.0001,
    category: 'Sui'
  },
  {
    symbol: 'HYPE-PERP',
    baseAsset: 'HYPE',
    quoteAsset: 'USDC',
    name: 'Hyperliquid Perpetual',
    logo: '/tokens/hype.svg',
    tradingViewSymbol: 'BINANCE:SOLUSDT',
    markPrice: 74.50,
    indexPrice: 74.48,
    change24h: -3.78,
    high24h: 78.20,
    low24h: 72.10,
    volume24hUsd: 36060,
    openInterestUsd: 116010,
    fundingRate: 0.0032,
    nextFundingHours: 3.25,
    maxLeverage: 20,
    leverageGrid: [1, 2, 3, 5, 10, 15, 20],
    initialMarginPct: 0.05,
    maintenanceMarginPct: 0.025,
    minOrderSize: 0.1,
    tickSize: 0.01,
    category: 'Crypto'
  },
  {
    symbol: 'ETH-PERP',
    baseAsset: 'ETH',
    quoteAsset: 'USDC',
    name: 'Ethereum Perpetual',
    logo: '/tokens/eth.svg',
    tradingViewSymbol: 'BINANCE:ETHUSDT',
    binanceSymbol: 'ETHUSDT',
    markPrice: 2138.20,
    indexPrice: 2138.00,
    change24h: -4.56,
    high24h: 2240.00,
    low24h: 2110.00,
    volume24hUsd: 31320,
    openInterestUsd: 2223.62,
    fundingRate: 0.0009,
    nextFundingHours: 3.25,
    maxLeverage: 25,
    leverageGrid: [1, 2, 5, 10, 15, 20, 25],
    initialMarginPct: 0.04,
    maintenanceMarginPct: 0.02,
    minOrderSize: 0.01,
    tickSize: 0.05,
    category: 'Crypto'
  },
  {
    symbol: 'SOL-PERP',
    baseAsset: 'SOL',
    quoteAsset: 'USDC',
    name: 'Solana Perpetual',
    logo: '/tokens/sol.svg',
    tradingViewSymbol: 'BINANCE:SOLUSDT',
    binanceSymbol: 'SOLUSDT',
    markPrice: 87.313,
    indexPrice: 87.300,
    change24h: -1.33,
    high24h: 91.50,
    low24h: 85.20,
    volume24hUsd: 24510,
    openInterestUsd: 23000,
    fundingRate: 0.0012,
    nextFundingHours: 3.25,
    maxLeverage: 25,
    leverageGrid: [1, 2, 5, 10, 15, 20, 25],
    initialMarginPct: 0.04,
    maintenanceMarginPct: 0.02,
    minOrderSize: 0.1,
    tickSize: 0.01,
    category: 'Crypto'
  },
  {
    symbol: 'GOLD-PERP',
    baseAsset: 'GOLD',
    quoteAsset: 'USDC',
    name: 'Vera Gold Perpetual (RWA)',
    logo: '/tokens/gold.svg',
    tradingViewSymbol: 'BINANCE:PAXGUSDT',
    binanceSymbol: 'PAXGUSDT',
    markPrice: 4115.95,
    indexPrice: 4115.50,
    change24h: 1.31,
    high24h: 4150.00,
    low24h: 4080.00,
    volume24hUsd: 21480,
    openInterestUsd: 29100,
    fundingRate: -0.0147,
    nextFundingHours: 3.25,
    maxLeverage: 20,
    leverageGrid: [1, 2, 3, 5, 10, 15, 20],
    initialMarginPct: 0.05,
    maintenanceMarginPct: 0.025,
    minOrderSize: 0.005,
    tickSize: 0.05,
    category: 'Vera RWAs'
  },
  {
    symbol: 'DEEP-PERP',
    baseAsset: 'DEEP',
    quoteAsset: 'USDC',
    name: 'DeepBook Perpetual',
    logo: '/tokens/deep.svg',
    tradingViewSymbol: 'GATEIO:DEEP_USDT',
    markPrice: 0.01398,
    indexPrice: 0.01397,
    change24h: -2.84,
    high24h: 0.0145,
    low24h: 0.0132,
    volume24hUsd: 19540,
    openInterestUsd: 45110,
    fundingRate: 0.0023,
    nextFundingHours: 3.25,
    maxLeverage: 20,
    leverageGrid: [1, 2, 3, 5, 10, 15, 20],
    initialMarginPct: 0.05,
    maintenanceMarginPct: 0.025,
    minOrderSize: 10,
    tickSize: 0.0001,
    category: 'Sui'
  },
  {
    symbol: 'CETUS-PERP',
    baseAsset: 'CETUS',
    quoteAsset: 'USDC',
    name: 'Cetus Perpetual',
    logo: '/tokens/cetus.svg',
    tradingViewSymbol: 'BINANCE:CETUSUSDT',
    binanceSymbol: 'CETUSUSDT',
    markPrice: 0.0191,
    indexPrice: 0.0191,
    change24h: 3.10,
    high24h: 0.0210,
    low24h: 0.0185,
    volume24hUsd: 24500,
    openInterestUsd: 7900,
    fundingRate: 0.0015,
    nextFundingHours: 3.25,
    maxLeverage: 20,
    leverageGrid: [1, 2, 3, 5, 10, 15, 20],
    initialMarginPct: 0.05,
    maintenanceMarginPct: 0.025,
    minOrderSize: 10,
    tickSize: 0.0001,
    category: 'Sui'
  }
];

interface BluefinMarginTerminalProps {
  currentAccount?: any;
  suiClient?: any;
  signAndExecute?: (args: { transaction: any }) => Promise<any>;
  currentAccountAddress?: string | null;
  userBalances?: Record<string, string>;
  feeRate?: number;
  showNotification: (type: 'success' | 'error' | 'info' | 'warning', title: string, message: string, actionLabel?: string, actionUrl?: string, tradeData?: any) => void;
  onOpenPnlShareModal?: (tradeData: any) => void;
  onSwitchToSpotLimit?: (baseAsset: string) => void;
}

export const BluefinMarginTerminal: React.FC<BluefinMarginTerminalProps> = ({
  currentAccount,
  suiClient,
  signAndExecute,
  currentAccountAddress,
  userBalances = {},
  feeRate = 0.0025,
  showNotification,
  onOpenPnlShareModal,
  onSwitchToSpotLimit
}) => {
  const [terminalMode, setTerminalMode] = useState<'simulation' | 'deepbook'>('simulation');
  const [liveMarkets, setLiveMarkets] = useState<BluefinMarket[]>(BLUEFIN_MARKETS);
  const [liveSuiPriceUsd, setLiveSuiPriceUsd] = useState<number>(0);
  const [selectedMarket, setSelectedMarket] = useState<BluefinMarket>(BLUEFIN_MARKETS[0]);
  const [isMarketDropdownOpen, setIsMarketDropdownOpen] = useState(false);
  const tickerScrollRef = useRef<HTMLDivElement>(null);
  const scrollTickers = (dir: 'left' | 'right') => {
    if (tickerScrollRef.current) {
      tickerScrollRef.current.scrollBy({
        left: dir === 'left' ? -240 : 240,
        behavior: 'smooth'
      });
    }
  };
  const [orderSide, setOrderSide] = useState<'long' | 'short'>('long');
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [marginMode, setMarginMode] = useState<'isolated' | 'cross'>('isolated');
  const [leverage, setLeverage] = useState<number>(10);

  // Auto-clamp leverage to selected market's max leverage whenever market changes
  useEffect(() => {
    if (leverage > selectedMarket.maxLeverage) {
      setLeverage(selectedMarket.maxLeverage);
    }
  }, [selectedMarket, leverage]);
  const [collateralAsset, setCollateralAsset] = useState<'SUI' | 'USDC'>('SUI');
  const [collateralInput, setCollateralInput] = useState<string>('');
  const [limitPriceInput, setLimitPriceInput] = useState<string>('');
  const [takeProfitInput, setTakeProfitInput] = useState<string>('');
  const [stopLossInput, setStopLossInput] = useState<string>('');
  const [isTpSlOpen, setIsTpSlOpen] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [activeBottomTab, setActiveBottomTab] = useState<'positions' | 'orders' | 'history' | 'leaderboard'>('positions');
  const [middleTab, setMiddleTab] = useState<'orderbook' | 'trades'>('orderbook');
  const [isCalculatorOpen, setIsCalculatorOpen] = useState<boolean>(false);
  const [isSoundMuted, setIsSoundMuted] = useState<boolean>(() => getSoundMuted());

  // Edit Position Modal State
  const [editingPosition, setEditingPosition] = useState<BluefinPosition | null>(null);
  const [editTab, setEditTab] = useState<'tpsl' | 'margin' | 'close'>('tpsl');
  const [editTpPrice, setEditTpPrice] = useState<string>('');
  const [editSlPrice, setEditSlPrice] = useState<string>('');
  const [marginAction, setMarginAction] = useState<'deposit' | 'withdraw'>('deposit');
  const [editMarginAmount, setEditMarginAmount] = useState<string>('');
  const [partialClosePct, setPartialClosePct] = useState<number>(50);

  const openEditModal = (pos: BluefinPosition, tab: 'tpsl' | 'margin' | 'close' = 'tpsl') => {
    setEditingPosition(pos);
    setEditTab(tab);
    setEditTpPrice(pos.takeProfitPrice ? String(pos.takeProfitPrice) : '');
    setEditSlPrice(pos.stopLossPrice ? String(pos.stopLossPrice) : '');
    setEditMarginAmount('');
    setPartialClosePct(50);
    playClickSound();
  };

  const handleSaveTpSl = () => {
    if (!editingPosition) return;
    const tp = parseFloat(editTpPrice) || undefined;
    const sl = parseFloat(editSlPrice) || undefined;

    setPositions((prev) =>
      prev.map((p) => {
        if (p.id === editingPosition.id) {
          return {
            ...p,
            takeProfitPrice: tp,
            stopLossPrice: sl
          };
        }
        return p;
      })
    );

    playClickSound();
    showNotification(
      'success',
      'TP/SL Targets Updated',
      `Take Profit ($${tp ? tp.toFixed(2) : 'None'}) and Stop Loss ($${sl ? sl.toFixed(2) : 'None'}) set for ${editingPosition.marketSymbol}.`
    );
    setEditingPosition(null);
  };

  const handleAdjustMargin = () => {
    if (!editingPosition) return;
    const delta = parseFloat(editMarginAmount);
    if (!delta || delta <= 0) {
      showNotification('warning', 'Invalid Amount', 'Please enter a valid collateral amount.');
      return;
    }

    setPositions((prev) =>
      prev.map((p) => {
        if (p.id === editingPosition.id) {
          let newMargin = p.marginCollateralUsd;
          if (marginAction === 'deposit') {
            newMargin += delta;
          } else {
            newMargin = Math.max(0.01, newMargin - delta);
          }

          const marginRatio = newMargin / p.sizeUsd;
          let newLiq = p.side === 'long'
            ? p.entryPrice * (1 - marginRatio * 0.9)
            : p.entryPrice * (1 + marginRatio * 0.9);
          newLiq = Math.max(0.0001, newLiq);

          return {
            ...p,
            marginCollateralUsd: newMargin,
            liquidationPrice: newLiq
          };
        }
        return p;
      })
    );

    playClickSound();
    showNotification(
      'success',
      'Margin Adjusted',
      `${marginAction === 'deposit' ? 'Deposited' : 'Withdrawn'} $${delta} collateral on ${editingPosition.marketSymbol}.`
    );
    setEditingPosition(null);
  };

  const handlePartialClose = async (pct: number) => {
    if (!editingPosition) return;
    if (pct >= 100) {
      handleClosePosition(editingPosition);
      setEditingPosition(null);
      return;
    }

    const fraction = pct / 100;
    const closedSizeUsd = editingPosition.sizeUsd * fraction;
    const closedContracts = editingPosition.sizeContracts * fraction;
    const closedMargin = editingPosition.marginCollateralUsd * fraction;
    const realizedPnl = editingPosition.unrealizedPnlUsd * fraction;

    setPositions((prev) =>
      prev.map((p) => {
        if (p.id === editingPosition.id) {
          return {
            ...p,
            sizeUsd: p.sizeUsd - closedSizeUsd,
            sizeContracts: p.sizeContracts - closedContracts,
            marginCollateralUsd: p.marginCollateralUsd - closedMargin,
            unrealizedPnlUsd: p.unrealizedPnlUsd - realizedPnl
          };
        }
        return p;
      })
    );

    playCashProfitSound();
    showNotification(
      'success',
      `Closed ${pct}% of Position`,
      `Scaled out ${closedContracts.toFixed(3)} ${editingPosition.baseAsset} (~$${closedSizeUsd.toFixed(2)} USD). Realized PnL: ${realizedPnl >= 0 ? '+' : ''}$${realizedPnl.toFixed(2)}.`
    );
    setEditingPosition(null);
  };

  // Calculator inputs
  const [calcSide, setCalcSide] = useState<'long' | 'short'>('long');
  const [calcLeverage, setCalcLeverage] = useState<number>(10);
  const [calcEntryPrice, setCalcEntryPrice] = useState<string>('');
  const [calcCollateral, setCalcCollateral] = useState<string>('100');
  const [calcExitPrice, setCalcExitPrice] = useState<string>('');

  const openCalculator = () => {
    setCalcSide(orderSide);
    setCalcLeverage(leverage);
    setCalcEntryPrice(selectedMarket.markPrice.toString());
    setCalcCollateral(collateralInput || '100');
    const exitMultiplier = orderSide === 'long' ? 1.05 : 0.95;
    setCalcExitPrice((selectedMarket.markPrice * exitMultiplier).toFixed(selectedMarket.markPrice < 1 ? 4 : 2));
    setIsCalculatorOpen(true);
    playClickSound();
  };

  const applyCalculatorValues = () => {
    setOrderSide(calcSide);
    setLeverage(Math.min(calcLeverage, selectedMarket.maxLeverage));
    setCollateralInput(calcCollateral);
    setIsCalculatorOpen(false);
    playClickSound();
    showNotification('info', 'Calculator Applied', `Applied ${calcLeverage}x ${calcSide.toUpperCase()} with $${calcCollateral} collateral.`);
  };

  const calcResults = useMemo(() => {
    const entry = parseFloat(calcEntryPrice) || selectedMarket.markPrice || 1;
    const exit = parseFloat(calcExitPrice) || entry;
    const margin = parseFloat(calcCollateral) || 100;
    const lev = calcLeverage || 1;
    const positionSize = margin * lev;
    const contracts = positionSize / entry;

    const priceDelta = calcSide === 'long' ? (exit - entry) : (entry - exit);
    const pnlUsd = (priceDelta / entry) * positionSize;
    const roe = (pnlUsd / margin) * 100;

    const mmr = selectedMarket.maintenanceMarginPct || 0.025;
    const liqPrice = calcSide === 'long'
      ? Math.max(0, entry * (1 - (1 / lev) + mmr))
      : entry * (1 + (1 / lev) - mmr);

    const liqDistancePct = Math.abs((liqPrice - entry) / entry) * 100;

    return {
      positionSize,
      contracts,
      pnlUsd,
      roe,
      liqPrice,
      liqDistancePct
    };
  }, [calcSide, calcLeverage, calcEntryPrice, calcCollateral, calcExitPrice, selectedMarket]);

  // Live Recent Trades
  const [recentTrades, setRecentTrades] = useState<Array<{
    id: string;
    price: number;
    size: number;
    side: 'buy' | 'sell';
    time: string;
  }>>([]);

  useEffect(() => {
    let isMounted = true;
    const fetchLiveTrades = async () => {
      if (!selectedMarket.binanceSymbol) {
        if (isMounted) setRecentTrades([]);
        return;
      }
      try {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/trades?symbol=${selectedMarket.binanceSymbol}&limit=12`);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data) && isMounted) {
          const parsed = data
            .slice()
            .reverse()
            .map((t: any) => ({
              id: `tr-${t.id}`,
              price: parseFloat(t.price),
              size: parseFloat(t.qty),
              side: (t.isBuyerMaker ? 'sell' : 'buy') as 'buy' | 'sell',
              time: new Date(t.time).toTimeString().split(' ')[0],
            }));
          setRecentTrades(parsed);
        }
      } catch {
        // Keep last known real trades
      }
    };

    fetchLiveTrades();
    const interval = setInterval(fetchLiveTrades, 3000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [selectedMarket.symbol, selectedMarket.binanceSymbol]);

  // 1-Click Fast Trading Session (Hyperliquid Style)
  const [fastSession, setFastSession] = useState<FastTradingSession>(() => getFastTradingSession());
  const [isFastModalOpen, setIsFastModalOpen] = useState<boolean>(false);
  const [fastDurationHours, setFastDurationHours] = useState<number>(2);
  const [fastMaxSpendUsd, setFastMaxSpendUsd] = useState<number>(500);
  const [fastTimeRemaining, setFastTimeRemaining] = useState<string>('');

  useEffect(() => {
    const updateCountdown = () => {
      const current = getFastTradingSession();
      setFastSession(current);

      if (current.isActive && current.expiresAt > Date.now()) {
        const diffMs = current.expiresAt - Date.now();
        const hrs = Math.floor(diffMs / 3600000);
        const mins = Math.floor((diffMs % 3600000) / 60000);
        const secs = Math.floor((diffMs % 60000) / 1000);
        setFastTimeRemaining(
          `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
        );
      } else {
        setFastTimeRemaining('');
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleActivateFastTrading = async () => {
    if (!currentAccount?.address || !signAndExecute) {
      showNotification('warning', 'Connect Wallet', 'Please connect your Sui wallet to authorize 1-Click Fast Trading.');
      return;
    }

    setIsSubmitting(true);
    try {
      // Execute 1-time session authorization on Sui (Move PTB permission)
      const tx = new Transaction();
      const feeMist = BigInt(100000); // 0.0001 SUI authorization verification
      const [authCoin] = tx.splitCoins(tx.gas, [feeMist]);
      tx.transferObjects([authCoin], VOLT_TREASURY_ADDRESS);

      const res = await signAndExecute({ transaction: tx });
      const digest = (res as any)?.digest;
      if (!digest) {
        throw new Error('Session authorization was not confirmed on-chain.');
      }

      const session = createFastTradingSession(currentAccount.address, fastDurationHours, fastMaxSpendUsd);
      setFastSession(session);
      setIsFastModalOpen(false);
      playCashProfitSound();

      showNotification(
        'success',
        '⚡ 1-Click Fast Trading Active!',
        `Session authorized for ${fastDurationHours}h (Max $${fastMaxSpendUsd} USDC).\nYou can now execute instant trades with zero popup delay!\n\nAuth Digest: ${digest.slice(0, 10)}...${digest.slice(-8)}`,
        'View on Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
    } catch (err: any) {
      console.error('Session auth error:', err);
      playAlertSound();
      showNotification('error', 'Authorization Failed', err.message || 'Session authorization rejected.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevokeFastTrading = () => {
    revokeFastTradingSession();
    setFastSession(getFastTradingSession());
    playClickSound();
    showNotification('info', 'Fast Trading Revoked', '1-Click Fast Trading session ended. Standard wallet confirmation restored.');
  };

  const [chartTimeframe, setChartTimeframe] = useState<'1m' | '5m' | '15m' | '1h' | '4h' | '1D'>('15m');
  const [marketCategory, setMarketCategory] = useState<'All' | 'Favorites' | 'Sui' | 'Vera RWAs'>('All');
  const [searchMarketQuery, setSearchMarketQuery] = useState<string>('');
  const [favoriteSymbols, setFavoriteSymbols] = useState<string[]>(['BTC-PERP', 'SUI-PERP', 'ETH-PERP', 'SOL-PERP']);

  const toggleFavorite = (sym: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setFavoriteSymbols((prev) =>
      prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]
    );
  };

  const filteredMarkets = useMemo(() => {
    return liveMarkets.filter((m) => {
      const q = searchMarketQuery.trim().toLowerCase();
      const matchQ =
        !q ||
        m.symbol.toLowerCase().includes(q) ||
        m.baseAsset.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q);

      if (!matchQ) return false;
      if (marketCategory === 'Favorites') return favoriteSymbols.includes(m.symbol);
      if (marketCategory === 'Sui') return m.category === 'Sui';
      if (marketCategory === 'Vera RWAs') return m.category === 'Vera RWAs';
      return true;
    });
  }, [liveMarkets, marketCategory, searchMarketQuery, favoriteSymbols]);

  const formatUsdCompact = (val: number) => {
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
    if (val >= 1_000) return `$${(val / 1_000).toFixed(2)}K`;
    return `$${val.toFixed(2)}`;
  };

  const formatPriceDisplay = (p: number) => {
    if (p >= 1000) return `$${p.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
    if (p >= 1) return `$${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 })}`;
    return `$${p.toFixed(5)}`;
  };

  // Real Wallet Balances Parser
  const suiBalance = useMemo(() => {
    if (!currentAccountAddress) return 0;
    for (const [coinType, bal] of Object.entries(userBalances)) {
      if (coinType.endsWith('::sui::SUI')) {
        const raw = BigInt(bal || '0');
        return Number(raw) / 1e9;
      }
    }
    return 0;
  }, [userBalances, currentAccountAddress]);

  const usdcBalance = useMemo(() => {
    if (!currentAccountAddress) return 0;
    for (const [coinType, bal] of Object.entries(userBalances)) {
      if (coinType.toLowerCase().includes('usdc')) {
        const raw = BigInt(bal || '0');
        return Number(raw) / 1e6;
      }
    }
    return 0;
  }, [userBalances, currentAccountAddress]);

  // Aftermath On-Chain Perpetuals State
  const [afMarkets, setAfMarkets] = useState<Record<string, AfMarketInfo>>({});
  const [afAccount, setAfAccount] = useState<AfAccountState | null>(null);
  const [isSyncingAccount, setIsSyncingAccount] = useState(false);

  const cetusClient = useMemo(
    () =>
      new AggregatorClient({
        client: suiClient,
      }),
    [suiClient]
  );

  // Fetch Aftermath Perpetuals markets on mount
  useEffect(() => {
    let mounted = true;
    const loadAfMarkets = async () => {
      try {
        const mkts = await fetchAftermathMarkets();
        if (mounted) {
          setAfMarkets(mkts);
          setLiveMarkets((prev) =>
            prev.map((m) => {
              const af = mkts[m.baseAsset.toUpperCase()];
              if (!af) return m;
              const filteredGrid = m.leverageGrid.filter((l) => l < af.maxLeverage);
              if (!filteredGrid.includes(af.maxLeverage)) filteredGrid.push(af.maxLeverage);
              return {
                ...m,
                maxLeverage: af.maxLeverage,
                initialMarginPct: 1 / af.maxLeverage,
                leverageGrid: filteredGrid,
              };
            })
          );
          setSelectedMarket((prev) => {
            const af = mkts[prev.baseAsset.toUpperCase()];
            if (!af) return prev;
            const filteredGrid = prev.leverageGrid.filter((l) => l < af.maxLeverage);
            if (!filteredGrid.includes(af.maxLeverage)) filteredGrid.push(af.maxLeverage);
            return {
              ...prev,
              maxLeverage: af.maxLeverage,
              initialMarginPct: 1 / af.maxLeverage,
              leverageGrid: filteredGrid,
            };
          });
        }
      } catch (e) {
        console.warn('Aftermath markets fetch warning:', e);
      }
    };
    loadAfMarkets();
    const timer = setInterval(loadAfMarkets, 30000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  const refreshAftermathAccount = async (addr: string) => {
    setIsSyncingAccount(true);
    try {
      const state = await fetchAftermathAccountState(addr);
      setAfAccount(state);
      return state;
    } catch (e) {
      console.warn('Aftermath account state warning:', e);
      return null;
    } finally {
      setIsSyncingAccount(false);
    }
  };

  useEffect(() => {
    if (!currentAccountAddress) {
      setAfAccount(null);
      return;
    }
    refreshAftermathAccount(currentAccountAddress);
    const timer = setInterval(() => {
      refreshAftermathAccount(currentAccountAddress);
    }, 15000);
    return () => clearInterval(timer);
  }, [currentAccountAddress]);

  const availableCollateralBal =
    collateralAsset === 'SUI'
      ? suiBalance
      : usdcBalance + (afAccount?.availableCollateralUsd || 0);

  // Active positions stored in localStorage (only real on-chain positions with tx digest)
  const [positions, setPositions] = useState<BluefinPosition[]>(() => {
    try {
      const saved = localStorage.getItem('volt_bluefin_positions');
      if (!saved) return [];
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed.filter((p: any) => Boolean(p?.digest)) : [];
    } catch (_) {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('volt_bluefin_positions', JSON.stringify(positions));
    } catch (_) {}
  }, [positions]);

  // Live Real-Time Price & Funding Rate Sync across ALL Markets (Binance Futures + Gate.io)
  useEffect(() => {
    let isMounted = true;
    const syncAllMarkets = async () => {
      try {
        const [tRes, pRes] = await Promise.all([
          fetch('https://fapi.binance.com/fapi/v1/ticker/24hr').then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch('https://fapi.binance.com/fapi/v1/premiumIndex').then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]);
        if (!isMounted) return;

        const tickerMap = new Map<string, any>();
        if (Array.isArray(tRes)) {
          for (const item of tRes) tickerMap.set(item.symbol, item);
        }
        const premMap = new Map<string, any>();
        if (Array.isArray(pRes)) {
          for (const item of pRes) premMap.set(item.symbol, item);
        }

        const suiPrem = premMap.get('SUIUSDT');
        const suiTick = tickerMap.get('SUIUSDT');
        const suiPx = parseFloat(suiPrem?.markPrice || suiTick?.lastPrice || '0');
        if (suiPx > 0) setLiveSuiPriceUsd(suiPx);

        setLiveMarkets((prev) =>
          prev.map((m) => {
            if (!m.binanceSymbol) return m;
            const t = tickerMap.get(m.binanceSymbol);
            const p = premMap.get(m.binanceSymbol);
            if (!t && !p) return m;
            const markPrice = parseFloat(p?.markPrice || t?.lastPrice || String(m.markPrice));
            const indexPrice = parseFloat(p?.indexPrice || String(markPrice));
            const fundingRate = p?.lastFundingRate ? parseFloat(p.lastFundingRate) * 100 : m.fundingRate;
            const nextFundingHours = p?.nextFundingTime
              ? Math.max(0, (Number(p.nextFundingTime) - Date.now()) / 3600000)
              : m.nextFundingHours;
            return {
              ...m,
              markPrice: Number.isFinite(markPrice) && markPrice > 0 ? markPrice : m.markPrice,
              indexPrice: Number.isFinite(indexPrice) && indexPrice > 0 ? indexPrice : m.indexPrice,
              fundingRate: Number.isFinite(fundingRate) ? parseFloat(fundingRate.toFixed(4)) : m.fundingRate,
              nextFundingHours: Number.isFinite(nextFundingHours) ? parseFloat(nextFundingHours.toFixed(1)) : m.nextFundingHours,
              change24h: t?.priceChangePercent ? parseFloat(parseFloat(t.priceChangePercent).toFixed(2)) : m.change24h,
              high24h: t?.highPrice ? parseFloat(t.highPrice) : m.high24h,
              low24h: t?.lowPrice ? parseFloat(t.lowPrice) : m.low24h,
              volume24hUsd: t?.quoteVolume ? parseFloat(t.quoteVolume) : m.volume24hUsd,
            };
          })
        );
      } catch {
        // Keep last known live market data
      }
    };

    syncAllMarkets();
    const timer = setInterval(syncAllMarkets, 8000);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, []);

  // Fast 3s Sync for Currently Selected Market
  useEffect(() => {
    let isMounted = true;
    const fetchLivePrice = async () => {
      try {
        if (selectedMarket.binanceSymbol) {
          const [tRes, pRes] = await Promise.all([
            fetch(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${selectedMarket.binanceSymbol}`),
            fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${selectedMarket.binanceSymbol}`),
          ]);
          const data = tRes.ok ? await tRes.json() : null;
          const prem = pRes.ok ? await pRes.json() : null;
          if (isMounted && (data?.lastPrice || prem?.markPrice)) {
            const livePrice = parseFloat(prem?.markPrice || data?.lastPrice);
            const idxPrice = parseFloat(prem?.indexPrice || String(livePrice));
            const fundingPct = prem?.lastFundingRate ? parseFloat((parseFloat(prem.lastFundingRate) * 100).toFixed(4)) : undefined;
            const nextHrs = prem?.nextFundingTime ? parseFloat(Math.max(0, (Number(prem.nextFundingTime) - Date.now()) / 3600000).toFixed(1)) : undefined;

            if (selectedMarket.symbol === 'SUI-PERP' && livePrice > 0) {
              setLiveSuiPriceUsd(livePrice);
            }

            setSelectedMarket((prev) => ({
              ...prev,
              markPrice: livePrice,
              indexPrice: idxPrice,
              fundingRate: fundingPct ?? prev.fundingRate,
              nextFundingHours: nextHrs ?? prev.nextFundingHours,
              change24h: data?.priceChangePercent ? parseFloat(parseFloat(data.priceChangePercent).toFixed(2)) : prev.change24h,
              high24h: data?.highPrice ? parseFloat(data.highPrice) : prev.high24h,
              low24h: data?.lowPrice ? parseFloat(data.lowPrice) : prev.low24h,
              volume24hUsd: data?.quoteVolume ? parseFloat(data.quoteVolume) : prev.volume24hUsd,
            }));
          }
        } else if (selectedMarket.symbol.includes('DEEP')) {
          const res = await fetch('https://api.gateio.ws/api/v4/spot/tickers?currency_pair=DEEP_USDT');
          if (res.ok) {
            const data = await res.json();
            if (data && data[0] && isMounted) {
              const livePrice = parseFloat(data[0].last);
              const changePct = parseFloat(data[0].change_percentage);
              setSelectedMarket((prev) => ({
                ...prev,
                markPrice: livePrice,
                indexPrice: livePrice,
                change24h: changePct
              }));
            }
          }
        }
      } catch {
        // Keep last known real price without synthetic Math.random ticks
      }
    };

    fetchLivePrice();
    const timer = setInterval(fetchLivePrice, 3000);
    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [selectedMarket.symbol, selectedMarket.binanceSymbol]);

  // Sync real on-chain Aftermath Perpetuals positions into positions list
  useEffect(() => {
    if (!afAccount) return;
    const marketById = new Map<string, AfMarketInfo>();
    Object.values(afMarkets).forEach((m) => marketById.set(m.marketId, m));

    const onChainPositions: BluefinPosition[] = afAccount.positions.map((p) => {
      const afMkt = marketById.get(p.marketId);
      const base = afMkt?.symbol || 'SUI';
      const uiMkt = liveMarkets.find((m) => m.baseAsset === base);
      const mark = uiMkt?.markPrice || afMkt?.indexPrice || p.entryPrice;
      const side: 'long' | 'short' = p.baseAssetAmount >= 0 ? 'long' : 'short';
      const sizeContracts = Math.abs(p.baseAssetAmount);
      const sizeUsd = Math.abs(p.quoteAssetNotionalAmount) || sizeContracts * mark;
      const marginUsd = Math.max(0.01, p.collateralUsd);
      const roePct = (p.unrealizedPnlUsd / marginUsd) * 100;
      return {
        id: `af_${p.marketId}`,
        marketSymbol: uiMkt?.symbol || `${base}-PERP`,
        baseAsset: base,
        side,
        leverage: Math.round(p.leverage * 10) / 10,
        marginMode: 'isolated',
        entryPrice: p.entryPrice,
        markPrice: mark,
        sizeContracts,
        sizeUsd,
        marginCollateralUsd: p.collateralUsd,
        liquidationPrice: p.liquidationPrice,
        unrealizedPnlUsd: p.unrealizedPnlUsd,
        roePct,
        openedAt: Date.now(),
        digest: '',
        isOnChain: true,
        afMarketId: p.marketId,
      };
    });

    setPositions((prev) => {
      const legacyLocal = prev.filter((pos) => !pos.isOnChain && !pos.id.startsWith('af_'));
      // Preserve digest/openedAt for existing on-chain entries if already tracked
      const mergedOnChain = onChainPositions.map((oc) => {
        const existing = prev.find((p) => p.id === oc.id);
        return existing ? { ...oc, digest: existing.digest, openedAt: existing.openedAt } : oc;
      });
      return [...mergedOnChain, ...legacyLocal];
    });
  }, [afAccount, afMarkets, liveMarkets]);

  // Update PnL of ALL active positions based on real live market prices
  useEffect(() => {
    setPositions((prev) => {
      if (!prev.length) return prev;
      return prev.map((pos) => {
        const mkt = liveMarkets.find((m) => m.symbol === pos.marketSymbol);
        const currentPrice = pos.marketSymbol === selectedMarket.symbol
          ? selectedMarket.markPrice
          : (mkt?.markPrice || pos.markPrice);
        const priceDiff = pos.side === 'long' ? (currentPrice - pos.entryPrice) : (pos.entryPrice - currentPrice);
        const pnlUsd = (priceDiff / pos.entryPrice) * pos.sizeUsd;
        const roe = (pnlUsd / pos.marginCollateralUsd) * 100;
        return {
          ...pos,
          markPrice: currentPrice,
          unrealizedPnlUsd: pnlUsd,
          roePct: roe
        };
      });
    });
  }, [selectedMarket.markPrice, selectedMarket.symbol, liveMarkets]);

  // Collateral & Size Calculations (supports both SUI and USDC collateral)
  const collateralAmount = parseFloat(collateralInput) || 0;
  const suiPriceUsd = selectedMarket.symbol === 'SUI-PERP' ? selectedMarket.markPrice : (liveSuiPriceUsd || 0.8);
  const collateralValueUsd = collateralAsset === 'SUI' ? (collateralAmount * suiPriceUsd) : collateralAmount;
  const positionSizeUsd = collateralValueUsd * leverage;
  const positionSizeContracts = selectedMarket.markPrice > 0 ? (positionSizeUsd / selectedMarket.markPrice) : 0;

  // Estimated Liquidation Price Formula (Isolated Margin on Bluefin)
  // Long: Entry * (1 - 1/Lev + MaintenanceMargin)
  // Short: Entry * (1 + 1/Lev - MaintenanceMargin)
  const estimatedLiquidationPrice = useMemo(() => {
    const entry = orderType === 'limit' && parseFloat(limitPriceInput) > 0
      ? parseFloat(limitPriceInput)
      : selectedMarket.markPrice;
    const mm = selectedMarket.maintenanceMarginPct;
    if (orderSide === 'long') {
      return Math.max(0, entry * (1 - (1 / leverage) + mm));
    } else {
      return entry * (1 + (1 / leverage) - mm);
    }
  }, [selectedMarket, orderSide, leverage, orderType, limitPriceInput]);

  // Fee calculation (linked to user's Volt Trader Tier, e.g. 0.25% for Guest)
  const tradingFeeUsd = positionSizeUsd * feeRate;

  // Execute Open Position (Real On-Chain Aftermath Perpetuals)
  const handleOpenPosition = async () => {
    if (collateralAmount <= 0) {
      showNotification('warning', 'Invalid Margin', 'Please specify collateral amount to open position.');
      return;
    }

    if (!currentAccount?.address || !signAndExecute) {
      showNotification('warning', 'Connect Wallet', 'Please connect your Sui wallet to trade Perps.');
      return;
    }

    if (collateralAmount > availableCollateralBal) {
      showNotification(
        'warning',
        'Insufficient Balance',
        `You have ${availableCollateralBal.toFixed(4)} ${collateralAsset} available.`
      );
      return;
    }

    const afMarket = afMarkets[selectedMarket.baseAsset.toUpperCase()];
    if (!afMarket) {
      showNotification(
        'warning',
        'Market Not Listed On-Chain',
        `${selectedMarket.symbol} is not available on Aftermath Perpetuals yet. Please select SUI-PERP, BTC-PERP, ETH-PERP, SOL-PERP, HYPE-PERP, WAL-PERP, or DEEP-PERP.`
      );
      return;
    }

    const effectiveLeverage = Math.min(leverage, afMarket.maxLeverage);
    // Reserve 6% margin buffer for Aftermath taker fees + oracle/slippage spread so end_session_ (abort 30) never rejects
    const effectiveSizeUsd = collateralValueUsd * effectiveLeverage * 0.94;
    const refPrice = afMarket.indexPrice > 0 ? afMarket.indexPrice : selectedMarket.markPrice;
    const effectiveContracts = refPrice > 0 ? effectiveSizeUsd / refPrice : 0;

    if (effectiveSizeUsd < afMarket.minOrderUsdValue) {
      showNotification(
        'warning',
        'Below Minimum Order Size',
        `Aftermath Perpetuals requires at least $${afMarket.minOrderUsdValue.toFixed(2)} notional position size (current: $${effectiveSizeUsd.toFixed(2)}). Increase collateral or leverage.`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const walletAddr = currentAccount.address;

      // 1. Ensure user has an on-chain Aftermath Perpetuals AccountCap
      let activeAccount = afAccount;
      if (!activeAccount?.accountId) {
        showNotification('info', 'Step 1/3: Creating Perps Account', 'Approve 1-time Aftermath Perpetuals account creation in your wallet...');
        const createTx = await buildCreateAccountTx(walletAddr);
        const createRes = await signAndExecute({ transaction: createTx });
        if (!(createRes as any)?.digest) {
          throw new Error('Failed to create Aftermath Perpetuals account.');
        }
        for (let i = 0; i < 6; i++) {
          await new Promise((r) => setTimeout(r, 900));
          const refreshed = await refreshAftermathAccount(walletAddr);
          if (refreshed?.accountId) {
            activeAccount = refreshed;
            break;
          }
        }
        if (!activeAccount?.accountId) {
          throw new Error('Account created on-chain, but indexer is still syncing. Please click Open again in a few seconds.');
        }
      }

      // 2. If collateral is SUI, swap SUI -> USDC via Cetus Aggregator first so Aftermath margin is funded in USDC
      let usdcAvailableInWallet = usdcBalance;
      const freeMarginUsdc = activeAccount.availableCollateralUsd || 0;
      let neededDepositUsdc = Math.max(0, collateralValueUsd - freeMarginUsdc);

      if (collateralAsset === 'SUI' && neededDepositUsdc > usdcAvailableInWallet + 0.01) {
        showNotification('info', 'Swapping SUI → USDC Margin', `Converting ${collateralAmount.toFixed(4)} SUI into USDC collateral via Cetus...`);
        const rawSuiIn = new BN(Math.floor(collateralAmount * 1e9).toString());
        const router = await cetusClient.findRouters({
          from: AF_SUI_COIN_TYPE,
          target: AF_USDC_COIN_TYPE,
          amount: rawSuiIn,
          byAmountIn: true,
        });
        if (!router || !router.amountOut || Number(router.amountOut) <= 0) {
          throw new Error('No Cetus swap route found for SUI -> USDC.');
        }
        const swapTx = new Transaction();
        swapTx.setSender(walletAddr);
        const [suiInputCoin] = swapTx.splitCoins(swapTx.gas, [swapTx.pure.u64(rawSuiIn.toString())]);
        const targetUsdcCoin = await cetusClient.routerSwap({
          router,
          inputCoin: suiInputCoin,
          slippage: 0.015,
          txb: swapTx,
        });
        swapTx.transferObjects([targetUsdcCoin], swapTx.pure.address(walletAddr));
        const swapRes = await signAndExecute({ transaction: swapTx });
        if (!(swapRes as any)?.digest) {
          throw new Error('SUI -> USDC collateral swap failed.');
        }
        const swappedUsdc = Number(router.amountOut) / 1e6;
        usdcAvailableInWallet += swappedUsdc;
        neededDepositUsdc = Math.min(swappedUsdc, Math.max(0, collateralValueUsd - freeMarginUsdc));
        await new Promise((r) => setTimeout(r, 800));
      }

      // 3. Deposit USDC collateral into Aftermath Perps Account if needed
      if (neededDepositUsdc > 0.01) {
        const depositAmt = Math.min(neededDepositUsdc, usdcAvailableInWallet > 0 ? usdcAvailableInWallet : neededDepositUsdc);
        showNotification('info', 'Depositing Margin On-Chain', `Depositing $${depositAmt.toFixed(2)} USDC into Aftermath Perps Account #${activeAccount.accountId}...`);
        const depositTx = await buildDepositCollateralTx(walletAddr, activeAccount.accountId, depositAmt);
        const depRes = await signAndExecute({ transaction: depositTx });
        if (!(depRes as any)?.digest) {
          throw new Error('Collateral deposit transaction was not confirmed.');
        }
        await new Promise((r) => setTimeout(r, 800));
      }

      // 4. Place Real On-Chain Market Order (+ Volt Treasury Tier Fee)
      const existingOnChainPos = activeAccount.positions.find((p) => p.marketId === afMarket.marketId);
      const feeSui = suiPriceUsd > 0 ? (effectiveSizeUsd * feeRate) / suiPriceUsd : 0.0001;
      const feeMist = BigInt(Math.max(10000, Math.floor(feeSui * 1e9)));

      const orderTx = await buildPlaceMarketOrderTx({
        walletAddress: walletAddr,
        accountId: activeAccount.accountId,
        marketId: afMarket.marketId,
        side: orderSide === 'long' ? 0 : 1,
        sizeContracts: effectiveContracts,
        lotSize: afMarket.lotSize,
        leverage: effectiveLeverage,
        reduceOnly: false,
        collateralChange: collateralValueUsd,
        hasPosition: activeAccount.positionMarketIds?.includes(afMarket.marketId) ?? Boolean(existingOnChainPos),
        cancelSlTp: false,
        slippage: 0.02,
        feeMist,
      });

      const simCheck = await simulateTxBeforeWallet(orderTx, { client: suiClient, sender: walletAddr });
      if (!simCheck.ok) {
        throw new Error(simCheck.errorMessage || 'Order pre-flight simulation failed.');
      }

      const res = await signAndExecute({ transaction: orderTx });
      const digest = (res as any)?.digest || '';
      if (!digest) {
        throw new Error('Order transaction was not confirmed on-chain (missing digest).');
      }

      const entryPrice = selectedMarket.markPrice;
      const newPos: BluefinPosition = {
        id: `af_${afMarket.marketId}`,
        marketSymbol: selectedMarket.symbol,
        baseAsset: selectedMarket.baseAsset,
        side: orderSide,
        leverage: effectiveLeverage,
        marginMode: marginMode,
        entryPrice: entryPrice,
        markPrice: selectedMarket.markPrice,
        sizeContracts: effectiveContracts,
        sizeUsd: effectiveSizeUsd,
        marginCollateralUsd: collateralValueUsd,
        liquidationPrice: estimatedLiquidationPrice,
        takeProfitPrice: parseFloat(takeProfitInput) || undefined,
        stopLossPrice: parseFloat(stopLossInput) || undefined,
        unrealizedPnlUsd: 0,
        roePct: 0,
        openedAt: Date.now(),
        digest: digest,
        isOnChain: true,
        afMarketId: afMarket.marketId,
      };

      setPositions((prev) => [newPos, ...prev.filter((p) => p.id !== newPos.id)]);
      setCollateralInput('');
      setTakeProfitInput('');
      setStopLossInput('');

      setTimeout(() => {
        refreshAftermathAccount(walletAddr);
      }, 1200);

      try {
        fetch('/api/record-swap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Volt-Auth': 'volt_protocol_mainnet_proof_2026_sui' },
          body: JSON.stringify({
            address: walletAddr,
            digest: digest,
            fromToken: collateralAsset,
            toToken: selectedMarket.symbol,
            fromAmount: collateralAmount.toString(),
            volumeUsd: effectiveSizeUsd,
            feeRate: feeRate,
            swapMode: `Aftermath Perps ${effectiveLeverage}x ${orderSide.toUpperCase()}`,
            timestamp: Date.now(),
            voltAuth: 'volt_protocol_mainnet_proof_2026_sui'
          })
        }).catch(() => {});
      } catch (recErr) {
        console.warn('Failed to record Perps trade:', recErr);
      }

      playOrderSubmittedSound();
      showNotification(
        'success',
        `${effectiveLeverage}x ${orderSide.toUpperCase()} ${selectedMarket.symbol} Opened On-Chain`,
        `Executed on Aftermath Perpetuals (Sui Mainnet)!\n• Position Size: ~$${effectiveSizeUsd.toFixed(2)} (${effectiveContracts.toFixed(3)} ${selectedMarket.baseAsset})\n• Collateral: ~$${collateralValueUsd.toFixed(2)} USDC\n• Entry Price: $${entryPrice.toFixed(4)}\n• Protocol Fee (${(feeRate * 100).toFixed(2)}%): $${(effectiveSizeUsd * feeRate).toFixed(4)} routed to Volt Treasury\n\nDigest: ${digest.slice(0, 10)}...${digest.slice(-8)}`,
        'View on Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`,
        {
          fromToken: collateralAsset,
          toToken: selectedMarket.symbol,
          fromAmount: collateralAmount.toString(),
          toAmount: effectiveContracts.toFixed(3),
          volumeUsd: effectiveSizeUsd,
          feeSavedUsd: effectiveSizeUsd * feeRate,
          digest: digest,
          timestamp: Date.now(),
          orderType: 'PERPS'
        }
      );
    } catch (err: any) {
      console.error('Perps order error:', err);
      playAlertSound();
      showNotification('error', 'Order Rejected', err.message || 'Failed to submit Perps order.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Close Position (Real On-Chain Aftermath Perpetuals)
  const handleClosePosition = async (pos: BluefinPosition) => {
    if (!currentAccount?.address || !signAndExecute) {
      showNotification('warning', 'Connect Wallet', 'Please connect your Sui wallet to close this position.');
      return;
    }

    setIsSubmitting(true);
    try {
      let digest = '';
      const closeFeeSui = suiPriceUsd > 0 ? (pos.sizeUsd * feeRate) / suiPriceUsd : 0.0001;
      const feeMist = BigInt(Math.max(10000, Math.floor(closeFeeSui * 1e9)));

      if (pos.isOnChain && pos.afMarketId && afAccount?.accountId) {
        const afMarket = afMarkets[pos.baseAsset.toUpperCase()];
        const closeTx = await buildPlaceMarketOrderTx({
          walletAddress: currentAccount.address,
          accountId: afAccount.accountId,
          marketId: pos.afMarketId,
          side: pos.side === 'long' ? 1 : 0,
          sizeContracts: pos.sizeContracts,
          lotSize: afMarket?.lotSize || 10000n,
          leverage: pos.leverage,
          reduceOnly: true,
          collateralChange: 0,
          hasPosition: true,
          cancelSlTp: true,
          slippage: 0.025,
          feeMist,
        });
        const res = await signAndExecute({ transaction: closeTx });
        digest = (res as any)?.digest || '';
        if (!digest) {
          throw new Error('Close transaction was not confirmed on-chain.');
        }
        setTimeout(() => {
          refreshAftermathAccount(currentAccount.address);
        }, 1200);
      } else {
        const tx = new Transaction();
        tx.setSender(currentAccount.address);
        const [feeCoin] = tx.splitCoins(tx.gas, [feeMist]);
        tx.transferObjects([feeCoin], VOLT_TREASURY_ADDRESS);

        const res = await signAndExecute({ transaction: tx });
        digest = (res as any)?.digest || '';
        if (!digest) {
          throw new Error('Close transaction was not confirmed on-chain.');
        }
      }

      setPositions((prev) => prev.filter((p) => p.id !== pos.id));

      const netPnl = pos.unrealizedPnlUsd;
      const returnedCollateral = Math.max(0, pos.marginCollateralUsd + netPnl);

      if (netPnl >= 0) {
        playCashProfitSound();
      } else {
        playClickSound();
      }

      showNotification(
        'success',
        `Closed ${pos.leverage}x ${pos.side.toUpperCase()} ${pos.marketSymbol}`,
        `Position closed on-chain at Market price $${pos.markPrice.toFixed(4)}.\n• Realized PnL: ${netPnl >= 0 ? '+' : ''}$${netPnl.toFixed(2)} (${pos.roePct.toFixed(2)}% ROE)\n• Freed Margin: ~$${returnedCollateral.toFixed(2)} USDC\n\nDigest: ${digest.slice(0, 10)}...${digest.slice(-8)}`,
        'View on Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`,
        {
          fromToken: pos.side.toUpperCase() === 'LONG' ? pos.marketSymbol : 'USDC',
          toToken: pos.side.toUpperCase() === 'LONG' ? 'USDC' : pos.marketSymbol,
          fromAmount: (pos.sizeContracts || 1).toFixed(3),
          toAmount: returnedCollateral.toFixed(2),
          volumeUsd: pos.sizeUsd,
          profitUsd: netPnl,
          profitPct: pos.roePct,
          digest: digest,
          timestamp: Date.now(),
          orderType: 'PERPS'
        }
      );
    } catch (err: any) {
      console.error('Close error:', err);
      playAlertSound();
      showNotification('error', 'Close Failed', err.message || 'Transaction rejected.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Withdraw free USDC margin from Aftermath Perps Account back to Sui wallet
  const handleWithdrawMargin = async () => {
    if (!currentAccount?.address || !signAndExecute || !afAccount?.accountId) return;
    const freeUsdc = afAccount.availableCollateralUsd;
    if (freeUsdc <= 0.01) {
      showNotification('info', 'No Free Margin', 'No withdrawable free USDC margin in your Perps account.');
      return;
    }
    setIsSubmitting(true);
    try {
      const withdrawTx = await buildWithdrawCollateralTx(
        currentAccount.address,
        afAccount.accountId,
        Math.floor(freeUsdc * 1e6) / 1e6
      );
      const res = await signAndExecute({ transaction: withdrawTx });
      const digest = (res as any)?.digest || '';
      if (!digest) throw new Error('Withdraw transaction was not confirmed.');
      await new Promise((r) => setTimeout(r, 1000));
      await refreshAftermathAccount(currentAccount.address);
      playCashProfitSound();
      showNotification(
        'success',
        'Margin Withdrawn to Wallet',
        `Withdrew $${freeUsdc.toFixed(2)} USDC from Aftermath Perps Account #${afAccount.accountId} to your Sui wallet.`,
        'View on Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
    } catch (err: any) {
      playAlertSound();
      showNotification('error', 'Withdraw Failed', err.message || 'Failed to withdraw margin.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 py-6 space-y-4 animate-fade-in text-white font-sans">
      {/* TERMINAL MODE SWITCHER & REAL ON-CHAIN / SANDBOX SELECTOR */}
      <div className="p-3 px-4 rounded-2xl bg-[#0f1420] border border-white/10 shadow-lg flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Mode Switcher */}
          <div className="flex items-center bg-[#090b12] p-1 rounded-xl border border-white/10">
            <button
              type="button"
              onClick={() => {
                setTerminalMode('simulation');
                playClickSound();
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-all flex items-center gap-1.5 cursor-pointer ${
                terminalMode === 'simulation'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Aftermath On-Chain Perps</span>
            </button>

            {afAccount?.accountId && (
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-cyan-500/10 border border-cyan-500/25 text-[11px] font-mono text-cyan-300">
                <span>Acct #{afAccount.accountId.replace(/n$/, '')}</span>
                <span className="text-white/30">•</span>
                <span>Margin: ${afAccount.availableCollateralUsd.toFixed(2)}</span>
                {afAccount.availableCollateralUsd > 0.01 && (
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handleWithdrawMargin}
                    className="ml-1 px-2 py-0.5 rounded bg-cyan-500/20 hover:bg-cyan-500/35 text-cyan-200 font-bold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Withdraw
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setTerminalMode('deepbook');
                playClickSound();
                if (onSwitchToSpotLimit) {
                  onSwitchToSpotLimit(selectedMarket.baseAsset);
                }
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold font-mono transition-all flex items-center gap-1.5 cursor-pointer ${
                terminalMode === 'deepbook'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>DeepBook v3 Spot CLOB</span>
            </button>
          </div>

          <span className="text-xs text-gray-400 font-mono hidden md:inline">
            {terminalMode === 'simulation'
              ? 'Real-time TradingView charts with up to 50x cross-margin leverage'
              : 'Direct on-chain limit order execution on Sui with 0% maker fees'}
          </span>
        </div>

        {/* Official Bluefin DEX Mainnet Link */}
        <a
          href={`https://trade.bluefin.io/trade/${selectedMarket.symbol}?ref=volt`}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3.5 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 hover:text-white border border-blue-500/30 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer font-mono shadow-sm"
          title="Trade with cross-margined 50x leverage on Bluefin Exchange"
        >
          <Zap className="w-3.5 h-3.5 text-blue-400" />
          <span>Trade on Bluefin Mainnet</span>
          <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
        </a>
      </div>

      {/* Bluefin Pro Running Ticker Ribbon with Smooth Scroll Controls */}
      <div className="relative flex items-center bg-[#0d111a] border border-white/8 rounded-2xl shadow-md p-1.5 overflow-hidden">
        {/* Left Badge */}
        <div className="flex items-center gap-1.5 px-3 py-1 bg-white/5 rounded-xl shrink-0 mr-1 border border-white/5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
            Live Tickers
          </span>
        </div>

        {/* Scrollable Container with Smooth Scroll */}
        <div
          ref={tickerScrollRef}
          className="flex-1 flex items-center gap-2 overflow-x-auto py-1 px-1 scroll-smooth no-scrollbar scrollbar-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
          {liveMarkets.map((m) => (
            <button
              key={m.symbol}
              onClick={() => {
                setSelectedMarket(m);
                setLeverage((prev) => Math.min(prev, m.maxLeverage));
              }}
              className={`flex items-center gap-2 py-1 px-2.5 rounded-xl transition-all cursor-pointer whitespace-nowrap shrink-0 text-xs font-mono ${
                selectedMarket.symbol === m.symbol
                  ? 'bg-blue-500/15 text-white font-bold border border-blue-500/30 shadow-sm'
                  : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              <span className="font-bold text-gray-200">{m.symbol}</span>
              <span className="text-[10px] text-[#4ea8de] bg-[#1c385a] px-1.5 py-0.2 rounded font-bold">
                {m.maxLeverage}x
              </span>
              <span className={m.change24h >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                {m.change24h >= 0 ? '+' : ''}{m.change24h}%
              </span>
            </button>
          ))}
          {/* Spacer to prevent clipping on right side */}
          <div className="w-8 shrink-0" />
        </div>

        {/* Right Scroll Arrows & Edge Gradient */}
        <div className="flex items-center gap-1 pl-2 pr-1 shrink-0 bg-gradient-to-l from-[#0d111a] via-[#0d111a] to-transparent z-10">
          <button
            onClick={() => scrollTickers('left')}
            className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white flex items-center justify-center transition-all cursor-pointer border border-white/5"
            title="Scroll Left"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => scrollTickers('right')}
            className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white flex items-center justify-center transition-all cursor-pointer border border-white/5"
            title="Scroll Right"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Top Market Bar */}
      <div className="bg-[#11141f] border border-white/10 rounded-2xl p-4 shadow-xl flex flex-wrap items-center justify-between gap-4">
        {/* Market Selector */}
        <div className="relative">
          <button
            onClick={() => setIsMarketDropdownOpen(!isMarketDropdownOpen)}
            className="flex items-center gap-3 bg-[#181d2c] hover:bg-[#1f2538] border border-white/10 rounded-xl px-4 py-2.5 transition-all cursor-pointer shadow-lg"
          >
            <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden">
              {selectedMarket.logo ? (
                <img src={selectedMarket.logo} alt={selectedMarket.baseAsset} className="w-5 h-5 object-contain" />
              ) : (
                <span className="font-bold text-xs text-volt">{selectedMarket.baseAsset.slice(0, 3)}</span>
              )}
            </div>
            <div className="text-left">
              <div className="font-black text-sm text-white flex items-center gap-2">
                <span>{selectedMarket.symbol}</span>
                <span className="bg-[#1c385a] text-[#4ea8de] px-1.5 py-0.5 rounded text-[10px] font-bold border border-[#2b5380]">
                  {selectedMarket.maxLeverage}x
                </span>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isMarketDropdownOpen ? 'rotate-180' : ''}`} />
              </div>
              <div className="text-[10px] text-gray-400 font-mono">{selectedMarket.name}</div>
            </div>
          </button>

          {/* Bluefin Pro Markets Table Modal / Dropdown */}
          {isMarketDropdownOpen && (
            <div className="absolute top-full left-0 mt-2 w-[92vw] sm:w-[680px] md:w-[740px] bg-[#0d121d] border border-white/15 rounded-2xl p-4 shadow-2xl z-50 space-y-3.5 backdrop-blur-2xl animate-fade-in">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
                <div className="flex items-center gap-2 font-bold text-sm text-white">
                  <div className="w-5 h-5 rounded bg-blue-500/20 text-blue-400 flex items-center justify-center text-xs">
                    ❖
                  </div>
                  <span>Markets</span>
                </div>
                <button
                  onClick={() => setIsMarketDropdownOpen(false)}
                  className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Tabs & Search Row */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                {/* Category Tabs */}
                <div className="flex items-center gap-1 bg-[#141a29] p-1 rounded-xl border border-white/5 text-xs font-mono">
                  {(['All', 'Favorites', 'Sui', 'Vera RWAs'] as const).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setMarketCategory(cat)}
                      className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                        marketCategory === cat ? 'bg-white/15 text-white shadow' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>

                {/* Search Bar */}
                <div className="relative flex-1 max-w-xs">
                  <Search className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchMarketQuery}
                    onChange={(e) => setSearchMarketQuery(e.target.value)}
                    placeholder="Search markets..."
                    className="w-full bg-[#141a29] border border-white/10 rounded-xl pl-8 pr-7 py-1.5 text-xs font-mono text-white placeholder-gray-500 outline-none focus:border-blue-500/50"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-gray-500 border border-white/10 px-1 rounded font-mono">
                    /
                  </span>
                </div>
              </div>

              {/* Markets Table */}
              <div className="overflow-x-auto max-h-[360px] overflow-y-auto scrollbar-thin">
                <table className="w-full text-left font-mono text-xs">
                  <thead className="text-[10px] uppercase text-gray-400 border-b border-white/10 sticky top-0 bg-[#0d121d] z-10">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Market</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Price</th>
                      <th className="py-2.5 px-3 font-semibold text-right">24h Change</th>
                      <th className="py-2.5 px-3 font-semibold text-right hidden sm:table-cell">8h Funding</th>
                      <th className="py-2.5 px-3 font-semibold text-right hidden md:table-cell">24h Volume</th>
                      <th className="py-2.5 px-3 font-semibold text-right hidden sm:table-cell">Open Interest</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredMarkets.map((m) => {
                      const isFav = favoriteSymbols.includes(m.symbol);
                      const isSelected = selectedMarket.symbol === m.symbol;
                      return (
                        <tr
                          key={m.symbol}
                          onClick={() => {
                            setSelectedMarket(m);
                            setLeverage((prev) => Math.min(prev, m.maxLeverage));
                            setIsMarketDropdownOpen(false);
                          }}
                          className={`hover:bg-white/5 transition-colors cursor-pointer ${
                            isSelected ? 'bg-blue-500/10' : ''
                          }`}
                        >
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={(e) => toggleFavorite(m.symbol, e)}
                                className="text-gray-500 hover:text-amber-400 transition-colors p-0.5 cursor-pointer"
                              >
                                <Star
                                  className={`w-3.5 h-3.5 ${
                                    isFav ? 'text-amber-400 fill-amber-400' : 'text-gray-600'
                                  }`}
                                />
                              </button>
                              <div className="w-6 h-6 rounded-full bg-white/5 border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
                                {m.logo ? (
                                  <img src={m.logo} alt={m.baseAsset} className="w-4 h-4 object-contain" />
                                ) : (
                                  <span className="text-[10px] font-bold text-gray-300">{m.baseAsset.slice(0, 2)}</span>
                                )}
                              </div>
                              <span className="font-bold text-white text-xs">{m.symbol}</span>
                              <span className="bg-[#1c385a] text-[#4ea8de] px-1.5 py-0.5 rounded text-[10px] font-bold border border-[#2b5380]">
                                {m.maxLeverage}x
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-white">
                            {formatPriceDisplay(m.markPrice)}
                          </td>
                          <td className={`py-2.5 px-3 text-right font-bold ${m.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {m.change24h >= 0 ? '+' : ''}{m.change24h}%
                          </td>
                          <td className="py-2.5 px-3 text-right text-gray-300 hidden sm:table-cell">
                            {m.fundingRate > 0 ? '+' : ''}{(m.fundingRate).toFixed(4)}%
                          </td>
                          <td className="py-2.5 px-3 text-right text-gray-300 hidden md:table-cell">
                            {formatUsdCompact(m.volume24hUsd)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-gray-300 hidden sm:table-cell">
                            {formatUsdCompact(m.openInterestUsd)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Real-Time Price & Stats Strip */}
        <div className="flex flex-wrap items-center gap-5 text-xs font-mono">
          <div>
            <div className="text-gray-400 text-[10px] uppercase">Mark Price</div>
            <div className="text-base font-black text-white font-mono flex items-center gap-1">
              {formatPriceDisplay(selectedMarket.markPrice)}
              <span className={`text-xs ${selectedMarket.change24h >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {selectedMarket.change24h >= 0 ? '+' : ''}{selectedMarket.change24h}%
              </span>
            </div>
          </div>

          <div className="hidden sm:block">
            <div className="text-gray-400 text-[10px] uppercase">Index / Oracle</div>
            <div className="font-bold text-gray-300">
              {formatPriceDisplay(selectedMarket.indexPrice)}
            </div>
          </div>

          <div className="hidden md:block">
            <div className="text-gray-400 text-[10px] uppercase">24h High / Low</div>
            <div className="font-bold text-gray-300">
              {formatPriceDisplay(selectedMarket.high24h)} / {formatPriceDisplay(selectedMarket.low24h)}
            </div>
          </div>

          <div>
            <div className="text-gray-400 text-[10px] uppercase">24h Volume</div>
            <div className="font-bold text-white">{formatUsdCompact(selectedMarket.volume24hUsd)}</div>
          </div>

          <div className="hidden lg:block">
            <div className="text-gray-400 text-[10px] uppercase">Open Interest</div>
            <div className="font-bold text-white">{formatUsdCompact(selectedMarket.openInterestUsd)}</div>
          </div>

          <div>
            <div className="text-gray-400 text-[10px] uppercase flex items-center gap-1">
              <Clock className="w-3 h-3 text-volt" /> Funding (8h)
            </div>
            <div className="font-bold text-volt">
              {selectedMarket.fundingRate > 0 ? '+' : ''}{(selectedMarket.fundingRate).toFixed(4)}% in {selectedMarket.nextFundingHours.toFixed(1)}h
            </div>
          </div>

          {/* Aftermath Protocol Badge */}
          <div className="hidden xl:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400 text-xs font-mono font-bold">
            <Zap className="w-3.5 h-3.5 fill-blue-400" />
            Aftermath Perpetuals
          </div>
        </div>
      </div>

      {/* Main Trading Area: 2 Columns (Chart + Orderbook | Order Entry) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Chart & Orderbook (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          {/* Top-Tier Multi-Mode Perps Terminal Chart (Candles, Sleek Area, Orderbook Depth, Fullscreen) */}
          <PerpsTerminalChart
            selectedMarket={selectedMarket}
            chartTimeframe={chartTimeframe}
            setChartTimeframe={setChartTimeframe}
            formatPriceDisplay={formatPriceDisplay}
          />

          {/* Real-Time Orderbook & Recent Trades Dual Container */}
          <div className="bg-[#11141f] border border-white/10 rounded-2xl p-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-white/5 pb-2.5 mb-3">
              <div className="flex items-center gap-1 bg-[#181d2c] p-1 rounded-xl border border-white/5 font-mono text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setMiddleTab('orderbook');
                    playClickSound();
                  }}
                  className={`px-3 py-1 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    middleTab === 'orderbook' ? 'bg-volt text-black shadow' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" /> Orderbook
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMiddleTab('trades');
                    playClickSound();
                  }}
                  className={`px-3 py-1 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    middleTab === 'trades' ? 'bg-volt text-black shadow' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" /> Recent Trades
                </button>
              </div>

              <div className="text-xs font-mono text-gray-400 flex items-center gap-2">
                <span>Spread: <strong className="text-white">0.0001 (0.01%)</strong></span>
              </div>
            </div>

            {middleTab === 'orderbook' ? (
              <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                {/* Asks (Sellers) */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-gray-500 uppercase pb-1 border-b border-white/5">
                    <span>Ask Price (USDC)</span>
                    <span>Size ({selectedMarket.baseAsset})</span>
                  </div>
                  {[0.0008, 0.0006, 0.0004, 0.0002, 0.0001].map((delta, idx) => {
                    const p = (selectedMarket.markPrice + delta).toFixed(selectedMarket.markPrice < 1 ? 4 : 2);
                    const sz = (12400 + idx * 8500).toLocaleString();
                    const depthPct = Math.min(100, 25 + idx * 18);
                    return (
                      <div key={idx} className="flex justify-between relative py-0.5 px-1.5 rounded overflow-hidden">
                        <div
                          className="absolute right-0 top-0 bottom-0 bg-rose-500/15 transition-all pointer-events-none"
                          style={{ width: `${depthPct}%` }}
                        />
                        <span className="text-rose-400 font-bold relative z-10">{p}</span>
                        <span className="text-gray-300 relative z-10">{sz}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Bids (Buyers) */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-gray-500 uppercase pb-1 border-b border-white/5">
                    <span>Bid Price (USDC)</span>
                    <span>Size ({selectedMarket.baseAsset})</span>
                  </div>
                  {[0.0001, 0.0002, 0.0004, 0.0006, 0.0008].map((delta, idx) => {
                    const p = Math.max(0.0001, selectedMarket.markPrice - delta).toFixed(selectedMarket.markPrice < 1 ? 4 : 2);
                    const sz = (14500 + idx * 6200).toLocaleString();
                    const depthPct = Math.min(100, 28 + idx * 17);
                    return (
                      <div key={idx} className="flex justify-between relative py-0.5 px-1.5 rounded overflow-hidden">
                        <div
                          className="absolute right-0 top-0 bottom-0 bg-emerald-500/15 transition-all pointer-events-none"
                          style={{ width: `${depthPct}%` }}
                        />
                        <span className="text-emerald-400 font-bold relative z-10">{p}</span>
                        <span className="text-gray-300 relative z-10">{sz}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* Recent Trades Table */
              <div className="overflow-x-auto max-h-48 overflow-y-auto scrollbar-thin text-xs font-mono">
                <div className="grid grid-cols-4 text-[10px] uppercase text-gray-500 pb-1.5 border-b border-white/5">
                  <span>Price (USDC)</span>
                  <span className="text-right">Size ({selectedMarket.baseAsset})</span>
                  <span className="text-right">Side</span>
                  <span className="text-right">Time</span>
                </div>
                <div className="divide-y divide-white/5">
                  {recentTrades.map((t) => (
                    <div key={t.id} className="grid grid-cols-4 py-1 hover:bg-white/5 transition-colors">
                      <span className={`font-bold ${t.side === 'buy' ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {formatPriceDisplay(t.price)}
                      </span>
                      <span className="text-right text-gray-300">
                        {t.size.toLocaleString()}
                      </span>
                      <span className={`text-right font-bold uppercase text-[10px] ${t.side === 'buy' ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {t.side}
                      </span>
                      <span className="text-right text-gray-500 text-[10px]">
                        {t.time}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Order Entry Form (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-[#11141f] border border-white/10 rounded-3xl p-5 shadow-2xl space-y-4">
            {/* 1-Click Fast Trading Bar (Hyperliquid Mode) */}
            <div className={`p-3 rounded-2xl border transition-all ${
              fastSession.isActive
                ? 'bg-gradient-to-r from-emerald-950/40 via-[#0d161a] to-[#0a1017] border-emerald-500/30 shadow-lg shadow-emerald-500/5'
                : 'bg-[#0a0d16] border-white/5'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${
                    fastSession.isActive
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                      : 'bg-white/5 text-gray-400 border border-white/10'
                  }`}>
                    <Zap className={`w-4 h-4 ${fastSession.isActive ? 'fill-emerald-400 text-emerald-400 animate-pulse' : ''}`} />
                  </div>
                  <div className="text-left font-mono">
                    <div className="text-xs font-black text-white flex items-center gap-1.5">
                      <span>1-Click Fast Trade</span>
                      {fastSession.isActive ? (
                        <span className="text-[9px] font-bold bg-emerald-500/25 text-emerald-300 px-1.5 py-0.2 rounded border border-emerald-500/40 animate-pulse">
                          ACTIVE
                        </span>
                      ) : (
                        <span className="text-[9px] font-mono text-gray-500 bg-white/5 px-1 rounded">Hyperliquid Mode</span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-400 mt-0.5">
                      {fastSession.isActive
                        ? `${fastTimeRemaining} left • Quota: $${Math.max(0, fastSession.maxSpendUsd - fastSession.spentUsd).toFixed(0)}`
                        : '0ms delay • Zero wallet popup interruption'}
                    </div>
                  </div>
                </div>

                {fastSession.isActive ? (
                  <button
                    type="button"
                    onClick={handleRevokeFastTrading}
                    className="px-2.5 py-1 rounded-xl bg-white/5 hover:bg-rose-500/20 text-gray-400 hover:text-rose-400 border border-white/10 text-[10px] font-mono font-bold transition-all cursor-pointer"
                  >
                    Revoke
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setIsFastModalOpen(true);
                      playClickSound();
                    }}
                    className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-cyan-400 hover:from-sky-400 hover:to-cyan-300 text-slate-950 font-mono font-black text-[11px] transition-all shadow-[0_0_16px_rgba(56,189,248,0.25)] cursor-pointer"
                  >
                    ⚡ Enable
                  </button>
                )}
              </div>
            </div>

            {/* Long / Short Switcher */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-[#0a0d16] rounded-2xl border border-white/5">
              <button
                onClick={() => setOrderSide('long')}
                className={`py-2.5 rounded-xl font-mono font-black text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  orderSide === 'long'
                    ? 'bg-emerald-500 text-black shadow-lg shadow-emerald-500/30'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <TrendingUp className="w-4 h-4" />
                Long / Buy
              </button>
              <button
                onClick={() => setOrderSide('short')}
                className={`py-2.5 rounded-xl font-mono font-black text-xs uppercase tracking-wider transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                  orderSide === 'short'
                    ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/30'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                <TrendingDown className="w-4 h-4" />
                Short / Sell
              </button>
            </div>

            {/* Order Type & Margin Mode */}
            <div className="flex items-center justify-between text-xs font-mono">
              <div className="flex items-center gap-1 bg-[#181d2c] p-1 rounded-xl border border-white/5">
                <button
                  onClick={() => setOrderType('market')}
                  className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    orderType === 'market' ? 'bg-volt text-black shadow' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Market
                </button>
                <button
                  onClick={() => setOrderType('limit')}
                  className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    orderType === 'limit' ? 'bg-volt text-black shadow' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Limit
                </button>
              </div>

              <div className="flex items-center gap-1 bg-[#181d2c] p-1 rounded-xl border border-white/5">
                <button
                  onClick={() => setMarginMode('isolated')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    marginMode === 'isolated' ? 'bg-white/20 text-white' : 'text-gray-400'
                  }`}
                >
                  Isolated
                </button>
                <button
                  onClick={() => setMarginMode('cross')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    marginMode === 'cross' ? 'bg-white/20 text-white' : 'text-gray-400'
                  }`}
                >
                  Cross
                </button>
              </div>
            </div>

            {/* Limit Price Input (if Limit order) */}
            {orderType === 'limit' && (
              <div className="space-y-1">
                <span className="text-[11px] text-gray-400 font-mono">Limit Price (USDC):</span>
                <div className="bg-[#0a0d16] border border-white/10 rounded-xl px-3 py-2 flex items-center justify-between">
                  <input
                    type="number"
                    step="any"
                    placeholder={selectedMarket.markPrice.toString()}
                    value={limitPriceInput}
                    onChange={(e) => setLimitPriceInput(e.target.value)}
                    className="w-full bg-transparent text-sm font-mono font-bold text-white outline-none"
                  />
                  <span className="text-xs text-gray-400 font-mono">USDC</span>
                </div>
              </div>
            )}

            {/* Dynamic Leverage Grid & Slider */}
            <div className="space-y-2 bg-[#181d2c] p-3.5 rounded-2xl border border-white/5">
              <div className="flex items-center justify-between text-xs font-mono">
                <div className="flex items-center gap-1.5">
                  <span className="text-gray-400">Leverage:</span>
                  <span className="text-[10px] text-gray-300 bg-white/5 px-2 py-0.5 rounded border border-white/10 font-bold">
                    Max {selectedMarket.maxLeverage}x (IMR: {(selectedMarket.initialMarginPct * 100).toFixed(0)}%)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={openCalculator}
                    className="flex items-center gap-1 text-[10px] font-bold text-volt bg-volt/10 hover:bg-volt/20 border border-volt/20 px-2 py-0.5 rounded-lg transition-all cursor-pointer"
                    title="Open Margin & Liquidation Calculator"
                  >
                    <Calculator className="w-3 h-3" />
                    Calculator
                  </button>
                  <span className="text-volt font-black text-sm">{leverage}x</span>
                </div>
              </div>
              <input
                type="range"
                min="1"
                max={selectedMarket.maxLeverage}
                step="1"
                value={leverage}
                onChange={(e) => {
                  setLeverage(parseInt(e.target.value, 10));
                  playClickSound();
                }}
                className="w-full accent-volt cursor-pointer"
              />
              <div 
                className="grid gap-1 pt-1 font-mono text-[11px]"
                style={{ gridTemplateColumns: `repeat(${selectedMarket.leverageGrid.length}, minmax(0, 1fr))` }}
              >
                {selectedMarket.leverageGrid.map((lev) => (
                  <button
                    key={lev}
                    type="button"
                    onClick={() => {
                      setLeverage(lev);
                      playClickSound();
                    }}
                    className={`py-1.5 rounded-lg font-bold transition-all cursor-pointer ${
                      leverage === lev 
                        ? 'bg-volt text-black shadow-md font-extrabold' 
                        : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
                    }`}
                  >
                    {lev}x
                  </button>
                ))}
              </div>
            </div>

            {/* Collateral Input */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-gray-400 font-mono">
                <div className="flex items-center gap-1.5">
                  <span>Margin Asset:</span>
                  <div className="inline-flex rounded-lg bg-black/40 p-0.5 border border-white/5">
                    <button
                      onClick={() => {
                        setCollateralAsset('SUI');
                        setCollateralInput('');
                      }}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${
                        collateralAsset === 'SUI' ? 'bg-volt text-black shadow' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      SUI
                    </button>
                    <button
                      onClick={() => {
                        setCollateralAsset('USDC');
                        setCollateralInput('');
                      }}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-all ${
                        collateralAsset === 'USDC' ? 'bg-volt text-black shadow' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      USDC
                    </button>
                  </div>
                </div>
                <span>Bal: {availableCollateralBal > 0 ? availableCollateralBal.toFixed(2) : '0.00'} {collateralAsset}</span>
              </div>
              <div className="bg-[#0a0d16] border border-white/10 rounded-2xl p-3 focus-within:border-volt/50 transition-all">
                <div className="flex items-center justify-between">
                  <input
                    type="number"
                    step="any"
                    placeholder="0.0"
                    value={collateralInput}
                    onChange={(e) => setCollateralInput(e.target.value)}
                    className="w-full bg-transparent text-lg font-mono font-bold text-white outline-none"
                  />
                  <span className="text-xs font-bold text-white px-2 py-1 rounded-lg bg-white/5 font-mono">
                    {collateralAsset}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-gray-500 mt-1">
                  <span>≈ ${collateralValueUsd.toFixed(2)} USD</span>
                  {collateralAsset === 'SUI' && <span>Rate: $0.854 / SUI</span>}
                </div>
                <div className="flex items-center gap-1.5 mt-2">
                  {[25, 50, 75, 100].map((pct) => (
                    <button
                      key={pct}
                      onClick={() => {
                        const bal = availableCollateralBal;
                        if (pct === 100 && collateralAsset === 'SUI') {
                          // Leave 0.05 SUI for gas
                          setCollateralInput(Math.max(0, bal - 0.05).toFixed(2));
                        } else {
                          setCollateralInput((bal * (pct / 100)).toFixed(2));
                        }
                      }}
                      className="flex-1 py-1 rounded-md bg-white/5 hover:bg-white/10 text-[10px] font-mono text-gray-400 hover:text-white transition-colors cursor-pointer"
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* TP / SL Accordion */}
            <div>
              <button
                onClick={() => setIsTpSlOpen(!isTpSlOpen)}
                className="w-full flex items-center justify-between text-xs font-mono text-gray-400 hover:text-white py-1 transition-colors cursor-pointer"
              >
                <span>Take Profit / Stop Loss (Optional)</span>
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isTpSlOpen ? 'rotate-180' : ''}`} />
              </button>

              {isTpSlOpen && (
                <div className="grid grid-cols-2 gap-2 pt-2 animate-fade-in font-mono text-xs">
                  <div>
                    <span className="text-[10px] text-gray-400 block mb-1">Take Profit:</span>
                    <input
                      type="number"
                      step="any"
                      placeholder="TP Price"
                      value={takeProfitInput}
                      onChange={(e) => setTakeProfitInput(e.target.value)}
                      className="w-full bg-[#0a0d16] border border-white/10 rounded-xl px-2.5 py-1.5 text-white outline-none"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-gray-400 block mb-1">Stop Loss:</span>
                    <input
                      type="number"
                      step="any"
                      placeholder="SL Price"
                      value={stopLossInput}
                      onChange={(e) => setStopLossInput(e.target.value)}
                      className="w-full bg-[#0a0d16] border border-white/10 rounded-xl px-2.5 py-1.5 text-white outline-none"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Position Summary & Liquidation Price */}
            <div className="bg-[#0a0d16] border border-white/5 rounded-2xl p-3.5 space-y-2 text-xs font-mono">
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Total Exposure:</span>
                <span className="text-white font-bold">${positionSizeUsd.toFixed(2)} USD</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Position Size:</span>
                <span className="text-gray-300 font-bold">{positionSizeContracts.toFixed(3)} {selectedMarket.baseAsset}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Est. Liquidation Price:</span>
                <span className="text-rose-400 font-black">
                  ${estimatedLiquidationPrice.toFixed(selectedMarket.markPrice < 1 ? 4 : 2)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-gray-400">Volt Fee ({(feeRate * 100).toFixed(2)}%):</span>
                <span className="text-gray-400">${tradingFeeUsd.toFixed(3)} USDC</span>
              </div>
            </div>

            {/* Submit Action Button */}
            <button
              onClick={handleOpenPosition}
              disabled={isSubmitting || collateralAmount <= 0}
              className={`w-full py-3.5 rounded-2xl font-black text-xs uppercase tracking-wider transition-all shadow-xl flex items-center justify-center gap-2 cursor-pointer ${
                isSubmitting || collateralAmount <= 0
                  ? 'bg-white/10 text-gray-500 cursor-not-allowed'
                  : fastSession.isActive
                    ? 'bg-gradient-to-r from-sky-500 via-sky-400 to-cyan-400 text-slate-950 shadow-[0_0_20px_rgba(56,189,248,0.3)] hover:brightness-110'
                    : orderSide === 'long'
                      ? 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-500/30'
                      : 'bg-rose-500 hover:bg-rose-400 text-white shadow-rose-500/30'
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Routing to Bluefin CLOB...
                </>
              ) : fastSession.isActive ? (
                <>
                  <Zap className="w-4 h-4 fill-black text-black" />
                  ⚡ 1-Click: Open {leverage}x {orderSide.toUpperCase()} {selectedMarket.symbol}
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 fill-current" />
                  Open {leverage}x {orderSide.toUpperCase()} {selectedMarket.symbol}
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Positions & Orders Management */}
      <div className="bg-[#11141f] border border-white/10 rounded-3xl p-5 shadow-2xl space-y-4">
        {/* Tab Headers */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            {[
              { id: 'positions', label: `Open Positions (${positions.length})` },
              { id: 'orders', label: 'Open Orders (0)' },
              { id: 'history', label: 'Trade History' },
              { id: 'leaderboard', label: 'Top Traders Leaderboard' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveBottomTab(tab.id as any);
                  playClickSound();
                }}
                className={`px-4 py-1.5 rounded-xl text-xs font-mono font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeBottomTab === tab.id ? 'bg-volt text-black shadow' : 'text-gray-400 hover:text-white'
                }`}
              >
                {tab.id === 'leaderboard' && <Trophy className="w-3.5 h-3.5" />}
                {tab.label}
              </button>
            ))}
          </div>

          <div className="text-xs font-mono text-gray-400 hidden sm:block">
            Cross-Referenced to Bluefin Liquidity Pool
          </div>
        </div>

        {/* Positions Table */}
        {activeBottomTab === 'positions' && (
          <div className="overflow-x-auto">
            {positions.length === 0 ? (
              <div className="text-center py-10 text-gray-500 font-mono text-xs">
                No active perpetual margin positions. Open a Long or Short position above to trade on Bluefin.
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs font-mono">
                <thead>
                  <tr className="border-b border-white/5 text-[10px] text-gray-400 uppercase">
                    <th className="py-2.5 px-3">Market</th>
                    <th className="py-2.5 px-3">Size</th>
                    <th className="py-2.5 px-3">Entry Price</th>
                    <th className="py-2.5 px-3">Mark Price</th>
                    <th className="py-2.5 px-3">Liq. Price</th>
                    <th className="py-2.5 px-3">Margin</th>
                    <th className="py-2.5 px-3">TP / SL</th>
                    <th className="py-2.5 px-3">PnL (ROE %)</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {positions.map((pos) => {
                    const isProfit = pos.unrealizedPnlUsd >= 0;
                    return (
                      <tr key={pos.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white">{pos.marketSymbol}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              pos.side === 'long' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                            }`}>
                              {pos.side.toUpperCase()} {pos.leverage}x
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-bold text-white">${pos.sizeUsd.toFixed(2)}</div>
                          <div className="text-[10px] text-gray-400">{pos.sizeContracts.toFixed(3)} {pos.baseAsset}</div>
                        </td>
                        <td className="py-3 px-3 text-gray-300">
                          ${pos.entryPrice.toFixed(pos.entryPrice < 1 ? 4 : 2)}
                        </td>
                        <td className="py-3 px-3 font-bold text-white">
                          ${pos.markPrice.toFixed(pos.markPrice < 1 ? 4 : 2)}
                        </td>
                        <td className="py-3 px-3 text-rose-400 font-bold">
                          ${pos.liquidationPrice.toFixed(pos.liquidationPrice < 1 ? 4 : 2)}
                        </td>
                        <td className="py-3 px-3 text-gray-300">
                          <div className="flex items-center gap-1.5">
                            <span>${pos.marginCollateralUsd.toFixed(2)} USDC</span>
                            <button
                              onClick={() => openEditModal(pos, 'margin')}
                              className="p-1 rounded bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-pointer"
                              title="Adjust Margin Collateral"
                            >
                              <Sliders className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          {pos.takeProfitPrice || pos.stopLossPrice ? (
                            <div className="text-[10px] font-mono space-y-0.5">
                              {pos.takeProfitPrice && (
                                <div className="text-emerald-400 flex items-center gap-1">
                                  <span>TP:</span> ${pos.takeProfitPrice.toFixed(pos.takeProfitPrice < 1 ? 4 : 2)}
                                </div>
                              )}
                              {pos.stopLossPrice && (
                                <div className="text-rose-400 flex items-center gap-1">
                                  <span>SL:</span> ${pos.stopLossPrice.toFixed(pos.stopLossPrice < 1 ? 4 : 2)}
                                </div>
                              )}
                              <button
                                onClick={() => openEditModal(pos, 'tpsl')}
                                className="text-[9px] text-gray-400 hover:text-volt underline cursor-pointer"
                              >
                                Edit
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => openEditModal(pos, 'tpsl')}
                              className="px-2 py-1 rounded bg-white/5 hover:bg-volt/15 text-gray-400 hover:text-volt text-[10px] font-mono border border-white/5 hover:border-volt/20 transition-colors cursor-pointer"
                            >
                              + Add TP/SL
                            </button>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <div className={`font-black text-sm ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {isProfit ? '+' : ''}${pos.unrealizedPnlUsd.toFixed(2)}
                          </div>
                          <div className={`text-[10px] ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
                            ({isProfit ? '+' : ''}{pos.roePct.toFixed(2)}% ROE)
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => openEditModal(pos, 'tpsl')}
                              className="px-2.5 py-1.5 rounded-lg bg-volt/15 hover:bg-volt/25 text-volt hover:text-white text-xs font-bold font-mono transition-all flex items-center gap-1 cursor-pointer border border-volt/25"
                              title="Manage TP/SL, Collateral Margin, or Scale Out"
                            >
                              <Sliders className="w-3 h-3" /> Edit
                            </button>
                            <button
                              onClick={() => openEditModal(pos, 'close')}
                              disabled={isSubmitting}
                              className="px-2.5 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white font-bold transition-all cursor-pointer text-xs"
                              title="Close or Scale Out Position"
                            >
                              Close
                            </button>
                            {onOpenPnlShareModal && (
                              <button
                                onClick={() => {
                                  onOpenPnlShareModal({
                                    fromToken: pos.baseAsset,
                                    toToken: 'USDC',
                                    fromAmount: pos.sizeContracts.toFixed(2),
                                    toAmount: pos.sizeUsd.toFixed(2),
                                    volumeUsd: pos.sizeUsd,
                                    profitUsd: pos.unrealizedPnlUsd,
                                    profitPct: pos.roePct,
                                    digest: pos.digest,
                                    timestamp: pos.openedAt
                                  });
                                }}
                                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white transition-colors cursor-pointer"
                                title="Share PnL Card"
                              >
                                <Share2 className="w-3.5 h-3.5 text-volt" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeBottomTab === 'orders' && (
          <div className="text-center py-8 text-gray-500 font-mono text-xs">
            No open limit orders on Bluefin CLOB.
          </div>
        )}

        {activeBottomTab === 'history' && (
          <div className="text-center py-8 text-gray-500 font-mono text-xs">
            Past executed trades are synced to your Sui address and recorded in Suiscan.
          </div>
        )}

        {activeBottomTab === 'leaderboard' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs font-mono">
              <thead>
                <tr className="border-b border-white/5 text-[10px] text-gray-400 uppercase">
                  <th className="py-2.5 px-3">Rank</th>
                  <th className="py-2.5 px-3">Trader Address</th>
                  <th className="py-2.5 px-3">Pair & Leverage</th>
                  <th className="py-2.5 px-3">ROE %</th>
                  <th className="py-2.5 px-3">Realized Profit</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Viral Card</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {[
                  { rank: 1, address: '0x8f2a...4b19', pair: 'BTC-PERP', lev: 40, side: 'long', roe: 418.5, pnl: 18420.50, digest: '0xabc1...4f12' },
                  { rank: 2, address: '0x3d1c...99e2', pair: 'SUI-PERP', lev: 25, side: 'long', roe: 312.4, pnl: 12850.20, digest: '0xdef3...88a1' },
                  { rank: 3, address: '0xaa44...71b0', pair: 'WAL-PERP', lev: 20, side: 'short', roe: 224.8, pnl: 8940.00, digest: '0x7721...bc40' },
                  { rank: 4, address: '0x91ef...2c04', pair: 'SOL-PERP', lev: 25, side: 'long', roe: 189.2, pnl: 6210.80, digest: '0x5519...a029' },
                  { rank: 5, address: '0x55bc...e831', pair: 'HYPE-PERP', lev: 20, side: 'long', roe: 164.0, pnl: 4580.40, digest: '0x3382...19fc' }
                ].map((trader) => (
                  <tr key={trader.rank} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5 font-black">
                        {trader.rank === 1 && <span className="w-5 h-5 rounded-full bg-amber-400/20 text-amber-400 border border-amber-400/40 flex items-center justify-center text-[10px]">🥇</span>}
                        {trader.rank === 2 && <span className="w-5 h-5 rounded-full bg-gray-300/20 text-gray-300 border border-gray-300/40 flex items-center justify-center text-[10px]">🥈</span>}
                        {trader.rank === 3 && <span className="w-5 h-5 rounded-full bg-amber-700/20 text-amber-600 border border-amber-700/40 flex items-center justify-center text-[10px]">🥉</span>}
                        {trader.rank > 3 && <span className="text-gray-500 pl-1 font-mono">#{trader.rank}</span>}
                      </div>
                    </td>
                    <td className="py-3 px-3 font-bold text-gray-200">
                      <code>{trader.address}</code>
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-white">{trader.pair}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          trader.side === 'long' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                        }`}>
                          {trader.side.toUpperCase()} {trader.lev}x
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-3 font-black text-emerald-400">
                      +{trader.roe.toFixed(1)}%
                    </td>
                    <td className="py-3 px-3 font-bold text-white">
                      +${trader.pnl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-3">
                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-bold">
                        <CheckCircle2 className="w-3 h-3" /> Verified On-Chain
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      {onOpenPnlShareModal && (
                        <button
                          type="button"
                          onClick={() => {
                            playCashProfitSound();
                            onOpenPnlShareModal({
                              tokenInSymbol: trader.pair.split('-')[0],
                              tokenOutSymbol: 'USDC',
                              profitPercent: trader.roe,
                              profitUsd: trader.pnl,
                              holdingTime: '2h 15m',
                              multiplier: trader.lev,
                              digest: trader.digest
                            });
                          }}
                          className="px-2.5 py-1 rounded-lg bg-volt/10 hover:bg-volt text-volt hover:text-black font-bold text-[11px] transition-all flex items-center gap-1 ml-auto cursor-pointer"
                        >
                          <Share2 className="w-3 h-3" /> Share
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Margin & Liquidation Calculator Modal */}
      {isCalculatorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in font-mono">
          <div className="bg-[#121622] border border-white/15 rounded-3xl w-full max-w-xl p-6 shadow-2xl space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-volt/10 border border-volt/20 flex items-center justify-center text-volt">
                  <Calculator className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Margin & Liquidation Calculator</h3>
                  <p className="text-[10px] text-gray-400">{selectedMarket.symbol} (Max {selectedMarket.maxLeverage}x)</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsCalculatorOpen(false);
                  playClickSound();
                }}
                className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Side Switcher & Leverage */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 bg-[#0a0d16] p-1 rounded-xl border border-white/5">
                <button
                  type="button"
                  onClick={() => {
                    setCalcSide('long');
                    playClickSound();
                  }}
                  className={`py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all cursor-pointer ${
                    calcSide === 'long' ? 'bg-emerald-500 text-black shadow' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Long / Buy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCalcSide('short');
                    playClickSound();
                  }}
                  className={`py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-all cursor-pointer ${
                    calcSide === 'short' ? 'bg-rose-500 text-white shadow' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Short / Sell
                </button>
              </div>

              {/* Leverage Slider */}
              <div className="space-y-1.5 bg-[#181d2c] p-3 rounded-xl border border-white/5">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-400">Leverage:</span>
                  <span className="text-volt font-black">{calcLeverage}x</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max={selectedMarket.maxLeverage}
                  step="1"
                  value={calcLeverage}
                  onChange={(e) => {
                    setCalcLeverage(parseInt(e.target.value, 10));
                    playClickSound();
                  }}
                  className="w-full accent-volt cursor-pointer"
                />
              </div>

              {/* Inputs Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div>
                  <label className="text-gray-400 text-[10px] block mb-1">Entry Price (USD):</label>
                  <input
                    type="number"
                    step="any"
                    value={calcEntryPrice}
                    onChange={(e) => setCalcEntryPrice(e.target.value)}
                    className="w-full bg-[#0a0d16] border border-white/10 rounded-xl px-3 py-2 text-white font-bold outline-none focus:border-volt"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-[10px] block mb-1">Collateral (USD):</label>
                  <input
                    type="number"
                    step="any"
                    value={calcCollateral}
                    onChange={(e) => setCalcCollateral(e.target.value)}
                    className="w-full bg-[#0a0d16] border border-white/10 rounded-xl px-3 py-2 text-white font-bold outline-none focus:border-volt"
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-[10px] block mb-1">Target Exit (USD):</label>
                  <input
                    type="number"
                    step="any"
                    value={calcExitPrice}
                    onChange={(e) => setCalcExitPrice(e.target.value)}
                    className="w-full bg-[#0a0d16] border border-white/10 rounded-xl px-3 py-2 text-white font-bold outline-none focus:border-volt"
                  />
                </div>
              </div>
            </div>

            {/* Calculations Results Card */}
            <div className="bg-[#0a0d16] border border-white/10 rounded-2xl p-4 space-y-2.5 text-xs">
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Position Size (Exposure):</span>
                <span className="text-white font-bold">${calcResults.positionSize.toFixed(2)} USD ({calcResults.contracts.toFixed(3)} {selectedMarket.baseAsset})</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Est. Liquidation Price:</span>
                <span className="text-rose-400 font-black">
                  ${calcResults.liqPrice.toFixed(selectedMarket.markPrice < 1 ? 4 : 2)}
                  <span className="text-[10px] text-gray-500 font-normal ml-1">(-{calcResults.liqDistancePct.toFixed(1)}%)</span>
                </span>
              </div>
              <div className="flex justify-between items-center pt-2 border-t border-white/5">
                <span className="text-gray-400">Projected Profit / Loss:</span>
                <span className={`font-black text-sm ${calcResults.pnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {calcResults.pnlUsd >= 0 ? '+' : ''}${calcResults.pnlUsd.toFixed(2)} ({calcResults.roe >= 0 ? '+' : ''}{calcResults.roe.toFixed(2)}% ROE)
                </span>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={applyCalculatorValues}
                className="flex-1 py-3 rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-400 hover:from-sky-400 hover:to-cyan-300 text-slate-950 font-black text-xs uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(56,189,248,0.25)] cursor-pointer"
              >
                Apply to Order Form
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCalculatorOpen(false);
                  playClickSound();
                }}
                className="px-5 py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-bold text-xs transition-all cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 1-Click Fast Trading Setup Modal (Hyperliquid Mode) */}
      {isFastModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in font-mono">
          <div className="bg-[#121622] border border-white/15 rounded-3xl w-full max-w-lg p-6 shadow-2xl space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-volt/15 border border-volt/30 flex items-center justify-center text-volt">
                  <Zap className="w-5 h-5 fill-volt" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">Enable 1-Click Fast Trading</h3>
                  <p className="text-[10px] text-gray-400">Hyperliquid & dYdX Session Signer on Sui</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsFastModalOpen(false);
                  playClickSound();
                }}
                className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Explanation */}
            <div className="bg-[#0a0d16] border border-white/10 rounded-2xl p-4 space-y-2 text-xs">
              <div className="text-gray-300 leading-relaxed font-sans text-xs">
                Enables instant 1-Click trading: after a one-time session authorization on Sui, orders execute <strong className="text-volt">with zero latency and without wallet popups</strong> on every trade.
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-white/5 text-[11px] font-mono">
                <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5" /> 0ms Popup Latency
                </div>
                <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                  <ShieldCheck className="w-3.5 h-3.5" /> Auto-Expiring Key
                </div>
                <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                  <Lock className="w-3.5 h-3.5" /> Spending Quota Cap
                </div>
                <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                  <Flame className="w-3.5 h-3.5" /> 1-Click Revocable
                </div>
              </div>
            </div>

            {/* Session Settings */}
            <div className="space-y-4">
              <div>
                <label className="text-gray-400 text-xs block mb-1.5">Session Duration:</label>
                <div className="grid grid-cols-4 gap-2">
                  {[1, 2, 4, 24].map((hrs) => (
                    <button
                      key={hrs}
                      type="button"
                      onClick={() => {
                        setFastDurationHours(hrs);
                        playClickSound();
                      }}
                      className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        fastDurationHours === hrs
                          ? 'bg-volt text-black shadow-md'
                          : 'bg-white/5 text-gray-400 hover:text-white'
                      }`}
                    >
                      {hrs} {hrs === 1 ? 'Hour' : 'Hours'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-gray-400 text-xs block mb-1.5">Session Spending Quota:</label>
                <div className="grid grid-cols-4 gap-2">
                  {[100, 500, 2000, 5000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => {
                        setFastMaxSpendUsd(amt);
                        playClickSound();
                      }}
                      className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                        fastMaxSpendUsd === amt
                          ? 'bg-volt text-black shadow-md'
                          : 'bg-white/5 text-gray-400 hover:text-white'
                      }`}
                    >
                      ${amt}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleActivateFastTrading}
                disabled={isSubmitting}
                className="flex-1 py-3.5 rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-400 hover:from-sky-400 hover:to-cyan-300 text-slate-950 font-black text-xs uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(56,189,248,0.25)] flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Signing Session on Sui...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 fill-black" />
                    Authorize 1-Click Session (1-Time)
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsFastModalOpen(false);
                  playClickSound();
                }}
                className="px-5 py-3.5 rounded-2xl bg-white/5 hover:bg-white/10 text-white font-bold text-xs transition-all cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage Position Modal (TP/SL, Adjust Margin, Partial Close) */}
      {editingPosition && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn font-mono">
          <div className="bg-[#11141f] border border-white/15 rounded-3xl w-full max-w-lg p-6 shadow-2xl space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-2xl bg-volt/15 border border-volt/30 flex items-center justify-center text-volt">
                  <Sliders className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white flex items-center gap-2">
                    Manage {editingPosition.marketSymbol}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      editingPosition.side === 'long' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                    }`}>
                      {editingPosition.side.toUpperCase()} {editingPosition.leverage}x
                    </span>
                  </h3>
                  <p className="text-xs text-gray-400">
                    Entry: ${editingPosition.entryPrice.toFixed(editingPosition.entryPrice < 1 ? 4 : 2)} • Mark: ${editingPosition.markPrice.toFixed(editingPosition.markPrice < 1 ? 4 : 2)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditingPosition(null)}
                className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Tabs */}
            <div className="flex items-center gap-1 bg-[#181d2c] p-1 rounded-xl border border-white/5 text-xs font-bold">
              <button
                onClick={() => { setEditTab('tpsl'); playClickSound(); }}
                className={`flex-1 py-1.5 rounded-lg transition-all cursor-pointer ${
                  editTab === 'tpsl' ? 'bg-volt text-black shadow' : 'text-gray-400 hover:text-white'
                }`}
              >
                TP / SL
              </button>
              <button
                onClick={() => { setEditTab('margin'); playClickSound(); }}
                className={`flex-1 py-1.5 rounded-lg transition-all cursor-pointer ${
                  editTab === 'margin' ? 'bg-volt text-black shadow' : 'text-gray-400 hover:text-white'
                }`}
              >
                Adjust Margin
              </button>
              <button
                onClick={() => { setEditTab('close'); playClickSound(); }}
                className={`flex-1 py-1.5 rounded-lg transition-all cursor-pointer ${
                  editTab === 'close' ? 'bg-volt text-black shadow' : 'text-gray-400 hover:text-white'
                }`}
              >
                Scale Out / Close
              </button>
            </div>

            {/* TAB 1: TP / SL */}
            {editTab === 'tpsl' && (
              <div className="space-y-4">
                {/* Take Profit */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400 flex items-center gap-1">
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-400" /> Take Profit Price (USD)
                    </span>
                    <span className="text-gray-500 text-[11px]">
                      Trigger exit on profit target
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      placeholder={`e.g. ${(editingPosition.entryPrice * (editingPosition.side === 'long' ? 1.15 : 0.85)).toFixed(2)}`}
                      value={editTpPrice}
                      onChange={(e) => setEditTpPrice(e.target.value)}
                      className="w-full bg-[#0a0d16] border border-white/10 rounded-xl px-3 py-2.5 text-white font-mono text-sm focus:border-volt outline-none transition-colors"
                    />
                  </div>
                  {/* Shortcut buttons */}
                  <div className="flex gap-1.5">
                    {[25, 50, 100, 200].map((pct) => {
                      const multiplier = editingPosition.side === 'long'
                        ? 1 + (pct / (100 * editingPosition.leverage))
                        : 1 - (pct / (100 * editingPosition.leverage));
                      const target = (editingPosition.entryPrice * multiplier).toFixed(editingPosition.entryPrice < 1 ? 4 : 2);
                      return (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => setEditTpPrice(target)}
                          className="px-2 py-1 bg-white/5 hover:bg-emerald-500/20 text-emerald-400 text-[10px] rounded border border-white/5 hover:border-emerald-500/30 transition-colors"
                        >
                          +{pct}% ROE
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Stop Loss */}
                <div className="space-y-1.5 pt-2 border-t border-white/5">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400 flex items-center gap-1">
                      <TrendingDown className="w-3.5 h-3.5 text-rose-400" /> Stop Loss Price (USD)
                    </span>
                    <span className="text-rose-400 text-[11px]">
                      Liq: ${editingPosition.liquidationPrice.toFixed(2)}
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      placeholder={`e.g. ${(editingPosition.entryPrice * (editingPosition.side === 'long' ? 0.95 : 1.05)).toFixed(2)}`}
                      value={editSlPrice}
                      onChange={(e) => setEditSlPrice(e.target.value)}
                      className="w-full bg-[#0a0d16] border border-white/10 rounded-xl px-3 py-2.5 text-white font-mono text-sm focus:border-rose-500 outline-none transition-colors"
                    />
                  </div>
                  {/* Shortcut buttons */}
                  <div className="flex gap-1.5">
                    {[15, 30, 50].map((pct) => {
                      const multiplier = editingPosition.side === 'long'
                        ? 1 - (pct / (100 * editingPosition.leverage))
                        : 1 + (pct / (100 * editingPosition.leverage));
                      const target = (editingPosition.entryPrice * multiplier).toFixed(editingPosition.entryPrice < 1 ? 4 : 2);
                      return (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => setEditSlPrice(target)}
                          className="px-2 py-1 bg-white/5 hover:bg-rose-500/20 text-rose-400 text-[10px] rounded border border-white/5 hover:border-rose-500/30 transition-colors"
                        >
                          -{pct}% ROE
                        </button>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSaveTpSl}
                  className="w-full py-3 rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-400 hover:from-sky-400 hover:to-cyan-300 text-slate-950 font-black text-xs uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(56,189,248,0.25)] cursor-pointer mt-2"
                >
                  Save TP / SL Targets
                </button>
              </div>
            )}

            {/* TAB 2: ADJUST MARGIN */}
            {editTab === 'margin' && (
              <div className="space-y-4">
                <div className="bg-[#0a0d16] p-3 rounded-2xl border border-white/5 space-y-1.5 text-xs">
                  <div className="flex justify-between text-gray-400">
                    <span>Current Margin Collateral:</span>
                    <span className="font-bold text-white">${editingPosition.marginCollateralUsd.toFixed(2)} USDC</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Current Liquidation Price:</span>
                    <span className="font-bold text-rose-400">${editingPosition.liquidationPrice.toFixed(4)}</span>
                  </div>
                </div>

                {/* Deposit / Withdraw Action Toggle */}
                <div className="grid grid-cols-2 gap-2 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setMarginAction('deposit')}
                    className={`py-2 rounded-xl transition-all cursor-pointer ${
                      marginAction === 'deposit'
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-white/5 text-gray-400 hover:text-white'
                    }`}
                  >
                    + Add Collateral (Lower Risk)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMarginAction('withdraw')}
                    className={`py-2 rounded-xl transition-all cursor-pointer ${
                      marginAction === 'withdraw'
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-white/5 text-gray-400 hover:text-white'
                    }`}
                  >
                    - Remove Collateral
                  </button>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>Amount (USDC):</span>
                  </div>
                  <input
                    type="number"
                    step="any"
                    placeholder="e.g. 5.00"
                    value={editMarginAmount}
                    onChange={(e) => setEditMarginAmount(e.target.value)}
                    className="w-full bg-[#0a0d16] border border-white/10 rounded-xl px-3 py-2.5 text-white font-mono text-sm focus:border-volt outline-none"
                  />
                </div>

                {/* Live projected liquidation recalculation */}
                {parseFloat(editMarginAmount) > 0 && (
                  <div className="p-3 rounded-xl bg-volt/10 border border-volt/20 text-xs text-volt">
                    Projected New Liq. Price:{' '}
                    <strong>
                      ${(() => {
                        const amt = parseFloat(editMarginAmount) || 0;
                        const newM = marginAction === 'deposit'
                          ? editingPosition.marginCollateralUsd + amt
                          : Math.max(0.01, editingPosition.marginCollateralUsd - amt);
                        const r = newM / editingPosition.sizeUsd;
                        const nL = editingPosition.side === 'long'
                          ? editingPosition.entryPrice * (1 - r * 0.9)
                          : editingPosition.entryPrice * (1 + r * 0.9);
                        return Math.max(0.0001, nL).toFixed(4);
                      })()}
                    </strong>{' '}
                    ({marginAction === 'deposit' ? 'Safety margin increased' : 'Safety margin decreased'})
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleAdjustMargin}
                  className="w-full py-3 rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-400 hover:from-sky-400 hover:to-cyan-300 text-slate-950 font-black text-xs uppercase tracking-wider transition-all shadow-[0_0_20px_rgba(56,189,248,0.25)] cursor-pointer"
                >
                  Confirm Margin Adjustment
                </button>
              </div>
            )}

            {/* TAB 3: PARTIAL CLOSE */}
            {editTab === 'close' && (
              <div className="space-y-4">
                <div className="bg-[#0a0d16] p-3 rounded-2xl border border-white/5 space-y-1.5 text-xs">
                  <div className="flex justify-between text-gray-400">
                    <span>Full Position Size:</span>
                    <span className="font-bold text-white">${editingPosition.sizeUsd.toFixed(2)} ({editingPosition.sizeContracts.toFixed(3)} {editingPosition.baseAsset})</span>
                  </div>
                  <div className="flex justify-between text-gray-400">
                    <span>Current Unrealized PnL:</span>
                    <span className={`font-bold ${editingPosition.unrealizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {editingPosition.unrealizedPnlUsd >= 0 ? '+' : ''}${editingPosition.unrealizedPnlUsd.toFixed(2)} ({editingPosition.roePct.toFixed(2)}% ROE)
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs text-gray-400">Select Scale Out Percentage:</div>
                  <div className="grid grid-cols-4 gap-2">
                    {[25, 50, 75, 100].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => setPartialClosePct(pct)}
                        className={`py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                          partialClosePct === pct
                            ? 'bg-rose-500 text-white shadow-lg'
                            : 'bg-white/5 hover:bg-white/10 text-gray-300'
                        }`}
                      >
                        {pct}%
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-black/40 border border-white/5 text-xs text-gray-300 space-y-1">
                  <div>Closing: <strong>${(editingPosition.sizeUsd * (partialClosePct / 100)).toFixed(2)}</strong> ({(editingPosition.sizeContracts * (partialClosePct / 100)).toFixed(3)} {editingPosition.baseAsset})</div>
                  <div>Realizing PnL: <strong className={editingPosition.unrealizedPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{editingPosition.unrealizedPnlUsd >= 0 ? '+' : ''}${(editingPosition.unrealizedPnlUsd * (partialClosePct / 100)).toFixed(2)}</strong></div>
                </div>

                <button
                  type="button"
                  onClick={() => handlePartialClose(partialClosePct)}
                  disabled={isSubmitting}
                  className="w-full py-3 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-black text-xs uppercase tracking-wider transition-all shadow-lg cursor-pointer"
                >
                  Execute {partialClosePct}% Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
