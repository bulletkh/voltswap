import React, { useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { DeepBookCandle } from '../deepbookV3';

export type ChartTimeframe = '1m' | '5m' | '15m' | '1h' | '4h';

interface ProCandleChartProps {
  symbolLabel: string;
  sourceLabel?: string;
  candles: DeepBookCandle[];
  timeframe: ChartTimeframe;
  onTimeframeChange: (tf: ChartTimeframe) => void;
  isLoading?: boolean;
  heightClass?: string;
  livePrice?: number;
}

const TIMEFRAMES: ChartTimeframe[] = ['1m', '5m', '15m', '1h', '4h'];

export const ProCandleChart: React.FC<ProCandleChartProps> = ({
  symbolLabel,
  sourceLabel = 'DeepBook v3',
  candles,
  timeframe,
  onTimeframeChange,
  isLoading = false,
  heightClass = 'h-[360px] lg:h-[430px]',
  livePrice,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<any>(null);
  const volSeriesRef = useRef<any>(null);
  const [hoverCandle, setHoverCandle] = useState<DeepBookCandle | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: '#0C0E12' },
        textColor: '#94A3B8',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.035)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.035)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(56, 189, 248, 0.35)', width: 1, style: 2 },
        horzLine: { color: 'rgba(56, 189, 248, 0.35)', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.06)',
        scaleMargins: { top: 0.12, bottom: 0.22 },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.06)',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10B981',
      downColor: '#EF4444',
      borderUpColor: '#10B981',
      borderDownColor: '#EF4444',
      wickUpColor: '#10B981',
      wickDownColor: '#EF4444',
    });

    const volSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    volSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.seriesData) {
        setHoverCandle(null);
        return;
      }
      const bar = param.seriesData.get(candleSeries) as any;
      const vol = param.seriesData.get(volSeries) as any;
      if (bar && typeof bar.close === 'number') {
        setHoverCandle({
          time: Number(param.time),
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: Number(vol?.value || 0),
        });
      }
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volSeriesRef.current = volSeries;

    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        chart.applyOptions({ width: Math.floor(rect.width), height: Math.floor(rect.height) });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!candleSeriesRef.current || !volSeriesRef.current) return;
    if (candles.length === 0) return;

    const formatted = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    const volData = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)',
    }));

    candleSeriesRef.current.setData(formatted);
    volSeriesRef.current.setData(volData);

    const last = candles[candles.length - 1];
    const decimals = last.close >= 1000 ? 1 : last.close >= 10 ? 2 : last.close >= 0.5 ? 4 : 6;
    candleSeriesRef.current.applyOptions({
      priceFormat: {
        type: 'price',
        precision: decimals,
        minMove: 1 / Math.pow(10, decimals),
      },
    });
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  const activeBar = hoverCandle || candles[candles.length - 1] || null;
  const displayPrice = activeBar?.close ?? livePrice ?? 0;
  const decimals = displayPrice >= 1000 ? 1 : displayPrice >= 10 ? 2 : displayPrice >= 0.5 ? 4 : 6;

  return (
    <div className="panel-carbon rounded-lg flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-2 bg-[#101318]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-white tracking-tight">{symbolLabel}</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.04] text-slate-400 border border-white/[0.05]">
              {sourceLabel}
            </span>
          </div>
          {activeBar && (
            <div className="hidden sm:flex items-center gap-2.5 text-[11px] font-mono tabular-nums text-slate-400">
              <span>
                O <span className="text-slate-200">{activeBar.open.toFixed(decimals)}</span>
              </span>
              <span>
                H <span className="text-emerald-400">{activeBar.high.toFixed(decimals)}</span>
              </span>
              <span>
                L <span className="text-rose-400">{activeBar.low.toFixed(decimals)}</span>
              </span>
              <span>
                C <span className="text-white">{activeBar.close.toFixed(decimals)}</span>
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => onTimeframeChange(tf)}
              className={`px-2 py-1 rounded text-[11px] font-mono transition-colors ${
                timeframe === tf
                  ? 'bg-[#38BDF8]/15 text-[#38BDF8] border border-[#38BDF8]/30'
                  : 'text-slate-400 hover:text-white hover:bg-white/[0.04] border border-transparent'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className={`relative w-full ${heightClass} bg-[#0C0E12]`}>
        <div ref={containerRef} className="w-full h-full" />
        {isLoading && candles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0C0E12]/80 text-xs font-mono text-slate-400">
            Loading live candles...
          </div>
        )}
      </div>
    </div>
  );
};
