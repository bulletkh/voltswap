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
    { id: 'swap', label: 'Swap', icon: <Zap className="w-3.5 h-3.5" /> },
    { id: 'perps', label: 'Perps', icon: <Activity className="w-3.5 h-3.5" /> },
    { id: 'earn', label: 'Earn', icon: <Layers className="w-3.5 h-3.5" /> },
    { id: 'tiers', label: 'Tiers & Referrals', icon: <Award className="w-3.5 h-3.5" /> },
  ];

  if (isCreatorWallet) {
    navItems.push({
      id: 'treasury',
      label: 'Treasury',
      icon: <Shield className="w-3.5 h-3.5 text-amber-400" />,
    });
  }

  return (
    <div className="min-h-screen bg-[#090B0E] text-slate-100 flex flex-col">
      {/* Top Institutional Navigation Bar */}
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#090B0E]/90 backdrop-blur-md">
        <div className="max-w-[1440px] mx-auto px-3 sm:px-5 h-14 flex items-center justify-between gap-3">
          {/* Brand */}
          <div className="flex items-center gap-6">
            <button
              type="button"
              onClick={() => setActiveTab('swap')}
              className="flex items-center gap-2 text-left"
            >
              <div className="w-7 h-7 rounded-lg bg-[#38BDF8] text-[#090B0E] flex items-center justify-center font-black text-sm">
                ⚡
              </div>
              <div className="leading-none">
                <span className="text-sm font-bold tracking-tight text-white">VOLT</span>
                <span className="hidden sm:inline text-[10px] font-mono text-slate-400 ml-1.5">
                  SUI CLOB
                </span>
              </div>
            </button>

            {/* Primary Nav */}
            <nav className="hidden md:flex items-center gap-1">
              {navItems.map((item) => {
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                      active
                        ? 'bg-[#101318] text-[#38BDF8] border border-white/[0.08]'
                        : 'text-slate-400 hover:text-white hover:bg-white/[0.03] border border-transparent'
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
          <div className="flex items-center gap-2">
            {account && (
              <button
                type="button"
                onClick={() => setPortfolioOpen(true)}
                className="px-2.5 py-1.5 rounded-lg bg-[#101318] hover:bg-[#161B24] border border-white/[0.08] text-xs font-medium text-slate-200 inline-flex items-center gap-1.5"
              >
                <Wallet className="w-3.5 h-3.5 text-[#38BDF8]" />
                <span className="hidden sm:inline">Portfolio</span>
              </button>
            )}
            <ConnectButton />
          </div>
        </div>

        {/* Mobile Tab Strip */}
        <div className="md:hidden border-t border-white/[0.05] px-2 py-1.5 flex items-center gap-1 overflow-x-auto no-scrollbar">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap flex items-center gap-1.5 ${
                  active
                    ? 'bg-[#38BDF8]/15 text-[#38BDF8] border border-[#38BDF8]/30'
                    : 'text-slate-400 border border-transparent'
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
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-3 sm:px-5 py-4">
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

      {/* Minimal Footer */}
      <footer className="border-t border-white/[0.05] py-3 px-4 text-[11px] font-mono text-slate-500">
        <div className="max-w-[1440px] mx-auto flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="text-slate-300 font-semibold">Volt Protocol</span>
            <span>Cetus Aggregator · DeepBook v3 CLOB · Aftermath Perps</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-[#38BDF8]" />
            <span>Non-custodial Sui Move Execution</span>
          </div>
        </div>
      </footer>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 max-w-sm w-[calc(100%-2rem)] panel-carbon rounded-xl p-3.5 shadow-2xl border border-white/[0.1] animate-slide-up">
          <div className="flex items-start gap-2.5">
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : toast.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-[#38BDF8] shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-white">{toast.title}</div>
              <div className="text-xs text-slate-400 mt-0.5 break-words">{toast.message}</div>
              {toast.actionUrl && toast.actionLabel && (
                <a
                  href={toast.actionUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-mono text-[#38BDF8] hover:underline mt-1.5"
                >
                  <span>{toast.actionLabel}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-slate-500 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
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
