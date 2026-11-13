import React, { useState } from 'react';
import { ChevronDown, ChevronUp, KeyRound, Loader2, ShieldOff, Zap } from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import {
  buildAuthorizePredictSessionTx,
  buildRevokePredictSessionTx,
  clearLocalSessionKey,
  getOrCreateLocalSessionKey,
  reclaimSessionGasFloat,
  saveLocalSessionKey,
  type SessionStatusSnapshot,
} from '../deepbookSessions';
import { extractTxDigest, invalidateRpcCache } from '../suiClient';
import { simulateTxBeforeWallet } from '../suiSimulate';
import type { PredictProtocolStatus } from '../deepbookPredict';

interface PredictSessionPanelProps {
  hasAccount: boolean;
  availableUsdc: number;
  protocol: PredictProtocolStatus | null;
  sessionStatus: SessionStatusSnapshot | null;
  onSessionUpdated: () => void | Promise<void>;
  onNotify: (
    type: 'success' | 'error' | 'info' | 'warning',
    title: string,
    message: string,
    actionLabel?: string,
    actionUrl?: string
  ) => void;
}

const DURATION_OPTIONS = [
  { label: '1h', ms: 60 * 60 * 1000 },
  { label: '6h', ms: 6 * 60 * 60 * 1000 },
  { label: '24h', ms: 24 * 60 * 60 * 1000 },
];

export const PredictSessionPanel: React.FC<PredictSessionPanelProps> = ({
  hasAccount,
  availableUsdc,
  protocol,
  sessionStatus,
  onSessionUpdated,
  onNotify,
}) => {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();

  const [expanded, setExpanded] = useState(false);
  const [durationMs, setDurationMs] = useState<number>(DURATION_OPTIONS[1].ms);
  const [depositInput, setDepositInput] = useState<string>(availableUsdc >= 5 ? '0' : '5');
  const [isBusy, setIsBusy] = useState(false);

  if (!account?.address) return null;

  const isActive = Boolean(sessionStatus?.isActiveNow);
  const expiresAtMs = sessionStatus?.onChainExpiresAtMs ?? 0;
  const minsRemaining = isActive ? Math.max(1, Math.round((expiresAtMs - Date.now()) / 60_000)) : 0;
  const needsGasRefill = !sessionStatus || sessionStatus.sessionGasSui < 0.015;

  const handleAuthorize = async () => {
    if (!account.address || !protocol) return;
    setIsBusy(true);
    try {
      const { record } = getOrCreateLocalSessionKey(account.address);
      const depositUsdc = Math.max(0, Number(depositInput) || 0);
      const tx = buildAuthorizePredictSessionTx({
        owner: account.address,
        sessionAddress: record.sessionAddress,
        durationMs,
        hasAccount,
        protocol,
        depositUsdc,
        fundGasMist: needsGasRefill ? 50_000_000n : 0n,
        expiredSessionsToPrune: sessionStatus?.expiredSessionAddresses ?? [],
      });
      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) {
        onNotify(
          'error',
          'Session Setup Preflight Failed',
          sim.errorMessage || 'Could not validate session authorization.'
        );
        return;
      }
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      saveLocalSessionKey({
        ...record,
        expiresAtMs: Date.now() + durationMs,
      });
      invalidateRpcCache('listBalances:');
      onNotify(
        'success',
        '1-Click Trading Session Enabled',
        `Popup-free Predict session authorized${depositUsdc > 0 ? ` + $${depositUsdc.toFixed(2)} USDC funded` : ''}.`,
        digest ? 'Suiscan' : undefined,
        digest ? `https://suiscan.xyz/mainnet/tx/${digest}` : undefined
      );
      setExpanded(false);
      await onSessionUpdated();
    } catch (err: any) {
      onNotify('error', 'Session Authorization Cancelled', err?.message || 'Wallet rejected.');
    } finally {
      setIsBusy(false);
    }
  };

  const handleRevoke = async () => {
    if (!account.address || !sessionStatus?.localKey) return;
    setIsBusy(true);
    try {
      const toRevoke = [
        sessionStatus.localKey.sessionAddress,
        ...(sessionStatus.expiredSessionAddresses ?? []),
      ];
      const tx = buildRevokePredictSessionTx({
        owner: account.address,
        sessionAddresses: toRevoke,
      });
      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) {
        onNotify('error', 'Revoke Preflight Failed', sim.errorMessage || 'Simulation error.');
        return;
      }
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      const reclaimedDigest = await reclaimSessionGasFloat(account.address).catch(() => null);
      clearLocalSessionKey(account.address);
      invalidateRpcCache('listBalances:');
      onNotify(
        'info',
        'Session Key Revoked',
        reclaimedDigest
          ? 'Session revoked on-chain & leftover SUI gas float swept back to your wallet.'
          : 'Session grant revoked on-chain.',
        digest ? 'Suiscan' : undefined,
        digest ? `https://suiscan.xyz/mainnet/tx/${digest}` : undefined
      );
      await onSessionUpdated();
    } catch (err: any) {
      onNotify('error', 'Revoke Failed', err?.message || 'Transaction rejected.');
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 text-xs transition-colors ${
        isActive
          ? 'bg-[#08D189]/10 border-[#08D189]/35'
          : 'bg-[#000000] border-[#2D374B]'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <KeyRound className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-[#08D189]' : 'text-[#60A5FA]'}`} />
          <div className="min-w-0">
            <div className="font-semibold text-white truncate">
              {isActive ? '1-Click Session Active' : '1-Click Trading Session'}
            </div>
            <div className="text-[10px] font-mono text-[#6B7280]">
              {isActive
                ? `${minsRemaining >= 60 ? `${Math.floor(minsRemaining / 60)}h ${minsRemaining % 60}m` : `${minsRemaining}m`} left · ${sessionStatus?.sessionGasSui.toFixed(3)} SUI gas`
                : 'Sign once to bet without wallet popups'}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className={`px-2.5 py-1 rounded text-[11px] font-semibold inline-flex items-center gap-1 border transition-colors ${
            isActive
              ? 'border-[#08D189]/35 bg-[#08D189]/15 text-[#08D189]'
              : 'border-[#2B7FFF]/35 bg-[#2B7FFF]/15 text-[#60A5FA]'
          }`}
        >
          <span>{isActive ? 'Manage' : 'Enable'}</span>
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {expanded && (
        <div className="mt-2.5 pt-2.5 border-t border-[#2D374B] space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-[#9CA3AF]">Session Window</span>
            <div className="inline-flex rounded-lg p-0.5 bg-[#000000] border border-[#2D374B]">
              {DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setDurationMs(opt.ms)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono font-semibold transition-colors ${
                    durationMs === opt.ms
                      ? 'bg-[#2B7FFF]/20 text-[#60A5FA]'
                      : 'text-[#6B7280] hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-[#9CA3AF]">Vault USDC Top-Up</span>
            <input
              type="number"
              min="0"
              step="1"
              value={depositInput}
              onChange={(e) => setDepositInput(e.target.value)}
              className="w-24 px-2 py-1 rounded-lg bg-[#000000] border border-[#2D374B] text-right text-xs font-mono text-white outline-none focus:border-[#2B7FFF]"
            />
          </div>

          <div className="text-[10px] text-[#6B7280] leading-relaxed">
            Ephemeral Ed25519 key stays strictly inside your browser; DeepBook Sessions{' '}
            <span className="text-slate-200 font-semibold">cannot withdraw funds</span> and
            auto-expires on-chain.
            {needsGasRefill ? ' Includes 0.05 SUI local gas float (reclaimable on revoke).' : ''}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isBusy || !protocol}
              onClick={handleAuthorize}
              className="flex-1 py-1.5 px-3 rounded-lg btn-deepbook text-xs inline-flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              <span>{isActive ? 'Extend / Top-Up' : 'Authorize 1-Click'}</span>
            </button>
            {isActive && (
              <button
                type="button"
                disabled={isBusy}
                onClick={handleRevoke}
                className="py-1.5 px-2.5 rounded-lg bg-[#F0525E]/15 border border-[#F0525E]/35 text-[#F0525E] hover:bg-[#F0525E]/25 font-semibold text-xs inline-flex items-center gap-1 disabled:opacity-50 transition-colors"
              >
                <ShieldOff className="w-3.5 h-3.5" />
                <span>Revoke</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
