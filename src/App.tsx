import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Activity,
  Award,
  CheckCircle2,
  ExternalLink,
  Layers,
  Shield,
  Sparkles,
  Wallet,
  X,
  Zap,
  AlertCircle,
} from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { VOLT_TREASURY_ADDRESS } from './constants';
import { captureReferralFromUrl, getWalletVolumeUsd } from './voltFee';
import { SwapWorkspace } from './components/SwapWorkspace';
import { PerpsWorkspace } from './components/PerpsWorkspace';
import { EarnWorkspace } from './components/EarnWorkspace';
import { TiersReferralsWorkspace } from './components/TiersReferralsWorkspace';
import { PortfolioDrawer } from './components/PortfolioDrawer';
import { TreasuryDashboard } from './TreasuryDashboard';
import { PnlShareModal, type PnlTradeData } from './PnlShareModal';
import { PwaInstallPrompt } from './PwaInstallPrompt';
import { VoltLogo } from './components/VoltLogo';

type ActiveTab = 'swap' | 'perps' | 'earn' | 'tiers' | 'treasury';

interface ToastState {
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message: string;
  actionLabel?: string;
  actionUrl?: string;
}

const CREATOR_ADMIN_ADDRESS =
  '0x7ef65a3b007b79e3b8d9a29f2d5e8584b589186b3a9483b7519c53088c317b93';

export function App() {
  const account = useCurrentAccount();

  const [activeTab, setActiveTab] = useState<ActiveTab>('swap');
  const [toast, setToast] = useState<ToastState | null>(null);
  const [portfolioOpen, setPortfolioOpen] = useState(false);
  const [pnlTrade, setPnlTrade] = useState<PnlTradeData | null>(null);
  const [trackedVolumeUsd, setTrackedVolumeUsd] = useState<number>(0);

  useEffect(() => {
    captureReferralFromUrl();
  }, []);

  useEffect(() => {
    setTrackedVolumeUsd(getWalletVolumeUsd(account?.address));
  }, [account?.address]);

  const isCreatorWallet = useMemo(() => {
    if (!account?.address) return false;
    const norm = account.address.toLowerCase();
    return (
      norm === VOLT_TREASURY_ADDRESS.toLowerCase() ||
      norm === CREATOR_ADMIN_ADDRESS.toLowerCase() ||
      norm.startsWith('0x7211d7a3') ||
      norm.startsWith('0x7ef65a3b')
    );
  }, [account?.address]);

  const notify = useCallback(
    (
      type: ToastState['type'],
      title: string,
      message: string,
      actionLabel?: string,
      actionUrl?: string
    ) => {
      setToast({ type, title, message, actionLabel, actionUrl });
    },
    []
  );

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6500);
    return () => clearTimeout(t);
  }, [toast]);

  const navItems: Array<{
    id: ActiveTab;
    label: string;
    icon: React.ReactNode;
  }> = [
    { id: 'swap', label: 'Swap', icon: <Zap className="w-4 h-4" /> },
    { id: 'perps', label: 'Perps', icon: <Activity className="w-4 h-4" /> },
    { id: 'earn', label: 'Earn', icon: <Layers className="w-4 h-4" /> },
    { id: 'tiers', label: 'Tiers & Referrals', icon: <Award className="w-4 h-4" /> },
  ];

  if (isCreatorWallet) {
    navItems.push({
      id: 'treasury',
      label: 'Treasury',
      icon: <Shield className="w-4 h-4 text-amber-400" />,
    });
  }

  return (
    <div className="min-h-screen text-slate-100 flex flex-col">
      {/* Top Volt Obsidian Navigation Bar */}
      <header className="sticky top-0 z-40 border-b border-white/[0.08] bg-[#090E16]/92 backdrop-blur-md">
        <div className="w-full mx-auto px-3 sm:px-5 lg:px-6 h-16 flex items-center justify-between gap-4">
          {/* Brand */}
          <div className="flex items-center gap-7">
            <button
              type="button"
              onClick={() => setActiveTab('swap')}
              className="flex items-center text-left hover:opacity-95 transition-opacity"
            >
              <VoltLogo className="w-9 h-9" showWordmark subtitle="SUI PRO" />
            </button>

            {/* Primary Nav */}
            <nav className="hidden md:flex items-center gap-1.5">
              {navItems.map((item) => {
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all ${
                      active
                        ? 'bg-[#18C8FF]/15 text-[#18C8FF] border border-[#18C8FF]/40 shadow-[0_0_20px_rgba(24, 200, 255,0.14)]'
                        : 'text-slate-300 hover:text-white hover:bg-white/[0.06] border border-transparent'
                    }`}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Right Wallet & Portfolio Controls */}
          <div className="flex items-center gap-2.5">
            {account && (
              <button
                type="button"
                onClick={() => setPortfolioOpen(true)}
                className="px-3.5 py-2 rounded-xl bg-[#101722] hover:bg-[#171B22] border border-white/[0.12] text-sm font-semibold text-white inline-flex items-center gap-2 transition-colors"
              >
                <Wallet className="w-4 h-4 text-[#18C8FF]" />
                <span className="hidden sm:inline">Portfolio</span>
              </button>
            )}
            <ConnectButton />
          </div>
        </div>

        {/* Mobile Tab Strip */}
        <div className="md:hidden border-t border-white/[0.08] px-3 py-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap flex items-center gap-1.5 ${
                  active
                    ? 'bg-[#18C8FF]/20 text-[#18C8FF] border border-[#18C8FF]/40'
                    : 'text-slate-300 border border-transparent'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Widescreen Workspace */}
      <main className="flex-1 w-full mx-auto px-3 sm:px-5 lg:px-6 py-4">
        {activeTab === 'swap' && (
          <SwapWorkspace
            onNotify={notify}
            onTradeRecorded={(t) => setPnlTrade(t)}
            onVolumeUpdated={(v) => setTrackedVolumeUsd(v)}
          />
        )}

        {activeTab === 'perps' && (
          <PerpsWorkspace
            onNotify={notify}
            onTradeRecorded={(t) => setPnlTrade(t)}
            onVolumeUpdated={(v) => setTrackedVolumeUsd(v)}
          />
        )}

        {activeTab === 'earn' && (
          <EarnWorkspace
            onNotify={notify}
            onTradeRecorded={(t) => setPnlTrade(t)}
            onVolumeUpdated={(v) => setTrackedVolumeUsd(v)}
          />
        )}

        {activeTab === 'tiers' && (
          <TiersReferralsWorkspace externalVolumeUsd={trackedVolumeUsd} />
        )}

        {activeTab === 'treasury' && isCreatorWallet && (
          <TreasuryDashboard currentAccount={account} showNotification={notify} />
        )}
      </main>

      {/* Minimal Cetus Footer */}
      <footer className="border-t border-white/[0.08] py-3.5 px-4 sm:px-6 text-xs font-mono text-slate-400">
        <div className="w-full mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="text-white font-semibold">Volt Protocol</span>
            <span>Cetus Aggregator · DeepBook v3 CLOB &amp; Margin · Aftermath Perps</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#18C8FF]" />
            <span className="text-slate-200">Non-custodial Sui Move Execution</span>
          </div>
        </div>
      </footer>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm w-[calc(100%-2rem)] panel-carbon rounded-2xl p-4 shadow-2xl border border-[#18C8FF]/25 animate-slide-up">
          <div className="flex items-start gap-3">
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-[#00E599] shrink-0 mt-0.5" />
            ) : toast.type === 'error' ? (
              <AlertCircle className="w-5 h-5 text-[#FF4D6A] shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-[#18C8FF] shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-white">{toast.title}</div>
              <div className="text-xs text-slate-300 mt-0.5 break-words">{toast.message}</div>
              {toast.actionUrl && toast.actionLabel && (
                <a
                  href={toast.actionUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-mono text-[#18C8FF] hover:underline mt-1.5"
                >
                  <span>{toast.actionLabel}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-slate-500 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <PortfolioDrawer isOpen={portfolioOpen} onClose={() => setPortfolioOpen(false)} />

      <PnlShareModal
        isOpen={Boolean(pnlTrade)}
        onClose={() => setPnlTrade(null)}
        trade={pnlTrade}
        userAddress={account?.address}
      />

      <PwaInstallPrompt />
    </div>
  );
}

export default App;
