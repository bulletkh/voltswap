import { AggregatorClient, type RouterDataV3 } from '@cetusprotocol/aggregator-sdk';
import { Transaction, type TransactionObjectArgument } from '@mysten/sui/transactions';
import { POPULAR_TOKENS } from './constants';
import {
  rpcListAllOwnedCoins,
  safeNormalizeCoinType,
  SUI_COIN_TYPE,
  suiGrpcClient,
} from './suiClient';
import { type OwnedCoinObject } from './suiRpcPool';
import { appendVoltFeeCoinSplit, calcFeeUnits, resolveTraderTier } from './voltFee';

export const SWEEP_USDC_COIN_TYPE =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

export type DustSweepTarget = 'SUI' | 'USDC';

export interface DustCoinGroup {
  coinType: string;
  normalizedType: string;
  symbol: string;
  name: string;
  decimals: number;
  logo?: string;
  coins: OwnedCoinObject[];
  totalBalance: bigint;
  formattedAmount: string;
  estimatedOutRaw: bigint;
  estimatedOutUi: number;
  estimatedUsd: number;
  routable: boolean;
  skipReason?: string;
  router?: RouterDataV3;
}

export interface FragmentedCoinGroup {
  coinType: string;
  normalizedType: string;
  symbol: string;
  objectCount: number;
  totalBalance: bigint;
  coins: OwnedCoinObject[];
}

export interface WalletDustScanResult {
  zeroCoins: OwnedCoinObject[];
  estimatedZeroRebateSui: number;
  fragmentedGroups: FragmentedCoinGroup[];
  dustGroups: DustCoinGroup[];
  totalObjectsScanned: number;
  targetSymbol: DustSweepTarget;
  targetPriceUsd: number;
}

const TOKEN_BY_TYPE = new Map(
  POPULAR_TOKENS.filter((t) => t.chain === 'sui').map((t) => [
    safeNormalizeCoinType(t.address),
    t,
  ])
);

let sharedAggregator: AggregatorClient | null = null;
function getAggregator(): AggregatorClient {
  if (!sharedAggregator) {
    sharedAggregator = new AggregatorClient({ client: suiGrpcClient as any });
  }
  return sharedAggregator;
}

export function getTargetCoinType(target: DustSweepTarget): string {
  return target === 'USDC' ? SWEEP_USDC_COIN_TYPE : SUI_COIN_TYPE;
}

function getTargetMeta(target: DustSweepTarget): { coinType: string; decimals: number; priceUsd: number } {
  if (target === 'USDC') {
    return {
      coinType: safeNormalizeCoinType(SWEEP_USDC_COIN_TYPE),
      decimals: 6,
      priceUsd: 1,
    };
  }
  const suiToken = TOKEN_BY_TYPE.get(safeNormalizeCoinType(SUI_COIN_TYPE));
  return {
    coinType: safeNormalizeCoinType(SUI_COIN_TYPE),
    decimals: 9,
    priceUsd: suiToken?.priceUsd ?? 0.86,
  };
}

function formatUnits(raw: bigint, decimals: number): string {
  const num = Number(raw) / 10 ** Math.min(18, Math.max(0, decimals));
  if (!Number.isFinite(num)) return '0';
  if (num >= 1000) return num.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (num >= 1) return num.toFixed(4);
  if (num >= 0.0001) return num.toFixed(6);
  return num.toExponential(2);
}

function fallbackSymbolFromType(coinType: string): string {
  const parts = coinType.split('::');
  return parts[parts.length - 1] || 'COIN';
}

export async function scanWalletDust(
  owner: string,
  targetSymbol: DustSweepTarget = 'SUI'
): Promise<WalletDustScanResult> {
  const ownedCoins = await rpcListAllOwnedCoins(owner);
  const zeroCoins: OwnedCoinObject[] = [];
  const nonZeroByType = new Map<string, OwnedCoinObject[]>();

  for (const coin of ownedCoins) {
    if (coin.balance <= 0n) {
      zeroCoins.push(coin);
      continue;
    }
    const norm = safeNormalizeCoinType(coin.coinType);
    const arr = nonZeroByType.get(norm);
    if (arr) {
      arr.push(coin);
    } else {
      nonZeroByType.set(norm, [coin]);
    }
  }

  const suiNorm = safeNormalizeCoinType(SUI_COIN_TYPE);
  const targetMeta = getTargetMeta(targetSymbol);

  const fragmentedGroups: FragmentedCoinGroup[] = [];
  const candidateEntries: Array<{ norm: string; coins: OwnedCoinObject[] }> = [];

  for (const [norm, coins] of nonZeroByType.entries()) {
    if (coins.length >= 2 && norm !== suiNorm) {
      const known = TOKEN_BY_TYPE.get(norm);
      fragmentedGroups.push({
        coinType: coins[0].coinType,
        normalizedType: norm,
        symbol: known?.symbol ?? fallbackSymbolFromType(coins[0].coinType),
        objectCount: coins.length,
        totalBalance: coins.reduce((acc, c) => acc + c.balance, 0n),
        coins,
      });
    }
    if (norm === suiNorm || norm === targetMeta.coinType) continue;
    candidateEntries.push({ norm, coins });
  }

  // Fetch metadata & Cetus routes concurrently for top candidates (bounded to 24 types)
  const limited = candidateEntries.slice(0, 24);
  const agg = getAggregator();

  const dustGroups = await Promise.all(
    limited.map(async ({ norm, coins }): Promise<DustCoinGroup> => {
      const rawType = coins[0].coinType;
      const totalBalance = coins.reduce((acc, c) => acc + c.balance, 0n);
      const known = TOKEN_BY_TYPE.get(norm);

      let symbol = known?.symbol ?? fallbackSymbolFromType(rawType);
      let name = known?.name ?? symbol;
      let decimals = known?.decimals ?? 9;
      let logo = known?.logo;

      if (!known) {
        try {
          const metaRes = await suiGrpcClient.core.getCoinMetadata({ coinType: rawType });
          const md = metaRes.coinMetadata;
          if (md) {
            symbol = md.symbol || symbol;
            name = md.name || name;
            decimals = typeof md.decimals === 'number' ? md.decimals : decimals;
            logo = md.iconUrl ?? undefined;
          }
        } catch {
          // keep fallback metadata
        }
      }

      const formattedAmount = formatUnits(totalBalance, decimals);

      if (totalBalance <= 10n) {
        return {
          coinType: rawType,
          normalizedType: norm,
          symbol,
          name,
          decimals,
          logo,
          coins,
          totalBalance,
          formattedAmount,
          estimatedOutRaw: 0n,
          estimatedOutUi: 0,
          estimatedUsd: 0,
          routable: false,
          skipReason: 'Sub-unit airdrop (untradeable)',
        };
      }

      try {
        const router = await agg.findRouters({
          from: rawType,
          target: getTargetCoinType(targetSymbol),
          amount: totalBalance.toString(),
          byAmountIn: true,
        });
        if (!router || router.insufficientLiquidity || BigInt(router.amountOut.toString()) <= 0n) {
          return {
            coinType: rawType,
            normalizedType: norm,
            symbol,
            name,
            decimals,
            logo,
            coins,
            totalBalance,
            formattedAmount,
            estimatedOutRaw: 0n,
            estimatedOutUi: 0,
            estimatedUsd: 0,
            routable: false,
            skipReason: 'No active DEX pool route',
          };
        }
        const outRaw = BigInt(router.amountOut.toString());
        const outUi = Number(outRaw) / 10 ** targetMeta.decimals;
        const estimatedUsd = outUi * targetMeta.priceUsd;
        return {
          coinType: rawType,
          normalizedType: norm,
          symbol,
          name,
          decimals,
          logo,
          coins,
          totalBalance,
          formattedAmount,
          estimatedOutRaw: outRaw,
          estimatedOutUi: outUi,
          estimatedUsd,
          routable: true,
          router,
          skipReason: estimatedUsd < 0.005 ? 'Worth less than gas (~$0.003)' : undefined,
        };
      } catch {
        return {
          coinType: rawType,
          normalizedType: norm,
          symbol,
          name,
          decimals,
          logo,
          coins,
          totalBalance,
          formattedAmount,
          estimatedOutRaw: 0n,
          estimatedOutUi: 0,
          estimatedUsd: 0,
          routable: false,
          skipReason: 'Quote unavailable',
        };
      }
    })
  );

  // Sort routable tokens first (dust <= $15 prioritized), then unroutable tokens
  dustGroups.sort((a, b) => {
    if (a.routable !== b.routable) return a.routable ? -1 : 1;
    if (a.routable && b.routable) {
      const aSweet = a.estimatedUsd >= 0.005 && a.estimatedUsd <= 15 ? 0 : 1;
      const bSweet = b.estimatedUsd >= 0.005 && b.estimatedUsd <= 15 ? 0 : 1;
      if (aSweet !== bSweet) return aSweet - bSweet;
      return b.estimatedUsd - a.estimatedUsd;
    }
    return a.symbol.localeCompare(b.symbol);
  });

  // Standard Sui storage rebate for destroying an empty Coin<T> object is ~0.0023-0.0025 SUI
  const estimatedZeroRebateSui = Number((zeroCoins.length * 0.0024).toFixed(4));

  return {
    zeroCoins,
    estimatedZeroRebateSui,
    fragmentedGroups,
    dustGroups,
    totalObjectsScanned: ownedCoins.length,
    targetSymbol,
    targetPriceUsd: targetMeta.priceUsd,
  };
}

/**
 * Burns empty (`balance == 0`) Coin<T> objects via `0x2::coin::destroy_zero`
 * to reclaim locked SUI storage rebates with 0% Volt fee.
 */
export function buildBurnZeroCoinsTx(
  owner: string,
  zeroCoins: OwnedCoinObject[],
  maxPerTx = 45
): Transaction {
  if (zeroCoins.length === 0) {
    throw new Error('No empty coin objects to burn.');
  }
  const tx = new Transaction();
  tx.setSender(owner);
  for (const coin of zeroCoins.slice(0, maxPerTx)) {
    tx.moveCall({
      target: '0x2::coin::destroy_zero',
      typeArguments: [coin.coinType],
      arguments: [tx.object(coin.objectId)],
    });
  }
  return tx;
}

/**
 * Consolidates duplicate non-SUI Coin<T> objects of the same type into single coins.
 */
export function buildMergeFragmentedCoinsTx(
  owner: string,
  groups: FragmentedCoinGroup[],
  maxMerges = 40
): Transaction {
  const tx = new Transaction();
  tx.setSender(owner);
  let mergedObjects = 0;
  for (const grp of groups) {
    if (grp.coins.length < 2) continue;
    const primary = tx.object(grp.coins[0].objectId);
    const rest = grp.coins
      .slice(1, 1 + Math.max(0, maxMerges - mergedObjects))
      .map((c) => tx.object(c.objectId));
    if (rest.length > 0) {
      tx.mergeCoins(primary, rest);
      mergedObjects += rest.length;
    }
    if (mergedObjects >= maxMerges) break;
  }
  if (mergedObjects === 0) {
    throw new Error('No duplicate coin objects to merge.');
  }
  return tx;
}

export interface BuildDustSweepParams {
  owner: string;
  groups: DustCoinGroup[];
  targetSymbol: DustSweepTarget;
  slippage?: number;
  volumeUsd?: number;
  zeroCoins?: OwnedCoinObject[];
  alsoBurnZeroCoins?: boolean;
}

/**
 * Atomically merges, batch-swaps up to 6 selected dust tokens into SUI or USDC via Cetus v2 Aggregator,
 * optionally burns up to 15 empty Coin<T> objects for gas rebate, splits Volt tiered swap fee + referral
 * rev-share in the clean output coin, and transfers the net proceeds to the user.
 */
export async function buildDustSweepTx({
  owner,
  groups,
  targetSymbol,
  slippage = 0.02,
  volumeUsd = 0,
  zeroCoins = [],
  alsoBurnZeroCoins = true,
}: BuildDustSweepParams): Promise<{
  tx: Transaction;
  sweptCount: number;
  burnedCount: number;
  estimatedTotalOutUi: number;
}> {
  const agg = getAggregator();
  const targetCoinType = getTargetCoinType(targetSymbol);
  const targetMeta = getTargetMeta(targetSymbol);
  const chosen = groups.filter((g) => g.routable && g.totalBalance > 0n).slice(0, 6);

  if (chosen.length === 0) {
    throw new Error('Select at least one routable token to sweep.');
  }

  const tx = new Transaction();
  tx.setSender(owner);

  let burnedCount = 0;
  if (alsoBurnZeroCoins && zeroCoins.length > 0) {
    for (const zc of zeroCoins.slice(0, 15)) {
      tx.moveCall({
        target: '0x2::coin::destroy_zero',
        typeArguments: [zc.coinType],
        arguments: [tx.object(zc.objectId)],
      });
      burnedCount += 1;
    }
  }

  const outputCoins: TransactionObjectArgument[] = [];
  let minGuaranteedOutRaw = 0n;
  let estimatedOutRawSum = 0n;

  for (const grp of chosen) {
    const freshRouter = await agg.findRouters({
      from: grp.coinType,
      target: targetCoinType,
      amount: grp.totalBalance.toString(),
      byAmountIn: true,
    });
    const router = freshRouter && !freshRouter.insufficientLiquidity ? freshRouter : grp.router;
    if (!router) {
      throw new Error(`No live route for ${grp.symbol} -> ${targetSymbol}`);
    }

    const primaryIn = tx.object(grp.coins[0].objectId);
    if (grp.coins.length > 1) {
      tx.mergeCoins(
        primaryIn,
        grp.coins.slice(1).map((c) => tx.object(c.objectId))
      );
    }

    const outCoin = await agg.routerSwap({
      router,
      inputCoin: primaryIn,
      slippage,
      txb: tx as any,
    });

    outputCoins.push(outCoin as unknown as TransactionObjectArgument);
    const outAmt = BigInt(router.amountOut.toString());
    estimatedOutRawSum += outAmt;
    const minOut = BigInt(Math.floor(Number(outAmt) * Math.max(0.5, 1 - slippage)));
    minGuaranteedOutRaw += minOut;
  }

  const primaryOut = outputCoins[0];
  if (outputCoins.length > 1) {
    tx.mergeCoins(primaryOut, outputCoins.slice(1));
  }

  // Charge standard tiered swap fee strictly from guaranteed minimum output so splitCoins never aborts
  const tier = resolveTraderTier(volumeUsd, false);
  const feeUnits = calcFeeUnits(minGuaranteedOutRaw, tier.feeRate);
  if (feeUnits > 0n) {
    appendVoltFeeCoinSplit(tx, primaryOut, feeUnits, owner, 0.25);
  }
  tx.transferObjects([primaryOut], owner);

  return {
    tx,
    sweptCount: chosen.length,
    burnedCount,
    estimatedTotalOutUi: Number(estimatedOutRawSum) / 10 ** targetMeta.decimals,
  };
}
