import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bot,
  Grid3X3,
  Loader2,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import {
  buildSpotGridPlan,
  buildYieldAndMarginReport,
  computeMarketQuant,
  generatePredictCopilotSetups,
  type PredictCopilotSetup,
  type SpotGridStyle,
} from '../aiCopilot';
import {
  buildPlaceDeepBookGridTx,
  DEFAULT_DEEPBOOK_POOLS,
  discoverBalanceManagers,
  fetchAllDeepBookManagerStates,
  fetchDeepBookCandles,
  fetchDeepBookOrderbook,
  fetchDeepBookPools,
  fetchVoltSpotReferrals,
  type DeepBookCandle,
  type DeepBookManagerState,
  type DeepBookPoolMeta,
} from '../deepbookV3';
import {
  buildPredictPlaceBetTx,
  fetchPredictBoard,
  type PredictBoardState,
} from '../deepbookPredict';
import {
  buildSessionPredictBetTx,
  executeWithLocalSessionKey,
  fetchSessionStatus,
  type SessionStatusSnapshot,
} from '../deepbookSessions';
import { fetchDeepBookMarginVaults, type DeepBookMarginVault } from '../earnPools';
import type { MarginManagerPosition, MarginPoolRiskConfig } from '../deepbookMargin';
import { extractTxDigest, invalidateRpcCache } from '../suiClient';
import { simulateTxBeforeWallet } from '../suiSimulate';
import { calcFeeUnits, getWalletVolumeUsd, resolveReferralTier, resolveTraderTier } from '../voltFee';
import { POPULAR_TOKENS, VOLT_TREASURY_ADDRESS } from '../constants';

export type AiCopilotTab = 'predict' | 'grid' | 'yield';

interface AiCopilotModalProps {
  isOpen: boolean;
  initialTab?: AiCopilotTab;
  onClose: () => void;
  defaultPool?: DeepBookPoolMeta;
  defaultCandles?: DeepBookCandle[];
  marginPosition?: MarginManagerPosition | null;
  marginRiskConfig?: MarginPoolRiskConfig | null;
  onNotify: (
    type: 'success' | 'error' | 'info' | 'warning',
    title: string,
    message: string,
    actionLabel?: string,
    actionUrl?: string
  ) => void;
  onDeployed?: () => void | Promise<void>;
}

async function fetchQuickBtcCandles(): Promise<DeepBookCandle[]> {
  try {
    const res = await fetch(
      'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=64'
    );
    if (!res.ok) return [];
    const rows: any[] = await res.json();
    return rows.map((r) => ({
      time: Math.floor(Number(r[0]) / 1000),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }));
  } catch {
    return [];
  }
}

export const AiCopilotModal: React.FC<AiCopilotModalProps> = ({
  isOpen,
  initialTab = 'predict',
  onClose,
  defaultPool,
  defaultCandles,
  marginPosition = null,
  marginRiskConfig = null,
  onNotify,
  onDeployed,
}) => {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();

  const [tab, setTab] = useState<AiCopilotTab>(initialTab);
  const [isLoading, setIsLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Predict AI state
  const [predictBudget, setPredictBudget] = useState<number>(3);
  const [predictBoard, setPredictBoard] = useState<PredictBoardState | null>(null);
  const [btcCandles, setBtcCandles] = useState<DeepBookCandle[]>([]);
  const [predictSetups, setPredictSetups] = useState<PredictCopilotSetup[]>([]);
  const [sessionStatus, setSessionStatus] = useState<SessionStatusSnapshot | null>(null);

  // Grid Bot state
  const [pools, setPools] = useState<DeepBookPoolMeta[]>(DEFAULT_DEEPBOOK_POOLS);
  const [gridPool, setGridPool] = useState<DeepBookPoolMeta>(
    defaultPool ?? DEFAULT_DEEPBOOK_POOLS[0]
  );
  const [gridStyle, setGridStyle] = useState<SpotGridStyle>('dca_buy');
  const [gridBudgetUsd, setGridBudgetUsd] = useState<string>('12');
  const [gridMidPrice, setGridMidPrice] = useState<number>(0);
  const [gridCandles, setGridCandles] = useState<DeepBookCandle[]>(defaultCandles ?? []);
  const [managerState, setManagerState] = useState<DeepBookManagerState | null>(null);
  const [spotReferralId, setSpotReferralId] = useState<string | null>(null);

  // Yield & Margin state
  const [marginVaults, setMarginVaults] = useState<DeepBookMarginVault[]>([]);

  useEffect(() => {
    if (isOpen) {
      setTab(initialTab);
      if (defaultPool) setGridPool(defaultPool);
      if (defaultCandles?.length) setGridCandles(defaultCandles);
    }
  }, [isOpen, initialTab, defaultPool, defaultCandles]);

  const loadCopilotData = useCallback(async () => {
    setIsLoading(true);
    try {
      const owner = account?.address || VOLT_TREASURY_ADDRESS;
      const [boardRes, btcC, poolsList, vaults, sessRes] = await Promise.all([
        fetchPredictBoard(account?.address),
        fetchQuickBtcCandles(),
        fetchDeepBookPools().catch(() => DEFAULT_DEEPBOOK_POOLS),
        fetchDeepBookMarginVaults().catch(() => [] as DeepBookMarginVault[]),
        account?.address
          ? fetchSessionStatus(account.address).catch(() => null)
          : Promise.resolve(null),
      ]);

      setPredictBoard(boardRes);
      setBtcCandles(btcC);
      if (poolsList.length > 0) setPools(poolsList);
      setMarginVaults(vaults);
      setSessionStatus(sessRes);

      const { setups } = await generatePredictCopilotSetups({
        owner,
        board: boardRes,
        btcCandles: btcC,
        budgetUsdc: predictBudget,
      });
      setPredictSetups(setups);
    } catch {
      // ignore transient telemetry errors
    } finally {
      setIsLoading(false);
    }
  }, [account?.address, predictBudget]);

  useEffect(() => {
    if (isOpen) {
      loadCopilotData();
    }
  }, [isOpen, loadCopilotData]);

  // Load Spot Grid book + candles when pool changes
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      const [book, cdl, refs] = await Promise.all([
        fetchDeepBookOrderbook(gridPool.poolName).catch(() => ({
          bids: [],
          asks: [],
          midPrice: 0,
          spreadPct: 0,
        })),
        fetchDeepBookCandles(gridPool.poolName, '15m').catch(() => [] as DeepBookCandle[]),
        fetchVoltSpotReferrals().catch(() => ({} as Record<string, { referralId?: string | null }>)),
      ]);
      if (cancelled) return;
      setGridMidPrice(book.midPrice || cdl[cdl.length - 1]?.close || 0);
      if (cdl.length > 0) setGridCandles(cdl);
      setSpotReferralId(refs?.[gridPool.poolName]?.referralId ?? null);

      if (account?.address) {
        const ids = await discoverBalanceManagers(account.address).catch(() => [] as string[]);
        if (!cancelled && ids.length > 0) {
          const states = await fetchAllDeepBookManagerStates(
            account.address,
            ids,
            gridPool
          ).catch(() => [] as DeepBookManagerState[]);
          if (!cancelled) setManagerState(states[0] ?? null);
        } else if (!cancelled) {
          setManagerState(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, gridPool, account?.address]);

  const btcSignals = useMemo(
    () => computeMarketQuant(btcCandles, predictBoard?.spotForward || 0),
    [btcCandles, predictBoard?.spotForward]
  );

  const gridSignals = useMemo(
    () => computeMarketQuant(gridCandles, gridMidPrice),
    [gridCandles, gridMidPrice]
  );

  const gridPreview = useMemo(
    () =>
      buildSpotGridPlan({
        pool: gridPool,
        midPrice: gridMidPrice,
        candles: gridCandles,
        budgetQuoteUsd: Number(gridBudgetUsd) || 10,
        style: gridStyle,
      }),
    [gridPool, gridMidPrice, gridCandles, gridBudgetUsd, gridStyle]
  );

  const yieldReport = useMemo(
    () =>
      buildYieldAndMarginReport({
        vaults: marginVaults,
        marginPosition,
        riskConfig: marginRiskConfig,
        midPrice: gridMidPrice,
        candles: gridCandles,
      }),
    [marginVaults, marginPosition, marginRiskConfig, gridMidPrice, gridCandles]
  );

  const handleDeployPredictSetup = async (setup: PredictCopilotSetup) => {
    if (!account?.address || !predictBoard) {
      onNotify('warning', 'Wallet Required', 'Connect your Sui wallet to deploy this setup.');
      return;
    }
    setBusyId(setup.id);
    try {
      const availUsdc = predictBoard.account?.availableUsdc ?? 0;
      const canUseSession = Boolean(
        sessionStatus?.isActiveNow &&
          sessionStatus.localKey &&
          sessionStatus.sessionGasSui >= 0.005 &&
          availUsdc >= setup.costUsd
      );

      let digest = '';
      if (canUseSession && sessionStatus?.localKey) {
        const tx = buildSessionPredictBetTx({
          owner: account.address,
          sessionAddress: sessionStatus.localKey.sessionAddress,
          market: setup.market.market,
          side: setup.side,
          strike: setup.strike,
          lowerStrike: setup.lowerStrike,
          upperStrike: setup.upperStrike,
          maxCostRaw: setup.plan.raw.maxCost ?? setup.plan.raw.budget,
          minQuantityRaw: setup.plan.raw.minQuantity,
        });
        const sim = await simulateTxBeforeWallet(tx, {
          sender: sessionStatus.localKey.sessionAddress,
        });
        if (!sim.ok) {
          throw new Error(sim.errorMessage || 'Session preflight failed.');
        }
        const exec = await executeWithLocalSessionKey(tx, account.address);
        digest = exec.digest;
      } else {
        const availableRaw = BigInt(Math.floor(availUsdc * 1_000_000));
        const totalDebitRaw = BigInt(Math.ceil(setup.costUsd * 1_000_000));
        const tx = buildPredictPlaceBetTx({
          sender: account.address,
          market: setup.market.market,
          side: setup.side,
          strike: setup.strike,
          lowerStrike: setup.lowerStrike,
          upperStrike: setup.upperStrike,
          maxCostRaw: setup.plan.raw.maxCost ?? setup.plan.raw.budget,
          minQuantityRaw: setup.plan.raw.minQuantity,
          totalDebitRaw,
          hasAccount: Boolean(predictBoard.account?.hasAccount),
          availableRaw,
          protocol: predictBoard.protocol,
        });
        const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
        if (!sim.ok) {
          throw new Error(sim.errorMessage || 'Preflight simulation failed.');
        }
        const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
        digest = extractTxDigest(res);
      }

      invalidateRpcCache('listBalances:');
      onNotify(
        'success',
        `Copilot Deployed ${setup.tag}`,
        `${setup.title} · Est. Payout $${setup.potentialPayoutUsd.toFixed(2)} (${setup.payoutMultiple.toFixed(2)}x)${canUseSession ? ' via 1-Click Session' : ''}`,
        digest ? 'Suiscan' : undefined,
        digest ? `https://suiscan.xyz/mainnet/tx/${digest}` : undefined
      );
      await onDeployed?.();
      onClose();
    } catch (err: any) {
      onNotify('error', 'Copilot Deploy Failed', err?.message || 'Transaction cancelled.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDeploySpotGrid = async () => {
    if (!account?.address || gridPreview.rungs.length === 0) return;
    setBusyId('spot-grid');
    try {
      const volUsd = getWalletVolumeUsd(account.address);
      const tier = resolveTraderTier(volUsd);
      const refTier = resolveReferralTier(volUsd);
      const estUsd = Math.max(1, Number(gridBudgetUsd) || 10);
      const suiPriceUsd = POPULAR_TOKENS.find((t) => t.symbol === 'SUI')?.priceUsd ?? 0.86;
      const feeMist = calcFeeUnits(
        BigInt(Math.round((estUsd / Math.max(0.1, suiPriceUsd)) * 1e9)),
        tier.feeRate
      );

      const tx = buildPlaceDeepBookGridTx({
        owner: account.address,
        pool: gridPreview.pool,
        managerId: managerState?.managerId ?? null,
        managerBaseBalance: managerState?.baseBalance ?? 0,
        managerQuoteBalance: managerState?.quoteBalance ?? 0,
        orders: gridPreview.rungs,
        postOnly: false,
        payWithDeep: false,
        feeMist: feeMist > 500_000n ? feeMist : 0n,
        refSharePct: refTier.revSharePct,
        spotReferralId,
        existingManagerReferralId: managerState?.referralId ?? null,
      });

      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) {
        throw new Error(sim.errorMessage || 'Spot grid preflight simulation failed.');
      }

      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      invalidateRpcCache('listBalances:');
      onNotify(
        'success',
        'DeepBook CLOB Grid Live',
        `Deployed ${gridPreview.rungs.length} tick-aligned limit orders on ${gridPool.poolName.replace('_', '/')} in 1 PTB.`,
        digest ? 'Suiscan' : undefined,
        digest ? `https://suiscan.xyz/mainnet/tx/${digest}` : undefined
      );
      await onDeployed?.();
      onClose();
    } catch (err: any) {
      onNotify('error', 'Grid Deploy Failed', err?.message || 'Transaction rejected.');
    } finally {
      setBusyId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-3xl max-h-[90vh] flex flex-col panel-carbon rounded-xl border border-[#2E384C] shadow-2xl overflow-hidden animate-panel-in">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#2D374B] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#2B7FFF]/15 border border-[#2B7FFF]/40 flex items-center justify-center text-[#60A5FA]">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Volt AI Strategy Copilot</h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#08D189]/15 text-[#08D189] border border-[#08D189]/30">
                  Live Mainnet Quant
                </span>
              </div>
              <p className="text-xs text-[#6B7280]">
                Real-time ATR / RSI / DeepBook pricing · Every strategy pre-simulated before wallet sign
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadCopilotData}
              disabled={isLoading}
              className="p-2 rounded-xl panel-carbon-sub text-slate-300 hover:border-white/25"
              title="Refresh market signals"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl panel-carbon-sub text-slate-300 hover:border-white/25"
              aria-label="Close AI Copilot"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Subtabs */}
        <div className="px-5 pt-3 flex items-center gap-2 border-b border-[#2D374B] pb-3">
          {[
            { id: 'predict' as AiCopilotTab, label: 'Predict Alpha', icon: TrendingUp },
            { id: 'grid' as AiCopilotTab, label: 'Spot CLOB Grid', icon: Grid3X3 },
            { id: 'yield' as AiCopilotTab, label: 'Yield & Margin Guard', icon: Activity },
          ].map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`px-3.5 py-2 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 border transition-colors ${
                  active
                    ? 'bg-[#2B7FFF]/15 border-[#2B7FFF]/45 text-[#60A5FA]'
                    : 'bg-[#000000] border-[#2D374B] text-[#9CA3AF] hover:text-white'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === 'predict' && (
            <>
              <div className="panel-carbon-sub rounded-lg p-3.5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-2">
                    <span>BTC Market Regime:</span>
                    <span className="text-[#60A5FA]">{btcSignals.regime}</span>
                  </div>
                  <div className="text-[11px] font-mono text-[#6B7280] mt-0.5">
                    {btcSignals.confidenceLabel} · Support ${Math.round(btcSignals.support).toLocaleString()} / Res $
                    {Math.round(btcSignals.resistance).toLocaleString()}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 text-xs font-mono">
                  <span className="text-[#6B7280] mr-1">Bet Size:</span>
                  {[2, 5, 10].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setPredictBudget(amt)}
                      className={`px-2.5 py-1 rounded border font-semibold transition-colors ${
                        predictBudget === amt
                          ? 'bg-[#2B7FFF]/20 border-[#2B7FFF]/45 text-[#60A5FA]'
                          : 'bg-[#000000] border-[#2D374B] text-[#9CA3AF] hover:text-white'
                      }`}
                    >
                      ${amt}
                    </button>
                  ))}
                </div>
              </div>

              {isLoading && predictSetups.length === 0 ? (
                <div className="flex items-center justify-center py-12 gap-2 text-sm text-slate-300">
                  <Loader2 className="w-5 h-5 animate-spin text-[#2B7FFF]" />
                  <span>Scanning live Block-Scholes &amp; Pyth strike odds...</span>
                </div>
              ) : predictSetups.length === 0 ? (
                <div className="panel-carbon-sub rounded-lg p-6 text-center text-xs text-[#6B7280]">
                  No open BTC Predict expiries currently accepting orders within the 15%–50% band. Try refreshing shortly.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {predictSetups.map((setup) => {
                    const sessionReady = Boolean(
                      sessionStatus?.isActiveNow &&
                        sessionStatus.sessionGasSui >= 0.005 &&
                        (predictBoard?.account?.availableUsdc ?? 0) >= setup.costUsd
                    );
                    return (
                      <div
                        key={setup.id}
                        className="panel-carbon-sub rounded-lg p-4 flex flex-col justify-between gap-3 border border-[#2D374B]"
                      >
                        <div className="space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-[#2B7FFF]/15 text-[#60A5FA]">
                              {setup.tag}
                            </span>
                            <span className="text-xs font-mono text-[#08D189] font-bold">
                              {setup.payoutMultiple.toFixed(2)}x
                            </span>
                          </div>
                          <div className="text-sm font-bold text-white">{setup.title}</div>
                          <p className="text-[11px] text-[#9CA3AF] leading-relaxed">
                            {setup.rationale}
                          </p>
                        </div>

                        <div className="space-y-2 pt-2 border-t border-[#2D374B] text-[11px] font-mono">
                          <div className="flex justify-between text-slate-300">
                            <span>Implied Prob</span>
                            <span>{setup.winProbPct.toFixed(1)}%</span>
                          </div>
                          <div className="flex justify-between text-slate-300">
                            <span>Est. Payout</span>
                            <span className="text-[#08D189] font-bold">
                              ${setup.potentialPayoutUsd.toFixed(2)} USDC
                            </span>
                          </div>

                          <button
                            type="button"
                            disabled={busyId !== null}
                            onClick={() => handleDeployPredictSetup(setup)}
                            className="w-full mt-1 py-2 px-3 rounded-lg text-xs font-bold btn-deepbook disabled:opacity-45 inline-flex items-center justify-center gap-1.5"
                          >
                            {busyId === setup.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Zap className="w-3.5 h-3.5" />
                            )}
                            <span>
                              {sessionReady ? '1-Click Deploy ($' : 'Deploy Setup ($'}
                              {setup.costUsd.toFixed(2)})
                            </span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {tab === 'grid' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="panel-carbon-sub rounded-lg p-3 space-y-1">
                  <label className="text-[11px] text-[#6B7280]">DeepBook Pool</label>
                  <select
                    value={gridPool.poolName}
                    onChange={(e) => {
                      const next = pools.find((p) => p.poolName === e.target.value);
                      if (next) setGridPool(next);
                    }}
                    className="w-full bg-transparent text-xs font-mono font-bold text-white outline-none"
                  >
                    {pools.map((p) => (
                      <option key={p.poolName} value={p.poolName} className="bg-[#06070A]">
                        {p.poolName.replace('_', '/')}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="panel-carbon-sub rounded-lg p-3 space-y-1">
                  <label className="text-[11px] text-[#6B7280]">Strategy Mode</label>
                  <select
                    value={gridStyle}
                    onChange={(e) => setGridStyle(e.target.value as SpotGridStyle)}
                    className="w-full bg-transparent text-xs font-bold text-[#60A5FA] outline-none"
                  >
                    <option value="dca_buy" className="bg-[#06070A]">Dip Accumulation (Bids)</option>
                    <option value="take_profit" className="bg-[#06070A]">Take-Profit Ladder (Asks)</option>
                    <option value="two_sided" className="bg-[#06070A]">Two-Sided Maker Grid</option>
                  </select>
                </div>

                <div className="panel-carbon-sub rounded-lg p-3 space-y-1">
                  <label className="text-[11px] text-[#6B7280]">
                    Total Capital ({gridPool.quoteSymbol})
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={gridBudgetUsd}
                    onChange={(e) => setGridBudgetUsd(e.target.value)}
                    className="w-full bg-transparent text-xs font-mono font-bold text-white outline-none"
                  />
                </div>
              </div>

              <div className="panel-carbon-sub rounded-lg p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-white">{gridPreview.title}</div>
                    <div className="text-[11px] text-[#6B7280] mt-0.5">
                      {gridSignals.confidenceLabel} · {gridPreview.rationale}
                    </div>
                  </div>
                  <div className="text-right font-mono text-xs">
                    <div className="text-[#6B7280]">Live Mid</div>
                    <div className="text-white font-bold">${gridMidPrice.toFixed(4)}</div>
                  </div>
                </div>

                {gridPreview.rungs.length > 0 ? (
                  <div className="divide-y divide-[#2D374B] rounded-lg bg-[#000000] border border-[#2D374B] overflow-hidden text-xs font-mono">
                    {gridPreview.rungs.map((r, idx) => (
                      <div key={idx} className="px-3.5 py-2 flex items-center justify-between">
                        <span
                          className={`font-bold ${
                            r.isBid ? 'text-[#08D189]' : 'text-[#F0525E]'
                          }`}
                        >
                          {r.isBid ? 'LIMIT BID' : 'LIMIT ASK'} #{idx + 1}
                        </span>
                        <span className="text-white">@ {r.price.toFixed(4)} {gridPool.quoteSymbol}</span>
                        <span className="text-slate-300">
                          {r.quantity.toFixed(gridPool.lotSize < 1 ? 2 : 0)} {gridPool.baseSymbol}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-400/30 rounded-lg px-3 py-2">
                    {gridPreview.error}
                  </div>
                )}

                <button
                  type="button"
                  disabled={busyId !== null || gridPreview.rungs.length === 0 || !account?.address}
                  onClick={handleDeploySpotGrid}
                  className="w-full py-3 rounded-lg text-sm font-bold bg-[#08D189] hover:bg-[#0DE295] text-[#05120D] disabled:opacity-45 inline-flex items-center justify-center gap-2 transition-colors"
                >
                  {busyId === 'spot-grid' && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>
                    {!account?.address
                      ? 'Connect Wallet to Deploy Grid'
                      : `Deploy ${gridPreview.rungs.length}-Order DeepBook Grid in 1 PTB`}
                  </span>
                </button>
              </div>
            </div>
          )}

          {tab === 'yield' && (
            <div className="space-y-4">
              {yieldReport.marginWarning && (
                <div className="rounded-lg bg-amber-500/15 border border-amber-400/35 px-4 py-3 flex items-start gap-2.5 text-xs text-amber-200">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                  <div>
                    <div className="font-bold">Isolated Margin Health Alert</div>
                    <div>{yieldReport.marginWarning}</div>
                    {yieldReport.suggestedTp && yieldReport.suggestedSl && (
                      <div className="font-mono text-[11px] mt-1 text-white">
                        Suggested ATR Bracket -&gt; TP: ${yieldReport.suggestedTp} · SL: ${yieldReport.suggestedSl}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="panel-carbon-sub rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold text-white">
                    Top DeepBook v3 MarginPool Supply APRs (0% Deposit Fee)
                  </div>
                  <span className="text-[11px] font-mono text-[#08D189]">Live On-Chain</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {yieldReport.topVaults.map((v) => (
                    <div
                      key={v.coinKey}
                      className="rounded-lg bg-[#000000] border border-[#2D374B] p-3 text-xs font-mono space-y-1"
                    >
                      <div className="text-white font-bold">{v.coinKey} Pool</div>
                      <div className="text-lg font-bold text-[#08D189]">{v.apr.toFixed(2)}% APR</div>
                      <div className="text-[10px] text-[#6B7280]">
                        Util: {v.utilizationPct.toFixed(1)}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
