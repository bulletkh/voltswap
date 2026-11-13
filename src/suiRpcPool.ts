import { SuiGrpcClient } from '@mysten/sui/grpc';
import { SuiGraphQLClient } from '@mysten/sui/graphql';
import type { Transaction } from '@mysten/sui/transactions';

export type RpcProtocolKind = 'grpc' | 'graphql';

export interface RpcEndpointHealth {
  id: string;
  label: string;
  kind: RpcProtocolKind;
  url: string;
  latencyMs: number;
  successCount: number;
  errorCount: number;
  cooldownUntilMs: number;
  lastError: string | null;
  lastOkAtMs: number;
}

export type UnifiedCoreClient = SuiGrpcClient | SuiGraphQLClient;

function parseEnvUrlList(key: string): string[] {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> })?.env;
    const raw = env?.[key];
    if (!raw || typeof raw !== 'string') return [];
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.startsWith('http://') || s.startsWith('https://'));
  } catch {
    return [];
  }
}

const CUSTOM_GRPC_URLS = parseEnvUrlList('VITE_SUI_GRPC_URLS');
const CUSTOM_GRAPHQL_URLS = parseEnvUrlList('VITE_SUI_GRAPHQL_URLS');

const GRPC_URLS = Array.from(
  new Set([
    ...CUSTOM_GRPC_URLS,
    'https://fullnode.mainnet.sui.io:443',
  ])
);

const GRAPHQL_URLS = Array.from(
  new Set([
    ...CUSTOM_GRAPHQL_URLS,
    'https://graphql.mainnet.sui.io/graphql',
  ])
);

export const PRIMARY_SUI_GRPC_URL = GRPC_URLS[0];
export const PRIMARY_SUI_GRAPHQL_URL = GRAPHQL_URLS[0];

interface PoolNode {
  health: RpcEndpointHealth;
  client: UnifiedCoreClient;
  rawCore: {
    listBalances: SuiGrpcClient['core']['listBalances'];
    listCoins: SuiGrpcClient['core']['listCoins'];
    listOwnedObjects: SuiGrpcClient['core']['listOwnedObjects'];
    getCoinMetadata: SuiGrpcClient['core']['getCoinMetadata'];
    getObject: SuiGrpcClient['core']['getObject'];
    getObjects: SuiGrpcClient['core']['getObjects'];
    getTransaction: SuiGrpcClient['core']['getTransaction'];
    listDynamicFields: SuiGrpcClient['core']['listDynamicFields'];
    simulateTransaction: SuiGrpcClient['core']['simulateTransaction'];
    executeTransaction: SuiGrpcClient['core']['executeTransaction'];
  };
}

function captureRawCore(client: UnifiedCoreClient): PoolNode['rawCore'] {
  return {
    listBalances: client.core.listBalances.bind(client.core),
    listCoins: client.core.listCoins.bind(client.core),
    listOwnedObjects: client.core.listOwnedObjects.bind(client.core),
    getCoinMetadata: client.core.getCoinMetadata.bind(client.core),
    getObject: client.core.getObject.bind(client.core),
    getObjects: client.core.getObjects.bind(client.core),
    getTransaction: client.core.getTransaction.bind(client.core),
    listDynamicFields: client.core.listDynamicFields.bind(client.core),
    simulateTransaction: client.core.simulateTransaction.bind(client.core),
    executeTransaction: client.core.executeTransaction.bind(client.core),
  };
}

const POOL_NODES: PoolNode[] = [
  ...GRPC_URLS.map((url, idx) => {
    const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: url });
    return {
      health: {
        id: `grpc-${idx}`,
        label: idx === 0 && !CUSTOM_GRPC_URLS.length ? 'Mysten gRPC' : `Sui gRPC #${idx + 1}`,
        kind: 'grpc' as const,
        url,
        latencyMs: 0,
        successCount: 0,
        errorCount: 0,
        cooldownUntilMs: 0,
        lastError: null,
        lastOkAtMs: 0,
      },
      client,
      rawCore: captureRawCore(client),
    };
  }),
  ...GRAPHQL_URLS.map((url, idx) => {
    const client = new SuiGraphQLClient({ network: 'mainnet', url });
    return {
      health: {
        id: `gql-${idx}`,
        label: idx === 0 && !CUSTOM_GRAPHQL_URLS.length ? 'Mysten GraphQL' : `Sui GraphQL #${idx + 1}`,
        kind: 'graphql' as const,
        url,
        latencyMs: 0,
        successCount: 0,
        errorCount: 0,
        cooldownUntilMs: 0,
        lastError: null,
        lastOkAtMs: 0,
      },
      client,
      rawCore: captureRawCore(client),
    };
  }),
];

export const primaryGrpcClient = POOL_NODES.find((n) => n.health.kind === 'grpc')!
  .client as SuiGrpcClient;
export const primaryGraphqlClient = POOL_NODES.find((n) => n.health.kind === 'graphql')!
  .client as SuiGraphQLClient;

interface CacheEntry<T> {
  value?: T;
  expiresAtMs: number;
  inFlight?: Promise<T>;
}

const READ_CACHE = new Map<string, CacheEntry<unknown>>();
const MAX_CACHE_ENTRIES = 260;

function pruneCacheIfNeeded() {
  if (READ_CACHE.size <= MAX_CACHE_ENTRIES) return;
  const now = Date.now();
  for (const [k, v] of READ_CACHE.entries()) {
    if (!v.inFlight && v.expiresAtMs <= now) {
      READ_CACHE.delete(k);
    }
  }
  while (READ_CACHE.size > MAX_CACHE_ENTRIES) {
    const oldest = READ_CACHE.keys().next().value;
    if (!oldest) break;
    READ_CACHE.delete(oldest);
  }
}

export function invalidateRpcCache(prefix?: string): void {
  if (!prefix) {
    READ_CACHE.clear();
    return;
  }
  for (const key of READ_CACHE.keys()) {
    if (key.startsWith(prefix)) {
      READ_CACHE.delete(key);
    }
  }
}

/**
 * Deduplicates concurrent identical reads and caches fulfilled results for `ttlMs`.
 * Set `ttlMs = 0` to deduplicate strictly in-flight callers without caching stale values.
 */
export async function cachedRead<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const existing = READ_CACHE.get(key) as CacheEntry<T> | undefined;
  if (existing) {
    if (existing.inFlight) return existing.inFlight;
    if (ttlMs > 0 && existing.value !== undefined && existing.expiresAtMs > now) {
      return existing.value;
    }
  }

  const inFlight = loader()
    .then((value) => {
      if (ttlMs > 0) {
        READ_CACHE.set(key, {
          value,
          expiresAtMs: Date.now() + ttlMs,
        });
        pruneCacheIfNeeded();
      } else {
        READ_CACHE.delete(key);
      }
      return value;
    })
    .catch((err) => {
      const curr = READ_CACHE.get(key);
      if (curr?.inFlight === inFlight) {
        READ_CACHE.delete(key);
      }
      throw err;
    });

  READ_CACHE.set(key, {
    expiresAtMs: now + ttlMs,
    inFlight,
    value: existing?.value,
  });
  return inFlight;
}

function isDeterministicDomainError(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (name === 'ObjectError' && /notFound|not found/i.test(msg)) return true;
  if (name === 'TransactionError' && /notFound|not found/i.test(msg)) return true;
  if (/MoveAbort|InsufficientCoinBalance|InsufficientBalance|CommandArgumentError|TypeArgumentError/i.test(msg)) {
    return true;
  }
  return false;
}

function getOrderedNodes(preferKind?: RpcProtocolKind): PoolNode[] {
  const now = Date.now();
  return [...POOL_NODES].sort((a, b) => {
    const aCooling = a.health.cooldownUntilMs > now ? 1 : 0;
    const bCooling = b.health.cooldownUntilMs > now ? 1 : 0;
    if (aCooling !== bCooling) return aCooling - bCooling;

    if (preferKind) {
      const aMatch = a.health.kind === preferKind ? 0 : 1;
      const bMatch = b.health.kind === preferKind ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
    }

    const aLat = a.health.latencyMs > 0 ? a.health.latencyMs : a.health.kind === 'grpc' ? 200 : 350;
    const bLat = b.health.latencyMs > 0 ? b.health.latencyMs : b.health.kind === 'grpc' ? 200 : 350;
    return aLat - bLat;
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export interface FailoverOptions {
  prefer?: RpcProtocolKind;
  timeoutMs?: number;
  allowKinds?: RpcProtocolKind[];
}

/**
 * Executes a Sui Core API call across healthy RPC endpoints using their raw (unwrapped)
 * `.core` adapters so automatic protocol failover (gRPC <-> GraphQL), latency EMA scoring,
 * and transient error cooldowns never recurse.
 */
export async function withRawCoreFailover<T>(
  opName: string,
  fn: (rawCore: PoolNode['rawCore'], node: PoolNode) => Promise<T>,
  options: FailoverOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 9_000;
  let nodes = getOrderedNodes(options.prefer ?? 'grpc');
  if (options.allowKinds?.length) {
    nodes = nodes.filter((n) => options.allowKinds!.includes(n.health.kind));
  }

  let lastErr: unknown;
  for (const node of nodes) {
    const t0 = Date.now();
    try {
      const result = await withTimeout(
        fn(node.rawCore, node),
        timeoutMs,
        `${opName}@${node.health.label}`
      );
      const dt = Math.max(1, Date.now() - t0);
      node.health.latencyMs =
        node.health.latencyMs > 0 ? Math.round(node.health.latencyMs * 0.7 + dt * 0.3) : dt;
      node.health.successCount += 1;
      node.health.cooldownUntilMs = 0;
      node.health.lastError = null;
      node.health.lastOkAtMs = Date.now();
      return result;
    } catch (err) {
      lastErr = err;
      if (isDeterministicDomainError(err)) {
        // Pruned gRPC fullnodes do not keep older checkpoints; fail over to archival GraphQL.
        if (opName === 'getTransaction' && node.health.kind === 'grpc') {
          continue;
        }
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      node.health.errorCount += 1;
      node.health.lastError = msg.slice(0, 140);
      const backoffMs = Math.min(45_000, 10_000 * Math.min(4, node.health.errorCount));
      node.health.cooldownUntilMs = Date.now() + backoffMs;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${opName} failed across all Sui RPC endpoints`);
}

// Install transparent failover + in-flight deduplication on `primaryGrpcClient.core` so
// every reader (`dAppKit`, `@mysten/deepbook-v3`, Cetus Aggregator, Portfolio, etc.) inherits
// resilient Multi-RPC routing without changing its interface.
(function installTransparentFailover() {
  const core = primaryGrpcClient.core as unknown as Record<string, (...args: any[]) => Promise<any>>;

  core.listBalances = (opts) => {
    const key = `listBalances:${opts?.owner || ''}:${opts?.cursor || ''}:${opts?.limit || ''}`;
    return cachedRead(key, 3_000, () =>
      withRawCoreFailover('listBalances', (raw) => raw.listBalances(opts))
    );
  };

  core.listCoins = (opts) => {
    const key = `listCoins:${opts?.owner || ''}:${opts?.coinType || ''}:${opts?.cursor || ''}:${opts?.limit || ''}`;
    return cachedRead(key, 0, () =>
      withRawCoreFailover('listCoins', (raw) => raw.listCoins(opts))
    );
  };

  core.listOwnedObjects = (opts) => {
    const key = `listOwnedObjects:${opts?.owner || ''}:${opts?.type || ''}:${opts?.cursor || ''}:${opts?.limit || ''}`;
    return cachedRead(key, 0, () =>
      withRawCoreFailover('listOwnedObjects', (raw) => raw.listOwnedObjects(opts))
    );
  };

  core.getCoinMetadata = (opts) => {
    const key = `coinMeta:${opts?.coinType || ''}`;
    return cachedRead(key, 60_000, () =>
      withRawCoreFailover('getCoinMetadata', (raw) => raw.getCoinMetadata(opts))
    );
  };

  core.getObject = (opts) => {
    const key = `getObject:${opts?.objectId || ''}:${JSON.stringify(opts?.include || {})}`;
    return cachedRead(key, 0, () =>
      withRawCoreFailover('getObject', (raw) => raw.getObject(opts))
    );
  };

  core.getObjects = (opts) => {
    const key = `getObjects:${(opts?.objectIds || []).join(',')}:${JSON.stringify(opts?.include || {})}`;
    return cachedRead(key, 0, () =>
      withRawCoreFailover('getObjects', (raw) => raw.getObjects(opts))
    );
  };

  core.listDynamicFields = (opts) => {
    const key = `listDynamicFields:${opts?.parentId || ''}:${opts?.cursor || ''}:${opts?.limit || ''}`;
    return cachedRead(key, 3_000, () =>
      withRawCoreFailover('listDynamicFields', (raw) => raw.listDynamicFields(opts))
    );
  };

  core.getTransaction = (opts) => {
    const key = `getTransaction:${opts?.digest || ''}`;
    return cachedRead(key, 10_000, () =>
      withRawCoreFailover('getTransaction', (raw) => raw.getTransaction(opts))
    );
  };

  core.simulateTransaction = (opts) =>
    withRawCoreFailover('simulateTransaction', (raw) => raw.simulateTransaction(opts));
})();

export async function rpcFetchGraphql<T = Record<string, unknown>>(
  query: string,
  variables?: Record<string, unknown>,
  cacheKey?: string,
  ttlMs = 4_000
): Promise<T> {
  const run = async (): Promise<T> => {
    const nodes = getOrderedNodes('graphql').filter((n) => n.health.kind === 'graphql');
    let lastErr: unknown;
    for (const node of nodes) {
      const t0 = Date.now();
      try {
        const res = await withTimeout(
          fetch(node.health.url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(variables ? { query, variables } : { query }),
          }),
          8_500,
          `GraphQL@${node.health.label}`
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} from ${node.health.label}`);
        }
        const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
        if (json.errors?.length && !json.data) {
          throw new Error(json.errors[0].message);
        }
        const dt = Math.max(1, Date.now() - t0);
        node.health.latencyMs =
          node.health.latencyMs > 0 ? Math.round(node.health.latencyMs * 0.7 + dt * 0.3) : dt;
        node.health.successCount += 1;
        node.health.cooldownUntilMs = 0;
        node.health.lastError = null;
        node.health.lastOkAtMs = Date.now();
        return (json.data ?? {}) as T;
      } catch (err) {
        lastErr = err;
        node.health.errorCount += 1;
        node.health.lastError = (err instanceof Error ? err.message : String(err)).slice(0, 140);
        node.health.cooldownUntilMs = Date.now() + 15_000;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('GraphQL failover failed');
  };

  if (cacheKey && ttlMs > 0) {
    return cachedRead<T>(`gql:${cacheKey}`, ttlMs, run);
  }
  return run();
}

export async function rpcSimulateTransaction(tx: Transaction) {
  return withRawCoreFailover(
    'simulateTransaction',
    (raw) =>
      raw.simulateTransaction({
        transaction: tx,
        include: { effects: true, balanceChanges: true, commandResults: true },
      }),
    { prefer: 'grpc', timeoutMs: 9_000 }
  );
}

export async function rpcExecuteSignedTransaction(params: {
  transaction: Uint8Array;
  signatures: string[];
}) {
  const res = await withRawCoreFailover(
    'executeTransaction',
    (raw) =>
      raw.executeTransaction({
        transaction: params.transaction,
        signatures: params.signatures,
        include: { effects: true, balanceChanges: true },
      }),
    { prefer: 'grpc', timeoutMs: 12_000 }
  );
  invalidateRpcCache('listBalances:');
  return res;
}

export interface OwnedCoinObject {
  objectId: string;
  version: string;
  digest: string;
  coinType: string;
  balance: bigint;
}

export function extractCoinTypeFromStruct(structType: string): string | null {
  const m = structType.match(/::coin::Coin<(.+)>$/);
  return m ? m[1] : null;
}

export async function rpcListAllOwnedCoins(owner: string, maxPages = 8): Promise<OwnedCoinObject[]> {
  const all: OwnedCoinObject[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    const res = await withRawCoreFailover('listOwnedObjects', (raw) =>
      raw.listOwnedObjects({
        owner,
        type: '0x2::coin::Coin',
        limit: 50,
        cursor: cursor ?? undefined,
        include: { json: true },
      })
    );
    for (const obj of res.objects ?? []) {
      const coinType = extractCoinTypeFromStruct(obj.type);
      if (!coinType) continue;
      const rawBal = (obj.json as Record<string, unknown> | null | undefined)?.balance;
      let bal = 0n;
      try {
        if (typeof rawBal === 'string' || typeof rawBal === 'number' || typeof rawBal === 'bigint') {
          bal = BigInt(rawBal);
        }
      } catch {
        bal = 0n;
      }
      all.push({
        objectId: obj.objectId,
        version: obj.version,
        digest: obj.digest,
        coinType,
        balance: bal,
      });
    }
    if (!res.hasNextPage || !res.cursor) break;
    cursor = res.cursor;
  }
  return all;
}

export function getRpcPoolStats(): {
  activeEndpoint: RpcEndpointHealth;
  endpoints: RpcEndpointHealth[];
  cacheEntries: number;
} {
  const ordered = getOrderedNodes('grpc');
  return {
    activeEndpoint: { ...ordered[0].health },
    endpoints: ordered.map((n) => ({ ...n.health })),
    cacheEntries: READ_CACHE.size,
  };
}
