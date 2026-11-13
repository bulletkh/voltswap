// Vercel Serverless Function: GET & POST /api/leaderboard
// Combines Vercel KV / Upstash Redis persistence with Sui Mainnet GraphQL on-chain indexing.

import {
  fetchOnChainTreasuryLedger,
  hasKvStore,
  kvCommand,
  kvPipeline,
  resolveTierName,
  shortAddress,
} from './_chainIndexer.js';

const KV_TRADERS_VOL_KEY = 'volt:leaderboard:traders:v1';
const KV_AFFILIATES_VOL_KEY = 'volt:leaderboard:affiliates:v1';
const KV_AFFILIATES_REFS_KEY = 'volt:leaderboard:refs:v1';

// In-memory hot fallback inside active serverless container
const memTraders = new Map(); // lowerAddr -> { fullAddress, volumeUsd, referrals, tradesCount }
const memAffiliates = new Map(); // lowerAddr -> { fullAddress, referredVolumeUsd, referralsSet }

function hgetallArrayToMap(arr) {
  const map = new Map();
  if (!Array.isArray(arr)) return map;
  for (let i = 0; i < arr.length - 1; i += 2) {
    const key = String(arr[i] || '').toLowerCase();
    const val = parseFloat(arr[i + 1] || '0');
    if (key && Number.isFinite(val)) {
      map.set(key, val);
    }
  }
  return map;
}

async function buildCombinedLeaderboard() {
  const [chainLedger, kvTradersRaw, kvAffsRaw] = await Promise.all([
    fetchOnChainTreasuryLedger(false),
    hasKvStore() ? kvCommand(['HGETALL', KV_TRADERS_VOL_KEY]) : Promise.resolve(null),
    hasKvStore() ? kvCommand(['HGETALL', KV_AFFILIATES_VOL_KEY]) : Promise.resolve(null),
  ]);

  const kvTraders = hgetallArrayToMap(kvTradersRaw);
  const kvAffs = hgetallArrayToMap(kvAffsRaw);

  const combinedTraders = new Map();

  // 1. Seed with real verified Sui Mainnet GraphQL transactions
  for (const [key, item] of Object.entries(chainLedger.traderTotals || {})) {
    combinedTraders.set(key, {
      fullAddress: item.fullAddress,
      address: shortAddress(item.fullAddress),
      volumeUsd: Number(item.volumeUsd || 0),
      tradesCount: Number(item.tradesCount || 0),
      referrals: 0,
    });
  }

  // 2. Merge / take max from KV persistent totals (so swaps/perps before GQL catchup count immediately)
  for (const [key, kvVol] of kvTraders.entries()) {
    const existing = combinedTraders.get(key);
    if (existing) {
      existing.volumeUsd = Math.max(existing.volumeUsd, kvVol);
    } else {
      combinedTraders.set(key, {
        fullAddress: key,
        address: shortAddress(key),
        volumeUsd: kvVol,
        tradesCount: 1,
        referrals: 0,
      });
    }
  }

  // 3. Merge in-memory deltas for active container
  for (const [key, mem] of memTraders.entries()) {
    const existing = combinedTraders.get(key);
    if (existing) {
      existing.volumeUsd = Math.max(existing.volumeUsd, mem.volumeUsd);
      existing.referrals = Math.max(existing.referrals, mem.referrals);
    } else {
      combinedTraders.set(key, {
        fullAddress: mem.fullAddress,
        address: shortAddress(mem.fullAddress),
        volumeUsd: mem.volumeUsd,
        tradesCount: mem.tradesCount,
        referrals: mem.referrals,
      });
    }
  }

  // Build affiliates ranking (with real KV SCARD referral counts when configured)
  const combinedAffiliates = new Map();
  const kvAffKeys = Array.from(kvAffs.keys());
  let kvRefCounts = [];
  if (hasKvStore() && kvAffKeys.length > 0) {
    kvRefCounts =
      (await kvPipeline(kvAffKeys.map((k) => ['SCARD', `${KV_AFFILIATES_REFS_KEY}:${k}`]))) || [];
  }
  kvAffKeys.forEach((key, idx) => {
    const vol = kvAffs.get(key) || 0;
    const scardVal = Number(kvRefCounts?.[idx]?.result ?? 1);
    combinedAffiliates.set(key, {
      fullAddress: key,
      address: shortAddress(key),
      referredVolumeUsd: vol,
      referrals: Number.isFinite(scardVal) && scardVal > 0 ? scardVal : 1,
    });
  });
  for (const [key, memAff] of memAffiliates.entries()) {
    const prev = combinedAffiliates.get(key);
    if (prev) {
      prev.referredVolumeUsd = Math.max(prev.referredVolumeUsd, memAff.referredVolumeUsd);
      prev.referrals = Math.max(prev.referrals, memAff.referralsSet.size);
    } else {
      combinedAffiliates.set(key, {
        fullAddress: memAff.fullAddress,
        address: shortAddress(memAff.fullAddress),
        referredVolumeUsd: memAff.referredVolumeUsd,
        referrals: memAff.referralsSet.size,
      });
    }
  }

  const leaderboard = Array.from(combinedTraders.values())
    .sort((a, b) => b.volumeUsd - a.volumeUsd)
    .slice(0, 50)
    .map((entry, idx) => ({
      rank: idx + 1,
      address: entry.address,
      fullAddress: entry.fullAddress,
      volumeUsd: Number(entry.volumeUsd.toFixed(2)),
      tradesCount: entry.tradesCount,
      referrals: combinedAffiliates.get(entry.fullAddress.toLowerCase())?.referrals ?? entry.referrals,
      tier: resolveTierName(entry.volumeUsd),
    }));

  const affiliates = Array.from(combinedAffiliates.values())
    .sort((a, b) => b.referredVolumeUsd - a.referredVolumeUsd)
    .slice(0, 25)
    .map((aff, idx) => ({
      rank: idx + 1,
      address: aff.address,
      fullAddress: aff.fullAddress,
      referredVolumeUsd: Number(aff.referredVolumeUsd.toFixed(2)),
      referrals: aff.referrals,
      tier:
        aff.referredVolumeUsd >= 250_000
          ? 'Whale Syndicate (50%)'
          : aff.referredVolumeUsd >= 25_000
            ? 'Volt Commander (35%)'
            : 'Volt Scout (25%)',
    }));

  const totalProtocolVolume = Number(
    Array.from(combinedTraders.values())
      .reduce((sum, u) => sum + u.volumeUsd, 0)
      .toFixed(2)
  );

  return {
    leaderboard,
    affiliates,
    totalProtocolVolume,
    totalFeesUsd: chainLedger.totalFeesUsd || 0,
    source: hasKvStore() ? 'kv+onchain' : 'onchain-graphql',
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'POST') {
    const { address, volumeAdded = 0, referrer = null } = req.body || {};
    const vol = Math.max(0, Number(volumeAdded) || 0);
    if (address && vol > 0) {
      const lower = address.toLowerCase();
      const prev = memTraders.get(lower) || {
        fullAddress: address,
        volumeUsd: 0,
        referrals: 0,
        tradesCount: 0,
      };
      prev.volumeUsd += vol;
      prev.tradesCount += 1;
      memTraders.set(lower, prev);

      const kvCmds = [['HINCRBYFLOAT', KV_TRADERS_VOL_KEY, lower, vol.toFixed(4)]];

      if (referrer && typeof referrer === 'string' && referrer.toLowerCase() !== lower) {
        const refLower = referrer.toLowerCase();
        const affPrev = memAffiliates.get(refLower) || {
          fullAddress: referrer,
          referredVolumeUsd: 0,
          referralsSet: new Set(),
        };
        affPrev.referredVolumeUsd += vol;
        affPrev.referralsSet.add(lower);
        memAffiliates.set(refLower, affPrev);

        kvCmds.push(['HINCRBYFLOAT', KV_AFFILIATES_VOL_KEY, refLower, vol.toFixed(4)]);
        kvCmds.push(['SADD', `${KV_AFFILIATES_REFS_KEY}:${refLower}`, lower]);
      }

      if (hasKvStore()) {
        await kvPipeline(kvCmds);
      }
    }

    const result = await buildCombinedLeaderboard();
    return res.status(200).json({
      ...result,
      protocol: 'Volt Protocol Institutional Terminal',
    });
  }

  const result = await buildCombinedLeaderboard();
  return res.status(200).json({
    ...result,
    protocol: 'Volt Protocol Institutional Terminal',
  });
}
