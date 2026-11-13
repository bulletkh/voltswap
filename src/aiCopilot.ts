import type { DeepBookCandle, DeepBookGridOrderRung, DeepBookPoolMeta } from './deepbookV3';
import {
  fetchPredictStrikeLadder,
  PREDICT_ORDER_USD_MIN,
  quotePredictTrade,
  type PredictBoardState,
  type PredictMarketBoardItem,
} from './deepbookPredict';
import { snapStrike, type MintPlan } from '@mysten/deepbook-v3/predict';
import type { DeepBookMarginVault } from './earnPools';
import { computeMarginHealthMetrics, type MarginManagerPosition, type MarginPoolRiskConfig } from './deepbookMargin';

export interface MarketQuantSignals {
  lastPrice: number;
  changePct: number;
  ema9: number;
  ema21: number;
  rsi14: number;
  atrPct: number;
  support: number;
  resistance: number;
  regime: 'Bullish Momentum' | 'Bearish Momentum' | 'Range Consolidation';
  confidenceLabel: string;
}

export type SpotGridStyle = 'dca_buy' | 'take_profit' | 'two_sided';

export interface SpotGridPlanPreview {
  style: SpotGridStyle;
  title: string;
  rationale: string;
  pool: DeepBookPoolMeta;
  rungs: DeepBookGridOrderRung[];
  totalQuoteNeeded: number;
  totalBaseNeeded: number;
  spacingPct: number;
  error?: string;
}

export interface PredictCopilotSetup {
  id: string;
  tag: string;
  title: string;
  rationale: string;
  side: 'up' | 'down' | 'range';
  strike?: number;
  lowerStrike?: number;
  upperStrike?: number;
  market: PredictMarketBoardItem;
  winProbPct: number;
  payoutMultiple: number;
  potentialPayoutUsd: number;
  costUsd: number;
  plan: MintPlan;
}

function calcEma(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}

export function computeMarketQuant(
  candles: DeepBookCandle[],
  fallbackPrice = 0
): MarketQuantSignals {
  const valid = candles.filter((c) => Number.isFinite(c.close) && c.close > 0);
  if (valid.length < 3) {
    return {
      lastPrice: fallbackPrice,
      changePct: 0,
      ema9: fallbackPrice,
      ema21: fallbackPrice,
      rsi14: 50,
      atrPct: 1.1,
      support: fallbackPrice * 0.985,
      resistance: fallbackPrice * 1.015,
      regime: 'Range Consolidation',
      confidenceLabel: 'Baseline Volatility (1.1% grid spacing)',
    };
  }

  const closes = valid.map((c) => c.close);
  const lastPrice = closes[closes.length - 1];
  const baseIdx = Math.max(0, closes.length - 25);
  const changePct = closes[baseIdx] > 0 ? ((lastPrice - closes[baseIdx]) / closes[baseIdx]) * 100 : 0;

  const ema9 = calcEma(closes, 9);
  const ema21 = calcEma(closes, 21);

  // RSI-14
  let gains = 0;
  let losses = 0;
  const rsiStart = Math.max(1, closes.length - 14);
  const rsiCount = closes.length - rsiStart;
  for (let i = rsiStart; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  const avgGain = gains / Math.max(1, rsiCount);
  const avgLoss = losses / Math.max(1, rsiCount);
  const rsi14 = avgLoss === 0 ? (avgGain > 0 ? 78 : 50) : 100 - 100 / (1 + avgGain / avgLoss);

  // ATR-14 as percentage of price
  const atrStart = Math.max(1, valid.length - 14);
  let trSum = 0;
  for (let i = atrStart; i < valid.length; i++) {
    const c = valid[i];
    const prevClose = valid[i - 1].close;
    const tr = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose)
    );
    trSum += tr;
  }
  const rawAtr = trSum / Math.max(1, valid.length - atrStart);
  const atrPct = Math.max(0.35, Math.min(4.5, lastPrice > 0 ? (rawAtr / lastPrice) * 100 : 1.0));

  const windowSlice = valid.slice(-32);
  const support = Math.min(...windowSlice.map((c) => c.low));
  const resistance = Math.max(...windowSlice.map((c) => c.high));

  const emaDiffPct = ema21 > 0 ? ((ema9 - ema21) / ema21) * 100 : 0;
  let regime: MarketQuantSignals['regime'] = 'Range Consolidation';
  if (emaDiffPct > 0.12 && rsi14 >= 52) {
    regime = 'Bullish Momentum';
  } else if (emaDiffPct < -0.12 && rsi14 <= 48) {
    regime = 'Bearish Momentum';
  }

  return {
    lastPrice,
    changePct,
    ema9,
    ema21,
    rsi14,
    atrPct,
    support,
    resistance,
    regime,
    confidenceLabel: `EMA9/21 ${emaDiffPct >= 0 ? '+' : ''}${emaDiffPct.toFixed(2)}% · RSI ${rsi14.toFixed(0)} · ATR ${atrPct.toFixed(2)}%`,
  };
}

function snapToTick(price: number, tickSize: number): number {
  if (!Number.isFinite(price) || price <= 0) return tickSize;
  const safeTick = tickSize > 0 ? tickSize : 0.0001;
  return Math.max(safeTick, Math.round(price / safeTick) * safeTick);
}

function snapToLot(qty: number, lotSize: number, minSize: number): number {
  const safeLot = lotSize > 0 ? lotSize : 0.01;
  const stepped = Math.floor(qty / safeLot) * safeLot;
  return stepped >= minSize ? stepped : 0;
}

export function buildSpotGridPlan(params: {
  pool: DeepBookPoolMeta;
  midPrice: number;
  candles: DeepBookCandle[];
  budgetQuoteUsd: number;
  style: SpotGridStyle;
}): SpotGridPlanPreview {
  const { pool, midPrice, candles, budgetQuoteUsd, style } = params;
  const signals = computeMarketQuant(candles, midPrice);
  const refPrice = midPrice > 0 ? midPrice : signals.lastPrice;
  const spacingPct = Math.max(0.4, Math.min(2.5, signals.atrPct * 0.85));

  if (!refPrice || refPrice <= 0) {
    return {
      style,
      title: 'DeepBook Spot CLOB Grid',
      rationale: 'Waiting for live DeepBook orderbook mid price.',
      pool,
      rungs: [],
      totalQuoteNeeded: 0,
      totalBaseNeeded: 0,
      spacingPct,
      error: 'Live pool mid price unavailable.',
    };
  }

  const minRungQuote = Math.max(0.5, pool.minSize * refPrice * 1.04);
  const safeBudget = Math.max(minRungQuote, budgetQuoteUsd);
  const maxRungsAllowed = Math.max(1, Math.min(4, Math.floor(safeBudget / minRungQuote)));

  const rungs: DeepBookGridOrderRung[] = [];
  if (style === 'dca_buy') {
    const count = Math.min(3, maxRungsAllowed);
    const quotePerRung = safeBudget / count;
    for (let i = 1; i <= count; i++) {
      const p = snapToTick(refPrice * (1 - (spacingPct * i) / 100), pool.tickSize);
      const q = snapToLot(quotePerRung / p, pool.lotSize, pool.minSize);
      if (q >= pool.minSize) {
        rungs.push({ price: p, quantity: q, isBid: true });
      }
    }
  } else if (style === 'take_profit') {
    const count = Math.min(3, maxRungsAllowed);
    const quotePerRung = safeBudget / count;
    for (let i = 1; i <= count; i++) {
      const p = snapToTick(refPrice * (1 + (spacingPct * i) / 100), pool.tickSize);
      const q = snapToLot(quotePerRung / p, pool.lotSize, pool.minSize);
      if (q >= pool.minSize) {
        rungs.push({ price: p, quantity: q, isBid: false });
      }
    }
  } else {
    const halfRungs = Math.max(1, Math.min(2, Math.floor(maxRungsAllowed / 2)));
    const quotePerRung = safeBudget / (halfRungs * 2);
    for (let i = 1; i <= halfRungs; i++) {
      const bidP = snapToTick(refPrice * (1 - (spacingPct * i) / 100), pool.tickSize);
      const askP = snapToTick(refPrice * (1 + (spacingPct * i) / 100), pool.tickSize);
      const bidQ = snapToLot(quotePerRung / bidP, pool.lotSize, pool.minSize);
      const askQ = snapToLot(quotePerRung / askP, pool.lotSize, pool.minSize);
      if (bidQ >= pool.minSize) rungs.push({ price: bidP, quantity: bidQ, isBid: true });
      if (askQ >= pool.minSize) rungs.push({ price: askP, quantity: askQ, isBid: false });
    }
  }

  const totalQuoteNeeded = rungs
    .filter((r) => r.isBid)
    .reduce((acc, r) => acc + r.price * r.quantity, 0);
  const totalBaseNeeded = rungs
    .filter((r) => !r.isBid)
    .reduce((acc, r) => acc + r.quantity, 0);

  const title =
    style === 'dca_buy'
      ? `Dip Accumulation Grid (${pool.baseSymbol}/${pool.quoteSymbol})`
      : style === 'take_profit'
        ? `Scale-Out Profit Ladder (${pool.baseSymbol}/${pool.quoteSymbol})`
        : `Balanced Maker Grid (${pool.baseSymbol}/${pool.quoteSymbol})`;

  const rationale =
    rungs.length > 0
      ? `Sized using live 15m ATR (${signals.atrPct.toFixed(2)}%) into ${rungs.length} DeepBook v3 ticks (${spacingPct.toFixed(2)}% step).`
      : `Increase budget above $${minRungQuote.toFixed(2)} ${pool.quoteSymbol} to clear pool min order size (${pool.minSize} ${pool.baseSymbol}).`;

  return {
    style,
    title,
    rationale,
    pool,
    rungs,
    totalQuoteNeeded,
    totalBaseNeeded,
    spacingPct,
    error: rungs.length === 0 ? rationale : undefined,
  };
}

export async function generatePredictCopilotSetups(params: {
  owner: string;
  board: PredictBoardState;
  btcCandles: DeepBookCandle[];
  budgetUsdc: number;
}): Promise<{ signals: MarketQuantSignals; setups: PredictCopilotSetup[] }> {
  const { owner, board, btcCandles, budgetUsdc } = params;
  const activeMarket = board.markets.find((m) => m.acceptingMints) ?? board.markets[0];
  const signals = computeMarketQuant(btcCandles, board.spotForward || activeMarket?.forwardPrice || 0);

  if (!activeMarket) {
    return { signals, setups: [] };
  }

  const forward = activeMarket.forwardPrice || board.spotForward;
  const ladder = await fetchPredictStrikeLadder(activeMarket.market, forward);
  const safeUsd = Math.max(PREDICT_ORDER_USD_MIN, budgetUsdc);
  const setups: PredictCopilotSetup[] = [];

  const bullishBias = signals.regime !== 'Bearish Momentum';
  const targetDir: 'up' | 'down' = bullishBias ? 'up' : 'down';

  // 1) High-Probability Core Scalp (35%-49% implied prob in trend direction)
  const coreCandidates = ladder.filter((row) => {
    const p = targetDir === 'up' ? row.upProb : row.downProb;
    const inBand = targetDir === 'up' ? row.upInBand : row.downInBand;
    return inBand && p >= 0.32 && p <= 0.495;
  });
  const coreStrike =
    coreCandidates.sort((a, b) => {
      const pa = targetDir === 'up' ? a.upProb : a.downProb;
      const pb = targetDir === 'up' ? b.upProb : b.downProb;
      return pb - pa;
    })[0] ?? ladder.find((r) => (targetDir === 'up' ? r.upInBand : r.downInBand));

  if (coreStrike) {
    const q = await quotePredictTrade({
      owner,
      market: activeMarket.market,
      side: targetDir,
      strike: coreStrike.strike,
      amountUsdc: safeUsd,
    });
    if (q.plan && (q.plan.accepting || q.plan.refusal === 'fee')) {
      const prob = (targetDir === 'up' ? coreStrike.upProb : coreStrike.downProb) * 100;
      setups.push({
        id: 'core-trend',
        tag: 'HIGH PROBABILITY',
        title: `BTC ${targetDir === 'up' ? '>' : '<='} $${coreStrike.strike.toLocaleString()}`,
        rationale: `${signals.regime} (RSI ${signals.rsi14.toFixed(0)}): captures near-band momentum at ${prob.toFixed(1)}% implied odds.`,
        side: targetDir,
        strike: coreStrike.strike,
        market: activeMarket,
        winProbPct: prob,
        payoutMultiple: q.plan.payoutMultiple,
        potentialPayoutUsd: q.plan.potentialPayout,
        costUsd: q.plan.totalDebit,
        plan: q.plan,
      });
    }
  }

  // 2) Asymmetric Convex Breakout (17%-29% implied prob)
  const breakoutCandidates = ladder.filter((row) => {
    const p = targetDir === 'up' ? row.upProb : row.downProb;
    const inBand = targetDir === 'up' ? row.upInBand : row.downInBand;
    return inBand && p >= 0.165 && p <= 0.295;
  });
  const breakoutStrike = breakoutCandidates[0];
  if (breakoutStrike && breakoutStrike.strike !== coreStrike?.strike) {
    const q = await quotePredictTrade({
      owner,
      market: activeMarket.market,
      side: targetDir,
      strike: breakoutStrike.strike,
      amountUsdc: safeUsd,
    });
    if (q.plan && (q.plan.accepting || q.plan.refusal === 'fee')) {
      const prob = (targetDir === 'up' ? breakoutStrike.upProb : breakoutStrike.downProb) * 100;
      setups.push({
        id: 'convex-breakout',
        tag: 'CONVEX 4X+',
        title: `BTC ${targetDir === 'up' ? '>' : '<='} $${breakoutStrike.strike.toLocaleString()}`,
        rationale: `ATR-scaled wing breakout targeting ${q.plan.payoutMultiple.toFixed(2)}x asymmetric return inside DeepBook v3 band.`,
        side: targetDir,
        strike: breakoutStrike.strike,
        market: activeMarket,
        winProbPct: prob,
        payoutMultiple: q.plan.payoutMultiple,
        potentialPayoutUsd: q.plan.potentialPayout,
        costUsd: q.plan.totalDebit,
        plan: q.plan,
      });
    }
  }

  // 3) Mean-Reversion Range Bracket
  const step = Math.max(100, activeMarket.market.admissionTickSize || 500);
  const spreadDollars = Math.max(step, (forward * Math.max(0.45, signals.atrPct * 0.7)) / 100);
  const lower = snapStrike(forward - spreadDollars, step, 'down');
  const upper = snapStrike(forward + spreadDollars, step, 'up');
  if (upper > lower && lower >= activeMarket.minStrike && upper <= activeMarket.maxStrike) {
    const q = await quotePredictTrade({
      owner,
      market: activeMarket.market,
      side: 'range',
      lowerStrike: lower,
      upperStrike: upper,
      amountUsdc: safeUsd,
    });
    if (q.plan && (q.plan.accepting || q.plan.refusal === 'fee')) {
      const estProb = Math.min(50, Math.max(15, 100 / Math.max(1.5, q.plan.payoutMultiple)));
      setups.push({
        id: 'range-pin',
        tag: 'RANGE BRACKET',
        title: `BTC $${lower.toLocaleString()} - $${upper.toLocaleString()}`,
        rationale: `Monetizes pin/chop around forward $${Math.round(forward).toLocaleString()} with ${q.plan.payoutMultiple.toFixed(2)}x payout.`,
        side: 'range',
        lowerStrike: lower,
        upperStrike: upper,
        market: activeMarket,
        winProbPct: estProb,
        payoutMultiple: q.plan.payoutMultiple,
        potentialPayoutUsd: q.plan.potentialPayout,
        costUsd: q.plan.totalDebit,
        plan: q.plan,
      });
    }
  }

  return { signals, setups };
}

export interface YieldAndMarginReport {
  topVaults: Array<{ coinKey: string; apr: number; utilizationPct: number }>;
  marginWarning: string | null;
  suggestedTp: number | null;
  suggestedSl: number | null;
}

export function buildYieldAndMarginReport(params: {
  vaults: DeepBookMarginVault[];
  marginPosition: MarginManagerPosition | null;
  riskConfig: MarginPoolRiskConfig | null;
  midPrice: number;
  candles: DeepBookCandle[];
}): YieldAndMarginReport {
  const { vaults, marginPosition, riskConfig, midPrice, candles } = params;
  const topVaults = [...vaults]
    .sort((a, b) => b.supplyAprPct - a.supplyAprPct)
    .slice(0, 4)
    .map((v) => ({
      coinKey: v.coinKey,
      apr: v.supplyAprPct,
      utilizationPct: v.utilizationPct,
    }));

  const health = computeMarginHealthMetrics(marginPosition, riskConfig);
  const sig = computeMarketQuant(candles, midPrice);
  const ref = midPrice > 0 ? midPrice : sig.lastPrice;

  let marginWarning: string | null = null;
  if (health.hasDebt && health.status === 'danger') {
    marginWarning = `Risk Ratio ${health.riskRatio.toFixed(2)}x is near liquidation (${health.liquidationRiskRatio.toFixed(2)}x). Top up collateral immediately.`;
  } else if (health.hasDebt && health.status === 'caution') {
    marginWarning = `Risk Ratio ${health.riskRatio.toFixed(2)}x has tight ${health.healthBufferPct.toFixed(1)}% buffer.`;
  }

  const move = Math.max(0.015, sig.atrPct / 100);
  const suggestedTp =
    ref > 0 ? Number((ref * (health.inferredSide === 'long' ? 1 + move * 2.2 : 1 - move * 2.2)).toFixed(4)) : null;
  const suggestedSl =
    ref > 0 ? Number((ref * (health.inferredSide === 'long' ? 1 - move * 1.15 : 1 + move * 1.15)).toFixed(4)) : null;

  return {
    topVaults,
    marginWarning,
    suggestedTp,
    suggestedSl,
  };
}
