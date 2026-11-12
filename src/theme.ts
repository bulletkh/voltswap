import type { ThemeVars } from '@mysten/dapp-kit';

export const voltDarkTheme: ThemeVars = {
  blurs: {
    modalOverlay: 'blur(10px)',
  },
  backgroundColors: {
    primaryButton: '#121622',
    primaryButtonHover: '#1c2436',
    outlineButtonHover: '#1c2436',
    walletItemHover: 'rgba(56, 189, 248, 0.08)',
    walletItemSelected: 'rgba(56, 189, 248, 0.16)',
    modalOverlay: 'rgba(5, 7, 11, 0.85)',
    modalPrimary: '#0d1017',
    modalSecondary: '#121622',
    iconButton: 'transparent',
    iconButtonHover: '#1c2436',
    dropdownMenu: '#0f131d',
    dropdownMenuSeparator: 'rgba(255, 255, 255, 0.08)',
  },
  borderColors: {
    outlineButton: 'rgba(56, 189, 248, 0.35)',
  },
  colors: {
    primaryButton: '#38bdf8',
    outlineButton: '#38bdf8',
    body: '#ffffff',
    bodyMuted: '#94a3b8',
    bodyDanger: '#f87171',
    iconButton: '#38bdf8',
  },
  radii: {
    small: '10px',
    medium: '14px',
    large: '18px',
    xlarge: '24px',
  },
  shadows: {
    primaryButton: '0 0 16px rgba(56, 189, 248, 0.2)',
    walletItemSelected: '0 0 12px rgba(56, 189, 248, 0.25)',
  },
  fontWeights: {
    normal: '400',
    medium: '500',
    bold: '700',
  },
  fontSizes: {
    small: '12px',
    medium: '14px',
    large: '16px',
    xlarge: '18px',
  },
  typography: {
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontStyle: 'normal',
    lineHeight: '1.4',
    letterSpacing: '0.02em',
  },
};
