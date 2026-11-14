// Vercel Serverless Function: GET & POST /api/record-swap
// Persists trade ledger in Vercel KV / Upstash (when configured) + Sui Mainnet GraphQL fallback, with instant Telegram notifications.

import {
  fetchOnChainTreasuryLedger,
  hasKvStore,
  kvCommand,
  kvPipeline,
} from './_chainIndexer.js';

const TG_BOT_TOKEN = process.env.VOLT_TG_BOT_TOKEN || '8823047918:AAE9IesCCkFYV5jkcsUELc4DrDvZbWFbnHs';
const TG_CHAT_ID = process.env.VOLT_TG_CHAT_ID || '141393418';

const KV_SWAPS_LIST_KEY = 'volt:swaps:v1';
const KV_TRADERS_VOL_KEY = 'volt:leaderboard:traders:v1';
const KV_AFFILIATES_VOL_KEY = 'volt:leaderboard:affiliates:v1';
const KV_AFFILIATES_REFS_KEY = 'volt:leaderboard:refs:v1';

let swapHistory = [];

async function loadKvSwaps(limit = 100) {
  if (!hasKvStore()) return [];
  const raw = await kvCommand(['LRANGE', KV_SWAPS_LIST_KEY, '0', String(limit - 1)]);
  if (!Array.isArray(raw)) return [];
  const parsed = [];
  for (const item of raw) {
    try {
      const obj = typeof item === 'string' ? JSON.parse(item) : item;
      if (obj && obj.digest) parsed.push(obj);
    } catch {
      // ignore malformed entry
    }
  }
  return parsed;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-Volt-Auth'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    const [kvSwaps, chainLedger] = await Promise.all([
      loadKvSwaps(100),
      fetchOnChainTreasuryLedger(false),
    ]);

    const byDigest = new Map();
    for (const s of [...kvSwaps, ...swapHistory, ...(chainLedger.records || [])]) {
      if (s && s.digest && !byDigest.has(s.digest)) {
        byDigest.set(s.digest, s);
      }
    }

    const merged = Array.from(byDigest.values()).sort(
      (a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime()
    );

    const totalVolume = merged.reduce((acc, s) => acc + (parseFloat(s.volumeUsd) || 0), 0);
    const totalFees = merged.reduce((acc, s) => {
      if (typeof s.feeEarnedUsd === 'number') return acc + s.feeEarnedUsd;
      const vol = parseFloat(s.volumeUsd) || 0;
      const r = parseFloat(s.feeRate);
      const rate = Number.isFinite(r) && r >= 0 ? r : 0;
      return acc + vol * rate;
    }, 0);

    return res.status(200).json({
      success: true,
      persistence: hasKvStore() ? 'kv+onchain' : 'onchain-graphql',
      totalSwapsRecorded: merged.length,
      totalVolumeUsd: Number(totalVolume.toFixed(2)),
      totalFeesEarnedUsd: Number(totalFees.toFixed(4)),
      history: merged.slice(0, 60),
    });
  }

  if (req.method === 'POST') {
    try {
      const {
        address,
        digest,
        fromToken,
        toToken,
        fromAmount,
        volumeUsd = 0,
        referrer = null,
        swapMode = 'Market',
        feeRate = null,
        tierName = null,
        tierEmoji = null,
        discountPct = null,
      } = req.body || {};

      if (!address || !digest || !fromToken || !toToken || !fromAmount) {
        return res.status(400).json({ error: 'Missing required swap parameters' });
      }

      if (typeof digest !== 'string' || digest.length < 30) {
        return res.status(400).json({ error: 'Invalid transaction digest' });
      }

      let numVol = parseFloat(volumeUsd) || 0;
      if (numVol <= 0) {
        const amt = parseFloat(fromAmount) || 1.0;
        numVol = amt * 0.85;
      }

      const isMarket = String(swapMode).toLowerCase().includes('market');
      const isPerps = String(swapMode).toLowerCase().includes('perp');
      let parsedFeeRate = feeRate === null || feeRate === undefined ? NaN : parseFloat(feeRate);
      if (isNaN(parsedFeeRate) || parsedFeeRate < 0) {
        parsedFeeRate = isPerps ? 0.0005 : isMarket ? 0.002 : 0.0025;
      }

      const activeTierEmoji = tierEmoji || '🦐';
      const activeTierName = tierName || 'Plankton';
      const parsedDiscount =
        discountPct !== null && !isNaN(parseInt(discountPct, 10))
          ? parseInt(discountPct, 10)
          : activeTierName.toLowerCase().includes('plankton')
            ? 20
            : 0;

      const feeEarnedUsd = (numVol * parsedFeeRate).toFixed(4);
      const feePctFormatted = (parsedFeeRate * 100).toFixed(2);

      if (swapHistory.some((s) => s.digest === digest)) {
        return res.status(200).json({ message: 'Already recorded', digest });
      }

      const swapRecord = {
        address,
        digest,
        fromToken,
        toToken,
        fromAmount,
        volumeUsd: numVol,
        feeRate: parsedFeeRate,
        feeEarnedUsd: Number(feeEarnedUsd),
        tierName: activeTierName,
        tierEmoji: activeTierEmoji,
        discountPct: parsedDiscount,
        swapMode,
        referrer,
        timestamp: new Date().toISOString(),
      };

      swapHistory.push(swapRecord);
      if (swapHistory.length > 250) swapHistory = swapHistory.slice(-250);

      if (hasKvStore()) {
        const cmds = [
          ['LPUSH', KV_SWAPS_LIST_KEY, JSON.stringify(swapRecord)],
          ['LTRIM', KV_SWAPS_LIST_KEY, '0', '499'],
          ['HINCRBYFLOAT', KV_TRADERS_VOL_KEY, address.toLowerCase(), numVol.toFixed(4)],
        ];
        if (referrer && typeof referrer === 'string' && referrer.startsWith('0x')) {
          const refKey = referrer.toLowerCase();
          cmds.push(['HINCRBYFLOAT', KV_AFFILIATES_VOL_KEY, refKey, numVol.toFixed(4)]);
          cmds.push(['SADD', `${KV_AFFILIATES_REFS_KEY}:${refKey}`, address.toLowerCase()]);
        }
        await kvPipeline(cmds);
      }

      const shortAddr =
        address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
      const modeLabel = (swapMode || 'market').toUpperCase();

      const headerTitle = isPerps
        ? `📈 <b>NEW ON-CHAIN PERPS TRADE ON VOLT PROTOCOL</b>`
        : `⚡ <b>NEW ON-CHAIN SWAP (${modeLabel}) ON VOLTSWAP.ORG</b>`;

      const tradeLine = isPerps
        ? `🎯 <b>Position:</b> ${fromAmount} ${fromToken} Collateral (${modeLabel}) ➔ ${toToken}\n` +
          `💰 <b>Position Size:</b> $${numVol.toFixed(2)} USD\n`
        : `💱 <b>Swap:</b> ${fromAmount} ${fromToken} ➔ ${toToken}\n` +
          `💰 <b>Est. Volume:</b> $${numVol.toFixed(2)} USD\n`;

      const text =
        `${headerTitle}\n\n` +
        `👤 <b>Trader:</b> <code>${shortAddr}</code>\n` +
        `🏷️ <b>Trader Rank:</b> ${activeTierEmoji} <b>${activeTierName}</b>` +
        (parsedDiscount > 0 ? ` <i>(-${parsedDiscount}% Fee Discount)</i>` : '') +
        `\n` +
        tradeLine +
        `💵 <b>Protocol Fee (${feePctFormatted}%):</b> +$${feeEarnedUsd} USD\n` +
        `🎯 <b>Execution Engine:</b> <b>${isPerps ? 'Aftermath Perps / Sui PTB' : modeLabel}</b>\n\n` +
        `🔗 <a href="https://suiscan.xyz/mainnet/tx/${digest}">View on Suiscan</a>`;

      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: TG_CHAT_ID,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        });
        await tgRes.json().catch(() => null);
      } catch (tgErr) {
        console.error('Failed to send TG alert:', tgErr);
      }

      return res.status(200).json({
        success: true,
        persistence: hasKvStore() ? 'kv+onchain' : 'onchain-graphql',
        record: swapRecord,
      });
    } catch (e) {
      console.error('Record swap error:', e);
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
