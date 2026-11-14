import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Layers,
  Loader2,
  RefreshCw,
  ShieldOff,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { fetchAftermathAccountState, type AfAccountState } from '../aftermathPerps';
import { fetchAllMarginPositionsForOwner, type MarginManagerPosition } from '../deepbookMargin';
import { fetchPredictBoard } from '../deepbookPredict';
import {
  buildAuthorizePredictSessionTx,
  buildRevokePredictSessionTx,
  clearLocalSessionKey,
  getOrCreateLocalSessionKey,
  reclaimSessionGasFloat,
  saveLocalSessionKey,
  type SessionStatusSnapshot,
} from '../deepbookSessions';
import { DEFAULT_DEEPBOOK_POOLS, discoverBalanceManagers } from '../deepbookV3';
import { useSyncedWalletVolume, type OnChainTradeEntry } from '../onChainVolume';
import { extractTxDigest, invalidateRpcCache } from '../suiClient';
import { simulateTxBeforeWallet } from '../suiSimulate';

type ModalTab = 'ledger' | 'sessions';
type ChannelFilter = 'All' | OnChainTradeEntry['channel'];

interface ActivitySessionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionStatus: SessionStatusSnapshot | null;
  onRefreshSession: () => Promise<void>;
  onNavigateTab: (tab: 'swap' | 'perps' | 'predict' | 'earn' | 'tiers') => void;
  onOpenPortfolio: () => void;
  onNotify: (
    type: 'success' | 'error' | 'info' | 'warning',
    title: string,
    message: string,
    actionLabel?: string,
    actionUrl?: string
  ) => void;
}

const CHANNEL_FILTERS: ChannelFilter[] = [
  'All',
  'Swap',
  'Spot CLOB',
  'Margin 4.5x',
  'Perps',
  'Predict',
  'Earn',
];

function mapModeToChannel(mode?: string): OnChainTradeEntry['channel'] {
  const m = String(mode || '').toLowerCase();
  if (m.includes('perp')) return 'Perps';
  if (m.includes('margin')) return 'Margin 4.5x';
  if (m.includes('clob') || m.includes('limit')) return 'Spot CLOB';
  if (m.includes('predict') || m.includes('up') || m.includes('down') || m.includes('range'))
    return 'Predict';
  if (m.includes('earn') || m.includes('zap') || m.includes('supply')) return 'Earn';
  return 'Swap';
}

export const ActivitySessionsModal: React.FC<ActivitySessionsModalProps> = ({
  isOpen,
  onClose,
  sessionStatus,
  onRefreshSession,
  onNavigateTab,
  onOpenPortfolio,
  onNotify,
}) => {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();

  const [tab, setTab] = useState<ModalTab>('ledger');
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('All');
  const [sessionBusy, setSessionBusy] = useState(false);
  const [afState, setAfState] = useState<AfAccountState | null>(null);
  const [clobVaultCount, setClobVaultCount] = useState<number>(0);
  const [marginPositions, setMarginPositions] = useState<MarginManagerPosition[]>([]);
  const [loadingInfra, setLoadingInfra] = useState(false);

  const { volumeUsd, summary, isSyncing, refresh: refreshVolume } = useSyncedWalletVolume(
    account?.address
  );

  const loadProtocolSessions = useCallback(async () => {
    if (!account?.address) return;
    setLoadingInfra(true);
    try {
      const [af, mgrIds, marginList] = await Promise.all([
        fetchAftermathAccountState(account.address).catch(() => null),
        discoverBalanceManagers(account.address).catch(() => [] as string[]),
        fetchAllMarginPositionsForOwner(account.address, DEFAULT_DEEPBOOK_POOLS).catch(
          () => [] as MarginManagerPosition[]
        ),
        onRefreshSession().catch(() => {}),
      ]);
      setAfState(af);
      setClobVaultCount(mgrIds.length);
      setMarginPositions(marginList);
    } finally {
      setLoadingInfra(false);
    }
  }, [account?.address, onRefreshSession]);

  useEffect(() => {
    if (isOpen && account?.address) {
      loadProtocolSessions();
    }
  }, [isOpen, account?.address, loadProtocolSessions]);

  // Merge on-chain GraphQL + Aftermath history with local optimistic session records
  const mergedTrades = useMemo(() => {
    const byDigest = new Map<string, OnChainTradeEntry>();
    for (const t of summary?.trades || []) {
      if (t?.digest && !byDigest.has(t.digest)) {
        byDigest.set(t.digest, t);
      }
    }
    if (typeof window !== 'undefined' && account?.address) {
      try {
        const raw = window.localStorage.getItem('volt_my_swaps');
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            const addrLower = account.address.toLowerCase();
            for (const item of arr) {
              if (!item?.digest || byDigest.has(item.digest)) continue;
              if (item.address && String(item.address).toLowerCase() !== addrLower) continue;
              const ts =
                typeof item.timestamp === 'number'
                  ? item.timestamp
                  : new Date(item.timestamp || 0).getTime() || Date.now();
              byDigest.set(item.digest, {
                digest: item.digest,
                timestampMs: ts,
                channel: mapModeToChannel(item.swapMode),
                label:
                  item.fromToken && item.toToken
                    ? `${item.fromToken} → ${item.toToken}`
                    : item.swapMode || 'Volt Execution',
                volumeUsd: Number(item.volumeUsd || 0),
              });
            }
          }
        }
      } catch {
        // ignore storage parse error
      }
    }
    return Array.from(byDigest.values()).sort((a, b) => b.timestampMs - a.timestampMs);
  }, [summary?.trades, account?.address]);

  const filteredTrades = useMemo(() => {
    if (channelFilter === 'All') return mergedTrades;
    return mergedTrades.filter((t) => t.channel === channelFilter);
  }, [mergedTrades, channelFilter]);

  const predictActive = Boolean(sessionStatus?.isActiveNow);
  const predictExpiresAtMs = sessionStatus?.onChainExpiresAtMs ?? 0;
  const predictMinsLeft = predictActive
    ? Math.max(1, Math.round((predictExpiresAtMs - Date.now()) / 60_000))
    : 0;
  const needsGasRefill = !sessionStatus || sessionStatus.sessionGasSui < 0.015;

  const handleAuthorizePredictSession = async () => {
    if (!account?.address) return;
    setSessionBusy(true);
    try {
      const board = await fetchPredictBoard(account.address);
      const { record } = getOrCreateLocalSessionKey(account.address);
      const durationMs = 6 * 60 * 60 * 1000;
      const tx = buildAuthorizePredictSessionTx({
        owner: account.address,
        sessionAddress: record.sessionAddress,
        durationMs,
        hasAccount: Boolean(board.account?.hasAccount),
        protocol: board.protocol,
        depositUsdc: 0,
        fundGasMist: needsGasRefill ? 50_000_000n : 0n,
        expiredSessionsToPrune: sessionStatus?.expiredSessionAddresses ?? [],
      });
      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) {
        onNotify('error', 'Session Setup Failed', sim.errorMessage || 'Simulation aborted.');
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
        '1-Click Session Enabled (6h)',
        'Popup-free DeepBook Predict session key authorized with gas float.',
        digest ? 'Suiscan' : undefined,
        digest ? `https://suiscan.xyz/mainnet/tx/${digest}` : undefined
      );
      await onRefreshSession();
    } catch (err: any) {
      onNotify('error', 'Session Cancelled', err?.message || 'Wallet rejected authorization.');
    } finally {
      setSessionBusy(false);
    }
  };

  const handleRevokePredictSession = async () => {
    if (!account?.address || !sessionStatus?.localKey) return;
    setSessionBusy(true);
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
        onNotify('error', 'Revoke Failed', sim.errorMessage || 'Simulation error.');
        return;
      }
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      const reclaimed = await reclaimSessionGasFloat(account.address).catch(() => null);
      clearLocalSessionKey(account.address);
      invalidateRpcCache('listBalances:');
      onNotify(
        'info',
        'Session Revoked',
        reclaimed
          ? 'Session revoked on-chain & remaining SUI gas float reclaimed.'
          : 'Session revoked on-chain.',
        digest ? 'Suiscan' : undefined,
        digest ? `https://suiscan.xyz/mainnet/tx/${digest}` : undefined
      );
      await onRefreshSession();
    } catch (err: any) {
      onNotify('error', 'Revoke Failed', err?.message || 'Wallet rejected.');
    } finally {
      setSessionBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
      <div className="w-full max-w-3xl max-h-[88vh] flex flex-col panel-carbon rounded-2xl border border-[#38445B] shadow-2xl overflow-hidden animate-panel-in">
        {/* Top Header */}
        <div className="px-5 py-4 border-b border-[#2D374B] bg-[#06070A] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#2B7FFF]/15 border border-[#2B7FFF]/40 flex items-center justify-center">
              <Activity className="w-4 h-4 text-[#60A5FA]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white leading-tight">
                Multi-Market Activity &amp; 1-Click Sessions
              </h2>
              <p className="text-[11px] font-mono text-[#8E98A8]">
                Unified order ledger + Ephemeral session keys across Swap, CLOB, Margin, Perps &amp; Predict
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={isSyncing || loadingInfra}
              onClick={() => {
                refreshVolume(true);
                loadProtocolSessions();
              }}
              className="px-2.5 py-1.5 rounded-lg bg-[#0C0F16] hover:bg-[#131722] border border-[#323D52] text-xs font-mono text-slate-200 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 text-[#60A5FA] ${
                  isSyncing || loadingInfra ? 'animate-spin' : ''
                }`}
              />
              <span>Sync</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Sub-tab switcher */}
        <div className="px-5 py-2.5 border-b border-[#2D374B] bg-[#030406] flex items-center justify-between gap-3">
          <div className="inline-flex p-0.5 rounded-lg bg-[#0B0E14] border border-[#323D52]">
            <button
              type="button"
              onClick={() => setTab('ledger')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                tab === 'ledger' ? 'bg-[#2B7FFF] text-white' : 'text-[#8E98A8] hover:text-white'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Order Ledger ({mergedTrades.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('sessions')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                tab === 'sessions' ? 'bg-[#2B7FFF] text-white' : 'text-[#8E98A8] hover:text-white'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>1-Click Sessions</span>
              {predictActive && <span className="w-1.5 h-1.5 rounded-full bg-[#08D189]" />}
            </button>
          </div>

          <div className="text-xs font-mono text-slate-300 hidden sm:block tabular-nums">
            Total Verified Volume:{' '}
            <span className="text-white font-bold">
              ${volumeUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 bg-[#000000] space-y-4">
          {!account?.address ? (
            <div className="panel-carbon-sub rounded-xl p-8 text-center space-y-2">
              <Wallet className="w-8 h-8 text-[#60A5FA] mx-auto" />
              <div className="text-sm font-bold text-white">Wallet Not Connected</div>
              <p className="text-xs text-slate-400">
                Connect your Sui wallet to view cross-market activity and manage 1-click session keys.
              </p>
            </div>
          ) : tab === 'ledger' ? (
            <>
              {/* Filter pills */}
              <div className="flex flex-wrap items-center gap-1.5">
                {CHANNEL_FILTERS.map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => setChannelFilter(ch)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono border transition-colors ${
                      channelFilter === ch
                        ? 'bg-[#2B7FFF]/20 border-[#2B7FFF] text-white font-bold'
                        : 'bg-[#090B10] border-[#2E384C] text-[#8E98A8] hover:text-white'
                    }`}
                  >
                    {ch}
                  </button>
                ))}
              </div>

              {filteredTrades.length === 0 ? (
                <div className="panel-carbon-sub rounded-xl p-6 text-center text-xs font-mono text-slate-400">
                  {isSyncing
                    ? 'Scanning Sui Mainnet GraphQL & Aftermath Perpetuals fills...'
                    : `No recent ${channelFilter === 'All' ? '' : channelFilter + ' '}transactions indexed yet.`}
                </div>
              ) : (
                <div className="rounded-xl border border-[#2E384C] divide-y divide-[#2A3346] overflow-hidden">
                  {filteredTrades.slice(0, 35).map((tr) => (
                    <div
                      key={`${tr.digest}-${tr.label}`}
                      className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 bg-[#050608] hover:bg-white/[0.02] text-xs font-mono"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="px-2 py-0.5 rounded bg-[#2B7FFF]/15 text-[#60A5FA] text-[10px] shrink-0">
                          {tr.channel}
                        </span>
                        <span className="text-white font-semibold truncate">{tr.label}</span>
                      </div>
                      <div className="flex items-center gap-3 tabular-nums shrink-0">
                        <span className="text-[#08D189] font-bold">${tr.volumeUsd.toFixed(2)}</span>
                        <span className="text-[#8E98A8] text-[11px]">
                          {tr.timestampMs > 0
                            ? new Date(tr.timestampMs).toLocaleString([], {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : 'On-Chain'}
                        </span>
                        <a
                          href={`https://suiscan.xyz/mainnet/tx/${tr.digest}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#60A5FA] hover:underline inline-flex items-center gap-1"
                        >
                          <span>{tr.digest.slice(0, 6)}...</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              {/* 1. DeepBook Predict 1-Click Session Key */}
              <div className="panel-carbon-sub rounded-xl p-4 space-y-3 border border-[#323D52]">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <KeyRound
                      className={`w-4 h-4 ${predictActive ? 'text-[#08D189]' : 'text-[#60A5FA]'}`}
                    />
                    <span className="text-sm font-bold text-white">
                      DeepBook Predict · 1-Click Session Key
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
                      predictActive
                        ? 'bg-[#08D189]/15 border border-[#08D189]/40 text-[#08D189]'
                        : 'bg-white/[0.06] border border-[#38445B] text-[#8E98A8]'
                    }`}
                  >
                    {predictActive
                      ? `ACTIVE · ${predictMinsLeft >= 60 ? `${Math.floor(predictMinsLeft / 60)}h ` : ''}${predictMinsLeft % 60}m left`
                      : 'NOT AUTHORIZED'}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs font-mono">
                  <div className="rounded-lg bg-[#000000] border border-[#2D374B] px-3 py-2">
                    <div className="text-[10px] text-slate-400 font-sans">Local Key Gas Float</div>
                    <div
                      className={`font-semibold mt-0.5 ${
                        (sessionStatus?.sessionGasSui ?? 0) >= 0.01
                          ? 'text-[#08D189]'
                          : 'text-amber-400'
                      }`}
                    >
                      {(sessionStatus?.sessionGasSui ?? 0).toFixed(4)} SUI
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#000000] border border-[#2D374B] px-3 py-2">
                    <div className="text-[10px] text-slate-400 font-sans">Active On-Chain Grants</div>
                    <div className="text-white font-semibold mt-0.5">
                      {sessionStatus?.activeGrantCount ?? 0} / 20 slots
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#000000] border border-[#2D374B] px-3 py-2">
                    <div className="text-[10px] text-slate-400 font-sans">Session Key Address</div>
                    <div className="text-slate-200 font-semibold mt-0.5 truncate">
                      {sessionStatus?.localKey?.sessionAddress
                        ? `${sessionStatus.localKey.sessionAddress.slice(0, 8)}...${sessionStatus.localKey.sessionAddress.slice(-6)}`
                        : 'Generated on setup'}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={sessionBusy}
                    onClick={handleAuthorizePredictSession}
                    className="px-3.5 py-2 rounded-lg btn-deepbook text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {sessionBusy ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Zap className="w-3.5 h-3.5" />
                    )}
                    <span>{predictActive ? 'Extend 6h & Refill Gas' : 'Enable 6h 1-Click Session'}</span>
                  </button>

                  {sessionStatus?.isAuthorizedOnChain && sessionStatus.localKey && (
                    <button
                      type="button"
                      disabled={sessionBusy}
                      onClick={handleRevokePredictSession}
                      className="px-3 py-2 rounded-lg bg-[#141720] hover:bg-[#1C212E] border border-[#38445B] text-xs font-semibold text-rose-400 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      <ShieldOff className="w-3.5 h-3.5" />
                      <span>Revoke &amp; Reclaim SUI</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onNavigateTab('predict');
                    }}
                    className="ml-auto px-3 py-2 rounded-lg bg-[#090B10] hover:bg-[#121622] border border-[#323D52] text-xs font-mono text-[#60A5FA]"
                  >
                    Open Predict →
                  </button>
                </div>
              </div>

              {/* 2. DeepBook v3 Spot CLOB & Margin Vaults */}
              <div className="panel-carbon-sub rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 border border-[#323D52]">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-[#60A5FA]" />
                    <span className="text-sm font-bold text-white">
                      DeepBook v3 · BalanceManager &amp; Isolated Margin Vaults
                    </span>
                  </div>
                  <p className="text-xs font-mono text-slate-300">
                    Spot CLOB Vaults:{' '}
                    <span className="text-white font-semibold">{clobVaultCount}</span> · Margin 4.5x
                    Vaults: <span className="text-white font-semibold">{marginPositions.length}</span>{' '}
                    · 1-TX Auto-Settle Enabled
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenPortfolio();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#090B10] hover:bg-[#121622] border border-[#323D52] text-xs font-semibold text-white"
                  >
                    Manage Vaults
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onNavigateTab('swap');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#090B10] hover:bg-[#121622] border border-[#323D52] text-xs font-mono text-[#60A5FA]"
                  >
                    Open CLOB →
                  </button>
                </div>
              </div>

              {/* 3. Aftermath Perps Account */}
              <div className="panel-carbon-sub rounded-xl p-4 flex flex-wrap items-center justify-between gap-3 border border-[#323D52]">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CheckCircle2
                      className={`w-4 h-4 ${
                        afState?.accountId ? 'text-[#08D189]' : 'text-slate-500'
                      }`}
                    />
                    <span className="text-sm font-bold text-white">
                      Aftermath Perpetuals · Margin Account
                    </span>
                  </div>
                  <p className="text-xs font-mono text-slate-300">
                    {afState?.accountId
                      ? `Account #${afState.accountId.replace('n', '')} · ${afState.positions.length} Open Positions · Free Margin $${afState.availableCollateralUsd.toFixed(2)}`
                      : 'No Aftermath Perp Account initialized yet (auto-created in 1 TX on deposit).'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onNavigateTab('perps');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#090B10] hover:bg-[#121622] border border-[#323D52] text-xs font-mono text-[#60A5FA]"
                >
                  Open Perps →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
