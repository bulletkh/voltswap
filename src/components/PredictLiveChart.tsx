import React, { useEffect, useMemo, useRef } from 'react';
import {
  createChart,
  AreaSeries,
  BaselineSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type IPriceLine,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { DeepBookCandle } from '../deepbookV3';

export interface PredictPricePoint {
  time: number; // unix seconds
  value: number;
}

interface PredictLiveChartProps {
  mode: 'simple' | 'trader';
  candles: DeepBookCandle[];
  livePoints: PredictPricePoint[];
  spotPrice: number;
  referencePrice?: number | null;
  expiryMs?: number | null;
  side?: 'up' | 'down' | 'range';
  strike?: number;
  lowerStrike?: number;
  upperStrike?: number;
  height?: number;
  isLoading?: boolean;
}

function formatUtcClock(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export const PredictLiveChart: React.FC<PredictLiveChartProps> = ({
  mode,
  candles,
  livePoints,
  spotPrice,
  referencePrice,
  expiryMs,
  side = 'up',
  strike,
  lowerStrike,
  upperStrike,
  height = 460,
  isLoading = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Area'> | ISeriesApi<'Baseline'> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  const points = useMemo(() => {
    const map = new Map<number, number>();
    for (const c of candles) {
      if (Number.isFinite(c.time) && Number.isFinite(c.close)) {
        map.set(Math.floor(c.time), c.close);
      }
    }
    for (const p of livePoints) {
      if (Number.isFinite(p.time) && Number.isFinite(p.value)) {
        map.set(Math.floor(p.time), p.value);
      }
    }
    const sorted = Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([t, value]) => ({
        time: t as UTCTimestamp,
        value,
      }));
    // In simple mode focus on the most recent ~90 points for high-res 1-minute movement feel
    return mode === 'simple' && sorted.length > 90 ? sorted.slice(-90) : sorted;
  }, [candles, livePoints, mode]);

  const effectiveRef =
    referencePrice && referencePrice > 0
      ? referencePrice
      : points.length > 0
        ? points[Math.max(0, points.length - 15)].value
        : spotPrice;

  const latestPrice = spotPrice > 0 ? spotPrice : points[points.length - 1]?.value ?? 0;
  const delta = effectiveRef > 0 && latestPrice > 0 ? latestPrice - effectiveRef : 0;
  const isAboveRef = delta >= 0;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      layout: {
        background: { type: ColorType.Solid, color: mode === 'simple' ? '#05070B' : '#030509' },
        textColor: '#8E98A8',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(45, 55, 75, 0.22)' },
        horzLines: { color: 'rgba(45, 55, 75, 0.22)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(96, 165, 250, 0.45)', style: LineStyle.Dashed },
        horzLine: { color: 'rgba(96, 165, 250, 0.45)', style: LineStyle.Dashed },
      },
      rightPriceScale: {
        borderColor: 'rgba(45, 55, 75, 0.5)',
        scaleMargins: {
          top: mode === 'simple' ? 0.24 : 0.14,
          bottom: mode === 'simple' ? 0.22 : 0.12,
        },
      },
      timeScale: {
        borderColor: 'rgba(45, 55, 75, 0.5)',
        timeVisible: true,
        secondsVisible: true,
        rightOffset: mode === 'simple' ? 28 : 8,
      },
      width: el.clientWidth,
      height,
    });

    const series =
      mode === 'simple'
        ? chart.addSeries(BaselineSeries, {
            baseValue: { type: 'price', price: effectiveRef || 1 },
            topLineColor: '#2B7FFF',
            topFillColor1: 'rgba(8, 209, 137, 0.20)',
            topFillColor2: 'rgba(8, 209, 137, 0.05)',
            bottomLineColor: '#2B7FFF',
            bottomFillColor1: 'rgba(240, 82, 94, 0.05)',
            bottomFillColor2: 'rgba(240, 82, 94, 0.22)',
            lineWidth: 2,
            lastValueVisible: true,
            priceLineVisible: false,
          })
        : chart.addSeries(AreaSeries, {
            lineColor: '#60A5FA',
            topColor: 'rgba(43, 127, 255, 0.28)',
            bottomColor: 'rgba(43, 127, 255, 0.02)',
            lineWidth: 2,
            lastValueVisible: true,
            priceLineVisible: true,
          });

    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          chart.applyOptions({ width: entry.contentRect.width });
        }
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      priceLinesRef.current = [];
      seriesRef.current = null;
      chartRef.current = null;
      chart.remove();
    };
  }, [mode, height]);

  // Update baseline price in simple mode without recreating chart
  useEffect(() => {
    const s = seriesRef.current;
    if (!s || mode !== 'simple' || !effectiveRef) return;
    (s as ISeriesApi<'Baseline'>).applyOptions({
      baseValue: { type: 'price', price: effectiveRef },
    });
  }, [mode, effectiveRef]);

  // Push series points
  useEffect(() => {
    const s = seriesRef.current;
    if (!s || points.length === 0) return;
    s.setData(points);
    chartRef.current?.timeScale().fitContent();
  }, [points]);

  // Update horizontal reference / strike price lines
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;

    for (const pl of priceLinesRef.current) {
      try {
        s.removePriceLine(pl);
      } catch {
        // ignore
      }
    }
    priceLinesRef.current = [];

    if (mode === 'simple') {
      if (effectiveRef > 0) {
        priceLinesRef.current.push(
          s.createPriceLine({
            price: effectiveRef,
            color: 'rgba(226, 232, 240, 0.45)',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: 'last close',
          })
        );
      }
    } else {
      if (side === 'range') {
        if (lowerStrike && lowerStrike > 0) {
          priceLinesRef.current.push(
            s.createPriceLine({
              price: lowerStrike,
              color: '#60A5FA',
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: 'Lower',
            })
          );
        }
        if (upperStrike && upperStrike > 0) {
          priceLinesRef.current.push(
            s.createPriceLine({
              price: upperStrike,
              color: '#60A5FA',
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: 'Upper',
            })
          );
        }
      } else if (strike && strike > 0) {
        priceLinesRef.current.push(
          s.createPriceLine({
            price: strike,
            color: side === 'up' ? '#08D189' : '#F0525E',
            lineWidth: 1,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: side === 'up' ? 'Above' : 'Below',
          })
        );
      }
    }
  }, [mode, effectiveRef, side, strike, lowerStrike, upperStrike]);

  return (
    <div className="relative w-full overflow-hidden" style={{ height }}>
      {/* Simple Mode Split Backdrop & Giant Price Header */}
      {mode === 'simple' && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-[#08D189]/10 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#F0525E]/10 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 top-5 z-10 flex items-baseline justify-center gap-3">
            <span className="text-3xl sm:text-4xl font-mono font-extrabold tracking-tight text-white tabular-nums drop-shadow">
              {latestPrice > 0
                ? `$${latestPrice.toLocaleString(undefined, {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`
                : '--'}
            </span>
            {effectiveRef > 0 && latestPrice > 0 && (
              <span
                className={`text-sm font-mono font-bold tabular-nums ${
                  isAboveRef ? 'text-[#08D189]' : 'text-[#F0525E]'
                }`}
              >
                {isAboveRef ? '+' : '-'}$
                {Math.abs(delta).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            )}
          </div>

          {expiryMs && (
            <div className="pointer-events-none absolute right-[18%] inset-y-6 z-10 flex flex-col items-center">
              <div className="w-px flex-1 bg-[#2B7FFF]/45" />
              <div className="my-1 px-2 py-0.5 rounded bg-[#0C1220] border border-[#2B7FFF]/60 text-[10px] font-mono font-bold text-[#93C5FD] tracking-wider whitespace-nowrap">
                SETTLES {formatUtcClock(expiryMs)}
              </div>
              <div className="w-px flex-1 bg-[#2B7FFF]/45" />
            </div>
          )}
        </>
      )}

      {isLoading && points.length === 0 && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 text-xs font-mono text-slate-400">
          Loading BTC live feed...
        </div>
      )}

      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
};
