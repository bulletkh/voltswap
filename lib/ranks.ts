// Trader Ranks & Partner Referral Tiers (single source of truth for client + server).

export type TraderTierId = "guest" | "plankton" | "dolphin" | "shark" | "whale" | "leviathan";

export type TraderTier = {
  id: TraderTierId;
  name: string;
  emoji: string;
  minVolumeUsd: number;
  nextVolumeUsd: number | null;
  discountPct: number; // 0..100 discount off base FEE_RATE (0.10%)
  color: string;
  glow: string;
  tagline: string;
};

export const TRADER_TIERS: TraderTier[] = [
  {
    id: "guest",
    name: "Guest Trader",
    emoji: "⚪",
    minVolumeUsd: 0,
    nextVolumeUsd: 1_000,
    discountPct: 0,
    color: "#9aa8c7",
    glow: "rgba(154, 168, 199, 0.25)",
    tagline: "Base 0.10% fee across all Sui pools",
  },
  {
    id: "plankton",
    name: "Plankton",
    emoji: "🦐",
    minVolumeUsd: 1_000,
    nextVolumeUsd: 10_000,
    discountPct: 20,
    color: "#34d399",
    glow: "rgba(52, 211, 153, 0.45)",
    tagline: "Unlocked via partner link or $1,000 volume (-20% fee)",
  },
  {
    id: "dolphin",
    name: "Dolphin",
    emoji: "🐬",
    minVolumeUsd: 10_000,
    nextVolumeUsd: 50_000,
    discountPct: 40,
    color: "#38bdf8",
    glow: "rgba(56, 189, 248, 0.5)",
    tagline: "Active Sui trader ($10,000+ volume · -40% fee)",
  },
  {
    id: "shark",
    name: "Shark",
    emoji: "🦈",
    minVolumeUsd: 50_000,
    nextVolumeUsd: 250_000,
    discountPct: 60,
    color: "#c084fc",
    glow: "rgba(192, 132, 252, 0.55)",
    tagline: "High-volume pro ($50,000+ volume · -60% fee)",
  },
  {
    id: "whale",
    name: "Blue Whale",
    emoji: "🐋",
    minVolumeUsd: 250_000,
    nextVolumeUsd: 1_000_000,
    discountPct: 80,
    color: "#fbbf24",
    glow: "rgba(251, 191, 36, 0.6)",
    tagline: "Heavy Sui whale ($250,000+ volume · -80% fee)",
  },
  {
    id: "leviathan",
    name: "Leviathan",
    emoji: "👑",
    minVolumeUsd: 1_000_000,
    nextVolumeUsd: null,
    discountPct: 100,
    color: "#ffd60a",
    glow: "rgba(255, 214, 10, 0.72)",
    tagline: "$1M Club — 0.00% Voltswap interface fee",
  },
];

export type PartnerTierId = "locked" | "scout" | "commander" | "vip" | "syndicate" | "elite";

export type PartnerTier = {
  id: PartnerTierId;
  name: string;
  emoji: string;
  active: boolean;
  revSharePct: number; // 0..0.50
  minVolumeUsd: number;
  minActiveRefs: number;
  color: string;
  glow: string;
  requirement: string;
};

/** Option A: referrers unlock 25% instant rev-share after $1,000+ personal swap volume (Plankton rank) on Voltswap. */
export const PARTNER_MIN_VOLUME_USD = 1_000;
/** Anti-sybil floor: an invited wallet counts as an active referral once it swaps ≥ $10 via the link. */
export const ACTIVE_REFERRAL_MIN_USD = 10;

export const PARTNER_TIERS: PartnerTier[] = [
  {
    id: "locked",
    name: "Not Active Yet",
    emoji: "🔒",
    active: false,
    revSharePct: 0,
    minVolumeUsd: 0,
    minActiveRefs: 0,
    color: "#8896b3",
    glow: "rgba(136, 150, 179, 0.25)",
    requirement: "Swap ≥ $1,000 on Voltswap to activate 25% instant rev-share",
  },
  {
    id: "scout",
    name: "Volt Scout",
    emoji: "🔵",
    active: true,
    revSharePct: 0.25,
    minVolumeUsd: PARTNER_MIN_VOLUME_USD,
    minActiveRefs: 0,
    color: "#38bdf8",
    glow: "rgba(56, 189, 248, 0.45)",
    requirement: "$1,000+ personal swap volume (Standard Partner · Fast-track: Zealy Sprint ≥$10)",
  },
  {
    id: "commander",
    name: "Volt Commander",
    emoji: "🟣",
    active: true,
    revSharePct: 0.35,
    minVolumeUsd: 25_000,
    minActiveRefs: 15,
    color: "#c084fc",
    glow: "rgba(192, 132, 252, 0.52)",
    requirement: "15+ active referrals (≥$10 each) OR $25,000+ personal/referred volume",
  },
  {
    id: "vip",
    name: "VIP Partner",
    emoji: "⚡",
    active: true,
    revSharePct: 0.4,
    minVolumeUsd: 100_000,
    minActiveRefs: 50,
    color: "#fbbf24",
    glow: "rgba(251, 191, 36, 0.58)",
    requirement: "50+ active referrals (≥$10 each) OR $100,000+ volume · Fast-track: Top 11–50 Sprint",
  },
  {
    id: "syndicate",
    name: "Whale Syndicate",
    emoji: "👑",
    active: true,
    revSharePct: 0.5,
    minVolumeUsd: 250_000,
    minActiveRefs: 100,
    color: "#ffd60a",
    glow: "rgba(255, 214, 10, 0.72)",
    requirement: "100+ active referrals (≥$10 each) OR $250,000+ volume · Fast-track: Top 1–10 Sprint",
  },
];

// Invite-only 1-of-1 Apex Partner tier (70% atomic PTB split — not listed publicly on /partner).
export const ELITE_70_TIER: PartnerTier = {
  id: "elite",
  name: "Apex Partner",
  emoji: "🔥",
  active: true,
  revSharePct: 0.7,
  minVolumeUsd: 0,
  minActiveRefs: 0,
  color: "#ff9f1c",
  glow: "rgba(255, 159, 28, 0.78)",
  requirement: "Exclusive 1-of-1 Founding Media Partner (70% atomic PTB split)",
};

// Sprint & Media partner whitelists — add normalized 0x... Sui addresses here or via comma-separated env vars.
const STATIC_SCOUT_25_PARTNERS: string[] = [];
const STATIC_VIP_40_PARTNERS: string[] = [];
const STATIC_SYNDICATE_50_PARTNERS: string[] = [];
const STATIC_ELITE_70_PARTNERS: string[] = [];

function parseAddrList(raw: string | undefined, extra: string[]): Set<string> {
  const out = new Set<string>();
  const items = [...extra, ...(raw ?? "").split(/[,\s]+/)];
  for (const item of items) {
    const n = normalizeSuiAddress(item);
    if (n) out.add(n);
  }
  return out;
}

export const SCOUT_25_SET = parseAddrList(process.env.NEXT_PUBLIC_SCOUT_25_PARTNERS, STATIC_SCOUT_25_PARTNERS);
export const VIP_40_SET = parseAddrList(process.env.NEXT_PUBLIC_VIP_40_PARTNERS, STATIC_VIP_40_PARTNERS);
export const SYNDICATE_50_SET = parseAddrList(process.env.NEXT_PUBLIC_SYNDICATE_50_PARTNERS, STATIC_SYNDICATE_50_PARTNERS);
export const ELITE_70_SET = parseAddrList(process.env.NEXT_PUBLIC_ELITE_70_PARTNERS, STATIC_ELITE_70_PARTNERS);

export function normalizeSuiAddress(raw?: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!/^0x[0-9a-f]{1,64}$/.test(s)) return null;
  return "0x" + s.slice(2).padStart(64, "0");
}

export function resolveTraderTier(volumeUsd: number, hasActiveReferrer = false): TraderTier {
  let active = TRADER_TIERS[0];
  for (const t of TRADER_TIERS) {
    if (volumeUsd >= t.minVolumeUsd) active = t;
  }
  if (active.id === "guest" && hasActiveReferrer) {
    return TRADER_TIERS[1]; // Invited traders get instant Plankton (-20%)
  }
  return active;
}

export function resolvePartnerTier(
  address?: string | null,
  volumeUsd = 0,
  activeReferrals = 0,
  referredVolumeUsd = 0,
): PartnerTier {
  const norm = normalizeSuiAddress(address);
  const totalVol = volumeUsd + referredVolumeUsd;
  const whitelisted70 = Boolean(norm && ELITE_70_SET.has(norm));
  const whitelisted50 = Boolean(norm && SYNDICATE_50_SET.has(norm));
  const whitelisted40 = Boolean(norm && VIP_40_SET.has(norm));
  const whitelisted25 = Boolean(norm && SCOUT_25_SET.has(norm));

  if (whitelisted70) return ELITE_70_TIER; // Exclusive 70% Apex Partner
  if (whitelisted50) return PARTNER_TIERS[4]; // Whale Syndicate 50% (Sprint / KOL whitelist)
  if (volumeUsd < PARTNER_MIN_VOLUME_USD && !whitelisted40 && !whitelisted25) {
    return PARTNER_TIERS[0]; // Locked until $100 personal swap (or Sprint whitelist)
  }
  if (activeReferrals >= 100 || totalVol >= 250_000) {
    return PARTNER_TIERS[4]; // Whale Syndicate 50%
  }
  if (whitelisted40 || activeReferrals >= 50 || totalVol >= 100_000) {
    return PARTNER_TIERS[3]; // VIP Partner 40%
  }
  if (activeReferrals >= 15 || totalVol >= 25_000) {
    return PARTNER_TIERS[2]; // Volt Commander 35%
  }
  return PARTNER_TIERS[1]; // Volt Scout 25%
}

export function effectiveSwapFeeRate(baseRate: number, tier: TraderTier): number {
  if (baseRate <= 0 || tier.discountPct >= 100) return 0;
  return Number((baseRate * (1 - tier.discountPct / 100)).toFixed(6));
}

export function formatFeePct(rate: number): string {
  if (rate <= 0) return "0%";
  return (rate * 100).toFixed(2).replace(/\.?0+$/, "") + "%";
}

// ---- Client-side referral & optimistic volume persistence ----
export const REF_STORAGE_KEY = "volt_ref_address";
export const VOL_STORAGE_PREFIX = "volt_vol_usd_";
export const VOLUME_EVENT = "vs:volume";

export function captureReferralFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    const ref = normalizeSuiAddress(params.get("ref"));
    if (ref) {
      window.localStorage.setItem(REF_STORAGE_KEY, ref);
      return ref;
    }
  } catch {
    /* ignore storage errors */
  }
  return getStoredReferrer();
}

export function getStoredReferrer(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return normalizeSuiAddress(window.localStorage.getItem(REF_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function getValidReferrerForSender(sender?: string | null, treasuryAddress?: string | null): string | null {
  const ref = getStoredReferrer();
  if (!ref) return null;
  const normSender = normalizeSuiAddress(sender);
  const normTreasury = normalizeSuiAddress(treasuryAddress);
  if (normSender && normSender === ref) return null;
  if (normTreasury && normTreasury === ref) return null;
  return ref;
}

export function getOptimisticVolume(address?: string | null): number {
  const norm = normalizeSuiAddress(address);
  if (!norm || typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(VOL_STORAGE_PREFIX + norm);
    const n = raw ? Number(raw) : 0;
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function addOptimisticVolume(address?: string | null, deltaUsd = 0): number {
  const norm = normalizeSuiAddress(address);
  if (!norm || !Number.isFinite(deltaUsd) || deltaUsd <= 0 || typeof window === "undefined") {
    return getOptimisticVolume(address);
  }
  const next = getOptimisticVolume(norm) + deltaUsd;
  try {
    window.localStorage.setItem(VOL_STORAGE_PREFIX + norm, String(next));
    window.dispatchEvent(new CustomEvent(VOLUME_EVENT, { detail: { address: norm, volumeUsd: next } }));
  } catch {
    /* ignore */
  }
  return next;
}

export function syncOptimisticVolume(address?: string | null, chainUsd = 0): number {
  const norm = normalizeSuiAddress(address);
  if (!norm) return Math.max(0, chainUsd);
  const prev = getOptimisticVolume(norm);
  const next = Math.max(prev, Number.isFinite(chainUsd) && chainUsd > 0 ? chainUsd : 0);
  if (typeof window !== "undefined" && next > prev) {
    try {
      window.localStorage.setItem(VOL_STORAGE_PREFIX + norm, String(next));
    } catch {
      /* ignore */
    }
  }
  return next;
}
