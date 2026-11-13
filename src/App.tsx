import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Activity,
  Award,
  CheckCircle2,
  ExternalLink,
  Layers,
  Shield,
  Sparkles,
  Target,
  Wallet,
  X,
  Zap,
  AlertCircle,
} from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { ConnectButton } from '@mysten/dapp-kit-react/ui';
import { VOLT_TREASURY_ADDRESS } from './constants';
import { captureReferralFromUrl } from './voltFee';
import { useSyncedWalletVolume } from './onChainVolume';
import { SwapWorkspace } from './components/SwapWorkspace';
import { PerpsWorkspace } from './components/PerpsWorkspace';
import { PredictWorkspace } from './components/PredictWorkspace';
import { EarnWorkspace } from './components/EarnWorkspace';
import { TiersReferralsWorkspace } from './components/TiersReferralsWorkspace';
import { PortfolioDrawer } from './components/PortfolioDrawer';
import { TreasuryDashboard } from './TreasuryDashboard';
import { PnlShareModal, type PnlTradeData } from './PnlShareModal';
import { PwaInstallPrompt } from './PwaInstallPrompt';
import { VoltLogo } from './components/VoltLogo';

type ActiveTab = 'swap' | 'perps' | 'predict' | 'earn' | 'tiers' | 'treasury';

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
  const { volumeUsd: syncedVolumeUsd } = useSyncedWalletVolume(account?.address);
  const [trackedVolumeUsd, setTrackedVolumeUsd] = useState<number>(0);

  useEffect(() => {
    captureReferralFromUrl();
  }, []);

  useEffect(() => {
    setTrackedVolumeUsd(syncedVolumeUsd);
  }, [syncedVolumeUsd]);

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
    { id: 'predict', label: 'Predict', icon: <Target className="w-4 h-4" /> },
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
    <div className="min-h-screen bg-[#000000] text-slate-100 flex flex-col">
      {/* Top Institutional DeepBook-Style Navigation Bar */}
      <header className="sticky top-0 z-40 border-b border-[#1A1E26] bg-[#000000]/95 backdrop-blur-md">
        <div className="w-full mx-auto px-3 sm:px-5 h-[52px] flex items-center justify-between gap-4">
          {/* Left: Brand */}
          <div className="flex items-center gap-6 h-full">
            <button
              type="button"
              onClick={() => setActiveTab('swap')}
              className="flex items-center text-left hover:opacity-90 transition-opacity shrink-0"
            >
              <VoltLogo className="w-7 h-7" showWordmark subtitle="PRO" />
            </button>

            {/* Primary Institutional Nav */}
            <nav className="hidden md:flex items-center gap-1 h-full">
              {navItems.map((item) => {
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`relative h-full px-3.5 text-[13px] font-semibold flex items-center gap-1.5 transition-colors border-b-2 ${
                      active
                        ? 'text-white border-[#2B7FFF]'
                        : 'text-[#848E9C] hover:text-white border-transparent'
                    }`}
                  >
                    <span className={active ? 'text-[#2B7FFF]' : 'text-[#6B7280]'}>{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Right: Network Status, Portfolio Drawer & Wallet */}
          <div className="flex items-center gap-2">
            <div className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#090B0E] border border-[#1B1F27] text-[11px] font-mono text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-[#08D189] animate-live-dot" />
              <span>Mainnet</span>
            </div>
            {account && (
              <button
                type="button"
                onClick={() => setPortfolioOpen(true)}
                className="px-3 py-1.5 rounded bg-[#090B0E] hover:bg-[#10141D] border border-[#1E232E] hover:border-[#2B7FFF]/60 text-xs font-semibold text-white inline-flex items-center gap-1.5 transition-all"
              >
                <Wallet className="w-3.5 h-3.5 text-[#2B7FFF]" />
                <span className="hidden sm:inline">Portfolio</span>
              </button>
            )}
            <ConnectButton />
          </div>
        </div>

        {/* Mobile Tab Strip */}
        <div className="md:hidden border-t border-[#1A1E26] px-2.5 py-1.5 flex items-center gap-1 overflow-x-auto no-scrollbar bg-[#050608]">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`px-3 py-1.5 rounded text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 transition-colors ${
                  active
                    ? 'bg-[#2B7FFF]/15 text-[#60A5FA] border border-[#2B7FFF]/40'
                    : 'text-[#848E9C] border border-transparent'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Workspace */}
      <main
        className={`flex-1 w-full flex flex-col ${
          activeTab === 'swap' || activeTab === 'perps' || activeTab === 'predict'
            ? ''
            : 'max-w-[1440px] mx-auto px-3 sm:px-6 py-4'
        }`}
      >
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

        {activeTab === 'predict' && (
          <PredictWorkspace
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

      {/* Clean Institutional Footer */}
      <footer className="border-t border-[#1A1E26] bg-[#000000] py-2.5 px-4 sm:px-5 text-[11px] font-mono text-[#7B8494]">
        <div className="w-full mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="text-white font-semibold">Volt Protocol</span>
            <span>Cetus Aggregator · DeepBook v3 CLOB &amp; Margin · Aftermath Perps</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-[#2B7FFF]" />
            <span className="text-slate-300">Non-custodial Sui Move Execution</span>
          </div>
        </div>
      </footer>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm w-[calc(100%-2rem)] bg-[#090B10] rounded-lg p-4 shadow-2xl border border-[#2B7FFF]/35 animate-slide-up">
          <div className="flex items-start gap-3">
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-[#08D189] shrink-0 mt-0.5" />
            ) : toast.type === 'error' ? (
              <AlertCircle className="w-5 h-5 text-[#F0525E] shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-[#2B7FFF] shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-white">{toast.title}</div>
              <div className="text-xs text-slate-300 mt-0.5 break-words">{toast.message}</div>
              {toast.actionUrl && toast.actionLabel && (
                <a
                  href={toast.actionUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-mono text-[#60A5FA] hover:underline mt-1.5"
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
