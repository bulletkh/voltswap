import { coinWithBalance, Transaction, type TransactionObjectArgument } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { toBase64 } from '@mysten/sui/utils';
import { TRADER_TIERS, VOLT_TREASURY_ADDRESS, type TraderTierConfig } from './constants';
import { safeNormalizeAddress, safeNormalizeCoinType, SUI_COIN_TYPE } from './suiClient';

export const REFERRAL_STORAGE_KEY = 'volt_ref_address';
export const VOLUME_STORAGE_PREFIX = 'volt_vol_usd_';

export interface ReferralTierInfo {
  name: string;
  minVolumeUsd: number;
  revSharePct: number; // e.g. 0.25 = 25%
  badgeColor: string;
  description: string;
}

export const REFERRAL_TIERS: ReferralTierInfo[] = [
  {
    name: 'Volt Scout',
    minVolumeUsd: 0,
    revSharePct: 0.25,
    badgeColor: '#38BDF8',
    description: 'Instant 25% atomic fee rev-share on every referred swap & perp trade.',
  },
  {
    name: 'Volt Commander',
    minVolumeUsd: 25_000,
    revSharePct: 0.35,
    badgeColor: '#A855F7',
    description: '35% instant on-chain PTB split unlocked at $25,000 personal or network volume.',
  },
  {
    name: 'Whale Syndicate',
    minVolumeUsd: 250_000,
    revSharePct: 0.50,
    badgeColor: '#EAFD60',
    description: 'Maximum 50% direct protocol split settled in the same Sui transaction.',
  },
];

export function captureReferralFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const candidate = safeNormalizeAddress(params.get('ref'));
  if (candidate) {
    try {
      localStorage.setItem(REFERRAL_STORAGE_KEY, candidate);
    } catch {
      // ignore storage errors
    }
    return candidate;
  }
  return getStoredReferrer();
}

export function getStoredReferrer(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return safeNormalizeAddress(localStorage.getItem(REFERRAL_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function getValidReferrerForSender(sender?: string | null): string | null {
  const ref = getStoredReferrer();
  if (!ref) return null;
  const normSender = safeNormalizeAddress(sender);
  if (normSender && normSender === ref) return null;
  if (ref === safeNormalizeAddress(VOLT_TREASURY_ADDRESS)) return null;
  return ref;
}

export function getWalletVolumeUsd(address?: string | null): number {
  if (typeof window === 'undefined' || !address) return 0;
  try {
    const raw = localStorage.getItem(`${VOLUME_STORAGE_PREFIX}${address.toLowerCase()}`);
    const val = raw ? Number(raw) : 0;
    return Number.isFinite(val) && val > 0 ? val : 0;
  } catch {
    return 0;
  }
}

export function addWalletVolumeUsd(address: string, deltaUsd: number): number {
  if (typeof window === 'undefined' || !address || !Number.isFinite(deltaUsd) || deltaUsd <= 0) {
    return getWalletVolumeUsd(address);
  }
  const next = getWalletVolumeUsd(address) + deltaUsd;
  try {
    localStorage.setItem(`${VOLUME_STORAGE_PREFIX}${address.toLowerCase()}`, String(next));
  } catch {
    // ignore storage errors
  }
  return next;
}

export function resolveTraderTier(volumeUsd: number, hasReferralOrSocial = false): TraderTierConfig {
  let active = TRADER_TIERS[0];
  for (const tier of TRADER_TIERS) {
    if (volumeUsd >= tier.minVolumeUsd) {
      active = tier;
    }
  }
  if (active.id === 'guest' && hasReferralOrSocial) {
    return TRADER_TIERS[1]; // Plankton (-20% discount) when invited via ref link
  }
  return active;
}

export function resolveReferralTier(volumeUsd: number): ReferralTierInfo {
  let active = REFERRAL_TIERS[0];
  for (const tier of REFERRAL_TIERS) {
    if (volumeUsd >= tier.minVolumeUsd) {
      active = tier;
    }
  }
  return active;
}

export function calcFeeUnits(grossUnits: bigint, feeRate: number): bigint {
  if (grossUnits <= 0n || feeRate <= 0) return 0n;
  const ppm = BigInt(Math.round(feeRate * 1_000_000));
  return (grossUnits * ppm) / 1_000_000n;
}

export interface FeeSplitSummary {
  totalFeeUnits: bigint;
  treasuryUnits: bigint;
  referrerUnits: bigint;
  referrer: string | null;
}

export function computeFeeSplit(
  totalFeeUnits: bigint,
  sender?: string | null,
  refSharePct = 0.25
): FeeSplitSummary {
  if (totalFeeUnits <= 0n) {
    return { totalFeeUnits: 0n, treasuryUnits: 0n, referrerUnits: 0n, referrer: null };
  }
  const referrer = getValidReferrerForSender(sender);
  if (!referrer) {
    return {
      totalFeeUnits,
      treasuryUnits: totalFeeUnits,
      referrerUnits: 0n,
      referrer: null,
    };
  }
  const clampedShare = Math.min(0.5, Math.max(0.05, refSharePct));
  const refUnits = (totalFeeUnits * BigInt(Math.round(clampedShare * 1000))) / 1000n;
  const treasuryUnits = totalFeeUnits - refUnits;
  return {
    totalFeeUnits,
    treasuryUnits,
    referrerUnits: refUnits,
    referrer,
  };
}

/**
 * Atomically splits Volt protocol fee from `sourceCoin` (e.g. input coin or `tx.gas`)
 * to `VOLT_TREASURY_ADDRESS` and, if an invited referral link is active, sends the
 * referrer's rev-share directly on-chain in the same PTB.
 */
export function appendVoltFeeCoinSplit(
  tx: Transaction,
  sourceCoin: TransactionObjectArgument,
  totalFeeUnits: bigint,
  sender?: string | null,
  refSharePct = 0.25
): FeeSplitSummary {
  const split = computeFeeSplit(totalFeeUnits, sender, refSharePct);
  if (split.totalFeeUnits <= 0n) return split;

  if (split.referrer && split.referrerUnits > 0n && split.treasuryUnits > 0n) {
    const [treasuryCoin, refCoin] = tx.splitCoins(sourceCoin, [
      split.treasuryUnits,
      split.referrerUnits,
    ]);
    tx.transferObjects([treasuryCoin], VOLT_TREASURY_ADDRESS);
    tx.transferObjects([refCoin], split.referrer);
  } else {
    const [treasuryCoin] = tx.splitCoins(sourceCoin, [split.totalFeeUnits]);
    tx.transferObjects([treasuryCoin], VOLT_TREASURY_ADDRESS);
  }
  return split;
}

/**
 * Appends SUI gas fee split onto a JSON v2 ProgrammableTransaction object (for SIP-58 FundsWithdrawal payloads).
 */
export function appendFeeToJsonV2Ptb(
  inputs: any[],
  commands: any[],
  totalFeeMist: bigint,
  sender?: string | null,
  refSharePct = 0.25
): FeeSplitSummary {
  const split = computeFeeSplit(totalFeeMist, sender, refSharePct);
  if (split.totalFeeUnits <= 0n) return split;

  const pushSplitAndTransfer = (amount: bigint, recipient: string) => {
    if (amount <= 0n) return;
    const amtIdx = inputs.length;
    inputs.push({ Pure: { bytes: toBase64(bcs.u64().serialize(amount).toBytes()) } });
    const addrIdx = inputs.length;
    inputs.push({ Pure: { bytes: toBase64(bcs.Address.serialize(recipient).toBytes()) } });
    const splitCmdIdx = commands.length;
    commands.push({
      SplitCoins: {
        coin: { GasCoin: true },
        amounts: [{ Input: amtIdx }],
      },
    });
    commands.push({
      TransferObjects: {
        objects: [{ NestedResult: [splitCmdIdx, 0] }],
        address: { Input: addrIdx },
      },
    });
  };

  if (split.referrer && split.referrerUnits > 0n) {
    pushSplitAndTransfer(split.treasuryUnits, VOLT_TREASURY_ADDRESS);
    pushSplitAndTransfer(split.referrerUnits, split.referrer);
  } else {
    pushSplitAndTransfer(split.totalFeeUnits, VOLT_TREASURY_ADDRESS);
  }

  return split;
}

/**
 * Collects Volt protocol fee for any Sui coin type (`tx.gas` for SUI, or `coinWithBalance`
 * for non-SUI coins) with zero dangling zero-balance Coin objects.
 */
export function addCoinFeeToTx(
  tx: Transaction,
  params: {
    coinType: string;
    feeAtomic: bigint;
    sender: string;
    refSharePct?: number;
  }
): FeeSplitSummary {
  const { coinType, feeAtomic, sender, refSharePct = 0.25 } = params;
  if (feeAtomic <= 0n) {
    return { totalFeeUnits: 0n, treasuryUnits: 0n, referrerUnits: 0n, referrer: null };
  }

  if (safeNormalizeCoinType(coinType) === safeNormalizeCoinType(SUI_COIN_TYPE)) {
    return appendVoltFeeCoinSplit(tx, tx.gas, feeAtomic, sender, refSharePct);
  }

  const split = computeFeeSplit(feeAtomic, sender, refSharePct);
  const feeCoin = coinWithBalance({ type: coinType, balance: feeAtomic })(tx);

  if (split.referrer && split.referrerUnits > 0n && split.treasuryUnits > 0n) {
    const [refCoin] = tx.splitCoins(feeCoin, [split.referrerUnits]);
    tx.transferObjects([refCoin], split.referrer);
    tx.transferObjects([feeCoin], VOLT_TREASURY_ADDRESS);
  } else {
    tx.transferObjects([feeCoin], VOLT_TREASURY_ADDRESS);
  }

  return split;
}
