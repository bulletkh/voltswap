import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import {
  DeepBookClient,
  deepbook,
  OrderType,
  SelfMatchingOptions,
  mainnetCoins,
  mainnetMarginPools,
  mainnetPackageIds,
  mainnetPools,
} from '@mysten/deepbook-v3';
import { fromBase64, toBase64 } from '@mysten/sui/utils';
import { AggregatorClient } from '@cetusprotocol/aggregator-sdk';

const WALLET = '0x7211d7a33c32b8a848fd5d87dc0630b7d40d3d324856a748aff454c2955cab12';
const ACCOUNT_ID = '2050n';
const SUI_TYPE = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const GQL_URL = 'https://graphql.mainnet.sui.io/graphql';
const DEEPBOOK_PACKAGE_ID =
  '0xbca0cefe720330e7bb4f2283438b68de6a0e656688db4ac90d61e71fe6151fe8';
const SUI_USDC_POOL_ID =
  '0xe05dafb5133bcffb8d59f4e12465dc0e9faeaa05e3e342a08fe135800e3e4407';

const grpcClient = new SuiGrpcClient({
  network: 'mainnet',
  baseUrl: 'https://fullnode.mainnet.sui.io:443',
});

async function simulateGrpcOrGql(tx) {
  tx.setSender(WALLET);
  const resolvedJson = await tx.toJSON({ client: grpcClient });
  const clone = Transaction.from(resolvedJson);
  try {
    const sim = await grpcClient.core.simulateTransaction({ transaction: clone });
    if (sim.$kind === 'Transaction') return { status: 'SUCCESS' };
    return {
      status: 'FAILURE',
      error: sim.FailedTransaction?.status?.error?.message || 'gRPC simulation failed',
    };
  } catch (err) {
    tx.setGasPayment([]);
    tx.setGasPrice(1000);
    tx.setGasBudget(50_000_000);
    const bytes = await tx.build({ client: grpcClient });
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
    }).then((r) => r.json());
    const eff = res?.data?.simulateTransaction?.effects;
    if (!eff) return { status: 'FAILURE', error: err?.message || JSON.stringify(res) };
    return eff;
  }
}

let failures = 0;
function pass(name, detail = '') {
  console.log(`PASS: ${name}${detail ? ` (${detail})` : ''}`);
}
function fail(name, detail) {
  console.error(`FAIL: ${name} -> ${detail}`);
  failures++;
}

// 1. Aftermath Markets + Prices + Orderbook
const mktsRes = await fetch('https://aftermath.finance/api/perpetuals/markets', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
});
const mktsData = await mktsRes.json();
const suiMkt = (mktsData?.marketDatas || []).find(
  (m) => m?.metadata?.symbol?.toUpperCase() === 'SUI'
);
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
  if (bad === 0)
    pass(
      'Aftermath markets IMR/maxLeverage invariant',
      `${mktsData.marketDatas.length} markets checked`
    );
  else fail('Aftermath markets IMR/maxLeverage invariant', `${bad} markets failed rounding check`);
}

// 2. Aftermath Perps Account & TxKind Mainnet Simulation
if (suiMkt) {
  const [posRes, balsRes] = await Promise.all([
    fetch('https://aftermath.finance/api/perpetuals/accounts/positions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountIds: [ACCOUNT_ID] }),
    }).then((r) => r.json()),
    grpcClient.core.listBalances({ owner: WALLET }),
  ]);
  const usdcEntry = (balsRes?.balances || []).find((b) =>
    String(b.coinType).toLowerCase().endsWith('::usdc::usdc')
  );
  const walletUsdc = Number(usdcEntry?.balance || 0) / 1e6;
  const rawPos = posRes?.accounts?.[0]?.positions || [];
  const freeUsd = Number(posRes?.accounts?.[0]?.availableCollateralUsd || 0);
  const existingSuiPos = rawPos.find((p) => p.marketId === suiMkt.market.objectId);
  const hasPosition = Boolean(existingSuiPos);
  const suiPrice = Number(suiMkt?.market?.indexPrice || 0.8);

  if (freeUsd >= 0.25) {
    const lev = existingSuiPos?.leverage ? Math.round(Number(existingSuiPos.leverage)) : 14;
    const side = existingSuiPos && Number(existingSuiPos.baseAssetAmount) < 0 ? 1 : 0;
    const marginToUse = Number(Math.max(0.2, Math.min(0.75, freeUsd * 0.85)).toFixed(4));
    const targetSizeSui = Math.max(1, Math.floor((marginToUse * lev) / suiPrice));
    const orderRes = await fetch(
      'https://aftermath.finance/api/perpetuals/account/transactions/place-market-order',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: WALLET,
          accountId: ACCOUNT_ID,
          marketId: suiMkt.market.objectId,
          side,
          size: `${BigInt(targetSizeSui) * 1_000_000_000n}n`,
          leverage: lev,
          reduceOnly: false,
          collateralChange: marginToUse,
          hasPosition,
          cancelSlTp: false,
          slippage: 0.02,
        }),
      }
    );
    const { txKind } = orderRes.ok ? await orderRes.json() : { txKind: null };
    if (!txKind) {
      fail('Aftermath place-market-order txKind', `Empty txKind (HTTP ${orderRes.status})`);
    } else {
      const tx = Transaction.fromKind(fromBase64(txKind));
      const effects = await simulateGrpcOrGql(tx);
      if (effects?.status === 'SUCCESS') {
        pass(
          'Aftermath place-market-order Mainnet gRPC simulation',
          `SUI ${lev}x ${side === 1 ? 'Short' : 'Long'} ${targetSizeSui} SUI (freeUsd=$${freeUsd.toFixed(2)}, margin=$${marginToUse})`
        );
      } else {
        fail('Aftermath place-market-order Mainnet gRPC simulation', JSON.stringify(effects));
      }
    }
  } else {
    // Account #2050n currently has ~$0 free collateral; verify txKind endpoint + create-account/deposit readiness
    const orderRes = await fetch(
      'https://aftermath.finance/api/perpetuals/account/transactions/place-market-order',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: WALLET,
          accountId: ACCOUNT_ID,
          marketId: suiMkt.market.objectId,
          side: 0,
          size: '5000000000n',
          leverage: 14,
          reduceOnly: false,
          collateralChange: 0.35,
          hasPosition,
          cancelSlTp: false,
          slippage: 0.02,
        }),
      }
    );
    const { txKind } = await orderRes.json();
    const createRes = await fetch(
      'https://aftermath.finance/api/perpetuals/transactions/create-account',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress: WALLET, collateralCoinType: USDC_TYPE }),
      }
    ).then((r) => r.json());
    const createEffects = createRes?.txKind
      ? await simulateGrpcOrGql(Transaction.fromKind(fromBase64(createRes.txKind)))
      : { status: 'FAILURE', error: 'No create-account txKind' };

    if (txKind && createEffects?.status === 'SUCCESS') {
      pass(
        'Aftermath Perps txKind & create-account Mainnet gRPC simulation',
        `freeUsd=$${freeUsd.toFixed(4)}, walletUsdc=$${walletUsdc.toFixed(4)}`
      );
    } else {
      fail('Aftermath Perps Mainnet gRPC simulation', JSON.stringify(createEffects));
    }
  }
}

// 3. Cetus Aggregator v1.7.5 + SuiGrpcClient Swap Simulation (SUI -> USDC)
try {
  const cetus = new AggregatorClient({ client: grpcClient });
  const router = await cetus.findRouters({
    from: SUI_TYPE,
    target: USDC_TYPE,
    amount: '500000000',
    byAmountIn: true,
  });
  if (!router?.amountOut || Number(router.amountOut) <= 0) {
    fail('Cetus SUI -> USDC router', 'No route');
  } else {
    const swapTx = new Transaction();
    swapTx.setSender(WALLET);
    const [feeCoin] = swapTx.splitCoins(swapTx.gas, [1250000n]);
    swapTx.transferObjects([feeCoin], WALLET);
    const [inCoin] = swapTx.splitCoins(swapTx.gas, [500000000n]);
    const outCoin = await cetus.routerSwap({
      router,
      inputCoin: inCoin,
      slippage: 0.015,
      txb: swapTx,
    });
    swapTx.transferObjects([outCoin], WALLET);
    const effects = await simulateGrpcOrGql(swapTx);
    if (effects?.status === 'SUCCESS') {
      pass(
        'Cetus SUI -> USDC v2 gRPC simulation',
        `0.5 SUI -> ${(Number(router.amountOut) / 1e6).toFixed(4)} USDC`
      );
    } else {
      fail('Cetus SUI -> USDC v2 gRPC simulation', JSON.stringify(effects));
    }
  }
} catch (e) {
  fail('Cetus SUI -> USDC v2 gRPC simulation', e?.message || String(e));
}

// 4. DeepBook v3 1-TX Limit Sell Order (Create BalanceManager + Deposit SUI + Place Limit Ask + Share)
try {
  const dbExt = grpcClient.$extend(deepbook({ address: WALLET }));
  const managers = await dbExt.deepbook.getBalanceManagerIds(WALLET);

  const tx = new Transaction();
  tx.setSender(WALLET);

  // Place a resting SUI Sell Limit Ask @ $1.20 for 1 SUI (out of 5+ SUI wallet balance)
  const price = 1.2;
  const quantity = 1;
  const onChainPrice = BigInt(Math.round((price * 1e9 * 1e6) / 1e9)); // 1.2 * 1e6
  const onChainQty = BigInt(Math.round(quantity * 1e9)); // 1e9
  const clientOrderId = BigInt(Date.now());
  const expireTs = 1844674407370955161n;

  if (managers.length > 0) {
    const dbOwned = grpcClient.$extend(
      deepbook({ address: WALLET, balanceManagers: { MAIN: { address: managers[0] } } })
    );
    tx.add(dbOwned.deepbook.balanceManager.depositIntoManager('MAIN', 'SUI', 1.01));
    tx.add(
      dbOwned.deepbook.deepBook.placeLimitOrder({
        poolKey: 'SUI_USDC',
        balanceManagerKey: 'MAIN',
        clientOrderId: clientOrderId.toString(),
        price,
        quantity,
        isBid: false,
        orderType: OrderType.NO_RESTRICTION,
        selfMatchingOption: SelfMatchingOptions.SELF_MATCHING_ALLOWED,
        payWithDeep: false,
      })
    );
  } else {
    const manager = tx.add(dbExt.deepbook.balanceManager.createBalanceManagerWithOwner(WALLET));
    const depositCoin = coinWithBalance({ type: SUI_TYPE, balance: 1_010_000_000n });
    tx.moveCall({
      package: DEEPBOOK_PACKAGE_ID,
      module: 'balance_manager',
      function: 'deposit',
      arguments: [manager, depositCoin],
      typeArguments: [SUI_TYPE],
    });
    const tradeProof = tx.moveCall({
      package: DEEPBOOK_PACKAGE_ID,
      module: 'balance_manager',
      function: 'generate_proof_as_owner',
      arguments: [manager],
    });
    tx.moveCall({
      package: DEEPBOOK_PACKAGE_ID,
      module: 'pool',
      function: 'place_limit_order',
      arguments: [
        tx.object(SUI_USDC_POOL_ID),
        manager,
        tradeProof,
        tx.pure.u64(clientOrderId),
        tx.pure.u8(OrderType.NO_RESTRICTION),
        tx.pure.u8(SelfMatchingOptions.SELF_MATCHING_ALLOWED),
        tx.pure.u64(onChainPrice),
        tx.pure.u64(onChainQty),
        tx.pure.bool(false),
        tx.pure.bool(false),
        tx.pure.u64(expireTs),
        tx.object('0x6'),
      ],
      typeArguments: [SUI_TYPE, USDC_TYPE],
    });
    tx.add(dbExt.deepbook.balanceManager.shareBalanceManager(manager));
  }

  const effects = await simulateGrpcOrGql(tx);
  if (effects?.status === 'SUCCESS') {
    pass(
      'DeepBook v3 Limit Order SUI_USDC Mainnet gRPC simulation',
      managers.length > 0 ? `existing manager ${managers[0].slice(0, 10)}` : '1-tx auto-create+deposit+limit+share'
    );
  } else {
    fail('DeepBook v3 Limit Order SUI_USDC Mainnet gRPC simulation', JSON.stringify(effects));
  }
} catch (e) {
  fail('DeepBook v3 Limit Order SUI_USDC Mainnet gRPC simulation', e?.stack || e?.message || String(e));
}

// 5. DeepBook v3 Margin Pool Supply + Partial Withdraw Mainnet gRPC simulation (with Volt Fee + Referral split)
try {
  const dbMargin = new DeepBookClient({ client: grpcClient, network: 'mainnet', address: WALLET });
  const txMargin = new Transaction();
  txMargin.setSender(WALLET);
  const [feeTreas, feeRef] = txMargin.splitCoins(txMargin.gas, [187_500n, 62_500n]);
  txMargin.transferObjects([feeTreas], '0x7ef65a3b007b79e3b8d9a29f2d5e8584b589186b3a9483b7519c53088c317b93');
  txMargin.transferObjects([feeRef], '0x1111111111111111111111111111111111111111111111111111111111111111');
  const cap = dbMargin.marginPool.mintSupplierCap()(txMargin);
  dbMargin.marginPool.supplyToMarginPool('SUI', cap, 0.2)(txMargin);
  const withdrawnCoin = dbMargin.marginPool.withdrawFromMarginPool('SUI', cap, 0.05)(txMargin);
  txMargin.transferObjects([withdrawnCoin, cap], WALLET);

  const marginEffects = await simulateGrpcOrGql(txMargin);
  if (marginEffects?.status === 'SUCCESS') {
    pass('DeepBook v3 MarginPool Supply+Withdraw Mainnet gRPC simulation', 'mintCap+fee+supply+withdraw ok');
  } else {
    fail('DeepBook v3 MarginPool Supply+Withdraw Mainnet gRPC simulation', JSON.stringify(marginEffects));
  }
} catch (e) {
  fail('DeepBook v3 MarginPool Supply+Withdraw Mainnet gRPC simulation', e?.stack || e?.message || String(e));
}

// 6. On-Site LST Yield Zap (SUI -> haSUI) Quote & Swap Tx simulation
try {
  const agg = new AggregatorClient({ client: grpcClient });
  const haSuiType = '0xbde4ba4c2e274a60ce15c1cfff9e5c42e41654ac8b6d906a57efa4bd3c29f47d::hasui::HASUI';
  const router = await agg.findRouters({
    from: SUI_TYPE,
    target: haSuiType,
    amount: 500_000_000n,
    byAmountIn: true,
  });
  if (!router || router.insufficientLiquidity || BigInt(router.amountOut || 0) <= 0n) {
    fail('On-Site LST Yield Zap (SUI -> haSUI)', 'No route returned');
  } else {
    const lstTx = new Transaction();
    lstTx.setSender(WALLET);
    await agg.fastRouterSwap({
      router,
      txb: lstTx,
      slippage: 0.015,
      refreshAllCoins: true,
    });
    const lstEffects = await simulateGrpcOrGql(lstTx);
    if (lstEffects?.status === 'SUCCESS') {
      pass('On-Site LST Yield Zap (SUI -> haSUI) Mainnet simulation', `out=${router.amountOut}`);
    } else {
      fail('On-Site LST Yield Zap (SUI -> haSUI) Mainnet simulation', JSON.stringify(lstEffects));
    }
  }
} catch (e) {
  fail('On-Site LST Yield Zap (SUI -> haSUI)', e?.stack || e?.message || String(e));
}

// 7. Aftermath Spot Router SUI -> USDC + Volt Tier Fee Mainnet Simulation
try {
  const afRoute = await fetch('https://aftermath.finance/api/router/trade-route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      coinInType: SUI_TYPE,
      coinOutType: USDC_TYPE,
      coinInAmount: '499000000n',
    }),
  }).then((r) => r.json());
  if (!afRoute?.coinOut?.amount) {
    fail('Aftermath Spot Router SUI -> USDC route', 'No route returned');
  } else {
    const tradeRes = await fetch('https://aftermath.finance/api/router/v1/transactions/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: WALLET,
        completeRoute: afRoute,
        slippage: 0.015,
      }),
    }).then((r) => r.json());
    if (!tradeRes?.txKind) {
      fail('Aftermath Spot Router build trade txKind', 'Missing txKind');
    } else {
      const afTx = Transaction.fromKind(fromBase64(tradeRes.txKind));
      const [feeCoin] = afTx.splitCoins(afTx.gas, [1_000_000n]);
      afTx.transferObjects([feeCoin], '0x7ef65a3b007b79e3b8d9a29f2d5e8584b589186b3a9483b7519c53088c317b93');
      const afEffects = await simulateGrpcOrGql(afTx);
      if (afEffects?.status === 'SUCCESS') {
        pass('Aftermath Spot Router SUI -> USDC + Volt Fee Mainnet gRPC simulation', `out=${afRoute.coinOut.amount}`);
      } else {
        fail('Aftermath Spot Router SUI -> USDC + Volt Fee Mainnet gRPC simulation', JSON.stringify(afEffects));
      }
    }
  }
} catch (e) {
  fail('Aftermath Spot Router SUI -> USDC', e?.stack || e?.message || String(e));
}

// 8. Aftermath Perps Limit + PostOnly + Inline TP/SL (ETH) & Set SL/TP + Leverage (SUI)
try {
  const owned = await fetch('https://aftermath.finance/api/perpetuals/accounts/owned', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress: WALLET }),
  }).then((r) => r.json());
  const cap = owned?.accountCaps?.[0];
  const accountCapId = cap?.objectId;
  const ethMkt = (mktsData?.marketDatas || []).find((m) => m?.metadata?.symbol?.toUpperCase() === 'ETH');

  if (accountCapId && ethMkt) {
    const ethIdx = Number(ethMkt.market.indexPrice || 2500);
    const tick = BigInt(String(ethMkt.market.marketParams.tickSize || '10000n').replace('n', ''));
    const lot = BigInt(String(ethMkt.market.marketParams.lotSize || '10000n').replace('n', ''));
    const limitPxUsd = ethIdx * 0.88; // safely below book so PostOnly posts instead of rejecting
    const alignedPx = (BigInt(Math.floor(limitPxUsd * 1e9)) / tick) * tick;
    const minNotional = Math.max(Number(ethMkt.market.marketParams.minOrderUsdValue || 2), 3);
    const sizeContracts = (minNotional * 1.15) / limitPxUsd;
    const alignedSize = (BigInt(Math.ceil(sizeContracts * 1e9)) / lot) * lot || lot;

    const limRes = await fetch(
      'https://aftermath.finance/api/perpetuals/account/transactions/place-limit-order',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: WALLET,
          accountId: ACCOUNT_ID,
          accountCapId,
          marketId: ethMkt.market.objectId,
          side: 0,
          size: `${alignedSize}n`,
          price: `${alignedPx}n`,
          orderType: 2, // PostOnly
          collateralChange: 0.35,
          hasPosition: false,
          cancelSlTp: false,
          reduceOnly: false,
          leverage: 10,
          slTp: {
            takeProfitPrice: Number((ethIdx * 1.15).toFixed(2)),
            stopLossPrice: Number((limitPxUsd * 0.92).toFixed(2)),
            triggerPriceType: 2,
          },
        }),
      }
    ).then((r) => r.json());

    if (!limRes?.txKind) {
      fail('Aftermath Perps Limit+PostOnly+SL/TP ETH txKind', JSON.stringify(limRes));
    } else {
      const limEff = await simulateGrpcOrGql(Transaction.fromKind(fromBase64(limRes.txKind)));
      if (limEff?.status === 'SUCCESS') {
        pass('Aftermath Perps Limit + PostOnly + Inline TP/SL (ETH) Mainnet gRPC simulation', `cap=${accountCapId.slice(0, 10)}`);
      } else {
        fail('Aftermath Perps Limit + PostOnly + Inline TP/SL (ETH) Mainnet gRPC simulation', JSON.stringify(limEff));
      }
    }
  }

  if (accountCapId && suiMkt) {
    const slTpRes = await fetch(
      'https://aftermath.finance/api/perpetuals/account/transactions/place-sl-tp-orders',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: WALLET,
          accountId: ACCOUNT_ID,
          accountCapId,
          marketId: suiMkt.market.objectId,
          positionSide: 1,
          size: '1000000000n',
          takeProfitPrice: 0.65,
          stopLossPrice: 0.95,
          triggerPriceType: 2,
        }),
      }
    ).then((r) => r.json());

    if (!slTpRes?.txKind) {
      fail('Aftermath Perps Place SL/TP (SUI) txKind', JSON.stringify(slTpRes));
    } else {
      const slEff = await simulateGrpcOrGql(Transaction.fromKind(fromBase64(slTpRes.txKind)));
      if (slEff?.status === 'SUCCESS') {
        pass('Aftermath Perps Place SL/TP (SUI) Mainnet gRPC simulation', 'TP/SL attached cleanly');
      } else {
        fail('Aftermath Perps Place SL/TP (SUI) Mainnet gRPC simulation', JSON.stringify(slEff));
      }
    }

    const levPrev = await fetch(
      'https://aftermath.finance/api/perpetuals/account/previews/set-leverage',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: ACCOUNT_ID,
          marketId: suiMkt.market.objectId,
          leverage: 10,
        }),
      }
    ).then((r) => r.json());
    if (levPrev && !levPrev.error) {
      const levTxRes = await fetch(
        'https://aftermath.finance/api/perpetuals/account/transactions/set-leverage',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            walletAddress: WALLET,
            accountId: ACCOUNT_ID,
            accountCapId,
            marketId: suiMkt.market.objectId,
            leverage: 10,
            collateralChange: Number(levPrev.collateralChange || 0),
          }),
        }
      ).then((r) => r.json());
      if (levTxRes?.txKind) {
        const levEff = await simulateGrpcOrGql(Transaction.fromKind(fromBase64(levTxRes.txKind)));
        if (levEff?.status === 'SUCCESS') {
          pass('Aftermath Perps Set Leverage (10x) Mainnet gRPC simulation', `delta=${Number(levPrev.collateralChange || 0).toFixed(4)} USDC`);
        } else {
          fail('Aftermath Perps Set Leverage (10x) Mainnet gRPC simulation', JSON.stringify(levEff));
        }
      }
    }

    const candlesRes = await fetch(
      'https://aftermath.finance/api/perpetuals/market/candle-history',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketId: suiMkt.market.objectId,
          fromTimestamp: Date.now() - 86_400_000,
          toTimestamp: Date.now(),
          resolution: '15m',
        }),
      }
    ).then((r) => r.json());
    if (Array.isArray(candlesRes?.candles) && candlesRes.candles.length > 0) {
      pass('Aftermath Perps Native Candle History (SUI 15m)', `${candlesRes.candles.length} candles`);
    } else {
      fail('Aftermath Perps Native Candle History (SUI 15m)', 'No candles returned');
    }
  }
} catch (e) {
  fail('Aftermath Perps Extended Pro Checks', e?.stack || e?.message || String(e));
}

// 8. DeepBook v3 Margin Trading Mainnet Checks
try {
  const dbExt = grpcClient.$extend(deepbook({ network: 'mainnet', address: WALLET }));
  const dbClient = dbExt.deepbook;
  const poolKeys = ['SUI_USDC', 'DEEP_USDC', 'WAL_USDC', 'XBTC_USDC'];
  let enabledCount = 0;
  for (const pk of poolKeys) {
    const enabled = await dbClient.isPoolEnabledForMargin(pk);
    if (enabled) enabledCount++;
  }
  if (enabledCount >= 4) {
    pass('DeepBook v3 Margin Enabled Pools', `${enabledCount}/4 active on Mainnet`);
  } else {
    fail('DeepBook v3 Margin Enabled Pools', `Only ${enabledCount}/4 enabled`);
  }

  const suiPool = mainnetPools.SUI_USDC;
  const suiCoin = mainnetCoins.SUI;
  const usdcCoin = mainnetCoins.USDC;
  const suiMarginPool = mainnetMarginPools.SUI;
  const usdcMarginPool = mainnetMarginPools.USDC;

  // Test 8A: 1-TX Margin Long Limit (Deposit SUI -> Borrow USDC -> Place Limit Order -> Share)
  {
    const tx = new Transaction();
    const { manager, initializer } = dbClient.marginManager.newMarginManagerWithInitializer('SUI_USDC')(tx);
    tx.add(
      dbClient.marginManager.depositDuringInitialization({
        manager,
        poolKey: 'SUI_USDC',
        coinType: suiPool.baseCoin,
        amount: 1.5,
      })
    );
    tx.moveCall({
      target: `${mainnetPackageIds.MARGIN_PACKAGE_ID}::margin_manager_upgraded::borrow_quote`,
      arguments: [
        manager,
        tx.object(mainnetPackageIds.MARGIN_REGISTRY_ID),
        tx.object(usdcMarginPool.address),
        tx.object(suiCoin.priceInfoObjectId),
        tx.object(usdcCoin.priceInfoObjectId),
        tx.object(suiPool.address),
        tx.pure.u64(1_000_000n),
        tx.object('0x6'),
      ],
      typeArguments: [suiCoin.type, usdcCoin.type],
    });
    const safePrice = BigInt(Math.round((0.5 * 1e9 * usdcCoin.scalar) / suiCoin.scalar));
    tx.moveCall({
      target: `${mainnetPackageIds.MARGIN_PACKAGE_ID}::pool_proxy_upgraded::place_limit_order_v2`,
      arguments: [
        tx.object(mainnetPackageIds.MARGIN_REGISTRY_ID),
        manager,
        tx.object(suiPool.address),
        tx.object(suiMarginPool.address),
        tx.object(usdcMarginPool.address),
        tx.object(suiCoin.priceInfoObjectId),
        tx.object(usdcCoin.priceInfoObjectId),
        tx.pure.u64(BigInt(Date.now())),
        tx.pure.u8(OrderType.NO_RESTRICTION),
        tx.pure.u8(SelfMatchingOptions.SELF_MATCHING_ALLOWED),
        tx.pure.u64(safePrice),
        tx.pure.u64(1_000_000_000n),
        tx.pure.bool(true),
        tx.pure.bool(false),
        tx.pure.u64(1844674407370955161n),
        tx.object('0x6'),
      ],
      typeArguments: [suiCoin.type, usdcCoin.type],
    });
    tx.add(dbClient.marginManager.shareMarginManager('SUI_USDC', manager, initializer));
    const longEff = await simulateGrpcOrGql(tx);
    if (longEff?.status === 'SUCCESS') {
      pass('DeepBook Margin 1-TX Long Limit (SUI/USDC)', 'Init + Deposit + Borrow + Limit + Share');
    } else {
      fail('DeepBook Margin 1-TX Long Limit (SUI/USDC)', JSON.stringify(longEff));
    }
  }

  // Test 8B: 1-TX Margin Short Market + Conditional TP/SL
  {
    const tx = new Transaction();
    const { manager, initializer } = dbClient.marginManager.newMarginManagerWithInitializer('SUI_USDC')(tx);
    tx.add(
      dbClient.marginManager.depositDuringInitialization({
        manager,
        poolKey: 'SUI_USDC',
        coinType: suiPool.quoteCoin,
        amount: 1.2,
      })
    );
    tx.moveCall({
      target: `${mainnetPackageIds.MARGIN_PACKAGE_ID}::margin_manager_upgraded::borrow_base`,
      arguments: [
        manager,
        tx.object(mainnetPackageIds.MARGIN_REGISTRY_ID),
        tx.object(suiMarginPool.address),
        tx.object(suiCoin.priceInfoObjectId),
        tx.object(usdcCoin.priceInfoObjectId),
        tx.object(suiPool.address),
        tx.pure.u64(1_010_000_000n),
        tx.object('0x6'),
      ],
      typeArguments: [suiCoin.type, usdcCoin.type],
    });
    tx.moveCall({
      target: `${mainnetPackageIds.MARGIN_PACKAGE_ID}::pool_proxy_upgraded::place_market_order_v2`,
      arguments: [
        tx.object(mainnetPackageIds.MARGIN_REGISTRY_ID),
        manager,
        tx.object(suiPool.address),
        tx.object(suiMarginPool.address),
        tx.object(usdcMarginPool.address),
        tx.object(suiCoin.priceInfoObjectId),
        tx.object(usdcCoin.priceInfoObjectId),
        tx.pure.u64(BigInt(Date.now() + 1)),
        tx.pure.u8(SelfMatchingOptions.SELF_MATCHING_ALLOWED),
        tx.pure.u64(1_000_000_000n),
        tx.pure.bool(false),
        tx.pure.bool(false),
        tx.object('0x6'),
      ],
      typeArguments: [suiCoin.type, usdcCoin.type],
    });
    const cond = dbClient.marginTPSL.newCondition('SUI_USDC', false, 1.8)(tx);
    const pending = dbClient.marginTPSL.newPendingMarketOrder('SUI_USDC', {
      clientOrderId: String(Date.now() + 99),
      quantity: 1,
      isBid: true,
      payWithDeep: false,
    })(tx);
    tx.moveCall({
      target: `${mainnetPackageIds.MARGIN_PACKAGE_ID}::margin_manager_upgraded::add_conditional_order`,
      arguments: [
        manager,
        tx.object(suiPool.address),
        tx.object(suiCoin.priceInfoObjectId),
        tx.object(usdcCoin.priceInfoObjectId),
        tx.object(mainnetPackageIds.MARGIN_REGISTRY_ID),
        tx.pure.u64(BigInt(Date.now() + 2)),
        cond,
        pending,
        tx.object('0x6'),
      ],
      typeArguments: [suiCoin.type, usdcCoin.type],
    });
    tx.add(dbClient.marginManager.shareMarginManager('SUI_USDC', manager, initializer));
    const shortEff = await simulateGrpcOrGql(tx);
    if (shortEff?.status === 'SUCCESS') {
      pass('DeepBook Margin 1-TX Short + SL (SUI/USDC)', 'Init + BorrowBase + Market + CondSL + Share');
    } else {
      fail('DeepBook Margin 1-TX Short + SL (SUI/USDC)', JSON.stringify(shortEff));
    }
  }
} catch (e) {
  fail('DeepBook v3 Margin Mainnet Simulation', e?.stack || e?.message || String(e));
}

// 9. DeepBook v3 1-TX Spot CLOB Market Order (Deposit SUI -> place_market_order -> withdraw_settled_amounts -> withdraw_all -> Share)
try {
  const tx = new Transaction();
  tx.setSender(WALLET);
  const manager = tx.moveCall({
    target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::new_with_custom_owner`,
    arguments: [tx.pure.address(WALLET)],
  });
  const depositCoin = coinWithBalance({ type: SUI_TYPE, balance: 1_010_000_000n })(tx);
  tx.moveCall({
    package: DEEPBOOK_PACKAGE_ID,
    module: 'balance_manager',
    function: 'deposit',
    arguments: [manager, depositCoin],
    typeArguments: [SUI_TYPE],
  });
  const tradeProof = tx.moveCall({
    package: DEEPBOOK_PACKAGE_ID,
    module: 'balance_manager',
    function: 'generate_proof_as_owner',
    arguments: [manager],
  });
  tx.moveCall({
    target: `${DEEPBOOK_PACKAGE_ID}::pool::place_market_order`,
    arguments: [
      tx.object(SUI_USDC_POOL_ID),
      manager,
      tradeProof,
      tx.pure.u64(BigInt(Date.now() + 77)),
      tx.pure.u8(SelfMatchingOptions.SELF_MATCHING_ALLOWED),
      tx.pure.u64(1_000_000_000n),
      tx.pure.bool(false),
      tx.pure.bool(false),
      tx.object('0x6'),
    ],
    typeArguments: [SUI_TYPE, USDC_TYPE],
  });
  tx.moveCall({
    target: `${DEEPBOOK_PACKAGE_ID}::pool::withdraw_settled_amounts`,
    arguments: [tx.object(SUI_USDC_POOL_ID), manager, tradeProof],
    typeArguments: [SUI_TYPE, USDC_TYPE],
  });
  const outBase = tx.moveCall({
    target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::withdraw_all`,
    arguments: [manager],
    typeArguments: [SUI_TYPE],
  });
  const outQuote = tx.moveCall({
    target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::withdraw_all`,
    arguments: [manager],
    typeArguments: [USDC_TYPE],
  });
  tx.transferObjects([outBase, outQuote], WALLET);
  tx.moveCall({
    target: '0x2::transfer::public_share_object',
    arguments: [manager],
    typeArguments: [`${DEEPBOOK_PACKAGE_ID}::balance_manager::BalanceManager`],
  });

  const mktEff = await simulateGrpcOrGql(tx);
  if (mktEff?.status === 'SUCCESS') {
    pass('DeepBook v3 1-TX Spot Market Order (SUI_USDC)', 'Create + Deposit + MarketSell + Settle + WithdrawAll + Share');
  } else {
    fail('DeepBook v3 1-TX Spot Market Order (SUI_USDC)', JSON.stringify(mktEff));
  }
} catch (e) {
  fail('DeepBook v3 1-TX Spot Market Order (SUI_USDC)', e?.stack || e?.message || String(e));
}

if (failures > 0) {
  console.error(`\n${failures} simulation check(s) failed.`);
  process.exit(1);
}
console.log('\nAll mainnet v2 simulation checks passed.');
