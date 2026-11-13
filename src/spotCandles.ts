import { fetchDeepBookCandles, type DeepBookCandle, type DeepBookPoolMeta } from './deepbookV3';
import type { ChartTimeframe } from './components/ProCandleChart';

const STABLES = new Set([
  'USDC',
  'USDT',
  'WUSDC',
  'WUSDT',
  'SUSDT',
  'SUIUSDE',
  'USDSUI',
  'AUSD',
  'BUCK',
  'FUSD',
  'USDY',
  'USD',
]);

function canonicalBase(sym: string): string {
  const s = sym.toUpperCase().trim();
  if (s === 'WBTC' || s === 'XBTC' || s === 'HBTC' || s === 'LZWBTC' || s === 'LBTC' || s === 'CBTC') {
    return 'BTC';
  }
  if (s === 'WETH' || s === 'BWETH' || s === 'BETH' || s === 'SETH') return 'ETH';
  if (s === 'WSOL') return 'SOL';
  if (s === 'HASUI' || s === 'VSUI' || s === 'AFSUI' || s === 'SPRING') return 'SUI';
  if (s === 'WUSDC') return 'USDC';
  if (s === 'WUSDT' || s === 'SUSDT') return 'USDT';
  return s;
}

async function fetchBinanceKlines(
  symbol: string,
  timeframe: ChartTimeframe,
  limit = 160
): Promise<DeepBookCandle[]> {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(timeframe)}&limit=${limit}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    const out: DeepBookCandle[] = [];
    for (const k of data) {
      const time = Math.floor(Number(k[0]) / 1000);
      const open = Number(k[1]);
      const high = Number(k[2]);
      const low = Number(k[3]);
      const close = Number(k[4]);
      const volume = Number(k[5] || 0);
      if (
        Number.isFinite(time) &&
        open > 0 &&
        high > 0 &&
        low > 0 &&
        close > 0
      ) {
        out.push({ time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function fetchSwapPairCandles(params: {
  fromSymbol: string;
  toSymbol: string;
  timeframe: ChartTimeframe;
  pools: DeepBookPoolMeta[];
  limit?: number;
}): Promise<{
  candles: DeepBookCandle[];
  label: string;
  source: string;
}> {
  const { fromSymbol, toSymbol, timeframe, pools, limit = 150 } = params;
  const fromUpper = fromSymbol.toUpperCase().trim();
  const toUpper = toSymbol.toUpperCase().trim();

  // 1. Exact DeepBook v3 pool match when not requesting 30m (DeepBook indexer uses 1m, 5m, 15m, 1h, 4h, 1d)
  const dbTf = timeframe === '30m' ? '15m' : timeframe;
  const matchedPool = pools.find(
    (p) =>
      p.poolName === `${fromUpper}_${toUpper}` || p.poolName === `${toUpper}_${fromUpper}`
  );

  if (matchedPool) {
    const dbCandles = await fetchDeepBookCandles(matchedPool.poolName, dbTf, limit).catch(() => []);
    if (dbCandles.length >= 5) {
      return {
        candles: dbCandles,
        label: `${matchedPool.baseSymbol} / ${matchedPool.quoteSymbol}`,
        source: 'DeepBook v3',
      };
    }
  }

  // 2. Fallback to Binance spot candles for exact asset / pair
  const baseSym = !STABLES.has(fromUpper) ? canonicalBase(fromUpper) : canonicalBase(toUpper);
  const quoteSym = !STABLES.has(fromUpper) ? canonicalBase(toUpper) : canonicalBase(fromUpper);

  if (STABLES.has(quoteSym)) {
    const klines = await fetchBinanceKlines(`${baseSym}USDT`, timeframe, limit);
    if (klines.length > 0) {
      return {
        candles: klines,
        label: `${fromUpper} / ${toUpper}`,
        source: 'Binance Spot',
      };
    }
  } else {
    // Non-stable pair (e.g., ETH / SUI): compute exact cross-rate candles if both feeds exist
    const [bKlines, qKlines] = await Promise.all([
      fetchBinanceKlines(`${baseSym}USDT`, timeframe, limit),
      fetchBinanceKlines(`${quoteSym}USDT`, timeframe, limit),
    ]);
    if (bKlines.length > 0 && qKlines.length > 0) {
      const qMap = new Map(qKlines.map((q) => [q.time, q]));
      const cross: DeepBookCandle[] = [];
      for (const b of bKlines) {
        const q = qMap.get(b.time);
        if (q && q.close > 0) {
          const open = b.open / (q.open || q.close);
          const close = b.close / q.close;
          const high = Math.max(open, close, b.high / (q.low || q.close));
          const low = Math.min(open, close, b.low / (q.high || q.close));
          cross.push({
            time: b.time,
            open,
            high,
            low,
            close,
            volume: b.volume,
          });
        }
      }
      if (cross.length > 0) {
        return {
          candles: cross,
          label: `${baseSym} / ${quoteSym}`,
          source: 'Cross Feed',
        };
      }
    }
    if (bKlines.length > 0) {
      return {
        candles: bKlines,
        label: `${baseSym} / USD`,
        source: 'Binance Spot',
      };
    }
  }

  // 3. Final fallback: DeepBook SUI_USDC
  const suiCandles = await fetchDeepBookCandles('SUI_USDC', dbTf, limit).catch(() => []);
  return {
    candles: suiCandles,
    label: 'SUI / USDC',
    source: 'DeepBook v3',
  };
}
