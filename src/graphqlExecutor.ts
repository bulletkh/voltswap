import { SuiGraphQLClient } from '@mysten/sui/graphql';

const gqlClient = new SuiGraphQLClient({
  url: 'https://graphql.mainnet.sui.io/graphql'
});

export async function executeTransactionViaGraphQL({
  bytes,
  signature
}: {
  bytes: string;
  signature: string;
}) {
  const query = `
    mutation ExecuteTx($bytes: Base64!, $signatures: [String!]!) {
      executeTransaction(transactionDataBcs: $bytes, signatures: $signatures) {
        effects {
          status
          digest
          effectsBcs
          executionError {
            message
          }
        }
      }
    }
  `;

  const res = await gqlClient.query({
    query,
    variables: {
      bytes,
      signatures: [signature]
    }
  });

  if (res.errors && res.errors.length > 0) {
    const msg = res.errors.map((e: any) => e.message).join(', ');
    throw new Error(msg);
  }

  const result = res.data?.executeTransaction;
  if (!result || !result.effects) {
    throw new Error('Transaction execution returned no effects');
  }

  if (result.effects.status === 'FAILURE') {
    const errReason = result.effects.executionError?.message || 'Transaction reverted on-chain';
    throw new Error(`Swap failed on-chain: ${errReason}`);
  }

  return {
    digest: result.effects.digest,
    effects: {
      bcs: result.effects.effectsBcs
    }
  };
}
