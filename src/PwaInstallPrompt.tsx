import React, { useState, useEffect } from 'react';
import { Download, X, Share2, PlusSquare, Zap, Check } from 'lucide-react';
import { triggerHaptic } from './telegram';
import { playClickSound } from './audioFx';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export const PwaInstallPrompt: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState<boolean>(false);
  const [showIOSModal, setShowIOSModal] = useState<boolean>(false);
  const [isStandalone, setIsStandalone] = useState<boolean>(false);
  const [isDismissed, setIsDismissed] = useState<boolean>(true);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);

  useEffect(() => {
    // Check if running in standalone mode (already installed as PWA)
    const isStandaloneMode =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as any).standalone === true ||
      document.referrer.includes('android-app://');

    setIsStandalone(isStandaloneMode);
    if (isStandaloneMode) return;

    // Check dismissal cooloff from localStorage (dismiss for 4 days)
    const dismissedUntil = localStorage.getItem('volt_pwa_dismissed_until');
    if (dismissedUntil && Date.now() < parseInt(dismissedUntil, 10)) {
      setIsDismissed(true);
      return;
    }

    // Detect iOS Safari
    const ua = window.navigator.userAgent;
    const isIOSDevice = /iPhone|iPad|iPod/.test(ua) && !(window as any).MSStream;
    const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua);
    setIsIOS(isIOSDevice && isSafari);

    // Listen for Chrome / Android beforeinstallprompt event
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsDismissed(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    // If iOS Safari and not dismissed, show prompt after 3s initial engagement
    if (isIOSDevice && isSafari) {
      const timer = setTimeout(() => {
        setIsDismissed(false);
      }, 3000);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      };
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  const handleInstallClick = async () => {
    playClickSound();
    triggerHaptic('medium');

    if (isIOS) {
      setShowIOSModal(true);
      return;
    }

    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === 'accepted') {
        setIsSuccess(true);
        triggerHaptic('success');
        setTimeout(() => {
          setIsDismissed(true);
        }, 2500);
      }
      setDeferredPrompt(null);
    } catch (err) {
      console.error('PWA install error:', err);
    }
  };

  const handleDismiss = () => {
    playClickSound();
    triggerHaptic('light');
    setIsDismissed(true);
    // Dismiss for 4 days
    localStorage.setItem('volt_pwa_dismissed_until', (Date.now() + 4 * 86400 * 1000).toString());
  };

  if (isStandalone || isDismissed) {
    return null;
  }

  return (
    <>
      {/* Floating Bottom PWA Install Banner */}
      <div className="fixed bottom-4 left-3 right-3 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-md z-40 animate-slide-up">
        <div className="bg-[#0f1422]/95 backdrop-blur-xl border border-volt/35 rounded-2xl p-3.5 sm:p-4 shadow-2xl shadow-volt/10 flex items-center justify-between gap-3 relative overflow-hidden">
          {/* Subtle neon glow edge */}
          <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-volt to-transparent opacity-80" />

          {/* Icon & Details */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-black border border-volt/30 flex items-center justify-center shrink-0 shadow-volt-glow">
              <Zap className="w-5 h-5 text-volt fill-volt" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-sm text-white truncate">Install Volt App</span>
                <span className="text-[10px] bg-volt/15 text-volt font-mono font-bold px-1.5 py-0.2 rounded border border-volt/20">
                  PWA
                </span>
              </div>
              <p className="text-[11px] text-gray-400 truncate mt-0.5">
                1-tap Home Screen launch & offline whale radar
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            {isSuccess ? (
              <span className="flex items-center gap-1 text-xs font-bold text-volt px-3 py-1.5">
                <Check className="w-4 h-4" /> Added!
              </span>
            ) : (
              <button
                type="button"
                onClick={handleInstallClick}
                className="px-3.5 py-2 rounded-xl bg-volt hover:bg-[#56DCFF] active:scale-95 text-black font-extrabold text-xs shadow-volt-glow transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Install</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleDismiss}
              className="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* iOS Safari Installation Walkthrough Modal */}
      {showIOSModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-md p-0 sm:p-4 animate-in fade-in duration-200">
          <div className="absolute inset-0 cursor-pointer" onClick={() => setShowIOSModal(false)} />

          <div className="relative w-full max-w-sm bg-[#0d1017] border-t sm:border border-white/10 rounded-t-3xl sm:rounded-3xl p-5 shadow-2xl z-10 animate-slide-up space-y-4">
            <div className="sm:hidden w-12 h-1.5 bg-white/20 rounded-full mx-auto -mt-2 mb-2" />

            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-black border border-volt/30 flex items-center justify-center">
                  <Zap className="w-4 h-4 text-volt fill-volt" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">Add VoltSwap to iPhone</h3>
                  <p className="text-[11px] text-gray-400">Install in 2 quick taps</p>
                </div>
              </div>
              <button
                onClick={() => setShowIOSModal(false)}
                className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-gray-300">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5">
                <div className="w-6 h-6 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold font-mono shrink-0">
                  1
                </div>
                <div>
                  <p className="font-semibold text-white">Tap the Share button</p>
                  <p className="text-gray-400 mt-0.5 flex items-center gap-1">
                    At the bottom of Safari, tap <Share2 className="w-3.5 h-3.5 text-cyan-400 inline" /> Share
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/5">
                <div className="w-6 h-6 rounded-full bg-volt/20 text-volt flex items-center justify-center font-bold font-mono shrink-0">
                  2
                </div>
                <div>
                  <p className="font-semibold text-white">Select 'Add to Home Screen'</p>
                  <p className="text-gray-400 mt-0.5 flex items-center gap-1">
                    Scroll down and tap <PlusSquare className="w-3.5 h-3.5 text-volt inline" /> Add to Home Screen
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowIOSModal(false)}
              className="w-full py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold text-xs transition-all cursor-pointer"
            >
              Got it, close
            </button>
          </div>
        </div>
      )}
    </>
  );
};
