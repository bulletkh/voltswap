import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { deriveObjectID, normalizeSuiAddress } from '@mysten/sui/utils';
import {
  MAINNET_CONFIG,
  POS_INF_TICK,
  toGeneratedConfig,
  toOrdersConfig,
  predict,
  registryMoveCalls,
  builderCodeMoveCalls,
  predictAccountMoveCalls,
  plpMoveCalls,
  queueMoveCalls,
  queueTx,
  deriveAccountWrapperId,
  deriveQueueId,
  snapStrike,
  binaryRangeTicks,
  priceToRaw,
  usdcToRaw,
  rawToUsdc,
  generateAuth,
  type ActiveMarket,
  type MarketCoordinates,
  type MintPlan,
  type PricerSnapshot,
  type QueuedOrderView,
  type OpenPosition,
  type SellPlan,
} from '@mysten/deepbook-v3/predict';
import { accountMoveCalls, accountRegistryMoveCalls } from '@mysten/deepbook-v3/account';
import { VOLT_TREASURY_ADDRESS } from './constants';
import { suiGrpcClient } from './suiClient';

const SUI_GRAPHQL_URL = 'https://graphql.mainnet.sui.io/graphql';

export const PREDICT_ORDER_USD_MIN = 1.05;
// Max builder fee allowed by DeepBook Predict protocol_config (0.50% of payout in 1e9 fixed point)
export const PREDICT_BUILDER_FEE_PER_CONTRACT_RAW = 5_000_000n;
export const PREDICT_BUILDER_FEE_PCT = 0.5;

export function createPredictClient() {
  return suiGrpcClient.$extend(predict({ network: 'mainnet' }));
}

export function derivePredictBuilderCodeId(owner: string, index: bigint = 0n): string {
  const KeyTuple = bcs.tuple([bcs.Address, bcs.u64()]);
  const structTag = `${MAINNET_CONFIG.packages.predictV1}::builder_code::BuilderCodeKey`;
  return deriveObjectID(
    MAINNET_CONFIG.objects.registry,
    structTag,
    KeyTuple.serialize([normalizeSuiAddress(owner), index]).toBytes()
  );
}

export const DERIVED_VOLT_BUILDER_CODE_ID = derivePredictBuilderCodeId(VOLT_TREASURY_ADDRESS, 0n);
export const DERIVED_VOLT_REFERRER_WRAPPER_ID = deriveAccountWrapperId(
  MAINNET_CONFIG,
  VOLT_TREASURY_ADDRESS
);

export interface PredictProtocolStatus {
  versionWatermark: number;
  referralFeeRatePct: number;
  builderFeeCutoverActive: boolean;
  builderCodeId: string;
  builderCodeExists: boolean;
  referrerWrapperId: string;
  referrerWrapperExists: boolean;
  claimableBuilderUsdc: number;
}

export interface PredictMarketBoardItem {
  market: ActiveMarket;
  forwardPrice: number;
  minStrike: number;
  maxStrike: number;
  orderFeeUsdc: number;
  acceptingMints: boolean;
  mintRefusal: string | null;
  spareCashUsdc: number;
  tauMs: number;
  cutoffMs: number;
  referencePrice: number | null;
}

export interface PredictStrikeQuote {
  strike: number;
  upProb: number;
  downProb: number;
  upMultiple: number;
  downMultiple: number;
  upInBand: boolean;
  downInBand: boolean;
}

export interface PredictUserOrderRecord {
  marketId: string;
  expiryMs: bigint;
  recordId: bigint;
  view: QueuedOrderView['view'];
  sideLabel: string;
  strikeLabel: string;
}

export interface PredictBoardState {
  markets: PredictMarketBoardItem[];
  spotForward: number;
  pricerAsOf: PricerSnapshot['sources'] | null;
  protocol: PredictProtocolStatus;
  account: {
    wrapperId: string;
    hasAccount: boolean;
    availableUsdc: number;
    pendingUsdc: number;
    referrerSet: boolean;
    builderCodeBound: string | null;
  } | null;
  positions: OpenPosition[];
  orderRecords: PredictUserOrderRecord[];
}

async function checkObjectExists(objectId: string): Promise<{ exists: boolean; json?: any }> {
  try {
    const res = await fetch(SUI_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{ object(address: "${objectId}") { address asMoveObject { contents { json } } } }`,
      }),
    });
    if (!res.ok) return { exists: false };
    const payload = await res.json();
    const obj = payload?.data?.object;
    return {
      exists: Boolean(obj?.address),
      json: obj?.asMoveObject?.contents?.json,
    };
  } catch {
    return { exists: false };
  }
}

export async function fetchPredictProtocolStatus(): Promise<PredictProtocolStatus> {
  const [pcObj, bcObj, refObj] = await Promise.all([
    checkObjectExists(MAINNET_CONFIG.objects.protocolConfig),
    checkObjectExists(DERIVED_VOLT_BUILDER_CODE_ID),
    checkObjectExists(DERIVED_VOLT_REFERRER_WRAPPER_ID),
  ]);

  const pcJson = pcObj.json || {};
  const versionWatermark = Number(pcJson.version_watermark || 4);
  const referralFeeRatePct = (Number(pcJson.referral_fee_rate || 0) / 1e9) * 100;

  let claimableBuilderUsdc = 0;
  if (bcObj.exists) {
    try {
      const cfg = toGeneratedConfig(MAINNET_CONFIG);
      const tx = new Transaction();
      tx.setSender(VOLT_TREASURY_ADDRESS);
      tx.add(
        builderCodeMoveCalls.claimableBuilderFees({
          config: cfg,
          arguments: { code: DERIVED_VOLT_BUILDER_CODE_ID },
        })
      );
      const sim = await suiGrpcClient.simulateTransaction({
        transaction: tx,
        include: { commandResults: true },
      });
      if (sim.$kind === 'Transaction' && (sim as any).Transaction?.commandResults?.length) {
        const ret = (sim as any).Transaction.commandResults.at(-1)?.returnValues?.[0]?.bcs;
        if (ret) {
          const bytes = typeof ret === 'string' ? Uint8Array.from(atob(ret), (c) => c.charCodeAt(0)) : ret;
          const raw = bcs.u64().parse(bytes);
          claimableBuilderUsdc = Number(raw) / 1e6;
        }
      }
    } catch {
      claimableBuilderUsdc = 0;
    }
  }

  return {
    versionWatermark,
    referralFeeRatePct,
    builderFeeCutoverActive: versionWatermark >= 5,
    builderCodeId: DERIVED_VOLT_BUILDER_CODE_ID,
    builderCodeExists: bcObj.exists,
    referrerWrapperId: DERIVED_VOLT_REFERRER_WRAPPER_ID,
    referrerWrapperExists: refObj.exists,
    claimableBuilderUsdc,
  };
}

async function fetchUserPredictOrderIdsFromEvents(
  owner: string
): Promise<Array<{ marketId: string; recordId: bigint }>> {
  try {
    const evType = `${MAINNET_CONFIG.packages.predictOrdersV1}::queue_events::OrderEnqueued`;
    const res = await fetch(SUI_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{
          events(filter: { sender: "${owner}", type: "${evType}" }, last: 25) {
            nodes { contents { json } }
          }
        }`,
      }),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const nodes: any[] = json?.data?.events?.nodes || [];
    const out: Array<{ marketId: string; recordId: bigint }> = [];
    const seen = new Set<string>();
    for (const n of nodes) {
      const ev = n?.contents?.json;
      const mId = String(ev?.expiry_market_id || '');
      const rec = ev?.record_id;
      if (!mId || rec == null) continue;
      const key = `${mId}:${rec}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ marketId: mId, recordId: BigInt(rec) });
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function fetchPredictBoard(owner?: string): Promise<PredictBoardState> {
  const client = createPredictClient();
  const [rawMarkets, protocol] = await Promise.all([
    client.predict.read.markets().catch(() => [] as ActiveMarket[]),
    fetchPredictProtocolStatus(),
  ]);

  const now = Date.now();
  const futureMarkets = rawMarkets
    .filter((m) => Number(m.expiryMs) > now + 15_000)
    .sort((a, b) => Number(a.expiryMs - b.expiryMs));

  const boardItems: PredictMarketBoardItem[] = [];
  let spotForward = 0;
  let pricerAsOf: PricerSnapshot['sources'] | null = null;

  const itemResults = await Promise.allSettled(
    futureMarkets.map(async (market) => {
      const mBase: MarketCoordinates = {
        underlying: 'BTC',
        expiryMs: market.expiryMs,
        marketId: market.id,
      };
      const [qView, pricer] = await Promise.all([
        client.predict.read.queue(mBase),
        client.predict.read.pricer(mBase),
      ]);
      const step = Math.max(1, market.admissionTickSize || 1);
      const fwd = pricer.forward;
      return {
        item: {
          market,
          forwardPrice: fwd,
          minStrike: snapStrike(fwd * 0.985, step, 'down'),
          maxStrike: snapStrike(fwd * 1.015, step, 'up'),
          orderFeeUsdc: rawToUsdc(qView.desk.policy.orderFee),
          acceptingMints: qView.acceptingMints,
          mintRefusal: qView.refusal.mint,
          spareCashUsdc: rawToUsdc(qView.spareCash),
          tauMs: Number(qView.timing.tauMs),
          cutoffMs: Number(qView.timing.cutoffMs),
          referencePrice: market.referencePrice,
        } satisfies PredictMarketBoardItem,
        asOf: pricer.asOf,
      };
    })
  );

  for (const res of itemResults) {
    if (res.status === 'fulfilled') {
      boardItems.push(res.value.item);
      if (spotForward <= 0) {
        spotForward = res.value.item.forwardPrice;
        pricerAsOf = res.value.asOf;
      }
    }
  }

  let accountState: PredictBoardState['account'] = null;
  let positions: OpenPosition[] = [];
  const orderRecords: PredictUserOrderRecord[] = [];

  if (owner) {
    const wrapperId = client.predict.wrapperIdFor(owner);
    const [wrapperObj, balUsdc, pendUsdc, openPos, eventOrders] = await Promise.all([
      checkObjectExists(wrapperId),
      client.predict.read.balance(owner).catch(() => 0),
      client.predict.read.pendingFunds(owner).catch(() => 0),
      client.predict.read.positions(owner).catch(() => [] as OpenPosition[]),
      fetchUserPredictOrderIdsFromEvents(owner),
    ]);
    positions = openPos;

    const accJson = wrapperObj.json?.account || wrapperObj.json;
    accountState = {
      wrapperId,
      hasAccount: wrapperObj.exists,
      availableUsdc: Number(balUsdc || 0),
      pendingUsdc: Number(pendUsdc || 0),
      referrerSet: Boolean(accJson?.referrer_account_id),
      builderCodeBound: null,
    };

    // Hydrate recent queued/open orders across markets
    const byMarket = new Map<string, { expiryMs: bigint; recordIds: bigint[] }>();
    for (const ev of eventOrders) {
      const mObj = rawMarkets.find((m) => m.id === ev.marketId);
      if (!mObj) continue;
      const entry = byMarket.get(ev.marketId) || { expiryMs: mObj.expiryMs, recordIds: [] };
      entry.recordIds.push(ev.recordId);
      byMarket.set(ev.marketId, entry);
    }

    const hydrated = await Promise.allSettled(
      Array.from(byMarket.entries()).map(async ([marketId, info]) => {
        const list = await client.predict.read
          .orders({ underlying: 'BTC', expiryMs: info.expiryMs, marketId }, info.recordIds)
          .catch(() => []);
        return { marketId, expiryMs: info.expiryMs, list };
      })
    );

    for (const h of hydrated) {
      if (h.status !== 'fulfilled') continue;
      for (const ord of h.value.list) {
        if (!ord) continue;
        const rawLower = ord.record.request?.lower_tick ?? null;
        const rawHigher = ord.record.request?.higher_tick ?? null;
        const low = rawLower != null ? Number(rawLower) * 0.01 : null;
        const high = rawHigher != null ? Number(rawHigher) * 0.01 : null;
        const isUp = rawHigher != null && BigInt(rawHigher) >= POS_INF_TICK;
        const isDown = rawLower != null && BigInt(rawLower) === 0n;
        const sideLabel = isUp ? 'UP' : isDown ? 'DOWN' : 'RANGE';
        const strikeLabel = isUp
          ? `> $${(low ?? 0).toLocaleString()}`
          : isDown
            ? `<= $${(high ?? 0).toLocaleString()}`
            : `$${(low ?? 0).toLocaleString()} - $${(high ?? 0).toLocaleString()}`;
        orderRecords.push({
          marketId: h.value.marketId,
          expiryMs: h.value.expiryMs,
          recordId: ord.recordId,
          view: ord.view,
          sideLabel,
          strikeLabel,
        });
      }
    }
    orderRecords.sort((a, b) => Number(b.recordId - a.recordId));
  }

  return {
    markets: boardItems,
    spotForward,
    pricerAsOf,
    protocol,
    account: accountState,
    positions,
    orderRecords,
  };
}

/**
 * Generates a live strike ladder around the forward price with real Black-Scholes + Pyth implied odds.
 * Flags which strikes satisfy Mainnet's [15%, 50%] entry band on UP and DOWN sides.
 */
export async function fetchPredictStrikeLadder(
  market: ActiveMarket,
  forwardPrice: number
): Promise<PredictStrikeQuote[]> {
  const client = createPredictClient();
  const step = Math.max(1, market.admissionTickSize || 1);
  const remMin = Math.max(0.5, (Number(market.expiryMs) - Date.now()) / 60_000);
  const timeScale = Math.sqrt(remMin / 2); // 1.0 at ~2m expiry, scales ~sqrt(T)
  const baseOffsetsPct = [-0.0011, -0.00055, -0.0002, 0.0002, 0.00055, 0.0011];
  const candidateStrikes = baseOffsetsPct.map((pct) =>
    snapStrike(Math.max(step, forwardPrice * (1 + pct * timeScale)), step, pct < 0 ? 'down' : 'up')
  );
  if (market.referencePrice && Number.isFinite(market.referencePrice)) {
    candidateStrikes.push(market.referencePrice);
  }
  const uniqueStrikes = Array.from(new Set(candidateStrikes)).sort((a, b) => a - b);

  const results = await Promise.allSettled(
    uniqueStrikes.map(async (strike) => {
      const q = await client.predict.read.price({
        underlying: 'BTC',
        expiryMs: market.expiryMs,
        marketId: market.id,
        strike,
      });
      const upProb = Math.max(0.001, Math.min(0.999, q.up));
      const downProb = Math.max(0.001, Math.min(0.999, q.down));
      return {
        strike,
        upProb,
        downProb,
        upMultiple: 1 / upProb,
        downMultiple: 1 / downProb,
        upInBand: upProb >= 0.15 && upProb <= 0.5,
        downInBand: downProb >= 0.15 && downProb <= 0.5,
      } satisfies PredictStrikeQuote;
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<PredictStrikeQuote> => r.status === 'fulfilled')
    .map((r) => r.value);
}

/**
 * Finds the nearest admitted strike whose probability sits inside DeepBook Predict's [0.15, 0.50] entry band.
 */
export function pickDefaultValidStrike(
  ladder: PredictStrikeQuote[],
  side: 'up' | 'down',
  market: ActiveMarket,
  forwardPrice: number
): number {
  const valid = ladder.filter((row) => (side === 'up' ? row.upInBand : row.downInBand));
  if (valid.length > 0) {
    // Pick the one closest to 42% prob (~2.38x) for balanced binary odds
    const targetProb = 0.42;
    valid.sort((a, b) => {
      const pa = side === 'up' ? a.upProb : a.downProb;
      const pb = side === 'up' ? b.upProb : b.downProb;
      return Math.abs(pa - targetProb) - Math.abs(pb - targetProb);
    });
    return valid[0].strike;
  }
  const step = Math.max(1, market.admissionTickSize || 1);
  const remMin = Math.max(0.5, (Number(market.expiryMs) - Date.now()) / 60_000);
  const offsetPct = 0.00035 * Math.sqrt(remMin / 2);
  return snapStrike(
    forwardPrice * (side === 'up' ? 1 + offsetPct : 1 - offsetPct),
    step,
    side === 'up' ? 'up' : 'down'
  );
}

export async function quotePredictTrade(params: {
  owner: string;
  market: ActiveMarket;
  side: 'up' | 'down' | 'range';
  strike?: number | 'reference';
  lowerStrike?: number;
  upperStrike?: number;
  amountUsdc: number;
  slippageCents?: number | 'auto';
}): Promise<{ plan: MintPlan | null; error: string | null }> {
  const {
    owner,
    market,
    side,
    strike,
    lowerStrike,
    upperStrike,
    amountUsdc,
    slippageCents = 'auto',
  } = params;
  if (!Number.isFinite(amountUsdc) || amountUsdc < PREDICT_ORDER_USD_MIN) {
    return {
      plan: null,
      error: `Minimum Predict bet is $${PREDICT_ORDER_USD_MIN.toFixed(2)} USDC ($1.00 premium + $0.02 order fee).`,
    };
  }
  const client = createPredictClient();
  const step = Math.max(1, market.admissionTickSize || 1);
  try {
    const desc =
      side === 'range'
        ? {
            underlying: 'BTC' as const,
            expiryMs: market.expiryMs,
            marketId: market.id,
            side: 'range' as const,
            lower: snapStrike(lowerStrike || 1, step, 'down'),
            upper: snapStrike(upperStrike || 2, step, 'up'),
          }
        : {
            underlying: 'BTC' as const,
            expiryMs: market.expiryMs,
            marketId: market.id,
            side,
            strike:
              strike === 'reference'
                ? ('reference' as const)
                : snapStrike(strike || 1, step, 'nearest'),
          };
    const plan = await client.predict.read.planMint(owner, desc, {
      amount: amountUsdc,
      slippageCents,
      orderFee: 'inclusive',
    });
    return { plan, error: null };
  } catch (err: any) {
    return {
      plan: null,
      error: err?.message || 'Unable to quote position at this strike.',
    };
  }
}

/**
 * Builds an atomic 1-transaction DeepBook Predict bet PTB:
 * - Creates Predict AccountWrapper (binding Volt's native AccountReferrer if initialized on-chain)
 * - Deposits only the USDC shortfall from wallet if internal Predict balance < order total
 * - Binds Volt's deterministic BuilderCode (`setBuilderCode` in v4 / `enqueueExactCostWithBuilder` in v5+)
 * - Places the queued order on-chain in 1 signature.
 */
export function buildPredictPlaceBetTx(params: {
  sender: string;
  market: ActiveMarket;
  side: 'up' | 'down' | 'range';
  strike?: number;
  lowerStrike?: number;
  upperStrike?: number;
  maxCostRaw: bigint;
  minQuantityRaw: bigint;
  totalDebitRaw: bigint;
  hasAccount: boolean;
  availableRaw: bigint;
  protocol: PredictProtocolStatus;
}): Transaction {
  const {
    sender,
    market,
    side,
    strike,
    lowerStrike,
    upperStrike,
    maxCostRaw,
    minQuantityRaw,
    totalDebitRaw,
    hasAccount,
    availableRaw,
    protocol,
  } = params;

  const tx = new Transaction();
  tx.setSender(sender);

  const cfg = toGeneratedConfig(MAINNET_CONFIG);
  const ordersCfg = toOrdersConfig(MAINNET_CONFIG);
  const accCfg = {
    accountPackageId: MAINNET_CONFIG.packages.account,
    accountRegistry: MAINNET_CONFIG.objects.accountRegistry,
    accountPackageIdLatest: MAINNET_CONFIG.packages.accountLatest,
  };
  const tickScale = priceToRaw(market.tickSize);
  const step = Math.max(1, market.admissionTickSize || 1);

  let lowerTick: bigint | number;
  let higherTick: bigint | number;
  if (side === 'range') {
    const lowRaw = priceToRaw(snapStrike(lowerStrike || 1, step, 'down'));
    const highRaw = priceToRaw(snapStrike(upperStrike || 2, step, 'up'));
    lowerTick = lowRaw / tickScale;
    higherTick = highRaw / tickScale;
  } else {
    const ticks = binaryRangeTicks(
      priceToRaw(snapStrike(strike || 1, step, 'nearest')),
      side,
      tickScale
    );
    lowerTick = ticks.lowerTick;
    higherTick = ticks.higherTick;
  }

  const u = MAINNET_CONFIG.underlyings.BTC;
  const queueId = deriveQueueId(MAINNET_CONFIG.objects.queueRegistry ?? '', market.id);
  const existingWrapperId = deriveAccountWrapperId(MAINNET_CONFIG, sender);

  const shortfallRaw = availableRaw >= totalDebitRaw ? 0n : totalDebitRaw - availableRaw;

  let wrapperTarget: any = existingWrapperId;
  if (!hasAccount) {
    wrapperTarget = tx.add(
      protocol.referrerWrapperExists
        ? accountRegistryMoveCalls.newWithReferrer({
            config: accCfg,
            arguments: { referrer: protocol.referrerWrapperId },
          })
        : accountRegistryMoveCalls._new({ config: accCfg })
    );
  }

  if (shortfallRaw > 0n) {
    const coin = coinWithBalance({
      type: MAINNET_CONFIG.quoteCoinType,
      balance: shortfallRaw,
      useGasCoin: false,
    })(tx);
    const authDep = tx.add(generateAuth(MAINNET_CONFIG));
    tx.add(
      accountMoveCalls.depositFunds({
        config: accCfg,
        arguments: { wrapper: wrapperTarget, auth: authDep, coin },
        typeArguments: [MAINNET_CONFIG.quoteCoinType],
      })
    );
  }

  if (!hasAccount && protocol.builderCodeExists && !protocol.builderFeeCutoverActive) {
    const authBc = tx.add(generateAuth(MAINNET_CONFIG));
    tx.add(
      predictAccountMoveCalls.setBuilderCode({
        config: cfg,
        arguments: { wrapper: wrapperTarget, auth: authBc, code: protocol.builderCodeId },
      })
    );
  }

  const authOrder = tx.add(generateAuth(MAINNET_CONFIG));
  const useV5Builder = protocol.builderFeeCutoverActive && protocol.builderCodeExists;

  if (useV5Builder) {
    tx.add(
      queueMoveCalls.enqueueExactCostWithBuilder({
        config: ordersCfg,
        arguments: {
          queue: queueId,
          market: market.id,
          wrapper: wrapperTarget,
          auth: authOrder,
          pyth: u.pythFeed,
          bsValues: u.blockScholesValueStore,
          bsSvi: u.blockScholesSviStore,
          code: protocol.builderCodeId,
          builderFeePerContract: PREDICT_BUILDER_FEE_PER_CONTRACT_RAW,
          lowerTick,
          higherTick,
          maxCost: maxCostRaw,
          minQuantity: minQuantityRaw,
        },
      })
    );
  } else {
    tx.add(
      queueMoveCalls.enqueueExactCost({
        config: ordersCfg,
        arguments: {
          queue: queueId,
          market: market.id,
          wrapper: wrapperTarget,
          auth: authOrder,
          pyth: u.pythFeed,
          bsValues: u.blockScholesValueStore,
          bsSvi: u.blockScholesSviStore,
          lowerTick,
          higherTick,
          maxCost: maxCostRaw,
          minQuantity: minQuantityRaw,
        },
      })
    );
  }

  if (!hasAccount) {
    tx.add(accountMoveCalls.share({ config: accCfg, arguments: { self: wrapperTarget } }));
  }

  return tx;
}

export async function buildPredictEarlySellTx(params: {
  sender: string;
  marketId: string;
  expiryMs: bigint;
  recordId: bigint;
  quantity: number;
  protocol: PredictProtocolStatus;
}): Promise<{ tx: Transaction; sellPlan: SellPlan }> {
  const { sender, marketId, expiryMs, recordId, quantity, protocol } = params;
  const client = createPredictClient();
  const mCoords: MarketCoordinates = { underlying: 'BTC', expiryMs, marketId };
  const sellPlan = await client.predict.read.planSell(sender, mCoords, {
    recordId,
    quantity,
    slippageCents: 'auto',
  });

  if (protocol.builderFeeCutoverActive && protocol.builderCodeExists) {
    const ordersCfg = toOrdersConfig(MAINNET_CONFIG);
    const u = MAINNET_CONFIG.underlyings.BTC;
    const tx = new Transaction();
    tx.setSender(sender);
    const auth = tx.add(generateAuth(MAINNET_CONFIG));
    tx.add(
      queueMoveCalls.enqueueRedeemOpenWithBuilder({
        config: ordersCfg,
        arguments: {
          queue: client.predict.queueIdFor(marketId),
          market: marketId,
          wrapper: client.predict.wrapperIdFor(sender),
          auth,
          pyth: u.pythFeed,
          bsValues: u.blockScholesValueStore,
          bsSvi: u.blockScholesSviStore,
          code: protocol.builderCodeId,
          builderFeePerContract: PREDICT_BUILDER_FEE_PER_CONTRACT_RAW,
          recordId,
          closeQuantity: usdcToRaw(quantity),
          minProbability: sellPlan.raw.minProbability,
          minProceeds: sellPlan.raw.minProceeds,
        },
      })
    );
    return { tx, sellPlan };
  }

  const queued = await client.predict.tx.enqueuePlan(sender, mCoords, sellPlan);
  return { tx: queued.transaction, sellPlan };
}

export function buildPredictDepositTx(params: {
  sender: string;
  amountUsdc: number;
  hasAccount: boolean;
  protocol: PredictProtocolStatus;
}): Transaction {
  const { sender, amountUsdc, hasAccount, protocol } = params;
  const tx = new Transaction();
  tx.setSender(sender);

  const accCfg = {
    accountPackageId: MAINNET_CONFIG.packages.account,
    accountRegistry: MAINNET_CONFIG.objects.accountRegistry,
    accountPackageIdLatest: MAINNET_CONFIG.packages.accountLatest,
  };
  const cfg = toGeneratedConfig(MAINNET_CONFIG);
  let wrapperTarget: any = deriveAccountWrapperId(MAINNET_CONFIG, sender);

  if (!hasAccount) {
    wrapperTarget = tx.add(
      protocol.referrerWrapperExists
        ? accountRegistryMoveCalls.newWithReferrer({
            config: accCfg,
            arguments: { referrer: protocol.referrerWrapperId },
          })
        : accountRegistryMoveCalls._new({ config: accCfg })
    );
  }

  const amountRaw = usdcToRaw(amountUsdc);
  if (amountRaw > 0n) {
    const coin = coinWithBalance({
      type: MAINNET_CONFIG.quoteCoinType,
      balance: amountRaw,
      useGasCoin: false,
    })(tx);
    const authDep = tx.add(generateAuth(MAINNET_CONFIG));
    tx.add(
      accountMoveCalls.depositFunds({
        config: accCfg,
        arguments: { wrapper: wrapperTarget, auth: authDep, coin },
        typeArguments: [MAINNET_CONFIG.quoteCoinType],
      })
    );
  }

  if (!hasAccount && protocol.builderCodeExists && !protocol.builderFeeCutoverActive) {
    const authBc = tx.add(generateAuth(MAINNET_CONFIG));
    tx.add(
      predictAccountMoveCalls.setBuilderCode({
        config: cfg,
        arguments: { wrapper: wrapperTarget, auth: authBc, code: protocol.builderCodeId },
      })
    );
  }

  if (!hasAccount) {
    tx.add(accountMoveCalls.share({ config: accCfg, arguments: { self: wrapperTarget } }));
  }

  return tx;
}

export function buildPredictWithdrawTx(sender: string, amountUsdc: number): Transaction {
  const client = createPredictClient();
  const tx = client.predict.tx.withdraw(sender, amountUsdc, { toCoinObject: true });
  tx.setSender(sender);
  return tx;
}

export async function buildPredictClaimRecordTx(
  sender: string,
  marketId: string,
  expiryMs: bigint,
  recordId: bigint,
  action: 'parked' | 'pay-open' | 'refund'
): Promise<Transaction> {
  const ordersCfg = toOrdersConfig(MAINNET_CONFIG);
  const tx = new Transaction();
  tx.setSender(sender);
  if (action === 'parked') {
    tx.add(queueTx.claimParked(ordersCfg, { expiryMarketId: marketId, recordId }));
  } else if (action === 'pay-open') {
    tx.add(queueTx.payOpen(ordersCfg, { expiryMarketId: marketId, recordId }));
  } else {
    const client = createPredictClient();
    const rTx = await client.predict.tx.refund({ underlying: 'BTC', expiryMs, marketId });
    rTx.setSender(sender);
    return rTx;
  }
  return tx;
}

/**
 * Admin PTB for creator treasury wallet:
 * Creates & shares Volt's deterministic BuilderCode (`0x075978...`) + initializes Volt's AccountWrapper
 * (`0xd9f1d77a...`) so native Predict referrals & BuilderFees are active on-chain.
 */
export function buildInitPredictMonetizationTx(params: {
  sender: string;
  createBuilderCode: boolean;
  createReferrerAccount: boolean;
}): Transaction {
  const { sender, createBuilderCode, createReferrerAccount } = params;
  const tx = new Transaction();
  tx.setSender(sender);
  const cfg = toGeneratedConfig(MAINNET_CONFIG);
  const accCfg = {
    accountPackageId: MAINNET_CONFIG.packages.account,
    accountRegistry: MAINNET_CONFIG.objects.accountRegistry,
    accountPackageIdLatest: MAINNET_CONFIG.packages.accountLatest,
  };

  if (createBuilderCode) {
    tx.add(registryMoveCalls.createAndShareBuilderCode({ config: cfg, arguments: { index: 0n } }));
  }
  if (createReferrerAccount) {
    const w = tx.add(accountRegistryMoveCalls._new({ config: accCfg }));
    tx.add(accountMoveCalls.share({ config: accCfg, arguments: { self: w } }));
  }
  return tx;
}

export function buildClaimPredictBuilderFeesTx(sender: string): Transaction {
  const tx = new Transaction();
  tx.setSender(sender);
  const cfg = toGeneratedConfig(MAINNET_CONFIG);
  const coin = tx.add(
    builderCodeMoveCalls.claimAllBuilderFees({
      config: cfg,
      arguments: { code: DERIVED_VOLT_BUILDER_CODE_ID },
    })
  );
  tx.transferObjects([coin], sender);
  return tx;
}

export interface PredictPlpVaultState {
  plpTotalSupply: number;
  idleUsdc: number;
  supplyRequestsPending: number;
  withdrawRequestsPending: number;
  userPlpSharesRaw: bigint;
  userPlpShares: number;
  vaultAvailableUsdc: number;
  hasAccount: boolean;
}

export async function fetchPredictPlpVault(owner?: string): Promise<PredictPlpVaultState> {
  const client = createPredictClient();
  const wrapperId = owner ? deriveAccountWrapperId(MAINNET_CONFIG, owner) : '';
  const [pool, userPlpRaw, bal, accExists] = await Promise.all([
    client.predict.read.pool().catch(() => ({
      plpTotalSupply: 0n,
      idleUsdc: 0,
      supplyRequestsPending: 0,
      withdrawRequestsPending: 0,
    })),
    owner ? client.predict.read.plpBalance(owner).catch(() => 0n) : Promise.resolve(0n),
    owner ? client.predict.read.balance(owner).catch(() => 0) : Promise.resolve(0),
    wrapperId ? checkObjectExists(wrapperId) : Promise.resolve({ exists: false }),
  ]);

  return {
    plpTotalSupply: rawToUsdc(pool.plpTotalSupply),
    idleUsdc: pool.idleUsdc,
    supplyRequestsPending: pool.supplyRequestsPending,
    withdrawRequestsPending: pool.withdrawRequestsPending,
    userPlpSharesRaw: userPlpRaw,
    userPlpShares: rawToUsdc(userPlpRaw),
    vaultAvailableUsdc: typeof bal === 'number' ? bal : 0,
    hasAccount: accExists.exists,
  };
}

export function buildPredictPlpSupplyTx(params: {
  sender: string;
  amountUsdc: number;
  hasAccount: boolean;
  vaultAvailableUsdc: number;
  referrerWrapperId?: string;
}): Transaction {
  const { sender, amountUsdc, hasAccount, vaultAvailableUsdc, referrerWrapperId } = params;
  const tx = new Transaction();
  tx.setSender(sender);

  const cfg = toGeneratedConfig(MAINNET_CONFIG);
  const accCfg = {
    accountPackageId: MAINNET_CONFIG.packages.account,
    accountRegistry: MAINNET_CONFIG.objects.accountRegistry,
    accountPackageIdLatest: MAINNET_CONFIG.packages.accountLatest,
  };

  const amountRaw = usdcToRaw(amountUsdc);
  const availRaw = usdcToRaw(vaultAvailableUsdc);
  const shortfallRaw = availRaw >= amountRaw ? 0n : amountRaw - availRaw;
  const existingWrapperId = deriveAccountWrapperId(MAINNET_CONFIG, sender);

  let wrapperTarget: any = existingWrapperId;
  if (!hasAccount) {
    wrapperTarget = tx.add(
      referrerWrapperId
        ? accountRegistryMoveCalls.newWithReferrer({
            config: accCfg,
            arguments: { referrer: referrerWrapperId },
          })
        : accountRegistryMoveCalls._new({ config: accCfg })
    );
  }

  if (shortfallRaw > 0n) {
    const coin = coinWithBalance({
      type: MAINNET_CONFIG.quoteCoinType,
      balance: shortfallRaw,
      useGasCoin: false,
    })(tx);
    const authDep = tx.add(generateAuth(MAINNET_CONFIG));
    tx.add(
      accountMoveCalls.depositFunds({
        config: accCfg,
        arguments: { wrapper: wrapperTarget, auth: authDep, coin },
        typeArguments: [MAINNET_CONFIG.quoteCoinType],
      })
    );
  }

  const authPlp = tx.add(generateAuth(MAINNET_CONFIG));
  tx.add(
    plpMoveCalls.requestSupply({
      config: cfg,
      arguments: {
        wrapper: wrapperTarget,
        auth: authPlp,
        amount: amountRaw,
        minPlpOut: 0n,
      },
    })
  );

  if (!hasAccount) {
    tx.add(accountMoveCalls.share({ config: accCfg, arguments: { self: wrapperTarget } }));
  }

  return tx;
}

export function buildPredictPlpWithdrawTx(params: {
  sender: string;
  sharesRaw: bigint;
}): Transaction {
  const client = createPredictClient();
  return client.predict.tx.withdrawPlp(params.sender, params.sharesRaw);
}
