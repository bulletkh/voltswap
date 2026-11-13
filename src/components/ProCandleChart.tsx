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
        background: { type: ColorType.Solid, color: '#0B1017' },
        textColor: '#CBD5E1',
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.05)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(0, 224, 184, 0.55)', width: 1, style: 2 },
        horzLine: { color: 'rgba(0, 224, 184, 0.55)', width: 1, style: 2 },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        scaleMargins: { top: 0.12, bottom: 0.22 },
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.1)',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00D98B',
      downColor: '#F6465D',
      borderUpColor: '#00D98B',
      borderDownColor: '#F6465D',
      wickUpColor: '#00E599',
      wickDownColor: '#FF556B',
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
      color: c.close >= c.open ? 'rgba(0, 217, 139, 0.32)' : 'rgba(246, 70, 93, 0.32)',
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
    <div className="panel-carbon rounded-2xl flex flex-col overflow-hidden h-full">
      <div className="px-4 py-2.5 border-b border-white/[0.08] flex flex-wrap items-center justify-between gap-2 bg-[#0F151E]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white tracking-tight">{symbolLabel}</span>
            <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-[#00E0B8]/15 text-[#2AF5D2] border border-[#00E0B8]/30">
              {sourceLabel}
            </span>
          </div>
          {activeBar && (
            <div className="hidden sm:flex items-center gap-3 text-xs font-mono tabular-nums text-slate-300">
              <span>
                O <span className="text-white">{activeBar.open.toFixed(decimals)}</span>
              </span>
              <span>
                H <span className="text-[#00E599]">{activeBar.high.toFixed(decimals)}</span>
              </span>
              <span>
                L <span className="text-[#FF4D6A]">{activeBar.low.toFixed(decimals)}</span>
              </span>
              <span>
                C <span className="text-white font-semibold">{activeBar.close.toFixed(decimals)}</span>
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
              className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold transition-all ${
                timeframe === tf
                  ? 'bg-[#00E0B8]/20 text-[#2AF5D2] border border-[#00E0B8]/40'
                  : 'text-slate-300 hover:text-white hover:bg-white/[0.06] border border-transparent'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className={`relative flex-1 w-full ${heightClass} bg-[#0B1017]`}>
        <div ref={containerRef} className="w-full h-full" />
        {isLoading && candles.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#0B1017]/85 text-xs font-mono text-slate-300">
            Loading live candles...
          </div>
        )}
      </div>
    </div>
  );
};
