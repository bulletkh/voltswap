import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import {
  MAX_SESSIONS_PER_ACCOUNT,
  MAX_SESSION_DURATION_MS,
  SessionsContract,
  getSessionsConfig,
} from '@mysten/deepbook-v3/sessions';
import { accountMoveCalls, accountRegistryMoveCalls } from '@mysten/deepbook-v3/account';
import {
  MAINNET_CONFIG,
  binaryRangeTicks,
  deriveAccountWrapperId,
  deriveQueueId,
  generateAuth,
  predictAccountMoveCalls,
  priceToRaw,
  snapStrike,
  usdcToRaw,
  type ActiveMarket,
} from '@mysten/deepbook-v3/predict';
import {
  extractTxDigest,
  rpcExecuteSignedTransaction,
  safeNormalizeAddress,
  suiGrpcClient,
  SUI_COIN_TYPE,
} from './suiClient';
import { PREDICT_ORDER_USD_MIN, type PredictProtocolStatus } from './deepbookPredict';

const STORAGE_PREFIX = 'volt_db_session_v1_';
const DEFAULT_SESSION_GAS_MIST = 50_000_000n; // 0.05 SUI local gas float for ~15-25 popup-free bets

export interface StoredLocalSessionKey {
  owner: string;
  sessionAddress: string;
  secretKeyBech32: string;
  expiresAtMs: number;
  createdAtMs: number;
}

export interface OnChainSessionGrant {
  session: string;
  expiresAtMs: bigint;
}

export interface SessionStatusSnapshot {
  supported: boolean;
  wrapperId: string;
  localKey: StoredLocalSessionKey | null;
  isAuthorizedOnChain: boolean;
  isActiveNow: boolean;
  onChainExpiresAtMs: number | null;
  sessionGasSui: number;
  activeGrantCount: number;
  expiredGrantCount: number;
  expiredSessionAddresses: string[];
}

export function getSessionsContract(): SessionsContract {
  return new SessionsContract(getSessionsConfig('mainnet'));
}

function getStorageKey(owner: string): string {
  return `${STORAGE_PREFIX}${safeNormalizeAddress(owner) || owner.toLowerCase()}`;
}

export function loadLocalSessionKey(owner: string): StoredLocalSessionKey | null {
  if (typeof window === 'undefined' || !owner) return null;
  try {
    const raw = window.localStorage.getItem(getStorageKey(owner));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredLocalSessionKey;
    if (!parsed?.secretKeyBech32 || !parsed?.sessionAddress) return null;
    // Validate keypair reconstructs cleanly
    const kp = Ed25519Keypair.fromSecretKey(parsed.secretKeyBech32);
    if (safeNormalizeAddress(kp.toSuiAddress()) !== safeNormalizeAddress(parsed.sessionAddress)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveLocalSessionKey(entry: StoredLocalSessionKey): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(getStorageKey(entry.owner), JSON.stringify(entry));
  } catch {
    // ignore storage quota errors
  }
}

export function clearLocalSessionKey(owner: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(getStorageKey(owner));
  } catch {
    // ignore storage errors
  }
}

export function getOrCreateLocalSessionKey(owner: string): {
  record: StoredLocalSessionKey;
  keypair: Ed25519Keypair;
} {
  const existing = loadLocalSessionKey(owner);
  if (existing) {
    const keypair = Ed25519Keypair.fromSecretKey(existing.secretKeyBech32);
    return { record: existing, keypair };
  }
  const keypair = new Ed25519Keypair();
  const normOwner = safeNormalizeAddress(owner) || owner;
  const record: StoredLocalSessionKey = {
    owner: normOwner,
    sessionAddress: safeNormalizeAddress(keypair.toSuiAddress()) || keypair.toSuiAddress(),
    secretKeyBech32: keypair.getSecretKey(),
    expiresAtMs: 0,
    createdAtMs: Date.now(),
  };
  saveLocalSessionKey(record);
  return { record, keypair };
}

export async function fetchSessionStatus(owner: string): Promise<SessionStatusSnapshot> {
  const normOwner = safeNormalizeAddress(owner) || owner;
  const sc = getSessionsContract();
  const wrapperId = sc.deriveAccountWrapperId(normOwner);
  const localKey = loadLocalSessionKey(normOwner);

  let activeGrants: OnChainSessionGrant[] = [];
  let expiredGrants: OnChainSessionGrant[] = [];

  try {
    const fieldId = sc.deriveSessionsFieldId(normOwner);
    const objRes = await suiGrpcClient.core.getObject({
      objectId: fieldId,
      include: { content: true },
    });
    if (objRes.object?.content) {
      const grants = SessionsContract.decodeSessions(objRes.object.content);
      const nowMs = Date.now();
      activeGrants = SessionsContract.activeSessions(grants, nowMs);
      expiredGrants = SessionsContract.expiredSessions(grants, nowMs);
    }
  } catch {
    // Account may not have SessionsData dynamic field created yet
  }

  let sessionGasSui = 0;
  if (localKey) {
    try {
      const bal = await suiGrpcClient.core.getBalance({
        owner: localKey.sessionAddress,
        coinType: SUI_COIN_TYPE,
      });
      const total = BigInt(bal.balance?.balance ?? '0');
      sessionGasSui = Number(total) / 1e9;
    } catch {
      sessionGasSui = 0;
    }
  }

  const matchingActive = localKey
    ? activeGrants.find(
        (g) => safeNormalizeAddress(g.session) === safeNormalizeAddress(localKey.sessionAddress)
      )
    : undefined;

  const onChainExpiresAtMs = matchingActive ? Number(matchingActive.expiresAtMs) : null;
  const isAuthorizedOnChain = Boolean(matchingActive);
  const isActiveNow = Boolean(
    matchingActive && onChainExpiresAtMs !== null && onChainExpiresAtMs > Date.now() + 15_000
  );

  return {
    supported: true,
    wrapperId,
    localKey,
    isAuthorizedOnChain,
    isActiveNow,
    onChainExpiresAtMs,
    sessionGasSui,
    activeGrantCount: activeGrants.length,
    expiredGrantCount: expiredGrants.length,
    expiredSessionAddresses: expiredGrants.map((g) => g.session),
  };
}

/**
 * Builds an atomic wallet transaction to:
 * 1) Create & share Predict AccountWrapper (with Volt native referrer) if missing,
 * 2) Optional USDC top-up into Predict vault,
 * 3) Prune expired session keys if approaching the 20-slot limit,
 * 4) Authorize the browser's ephemeral Ed25519 session key via `SessionsContract.authorizeSession`,
 * 5) Fund the session key with a tiny SUI gas float (default 0.05 SUI) so subsequent Predict trades execute with 0 wallet popups.
 */
export function buildAuthorizePredictSessionTx(params: {
  owner: string;
  sessionAddress: string;
  durationMs: number;
  hasAccount: boolean;
  protocol: PredictProtocolStatus;
  depositUsdc?: number;
  fundGasMist?: bigint;
  expiredSessionsToPrune?: string[];
}): Transaction {
  const {
    owner,
    sessionAddress,
    durationMs,
    hasAccount,
    protocol,
    depositUsdc = 0,
    fundGasMist = DEFAULT_SESSION_GAS_MIST,
    expiredSessionsToPrune = [],
  } = params;

  const clampedDuration = Math.min(
    MAX_SESSION_DURATION_MS,
    Math.max(60_000, Math.round(durationMs))
  );

  const tx = new Transaction();
  tx.setSender(owner);

  const sc = getSessionsContract();
  const accCfg = {
    accountPackageId: MAINNET_CONFIG.packages.account,
    accountRegistry: MAINNET_CONFIG.objects.accountRegistry,
    accountPackageIdLatest: MAINNET_CONFIG.packages.accountLatest,
  };
  const cfg = {
    predictPackageId: MAINNET_CONFIG.packages.predictV1 ?? MAINNET_CONFIG.packages.predict,
    protocolConfig: MAINNET_CONFIG.objects.protocolConfig,
  };

  let wrapperTarget: any = deriveAccountWrapperId(MAINNET_CONFIG, owner);

  if (!hasAccount) {
    wrapperTarget = tx.add(
      protocol.referrerWrapperExists
        ? accountRegistryMoveCalls.newWithReferrer({
            config: accCfg,
            arguments: { referrer: protocol.referrerWrapperId },
          })
        : accountRegistryMoveCalls._new({ config: accCfg })
    );

    if (protocol.builderCodeExists && !protocol.builderFeeCutoverActive) {
      const authBc = tx.add(generateAuth(MAINNET_CONFIG));
      tx.add(
        predictAccountMoveCalls.setBuilderCode({
          config: cfg as any,
          arguments: { wrapper: wrapperTarget, auth: authBc, code: protocol.builderCodeId },
        })
      );
    }
  } else {
    // Prune expired slots cleanly before adding new session if near MAX_SESSIONS_PER_ACCOUNT
    const toPrune = expiredSessionsToPrune.slice(0, Math.max(0, MAX_SESSIONS_PER_ACCOUNT - 1));
    for (const staleAddr of toPrune.slice(0, 6)) {
      tx.add(sc.revokeSession({ wrapperId: wrapperTarget, session: staleAddr }));
    }
  }

  if (depositUsdc > 0 && Number.isFinite(depositUsdc)) {
    const depRaw = usdcToRaw(depositUsdc);
    if (depRaw > 0n) {
      const coin = coinWithBalance({
        type: MAINNET_CONFIG.quoteCoinType,
        balance: depRaw,
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
  }

  tx.add(
    sc.authorizeSession({
      wrapperId: wrapperTarget,
      session: sessionAddress,
      durationMs: clampedDuration,
    })
  );

  if (fundGasMist > 0n) {
    const [gasFloatCoin] = tx.splitCoins(tx.gas, [fundGasMist]);
    tx.transferObjects([gasFloatCoin], sessionAddress);
  }

  if (!hasAccount) {
    tx.add(accountMoveCalls.share({ config: accCfg, arguments: { self: wrapperTarget } }));
  }

  return tx;
}

/**
 * Revokes an on-chain session grant (owner wallet signature required).
 */
export function buildRevokePredictSessionTx(params: {
  owner: string;
  sessionAddresses: string[];
}): Transaction {
  const { owner, sessionAddresses } = params;
  const sc = getSessionsContract();
  const wrapperId = sc.deriveAccountWrapperId(owner);
  const tx = new Transaction();
  tx.setSender(owner);
  for (const addr of sessionAddresses.slice(0, 10)) {
    tx.add(sc.revokeSession({ wrapperId, session: addr }));
  }
  return tx;
}

/**
 * Builds a Predict `enqueueExactCost` order PTB signed solely by the ephemeral session key
 * (0 wallet popups). Requires funded internal Predict USDC balance in the AccountWrapper.
 */
export function buildSessionPredictBetTx(params: {
  owner: string;
  sessionAddress: string;
  market: ActiveMarket;
  side: 'up' | 'down' | 'range';
  strike?: number;
  lowerStrike?: number;
  upperStrike?: number;
  maxCostRaw: bigint;
  minQuantityRaw: bigint;
}): Transaction {
  const {
    owner,
    sessionAddress,
    market,
    side,
    strike,
    lowerStrike,
    upperStrike,
    maxCostRaw,
    minQuantityRaw,
  } = params;

  const sc = getSessionsContract();
  const wrapperId = sc.deriveAccountWrapperId(owner);
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

  const tx = new Transaction();
  tx.setSender(sessionAddress);
  tx.add(
    sc.enqueueExactCost({
      wrapperId,
      expiryMarketId: market.id,
      queueRegistry: MAINNET_CONFIG.objects.queueRegistry ?? '',
      queueId,
      orderDesk: MAINNET_CONFIG.objects.orderDesk ?? '',
      protocolConfig: MAINNET_CONFIG.objects.protocolConfig,
      oracleRegistry: MAINNET_CONFIG.objects.oracleRegistry,
      pythFeed: u.pythFeed,
      blockScholesValueStore: u.blockScholesValueStore,
      blockScholesSviStore: u.blockScholesSviStore,
      lowerTick,
      higherTick,
      maxCost: maxCostRaw,
      minQuantity: minQuantityRaw,
    })
  );

  return tx;
}

/**
 * Signs and submits a transaction directly using the ephemeral local Ed25519 session keypair
 * without opening the user's browser wallet extension.
 */
export async function executeWithLocalSessionKey(
  tx: Transaction,
  owner: string
): Promise<{ digest: string; sessionAddress: string }> {
  const existing = loadLocalSessionKey(owner);
  if (!existing) {
    throw new Error('No active local session key found. Authorize 1-Click Session first.');
  }
  const keypair = Ed25519Keypair.fromSecretKey(existing.secretKeyBech32);
  const sessionAddr = safeNormalizeAddress(keypair.toSuiAddress()) || keypair.toSuiAddress();
  tx.setSender(sessionAddr);

  const builtBytes = await tx.build({ client: suiGrpcClient });
  const { signature } = await keypair.signTransaction(builtBytes);
  const res = await rpcExecuteSignedTransaction({
    transaction: builtBytes,
    signatures: [signature],
  });
  const digest = extractTxDigest(res);
  if (!digest) {
    throw new Error('Session transaction submitted without a digest response.');
  }
  return { digest, sessionAddress: sessionAddr };
}

/**
 * Sweeps leftover SUI gas float from the local ephemeral session key back to the owner wallet
 * without requiring a popup from the main wallet.
 */
export async function reclaimSessionGasFloat(owner: string): Promise<string | null> {
  const existing = loadLocalSessionKey(owner);
  if (!existing) return null;
  const keypair = Ed25519Keypair.fromSecretKey(existing.secretKeyBech32);
  const sessionAddr = keypair.toSuiAddress();
  const bal = await suiGrpcClient.core.getBalance({
    owner: sessionAddr,
    coinType: SUI_COIN_TYPE,
  });
  const total = BigInt(bal.balance?.balance ?? '0');
  if (total < 3_000_000n) return null; // Not enough above gas (~0.003 SUI) to reclaim

  const tx = new Transaction();
  tx.setSender(sessionAddr);
  tx.transferObjects([tx.gas], safeNormalizeAddress(owner) || owner);
  const builtBytes = await tx.build({ client: suiGrpcClient });
  const { signature } = await keypair.signTransaction(builtBytes);
  const res = await rpcExecuteSignedTransaction({
    transaction: builtBytes,
    signatures: [signature],
  });
  return extractTxDigest(res) || null;
}

export { MAX_SESSION_DURATION_MS, PREDICT_ORDER_USD_MIN };
