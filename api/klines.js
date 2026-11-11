// Vercel Serverless Function: GET /api/klines?symbol=SUIUSDT&timeframe=1D
// High-Frequency Candle & Spline Provider for Volt Protocol

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { symbol = 'SUIUSDT', timeframe = '1D', spotPrice = '0.845' } = req.query;

  const tfConfig = {
    '1m': { interval: '1m', kucoin: '1min', limit: 60, spanMs: 60 * 60 * 1000 },
    '5m': { interval: '5m', kucoin: '5min', limit: 60, spanMs: 5 * 60 * 60 * 1000 },
    '15m': { interval: '15m', kucoin: '15min', limit: 60, spanMs: 15 * 60 * 60 * 1000 },
    '1H': { interval: '1m', kucoin: '1hour', limit: 60, spanMs: 60 * 60 * 1000 },
    '1h': { interval: '1m', kucoin: '1hour', limit: 60, spanMs: 60 * 60 * 1000 },
    '4h': { interval: '4h', kucoin: '4hour', limit: 60, spanMs: 10 * 24 * 60 * 60 * 1000 },
    '1D': { interval: '15m', kucoin: '1day', limit: 60, spanMs: 60 * 24 * 60 * 60 * 1000 },
    '1d': { interval: '15m', kucoin: '1day', limit: 60, spanMs: 60 * 24 * 60 * 60 * 1000 },
    '1W': { interval: '1h', kucoin: '1week', limit: 52, spanMs: 52 * 7 * 24 * 60 * 60 * 1000 },
    '1w': { interval: '1h', kucoin: '1week', limit: 52, spanMs: 52 * 7 * 24 * 60 * 60 * 1000 },
    '1M': { interval: '4h', kucoin: '1week', limit: 60, spanMs: 60 * 7 * 24 * 60 * 60 * 1000 },
    'ALL': { interval: '1d', kucoin: '1day', limit: 90, spanMs: 90 * 24 * 60 * 60 * 1000 }
  };

  const selectedConfig = tfConfig[timeframe] || tfConfig['1D'];

  // Normalize tickers
  let cleanBase = symbol.toUpperCase().replace('-PERP', '').replace('USDT', '').replace('USDC', '').replace(/[^A-Z]/g, '');
  if (!cleanBase) cleanBase = 'SUI';
  const kucoinSymbol = `${cleanBase}-USDT`;
  const binanceSymbol = `${cleanBase}USDT`;

  // 1. Try KuCoin Live Candles First (Works worldwide without IP blocks)
  try {
    const kucoinUrl = `https://api.kucoin.com/api/v1/market/candles?type=${selectedConfig.kucoin}&symbol=${kucoinSymbol}`;
    const kRes = await fetch(kucoinUrl, { headers: { 'User-Agent': 'VoltProtocol/1.0' } });
    if (kRes.ok) {
      const kData = await kRes.json();
      if (kData.code === '200000' && Array.isArray(kData.data) && kData.data.length > 5) {
        // Kucoin data: [time, open, close, high, low, volume, turnover] in reverse order
        const limitCount = selectedConfig.limit || 60;
        const rawSlice = kData.data.slice(0, limitCount).reverse();
        const candles = rawSlice.map((k) => ({
          time: parseInt(k[0], 10) * 1000,
          open: parseFloat(k[1]),
          close: parseFloat(k[2]),
          high: parseFloat(k[3]),
          low: parseFloat(k[4]),
          volume: parseFloat(k[5])
        }));

        return res.status(200).json({
          success: true,
          source: 'kucoin',
          symbol: kucoinSymbol,
          timeframe,
          candles
        });
      }
    }
  } catch (kErr) {
    console.warn('KuCoin klines fetch failed:', kErr.message);
  }

  // 2. Try Binance Kline API as backup
  try {
    const binanceUrl = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${selectedConfig.interval}&limit=${selectedConfig.limit}`;
    const bRes = await fetch(binanceUrl, { headers: { 'User-Agent': 'VoltProtocol/1.0' } });
    if (bRes.ok) {
      const data = await bRes.json();
      if (Array.isArray(data) && data.length > 5) {
        const candles = data.map((k) => ({
          time: k[0],
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5])
        }));

        return res.status(200).json({
          success: true,
          source: 'binance',
          symbol: binanceSymbol,
          timeframe,
          candles
        });
      }
    }
  } catch (err) {
    console.warn('Binance klines failed, generating spline:', err.message);
  }

  // 2. High-fidelity dynamic timeframe curve fallback
  const base = parseFloat(spotPrice) || 0.845;
  const now = Date.now();
  const count = selectedConfig.limit;
  const stepMs = selectedConfig.spanMs / count;

  // Timeframe volatility factors
  const volMultipliers = {
    '1m': 0.0025, // ±0.25% scalping micro-moves
    '5m': 0.0055, // ±0.55% 5m momentum
    '15m': 0.012, // ±1.2% 15m swing
    '1H': 0.022,  // ±2.2% 1h range
    '1D': 0.045,  // ±4.5% intraday trend
    '1W': 0.11,   // ±11% weekly cycle
    '1M': 0.24,   // ±24% monthly swing
    'ALL': 0.60   // ±60% macro cycle
  };
  const vol = volMultipliers[timeframe] || 0.03;

  // Timeframe trend bias
  const trendFactors = {
    '1m': 0.0008,
    '5m': 0.002,
    '15m': 0.006,
    '1H': 0.015,
    '1D': 0.035,
    '1W': -0.045,
    '1M': 0.18,
    'ALL': 0.85
  };
  const trend = trendFactors[timeframe] || 0.02;

  const candles = [];
  for (let i = count; i >= 0; i--) {
    const t = now - (i * stepMs);
    const progress = (count - i) / count; // 0 to 1

    // Wave pattern specific to timeframe
    const wave1 = Math.sin(progress * Math.PI * 4) * (vol * 0.4);
    const wave2 = Math.cos(progress * Math.PI * 2) * (vol * 0.3);
    const trendOffset = (progress - 1) * trend; // ends at 0 (base spot price)

    const rawPrice = base * (1 + trendOffset + wave1 + wave2);
    const close = Math.max(0.0001, i === 0 ? base : rawPrice);
    const spread = close * 0.003;

    candles.push({
      time: t,
      open: close - spread,
      high: close + spread * 1.5,
      low: close - spread * 1.5,
      close: close,
      volume: 10000 + Math.random() * 50000
    });
  }

  return res.status(200).json({
    success: true,
    source: 'spline_engine',
    symbol,
    timeframe,
    candles
  });
}
