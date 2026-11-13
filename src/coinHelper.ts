import { Transaction, coinWithBalance } from '@mysten/sui/transactions';

export async function getOwnedCoinObjects(owner: string, coinType: string) {
  const query = `
    query GetCoins($owner: SuiAddress!, $type: String!) {
      address(address: $owner) {
        objects(filter: { type: $type }, first: 50) {
          nodes {
            address
            version
            digest
            contents {
              json
            }
          }
        }
      }
    }
  `;

  // Standard coin type filter
  const targetType = coinType.startsWith('0x2::coin::Coin<') ? coinType : `0x2::coin::Coin<${coinType}>`;

  const res = await fetch('https://graphql.mainnet.sui.io/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      variables: {
        owner,
        type: targetType
      }
    })
  });

  const json = await res.json();
  const nodes = json?.data?.address?.objects?.nodes || [];
  return nodes.map((n: any) => ({
    objectId: n.address,
    version: n.version,
    digest: n.digest,
    balance: BigInt(n.contents?.json?.balance || '0')
  }));
}

/**
 * Resolves an exact input Coin<T> argument for a Sui PTB.
 * Uses owned Coin<T> objects when sufficient, and falls back to the
 * `CoinWithBalance` intent so wallets with SIP-58 Address Balances (e.g. Slush)
 * automatically withdraw from address storage without manual consolidation.
 */
export async function resolveInputCoin(
  txb: Transaction,
  owner: string,
  coinType: string,
  rawNeeded: bigint
) {
  const coinObjects = await getOwnedCoinObjects(owner, coinType);
  const totalSpendable = coinObjects.reduce((acc: bigint, c: any) => acc + c.balance, 0n);

  if (coinObjects.length > 0 && totalSpendable >= rawNeeded) {
    const [primaryCoin, ...otherCoins] = coinObjects.map((c: any) => txb.object(c.objectId));
    if (otherCoins.length > 0) {
      txb.mergeCoins(primaryCoin, otherCoins);
    }
    const [splitCoin] = txb.splitCoins(primaryCoin, [txb.pure.u64(rawNeeded.toString())]);
    return splitCoin;
  }

  // Fallback to CoinWithBalance intent for SIP-58 Address Balance resolution by wallet
  return coinWithBalance({
    type: coinType,
    balance: rawNeeded,
    useGasCoin: false,
  })(txb);
}
