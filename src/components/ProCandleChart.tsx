import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  createChart,
  CandlestickSeries,
  AreaSeries,
  HistogramSeries,
  LineSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  type CandlestickData,
  type AreaData,
  type HistogramData,
  type LineData,
} from 'lightweight-charts';
import {
  Crosshair,
  TrendingUp,
  Minus,
  ArrowUpRight,
  SlidersHorizontal,
  Ruler,
  Undo2,
  Trash2,
  Maximize2,
  Minimize2,
  RotateCcw,
  CandlestickChart,
  Activity,
} from 'lucide-react';
import type { DeepBookCandle } from '../deepbookV3';

export type ChartTimeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export type DrawingTool = 'cursor' | 'trend' | 'hline' | 'ray' | 'fib' | 'measure';

interface ChartPoint {
  time: number; // unix seconds
  price: number;
}

interface ChartDrawing {
  id: string;
  tool: Exclude<DrawingTool, 'cursor'>;
  p1: ChartPoint;
  p2?: ChartPoint;
}

interface IndicatorState {
  ma: boolean;
  ema: boolean;
  boll: boolean;
}

interface ProCandleChartProps {
  symbolLabel: string;
  sourceLabel?: string;
  candles: DeepBookCandle[];
  timeframe: ChartTimeframe;
  onTimeframeChange: (tf: ChartTimeframe) => void;
  isLoading?: boolean;
  heightClass?: string;
  livePrice?: number;
  tvSymbol?: string | null;
}

const TIMEFRAMES: ChartTimeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

const TF_SECONDS: Record<ChartTimeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
};

const FIB_LEVELS: Array<{ ratio: number; label: string; color: string }> = [
  { ratio: 0, label: '0', color: '#94A3B8' },
  { ratio: 0.236, label: '0.236', color: '#F59E0B' },
  { ratio: 0.382, label: '0.382', color: '#60A5FA' },
  { ratio: 0.5, label: '0.5', color: '#08D189' },
  { ratio: 0.618, label: '0.618', color: '#2B7FFF' },
  { ratio: 0.786, label: '0.786', color: '#A78BFA' },
  { ratio: 1, label: '1', color: '#94A3B8' },
];

const TV_SYMBOL_MAP: Record<string, string> = {
  SUI: 'COINBASE:SUIUSD',
  BTC: 'BINANCE:BTCUSDT',
  WBTC: 'BINANCE:BTCUSDT',
  XBTC: 'BINANCE:BTCUSDT',
  LBTC: 'BINANCE:BTCUSDT',
  ETH: 'BINANCE:ETHUSDT',
  WETH: 'BINANCE:ETHUSDT',
  SOL: 'BINANCE:SOLUSDT',
  XRP: 'BINANCE:XRPUSDT',
  DOGE: 'BINANCE:DOGEUSDT',
  NEAR: 'BINANCE:NEARUSDT',
  AVAX: 'BINANCE:AVAXUSDT',
  ADA: 'BINANCE:ADAUSDT',
  LINK: 'BINANCE:LINKUSDT',
  ARB: 'BINANCE:ARBUSDT',
  OP: 'BINANCE:OPUSDT',
  APT: 'BINANCE:APTUSDT',
  TIA: 'BINANCE:TIAUSDT',
  AAVE: 'BINANCE:AAVEUSDT',
  UNI: 'BINANCE:UNIUSDT',
  PEPE: 'BINANCE:PEPEUSDT',
  WIF: 'BINANCE:WIFUSDT',
  BONK: 'BINANCE:BONKUSDT',
  ENA: 'BINANCE:ENAUSDT',
  JUP: 'BINANCE:JUPUSDT',
  ONDO: 'BINANCE:ONDOUSDT',
  HYPE: 'BYBIT:HYPEUSDT',
  BNB: 'BINANCE:BNBUSDT',
  TON: 'OKX:TONUSDT',
  LTC: 'BINANCE:LTCUSDT',
  TRX: 'BINANCE:TRXUSDT',
  DOT: 'BINANCE:DOTUSDT',
  ATOM: 'BINANCE:ATOMUSDT',
  TSLA: 'NASDAQ:TSLA',
  NVDA: 'NASDAQ:NVDA',
  AAPL: 'NASDAQ:AAPL',
  MSFT: 'NASDAQ:MSFT',
  AMZN: 'NASDAQ:AMZN',
  GOOGL: 'NASDAQ:GOOGL',
  META: 'NASDAQ:META',
  COIN: 'NASDAQ:COIN',
  MSTR: 'NASDAQ:MSTR',
  HOOD: 'NASDAQ:HOOD',
  PLTR: 'NASDAQ:PLTR',
  SPY: 'AMEX:SPY',
  QQQ: 'NASDAQ:QQQ',
  GOLD: 'TVC:GOLD',
  XAU: 'TVC:GOLD',
  XAUT: 'TVC:GOLD',
  SILVER: 'TVC:SILVER',
  XAG: 'TVC:SILVER',
  WTI: 'TVC:USOIL',
  BRENT: 'TVC:UKOIL',
  US500: 'FOREXCOM:SPXUSD',
  US100: 'NASDAQ:NDX',
  JP225: 'TVC:NI225',
  INTC: 'NASDAQ:INTC',
  MU: 'NASDAQ:MU',
  MRVL: 'NASDAQ:MRVL',
  TSM: 'NYSE:TSM',
  COST: 'NASDAQ:COST',
  LLY: 'NYSE:LLY',
  AMC: 'NYSE:AMC',
  EUR: 'FX:EURUSD',
  GBP: 'FX:GBPUSD',
  JPY: 'FX:USDJPY',
  USDJPY: 'FX:USDJPY',
  USDKRW: 'FX_IDC:USDKRW',
  USDBRL: 'FX_IDC:USDBRL',
};

export function resolveTradingViewSymbol(symbolOrPair: string): string | null {
  const clean = symbolOrPair
    .toUpperCase()
    .replace(/-PERP$/i, '')
    .replace(/\/(USDC|USD|USDT|SUI)$/i, '')
    .replace(/_(USDC|USD|USDT|SUI)$/i, '')
    .replace(/(USD|USDT|USDC)$/i, (m, _g, _offset, full) => (full.length > m.length + 1 && !full.startsWith('USD') ? '' : m))
    .trim();
  return TV_SYMBOL_MAP[clean] || null;
}

function formatPrice(val: number): string {
  if (!Number.isFinite(val)) return '0.00';
  if (val >= 1000) return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (val >= 10) return val.toFixed(3);
  if (val >= 0.1) return val.toFixed(4);
  return val.toFixed(5);
}

function computeSMA(candles: Array<{ time: UTCTimestamp; close: number }>, period: number): LineData<UTCTimestamp>[] {
  const out: LineData<UTCTimestamp>[] = [];
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) {
      out.push({ time: candles[i].time, value: sum / period });
    }
  }
  return out;
}

function computeEMA(candles: Array<{ time: UTCTimestamp; close: number }>, period: number): LineData<UTCTimestamp>[] {
  if (candles.length < period) return [];
  const k = 2 / (period + 1);
  let ema = candles.slice(0, period).reduce((acc, c) => acc + c.close, 0) / period;
  const out: LineData<UTCTimestamp>[] = [{ time: candles[period - 1].time, value: ema }];
  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
    out.push({ time: candles[i].time, value: ema });
  }
  return out;
}

function computeBOLL(
  candles: Array<{ time: UTCTimestamp; close: number }>,
  period = 20,
  mult = 2
): { upper: LineData<UTCTimestamp>[]; basis: LineData<UTCTimestamp>[]; lower: LineData<UTCTimestamp>[] } {
  const upper: LineData<UTCTimestamp>[] = [];
  const basis: LineData<UTCTimestamp>[] = [];
  const lower: LineData<UTCTimestamp>[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close;
    const mean = sum / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = candles[j].close - mean;
      sq += diff * diff;
    }
    const std = Math.sqrt(sq / period);
    const t = candles[i].time;
    basis.push({ time: t, value: mean });
    upper.push({ time: t, value: mean + mult * std });
    lower.push({ time: t, value: mean - mult * std });
  }
  return { upper, basis, lower };
}

const TV_INTERVAL_MAP: Record<ChartTimeframe, string> = {
  '1m': '1',
  '5m': '5',
  '15m': '15',
  '30m': '30',
  '1h': '60',
  '4h': '240',
  '1d': 'D',
};

export const ProCandleChart: React.FC<ProCandleChartProps> = ({
  symbolLabel,
  sourceLabel = 'DeepBook v3',
  candles,
  timeframe,
  onTimeframeChange,
  isLoading,
  heightClass = 'h-[400px] lg:h-[500px]',
  livePrice,
  tvSymbol,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const overlaySvgRef = useRef<SVGSVGElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainSeriesRef = useRef<ISeriesApi<'Candlestick'> | ISeriesApi<'Area'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const ma7SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma25SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bollUpperSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bollBasisSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bollLowerSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  const lastFitKeyRef = useRef<string>('');
  const wasZeroSizeRef = useRef<boolean>(true);
  const candlesRef = useRef<DeepBookCandle[]>([]);

  const [chartType, setChartType] = useState<'candles' | 'area'>('candles');
  const [engineMode, setEngineMode] = useState<'volt' | 'tradingview'>('volt');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showIndicatorsMenu, setShowIndicatorsMenu] = useState(false);
  const [indicators, setIndicators] = useState<IndicatorState>({
    ma: false,
    ema: false,
    boll: false,
  });

  const [activeTool, setActiveTool] = useState<DrawingTool>('cursor');
  const [drawings, setDrawings] = useState<ChartDrawing[]>([]);
  const [draftDrawing, setDraftDrawing] = useState<ChartDrawing | null>(null);
  const [, setRenderTick] = useState(0);

  const [hoverBar, setHoverBar] = useState<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  } | null>(null);

  const resolvedTvSymbol = useMemo(
    () => (tvSymbol === undefined ? resolveTradingViewSymbol(symbolLabel) : tvSymbol),
    [tvSymbol, symbolLabel]
  );

  // Switch back to built-in Volt chart automatically if current pair lacks TradingView coverage
  useEffect(() => {
    if (!resolvedTvSymbol && engineMode === 'tradingview') {
      setEngineMode('volt');
    }
  }, [resolvedTvSymbol, engineMode]);

  // Persist drawings per pair
  const storageKey = useMemo(() => `volt_chart_drawings_v1:${symbolLabel}`, [symbolLabel]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setDrawings(parsed);
          return;
        }
      }
    } catch {
      // ignore storage errors
    }
    setDrawings([]);
    setDraftDrawing(null);
  }, [storageKey]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(drawings));
    } catch {
      // ignore storage errors
    }
  }, [drawings, storageKey]);

  // Sanitize, deduplicate & sort ascending
  const cleanCandles = useMemo(() => {
    const map = new Map<number, DeepBookCandle>();
    for (const c of candles) {
      const t = Math.floor(Number(c.time));
      const o = Number(c.open);
      const h = Number(c.high);
      const l = Number(c.low);
      const cl = Number(c.close);
      const v = Number(c.volume || 0);
      if (
        Number.isFinite(t) &&
        t > 0 &&
        Number.isFinite(o) &&
        o > 0 &&
        Number.isFinite(h) &&
        h > 0 &&
        Number.isFinite(l) &&
        l > 0 &&
        Number.isFinite(cl) &&
        cl > 0
      ) {
        map.set(t, {
          time: t,
          open: o,
          high: Math.max(h, o, cl),
          low: Math.min(l, o, cl),
          close: cl,
          volume: Number.isFinite(v) && v >= 0 ? v : 0,
        });
      }
    }
    const sorted = Array.from(map.values()).sort((a, b) => a.time - b.time);
    if (livePrice && Number.isFinite(livePrice) && livePrice > 0 && sorted.length > 0) {
      const last = { ...sorted[sorted.length - 1] };
      last.close = livePrice;
      last.high = Math.max(last.high, livePrice);
      last.low = Math.min(last.low, livePrice);
      sorted[sorted.length - 1] = last;
    }
    candlesRef.current = sorted;
    return sorted;
  }, [candles, livePrice]);

  const forceAutoFit = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    try {
      chart.priceScale('right').applyOptions({ autoScale: true });
      chart.timeScale().fitContent();
    } catch {
      // ignore during dispose
    }
  }, []);

  // Initialize lightweight-charts instance (re-built when chartType or engineMode switches)
  useEffect(() => {
    if (engineMode !== 'volt') return;
    const el = containerRef.current;
    if (!el) return;

    const initialW = Math.max(el.clientWidth, 1);
    const initialH = Math.max(el.clientHeight, 1);
    wasZeroSizeRef.current = el.clientWidth < 10 || el.clientHeight < 10;

    const chart = createChart(el, {
      width: initialW,
      height: initialH,
      layout: {
        background: { type: ColorType.Solid, color: '#000000' },
        textColor: '#7B8494',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.045)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.045)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(255, 255, 255, 0.28)',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#1E232D',
        },
        horzLine: {
          color: 'rgba(255, 255, 255, 0.28)',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#1E232D',
        },
      },
      rightPriceScale: {
        borderColor: '#1A1E26',
        autoScale: true,
        scaleMargins: { top: 0.1, bottom: 0.22 },
      },
      timeScale: {
        borderColor: '#1A1E26',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        barSpacing: 7,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: activeTool === 'cursor',
        horzTouchDrag: activeTool === 'cursor',
        vertTouchDrag: false,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
      },
    });

    const mainSeries =
      chartType === 'candles'
        ? chart.addSeries(CandlestickSeries, {
            upColor: '#08D189',
            downColor: '#F0525E',
            borderUpColor: '#08D189',
            borderDownColor: '#F0525E',
            wickUpColor: '#08D189',
            wickDownColor: '#F0525E',
            priceLineColor: '#08D189',
            priceLineWidth: 1,
            priceLineStyle: LineStyle.Dotted,
          })
        : chart.addSeries(AreaSeries, {
            lineColor: '#2B7FFF',
            topColor: 'rgba(43, 127, 255, 0.24)',
            bottomColor: 'rgba(43, 127, 255, 0.01)',
            lineWidth: 2,
          });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    const indicatorLineOpts = {
      priceScaleId: 'right',
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    };

    const ma7Series = chart.addSeries(LineSeries, { ...indicatorLineOpts, color: '#2B7FFF', lineWidth: 1 });
    const ma25Series = chart.addSeries(LineSeries, { ...indicatorLineOpts, color: '#F472B6', lineWidth: 1 });
    const ema20Series = chart.addSeries(LineSeries, { ...indicatorLineOpts, color: '#A78BFA', lineWidth: 1 });
    const bollUpperSeries = chart.addSeries(LineSeries, {
      ...indicatorLineOpts,
      color: 'rgba(245, 158, 11, 0.65)',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
    });
    const bollBasisSeries = chart.addSeries(LineSeries, {
      ...indicatorLineOpts,
      color: 'rgba(245, 158, 11, 0.9)',
      lineWidth: 1,
    });
    const bollLowerSeries = chart.addSeries(LineSeries, {
      ...indicatorLineOpts,
      color: 'rgba(245, 158, 11, 0.65)',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
    });

    chart.subscribeCrosshairMove((param) => {
      if (!param.seriesData || !param.time) {
        setHoverBar(null);
        return;
      }
      const d = param.seriesData.get(mainSeries) as CandlestickData | AreaData | undefined;
      const v = param.seriesData.get(volumeSeries) as HistogramData | undefined;
      if (d && 'open' in d) {
        setHoverBar({
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
          volume: v?.value || 0,
        });
      } else if (d && 'value' in d) {
        setHoverBar({
          open: d.value,
          high: d.value,
          low: d.value,
          close: d.value,
          volume: v?.value || 0,
        });
      }
    });

    const bumpRender = () => setRenderTick((n) => (n + 1) % 100000);
    chart.timeScale().subscribeVisibleTimeRangeChange(bumpRender);
    chart.timeScale().subscribeVisibleLogicalRangeChange(bumpRender);

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        const h = Math.floor(entry.contentRect.height);
        if (w > 10 && h > 10) {
          chart.resize(w, h);
          if (wasZeroSizeRef.current) {
            wasZeroSizeRef.current = false;
            requestAnimationFrame(() => {
              forceAutoFit();
              setRenderTick((n) => (n + 1) % 100000);
            });
          } else {
            setRenderTick((n) => (n + 1) % 100000);
          }
        }
      }
    });
    resizeObserver.observe(el);

    chartRef.current = chart;
    mainSeriesRef.current = mainSeries;
    volumeSeriesRef.current = volumeSeries;
    ma7SeriesRef.current = ma7Series;
    ma25SeriesRef.current = ma25Series;
    ema20SeriesRef.current = ema20Series;
    bollUpperSeriesRef.current = bollUpperSeries;
    bollBasisSeriesRef.current = bollBasisSeries;
    bollLowerSeriesRef.current = bollLowerSeries;
    // Trigger immediate data re-population on new series instance
    lastFitKeyRef.current = '';

    return () => {
      resizeObserver.disconnect();
      chart.timeScale().unsubscribeVisibleTimeRangeChange(bumpRender);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(bumpRender);
      chart.remove();
      chartRef.current = null;
      mainSeriesRef.current = null;
      volumeSeriesRef.current = null;
      ma7SeriesRef.current = null;
      ma25SeriesRef.current = null;
      ema20SeriesRef.current = null;
      bollUpperSeriesRef.current = null;
      bollBasisSeriesRef.current = null;
      bollLowerSeriesRef.current = null;
    };
  }, [chartType, engineMode, isFullscreen, forceAutoFit]);

  // Toggle scroll lock while user actively draws with non-cursor tool
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.applyOptions({
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: activeTool === 'cursor',
        horzTouchDrag: activeTool === 'cursor',
        vertTouchDrag: false,
      },
    });
  }, [activeTool]);

  // Populate data & auto-fit scale reliably whenever symbol / timeframe / data changes
  useEffect(() => {
    if (engineMode !== 'volt') return;
    const chart = chartRef.current;
    const mainSeries = mainSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !mainSeries || !volumeSeries) return;

    const formatted = cleanCandles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const price = cleanCandles[cleanCandles.length - 1]?.close || 1;
    const precision = price >= 1000 ? 2 : price >= 10 ? 3 : price >= 0.1 ? 4 : 5;
    mainSeries.applyOptions({
      priceFormat: {
        type: 'price',
        precision,
        minMove: 1 / Math.pow(10, precision),
      },
    });

    if (chartType === 'candles') {
      (mainSeries as ISeriesApi<'Candlestick'>).setData(formatted);
    } else {
      (mainSeries as ISeriesApi<'Area'>).setData(
        formatted.map((b) => ({ time: b.time, value: b.close }))
      );
    }

    const volData: HistogramData<UTCTimestamp>[] = cleanCandles.map((c) => ({
      time: c.time as UTCTimestamp,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(8, 209, 137, 0.45)' : 'rgba(240, 82, 94, 0.45)',
    }));
    volumeSeries.setData(volData);

    // Indicators
    ma7SeriesRef.current?.setData(indicators.ma ? computeSMA(formatted, 7) : []);
    ma25SeriesRef.current?.setData(indicators.ma ? computeSMA(formatted, 25) : []);
    ema20SeriesRef.current?.setData(indicators.ema ? computeEMA(formatted, 20) : []);
    if (indicators.boll) {
      const boll = computeBOLL(formatted, 20, 2);
      bollUpperSeriesRef.current?.setData(boll.upper);
      bollBasisSeriesRef.current?.setData(boll.basis);
      bollLowerSeriesRef.current?.setData(boll.lower);
    } else {
      bollUpperSeriesRef.current?.setData([]);
      bollBasisSeriesRef.current?.setData([]);
      bollLowerSeriesRef.current?.setData([]);
    }

    const fitKey = `${symbolLabel}:${timeframe}:${cleanCandles.length > 0 ? 'hasData' : 'empty'}`;
    if (cleanCandles.length > 0 && lastFitKeyRef.current !== fitKey) {
      lastFitKeyRef.current = fitKey;
      requestAnimationFrame(() => {
        forceAutoFit();
        setRenderTick((n) => (n + 1) % 100000);
      });
    } else {
      setRenderTick((n) => (n + 1) % 100000);
    }
  }, [cleanCandles, chartType, indicators, symbolLabel, timeframe, engineMode, forceAutoFit]);

  // Coordinate converters between SVG pixel space and (time, price) space
  const pxToChartPoint = useCallback(
    (clientX: number, clientY: number): ChartPoint | null => {
      const el = overlaySvgRef.current;
      const chart = chartRef.current;
      const series = mainSeriesRef.current;
      if (!el || !chart || !series) return null;
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      const price = series.coordinateToPrice(y);
      if (price === null || !Number.isFinite(price)) return null;

      const rawTime = chart.timeScale().coordinateToTime(x);
      let timeSec = typeof rawTime === 'number' ? rawTime : NaN;

      if (!Number.isFinite(timeSec) && candlesRef.current.length > 0) {
        const bars = candlesRef.current;
        const lastBar = bars[bars.length - 1];
        const firstBar = bars[0];
        const lastCoord = chart.timeScale().timeToCoordinate(lastBar.time as UTCTimestamp);
        const stepSec = TF_SECONDS[timeframe] || 60;
        const barW = Math.max(chart.timeScale().options().barSpacing || 7, 1);
        if (lastCoord !== null) {
          const barsDelta = Math.round((x - lastCoord) / barW);
          timeSec = lastBar.time + barsDelta * stepSec;
        } else {
          timeSec = firstBar.time;
        }
      }
      if (!Number.isFinite(timeSec)) return null;
      return { time: timeSec, price };
    },
    [timeframe]
  );

  const chartPointToPx = useCallback(
    (pt: ChartPoint): { x: number; y: number } | null => {
      const chart = chartRef.current;
      const series = mainSeriesRef.current;
      if (!chart || !series) return null;
      const y = series.priceToCoordinate(pt.price);
      if (y === null || !Number.isFinite(y)) return null;

      let x: number | null = chart.timeScale().timeToCoordinate(pt.time as UTCTimestamp);
      if (x === null && candlesRef.current.length > 0) {
        const bars = candlesRef.current;
        const lr = chart.timeScale().getVisibleLogicalRange();
        const midIdx = lr
          ? Math.max(0, Math.min(bars.length - 1, Math.floor((lr.from + lr.to) / 2)))
          : bars.length - 1;
        const refBar = bars[midIdx];
        const refX = chart.timeScale().timeToCoordinate(refBar.time as UTCTimestamp);
        const stepSec = TF_SECONDS[timeframe] || 60;
        const barW = Math.max(chart.timeScale().options().barSpacing || 7, 1);
        if (refX !== null) {
          x = refX + ((pt.time - refBar.time) / stepSec) * barW;
        }
      }
      if (x === null || !Number.isFinite(x)) return null;
      return { x, y };
    },
    [timeframe]
  );

  const handleCanvasPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (activeTool === 'cursor') return;
    e.preventDefault();
    const pt = pxToChartPoint(e.clientX, e.clientY);
    if (!pt) return;

    if (activeTool === 'hline') {
      const next: ChartDrawing = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        tool: 'hline',
        p1: pt,
      };
      setDrawings((prev) => [...prev, next]);
      setActiveTool('cursor');
      return;
    }

    if (!draftDrawing) {
      setDraftDrawing({
        id: `draft_${Date.now()}`,
        tool: activeTool,
        p1: pt,
        p2: pt,
      });
    } else {
      const completed: ChartDrawing = {
        ...draftDrawing,
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        p2: pt,
      };
      setDrawings((prev) => [...prev, completed]);
      setDraftDrawing(null);
      setActiveTool('cursor');
    }
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draftDrawing) return;
    const pt = pxToChartPoint(e.clientX, e.clientY);
    if (!pt) return;
    setDraftDrawing((prev) => (prev ? { ...prev, p2: pt } : null));
  };

  const latest = cleanCandles[cleanCandles.length - 1];
  const displayBar = hoverBar || latest;
  const isUp = displayBar ? displayBar.close >= displayBar.open : true;

  const allRenderDrawings = draftDrawing ? [...drawings, draftDrawing] : drawings;
  const svgW = containerRef.current?.clientWidth || 800;

  const wrapperClass = isFullscreen
    ? 'fixed inset-0 z-50 flex flex-col w-screen h-screen overflow-hidden bg-[#000000]'
    : 'flex flex-col w-full min-w-0 overflow-hidden bg-[#000000]';

  const chartHeightClass = isFullscreen ? 'flex-1 min-h-0' : heightClass;

  return (
    <div className={wrapperClass}>
      {/* Flush Institutional TradingView-Style Chart Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 border-b border-[#2D374B] bg-[#000000]">
        <div className="flex items-center flex-wrap gap-1">
          {/* Timeframes */}
          <div className="flex items-center">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => onTimeframeChange(tf)}
                className={`px-2 py-1 text-[11px] font-mono font-semibold transition-colors border-b-2 ${
                  timeframe === tf
                    ? 'text-[#2B7FFF] border-[#2B7FFF]'
                    : 'text-[#848E9C] hover:text-white border-transparent'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="h-4 w-px bg-[#2D374B] mx-1 hidden sm:block" />

          {/* Chart Style & Indicators */}
          {engineMode === 'volt' && (
            <>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setChartType('candles')}
                  title="Candlestick Chart"
                  className={`p-1.5 rounded text-[11px] font-semibold flex items-center transition-colors ${
                    chartType === 'candles' ? 'text-white bg-[#131720]' : 'text-[#848E9C] hover:text-white'
                  }`}
                >
                  <CandlestickChart className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setChartType('area')}
                  title="Area Line Chart"
                  className={`p-1.5 rounded text-[11px] font-semibold flex items-center transition-colors ${
                    chartType === 'area' ? 'text-white bg-[#131720]' : 'text-[#848E9C] hover:text-white'
                  }`}
                >
                  <Activity className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowIndicatorsMenu((v) => !v)}
                  className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors flex items-center gap-1 ${
                    indicators.ma || indicators.ema || indicators.boll
                      ? 'text-[#2B7FFF] bg-[#2B7FFF]/10'
                      : 'text-[#848E9C] hover:text-white'
                  }`}
                >
                  <span>fx Indicators</span>
                </button>
                {showIndicatorsMenu && (
                  <div className="absolute left-0 mt-1.5 w-44 rounded-lg bg-[#090B10] border border-[#38445B] shadow-2xl p-1.5 z-40 space-y-0.5">
                    <button
                      type="button"
                      onClick={() => setIndicators((p) => ({ ...p, ma: !p.ma }))}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs hover:bg-white/[0.05]"
                    >
                      <span className="text-slate-200 font-medium">MA (7 / 25)</span>
                      <span className={indicators.ma ? 'text-[#2B7FFF] font-bold' : 'text-slate-500'}>
                        {indicators.ma ? 'ON' : 'OFF'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIndicators((p) => ({ ...p, ema: !p.ema }))}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs hover:bg-white/[0.05]"
                    >
                      <span className="text-slate-200 font-medium">EMA (20)</span>
                      <span className={indicators.ema ? 'text-[#A78BFA] font-bold' : 'text-slate-500'}>
                        {indicators.ema ? 'ON' : 'OFF'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIndicators((p) => ({ ...p, boll: !p.boll }))}
                      className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs hover:bg-white/[0.05]"
                    >
                      <span className="text-slate-200 font-medium">BOLL (20, 2)</span>
                      <span className={indicators.boll ? 'text-amber-400 font-bold' : 'text-slate-500'}>
                        {indicators.boll ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {engineMode === 'volt' && (
            <button
              type="button"
              onClick={forceAutoFit}
              title="Auto-Fit Price & Time Scale"
              className="px-2 py-1 rounded text-[#848E9C] hover:text-white text-[11px] font-mono flex items-center gap-1 transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              <span className="hidden md:inline">auto</span>
            </button>
          )}

          {resolvedTvSymbol && (
            <div className="flex items-center bg-[#090B0E] p-0.5 rounded border border-[#2E384C]">
              <button
                type="button"
                onClick={() => setEngineMode('volt')}
                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  engineMode === 'volt' ? 'bg-[#1D2330] text-white' : 'text-[#848E9C] hover:text-white'
                }`}
              >
                Live
              </button>
              <button
                type="button"
                onClick={() => setEngineMode('tradingview')}
                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  engineMode === 'tradingview' ? 'bg-[#2B7FFF] text-white' : 'text-[#848E9C] hover:text-white'
                }`}
              >
                TradingView
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsFullscreen((v) => !v)}
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen Workstation'}
            className="p-1.5 rounded text-[#848E9C] hover:text-white transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Flush Main Canvas Row: Left Drawing Rail + Pure Black Chart */}
      <div className={`relative w-full min-w-0 overflow-hidden flex ${chartHeightClass}`}>
        {engineMode === 'volt' ? (
          <>
            {/* Flush Vertical Drawing Toolbar */}
            <div className="w-9 shrink-0 bg-[#000000] border-r border-[#2D374B] py-2 flex flex-col items-center justify-between select-none">
              <div className="flex flex-col items-center gap-1">
                {(
                  [
                    { id: 'cursor', label: 'Crosshair / Pan', icon: Crosshair },
                    { id: 'trend', label: 'Trend Line (2 clicks)', icon: TrendingUp },
                    { id: 'hline', label: 'Horizontal Price Level', icon: Minus },
                    { id: 'ray', label: 'Trend Ray', icon: ArrowUpRight },
                    { id: 'fib', label: 'Fib Retracement', icon: SlidersHorizontal },
                    { id: 'measure', label: 'Price Range Measure', icon: Ruler },
                  ] as const
                ).map((tool) => {
                  const Icon = tool.icon;
                  const active = activeTool === tool.id;
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      title={tool.label}
                      onClick={() => {
                        setDraftDrawing(null);
                        setActiveTool(tool.id);
                      }}
                      className={`w-7 h-7 rounded flex items-center justify-center transition-colors ${
                        active
                          ? 'bg-[#2B7FFF]/25 text-[#60A5FA] border border-[#2B7FFF]/50'
                          : 'text-[#9CA3AF] hover:text-white hover:bg-white/[0.08] border border-transparent'
                      }`}
                    >
                      <Icon className="w-4 h-4 stroke-[2]" />
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-col items-center gap-1 pt-2 border-t border-[#2D374B]">
                <button
                  type="button"
                  title="Undo Last Drawing"
                  disabled={drawings.length === 0 && !draftDrawing}
                  onClick={() => {
                    if (draftDrawing) {
                      setDraftDrawing(null);
                      return;
                    }
                    setDrawings((prev) => prev.slice(0, -1));
                  }}
                  className="w-7 h-7 rounded flex items-center justify-center text-[#9CA3AF] hover:text-white hover:bg-white/[0.08] disabled:opacity-30 transition-colors"
                >
                  <Undo2 className="w-4 h-4 stroke-[2]" />
                </button>
                <button
                  type="button"
                  title="Clear All Drawings"
                  disabled={drawings.length === 0}
                  onClick={() => {
                    setDraftDrawing(null);
                    setDrawings([]);
                  }}
                  className="w-7 h-7 rounded flex items-center justify-center text-[#9CA3AF] hover:text-[#F0525E] hover:bg-[#F0525E]/15 disabled:opacity-30 transition-colors"
                >
                  <Trash2 className="w-4 h-4 stroke-[2]" />
                </button>
              </div>
            </div>

            {/* Chart Viewport + In-Canvas DeepBook Legend + SVG Overlay */}
            <div className="relative flex-1 min-w-0 h-full overflow-hidden bg-[#000000]">
              {/* In-canvas top-left TradingView legend matching DeepBook reference */}
              <div className="pointer-events-none absolute top-2 left-3 right-16 z-10 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] font-mono">
                <span className="text-slate-200 font-semibold">
                  {symbolLabel} · {timeframe} · {sourceLabel}
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-[#08D189]" />
                {displayBar && (
                  <span className="hidden sm:inline-flex items-center gap-2">
                    <span className="text-[#7B8494]">
                      O<span className={isUp ? 'text-[#08D189]' : 'text-[#F0525E]'}>{formatPrice(displayBar.open)}</span>
                    </span>
                    <span className="text-[#7B8494]">
                      H<span className={isUp ? 'text-[#08D189]' : 'text-[#F0525E]'}>{formatPrice(displayBar.high)}</span>
                    </span>
                    <span className="text-[#7B8494]">
                      L<span className={isUp ? 'text-[#08D189]' : 'text-[#F0525E]'}>{formatPrice(displayBar.low)}</span>
                    </span>
                    <span className="text-[#7B8494]">
                      C<span className={isUp ? 'text-[#08D189]' : 'text-[#F0525E]'}>{formatPrice(displayBar.close)}</span>
                    </span>
                  </span>
                )}
                {indicators.ma && (
                  <span className="hidden xl:inline-flex items-center gap-1.5 text-[10px]">
                    <span className="text-[#2B7FFF]">MA7</span>
                    <span className="text-[#F472B6]">MA25</span>
                  </span>
                )}
                {indicators.ema && <span className="hidden xl:inline text-[10px] text-[#A78BFA]">EMA20</span>}
                {indicators.boll && <span className="hidden xl:inline text-[10px] text-amber-400">BOLL20</span>}
              </div>

              <div
                ref={containerRef}
                onDoubleClick={forceAutoFit}
                className="absolute inset-0"
              />

              {/* Synchronized SVG Overlay */}
              <svg
                ref={overlaySvgRef}
                onPointerDown={handleCanvasPointerDown}
                onPointerMove={handleCanvasPointerMove}
                className={`absolute inset-0 w-full h-full z-10 ${
                  activeTool === 'cursor' ? 'pointer-events-none' : 'pointer-events-auto cursor-crosshair'
                }`}
              >
                {allRenderDrawings.map((d) => {
                  const p1 = chartPointToPx(d.p1);
                  if (!p1) return null;

                  if (d.tool === 'hline') {
                    return (
                      <g key={d.id}>
                        <line
                          x1={0}
                          y1={p1.y}
                          x2={svgW}
                          y2={p1.y}
                          stroke="#2B7FFF"
                          strokeWidth={1.5}
                          strokeDasharray="5 4"
                        />
                        <rect
                          x={Math.max(4, svgW - 140)}
                          y={p1.y - 10}
                          width={74}
                          height={18}
                          rx={4}
                          fill="#2B7FFF"
                        />
                        <text
                          x={Math.max(8, svgW - 135)}
                          y={p1.y + 3}
                          fill="#FFFFFF"
                          fontSize={10}
                          fontWeight="bold"
                          fontFamily="JetBrains Mono, monospace"
                        >
                          {formatPrice(d.p1.price)}
                        </text>
                      </g>
                    );
                  }

                  const p2 = d.p2 ? chartPointToPx(d.p2) : null;
                  if (!p2 || !d.p2) return null;

                  if (d.tool === 'trend') {
                    return (
                      <g key={d.id}>
                        <line
                          x1={p1.x}
                          y1={p1.y}
                          x2={p2.x}
                          y2={p2.y}
                          stroke="#2B7FFF"
                          strokeWidth={2}
                        />
                        <circle cx={p1.x} cy={p1.y} r={3.5} fill="#2B7FFF" stroke="#000000" />
                        <circle cx={p2.x} cy={p2.y} r={3.5} fill="#2B7FFF" stroke="#000000" />
                      </g>
                    );
                  }

                  if (d.tool === 'ray') {
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    let ex = p2.x;
                    let ey = p2.y;
                    if (Math.abs(dx) > 1) {
                      const targetX = dx > 0 ? svgW : 0;
                      const scale = (targetX - p1.x) / dx;
                      ex = targetX;
                      ey = p1.y + dy * scale;
                    }
                    return (
                      <g key={d.id}>
                        <line
                          x1={p1.x}
                          y1={p1.y}
                          x2={ex}
                          y2={ey}
                          stroke="#60A5FA"
                          strokeWidth={1.75}
                        />
                        <circle cx={p1.x} cy={p1.y} r={3.5} fill="#60A5FA" stroke="#000000" />
                        <circle cx={p2.x} cy={p2.y} r={3.5} fill="#60A5FA" stroke="#000000" />
                      </g>
                    );
                  }

                  if (d.tool === 'fib') {
                    const minX = Math.min(p1.x, p2.x);
                    const maxX = Math.max(p1.x, p2.x, minX + 90);
                    const priceSpan = d.p2.price - d.p1.price;
                    return (
                      <g key={d.id}>
                        <rect
                          x={minX}
                          y={Math.min(p1.y, p2.y)}
                          width={Math.max(maxX - minX, 20)}
                          height={Math.max(Math.abs(p2.y - p1.y), 2)}
                          fill="rgba(43, 127, 255, 0.05)"
                        />
                        {FIB_LEVELS.map((lv) => {
                          const lvPrice = d.p1.price + priceSpan * lv.ratio;
                          const lvPx = p1.y + (p2.y - p1.y) * lv.ratio;
                          return (
                            <g key={lv.label}>
                              <line
                                x1={minX}
                                y1={lvPx}
                                x2={maxX}
                                y2={lvPx}
                                stroke={lv.color}
                                strokeWidth={1}
                                strokeOpacity={0.85}
                              />
                              <text
                                x={minX + 4}
                                y={lvPx - 3}
                                fill={lv.color}
                                fontSize={10}
                                fontFamily="JetBrains Mono, monospace"
                              >
                                {lv.label} ({formatPrice(lvPrice)})
                              </text>
                            </g>
                          );
                        })}
                      </g>
                    );
                  }

                  if (d.tool === 'measure') {
                    const x = Math.min(p1.x, p2.x);
                    const y = Math.min(p1.y, p2.y);
                    const w = Math.max(Math.abs(p2.x - p1.x), 2);
                    const h = Math.max(Math.abs(p2.y - p1.y), 2);
                    const pct = d.p1.price > 0 ? ((d.p2.price - d.p1.price) / d.p1.price) * 100 : 0;
                    const diff = d.p2.price - d.p1.price;
                    const pos = pct >= 0;
                    const strokeCol = pos ? '#08D189' : '#F0525E';
                    const fillCol = pos ? 'rgba(8, 209, 137, 0.14)' : 'rgba(240, 82, 94, 0.14)';
                    const labelText = `${pos ? '+' : ''}${pct.toFixed(2)}% (${pos ? '+' : ''}${formatPrice(diff)})`;
                    return (
                      <g key={d.id}>
                        <rect
                          x={x}
                          y={y}
                          width={w}
                          height={h}
                          fill={fillCol}
                          stroke={strokeCol}
                          strokeWidth={1.2}
                        />
                        <rect
                          x={x + 6}
                          y={Math.max(4, y - 22)}
                          width={Math.max(labelText.length * 6.8 + 12, 110)}
                          height={19}
                          rx={5}
                          fill={strokeCol}
                        />
                        <text
                          x={x + 12}
                          y={Math.max(16, y - 9)}
                          fill="#04111D"
                          fontSize={10}
                          fontWeight="bold"
                          fontFamily="JetBrains Mono, monospace"
                        >
                          {labelText}
                        </text>
                      </g>
                    );
                  }

                  return null;
                })}
              </svg>

              {/* Active drawing hint pill */}
              {activeTool !== 'cursor' && (
                <div className="pointer-events-none absolute top-8 left-3 z-20 px-2.5 py-1 rounded bg-[#2B7FFF] text-white text-[11px] font-bold shadow">
                  {activeTool === 'hline'
                    ? 'Click chart to place level'
                    : draftDrawing
                      ? 'Click second point to finish'
                      : 'Click start point on chart'}
                </div>
              )}

              {(isLoading || cleanCandles.length === 0) && (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[#000000]/75 backdrop-blur-[1px]">
                  <div className="px-3 py-1.5 rounded bg-[#0A0C10] border border-[#323D52] text-xs text-slate-300 font-mono">
                    {isLoading ? 'Loading market candles...' : 'Waiting for market candles...'}
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          /* Official TradingView Embedded Advanced Widget */
          <div className="relative flex-1 min-w-0 h-full overflow-hidden bg-[#000000]">
            <iframe
              title={`TradingView ${resolvedTvSymbol}`}
              className="w-full h-full border-0"
              src={`https://s.tradingview.com/widgetembed/?frameElementId=tv_volt_chart&symbol=${encodeURIComponent(
                resolvedTvSymbol || 'BINANCE:BTCUSDT'
              )}&interval=${encodeURIComponent(
                TV_INTERVAL_MAP[timeframe] || '15'
              )}&hidesidetoolbar=0&symboledit=0&saveimage=1&toolbarbg=000000&theme=dark&style=1&timezone=Etc%2FUTC&withdateranges=1&showpopupbutton=1&studies=[]&locale=en`}
            />
          </div>
        )}
      </div>
    </div>
  );
};
export default ProCandleChart;
