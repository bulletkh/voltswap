import { Transaction } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/bcs';

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
    return 'Leverage exceeds the on-chain Initial Margin Ratio limit for this market. Please lower leverage by 1x and try again.';
  }
  if (abortCode === '30' || msg.includes('end_session_')) {
    return 'Insufficient free margin buffer to cover taker fees and slippage. Try reducing margin amount by ~5% or depositing slightly more USDC.';
  }
  if (msg.includes('InsufficientGas') || msg.includes('InsufficientCoinBalance')) {
    return 'Insufficient SUI for gas fees or insufficient coin balance for this transaction.';
  }
  return msg || (abortCode ? `Smart contract aborted with code ${abortCode}.` : 'Transaction simulation failed.');
}

/**
 * Pre-flight transaction simulation via Sui Mainnet GraphQL before opening the user's wallet.
 * Fails open on network/CORS/unresolved-object errors so valid trades are never blocked,
 * and blocks with a human-readable message only when on-chain execution explicitly returns FAILURE.
 */
export async function simulateTxBeforeWallet(
  txOrJson: Transaction | string,
  options?: { client?: any; sender?: string }
): Promise<PreflightSimResult> {
  try {
    if (typeof txOrJson === 'string') {
      // v2 JSON transactions (e.g. SIP-58 FundsWithdrawal) are signed directly by the wallet
      return { ok: true, skipped: true };
    }

    const clone = Transaction.from(txOrJson.serialize());
    if (options?.sender && !clone.getData().sender) {
      clone.setSender(options.sender);
    }
    clone.setGasPayment([]);
    clone.setGasPrice(1000);
    clone.setGasBudget(50000000);

    const bytes = await clone.build(options?.client ? { client: options.client } : undefined);
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
  } catch (_) {
    return { ok: true, skipped: true };
  }
}
