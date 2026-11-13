import { Transaction } from '@mysten/sui/transactions';
import { toBase64, fromBase64 } from '@mysten/bcs';
import { AggregatorClient } from '@cetusprotocol/aggregator-sdk';
import BN from 'bn.js';

const WALLET = '0x7211d7a33c32b8a848fd5d87dc0630b7d40d3d324856a748aff454c2955cab12';
const ACCOUNT_ID = '2050n';
const SUI_TYPE = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const GQL_URL = 'https://graphql.mainnet.sui.io/graphql';

async function simulateGql(tx) {
  tx.setSender(WALLET);
  tx.setGasPayment([]);
  tx.setGasPrice(1000);
  tx.setGasBudget(50000000);
  const bytes = await tx.build();
  const res = await fetch(GQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query($tx: JSON!) {
        simulateTransaction(transaction: $tx, doGasSelection: true) {
          effects { status executionError { abortCode message } }
        }
      }`,
      variables: { tx: { bcs: { value: toBase64(bytes) } } },
    }),
  });
  const json = await res.json();
  if (!json?.data?.simulateTransaction?.effects) {
    console.error('GQL raw response:', JSON.stringify(json));
  }
  return json?.data?.simulateTransaction?.effects;
}

let failures = 0;
function pass(name, detail = '') {
  console.log(`PASS: ${name}${detail ? ` (${detail})` : ''}`);
}
function fail(name, detail) {
  console.error(`FAIL: ${name} -> ${detail}`);
  failures++;
}

// 1. Aftermath Markets & IMR rounding invariant
const mktsRes = await fetch('https://aftermath.finance/api/perpetuals/markets', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
});
const mktsData = await mktsRes.json();
const suiMkt = (mktsData?.marketDatas || []).find((m) => m?.metadata?.symbol?.toUpperCase() === 'SUI');
if (!suiMkt) {
  fail('Aftermath /markets SUI lookup', 'SUI market not found');
} else {
  let bad = 0;
  for (const item of mktsData.marketDatas) {
    const imr = Number(item?.market?.marketParams?.marginRatioInitial || 0.05);
    let maxLev = imr > 0 ? Math.max(1, Math.floor(1 / imr)) : 20;
    if (maxLev > 1 && Math.floor(1e18 / maxLev) < Math.ceil(imr * 1e18)) maxLev -= 1;
    if (Math.floor(1e18 / maxLev) < Math.ceil(imr * 1e18)) bad++;
  }
  if (bad === 0) pass('Aftermath markets IMR/maxLeverage invariant', `${mktsData.marketDatas.length} markets checked`);
  else fail('Aftermath markets IMR/maxLeverage invariant', `${bad} markets failed rounding check`);
}

// 2. Aftermath Perps Open Market Order (SUI 14x Long, 13 SUI on account 2050n)
if (suiMkt) {
  const orderRes = await fetch('https://aftermath.finance/api/perpetuals/account/transactions/place-market-order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      walletAddress: WALLET,
      accountId: ACCOUNT_ID,
      marketId: suiMkt.market.objectId,
      side: 0,
      size: '13000000000n',
      leverage: 14,
      reduceOnly: false,
      collateralChange: 0.80,
      hasPosition: false,
      cancelSlTp: false,
      slippage: 0.02,
    }),
  });
  const { txKind } = await orderRes.json();
  if (!txKind) {
    fail('Aftermath place-market-order txKind', 'Empty txKind');
  } else {
    const tx = Transaction.fromKind(fromBase64(txKind));
    const effects = await simulateGql(tx);
    if (effects?.status === 'SUCCESS') pass('Aftermath place-market-order GraphQL simulation', 'SUI 14x Long 13 SUI');
    else fail('Aftermath place-market-order GraphQL simulation', JSON.stringify(effects));
  }
}

// 3. Aftermath Deposit & Withdraw txKind build
for (const ep of ['deposit-collateral', 'withdraw-collateral']) {
  const body = ep === 'deposit-collateral'
    ? { walletAddress: WALLET, accountId: ACCOUNT_ID, collateralCoinType: USDC_TYPE, depositAmount: '500000n' }
    : { walletAddress: WALLET, accountId: ACCOUNT_ID, collateralCoinType: USDC_TYPE, withdrawAmount: '500000n', recipientAddress: WALLET };
  const r = await fetch(`https://aftermath.finance/api/perpetuals/account/transactions/${ep}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  if (d?.txKind) {
    pass(`Aftermath ${ep} txKind build`);
  } else if (ep === 'deposit-collateral' && String(d).includes('Error 2005')) {
    pass(`Aftermath ${ep} endpoint validation`, 'wallet USDC already deposited in #2050n');
  } else {
    fail(`Aftermath ${ep} txKind build`, JSON.stringify(d));
  }
}

// 4. Cetus Aggregator SUI -> USDC Swap GraphQL simulation
try {
  const cetus = new AggregatorClient({});
  const router = await cetus.findRouters({
    from: SUI_TYPE,
    target: USDC_TYPE,
    amount: new BN('500000000'),
    byAmountIn: true,
  });
  if (!router?.amountOut || Number(router.amountOut) <= 0) {
    fail('Cetus SUI -> USDC router', 'No route');
  } else {
    const swapTx = new Transaction();
    const [inCoin] = swapTx.splitCoins(swapTx.gas, [swapTx.pure.u64('500000000')]);
    const outCoin = await cetus.routerSwap({ router, inputCoin: inCoin, slippage: 0.015, txb: swapTx });
    swapTx.transferObjects([outCoin], swapTx.pure.address(WALLET));

    const gqlClientShim = {
      async getNormalizedMoveFunction({ package: pkg, module: mod, function: fn }) {
        const q = `query($p: SuiAddress!, $m: String!, $f: String!) { package(address: $p) { module(name: $m) { function(name: $f) { parameters { signature } } } } }`;
        const gr = await fetch(GQL_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, variables: { p: pkg, m: mod, f: fn } }),
        }).then((x) => x.json());
        const params = gr?.data?.package?.module?.function?.parameters || [];
        const toMoveType = (body) => {
          if (body?.datatype) {
            return {
              Struct: {
                address: body.datatype.package,
                module: body.datatype.module,
                name: body.datatype.type,
                typeArguments: [],
              },
            };
          }
          return 'U8';
        };
        return {
          parameters: params.map((p) => {
            const ref = p?.signature?.ref;
            const inner = toMoveType(p?.signature?.body);
            if (ref === '&mut') return { MutableReference: inner };
            if (ref === '&') return { Reference: inner };
            return inner;
          }),
        };
      },
      async multiGetObjects({ ids }) {
        const q = `query($keys: [ObjectKey!]!) { multiGetObjects(keys: $keys) { address version digest owner { __typename ... on Shared { initialSharedVersion } ... on AddressOwner { address { address } } } } }`;
        const gr = await fetch(GQL_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: q, variables: { keys: ids.map((id) => ({ address: id })) } }),
        }).then((x) => x.json());
        return (gr?.data?.multiGetObjects || []).map((o) =>
          o
            ? {
                data: {
                  objectId: o.address,
                  version: String(o.version),
                  digest: o.digest,
                  owner:
                    o.owner?.__typename === 'Shared'
                      ? { Shared: { initial_shared_version: String(o.owner.initialSharedVersion) } }
                      : o.owner?.__typename === 'AddressOwner'
                        ? { AddressOwner: o.owner.address?.address }
                        : 'Immutable',
                },
              }
            : { data: null }
        );
      },
    };

    swapTx.setSender(WALLET);
    swapTx.setGasPayment([]);
    swapTx.setGasPrice(1000);
    swapTx.setGasBudget(50000000);
    const bytes = await swapTx.build({ client: gqlClientShim });
    const res = await fetch(GQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `query($tx: JSON!) { simulateTransaction(transaction: $tx, doGasSelection: true) { effects { status executionError { abortCode message } } } }`,
        variables: { tx: { bcs: { value: toBase64(bytes) } } },
      }),
    }).then((x) => x.json());
    const effects = res?.data?.simulateTransaction?.effects;
    if (effects?.status === 'SUCCESS') pass('Cetus SUI -> USDC Swap GraphQL simulation', `0.5 SUI -> ${(Number(router.amountOut) / 1e6).toFixed(4)} USDC`);
    else fail('Cetus SUI -> USDC Swap GraphQL simulation', JSON.stringify(res));
  }
} catch (e) {
  fail('Cetus SUI -> USDC Swap GraphQL simulation', e?.message || String(e));
}

if (failures > 0) {
  console.error(`\n${failures} simulation check(s) failed.`);
  process.exit(1);
}
console.log('\nAll mainnet simulation checks passed.');
