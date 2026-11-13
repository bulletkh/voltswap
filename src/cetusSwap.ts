import { AggregatorClient, type RouterDataV3 } from '@cetusprotocol/aggregator-sdk';
import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import { safeNormalizeCoinType, suiGrpcClient, SUI_COIN_TYPE } from './suiClient';
import { appendVoltFeeCoinSplit, calcFeeUnits } from './voltFee';

export interface CetusQuoteResult {
  router: RouterDataV3;
  amountOutAtomic: bigint;
  feeUnits: bigint;
  netInputUnits: bigint;
  dexHops: string[];
  priceImpactPct: number;
}

function isSuiCoin(coinType: string): boolean {
  const norm = safeNormalizeCoinType(coinType);
  return norm === safeNormalizeCoinType(SUI_COIN_TYPE) || coinType.endsWith('::sui::SUI');
}

function extractDexHops(router: any): string[] {
  const labels = new Set<string>();
  const paths = router?.paths || [];
  for (const p of paths) {
    if (p?.provider) labels.add(String(p.provider));
  }
  return labels.size > 0 ? Array.from(labels) : ['Cetus Aggregator'];
}

export async function fetchCetusQuote(params: {
  fromCoinType: string;
  toCoinType: string;
  amountInAtomic: bigint;
  feeRate: number;
}): Promise<CetusQuoteResult> {
  if (params.amountInAtomic <= 0n) {
    throw new Error('Enter a positive swap amount.');
  }
  const feeUnits = calcFeeUnits(params.amountInAtomic, params.feeRate);
  const netInputUnits = params.amountInAtomic - feeUnits;
  if (netInputUnits <= 0n) {
    throw new Error('Swap amount too small after protocol fee.');
  }

  const cetus = new AggregatorClient({ client: suiGrpcClient as any });
  const router = await cetus.findRouters({
    from: params.fromCoinType,
    target: params.toCoinType,
    amount: netInputUnits.toString(),
    byAmountIn: true,
  });

  const amountOutAtomic = BigInt(String(router?.amountOut || '0'));
  if (!router || amountOutAtomic <= 0n) {
    throw new Error('No Cetus liquidity route found for this pair.');
  }

  return {
    router,
    amountOutAtomic,
    feeUnits,
    netInputUnits,
    dexHops: extractDexHops(router),
    priceImpactPct: Number((router as any)?.deviationRatio || 0) * 100,
  };
}

export async function buildCetusSwapTx(params: {
  sender: string;
  fromCoinType: string;
  amountInAtomic: bigint;
  quote: CetusQuoteResult;
  slippage?: number;
  refSharePct?: number;
}): Promise<Transaction> {
  const cetus = new AggregatorClient({ client: suiGrpcClient as any });
  const tx = new Transaction();
  tx.setSender(params.sender);

  const isSui = isSuiCoin(params.fromCoinType);
  const { feeUnits, netInputUnits, router } = params.quote;

  if (isSui) {
    if (feeUnits > 0n) {
      appendVoltFeeCoinSplit(tx, tx.gas, feeUnits, params.sender, params.refSharePct ?? 0.25);
    }
    const [swapCoin] = tx.splitCoins(tx.gas, [netInputUnits]);
    const outCoin = await cetus.routerSwap({
      router,
      inputCoin: swapCoin as any,
      slippage: params.slippage ?? 0.01,
      txb: tx as any,
    });
    tx.transferObjects([outCoin as any], params.sender);
  } else {
    const sourceCoin = tx.add(
      coinWithBalance({
        type: params.fromCoinType,
        balance: params.amountInAtomic,
      })
    );
    if (feeUnits > 0n) {
      appendVoltFeeCoinSplit(
        tx,
        sourceCoin,
        feeUnits,
        params.sender,
        params.refSharePct ?? 0.25
      );
    }
    const outCoin = await cetus.routerSwap({
      router,
      inputCoin: sourceCoin as any,
      slippage: params.slippage ?? 0.01,
      txb: tx as any,
    });
    tx.transferObjects([outCoin as any], params.sender);
  }

  return tx;
}
