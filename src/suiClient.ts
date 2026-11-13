import { createDAppKit } from '@mysten/dapp-kit-react';
import { normalizeStructTag, normalizeSuiAddress, isValidSuiAddress } from '@mysten/sui/utils';
import {
  PRIMARY_SUI_GRPC_URL,
  PRIMARY_SUI_GRAPHQL_URL,
  primaryGrpcClient,
  cachedRead,
  invalidateRpcCache,
  rpcFetchGraphql,
  rpcExecuteSignedTransaction,
  rpcListAllOwnedCoins,
  getRpcPoolStats,
  withRawCoreFailover,
} from './suiRpcPool';

export const SUI_MAINNET_GRPC_URL = PRIMARY_SUI_GRPC_URL;
export const SUI_MAINNET_GRAPHQL_URL = PRIMARY_SUI_GRAPHQL_URL;

export const suiGrpcClient = primaryGrpcClient;

export {
  cachedRead,
  invalidateRpcCache,
  rpcFetchGraphql,
  rpcExecuteSignedTransaction,
  rpcListAllOwnedCoins,
  getRpcPoolStats,
  withRawCoreFailover,
};

export const dAppKit = createDAppKit({
  networks: ['mainnet'],
  defaultNetwork: 'mainnet',
  autoConnect: true,
  createClient: () => suiGrpcClient,
  slushWalletConfig: {
    appName: 'Volt Protocol',
  },
});

export const SUI_COIN_TYPE = '0x2::sui::SUI';
export const USDC_COIN_TYPE =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

export function safeNormalizeCoinType(coinType: string): string {
  try {
    return normalizeStructTag(coinType);
  } catch {
    return coinType;
  }
}

export function safeNormalizeAddress(address?: string | null): string | null {
  if (!address) return null;
  const trimmed = address.trim();
  if (!isValidSuiAddress(trimmed)) return null;
  return normalizeSuiAddress(trimmed);
}

/**
 * Extracts the transaction digest from `@mysten/dapp-kit-react` `signAndExecuteTransaction`
 * results and throws a descriptive error if the transaction failed on-chain.
 */
export function extractTxDigest(res: any): string {
  if (!res) throw new Error('Wallet returned an empty transaction response.');

  if (res.$kind === 'FailedTransaction') {
    const failed = res.FailedTransaction;
    const msg =
      failed?.status?.error?.message ||
      failed?.effects?.status?.error ||
      'On-chain transaction execution failed.';
    throw new Error(msg);
  }

  const digest = res?.Transaction?.digest || res?.digest;
  if (!digest) {
    throw new Error('Transaction submitted, but no digest was returned.');
  }
  return String(digest);
}

/**
 * Queries all coin balances owned by `owner` using native gRPC Core API (`listBalances`)
 * and indexes each balance by both normalized struct tag and raw type string.
 */
export async function fetchWalletBalances(owner: string): Promise<Record<string, bigint>> {
  const balances: Record<string, bigint> = {};
  let cursor: string | null | undefined = undefined;
  let pages = 0;

  do {
    const res = await suiGrpcClient.core.listBalances({
      owner,
      limit: 100,
      cursor,
    });
    for (const item of res.balances || []) {
      const amount = BigInt(item.balance || '0');
      const norm = safeNormalizeCoinType(item.coinType);
      balances[norm] = amount;
      balances[item.coinType] = amount;
    }
    cursor = res.hasNextPage ? res.cursor : null;
    pages += 1;
  } while (cursor && pages < 5);

  return balances;
}

export function readBalanceFromMap(
  balances: Record<string, bigint>,
  coinType: string,
  decimals: number
): number {
  const norm = safeNormalizeCoinType(coinType);
  const raw = balances[norm] ?? balances[coinType] ?? 0n;
  return Number(raw) / Math.pow(10, decimals);
}
