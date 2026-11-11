export async function getOwnedCoinObjects(owner: string, coinType: string) {
  const query = `
    query GetCoins($owner: SuiAddress!, $type: String!) {
      address(address: $owner) {
        objects(filter: { type: $type }) {
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
