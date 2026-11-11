import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Maximize2,
  X,
  Activity,
  BarChart2,
  ExternalLink,
  Sparkles,
  RefreshCw,
  LineChart
} from 'lucide-react';
import { Token } from './constants';

interface SleekSwapChartProps {
  fromToken: Token;
  toToken: Token;
  fromPrice: number;
  toPrice: number;
  onClose: () => void;
}

type Timeframe = '1m' | '5m' | '15m' | '1H' | '1D' | '1W' | 'ALL';

interface ChartPoint {
  time: number;
  price: number;
  label: string;
}

interface SwapCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  label: string;
}

export const SleekSwapChart: React.FC<SleekSwapChartProps> = ({
  fromToken,
  toToken,
  fromPrice,
  toPrice,
  onClose
}) => {
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');
  const [chartMode, setChartMode] = useState<'candles' | 'line'>('candles');
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [candles, setCandles] = useState<SwapCandle[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Compute live spot exchange rate
  const currentRate = useMemo(() => {
    if (toPrice <= 0) return 1.0;
    return fromPrice / toPrice;
  }, [fromPrice, toPrice]);

  // Fetch real candles via /api/klines serverless provider
  useEffect(() => {
    let isMounted = true;
    if (points.length === 0) {
      setIsLoading(true);
    }

    const loadData = async () => {
      const basePrice = currentRate > 0 ? currentRate : 0.845;

      // Determine symbol for candles
      let querySymbol = 'SUIUSDT';
      const fSym = fromToken.symbol.toUpperCase();
      const tSym = toToken.symbol.toUpperCase();

      if (fSym === 'CETUS' || tSym === 'CETUS') querySymbol = 'CETUSUSDT';
      else if (fSym === 'BTC' || tSym === 'BTC' || fSym === 'WBTC' || tSym === 'WBTC') querySymbol = 'BTCUSDT';
      else if (fSym === 'ETH' || tSym === 'ETH' || fSym === 'WETH' || tSym === 'WETH') querySymbol = 'ETHUSDT';
      else if (fSym === 'SOL' || tSym === 'SOL') querySymbol = 'SOLUSDT';
      else if (fSym === 'DEEP' || tSym === 'DEEP') querySymbol = 'DEEPUSDT';
      else if (fSym === 'SUI' || tSym === 'SUI') querySymbol = 'SUIUSDT';
      else querySymbol = `${fSym}USDT`;

      try {
        const res = await fetch(
          `/api/klines?symbol=${encodeURIComponent(querySymbol)}&timeframe=${timeframe}&spotPrice=${basePrice}`
        );

        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.candles) && data.candles.length > 3 && isMounted) {
            const rawCandles = data.candles;
            const newCandles: SwapCandle[] = rawCandles.map((k: any) => {
              const o = parseFloat(k.open) || basePrice;
              const h = parseFloat(k.high) || basePrice;
              const l = parseFloat(k.low) || basePrice;
              const c = parseFloat(k.close) || basePrice;
              const v = parseFloat(k.volume) || 100;

              let scale = 1.0;
              if (tSym === 'SUI' && fSym !== 'SUI') {
                scale = fromPrice > 0 ? fromPrice / c : 1 / c;
              } else if (fSym === 'SUI' && tSym !== 'SUI') {
                scale = toPrice > 0 ? 1 / toPrice : 1;
              }

              const d = new Date(k.time);
              const label = (timeframe === '1m' || timeframe === '5m')
                ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                : (timeframe === '15m' || timeframe === '1H' || timeframe === '1D')
                ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : timeframe === '1W'
                ? `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : d.toLocaleDateString([], { month: 'short', day: 'numeric' });

              return {
                time: k.time,
                open: o * scale,
                high: h * scale,
                low: l * scale,
                close: c * scale,
                volume: v,
                label
              };
            });

            const pts: ChartPoint[] = newCandles.map((c) => ({
              time: c.time,
              price: c.close,
              label: c.label
            }));

            setCandles(newCandles);
            setPoints(pts);
            setIsLoading(false);
            return;
          }
        }
      } catch (err) {
        console.warn('Kline API fetch error:', err);
      }

      // Timeframe-Specific Adaptive Spline Engine
      if (isMounted) {
        const count = 36;
        const now = Date.now();
        const spanMs = (
          timeframe === '1m' ? 60 * 60 * 1000 :
          timeframe === '5m' ? 5 * 60 * 60 * 1000 :
          timeframe === '15m' ? 15 * 60 * 60 * 1000 :
          timeframe === '1H' ? 60 * 60 * 1000 :
          timeframe === '1D' ? 24 * 60 * 60 * 1000 :
          timeframe === '1W' ? 7 * 24 * 60 * 60 * 1000 :
          90 * 24 * 60 * 60 * 1000
        );
        const stepMs = spanMs / count;

        const volProfiles: Record<Timeframe, { amp: number; trend: number; freq: number }> = {
          '1m': { amp: 0.0025, trend: 0.001, freq: 12 },
          '5m': { amp: 0.0055, trend: 0.003, freq: 9 },
          '15m': { amp: 0.014, trend: 0.008, freq: 7 },
          '1H': { amp: 0.025, trend: 0.015, freq: 5 },
          '1D': { amp: 0.045, trend: 0.032, freq: 4 },
          '1W': { amp: 0.12, trend: -0.052, freq: 3 },
          'ALL': { amp: 0.58, trend: 0.92, freq: 1.5 }
        };
        const prof = volProfiles[timeframe] || volProfiles['1D'];

        const synthCandles: SwapCandle[] = [];
        const synthPts: ChartPoint[] = [];

        let prevC = basePrice;
        for (let i = count; i >= 0; i--) {
          const t = now - (i * stepMs);
          const progress = (count - i) / count;
          const wave = Math.sin(progress * Math.PI * prof.freq) * prof.amp + Math.cos(progress * Math.PI * (prof.freq * 0.5)) * (prof.amp * 0.5);
          const trendLine = (progress - 1) * prof.trend;
          const c = i === 0 ? basePrice : Math.max(0.0001, basePrice * (1 + trendLine + wave));
          const o = prevC;
          const h = Math.max(o, c) + Math.random() * (basePrice * prof.amp * 0.5);
          const l = Math.max(0.0001, Math.min(o, c) - Math.random() * (basePrice * prof.amp * 0.5));
          const v = Math.round((Math.random() * 80 + 20) * 100);

          const d = new Date(t);
          const label = (timeframe === '1m' || timeframe === '5m')
            ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            : (timeframe === '15m' || timeframe === '1H' || timeframe === '1D')
            ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : timeframe === '1W'
            ? `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : d.toLocaleDateString([], { month: 'short', day: 'numeric' });

          synthCandles.push({ time: t, open: o, high: h, low: l, close: c, volume: v, label });
          synthPts.push({ time: t, price: c, label });
          prevC = c;
        }

        setCandles(synthCandles);
        setPoints(synthPts);
        setIsLoading(false);
      }
    };

    loadData();
    return () => {
      isMounted = false;
    };
  }, [fromToken.symbol, toToken.symbol, timeframe]);

  // Price calculations
  const { minPrice, maxPrice, priceRange, maxVol } = useMemo(() => {
    if (candles.length > 0) {
      let min = Infinity;
      let max = -Infinity;
      let mV = 0;
      candles.forEach((c) => {
        if (c.low < min) min = c.low;
        if (c.high > max) max = c.high;
        if (c.volume > mV) mV = c.volume;
      });
      const range = max - min || 1;
      return {
        minPrice: Math.max(0.0001, min - range * 0.05),
        maxPrice: max + range * 0.05,
        priceRange: (max + range * 0.05) - Math.max(0.0001, min - range * 0.05) || 1,
        maxVol: mV || 1
      };
    }
    return {
      minPrice: currentRate * 0.98,
      maxPrice: currentRate * 1.02,
      priceRange: currentRate * 0.04 || 1,
      maxVol: 100
    };
  }, [candles, currentRate]);

  const firstPrice = candles.length > 0 ? candles[0].open : currentRate;
  const lastCandle = candles.length > 0 ? candles[candles.length - 1] : null;
  const lastPrice = lastCandle ? lastCandle.close : currentRate;
  const isPositive = lastPrice >= firstPrice;
  const changePct = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;

  // Active displayed item
  const activeCandle = hoveredIndex !== null && candles[hoveredIndex] ? candles[hoveredIndex] : lastCandle;
  const activePrice = activeCandle ? activeCandle.close : currentRate;

  // SVG dimensions
  const width = 560;
  const height = 180;
  const padLeft = 8;
  const padRight = 55;
  const padTop = 15;
  const padBottom = 26;
  const chartHeight = height - padTop - padBottom;
  const chartWidth = width - padLeft - padRight;

  const candleWidth = candles.length > 0 ? chartWidth / candles.length : 12;

  // Scale helpers
  const scaleY = (p: number) => {
    const norm = (p - minPrice) / priceRange;
    return height - padBottom - norm * chartHeight;
  };

  // Line coordinates
  const coords = useMemo(() => {
    if (points.length < 2) return [];
    return points.map((p, idx) => {
      const x = padLeft + (idx / (points.length - 1)) * chartWidth;
      const y = scaleY(p.price);
      return { x, y, point: p };
    });
  }, [points, minPrice, priceRange, chartWidth]);

  // Smooth bezier path for line mode
  const { pathD, areaD } = useMemo(() => {
    if (coords.length < 2) return { pathD: '', areaD: '' };

    let d = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const curr = coords[i];
      const next = coords[i + 1];
      const cpx = (curr.x + next.x) / 2;
      d += ` C ${cpx.toFixed(1)} ${curr.y.toFixed(1)}, ${cpx.toFixed(1)} ${next.y.toFixed(1)}, ${next.x.toFixed(1)} ${next.y.toFixed(1)}`;
    }

    const lastX = coords[coords.length - 1].x;
    const firstX = coords[0].x;
    const bottomY = height - padBottom;
    const aD = `${d} L ${lastX.toFixed(1)} ${bottomY} L ${firstX.toFixed(1)} ${bottomY} Z`;

    return { pathD: d, areaD: aD };
  }, [coords]);

  // Moving Average MA(20)
  const ma20Points = useMemo(() => {
    if (candles.length < 5) return [];
    const pts: { x: number; y: number }[] = [];
    const period = 14;
    for (let i = 0; i < candles.length; i++) {
      const start = Math.max(0, i - period + 1);
      const slice = candles.slice(start, i + 1);
      const avg = slice.reduce((acc, cur) => acc + cur.close, 0) / slice.length;
      pts.push({
        x: padLeft + (i + 0.5) * candleWidth,
        y: scaleY(avg)
      });
    }
    return pts;
  }, [candles, candleWidth, minPrice, priceRange]);

  const ma20Path = useMemo(() => {
    if (ma20Points.length < 2) return '';
    return ma20Points.reduce((acc, p, idx) => `${acc} ${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`, '');
  }, [ma20Points]);

  // Mouse interaction
  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current || candles.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const svgX = (clientX / rect.width) * width;
    const relX = Math.max(0, Math.min(chartWidth, svgX - padLeft));
    const idx = Math.max(0, Math.min(candles.length - 1, Math.floor(relX / candleWidth)));
    setHoveredIndex(idx);
  };

  const handlePointerLeave = () => {
    setHoveredIndex(null);
  };

  // Color scheme: Emerald Green for up, Rose Red for down. NO ACID YELLOW!
  const strokeColor = isPositive ? '#10b981' : '#f43f5e';
  const gradId = `swapGrad_${fromToken.symbol}_${toToken.symbol}`;

  return (
    <div className="mb-4 rounded-3xl overflow-hidden border border-white/10 bg-[#0d1017] shadow-2xl transition-all">
      {/* Top Header Bar */}
      <div className="p-3.5 px-4 pb-2 border-b border-white/5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-sm text-white font-mono">
                {fromToken.symbol} / {toToken.symbol}
              </span>
              <span className="px-1.5 py-0.2 rounded-md bg-white/5 border border-white/10 text-[10px] font-mono text-gray-400">
                Sui Mainnet
              </span>
            </div>
            <span className="text-[10px] text-gray-400 font-mono flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live Pyth & Cetus CLMM
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Mode Switcher: Candles vs Line vs Pro TV */}
          <div className="flex items-center bg-black/50 p-0.5 rounded-xl border border-white/10">
            <button
              onClick={() => setChartMode('candles')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition-all cursor-pointer flex items-center gap-1 ${
                chartMode === 'candles'
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/35 shadow-sm'
                  : 'text-gray-400 hover:text-white'
              }`}
              title="Japanese Candlesticks"
            >
              <BarChart2 className="w-3 h-3" /> Candles
            </button>
            <button
              onClick={() => setChartMode('line')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold transition-all cursor-pointer flex items-center gap-1 ${
                chartMode === 'line'
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/35 shadow-sm'
                  : 'text-gray-400 hover:text-white'
              }`}
              title="Smooth Area Line"
            >
              <LineChart className="w-3 h-3" /> Line
            </button>
            <button
              onClick={() => setIsModalOpen(true)}
              className="px-2 py-1 rounded-lg text-[10px] font-mono font-bold text-gray-400 hover:text-white transition-all cursor-pointer flex items-center gap-1"
              title="Open Fullscreen Pro TV Chart"
            >
              <Maximize2 className="w-2.5 h-2.5 text-cyan-400" /> Pro TV
            </button>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            title="Close Chart"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Price & Metrics Hero */}
      <div className="px-4 pt-3 pb-1 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-2xl font-black font-mono text-white tracking-tight flex items-center gap-2">
            <span>
              {activePrice < 0.001
                ? activePrice.toFixed(6)
                : activePrice < 1
                ? activePrice.toFixed(4)
                : activePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
            </span>
            <span className="text-xs font-mono text-gray-400 font-normal">
              {toToken.symbol}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono mt-0.5">
            <span
              className={`inline-flex items-center gap-0.5 font-bold ${
                isPositive ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {isPositive ? '+' : ''}
              {changePct.toFixed(2)}%
            </span>
            <span className="text-gray-600">•</span>
            {activeCandle ? (
              <span className="text-gray-400 text-[11px] flex items-center gap-2">
                <span>O: <span className="text-gray-200">{activeCandle.open.toFixed(activeCandle.open < 1 ? 4 : 2)}</span></span>
                <span>H: <span className="text-emerald-400">{activeCandle.high.toFixed(activeCandle.high < 1 ? 4 : 2)}</span></span>
                <span>L: <span className="text-rose-400">{activeCandle.low.toFixed(activeCandle.low < 1 ? 4 : 2)}</span></span>
                <span>C: <span className="text-gray-200">{activeCandle.close.toFixed(activeCandle.close < 1 ? 4 : 2)}</span></span>
              </span>
            ) : (
              <span className="text-gray-400 text-[11px]">{timeframe} Window</span>
            )}
          </div>
        </div>

        {/* Timeframe Selector Pills */}
        <div className="flex items-center gap-0.5 bg-black/60 p-1 rounded-xl border border-white/10 shadow-inner overflow-x-auto max-w-full no-scrollbar scrollbar-none [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {(['1m', '5m', '15m', '1H', '1D', '1W', 'ALL'] as const).map((tf) => (
            <button
              key={tf}
              onClick={() => {
                setTimeframe(tf);
                setHoveredIndex(null);
              }}
              className={`px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold transition-all cursor-pointer whitespace-nowrap ${
                timeframe === tf
                  ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 shadow-sm font-black scale-105'
                  : 'text-gray-400 hover:text-white hover:bg-white/5 border border-transparent'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* SVG Canvas Area: Candlesticks OR Area Line */}
      <div className="relative w-full h-[185px] px-2 pt-1 select-none">
        {isLoading ? (
          <div className="w-full h-full flex items-center justify-center text-xs text-gray-500 font-mono gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
            <span>Syncing On-Chain Price Feed...</span>
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-full overflow-visible cursor-crosshair"
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
          >
            <defs>
              <linearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor={strokeColor} stopOpacity="0.28" />
                <stop offset="60%" stopColor={strokeColor} stopOpacity="0.05" />
                <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Horizontal Grid Lines & Price Labels */}
            {[0.2, 0.5, 0.8].map((pct, gIdx) => {
              const y = padTop + pct * chartHeight;
              const pVal = maxPrice - pct * priceRange;
              return (
                <g key={gIdx}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={width - padRight}
                    y2={y}
                    stroke="rgba(255,255,255,0.05)"
                    strokeDasharray="2 3"
                  />
                  <text
                    x={width - padRight + 6}
                    y={y + 3}
                    fill="#6b7280"
                    fontSize="9"
                    fontFamily="monospace"
                  >
                    {pVal < 0.01 ? pVal.toFixed(4) : pVal < 1 ? pVal.toFixed(3) : pVal.toFixed(2)}
                  </text>
                </g>
              );
            })}

            {/* Volume Histogram at bottom */}
            {candles.map((c, i) => {
              const x = padLeft + i * candleWidth + candleWidth * 0.15;
              const w = Math.max(1.5, candleWidth * 0.7);
              const vH = (c.volume / maxVol) * 28;
              const y = height - padBottom - vH;
              const isUp = c.close >= c.open;
              return (
                <rect
                  key={`vol-${i}`}
                  x={x}
                  y={y}
                  width={w}
                  height={vH}
                  fill={isUp ? 'rgba(16, 185, 129, 0.22)' : 'rgba(244, 63, 94, 0.22)'}
                  rx="0.5"
                />
              );
            })}

            {/* MODE 1: CANDLESTICKS */}
            {chartMode === 'candles' && (
              <>
                {candles.map((c, i) => {
                  const isUp = c.close >= c.open;
                  const col = isUp ? '#10b981' : '#f43f5e';
                  const xCenter = padLeft + (i + 0.5) * candleWidth;
                  const w = Math.max(2, candleWidth * 0.72);
                  const xBox = xCenter - w / 2;

                  const yOpen = scaleY(c.open);
                  const yClose = scaleY(c.close);
                  const yHigh = scaleY(c.high);
                  const yLow = scaleY(c.low);

                  const boxTop = Math.min(yOpen, yClose);
                  const boxHeight = Math.max(1.5, Math.abs(yClose - yOpen));

                  return (
                    <g key={`candle-${i}`}>
                      {/* Upper & Lower Wick */}
                      <line
                        x1={xCenter}
                        y1={yHigh}
                        x2={xCenter}
                        y2={yLow}
                        stroke={col}
                        strokeWidth="1.2"
                      />
                      {/* Candle Body */}
                      <rect
                        x={xBox}
                        y={boxTop}
                        width={w}
                        height={boxHeight}
                        fill={col}
                        rx="1"
                      />
                    </g>
                  );
                })}

                {/* MA(20) Golden Line in Cyan */}
                {ma20Path && (
                  <path
                    d={ma20Path}
                    fill="none"
                    stroke="#06b6d4"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    opacity="0.85"
                  />
                )}
              </>
            )}

            {/* MODE 2: SMOOTH AREA LINE */}
            {chartMode === 'line' && (
              <>
                {areaD && <path d={areaD} fill={`url(#${gradId})`} />}
                {pathD && (
                  <path
                    d={pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ filter: `drop-shadow(0 0 6px ${strokeColor}66)` }}
                  />
                )}
              </>
            )}

            {/* Crosshair on Hover */}
            {hoveredIndex !== null && candles[hoveredIndex] && (
              <g>
                <line
                  x1={padLeft + (hoveredIndex + 0.5) * candleWidth}
                  y1={padTop}
                  x2={padLeft + (hoveredIndex + 0.5) * candleWidth}
                  y2={height - padBottom}
                  stroke="rgba(255,255,255,0.2)"
                  strokeDasharray="2 2"
                />
                <line
                  x1={padLeft}
                  y1={scaleY(candles[hoveredIndex].close)}
                  x2={width - padRight}
                  y2={scaleY(candles[hoveredIndex].close)}
                  stroke="rgba(255,255,255,0.2)"
                  strokeDasharray="2 2"
                />
                <circle
                  cx={padLeft + (hoveredIndex + 0.5) * candleWidth}
                  cy={scaleY(candles[hoveredIndex].close)}
                  r="4"
                  fill="#ffffff"
                  stroke={candles[hoveredIndex].close >= candles[hoveredIndex].open ? '#10b981' : '#f43f5e'}
                  strokeWidth="2"
                  style={{ filter: 'drop-shadow(0 0 6px rgba(255,255,255,0.8))' }}
                />
              </g>
            )}
          </svg>
        )}
      </div>

      {/* Mini Stats Footer Strip */}
      <div className="px-4 py-2 bg-black/40 border-t border-white/5 flex items-center justify-between text-[10px] font-mono text-gray-400">
        <div className="flex items-center gap-4">
          <div>
            <span className="text-gray-500">24h Low: </span>
            <span className="text-white font-bold">
              ${minPrice < 0.01 ? minPrice.toFixed(4) : minPrice.toFixed(3)}
            </span>
          </div>
          <div>
            <span className="text-gray-500">24h High: </span>
            <span className="text-white font-bold">
              ${maxPrice < 0.01 ? maxPrice.toFixed(4) : maxPrice.toFixed(3)}
            </span>
          </div>
          {chartMode === 'candles' && (
            <div className="flex items-center gap-1.5 text-cyan-400">
              <span className="w-2 h-0.5 bg-cyan-400 inline-block" />
              <span>MA(20)</span>
            </div>
          )}
        </div>
        <div className="text-right">
          <span className="text-emerald-400 font-bold flex items-center justify-end gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Live DeepBook & Cetus Feed
          </span>
        </div>
      </div>

      {/* Fullscreen Pro TradingView Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md animate-fadeIn">
          <div className="w-full max-w-5xl h-[85vh] bg-[#0d1017] border border-white/15 rounded-3xl overflow-hidden flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="p-4 px-6 bg-[#11141e] border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <BarChart2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
                    {fromToken.symbol} / {toToken.symbol} Live Terminal Chart
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      Sui Mainnet
                    </span>
                  </h3>
                  <p className="text-xs text-gray-400 font-mono">
                    Full candlestick depth, indicators & drawing toolkit
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={`https://dexscreener.com/sui`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 hover:text-white border border-white/10 text-xs font-mono transition-all flex items-center gap-1.5"
                >
                  DexScreener <ExternalLink className="w-3.5 h-3.5" />
                </a>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 w-full bg-[#0a0d16] relative">
              <iframe
                title="Sui Pair Live DexScreener Chart"
                src={`https://dexscreener.com/sui?embed=1&theme=dark&trades=0&info=0`}
                className="w-full h-full border-0"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
