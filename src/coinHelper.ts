import { Transaction } from '@mysten/sui/transactions';

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

interface Sip58RedeemEntry {
  cmdIdx: number;
  coinType: string;
  amount: bigint;
}

/**
 * Resolves an exact input Coin<T> argument for a Sui PTB.
 * Uses owned Coin<T> objects when sufficient. When part of the balance
 * lives in Sui SIP-58 Address Balance, inserts a placeholder MoveCall
 * merged with any owned Coin<T> objects; `finalizeTxForWallet` then
 * rewrites the placeholder into a `FundsWithdrawal` + `0x2::coin::redeem_funds`
 * call so wallets like Slush spend SIP-58 balances seamlessly.
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

  const abNeeded = rawNeeded - totalSpendable;
  const cmdIdx = txb.getData().commands.length;
  const [abCoin] = txb.moveCall({
    target: '0x2::coin::zero',
    typeArguments: [coinType],
  });

  if (coinObjects.length > 0) {
    const ownedRefs = coinObjects.map((c: any) => txb.object(c.objectId));
    txb.mergeCoins(abCoin, ownedRefs);
  }

  const redeems: Sip58RedeemEntry[] = (txb as any).__sip58Redeems || [];
  redeems.push({ cmdIdx, coinType, amount: abNeeded });
  (txb as any).__sip58Redeems = redeems;

  return abCoin;
}

/**
 * Converts a Transaction into a wallet-ready payload. If any SIP-58
 * address-balance redeems were queued by `resolveInputCoin`, serializes
 * to v2 JSON and patches in the `FundsWithdrawal` inputs + `0x2::coin::redeem_funds`.
 */
export async function finalizeTxForWallet(txb: Transaction, client: any): Promise<any> {
  const redeems: Sip58RedeemEntry[] | undefined = (txb as any).__sip58Redeems;
  if (!redeems || redeems.length === 0) {
    return txb;
  }

  const jsonStr = await txb.toJSON({ client });
  const txJson = JSON.parse(jsonStr);

  for (const r of redeems) {
    const inputIdx = txJson.inputs.length;
    txJson.inputs.push({
      FundsWithdrawal: {
        reservation: { MaxAmountU64: r.amount.toString() },
        typeArg: { Balance: r.coinType },
        withdrawFrom: { Sender: true },
      },
    });
    txJson.commands[r.cmdIdx] = {
      MoveCall: {
        package: '0x0000000000000000000000000000000000000000000000000000000000000002',
        module: 'coin',
        function: 'redeem_funds',
        typeArguments: [r.coinType],
        arguments: [{ Input: inputIdx }],
      },
    };
  }

  return JSON.stringify(txJson);
}
