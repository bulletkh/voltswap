// Shared Vercel Serverless Persistence (Upstash / Vercel KV REST) + Sui Mainnet GraphQL Indexer

export const VOLT_TREASURY_ADDRESS =
  '0x7211d7a33c32b8a848fd5d87dc0630b7d40d3d324856a748aff454c2955cab12';

const GQL_URL = 'https://graphql.mainnet.sui.io/graphql';
const SUI_TYPE =
  '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';

export const hasKvStore = () => Boolean(KV_URL && KV_TOKEN);

export async function kvCommand(commandArgs) {
  if (!hasKvStore()) return null;
  try {
    const res = await fetch(KV_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commandArgs),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.result ?? null;
  } catch {
    return null;
  }
}

export async function kvPipeline(commands) {
  if (!hasKvStore() || !Array.isArray(commands) || commands.length === 0) return null;
  try {
    const base = KV_URL.replace(/\/$/, '');
    const res = await fetch(`${base}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commands),
      signal: AbortSignal.timeout(4500),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function resolveTierName(volumeUsd) {
  const v = Number(volumeUsd || 0);
  if (v >= 1_000_000) return 'Leviathan';
  if (v >= 250_000) return 'Blue Whale';
  if (v >= 50_000) return 'Shark';
  if (v >= 10_000) return 'Dolphin';
  if (v >= 1_000) return 'Plankton';
  return 'Guest Trader';
}

export function shortAddress(addr) {
  if (!addr || typeof addr !== 'string') return '0x...';
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

let cachedSuiUsd = { price: 0.85, fetchedAt: 0 };
export async function getLiveSuiPriceUsd() {
  if (Date.now() - cachedSuiUsd.fetchedAt < 30_000 && cachedSuiUsd.price > 0) {
    return cachedSuiUsd.price;
  }
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SUIUSDT', {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const json = await res.json();
      const px = parseFloat(json?.price || '0');
      if (px > 0) {
        cachedSuiUsd = { price: px, fetchedAt: Date.now() };
        return px;
      }
    }
  } catch {
    // ignore
  }
  return cachedSuiUsd.price || 0.85;
}

let chainCache = { fetchedAt: 0, records: [], traderTotals: {}, totalVolumeUsd: 0, totalFeesUsd: 0 };

/**
 * Indexes real on-chain protocol transactions involving VOLT_TREASURY_ADDRESS
 * via Sui Mainnet GraphQL so leaderboards & history survive serverless cold starts.
 */
export async function fetchOnChainTreasuryLedger(force = false) {
  if (!force && Date.now() - chainCache.fetchedAt < 25_000 && chainCache.records.length > 0) {
    return chainCache;
  }

  try {
    const suiPrice = await getLiveSuiPriceUsd();
    const query = `query ($addr: SuiAddress!) {
      transactions(filter: { affectedAddress: $addr }, last: 50) {
        nodes {
          digest
          sender { address }
          effects {
            status
            timestamp
            balanceChanges {
              nodes {
                owner { address }
                coinType { repr }
                amount
              }
            }
            events {
              nodes {
                contents {
                  type { repr }
                  json
                }
              }
            }
          }
        }
      }
    }`;

    const gqlRes = await fetch(GQL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables: { addr: VOLT_TREASURY_ADDRESS } }),
      signal: AbortSignal.timeout(6500),
    });

    if (!gqlRes.ok) return chainCache;
    const gqlJson = await gqlRes.json();
    const nodes = gqlJson?.data?.transactions?.nodes || [];

    const treasuryLower = VOLT_TREASURY_ADDRESS.toLowerCase();
    const records = [];
    const traderTotals = {};
    let totalVolumeUsd = 0;
    let totalFeesUsd = 0;

    for (const tx of nodes) {
      const status = String(tx?.effects?.status || '');
      if (status && status !== 'SUCCESS') continue;

      const sender = String(tx?.sender?.address || '');
      const digest = String(tx?.digest || '');
      if (!sender || !digest) continue;

      const bcs = tx?.effects?.balanceChanges?.nodes || [];
      const events = tx?.effects?.events?.nodes || [];
      const evTypes = events.map((e) => String(e?.contents?.type?.repr || ''));

      let treasuryFeeUsd = 0;
      let stableFlowUsd = 0;
      let suiFlowUsd = 0;
      let inferredFrom = 'USDC';
      let inferredTo = 'SUI';
      let fromAmt = 0;

      for (const bc of bcs) {
        const ownerAddr = String(bc?.owner?.address || '').toLowerCase();
        const coinType = String(bc?.coinType?.repr || '');
        const coinLower = coinType.toLowerCase();
        const rawAmt = Number(bc?.amount || 0);
        if (!Number.isFinite(rawAmt) || rawAmt === 0) continue;

        const isSui = coinType === SUI_TYPE || coinLower.endsWith('::sui::sui');
        const isStable =
          coinLower.includes('usdc') ||
          coinLower.includes('usdt') ||
          coinLower.includes('sui_usde') ||
          coinLower.includes('buck');
        const dec = isSui ? 9 : isStable ? 6 : 9;
        const unitAmt = Math.abs(rawAmt) / Math.pow(10, dec);
        const usdVal = isSui ? unitAmt * suiPrice : isStable ? unitAmt : 0;

        if (ownerAddr === treasuryLower && rawAmt > 0 && sender.toLowerCase() !== treasuryLower) {
          treasuryFeeUsd += usdVal;
        }
        if (ownerAddr === sender.toLowerCase()) {
          if (rawAmt < 0) {
            fromAmt = Math.max(fromAmt, unitAmt);
            inferredFrom = isSui ? 'SUI' : isStable ? 'USDC' : coinType.split('::').pop() || 'TOKEN';
          } else if (rawAmt > 0) {
            inferredTo = isSui ? 'SUI' : isStable ? 'USDC' : coinType.split('::').pop() || 'TOKEN';
          }
          if (isStable) stableFlowUsd = Math.max(stableFlowUsd, usdVal);
          if (isSui) suiFlowUsd = Math.max(suiFlowUsd, usdVal);
        }
      }

      // Skip gas-only or pure wallet transfers without DEX / DeepBook / Predict protocol events
      const isProtocolTx = evTypes.some(
        (t) =>
          t.includes('::SwapEvent') ||
          t.includes('ConfirmSwapEvent') ||
          t.includes('::AssetSwap') ||
          t.includes('::order_info::OrderFilled') ||
          t.includes('::margin_manager') ||
          t.includes('::queue_events::OrderEnqueued') ||
          t.includes('FilledTakerOrder')
      );

      if (!isProtocolTx && treasuryFeeUsd <= 0) continue;

      const isPerps = evTypes.some((t) => t.includes('FilledTakerOrder') || t.includes('perpetuals'));
      const isMargin = evTypes.some((t) => t.includes('::margin_manager'));
      const isClob = evTypes.some((t) => t.includes('::order_info::OrderFilled'));
      const isPredict = evTypes.some((t) => t.includes('::queue_events::OrderEnqueued'));

      const swapMode = isPerps
        ? 'Perps'
        : isMargin
          ? 'Margin 4.5x'
          : isClob
            ? 'Spot CLOB'
            : isPredict
              ? 'Predict'
              : 'Market Swap';

      let volumeUsd = stableFlowUsd > 0 ? stableFlowUsd : suiFlowUsd;
      if (volumeUsd <= 0 && treasuryFeeUsd > 0) {
        volumeUsd = treasuryFeeUsd / 0.0025;
      }
      if (volumeUsd <= 0.01) continue;

      const feeUsd = treasuryFeeUsd > 0 ? treasuryFeeUsd : volumeUsd * 0.0025;
      const timestamp = tx?.effects?.timestamp || new Date().toISOString();

      records.push({
        address: sender,
        digest,
        fromToken: inferredFrom,
        toToken: inferredTo,
        fromAmount: fromAmt > 0 ? fromAmt.toFixed(4) : '0',
        volumeUsd: Number(volumeUsd.toFixed(2)),
        feeRate: volumeUsd > 0 ? Number((feeUsd / volumeUsd).toFixed(5)) : 0.0025,
        feeEarnedUsd: Number(feeUsd.toFixed(4)),
        swapMode,
        timestamp,
        onChain: true,
      });

      const key = sender.toLowerCase();
      if (!traderTotals[key]) {
        traderTotals[key] = { fullAddress: sender, volumeUsd: 0, tradesCount: 0 };
      }
      traderTotals[key].volumeUsd += volumeUsd;
      traderTotals[key].tradesCount += 1;

      totalVolumeUsd += volumeUsd;
      totalFeesUsd += feeUsd;
    }

    records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    chainCache = {
      fetchedAt: Date.now(),
      records,
      traderTotals,
      totalVolumeUsd: Number(totalVolumeUsd.toFixed(2)),
      totalFeesUsd: Number(totalFeesUsd.toFixed(4)),
    };
  } catch {
    // keep stale cache if GraphQL temporarily times out
  }

  return chainCache;
}
