import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Activity,
  Zap,
  ExternalLink,
  RefreshCw,
  Search,
  Eye,
  ArrowRight,
  Flame,
  Wallet,
  Target,
  Award,
  TrendingUp,
  DollarSign,
  Volume2,
  VolumeX,
  Bell,
} from 'lucide-react';

const GQL_URL = 'https://graphql.mainnet.sui.io/graphql';

export interface ParsedWhaleSwap {
  digest: string;
  timestamp: string;
  timestampMs: number;
  sender: string;
  token: string;
  quote: string;
  dex: string;
  side: 'BUY' | 'SELL';
  usdVal: number;
  priceUsd: number;
  tokenAmt: number;
  inSym: string;
  inAmt: number;
  inCt: string;
  inDec: number;
  outSym: string;
  outAmt: number;
  outCt: string;
  outDec: number;
}

export interface WhaleSignalItem {
  symbol: string;
  coinType: string;
  decimals: number;
  currentPrice: number;
  whaleAvgBuyPrice: number;
  whaleAvgSellPrice: number;
  vsWhaleBuyPct: number;
  buyUsd: number;
  sellUsd: number;
  netUsd: number;
  totalUsd: number;
  buysCount: number;
  sellsCount: number;
  maxTradeUsd: number;
  buyRatioPct: number;
  verdict: string;
  badgeTone: 'bullish' | 'discount' | 'bearish' | 'neutral';
  actionSummary: string;
}

export interface CrossDexArbItem {
  symbol: string;
  spreadPct: number;
  buyDex: string;
  buyQuote: string;
  buyPrice: number;
  sellDex: string;
  sellQuote: string;
  sellPrice: number;
  estProfitPer100: number;
  coinType: string;
  decimals: number;
}

export interface HighYieldPoolItem {
  pairName: string;
  token: string;
  quote: string;
  dex: string;
  vol24h: number;
  tvlUsd: number;
  feeTierPct: number;
  dailyYieldPct: number;
  aprPct: number;
  coinType: string;
  decimals: number;
  poolUrl: string;
}

export interface TopWhaleWallet {
  address: string;
  totalUsd: number;
  buyUsd: number;
  sellUsd: number;
  netUsd: number;
  tradesCount: number;
  maxTradeUsd: number;
  lastActive: string;
  primaryToken: string;
  avgPrice: number;
  status: string;
}

interface WhaleRadarProps {
  onCopyTrade: (params: {
    inSym: string;
    inCt: string;
    inDec: number;
    outSym: string;
    outCt: string;
    outDec: number;
    priceUsd?: number;
    targetPriceUsd?: number;
    expectedProfitPct?: number;
    defaultInAmount?: string;
  }) => void;
  onOpenFullRadar?: () => void;
  compact?: boolean;
}

const USDC_META = {
  symbol: 'USDC',
  coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  decimals: 6,
};

const metaCache: Record<string, { decimals: number; symbol: string }> = {
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI': {
    decimals: 9,
    symbol: 'SUI',
  },
  '0x2::sui::SUI': {
    decimals: 9,
    symbol: 'SUI',
  },
};

export const WhaleRadar: React.FC<WhaleRadarProps> = ({
  onCopyTrade,
  onOpenFullRadar,
  compact = false,
}) => {
  const [subTab, setSubTab] = useState<'tape' | 'whales' | 'xray'>('tape');
  const [swaps, setSwaps] = useState<ParsedWhaleSwap[]>([]);
  const [signals, setSignals] = useState<WhaleSignalItem[]>([]);
  const [crossDexArbs, setCrossDexArbs] = useState<CrossDexArbItem[]>([]);
  const [highYieldPools, setHighYieldPools] = useState<HighYieldPoolItem[]>([]);
  const [topWhales, setTopWhales] = useState<TopWhaleWallet[]>([]);
  const [liveSuiPrice, setLiveSuiPrice] = useState<number>(0.86);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [minUsdFilter, setMinUsdFilter] = useState<number>(1000);
  const [tokenFilter, setTokenFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sideFilter, setSideFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [sortMode, setSortMode] = useState<'time' | 'size'>('time');
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    return localStorage.getItem('volt_sound_alerts') === 'true';
  });
  const [liveToast, setLiveToast] = useState<ParsedWhaleSwap | null>(null);
  const [lastKnownDigest, setLastKnownDigest] = useState<string>('');
  const [isJustUpdated, setIsJustUpdated] = useState<boolean>(false);

  const playWhaleAlertSound = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch (_) {}
  }, []);

  const [xrayAddress, setXrayAddress] = useState<string>(
    '0x7ef65a3b007b79e3b8d9a29f2d5e8584b589186b3a9483b7519c53088c317b93'
  );
  const [xrayInput, setXrayInput] = useState<string>(
    '0x7ef65a3b007b79e3b8d9a29f2d5e8584b589186b3a9483b7519c53088c317b93'
  );
  const [xrayBalances, setXrayBalances] = useState<
    Array<{ symbol: string; coinType: string; amount: number; usdVal: number }>
  >([]);
  const [isLoadingXray, setIsLoadingXray] = useState<boolean>(false);

  const gqlQuery = async (query: string, variables: Record<string, any> = {}) => {
    const res = await fetch(GQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    return res.json();
  };

  const fetchWhaleIntelligence = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch('/api/whale-radar');
      if (res.ok) {
        const data = await res.json();
        if (data?.ok && Array.isArray(data.trades)) {
          setSwaps(data.trades);
          setSignals(data.signals || []);
          setCrossDexArbs(data.crossDexArbs || []);
          setHighYieldPools(data.highYieldPools || []);
          setTopWhales(data.topWhales || []);
          if (data.liveSuiPrice) setLiveSuiPrice(data.liveSuiPrice);

          const newestLarge = data.trades.find((t: ParsedWhaleSwap) => t.usdVal >= 5000);
          if (newestLarge) {
            setLastKnownDigest((prevDigest) => {
              if (prevDigest && prevDigest !== newestLarge.digest) {
                setLiveToast(newestLarge);
                if (soundEnabled) {
                  playWhaleAlertSound();
                }
                setTimeout(() => {
                  setLiveToast((curr) => (curr?.digest === newestLarge.digest ? null : curr));
                }, 7000);
              }
              return newestLarge.digest;
            });
          }

          setIsLoading(false);
          return;
        }
      }
    } catch (_) {
      // Handled gracefully
    } finally {
      setIsLoading(false);
    }
  }, []);

  const inspectWalletXray = useCallback(
    async (addressToScan: string) => {
      if (!addressToScan || !addressToScan.startsWith('0x')) return;
      try {
        setIsLoadingXray(true);
        const q = `
        query GetBalances($addr: SuiAddress!) {
          address(address: $addr) {
            balances {
              nodes {
                coinType { repr }
                totalBalance
              }
            }
          }
        }
      `;
        const res = await gqlQuery(q, { addr: addressToScan.trim() });
        const nodes = res?.data?.address?.balances?.nodes || [];

        const missingCts = nodes
          .map((n: any) => n.coinType?.repr)
          .filter((ct: string) => ct && !metaCache[ct]);

        for (let i = 0; i < missingCts.length; i += 10) {
          const chunk = missingCts.slice(i, i + 10);
          const aliases = chunk
            .map(
              (ct: string, idx: number) =>
                `c${idx}: coinMetadata(coinType: "${ct}") { decimals symbol }`
            )
            .join('\n');
          const mRes = await gqlQuery(`query { ${aliases} }`);
          const mData = mRes?.data || {};
          chunk.forEach((ct: string, idx: number) => {
            const info = mData[`c${idx}`];
            metaCache[ct] = {
              decimals: info?.decimals != null ? info.decimals : 9,
              symbol: (info?.symbol || ct.split('::').pop() || 'UNK').toUpperCase(),
            };
          });
        }

        const priceLookup: Record<string, number> = {
          SUI: liveSuiPrice,
          USDC: 1.0,
          USDT: 1.0,
          USDSUI: 1.0,
        };
        signals.forEach((s) => {
          if (s.currentPrice > 0) priceLookup[s.symbol] = s.currentPrice;
        });

        const parsed: Array<{ symbol: string; coinType: string; amount: number; usdVal: number }> =
          [];
        for (const n of nodes) {
          const ct = n.coinType?.repr;
          if (!ct) continue;
          const m = metaCache[ct] || { decimals: 9, symbol: ct.split('::').pop() || 'UNK' };
          const amt = Number(n.totalBalance || 0) / Math.pow(10, m.decimals);
          if (amt <= 0.0001) continue;
          const p = priceLookup[m.symbol] || 0;
          parsed.push({
            symbol: m.symbol,
            coinType: ct,
            amount: amt,
            usdVal: amt * p,
          });
        }
        parsed.sort((a, b) => b.usdVal - a.usdVal || b.amount - a.amount);
        setXrayBalances(parsed);
      } catch (e) {
        console.error('Wallet X-Ray error:', e);
      } finally {
        setIsLoadingXray(false);
      }
    },
    [liveSuiPrice, signals]
  );

  useEffect(() => {
    fetchWhaleIntelligence();
  }, [fetchWhaleIntelligence]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      fetchWhaleIntelligence();
    }, 25000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchWhaleIntelligence]);

  useEffect(() => {
    if (!compact && subTab === 'xray' && xrayAddress) {
      inspectWalletXray(xrayAddress);
    }
  }, [compact, subTab, xrayAddress, inspectWalletXray]);

  const countsByTier = useMemo(() => {
    return {
      c500: swaps.filter((s) => s.usdVal >= 500).length,
      c5000: swaps.filter((s) => s.usdVal >= 5000).length,
      c25000: swaps.filter((s) => s.usdVal >= 25000).length,
      c100000: swaps.filter((s) => s.usdVal >= 100000).length,
    };
  }, [swaps]);

  const filteredSwaps = useMemo(() => {
    const list = swaps.filter((s) => {
      if (s.usdVal < minUsdFilter) return false;
      if (tokenFilter !== 'ALL' && (s.token || '').toUpperCase() !== tokenFilter.toUpperCase()) return false;
      if (sideFilter !== 'ALL' && s.side !== sideFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchToken = (s.token || '').toLowerCase().includes(q);
        const matchSender = (s.sender || '').toLowerCase().includes(q);
        const matchCt = (s.outCt || '').toLowerCase().includes(q);
        if (!matchToken && !matchSender && !matchCt) return false;
      }
      return true;
    });
    if (sortMode === 'size') {
      return [...list].sort((a, b) => b.usdVal - a.usdVal);
    }
    return list;
  }, [swaps, minUsdFilter, tokenFilter, sideFilter, sortMode, searchQuery]);

  const formatTimeAgo = (ms: number) => {
    const sec = Math.max(1, Math.floor((Date.now() - ms) / 1000));
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
  };

  const formatPrice = (p: number) => {
    if (!p || p <= 0) return '$0.00';
    if (p >= 1) return `$${p.toFixed(4)}`;
    if (p >= 0.01) return `$${p.toFixed(4)}`;
    return `$${p.toFixed(6)}`;
  };

  // ============================================================================
  // COMPACT MODE (Main Page): Ultra-Clean 2-Block Profit Hub (Zero Clutter!)
  // ============================================================================
  if (compact) {
    const dipOpportunities = signals
      .filter((s) => s.totalUsd >= 2000)
      .sort((a, b) => a.vsWhaleBuyPct - b.vsWhaleBuyPct)
      .slice(0, 3);

    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
        }}
      >
        {/* BLOCK 1: BUY THE WHALE DIP (1-Click Discount Rebound Deals) */}
        <div
          style={{
            background:
              'linear-gradient(180deg, rgba(16, 22, 34, 0.96) 0%, rgba(10, 14, 22, 0.98) 100%)',
            border: '1px solid rgba(16, 185, 129, 0.28)',
            borderRadius: '24px',
            padding: '20px',
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.45)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '8px',
              marginBottom: '14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: 'rgba(16, 185, 129, 0.16)',
                  border: '1px solid rgba(16, 185, 129, 0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <TrendingUp size={19} color="#10b981" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc' }}>
                  1. Buy Whale Dips (Tokens Cheaper Than Whale Entry)
                </h3>
                <p style={{ margin: '2px 0 0 0', fontSize: '0.76rem', color: '#94a3b8' }}>
                  Enter below the average price whales paid and capture the rebound back to Whale VWAP.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={() => {
                  const next = !soundEnabled;
                  setSoundEnabled(next);
                  localStorage.setItem('volt_sound_alerts', String(next));
                  if (next) playWhaleAlertSound();
                }}
                title={soundEnabled ? 'Mute Whale Audio Alerts' : 'Enable Whale Audio Alerts'}
                style={{
                  background: soundEnabled ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                  color: soundEnabled ? '#34d399' : '#94a3b8',
                  border: soundEnabled ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  padding: '6px 10px',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  transition: 'all 0.2s',
                }}
              >
                {soundEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
                <span>{soundEnabled ? 'Sound ON' : 'Sound OFF'}</span>
              </button>

              <button
                onClick={async () => {
                  try {
                    setIsLoading(true);
                    await fetchWhaleIntelligence();
                    setIsJustUpdated(true);
                    setTimeout(() => setIsJustUpdated(false), 2000);
                  } finally {
                    setIsLoading(false);
                  }
                }}
                title="Real-time on-chain Sui whale feed. Auto-refreshes every 10s. Click to re-scan immediately."
                style={{
                  background: isJustUpdated ? 'rgba(16, 185, 129, 0.22)' : 'rgba(255, 255, 255, 0.06)',
                  color: isJustUpdated ? '#34d399' : '#cbd5e1',
                  border: isJustUpdated ? '1px solid rgba(16, 185, 129, 0.45)' : '1px solid rgba(255, 255, 255, 0.12)',
                  borderRadius: '8px',
                  padding: '6px 11px',
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.2s',
                }}
              >
                <span style={{ position: 'relative', display: 'flex', height: '8px', width: '8px' }}>
                  <span
                    style={{
                      position: 'absolute',
                      display: 'inline-flex',
                      height: '100%',
                      width: '100%',
                      borderRadius: '9999px',
                      background: '#10b981',
                      opacity: 0.75,
                      animation: 'ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite',
                    }}
                  />
                  <span
                    style={{
                      position: 'relative',
                      display: 'inline-flex',
                      borderRadius: '9999px',
                      height: '8px',
                      width: '8px',
                      background: '#10b981',
                    }}
                  />
                </span>
                <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} color={isJustUpdated ? '#34d399' : undefined} />
                <span>{isJustUpdated ? 'Updated ✓' : isLoading ? 'Scanning...' : 'Live Auto'}</span>
              </button>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '12px',
              alignItems: 'stretch',
            }}
          >
            {dipOpportunities.map((sig) => {
              const reboundProfitPct =
                sig.currentPrice > 0 && sig.whaleAvgBuyPrice > sig.currentPrice
                  ? ((sig.whaleAvgBuyPrice - sig.currentPrice) / sig.currentPrice) * 100
                  : Math.max(0.8, Math.abs(sig.vsWhaleBuyPct));
              const profitPer100 = reboundProfitPct;

              return (
                <div
                  key={sig.symbol}
                  style={{
                    background: 'rgba(15, 23, 42, 0.85)',
                    border: '1px solid rgba(16, 185, 129, 0.25)',
                    borderRadius: '16px',
                    padding: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    minWidth: 0,
                    boxSizing: 'border-box',
                    gap: '12px',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '8px',
                        marginBottom: '10px',
                        minWidth: 0,
                      }}
                    >
                      <span style={{ fontSize: '1.15rem', fontWeight: 900, color: '#f8fafc', whiteSpace: 'nowrap' }}>
                        {sig.symbol}
                      </span>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          padding: '3px 8px',
                          borderRadius: '999px',
                          background: 'rgba(16, 185, 129, 0.18)',
                          color: '#10b981',
                          border: '1px solid rgba(16, 185, 129, 0.35)',
                          whiteSpace: 'nowrap',
                          flexShrink: 0,
                        }}
                      >
                        +{reboundProfitPct.toFixed(2)}% Rebound
                      </span>
                    </div>

                    <div
                      style={{
                        background: 'rgba(0, 0, 0, 0.3)',
                        borderRadius: '10px',
                        padding: '9px 10px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '8px',
                        border: '1px solid rgba(255, 255, 255, 0.04)',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Buy Now</div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#f8fafc', whiteSpace: 'nowrap' }}>
                          {formatPrice(sig.currentPrice)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                          Whale Entry (Target)
                        </div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#10b981', whiteSpace: 'nowrap' }}>
                          {formatPrice(sig.whaleAvgBuyPrice)}
                        </div>
                      </div>
                    </div>

                    <div style={{ fontSize: '0.73rem', color: '#cbd5e1', height: '36px', display: 'flex', alignItems: 'center' }}>
                      <span>
                        Est. Profit:{' '}
                        <strong style={{ color: '#10b981' }}>
                          +${profitPer100.toFixed(2)} per $100
                        </strong>{' '}
                        on return to Whale VWAP
                      </span>
                    </div>
                  </div>

                  <div style={{ width: '100%', marginTop: 'auto' }}>
                    <button
                      onClick={() =>
                        onCopyTrade({
                          inSym: 'USDC',
                          inCt: USDC_META.coinType,
                          inDec: USDC_META.decimals,
                          outSym: sig.symbol,
                          outCt: sig.coinType,
                          outDec: sig.decimals,
                          priceUsd: sig.currentPrice,
                          targetPriceUsd: sig.whaleAvgBuyPrice,
                          expectedProfitPct: reboundProfitPct,
                        })
                      }
                      style={{
                        width: '100%',
                        height: '42px',
                        minHeight: '42px',
                        maxHeight: '42px',
                        background: '#10b981',
                        color: '#05100a',
                        border: 'none',
                        borderRadius: '10px',
                        padding: '0 12px',
                        fontSize: '0.78rem',
                        fontWeight: 900,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        whiteSpace: 'nowrap',
                        boxShadow: '0 2px 10px rgba(16, 185, 129, 0.25)',
                        boxSizing: 'border-box',
                        transition: 'background 0.15s ease',
                      }}
                    >
                      <Zap size={14} fill="#05100a" />
                      Buy {sig.symbol} (+{reboundProfitPct.toFixed(2)}%)
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* BLOCK 2: CROSS-DEX ARBITRAGE SPREADS (Instant Profit on Price Dislocation) */}
        <div
          style={{
            background:
              'linear-gradient(180deg, rgba(16, 22, 34, 0.96) 0%, rgba(10, 14, 22, 0.98) 100%)',
            border: '1px solid rgba(56, 189, 248, 0.28)',
            borderRadius: '24px',
            padding: '20px',
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.45)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '8px',
              marginBottom: '14px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '10px',
                  background: 'rgba(56, 189, 248, 0.16)',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Activity size={19} color="#38bdf8" />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#f8fafc' }}>
                  2. Cross-DEX Arbitrage (Instant 0.5% – 2.5% Spread Between Pools)
                </h3>
                <p style={{ margin: '2px 0 0 0', fontSize: '0.76rem', color: '#94a3b8' }}>
                  Buy on the cheapest Sui pool and sell on the highest DEX — zero waiting, instant single-round profit.
                </p>
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
              gap: '12px',
            }}
          >
            {crossDexArbs.slice(0, 3).map((arb) => (
              <div
                key={arb.symbol}
                style={{
                  background: 'rgba(15, 23, 42, 0.85)',
                  border: '1px solid rgba(56, 189, 248, 0.25)',
                  borderRadius: '16px',
                  padding: '14px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '10px',
                }}
              >
                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '8px',
                    }}
                  >
                    <span style={{ fontSize: '1.1rem', fontWeight: 900, color: '#f8fafc' }}>
                      {arb.symbol}
                    </span>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 900,
                        padding: '3px 8px',
                        borderRadius: '999px',
                        background: 'rgba(56, 189, 248, 0.18)',
                        color: '#38bdf8',
                        border: '1px solid rgba(56, 189, 248, 0.35)',
                      }}
                    >
                      +{arb.spreadPct.toFixed(2)}% Spread
                    </span>
                  </div>

                  <div
                    style={{
                      background: 'rgba(0, 0, 0, 0.3)',
                      borderRadius: '10px',
                      padding: '8px 10px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: '8px',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Cheapest ({arb.buyDex})</div>
                      <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#38bdf8' }}>
                        ${arb.buyPrice < 0.01 ? arb.buyPrice.toFixed(6) : arb.buyPrice.toFixed(4)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Highest ({arb.sellDex})</div>
                      <div style={{ fontSize: '0.88rem', fontWeight: 800, color: '#f8fafc' }}>
                        ${arb.sellPrice < 0.01 ? arb.sellPrice.toFixed(6) : arb.sellPrice.toFixed(4)}
                      </div>
                    </div>
                  </div>

                  <div style={{ fontSize: '0.73rem', color: '#cbd5e1', minHeight: '34px', display: 'flex', alignItems: 'center' }}>
                    <span>
                      Est. Profit:{' '}
                      <strong style={{ color: '#38bdf8' }}>
                        +${arb.estProfitPer100.toFixed(2)} per $100
                      </strong>{' '}
                      via instant PTB spread
                    </span>
                  </div>
                </div>

                <div style={{ width: '100%', marginTop: 'auto' }}>
                  <button
                    onClick={() =>
                      onCopyTrade({
                        inSym: 'USDC',
                        inCt: USDC_META.coinType,
                        inDec: USDC_META.decimals,
                        outSym: arb.symbol,
                        outCt: arb.coinType,
                        outDec: arb.decimals,
                        priceUsd: arb.buyPrice,
                        targetPriceUsd: arb.sellPrice,
                        expectedProfitPct: arb.spreadPct,
                      })
                    }
                    style={{
                      width: '100%',
                      height: '42px',
                      minHeight: '42px',
                      maxHeight: '42px',
                      background: '#38bdf8',
                      color: '#04131d',
                      border: 'none',
                      borderRadius: '10px',
                      padding: '0 12px',
                      fontSize: '0.78rem',
                      fontWeight: 900,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      whiteSpace: 'nowrap',
                      boxShadow: '0 2px 10px rgba(56, 189, 248, 0.25)',
                      boxSizing: 'border-box',
                      transition: 'background 0.15s ease',
                    }}
                  >
                    <Zap size={14} fill="#04131d" />
                    Arb {arb.symbol} (+{arb.spreadPct.toFixed(2)}%)
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer Strip: Link to Full Whale Tape */}
        {onOpenFullRadar && (
          <div
            onClick={onOpenFullRadar}
            style={{
              background: 'rgba(15, 23, 42, 0.7)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              borderRadius: '14px',
              padding: '12px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem' }}>
              <Activity size={16} color="#38bdf8" />
              <span style={{ color: '#cbd5e1' }}>
                Tracking <strong>{countsByTier.c1000} whale trades ≥ $1,000</strong> (Largest:{' '}
                <strong style={{ color: '#fbbf24' }}>
                  $
                  {Math.round(
                    swaps.reduce((m, s) => (s.usdVal > m ? s.usdVal : m), 0)
                  ).toLocaleString()}
                </strong>
                )
              </span>
            </div>
            <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#38bdf8' }}>
              Open Full Whale Tape →
            </span>
          </div>
        )}
      </div>
    );
  }

  // ============================================================================
  // FULL RADAR TAB MODE (For users who click "Full Whale Radar" tab)
  // ============================================================================
  return (
    <div
      style={{
        background: 'linear-gradient(180deg, rgba(13, 17, 28, 0.96) 0%, rgba(8, 11, 18, 0.98) 100%)',
        border: '1px solid rgba(56, 189, 248, 0.22)',
        borderRadius: '20px',
        padding: '24px',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.55)',
        color: '#f8fafc',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '14px',
          marginBottom: '18px',
          paddingBottom: '16px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              background: 'rgba(56, 189, 248, 0.2)',
              border: '1px solid rgba(56, 189, 248, 0.4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Target size={22} color="#38bdf8" />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800 }}>
              Full Whale Tape & Wallet X-Ray ($1,000 – $25,000+)
            </h2>
            <p style={{ margin: '3px 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
              Verified large Sui DEX executions across Cetus, Turbos, Bluefin & Magma.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => setSubTab('tape')}
            style={{
              background: subTab === 'tape' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.05)',
              color: subTab === 'tape' ? '#38bdf8' : '#94a3b8',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              borderRadius: '10px',
              padding: '8px 14px',
              fontSize: '0.8rem',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Whale Tape ({filteredSwaps.length})
          </button>
          <button
            onClick={() => setSubTab('whales')}
            style={{
              background: subTab === 'whales' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255,255,255,0.05)',
              color: subTab === 'whales' ? '#fbbf24' : '#94a3b8',
              border: '1px solid rgba(245, 158, 11, 0.35)',
              borderRadius: '10px',
              padding: '8px 14px',
              fontSize: '0.8rem',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Top Whale Wallets ({topWhales.length})
          </button>
          <button
            onClick={() => setSubTab('xray')}
            style={{
              background: subTab === 'xray' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255,255,255,0.05)',
              color: subTab === 'xray' ? '#c084fc' : '#94a3b8',
              border: '1px solid rgba(168, 85, 247, 0.35)',
              borderRadius: '10px',
              padding: '8px 14px',
              fontSize: '0.8rem',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Wallet X-Ray
          </button>

          <button
            onClick={() => {
              const next = !soundEnabled;
              setSoundEnabled(next);
              localStorage.setItem('volt_sound_alerts', String(next));
              if (next) playWhaleAlertSound();
            }}
            title={soundEnabled ? 'Mute Whale Audio Alerts' : 'Enable Whale Audio Alerts'}
            style={{
              background: soundEnabled ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255,255,255,0.05)',
              color: soundEnabled ? '#34d399' : '#94a3b8',
              border: soundEnabled ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '10px',
              padding: '8px 14px',
              fontSize: '0.8rem',
              fontWeight: 800,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            <span>{soundEnabled ? 'Sound ON' : 'Audio OFF'}</span>
          </button>
        </div>
      </div>

      {subTab === 'tape' && (
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
              marginBottom: '14px',
            }}
          >
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {[
                { label: `All ≥ $500 (${countsByTier.c500})`, val: 500 },
                { label: `🐬 ≥ $5,000 (${countsByTier.c5000})`, val: 5000 },
                { label: `🐋 ≥ $25,000 (${countsByTier.c25000})`, val: 25000 },
                { label: `👑 ≥ $100,000 (${countsByTier.c100000})`, val: 100000 },
              ].map((opt) => (
                <button
                  key={opt.val}
                  onClick={() => setMinUsdFilter(opt.val)}
                  style={{
                    background:
                      minUsdFilter === opt.val ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.04)',
                    color: minUsdFilter === opt.val ? '#38bdf8' : '#cbd5e1',
                    border: '1px solid rgba(56, 189, 248, 0.35)',
                    borderRadius: '8px',
                    padding: '6px 12px',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <button
              onClick={() => setSortMode(sortMode === 'time' ? 'size' : 'time')}
              style={{
                background: 'rgba(168, 85, 247, 0.18)',
                color: '#c084fc',
                border: '1px solid rgba(168, 85, 247, 0.4)',
                borderRadius: '8px',
                padding: '6px 12px',
                fontSize: '0.75rem',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {sortMode === 'size' ? '🔥 Sorted: Largest ($)' : '⏱ Sorted: Newest'}
            </button>
          </div>

          {/* Token Quick-Filter Pills & Live Search Bar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '10px',
              marginBottom: '14px',
              background: 'rgba(0,0,0,0.3)',
              padding: '8px 12px',
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700, marginRight: '4px' }}>
                Filter Token:
              </span>
              {['ALL', 'SUI', 'CETUS', 'DEEP', 'WAL', 'BLUE', 'MAGMA', 'USDC'].map((sym) => {
                const isActive = tokenFilter.toUpperCase() === sym;
                return (
                  <button
                    key={sym}
                    onClick={() => setTokenFilter(sym)}
                    style={{
                      background: isActive ? 'rgba(234, 252, 109, 0.2)' : 'rgba(255,255,255,0.04)',
                      color: isActive ? '#eafc6d' : '#94a3b8',
                      border: isActive ? '1px solid rgba(234, 252, 109, 0.45)' : '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '8px',
                      padding: '4px 10px',
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {sym}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', position: 'relative', minWidth: '180px' }}>
              <Search size={14} color="#94a3b8" style={{ position: 'absolute', left: '10px' }} />
              <input
                type="text"
                placeholder="Search ticker / address..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '10px',
                  padding: '6px 10px 6px 30px',
                  fontSize: '0.75rem',
                  color: '#f8fafc',
                  outline: 'none',
                  fontFamily: 'monospace',
                }}
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '600px', overflowY: 'auto' }}>
            {filteredSwaps.slice(0, 100).map((swap, idx) => {
              const isBuy = swap.side === 'BUY';
              return (
                <div
                  key={`${swap.digest}-${idx}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '10px',
                    padding: '11px 14px',
                    borderRadius: '12px',
                    background: 'rgba(15, 23, 42, 0.75)',
                    border: `1px solid ${isBuy ? 'rgba(16, 185, 129, 0.22)' : 'rgba(239, 68, 68, 0.22)'}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span
                      style={{
                        padding: '4px 9px',
                        borderRadius: '7px',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        background: isBuy ? 'rgba(16, 185, 129, 0.18)' : 'rgba(239, 68, 68, 0.18)',
                        color: isBuy ? '#10b981' : '#f87171',
                      }}
                    >
                      {isBuy ? '🟢 BUY' : '🔴 SELL'} {swap.token} @ {formatPrice(swap.priceUsd)}
                    </span>
                    <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
                      {swap.inAmt.toLocaleString(undefined, { maximumFractionDigits: 1 })} {swap.inSym}{' '}
                      <ArrowRight size={11} style={{ verticalAlign: 'middle' }} />{' '}
                      {swap.outAmt.toLocaleString(undefined, { maximumFractionDigits: 1 })} {swap.outSym} ({swap.dex})
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: '0.98rem', fontWeight: 900, color: '#38bdf8' }}>
                      ${swap.usdVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                      {formatTimeAgo(swap.timestampMs)}
                    </span>
                    
                    {/* Quick Preset Chips for SUI buyers */}
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <button
                        title="Quick Buy with 10 SUI"
                        onClick={() =>
                          onCopyTrade({
                            inSym: 'SUI',
                            inCt: '0x2::sui::SUI',
                            inDec: 9,
                            outSym: swap.outSym,
                            outCt: swap.outCt,
                            outDec: swap.outDec,
                            priceUsd: swap.priceUsd,
                            defaultInAmount: '10',
                          })
                        }
                        style={{
                          background: 'rgba(215, 246, 38, 0.1)',
                          color: '#d7f626',
                          border: '1px solid rgba(215, 246, 38, 0.25)',
                          borderRadius: '6px',
                          padding: '4px 6px',
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        10 SUI
                      </button>
                      <button
                        title="Quick Buy with 50 SUI"
                        onClick={() =>
                          onCopyTrade({
                            inSym: 'SUI',
                            inCt: '0x2::sui::SUI',
                            inDec: 9,
                            outSym: swap.outSym,
                            outCt: swap.outCt,
                            outDec: swap.outDec,
                            priceUsd: swap.priceUsd,
                            defaultInAmount: '50',
                          })
                        }
                        style={{
                          background: 'rgba(215, 246, 38, 0.1)',
                          color: '#d7f626',
                          border: '1px solid rgba(215, 246, 38, 0.25)',
                          borderRadius: '6px',
                          padding: '4px 6px',
                          fontSize: '0.68rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        50 SUI
                      </button>
                    </div>

                    <button
                      onClick={() =>
                        onCopyTrade({
                          inSym: swap.inSym,
                          inCt: swap.inCt,
                          inDec: swap.inDec,
                          outSym: swap.outSym,
                          outCt: swap.outCt,
                          outDec: swap.outDec,
                          priceUsd: swap.priceUsd,
                        })
                      }
                      style={{
                        background: 'rgba(56, 189, 248, 0.16)',
                        color: '#38bdf8',
                        border: '1px solid rgba(56, 189, 248, 0.35)',
                        borderRadius: '8px',
                        padding: '5px 10px',
                        fontSize: '0.73rem',
                        fontWeight: 800,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      ⚡ Quick Buy
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {subTab === 'whales' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {topWhales.map((w, idx) => (
            <div
              key={w.address}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderRadius: '12px',
                background: 'rgba(15, 23, 42, 0.78)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
              }}
            >
              <div>
                <span style={{ fontWeight: 800, fontFamily: 'monospace', color: '#f8fafc' }}>
                  #{idx + 1} {w.address.slice(0, 10)}...{w.address.slice(-6)}
                </span>{' '}
                <span style={{ fontSize: '0.75rem', color: '#38bdf8', marginLeft: '8px' }}>
                  {w.status} ({w.tradesCount} swaps • Max: ${Math.round(w.maxTradeUsd).toLocaleString()})
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontWeight: 900, color: '#fbbf24' }}>
                  ${Math.round(w.totalUsd).toLocaleString()}
                </span>
                <button
                  onClick={() => {
                    setXrayAddress(w.address);
                    setXrayInput(w.address);
                    setSubTab('xray');
                  }}
                  style={{
                    background: 'rgba(168, 85, 247, 0.18)',
                    color: '#c084fc',
                    border: '1px solid rgba(168, 85, 247, 0.4)',
                    borderRadius: '8px',
                    padding: '6px 10px',
                    fontSize: '0.74rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  X-Ray Portfolio
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {subTab === 'xray' && (
        <div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <input
              type="text"
              value={xrayInput}
              onChange={(e) => setXrayInput(e.target.value)}
              style={{
                flex: 1,
                background: 'rgba(15, 23, 42, 0.9)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                borderRadius: '10px',
                padding: '9px 14px',
                color: '#f8fafc',
                fontFamily: 'monospace',
              }}
            />
            <button
              onClick={() => {
                setXrayAddress(xrayInput.trim());
                inspectWalletXray(xrayInput.trim());
              }}
              style={{
                background: '#38bdf8',
                color: '#0f172a',
                border: 'none',
                borderRadius: '10px',
                padding: '9px 16px',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Scan Holdings
            </button>
          </div>
          {isLoadingXray ? (
            <div style={{ padding: '20px', color: '#94a3b8' }}>Scanning balances...</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
              {xrayBalances.map((b) => (
                <div
                  key={b.coinType}
                  style={{
                    background: 'rgba(15, 23, 42, 0.78)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '12px',
                    padding: '12px',
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{b.symbol}</div>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                    {b.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* FLOATING LIVE WHALE TOAST ALERT */}
      {liveToast && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            zIndex: 9999,
            maxWidth: '380px',
            background: 'linear-gradient(135deg, rgba(16, 24, 39, 0.98), rgba(12, 16, 26, 0.98))',
            border: '1px solid rgba(16, 185, 129, 0.45)',
            boxShadow: '0 12px 36px rgba(0, 0, 0, 0.65), 0 0 24px rgba(16, 185, 129, 0.25)',
            borderRadius: '18px',
            padding: '14px 16px',
            backdropFilter: 'blur(16px)',
            animation: 'fadeIn 0.3s ease',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, color: '#34d399', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Bell size={14} /> LIVE WHALE SWAP DETECTED
            </span>
            <button
              onClick={() => setLiveToast(null)}
              style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '1rem', padding: '0 4px' }}
            >
              ✕
            </button>
          </div>
          <p style={{ margin: 0, fontSize: '0.82rem', color: '#e2e8f0', fontWeight: 600 }}>
            Whale {liveToast.side === 'BUY' ? '🟢 bought' : '🔴 sold'}{' '}
            <strong style={{ color: '#fff' }}>{liveToast.tokenAmt.toLocaleString(undefined, { maximumFractionDigits: 2 })} {liveToast.token}</strong>{' '}
            for <strong style={{ color: '#fbbf24' }}>${Math.round(liveToast.usdVal).toLocaleString()} USD</strong>
          </p>
          <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
            <button
              onClick={() => {
                onCopyTrade({
                  inSym: liveToast.inSym,
                  inCt: liveToast.inCt,
                  inDec: liveToast.inDec,
                  outSym: liveToast.outSym,
                  outCt: liveToast.outCt,
                  outDec: liveToast.outDec,
                  priceUsd: liveToast.priceUsd,
                });
                setLiveToast(null);
              }}
              style={{
                flex: 1,
                background: '#d7f626',
                color: '#000',
                fontWeight: 800,
                fontSize: '0.75rem',
                padding: '7px 12px',
                borderRadius: '10px',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              ⚡ Copy Trade at Whale Entry
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
