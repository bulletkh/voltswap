import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckSquare,
  Flame,
  Layers,
  Loader2,
  RefreshCw,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import {
  buildBurnZeroCoinsTx,
  buildDustSweepTx,
  buildMergeFragmentedCoinsTx,
  scanWalletDust,
  type DustCoinGroup,
  type DustSweepTarget,
  type WalletDustScanResult,
} from '../dustSweeper';
import { extractTxDigest, invalidateRpcCache } from '../suiClient';
import { simulateTxBeforeWallet } from '../suiSimulate';
import { getWalletVolumeUsd } from '../voltFee';

interface DustSweeperModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (msg: string) => void;
}

export const DustSweeperModal: React.FC<DustSweeperModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();

  const [targetSymbol, setTargetSymbol] = useState<DustSweepTarget>('SUI');
  const [scan, setScan] = useState<WalletDustScanResult | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<Record<string, boolean>>({});
  const [alsoBurnZero, setAlsoBurnZero] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [busyAction, setBusyAction] = useState<'burn' | 'merge' | 'sweep' | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const runScan = useCallback(
    async (target: DustSweepTarget) => {
      if (!account?.address) return;
      setIsScanning(true);
      setErrorMsg(null);
      try {
        const res = await scanWalletDust(account.address, target);
        setScan(res);
        const defaults: Record<string, boolean> = {};
        let selectedCount = 0;
        for (const g of res.dustGroups) {
          const auto =
            g.routable &&
            g.estimatedUsd >= 0.005 &&
            g.estimatedUsd <= 15 &&
            selectedCount < 6;
          if (auto) {
            defaults[g.normalizedType] = true;
            selectedCount += 1;
          } else {
            defaults[g.normalizedType] = false;
          }
        }
        setSelectedTypes(defaults);
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : 'Failed to scan wallet coin objects');
      } finally {
        setIsScanning(false);
      }
    },
    [account?.address]
  );

  useEffect(() => {
    if (isOpen && account?.address) {
      setStatusMsg(null);
      runScan(targetSymbol);
    }
  }, [isOpen, account?.address, targetSymbol, runScan]);

  const selectedGroups = useMemo<DustCoinGroup[]>(() => {
    if (!scan) return [];
    return scan.dustGroups.filter((g) => selectedTypes[g.normalizedType] && g.routable);
  }, [scan, selectedTypes]);

  const selectedTotalOut = useMemo(
    () => selectedGroups.reduce((acc, g) => acc + g.estimatedOutUi, 0),
    [selectedGroups]
  );

  const selectedTotalUsd = useMemo(
    () => selectedGroups.reduce((acc, g) => acc + g.estimatedUsd, 0),
    [selectedGroups]
  );

  const toggleToken = (norm: string, routable: boolean) => {
    if (!routable) return;
    setSelectedTypes((prev) => {
      const nextVal = !prev[norm];
      const activeCount = Object.values(prev).filter(Boolean).length;
      if (nextVal && activeCount >= 6) {
        setErrorMsg('Max 6 tokens per atomic sweep PTB. Run first batch, then remaining tokens.');
        return prev;
      }
      setErrorMsg(null);
      return { ...prev, [norm]: nextVal };
    });
  };

  const handleBurnZeroCoins = async () => {
    if (!account?.address || !scan?.zeroCoins.length) return;
    setBusyAction('burn');
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const tx = buildBurnZeroCoinsTx(account.address, scan.zeroCoins);
      await simulateTxBeforeWallet(tx);
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      invalidateRpcCache('listBalances:');
      const burned = Math.min(45, scan.zeroCoins.length);
      const msg = `Burned ${burned} empty coin object${burned === 1 ? '' : 's'} & recovered SUI storage rebate${digest ? ` (${digest.slice(0, 8)}...)` : ''}.`;
      setStatusMsg(msg);
      onSuccess?.(msg);
      await runScan(targetSymbol);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Empty coin burn failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleMergeFragmented = async () => {
    if (!account?.address || !scan?.fragmentedGroups.length) return;
    setBusyAction('merge');
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const tx = buildMergeFragmentedCoinsTx(account.address, scan.fragmentedGroups);
      await simulateTxBeforeWallet(tx);
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      invalidateRpcCache('listBalances:');
      const msg = `Merged fragmented coin objects${digest ? ` (${digest.slice(0, 8)}...)` : ''}.`;
      setStatusMsg(msg);
      onSuccess?.(msg);
      await runScan(targetSymbol);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Coin merge failed');
    } finally {
      setBusyAction(null);
    }
  };

  const handleBatchSweep = async () => {
    if (!account?.address || selectedGroups.length === 0) return;
    setBusyAction('sweep');
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const volumeUsd = getWalletVolumeUsd(account.address);
      const { tx, sweptCount, burnedCount, estimatedTotalOutUi } = await buildDustSweepTx({
        owner: account.address,
        groups: selectedGroups,
        targetSymbol,
        slippage: 0.02,
        volumeUsd,
        zeroCoins: scan?.zeroCoins ?? [],
        alsoBurnZeroCoins: alsoBurnZero,
      });
      await simulateTxBeforeWallet(tx);
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      invalidateRpcCache('listBalances:');
      const burnSuffix = burnedCount > 0 ? ` + burned ${burnedCount} empty coins` : '';
      const msg = `Swept ${sweptCount} token${sweptCount === 1 ? '' : 's'} -> ~${estimatedTotalOutUi.toFixed(targetSymbol === 'USDC' ? 2 : 4)} ${targetSymbol}${burnSuffix}${digest ? ` (${digest.slice(0, 8)}...)` : ''}.`;
      setStatusMsg(msg);
      onSuccess?.(msg);
      await runScan(targetSymbol);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Batch dust sweep failed');
    } finally {
      setBusyAction(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-2xl max-h-[90vh] flex flex-col panel-carbon rounded-xl border border-[#1B1F27] shadow-2xl overflow-hidden animate-panel-in">
        <div className="px-5 py-4 border-b border-[#1A1E26] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#2B7FFF]/15 border border-[#2B7FFF]/35 flex items-center justify-center text-[#60A5FA]">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white leading-tight">
                Sui Dust & Rebate Sweeper
              </h2>
              <p className="text-xs text-[#6B7280]">
                Reclaim SUI storage rebates from empty coins & consolidate dust in 1 PTB
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {account && (
              <button
                type="button"
                onClick={() => runScan(targetSymbol)}
                disabled={isScanning}
                className="p-2 rounded-lg panel-carbon-sub hover:border-[#2B7FFF]/35 text-[#9CA3AF] hover:text-white transition-colors"
                title="Rescan wallet coins"
              >
                <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg panel-carbon-sub hover:border-[#2B7FFF]/35 text-[#9CA3AF] hover:text-white transition-colors"
              aria-label="Close dust sweeper"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!account ? (
            <div className="text-center py-10 text-sm text-[#9CA3AF]">
              Connect your Sui wallet to scan for empty coins, duplicate objects, and swap dust.
            </div>
          ) : isScanning && !scan ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-sm text-slate-300">
              <Loader2 className="w-6 h-6 animate-spin text-[#2B7FFF]" />
              <span>Scanning owned Coin&lt;T&gt; objects & live Cetus routes...</span>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="panel-carbon-sub rounded-lg p-3.5 flex flex-col justify-between gap-2.5 border border-[#08D189]/25">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                        <Flame className="w-3.5 h-3.5 text-[#08D189]" />
                        <span>Empty Coin Burner</span>
                      </div>
                      <p className="text-[11px] text-[#6B7280] mt-1">
                        {scan?.zeroCoins.length ?? 0} empty objects (0 balance) found · est. ~
                        {(scan?.estimatedZeroRebateSui ?? 0).toFixed(4)} SUI storage rebate
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#08D189]/15 text-[#08D189]">
                      0% FEE
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={busyAction !== null || !scan?.zeroCoins.length}
                    onClick={handleBurnZeroCoins}
                    className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-[#08D189]/15 border border-[#08D189]/40 text-[#08D189] hover:bg-[#08D189]/25 disabled:opacity-45 inline-flex items-center justify-center gap-1.5 transition-colors"
                  >
                    {busyAction === 'burn' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>
                      {scan?.zeroCoins.length
                        ? `Burn ${Math.min(45, scan.zeroCoins.length)} Empty Coins`
                        : 'No Empty Coins'}
                    </span>
                  </button>
                </div>

                <div className="panel-carbon-sub rounded-lg p-3.5 flex flex-col justify-between gap-2.5 border border-[#2B7FFF]/25">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                        <Layers className="w-3.5 h-3.5 text-[#60A5FA]" />
                        <span>Coin Consolidator</span>
                      </div>
                      <p className="text-[11px] text-[#6B7280] mt-1">
                        {scan?.fragmentedGroups.length ?? 0} split token types (&ge; 2 objects) can merge cleanly
                      </p>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#2B7FFF]/15 text-[#60A5FA]">
                      0% FEE
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={busyAction !== null || !scan?.fragmentedGroups.length}
                    onClick={handleMergeFragmented}
                    className="w-full py-2 px-3 rounded-lg text-xs font-semibold bg-[#2B7FFF]/15 border border-[#2B7FFF]/40 text-[#60A5FA] hover:bg-[#2B7FFF]/25 disabled:opacity-45 inline-flex items-center justify-center gap-1.5 transition-colors"
                  >
                    {busyAction === 'merge' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>
                      {scan?.fragmentedGroups.length
                        ? `Merge ${scan.fragmentedGroups.length} Split Types`
                        : 'Wallet Clean (No Splits)'}
                    </span>
                  </button>
                </div>
              </div>

              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-white">
                      Batch Dust Converter ({scan?.dustGroups.length ?? 0} tokens)
                    </div>
                    <div className="text-[11px] text-[#6B7280]">
                      Select up to 6 liquid tokens per atomic Cetus v2 swap PTB · SUI gas stays untouched
                    </div>
                  </div>
                  <div className="inline-flex rounded-lg p-0.5 bg-[#000000] border border-[#1A1E26] text-xs font-mono">
                    {(['SUI', 'USDC'] as DustSweepTarget[]).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTargetSymbol(t)}
                        className={`px-3 py-1 rounded font-semibold transition-colors ${
                          targetSymbol === t
                            ? 'bg-[#2B7FFF]/20 text-[#60A5FA] border border-[#2B7FFF]/40'
                            : 'text-[#6B7280] hover:text-white'
                        }`}
                      >
                        Sweep to {t}
                      </button>
                    ))}
                  </div>
                </div>

                {!scan?.dustGroups.length ? (
                  <div className="panel-carbon-sub rounded-lg p-5 text-center text-xs text-[#6B7280]">
                    No non-{targetSymbol} tokens found in this wallet.
                  </div>
                ) : (
                  <div className="divide-y divide-[#1A1E26] panel-carbon-sub rounded-lg overflow-hidden max-h-64 overflow-y-auto">
                    {scan.dustGroups.map((grp) => {
                      const checked = Boolean(selectedTypes[grp.normalizedType]);
                      return (
                        <button
                          key={grp.normalizedType}
                          type="button"
                          onClick={() => toggleToken(grp.normalizedType, grp.routable)}
                          disabled={!grp.routable}
                          className={`w-full px-3.5 py-2.5 flex items-center justify-between text-left transition-colors ${
                            grp.routable
                              ? 'hover:bg-[#0C0E13] cursor-pointer'
                              : 'opacity-50 cursor-not-allowed'
                          }`}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {checked ? (
                              <CheckSquare className="w-4 h-4 text-[#2B7FFF] shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 text-[#6B7280] shrink-0" />
                            )}
                            {grp.logo ? (
                              <img
                                src={grp.logo}
                                alt={grp.symbol}
                                className="w-6 h-6 rounded-full shrink-0 bg-[#1A1E26]"
                              />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-[#000000] border border-[#1A1E26] flex items-center justify-center text-[10px] font-mono text-slate-300 shrink-0">
                                {grp.symbol.slice(0, 2)}
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-white">{grp.symbol}</span>
                                <span className="text-[10px] font-mono text-[#6B7280]">
                                  ({grp.coins.length} obj)
                                </span>
                              </div>
                              <div className="text-[11px] font-mono text-slate-300 truncate">
                                {grp.formattedAmount} {grp.symbol}
                                {grp.skipReason ? ` · ${grp.skipReason}` : ''}
                              </div>
                            </div>
                          </div>

                          <div className="text-right font-mono tabular-nums shrink-0 pl-2">
                            {grp.routable ? (
                              <>
                                <div className="text-xs font-semibold text-[#08D189]">
                                  ~{grp.estimatedOutUi.toFixed(targetSymbol === 'USDC' ? 2 : 4)}{' '}
                                  {targetSymbol}
                                </div>
                                <div className="text-[10px] text-[#6B7280]">
                                  ${grp.estimatedUsd.toFixed(2)}
                                </div>
                              </>
                            ) : (
                              <span className="text-[11px] text-[#6B7280]">Unroutable</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {scan && scan.zeroCoins.length > 0 && selectedGroups.length > 0 && (
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer px-1">
                    <input
                      type="checkbox"
                      checked={alsoBurnZero}
                      onChange={(e) => setAlsoBurnZero(e.target.checked)}
                      className="rounded border-[#1A1E26] bg-[#000000] accent-[#08D189]"
                    />
                    <span>
                      Also burn {Math.min(15, scan.zeroCoins.length)} empty coins in the same sweep TX for extra gas rebate
                    </span>
                  </label>
                )}

                  <button
                    type="button"
                    disabled={busyAction !== null || selectedGroups.length === 0}
                    onClick={handleBatchSweep}
                    className="w-full py-3 px-4 rounded-lg text-sm font-bold btn-deepbook disabled:opacity-45 inline-flex items-center justify-center gap-2 transition-colors"
                  >
                    {busyAction === 'sweep' && <Loader2 className="w-4 h-4 animate-spin" />}
                    <span>
                      {selectedGroups.length > 0
                        ? `Sweep ${selectedGroups.length} Token${selectedGroups.length === 1 ? '' : 's'} -> ~${selectedTotalOut.toFixed(targetSymbol === 'USDC' ? 2 : 4)} ${targetSymbol} ($${selectedTotalUsd.toFixed(2)})`
                        : 'Select Routable Tokens to Sweep'}
                    </span>
                  </button>
              </div>

              {statusMsg && (
                <div className="text-xs text-[#08D189] bg-[#08D189]/10 border border-[#08D189]/30 rounded-lg px-3.5 py-2.5">
                  {statusMsg}
                </div>
              )}
              {errorMsg && (
                <div className="text-xs text-[#F0525E] bg-[#F0525E]/10 border border-[#F0525E]/30 rounded-lg px-3.5 py-2.5">
                  {errorMsg}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
