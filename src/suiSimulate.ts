import { Transaction } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import { suiGrpcClient } from './suiClient';

const SUI_GRAPHQL_URL = 'https://graphql.mainnet.sui.io/graphql';

export interface PreflightSimResult {
  ok: boolean;
  skipped?: boolean;
  errorMessage?: string;
  rawError?: string;
}

export function formatMoveAbortError(rawMsg: string, abortCode?: string | null): string {
  const msg = rawMsg || '';
  if (abortCode === '2003' || msg.includes('set_initial_margin_ratio')) {
    return 'Leverage exceeds the on-chain Initial Margin Ratio limit for this market. Lower leverage by 1x and retry.';
  }
  if (abortCode === '30' || msg.includes('end_session_')) {
    return 'Insufficient free margin buffer for taker fees and slippage. Reduce order size by ~5% or deposit USDC.';
  }
  if (abortCode === '41' || msg.includes('position')) {
    return 'Market position state mismatch on-chain. Refreshing account state automatically — please retry.';
  }
  if (msg.includes('InsufficientGas') || msg.includes('InsufficientCoinBalance')) {
    return 'Insufficient SUI for gas or insufficient token balance for this transaction.';
  }
  return (
    msg ||
    (abortCode
      ? `Smart contract aborted with code ${abortCode}.`
      : 'Transaction simulation failed.')
  );
}

/**
 * Pre-flight transaction simulation before triggering the user's wallet popup.
 * Uses native gRPC Core `simulateTransaction` on `Transaction` instances and falls back
 * to Sui Mainnet GraphQL if needed. Fails open on transient RPC errors so valid txs are never blocked.
 */
export async function simulateTxBeforeWallet(
  txOrJson: Transaction | string,
  options?: { sender?: string }
): Promise<PreflightSimResult> {
  try {
    if (typeof txOrJson === 'string') {
      return { ok: true, skipped: true };
    }

    const resolvedJson = await txOrJson.toJSON({ client: suiGrpcClient });
    const clone = Transaction.from(resolvedJson);
    if (options?.sender && !clone.getData().sender) {
      clone.setSender(options.sender);
    }

    try {
      const sim = await suiGrpcClient.core.simulateTransaction({
        transaction: clone,
      });
      if (sim.$kind === 'FailedTransaction') {
        const failed = sim.FailedTransaction;
        const raw = failed?.status?.error?.message || 'Transaction failed during simulation.';
        return {
          ok: false,
          errorMessage: formatMoveAbortError(raw),
          rawError: raw,
        };
      }
      return { ok: true };
    } catch {
      // Fallback to GraphQL JSON simulation if client build hits unresolved gas/object edge case
    }

    clone.setGasPayment([]);
    clone.setGasPrice(1000);
    clone.setGasBudget(50_000_000);
    const bytes = await clone.build({ client: suiGrpcClient });
    const b64 = toBase64(bytes);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    try {
      const res = await fetch(SUI_GRAPHQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          query: `query($tx: JSON!) {
            simulateTransaction(transaction: $tx, doGasSelection: true) {
              effects {
                status
                executionError {
                  abortCode
                  message
                }
              }
            }
          }`,
          variables: { tx: { bcs: { value: b64 } } },
        }),
      });
      if (!res.ok) return { ok: true, skipped: true };
      const json = await res.json();
      const effects = json?.data?.simulateTransaction?.effects;
      if (!effects) return { ok: true, skipped: true };

      if (effects.status === 'FAILURE') {
        const execErr = effects.executionError;
        const raw = execErr?.message || '';
        const code = execErr?.abortCode ? String(execErr.abortCode) : null;
        return {
          ok: false,
          errorMessage: formatMoveAbortError(raw, code),
          rawError: raw,
        };
      }
      return { ok: true };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return { ok: true, skipped: true };
  }
}
