/**
 * Volt Protocol - Telegram Mini App (TMA) Integration & Native Haptic Engine
 */

export type HapticType =
  | 'light'
  | 'medium'
  | 'heavy'
  | 'rigid'
  | 'soft'
  | 'success'
  | 'warning'
  | 'error'
  | 'selection';

export const getTelegramWebApp = (): any => {
  if (typeof window !== 'undefined' && (window as any).Telegram?.WebApp) {
    return (window as any).Telegram.WebApp;
  }
  return null;
};

export const isTelegramWebApp = (): boolean => {
  const tg = getTelegramWebApp();
  return Boolean(tg && (tg.initData || tg.initDataUnsafe?.user || window.location.hash.includes('tgWebAppData')));
};

export const initTelegramWebApp = (): void => {
  const tg = getTelegramWebApp();
  if (!tg) return;

  try {
    tg.ready();
    tg.expand();

    // Prevent accidental swipe-down closure during active trading
    if (typeof tg.enableClosingConfirmation === 'function') {
      tg.enableClosingConfirmation();
    }

    // Seamlessly match dark cyberpunk theme
    if (typeof tg.setHeaderColor === 'function') {
      tg.setHeaderColor('#0a0b0d');
    }
    if (typeof tg.setBackgroundColor === 'function') {
      tg.setBackgroundColor('#0a0b0d');
    }
  } catch (err) {
    console.debug('TMA init notice:', err);
  }
};

/**
 * Trigger native mobile haptic vibration feedback inside Telegram WebApp
 */
export const triggerHaptic = (type: HapticType = 'medium'): void => {
  const tg = getTelegramWebApp();
  if (!tg?.HapticFeedback) {
    // Fallback to HTML5 Navigator vibration on mobile devices if supported
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try {
        if (type === 'selection') navigator.vibrate(10);
        else if (type === 'light') navigator.vibrate(15);
        else if (type === 'medium') navigator.vibrate(25);
        else if (type === 'heavy') navigator.vibrate(40);
        else if (type === 'success') navigator.vibrate([20, 40, 30]);
        else if (type === 'error') navigator.vibrate([40, 50, 40]);
      } catch (_) {}
    }
    return;
  }

  try {
    switch (type) {
      case 'light':
      case 'medium':
      case 'heavy':
      case 'rigid':
      case 'soft':
        tg.HapticFeedback.impactOccurred(type);
        break;
      case 'success':
      case 'warning':
      case 'error':
        tg.HapticFeedback.notificationOccurred(type);
        break;
      case 'selection':
        tg.HapticFeedback.selectionChanged();
        break;
      default:
        tg.HapticFeedback.impactOccurred('medium');
    }
  } catch (_) {}
};

/**
 * Control Telegram BackButton for modals / bottom-sheets
 */
let currentBackCallback: (() => void) | null = null;

export const showTelegramBackButton = (callback: () => void): void => {
  const tg = getTelegramWebApp();
  if (!tg?.BackButton) return;

  try {
    if (currentBackCallback) {
      tg.BackButton.offClick(currentBackCallback);
    }
    currentBackCallback = callback;
    tg.BackButton.onClick(callback);
    tg.BackButton.show();
  } catch (_) {}
};

export const hideTelegramBackButton = (): void => {
  const tg = getTelegramWebApp();
  if (!tg?.BackButton) return;

  try {
    if (currentBackCallback) {
      tg.BackButton.offClick(currentBackCallback);
      currentBackCallback = null;
    }
    tg.BackButton.hide();
  } catch (_) {}
};
