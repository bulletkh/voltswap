// Vercel Serverless Function: GET /api/stats for DefiLlama and Analytics Trackers
import { fetchOnChainTreasuryLedger, hasKvStore, kvCommand } from './_chainIndexer.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const [chainLedger, kvTradersRaw] = await Promise.all([
      fetchOnChainTreasuryLedger(false),
      hasKvStore() ? kvCommand(['HGETALL', 'volt:leaderboard:traders:v1']) : Promise.resolve(null),
    ]);

    const chainTotal = Number(chainLedger.totalVolumeUsd || 0);
    let kvTotal = 0;
    if (Array.isArray(kvTradersRaw)) {
      for (let i = 1; i < kvTradersRaw.length; i += 2) {
        kvTotal += parseFloat(kvTradersRaw[i] || '0') || 0;
      }
    }
    const totalVolume = Math.max(chainTotal, kvTotal);

    const dayAgo = Date.now() - 86_400_000;
    const dailyVolume = (chainLedger.records || []).reduce((acc, r) => {
      const ts = new Date(r.timestamp || 0).getTime();
      return ts >= dayAgo ? acc + (Number(r.volumeUsd) || 0) : acc;
    }, 0);

    return res.status(200).json({
      dailyVolume: dailyVolume.toFixed(2),
      totalVolume: totalVolume.toFixed(2),
      timestamp: Math.floor(Date.now() / 1000),
    });
  } catch {
    return res.status(200).json({
      dailyVolume: '0.00',
      totalVolume: '0.00',
      timestamp: Math.floor(Date.now() / 1000),
    });
  }
}
