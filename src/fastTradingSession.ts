// 1-Click Fast Trading Session Manager (Hyperliquid & dYdX Style)
// Enables zero-popup instant execution within user-defined security limits

export interface FastTradingSession {
  isActive: boolean;
  expiresAt: number; // Unix timestamp in ms
  maxSpendUsd: number;
  spentUsd: number;
  sessionAddress?: string;
  authorizedAt: number;
  tradeCount: number;
}

const STORAGE_KEY = 'volt_fast_trading_session';

export const getFastTradingSession = (): FastTradingSession => {
  if (typeof window === 'undefined') {
    return { isActive: false, expiresAt: 0, maxSpendUsd: 500, spentUsd: 0, authorizedAt: 0, tradeCount: 0 };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { isActive: false, expiresAt: 0, maxSpendUsd: 500, spentUsd: 0, authorizedAt: 0, tradeCount: 0 };
    }
    const session: FastTradingSession = JSON.parse(raw);
    if (Date.now() > session.expiresAt) {
      // Session expired
      revokeFastTradingSession();
      return { isActive: false, expiresAt: 0, maxSpendUsd: 500, spentUsd: 0, authorizedAt: 0, tradeCount: 0 };
    }
    return session;
  } catch (_) {
    return { isActive: false, expiresAt: 0, maxSpendUsd: 500, spentUsd: 0, authorizedAt: 0, tradeCount: 0 };
  }
};

export const createFastTradingSession = (
  address: string,
  durationHours: number = 2,
  maxSpendUsd: number = 500
): FastTradingSession => {
  const session: FastTradingSession = {
    isActive: true,
    expiresAt: Date.now() + durationHours * 3600 * 1000,
    maxSpendUsd,
    spentUsd: 0,
    sessionAddress: address,
    authorizedAt: Date.now(),
    tradeCount: 0
  };

  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }
  return session;
};

export const revokeFastTradingSession = () => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY);
  }
};

export const recordFastTrade = (spendUsd: number): boolean => {
  const session = getFastTradingSession();
  if (!session.isActive || Date.now() > session.expiresAt) return false;
  if (session.spentUsd + spendUsd > session.maxSpendUsd) return false;

  session.spentUsd += spendUsd;
  session.tradeCount += 1;

  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }
  return true;
};
