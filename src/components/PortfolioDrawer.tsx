import React, { useEffect, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw, Sparkles, Wallet, X } from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { POPULAR_TOKENS } from '../constants';
import { fetchWalletBalances, getRpcPoolStats, readBalanceFromMap } from '../suiClient';
import { simulateTxBeforeWallet } from '../suiSimulate';
import { useDAppKit as usePredictDAppKit } from '@mysten/dapp-kit-react';
import { buildPredictWithdrawTx, fetchPredictBoard } from '../deepbookPredict';
import { extractTxDigest as extractPredictTxDigest } from '../suiClient';
import { fetchAftermathAccountState, type AfAccountState } from '../aftermathPerps';
import { DustSweeperModal } from './DustSweeperModal';
import {
  buildWithdrawAllManagersAndCancelTx,
  DEFAULT_DEEPBOOK_POOLS,
  discoverBalanceManagers,
  fetchAllDeepBookManagerStates,
  type DeepBookManagerState,
} from '../deepbookV3';
import {
  fetchDeepBookMarginVaults,
  fetchUserDeepBookMarginPositions,
  type DeepBookMarginVault,
  type UserMarginPosition,
} from '../earnPools';

interface PortfolioDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

const SUI_TOKENS = POPULAR_TOKENS.filter((t) => t.chain === 'sui');
const DEFAULT_CLOB_POOL = DEFAULT_DEEPBOOK_POOLS[0];

export const PortfolioDrawer: React.FC<PortfolioDrawerProps> = ({ isOpen, onClose }) => {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [afState, setAfState] = useState<AfAccountState | null>(null);
  const [marginPositions, setMarginPositions] = useState<Record<string, UserMarginPosition>>({});
  const [marginVaults, setMarginVaults] = useState<DeepBookMarginVault[]>([]);
  const [clobManagers, setClobManagers] = useState<DeepBookManagerState[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isWithdrawingClob, setIsWithdrawingClob] = useState(false);
  const [clobStatus, setClobStatus] = useState<string | null>(null);
  const [clobError, setClobError] = useState<string | null>(null);

  const loadPortfolio = async () => {
    if (!account?.address) return;
    setIsLoading(true);
    try {
      const [balMap, af, posData, vaults, clobIds] = await Promise.all([
        fetchWalletBalances(account.address),
        fetchAftermathAccountState(account.address).catch(() => null),
        fetchUserDeepBookMarginPositions(account.address).catch(() => ({
          supplierCapIds: [],
          positions: {},
        })),
        fetchDeepBookMarginVaults().catch(() => []),
        discoverBalanceManagers(account.address).catch(() => [] as string[]),
      ]);
      const clobStates =
        clobIds.length > 0
          ? await fetchAllDeepBookManagerStates(account.address, clobIds, DEFAULT_CLOB_POOL).catch(
              () => []
            )
          : [];
      setBalances(balMap);
      setAfState(af);
      setMarginPositions(posData.positions);
      setMarginVaults(vaults);
      setClobManagers(clobStates);
    } finally {
      setIsLoading(false);
    }
  };

  const handleWithdrawClob = async (cancelOpenOrders: boolean) => {
    if (!account?.address || clobManagers.length === 0) return;
    setIsWithdrawingClob(true);
    setClobStatus(null);
    setClobError(null);
    try {
      const tx = buildWithdrawAllManagersAndCancelTx({
        owner: account.address,
        pool: DEFAULT_CLOB_POOL,
        managers: clobManagers.map((m) => ({
          managerId: m.managerId,
          openOrderIds: cancelOpenOrders ? m.openOrders.map((o) => o.orderId) : [],
        })),
      });
      await simulateTxBeforeWallet(tx);
      await dAppKit.signAndExecuteTransaction({ transaction: tx });
      setClobStatus(
        cancelOpenOrders
          ? 'Open CLOB orders cancelled and all vault balances returned to your wallet.'
          : 'Unlocked DeepBook CLOB funds withdrawn to your wallet.'
      );
      await loadPortfolio();
    } catch (e) {
      setClobError(e instanceof Error ? e.message : 'CLOB withdrawal failed');
    } finally {
      setIsWithdrawingClob(false);
    }
  };

  const predictDAppKit = usePredictDAppKit();
  const [predictAvailableUsd, setPredictAvailableUsd] = useState(0);
  const [predictPendingUsd, setPredictPendingUsd] = useState(0);
  const [isWithdrawingPredict, setIsWithdrawingPredict] = useState(false);
  const [predictStatusMsg, setPredictStatusMsg] = useState<string | null>(null);
  const [isDustModalOpen, setIsDustModalOpen] = useState(false);
  const rpcStats = isOpen ? getRpcPoolStats() : null;

  const loadPredictState = async (owner?: string) => {
    if (!owner) {
      setPredictAvailableUsd(0);
      setPredictPendingUsd(0);
      return;
    }
    try {
      const board = await fetchPredictBoard(owner);
      setPredictAvailableUsd(board.account?.availableUsdc ?? 0);
      setPredictPendingUsd(board.account?.pendingUsdc ?? 0);
    } catch {
      // ignore transient rpc errors
    }
  };

  const handleWithdrawPredict = async () => {
    if (!account?.address || predictAvailableUsd <= 0.001) return;
    setIsWithdrawingPredict(true);
    setPredictStatusMsg(null);
    try {
      const tx = buildPredictWithdrawTx(account.address, predictAvailableUsd);
      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) {
        setPredictStatusMsg(sim.errorMessage || 'Withdraw simulation failed.');
        return;
      }
      const res = await predictDAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractPredictTxDigest(res);
      setPredictStatusMsg(
        digest
          ? `Withdrew $${predictAvailableUsd.toFixed(2)} USDC (tx ${digest.slice(0, 8)}...)`
          : `Withdrew $${predictAvailableUsd.toFixed(2)} USDC.`
      );
      await loadPredictState(account.address);
      await loadPortfolio();
    } catch (err: any) {
      setPredictStatusMsg(err?.message || 'Wallet rejected withdrawal.');
    } finally {
      setIsWithdrawingPredict(false);
    }
  };

  useEffect(() => {
    if (isOpen && account?.address) {
      setClobStatus(null);
      setClobError(null);
      setPredictStatusMsg(null);
      loadPortfolio();
      loadPredictState(account.address);
    }
  }, [isOpen, account?.address]);

  if (!isOpen) return null;

  const heldTokens = SUI_TOKENS.map((t) => {
    const amount = account?.address ? readBalanceFromMap(balances, t.address, t.decimals) : 0;
    const usd = amount * (t.priceUsd || 0);
    return { token: t, amount, usd };
  }).filter((item) => item.amount > 0.00001);

  const activeMarginEntries = Object.values(marginPositions).map((pos) => {
    const meta = marginVaults.find((v) => v.coinKey === pos.coinKey);
    const usd = pos.suppliedAmount * (meta?.priceUsd ?? 1);
    return { ...pos, apr: meta?.supplyAprPct ?? 0, usd };
  });

  const spotUsd = heldTokens.reduce((sum, item) => sum + item.usd, 0);
  const perpsUsd = afState?.totalEquityUsd ?? 0;
  const vaultsUsd = activeMarginEntries.reduce((sum, item) => sum + item.usd, 0);

  const suiPrice = SUI_TOKENS.find((t) => t.symbol === 'SUI')?.priceUsd || 0.8;
  const usdcPrice = SUI_TOKENS.find((t) => t.symbol === 'USDC')?.priceUsd || 1;
  const deepPrice = SUI_TOKENS.find((t) => t.symbol === 'DEEP')?.priceUsd || 0;

  const clobOpenOrders = clobManagers.flatMap((m) => m.openOrders);
  const clobUnlockedSui = clobManagers.reduce((s, m) => s + m.baseBalance + m.settledBase, 0);
  const clobUnlockedUsdc = clobManagers.reduce((s, m) => s + m.quoteBalance + m.settledQuote, 0);
  const clobUnlockedDeep = clobManagers.reduce((s, m) => s + m.deepBalance, 0);
  const clobLockedSui = clobOpenOrders
    .filter((o) => !o.isBid)
    .reduce((s, o) => s + Math.max(0, o.quantity - o.filledQuantity), 0);
  const clobLockedUsdc = clobOpenOrders
    .filter((o) => o.isBid)
    .reduce((s, o) => s + Math.max(0, o.quantity - o.filledQuantity) * o.price, 0);

  const clobVaultsUsd =
    (clobUnlockedSui + clobLockedSui) * suiPrice +
    (clobUnlockedUsdc + clobLockedUsdc) * usdcPrice +
    clobUnlockedDeep * deepPrice;

  const hasClobUnlocked =
    clobUnlockedSui > 0.00001 || clobUnlockedUsdc > 0.00001 || clobUnlockedDeep > 0.00001;
  const hasClobFundsOrOrders = hasClobUnlocked || clobOpenOrders.length > 0;
  const nonEmptyClobManagers = clobManagers.filter(
    (m) =>
      m.baseBalance + m.settledBase > 0.00001 ||
      m.quoteBalance + m.settledQuote > 0.00001 ||
      m.deepBalance > 0.00001 ||
      m.openOrders.length > 0
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/80 backdrop-blur-[2px]">
      <div className="w-full max-w-[410px] h-full flex flex-col bg-[#000000] border-l border-[#1E232D] animate-drawer-in">
        <div className="px-5 py-3.5 border-b border-[#1A1E26] flex items-center justify-between bg-[#000000]">
          <div className="flex items-center gap-2.5">
            <Wallet className="w-4 h-4 text-[#60A5FA]" />
            <span className="text-sm font-bold text-white tracking-tight">Portfolio</span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                loadPortfolio();
                loadPredictState(account?.address);
              }}
              className="p-2 rounded-lg bg-[#06070A] border border-[#1B1F27] text-slate-400 hover:text-white hover:border-[#2B7FFF]/50 transition-colors"
              title="Refresh portfolio"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg bg-[#06070A] border border-[#1B1F27] text-slate-400 hover:text-white hover:border-[#2B7FFF]/50 transition-colors"
              title="Close drawer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {!account ? (
            <div className="text-sm text-slate-400 text-center py-12">
              Connect your Sui wallet to inspect live balances, DeepBook vaults, and perpetual equity.
            </div>
          ) : (
            <>
              {/* Hero Total Equity Header matching DeepBook Alpha Drawer */}
              <div className="pb-4 border-b border-[#1A1E26] space-y-3">
                <div>
                  <div className="text-xs text-slate-400 font-medium">Total Portfolio Equity</div>
                  <div className="text-4xl font-mono tabular-nums font-bold text-white tracking-tight mt-1">
                    ${(spotUsd + perpsUsd + vaultsUsd + clobVaultsUsd + predictAvailableUsd + predictPendingUsd).toFixed(2)}
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                  <span>Spot: <strong className="text-slate-200">${spotUsd.toFixed(2)}</strong></span>
                  <span>Vaults: <strong className="text-slate-200">${(vaultsUsd + clobVaultsUsd).toFixed(2)}</strong></span>
                  <span>Perps: <strong className="text-slate-200">${perpsUsd.toFixed(2)}</strong></span>
                </div>

                {(predictAvailableUsd > 0.001 || predictPendingUsd > 0.001) && (
                  <div className="flex items-center justify-between text-xs font-mono text-[#08D189] pt-1 border-t border-[#1A1E26]">
                    <span>DeepBook Predict USDC</span>
                    <span>${(predictAvailableUsd + predictPendingUsd).toFixed(2)}</span>
                  </div>
                )}

                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsDustModalOpen(true)}
                    className="w-full py-2.5 px-4 rounded-lg btn-deepbook text-xs font-bold tracking-wide inline-flex items-center justify-center gap-2"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>SWEEP DUST &amp; RECLAIM SUI GAS</span>
                  </button>
                  {hasClobUnlocked && (
                    <button
                      type="button"
                      disabled={isWithdrawingClob}
                      onClick={() => handleWithdrawClob(false)}
                      className="w-full py-2 px-4 rounded-lg bg-[#06070A] hover:bg-[#0C0E13] border border-[#1E232D] text-white text-xs font-semibold tracking-wide transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
                    >
                      {isWithdrawingClob && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>WITHDRAW CLOB BALANCES</span>
                    </button>
                  )}
                </div>
                {rpcStats && (
                  <div className="text-[11px] font-mono text-slate-500">
                    Mainnet RPC: {rpcStats.activeEndpoint.label}
                    {rpcStats.activeEndpoint.latencyMs > 0
                      ? ` (${rpcStats.activeEndpoint.latencyMs}ms)`
                      : ''}
                  </div>
                )}
              </div>

              {(predictAvailableUsd > 0.001 || predictPendingUsd > 0.001 || predictStatusMsg) && (
                <div className="bg-[#06070A] rounded-lg p-3.5 space-y-2.5 border border-[#08D189]/30">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white uppercase tracking-wider">DeepBook Predict Account</span>
                    <span className="text-xs font-mono text-[#08D189] tabular-nums font-semibold">
                      ${predictAvailableUsd.toFixed(2)} USDC
                    </span>
                  </div>
                  {predictPendingUsd > 0.001 && (
                    <div className="text-[11px] font-mono text-amber-300">
                      Pending escrow: ${predictPendingUsd.toFixed(2)} USDC
                    </div>
                  )}
                  {predictStatusMsg && (
                    <div className="text-[11px] text-[#60A5FA] font-mono">{predictStatusMsg}</div>
                  )}
                  {predictAvailableUsd > 0.001 && (
                    <button
                      type="button"
                      disabled={isWithdrawingPredict}
                      onClick={handleWithdrawPredict}
                      className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-[#08D189]/15 border border-[#08D189]/40 text-[#08D189] hover:bg-[#08D189]/25 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                    >
                      {isWithdrawingPredict && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>Withdraw All Predict USDC (${predictAvailableUsd.toFixed(2)})</span>
                    </button>
                  )}
                </div>
              )}

              {hasClobFundsOrOrders && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-0.5">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      Spot CLOB Vaults ({nonEmptyClobManagers.length})
                    </span>
                    <span className="text-xs font-mono text-[#60A5FA] font-semibold">
                      ${clobVaultsUsd.toFixed(2)}
                    </span>
                  </div>
                  <div className="bg-[#06070A] rounded-lg p-3 space-y-2.5 border border-[#1B1F27]">
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      <div className="rounded bg-[#000000] border border-[#1A1E26] px-2.5 py-2">
                        <div className="text-[10px] text-slate-500 font-sans">Unlocked in Vaults</div>
                        <div className="text-white font-semibold mt-0.5 tabular-nums">
                          {clobUnlockedSui.toFixed(4)} SUI
                        </div>
                        <div className="text-slate-300 tabular-nums">
                          {clobUnlockedUsdc.toFixed(4)} USDC
                        </div>
                      </div>
                      <div className="rounded bg-[#000000] border border-[#1A1E26] px-2.5 py-2">
                        <div className="text-[10px] text-slate-500 font-sans">
                          In Open Orders ({clobOpenOrders.length})
                        </div>
                        <div className="text-amber-300 font-semibold mt-0.5 tabular-nums">
                          {clobLockedSui.toFixed(4)} SUI
                        </div>
                        <div className="text-slate-300 tabular-nums">
                          {clobLockedUsdc.toFixed(4)} USDC
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1">
                      {nonEmptyClobManagers.map((m) => {
                        const mSui = m.baseBalance + m.settledBase;
                        const mUsdc = m.quoteBalance + m.settledQuote;
                        return (
                          <div
                            key={m.managerId}
                            className="flex items-center justify-between text-[11px] font-mono px-2.5 py-1.5 rounded bg-[#000000] border border-[#1A1E26]"
                          >
                            <a
                              href={`https://suiscan.xyz/mainnet/object/${m.managerId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[#60A5FA] hover:underline"
                            >
                              <span>
                                {m.managerId.slice(0, 6)}...{m.managerId.slice(-4)}
                              </span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                            <span className="text-slate-200 tabular-nums">
                              {mSui.toFixed(3)} SUI · {mUsdc.toFixed(3)} USDC
                              {m.openOrders.length > 0 ? ` · ${m.openOrders.length} ord` : ''}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {clobOpenOrders.length > 0 && (
                      <button
                        type="button"
                        disabled={isWithdrawingClob}
                        onClick={() => handleWithdrawClob(true)}
                        className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-[#F0525E]/15 border border-[#F0525E]/40 text-[#F0525E] hover:bg-[#F0525E]/25 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                      >
                        {isWithdrawingClob && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        <span>
                          Cancel All ({clobOpenOrders.length}) &amp; Withdraw All to Wallet
                        </span>
                      </button>
                    )}

                    {clobStatus && (
                      <div className="text-xs text-[#08D189] bg-[#08D189]/10 border border-[#08D189]/30 rounded-lg px-3 py-2">
                        {clobStatus}
                      </div>
                    )}
                    {clobError && (
                      <div className="text-xs text-[#F0525E] bg-[#F0525E]/10 border border-[#F0525E]/30 rounded-lg px-3 py-2">
                        {clobError}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeMarginEntries.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-300 px-0.5">
                    DeepBook v3 Lending Deposits
                  </div>
                  <div className="divide-y divide-[#1A1E26] bg-[#06070A] border border-[#1B1F27] rounded-lg overflow-hidden">
                    {activeMarginEntries.map((m) => (
                      <div
                        key={m.coinKey}
                        className="px-3.5 py-2.5 flex items-center justify-between text-xs font-mono"
                      >
                        <div>
                          <div className="text-sm font-bold text-white font-sans">{m.coinKey} Vault</div>
                          <div className="text-xs text-[#60A5FA]">{m.apr.toFixed(2)}% APR</div>
                        </div>
                        <div className="text-right tabular-nums">
                          <div className="text-sm font-semibold text-white">
                            {m.suppliedAmount.toFixed(4)} {m.coinKey}
                          </div>
                          <div className="text-xs text-slate-400">${m.usd.toFixed(2)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs px-0.5">
                  <span className="font-bold uppercase tracking-wider text-slate-300">Wallet Assets</span>
                  <a
                    href={`https://suiscan.xyz/mainnet/account/${account.address}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-[#60A5FA] hover:underline font-mono"
                  >
                    <span>Suiscan</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                {heldTokens.length === 0 ? (
                  <div className="bg-[#06070A] border border-[#1B1F27] rounded-lg p-5 text-center text-xs text-slate-500">
                    No assets yet
                  </div>
                ) : (
                  <div className="divide-y divide-[#1A1E26] bg-[#06070A] border border-[#1B1F27] rounded-lg overflow-hidden">
                    {heldTokens.map(({ token, amount, usd }) => (
                      <div
                        key={token.address + token.symbol}
                        className="px-3.5 py-2.5 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          <img src={token.logo} alt={token.symbol} className="w-6 h-6 rounded-full" />
                          <div>
                            <div className="text-sm font-bold text-white">{token.symbol}</div>
                            <div className="text-[11px] text-slate-400">{token.name}</div>
                          </div>
                        </div>
                        <div className="text-right font-mono tabular-nums">
                          <div className="text-sm text-white font-semibold">
                            {amount.toFixed(token.decimals > 6 ? 4 : 2)}
                          </div>
                          <div className="text-[11px] text-slate-400">${usd.toFixed(2)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      <DustSweeperModal
        isOpen={isDustModalOpen}
        onClose={() => setIsDustModalOpen(false)}
        onSuccess={() => {
          loadPortfolio();
        }}
      />
    </div>
  );
};
