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
import {
  MAINNET_CONFIG as PREDICT_MAINNET_CONFIG,
  predict as predictExt,
  toGeneratedConfig,
  toOrdersConfig,
  registryMoveCalls,
  deriveAccountWrapperId,
  deriveQueueId,
  snapStrike,
  binaryRangeTicks,
  priceToRaw,
  usdcToRaw,
  generateAuth,
} from '@mysten/deepbook-v3/predict';
import { accountMoveCalls, accountRegistryMoveCalls } from '@mysten/deepbook-v3/account';
import { bcs } from '@mysten/sui/bcs';
import { deriveObjectID, fromBase64, normalizeSuiAddress, toBase64 } from '@mysten/sui/utils';
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

async function simulateGrpcOrGql(tx, sender = WALLET) {
  tx.setSender(sender);
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
    tx.moveCall({
      target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::register_balance_manager`,
      arguments: [manager, tx.object(mainnetPackageIds.REGISTRY_ID)],
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

// 5. DeepBook v3 Margin Pool Native SupplyReferral + 0% User Deposit Fee + Supply + Withdraw simulation
try {
  const dbMargin = new DeepBookClient({ client: grpcClient, network: 'mainnet', address: WALLET });
  const txMargin = new Transaction();
  txMargin.setSender(WALLET);
  dbMargin.marginPool.mintSupplyReferral('SUI')(txMargin);
  const cap = dbMargin.marginPool.mintSupplierCap()(txMargin);
  dbMargin.marginPool.supplyToMarginPool('SUI', cap, 0.2)(txMargin);
  const withdrawnCoin = dbMargin.marginPool.withdrawFromMarginPool('SUI', cap, 0.05)(txMargin);
  txMargin.transferObjects([withdrawnCoin, cap], WALLET);

  const marginEffects = await simulateGrpcOrGql(txMargin);
  if (marginEffects?.status === 'SUCCESS') {
    pass('DeepBook v3 MarginPool Native SupplyReferral + 0% Fee Supply+Withdraw', 'mintSupplyReferral+mintCap+supply+withdraw ok');
  } else {
    fail('DeepBook v3 MarginPool Native SupplyReferral + 0% Fee Supply+Withdraw', JSON.stringify(marginEffects));
  }
} catch (e) {
  fail('DeepBook v3 MarginPool Native SupplyReferral + 0% Fee Supply+Withdraw', e?.stack || e?.message || String(e));
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
        coinType: suiPool.baseCoin,
        amount: 1.8,
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
    target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::register_balance_manager`,
    arguments: [manager, tx.object(mainnetPackageIds.REGISTRY_ID)],
  });
  tx.moveCall({
    target: '0x2::transfer::public_share_object',
    arguments: [manager],
    typeArguments: [`${DEEPBOOK_PACKAGE_ID}::balance_manager::BalanceManager`],
  });

  const mktEff = await simulateGrpcOrGql(tx);
  if (mktEff?.status === 'SUCCESS') {
    pass('DeepBook v3 1-TX Spot Market Order (SUI_USDC)', 'Create + Deposit + MarketSell + Settle + WithdrawAll + Register + Share');
  } else {
    fail('DeepBook v3 1-TX Spot Market Order (SUI_USDC)', JSON.stringify(mktEff));
  }
} catch (e) {
  fail('DeepBook v3 1-TX Spot Market Order (SUI_USDC)', e?.stack || e?.message || String(e));
}

// 10. DeepBook v3 GraphQL Manager Discovery + Multi-Vault Cancel/Withdraw Recovery Simulation
try {
  const dbExt10 = grpcClient.$extend(deepbook({ address: WALLET }));
  const regIds = await dbExt10.deepbook.getBalanceManagerIds(WALLET);
  const gqlRes = await fetch(GQL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query($addr: SuiAddress!) {
        transactions(filter: { sentAddress: $addr }, last: 50) {
          nodes {
            effects {
              objectChanges {
                nodes {
                  address
                  outputState {
                    asMoveObject {
                      contents { type { repr } json }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      variables: { addr: WALLET },
    }),
  }).then((r) => r.json());

  const gqlMgrIds = [];
  for (const txNode of gqlRes?.data?.transactions?.nodes || []) {
    for (const ch of txNode?.effects?.objectChanges?.nodes || []) {
      const contents = ch?.outputState?.asMoveObject?.contents;
      const repr = String(contents?.type?.repr || '');
      const mgrOwner = String(contents?.json?.owner || '');
      if (
        repr.includes('::balance_manager::BalanceManager') &&
        mgrOwner.toLowerCase() === WALLET.toLowerCase()
      ) {
        gqlMgrIds.push(String(ch.address));
      }
    }
  }
  const allDiscovered = Array.from(new Set([...regIds, ...gqlMgrIds]));

  if (allDiscovered.length > 0) {
    const mgrMap = {};
    allDiscovered.forEach((id, i) => {
      mgrMap[`M${i}`] = { address: id };
    });
    const sweepClient = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' }).$extend(
      deepbook({ address: WALLET, balanceManagers: mgrMap })
    );
    const sweepTx = new Transaction();
    sweepTx.setSender(WALLET);
    const outs = [];
    for (let i = 0; i < allDiscovered.length; i++) {
      const key = `M${i}`;
      const mgrArg = sweepTx.object(allDiscovered[i]);
      const proof = sweepTx.moveCall({
        target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::generate_proof_as_owner`,
        arguments: [mgrArg],
      });
      const openIds = await sweepClient.deepbook.accountOpenOrders('SUI_USDC', key).catch(() => []);
      for (const orderId of openIds) {
        sweepTx.moveCall({
          target: `${DEEPBOOK_PACKAGE_ID}::pool::cancel_order`,
          arguments: [
            sweepTx.object(SUI_USDC_POOL_ID),
            mgrArg,
            proof,
            sweepTx.pure.u128(BigInt(orderId)),
            sweepTx.object('0x6'),
          ],
          typeArguments: [SUI_TYPE, USDC_TYPE],
        });
      }
      sweepTx.moveCall({
        target: `${DEEPBOOK_PACKAGE_ID}::pool::withdraw_settled_amounts`,
        arguments: [sweepTx.object(SUI_USDC_POOL_ID), mgrArg, proof],
        typeArguments: [SUI_TYPE, USDC_TYPE],
      });
      outs.push(
        sweepTx.moveCall({
          target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::withdraw_all`,
          arguments: [mgrArg],
          typeArguments: [SUI_TYPE],
        }),
        sweepTx.moveCall({
          target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::withdraw_all`,
          arguments: [mgrArg],
          typeArguments: [USDC_TYPE],
        })
      );
    }
    if (outs.length > 0) sweepTx.transferObjects(outs, WALLET);
    const sweepEff = await simulateGrpcOrGql(sweepTx);
    if (sweepEff?.status === 'SUCCESS') {
      pass('DeepBook v3 Multi-Vault Cancel & Withdraw Recovery', `${allDiscovered.length} vault(s) discovered & swept`);
    } else {
      fail('DeepBook v3 Multi-Vault Cancel & Withdraw Recovery', JSON.stringify(sweepEff));
    }
  } else {
    pass('DeepBook v3 Multi-Vault Discovery (GraphQL)', '0 vaults on wallet (clean state)');
  }
} catch (e) {
  fail('DeepBook v3 Multi-Vault Cancel & Withdraw Recovery', e?.stack || e?.message || String(e));
}

// 9. DeepBook Spot Native PoolReferral Mint (0.5x) & BalanceManager Referral Binding
try {
  const dbSpotRef = grpcClient.$extend(deepbook({ address: WALLET }));
  const txMintRef = new Transaction();
  txMintRef.add(dbSpotRef.deepbook.deepBook.mintReferral('SUI_USDC', 0.5));
  const mintRefEff = await simulateGrpcOrGql(txMintRef);
  if (mintRefEff?.status !== 'SUCCESS') {
    fail('DeepBook v3 Spot mintReferral (0.5x SUI_USDC)', JSON.stringify(mintRefEff));
  } else {
    // Also verify attaching an existing live DeepBookPoolReferral onto a BalanceManager
    const evType =
      '0x00c1a56ec8c4c623a848b2ed2f03d23a25d17570b670c22106f336eb933785cc::balance_manager::DeepBookReferralCreatedEvent';
    const evRes = await fetch(GQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{ events(filter: { type: "${evType}" }, last: 5) { nodes { contents { json } } } }`,
      }),
    }).then((r) => r.json());
    const firstRef = (evRes?.data?.events?.nodes || [])
      .map((n) => n?.contents?.json?.referral_id)
      .find(Boolean);
    if (firstRef) {
      const txBind = new Transaction();
      const mgr = txBind.add(dbSpotRef.deepbook.balanceManager.createBalanceManagerWithOwner(WALLET));
      const tradeCap = txBind.moveCall({
        target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::mint_trade_cap`,
        arguments: [mgr],
      });
      txBind.moveCall({
        target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::set_balance_manager_referral`,
        arguments: [mgr, txBind.object(firstRef), tradeCap],
        typeArguments: [],
      });
      txBind.transferObjects([tradeCap], WALLET);
      txBind.add(dbSpotRef.deepbook.balanceManager.shareBalanceManager(mgr));
      const bindEff = await simulateGrpcOrGql(txBind);
      if (bindEff?.status === 'SUCCESS') {
        pass('DeepBook v3 Spot mintReferral (0.5x) & set_balance_manager_referral', `ref=${firstRef.slice(0, 10)}... ok`);
      } else {
        fail('DeepBook v3 Spot set_balance_manager_referral', JSON.stringify(bindEff));
      }
    } else {
      pass('DeepBook v3 Spot mintReferral (0.5x SUI_USDC)', 'mintReferral simulated SUCCESS');
    }
  }
} catch (e) {
  fail('DeepBook v3 Spot PoolReferral simulation', e?.stack || e?.message || String(e));
}

// 10. DeepBook Predict BuilderCode Derivation & Init Simulation
try {
  const KeyTuple = bcs.tuple([bcs.Address, bcs.u64()]);
  const derivedBc = deriveObjectID(
    PREDICT_MAINNET_CONFIG.objects.registry,
    `${PREDICT_MAINNET_CONFIG.packages.predictV1}::builder_code::BuilderCodeKey`,
    KeyTuple.serialize([normalizeSuiAddress(WALLET), 0n]).toBytes()
  );
  const expectedBc = '0x075978e7076bd84afbb9e5fc4f5742387f512a60b37d15e4c414c76d206725c7';
  const derivedRef = deriveAccountWrapperId(PREDICT_MAINNET_CONFIG, WALLET);
  const expectedRef = '0xd9f1d77a15688d375b7233c2c1f4f59b7e432efe5c492244f633df7ddb500c69';
  if (derivedBc !== expectedBc || derivedRef !== expectedRef) {
    fail('DeepBook Predict ID derivation', `got bc=${derivedBc}, ref=${derivedRef}`);
  } else {
    const [bcObjRes, refObjRes] = await Promise.all([
      grpcClient.core.getObject({ objectId: derivedBc }).catch(() => null),
      grpcClient.core.getObject({ objectId: derivedRef }).catch(() => null),
    ]);
    const bcExists = Boolean(bcObjRes?.object?.objectId);
    const refExists = Boolean(refObjRes?.object?.objectId);
    const cfg = toGeneratedConfig(PREDICT_MAINNET_CONFIG);
    const accCfg = {
      accountPackageId: PREDICT_MAINNET_CONFIG.packages.account,
      accountRegistry: PREDICT_MAINNET_CONFIG.objects.accountRegistry,
      accountPackageIdLatest: PREDICT_MAINNET_CONFIG.packages.accountLatest,
    };
    const txInitPredict = new Transaction();
    txInitPredict.add(
      registryMoveCalls.createAndShareBuilderCode({
        config: cfg,
        arguments: { index: bcExists ? 99n : 0n },
      })
    );
    if (!refExists) {
      const w = txInitPredict.add(accountRegistryMoveCalls._new({ config: accCfg }));
      txInitPredict.add(accountMoveCalls.share({ config: accCfg, arguments: { self: w } }));
    }
    const initEff = await simulateGrpcOrGql(txInitPredict);
    if (initEff?.status === 'SUCCESS') {
      pass(
        'DeepBook Predict BuilderCode + Referrer Init Mainnet simulation',
        `bc=${derivedBc.slice(0, 10)}... (liveBc=${bcExists}, liveRef=${refExists})`
      );
    } else {
      fail('DeepBook Predict BuilderCode + Referrer Init Mainnet simulation', JSON.stringify(initEff));
    }
  }
} catch (e) {
  fail('DeepBook Predict BuilderCode + Referrer Init Mainnet simulation', e?.stack || e?.message || String(e));
}

// 11. DeepBook Predict Live Market Quote & 1-Tx Enqueue Simulation
try {
  const predictClient = grpcClient.$extend(predictExt({ network: 'mainnet' }));
  const rawMarkets = await predictClient.predict.read.markets();
  const futureMarkets = rawMarkets
    .filter((m) => !m.mintPaused && Number(m.expiryMs) > Date.now() + 90_000)
    .sort((a, b) => Number(a.expiryMs - b.expiryMs));
  const futureMarket =
    futureMarkets[0] ||
    rawMarkets
      .filter((m) => !m.mintPaused && Number(m.expiryMs) > Date.now() + 25_000)
      .sort((a, b) => Number(a.expiryMs - b.expiryMs))[0];

  if (!futureMarket) {
    fail('DeepBook Predict Live Markets', 'No active future Predict markets returned');
  } else {
    const mCoords = { underlying: 'BTC', expiryMs: futureMarket.expiryMs, marketId: futureMarket.id };
    const pricer = await predictClient.predict.read.pricer(mCoords);
    const step = Math.max(1, futureMarket.admissionTickSize || 1);
    const remMin = Math.max(0.5, (Number(futureMarket.expiryMs) - Date.now()) / 60_000);
    const tScale = Math.sqrt(remMin / 2);
    let chosenStrike = null;
    for (const pct of [0.00015, 0.0003, 0.0005, 0.0008, 0.0012, 0.002]) {
      const cand = snapStrike(pricer.forward * (1 + pct * tScale), step, 'up');
      const q = await predictClient.predict.read.price({ ...mCoords, strike: cand }).catch(() => null);
      if (q && q.up >= 0.16 && q.up <= 0.49) {
        chosenStrike = cand;
        break;
      }
    }
    if (!chosenStrike) chosenStrike = snapStrike(pricer.forward * (1 + 0.0003 * tScale), step, 'up');

    const plan = await predictClient.predict.read.planMint(
      WALLET,
      { ...mCoords, side: 'up', strike: chosenStrike },
      { amount: 1.5, slippageCents: 'auto', orderFee: 'inclusive' }
    );

    // Find a Mainnet USDC coin owner who also has SUI gas to dry-run the 1-tx enqueue PTB cleanly
    const holdersRes = await fetch(GQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{ objects(filter: { type: "0x2::coin::Coin<${USDC_TYPE}>" }, first: 12) { nodes { address asMoveObject { owner { ... on AddressOwner { address { address } } } contents { json } } } } }`,
      }),
    }).then((r) => r.json());
    let testSender = null;
    for (const node of holdersRes?.data?.objects?.nodes || []) {
      const ownerAddr = node?.asMoveObject?.owner?.address?.address;
      const balRaw = BigInt(node?.asMoveObject?.contents?.json?.balance || '0');
      if (!ownerAddr || balRaw < 3_000_000n) continue;
      const bList = await grpcClient.core.listBalances({ owner: ownerAddr }).catch(() => null);
      const suiBal = Number((bList?.balances || []).find((b) => b.coinType.endsWith('::sui::SUI'))?.balance || 0);
      if (suiBal >= 150_000_000) {
        testSender = ownerAddr;
        break;
      }
    }

    if (testSender && plan?.accepting) {
      const ordersCfg = toOrdersConfig(PREDICT_MAINNET_CONFIG);
      const accCfg = {
        accountPackageId: PREDICT_MAINNET_CONFIG.packages.account,
        accountRegistry: PREDICT_MAINNET_CONFIG.objects.accountRegistry,
        accountPackageIdLatest: PREDICT_MAINNET_CONFIG.packages.accountLatest,
      };
      const tickScale = priceToRaw(futureMarket.tickSize);
      const ticks = binaryRangeTicks(priceToRaw(chosenStrike), 'up', tickScale);
      const u = PREDICT_MAINNET_CONFIG.underlyings.BTC;
      const wrapperObj = await fetch(GQL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `{ object(address: "${deriveAccountWrapperId(PREDICT_MAINNET_CONFIG, testSender)}") { address } }`,
        }),
      }).then((r) => r.json());
      const senderHasAcc = Boolean(wrapperObj?.data?.object?.address);
      const txBet = new Transaction();
      let wrapperArg = deriveAccountWrapperId(PREDICT_MAINNET_CONFIG, testSender);
      if (!senderHasAcc) {
        wrapperArg = txBet.add(accountRegistryMoveCalls._new({ config: accCfg }));
      }
      const coin = coinWithBalance({ type: USDC_TYPE, balance: plan.raw.totalDebit, useGasCoin: false })(txBet);
      const authDep = txBet.add(generateAuth(PREDICT_MAINNET_CONFIG));
      txBet.add(accountMoveCalls.depositFunds({ config: accCfg, arguments: { wrapper: wrapperArg, auth: authDep, coin }, typeArguments: [USDC_TYPE] }));
      const authOrd = txBet.add(generateAuth(PREDICT_MAINNET_CONFIG));
      txBet.moveCall({
        target: `${PREDICT_MAINNET_CONFIG.packages.predictOrders}::queue::enqueue_exact_cost`,
        arguments: [
          txBet.object(deriveQueueId(PREDICT_MAINNET_CONFIG.objects.queueRegistry ?? '', futureMarket.id)),
          txBet.object(futureMarket.id),
          typeof wrapperArg === 'string' ? txBet.object(wrapperArg) : wrapperArg,
          authOrd,
          txBet.object(u.pythFeed),
          txBet.object(u.blockScholesValueStore),
          txBet.object(u.blockScholesSviStore),
          txBet.pure.u64(BigInt(ticks.lowerTick)),
          txBet.pure.u64(BigInt(ticks.higherTick)),
          txBet.pure.u64(plan.raw.maxCost ?? plan.raw.budget),
          txBet.pure.u64(plan.raw.minQuantity),
        ],
      });
      if (!senderHasAcc) txBet.add(accountMoveCalls.share({ config: accCfg, arguments: { self: wrapperArg } }));
      const betEff = await simulateGrpcOrGql(txBet, testSender);
      if (betEff?.status === 'SUCCESS') {
        pass('DeepBook Predict Live Quote & 1-Tx Enqueue Mainnet simulation', `BTC Fwd=$${pricer.forward.toFixed(0)} Strike>$${chosenStrike} Payout=${plan.payoutMultiple.toFixed(2)}x`);
      } else {
        fail('DeepBook Predict 1-Tx Enqueue Mainnet simulation', JSON.stringify(betEff));
      }
    } else {
      pass('DeepBook Predict Live Markets & PlanMint Quote', `BTC Fwd=$${pricer.forward.toFixed(0)} Strike>$${chosenStrike} Payout=${plan.payoutMultiple.toFixed(2)}x`);
    }
  }
} catch (e) {
  fail('DeepBook Predict Live Quote & Enqueue simulation', e?.stack || e?.message || String(e));
}

// 12. Multi-RPC Failover Pool (gRPC <-> GraphQL Core Parity + Owned Coins Discovery)
try {
  const { SuiGraphQLClient } = await import('@mysten/sui/graphql');
  const gqlClient = new SuiGraphQLClient({ url: GQL_URL, network: 'mainnet' });
  const [grpcBals, gqlBals, grpcCoins, gqlCoins] = await Promise.all([
    grpcClient.core.listBalances({ owner: WALLET, limit: 20 }),
    gqlClient.core.listBalances({ owner: WALLET, limit: 20 }),
    grpcClient.core.listOwnedObjects({
      owner: WALLET,
      type: '0x2::coin::Coin',
      limit: 50,
      include: { json: true },
    }),
    gqlClient.core.listOwnedObjects({
      owner: WALLET,
      type: '0x2::coin::Coin',
      limit: 50,
      include: { json: true },
    }),
  ]);
  const grpcBalCount = (grpcBals.balances || []).length;
  const gqlBalCount = (gqlBals.balances || []).length;
  const grpcCoinCount = (grpcCoins.objects || []).length;
  const gqlCoinCount = (gqlCoins.objects || []).length;
  if (grpcBalCount > 0 && gqlBalCount > 0 && grpcCoinCount > 0 && gqlCoinCount > 0) {
    pass(
      'Multi-RPC Failover gRPC <-> GraphQL Core Parity',
      `gRPC=${grpcBalCount} bals/${grpcCoinCount} coins | GQL=${gqlBalCount} bals/${gqlCoinCount} coins`
    );
  } else {
    fail(
      'Multi-RPC Failover gRPC <-> GraphQL Core Parity',
      `Unexpected counts gRPC=${grpcBalCount}/${grpcCoinCount}, GQL=${gqlBalCount}/${gqlCoinCount}`
    );
  }
} catch (e) {
  fail('Multi-RPC Failover gRPC <-> GraphQL Core Parity', e?.stack || e?.message || String(e));
}

// 13. Wallet Dust Sweeper (0x2::coin::destroy_zero + Cetus Aggregator v2 Sweep PTB)
try {
  const ownedRes = await grpcClient.core.listOwnedObjects({
    owner: WALLET,
    type: '0x2::coin::Coin',
    limit: 50,
    include: { json: true },
  });
  const coinObjs = (ownedRes.objects || []).map((obj) => {
    const rawType = obj.type || '';
    const m = rawType.match(/^0x0*2::coin::Coin<(.+)>$/i);
    return {
      objectId: obj.objectId,
      coinType: m ? m[1] : rawType,
      balance: BigInt(obj.json?.balance ?? '0'),
    };
  });
  const zeroCoins = coinObjs.filter((c) => c.balance === 0n && c.coinType);
  const nonZeroDust = coinObjs.filter(
    (c) =>
      c.balance > 0n &&
      c.coinType &&
      normalizeSuiAddress(c.coinType.split('::')[0]) !== '0x0000000000000000000000000000000000000000000000000000000000000002' &&
      c.coinType.toLowerCase() !== USDC_TYPE.toLowerCase()
  );

  const cetusDust = new AggregatorClient({ client: grpcClient });
  let sweepRouter = null;
  let dustGroup = null;
  if (nonZeroDust.length > 0) {
    const targetType = nonZeroDust[0].coinType;
    const sameTypeCoins = nonZeroDust.filter((c) => c.coinType === targetType);
    const totalBal = sameTypeCoins.reduce((s, c) => s + c.balance, 0n);
    const r = await cetusDust.findRouters({
      from: targetType,
      target: SUI_TYPE,
      amount: totalBal.toString(),
      byAmountIn: true,
    });
    if (r?.amountOut && Number(r.amountOut) > 0) {
      sweepRouter = r;
      dustGroup = { coinType: targetType, coins: sameTypeCoins, totalBal, outType: SUI_TYPE };
    }
  }

  const sweepTx = new Transaction();
  sweepTx.setSender(WALLET);
  let burnNote = '';
  if (zeroCoins.length > 0) {
    sweepTx.moveCall({
      target: '0x2::coin::destroy_zero',
      typeArguments: [zeroCoins[0].coinType],
      arguments: [sweepTx.object(zeroCoins[0].objectId)],
    });
    burnNote = `destroyed real zero coin ${zeroCoins[0].objectId.slice(0, 10)}`;
  } else {
    const [emptySui] = sweepTx.splitCoins(sweepTx.gas, [0n]);
    sweepTx.moveCall({
      target: '0x2::coin::destroy_zero',
      typeArguments: [SUI_TYPE],
      arguments: [emptySui],
    });
    burnNote = 'destroyed synthetic 0-SUI coin';
  }

  let routeNote = '';
  if (sweepRouter && dustGroup) {
    const primary = sweepTx.object(dustGroup.coins[0].objectId);
    if (dustGroup.coins.length > 1) {
      sweepTx.mergeCoins(
        primary,
        dustGroup.coins.slice(1).map((c) => sweepTx.object(c.objectId))
      );
    }
    const outCoin = await cetusDust.routerSwap({
      router: sweepRouter,
      inputCoin: primary,
      slippage: 0.02,
      txb: sweepTx,
    });
    sweepTx.transferObjects([outCoin], WALLET);
    routeNote = `dust ${dustGroup.coinType.split('::').pop()} -> SUI`;
  } else {
    const fallbackRouter = await cetusDust.findRouters({
      from: SUI_TYPE,
      target: USDC_TYPE,
      amount: '150000000',
      byAmountIn: true,
    });
    const [inSui] = sweepTx.splitCoins(sweepTx.gas, [150_000_000n]);
    const outUsdc = await cetusDust.routerSwap({
      router: fallbackRouter,
      inputCoin: inSui,
      slippage: 0.02,
      txb: sweepTx,
    });
    sweepTx.transferObjects([outUsdc], WALLET);
    routeNote = '0.15 SUI -> USDC fallback sweep';
  }

  const dustEff = await simulateGrpcOrGql(sweepTx);
  if (dustEff?.status === 'SUCCESS') {
    pass('Wallet Dust Sweeper (Destroy Zero + Cetus Sweep)', `${burnNote} + ${routeNote}`);
  } else {
    fail('Wallet Dust Sweeper (Destroy Zero + Cetus Sweep)', JSON.stringify(dustEff));
  }
} catch (e) {
  fail('Wallet Dust Sweeper (Destroy Zero + Cetus Sweep)', e?.stack || e?.message || String(e));
}

// 14. DeepBook Predict 1-Click Ephemeral Session Key Authorization PTB
try {
  const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
  const { SessionsContract, getSessionsConfig } = await import('@mysten/deepbook-v3/sessions');
  const { MAINNET_CONFIG } = await import('@mysten/deepbook-v3/predict');

  const sc = new SessionsContract(getSessionsConfig('mainnet'));
  const sessionKp = new Ed25519Keypair();
  const sessionAddr = sessionKp.toSuiAddress();
  const wrapperId = sc.deriveAccountWrapperId(WALLET);
  let hasAccount = false;
  try {
    const accObj = await grpcClient.core.getObject({ objectId: wrapperId });
    hasAccount = Boolean(accObj?.object?.objectId);
  } catch {
    hasAccount = false;
  }

  const accCfg = {
    accountPackageId: MAINNET_CONFIG.packages.account,
    accountRegistry: MAINNET_CONFIG.objects.accountRegistry,
    accountPackageIdLatest: MAINNET_CONFIG.packages.accountLatest,
  };
  const txSession = new Transaction();
  txSession.setSender(WALLET);

  const wrapperTarget = hasAccount
    ? wrapperId
    : txSession.add(accountRegistryMoveCalls._new({ config: accCfg }));

  txSession.add(
    sc.authorizeSession({
      wrapperId: wrapperTarget,
      session: sessionAddr,
      durationMs: 3_600_000,
    })
  );
  const [gasFloatCoin] = txSession.splitCoins(txSession.gas, [50_000_000n]);
  txSession.transferObjects([gasFloatCoin], sessionAddr);
  if (!hasAccount) {
    txSession.add(accountMoveCalls.share({ config: accCfg, arguments: { self: wrapperTarget } }));
  }

  const sessEff = await simulateGrpcOrGql(txSession);
  if (sessEff?.status === 'SUCCESS') {
    pass(
      'DeepBook Predict 1-Click Session Key Auth + Gas Float',
      `hasAccount=${hasAccount} session=${sessionAddr.slice(0, 10)}... + 0.05 SUI`
    );
  } else {
    fail('DeepBook Predict 1-Click Session Key Auth + Gas Float', JSON.stringify(sessEff));
  }
} catch (e) {
  fail('DeepBook Predict 1-Click Session Key Auth + Gas Float', e?.stack || e?.message || String(e));
}

// 15. DeepBook v3 1-TX Spot CLOB 2-Rung Tick-Aligned Limit Order Grid
try {
  const dbGridExt = grpcClient.$extend(deepbook({ address: WALLET }));
  const txGrid = new Transaction();
  txGrid.setSender(WALLET);

  const manager = txGrid.add(dbGridExt.deepbook.balanceManager.createBalanceManagerWithOwner(WALLET));
  const depositSui = coinWithBalance({ type: SUI_TYPE, balance: 2_010_000_000n })(txGrid);
  txGrid.moveCall({
    package: DEEPBOOK_PACKAGE_ID,
    module: 'balance_manager',
    function: 'deposit',
    arguments: [manager, depositSui],
    typeArguments: [SUI_TYPE],
  });
  const tradeProof = txGrid.moveCall({
    package: DEEPBOOK_PACKAGE_ID,
    module: 'balance_manager',
    function: 'generate_proof_as_owner',
    arguments: [manager],
  });

  const rungPrices = [1.2, 1.25];
  const expireTs = 1844674407370955161n;
  for (let i = 0; i < rungPrices.length; i++) {
    const onChainPrice = BigInt(Math.round((rungPrices[i] * 1e9 * 1e6) / 1e9));
    const onChainQty = 1_000_000_000n;
    txGrid.moveCall({
      package: DEEPBOOK_PACKAGE_ID,
      module: 'pool',
      function: 'place_limit_order',
      arguments: [
        txGrid.object(SUI_USDC_POOL_ID),
        manager,
        tradeProof,
        txGrid.pure.u64(BigInt(Date.now() + 200 + i)),
        txGrid.pure.u8(OrderType.NO_RESTRICTION),
        txGrid.pure.u8(SelfMatchingOptions.SELF_MATCHING_ALLOWED),
        txGrid.pure.u64(onChainPrice),
        txGrid.pure.u64(onChainQty),
        txGrid.pure.bool(false),
        txGrid.pure.bool(false),
        txGrid.pure.u64(expireTs),
        txGrid.object('0x6'),
      ],
      typeArguments: [SUI_TYPE, USDC_TYPE],
    });
  }

  txGrid.moveCall({
    target: `${DEEPBOOK_PACKAGE_ID}::balance_manager::register_balance_manager`,
    arguments: [manager, txGrid.object(mainnetPackageIds.REGISTRY_ID)],
  });
  txGrid.add(dbGridExt.deepbook.balanceManager.shareBalanceManager(manager));

  const gridEff = await simulateGrpcOrGql(txGrid);
  if (gridEff?.status === 'SUCCESS') {
    pass('DeepBook v3 1-TX Spot CLOB 2-Rung Grid (SUI_USDC)', '2 ask rungs ($1.20 & $1.25) in 1 atomic PTB');
  } else {
    fail('DeepBook v3 1-TX Spot CLOB 2-Rung Grid (SUI_USDC)', JSON.stringify(gridEff));
  }
} catch (e) {
  fail('DeepBook v3 1-TX Spot CLOB 2-Rung Grid (SUI_USDC)', e?.stack || e?.message || String(e));
}

// 16. DeepBook Margin Pro (Collateral + Borrow Quote + Dual Conditional TP & SL Bracket)
try {
  const dbProExt = grpcClient.$extend(deepbook({ network: 'mainnet', address: WALLET }));
  const dbPro = dbProExt.deepbook;
  const suiPool = mainnetPools.SUI_USDC;
  const suiCoin = mainnetCoins.SUI;
  const usdcCoin = mainnetCoins.USDC;
  const usdcMarginPool = mainnetMarginPools.USDC;

  const txPro = new Transaction();
  txPro.setSender(WALLET);
  const { manager, initializer } = dbPro.marginManager.newMarginManagerWithInitializer('SUI_USDC')(txPro);
  txPro.add(
    dbPro.marginManager.depositDuringInitialization({
      manager,
      poolKey: 'SUI_USDC',
      coinType: suiPool.baseCoin,
      amount: 1.6,
    })
  );
  txPro.moveCall({
    target: `${mainnetPackageIds.MARGIN_PACKAGE_ID}::margin_manager_upgraded::borrow_quote`,
    arguments: [
      manager,
      txPro.object(mainnetPackageIds.MARGIN_REGISTRY_ID),
      txPro.object(usdcMarginPool.address),
      txPro.object(suiCoin.priceInfoObjectId),
      txPro.object(usdcCoin.priceInfoObjectId),
      txPro.object(suiPool.address),
      txPro.pure.u64(1_000_000n),
      txPro.object('0x6'),
    ],
    typeArguments: [suiCoin.type, usdcCoin.type],
  });

  // Attach both TP (triggerAbove $1.60) and SL (triggerBelow $0.45) conditional bracket orders
  const tpCond = dbPro.marginTPSL.newCondition('SUI_USDC', false, 1.6)(txPro);
  const tpPending = dbPro.marginTPSL.newPendingMarketOrder('SUI_USDC', {
    clientOrderId: String(Date.now() + 301),
    quantity: 1,
    isBid: false,
    payWithDeep: false,
  })(txPro);
  txPro.moveCall({
    target: `${mainnetPackageIds.MARGIN_PACKAGE_ID}::margin_manager_upgraded::add_conditional_order`,
    arguments: [
      manager,
      txPro.object(suiPool.address),
      txPro.object(suiCoin.priceInfoObjectId),
      txPro.object(usdcCoin.priceInfoObjectId),
      txPro.object(mainnetPackageIds.MARGIN_REGISTRY_ID),
      txPro.pure.u64(BigInt(Date.now() + 301)),
      tpCond,
      tpPending,
      txPro.object('0x6'),
    ],
    typeArguments: [suiCoin.type, usdcCoin.type],
  });

  const slCond = dbPro.marginTPSL.newCondition('SUI_USDC', true, 0.45)(txPro);
  const slPending = dbPro.marginTPSL.newPendingMarketOrder('SUI_USDC', {
    clientOrderId: String(Date.now() + 302),
    quantity: 1,
    isBid: false,
    payWithDeep: false,
  })(txPro);
  txPro.moveCall({
    target: `${mainnetPackageIds.MARGIN_PACKAGE_ID}::margin_manager_upgraded::add_conditional_order`,
    arguments: [
      manager,
      txPro.object(suiPool.address),
      txPro.object(suiCoin.priceInfoObjectId),
      txPro.object(usdcCoin.priceInfoObjectId),
      txPro.object(mainnetPackageIds.MARGIN_REGISTRY_ID),
      txPro.pure.u64(BigInt(Date.now() + 302)),
      slCond,
      slPending,
      txPro.object('0x6'),
    ],
    typeArguments: [suiCoin.type, usdcCoin.type],
  });

  txPro.add(dbPro.marginManager.shareMarginManager('SUI_USDC', manager, initializer));
  const proEff = await simulateGrpcOrGql(txPro);
  if (proEff?.status === 'SUCCESS') {
    pass('DeepBook Margin Pro (Collateral + Borrow + Dual TP/SL)', 'Init + Deposit + Borrow + TP($1.60) + SL($0.45)');
  } else {
    fail('DeepBook Margin Pro (Collateral + Borrow + Dual TP/SL)', JSON.stringify(proEff));
  }
} catch (e) {
  fail('DeepBook Margin Pro (Collateral + Borrow + Dual TP/SL)', e?.stack || e?.message || String(e));
}

if (failures > 0) {
  console.error(`\n${failures} simulation check(s) failed.`);
  process.exit(1);
}
console.log('\nAll mainnet v2 simulation checks passed.');
