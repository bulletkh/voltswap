import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Target,
  Clock,
  RefreshCw,
  Loader2,
  ArrowDownToLine,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Zap,
  Bot,
} from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { rawToUsdc, usdcToRaw, snapStrike, MAINNET_CONFIG, type MintPlan } from '@mysten/deepbook-v3/predict';
import {
  fetchPredictBoard,
  fetchPredictStrikeLadder,
  pickDefaultValidStrike,
  quotePredictTrade,
  buildPredictPlaceBetTx,
  buildPredictEarlySellTx,
  buildPredictWithdrawTx,
  buildPredictClaimRecordTx,
  PREDICT_ORDER_USD_MIN,
  PREDICT_BUILDER_FEE_PCT,
  type PredictBoardState,
  type PredictMarketBoardItem,
  type PredictStrikeQuote,
  type PredictUserOrderRecord,
} from '../deepbookPredict';
import { type DeepBookCandle } from '../deepbookV3';
import { extractTxDigest, fetchWalletBalances, readBalanceFromMap } from '../suiClient';
import { simulateTxBeforeWallet } from '../suiSimulate';
import { VOLT_TREASURY_ADDRESS } from '../constants';
import { addWalletVolumeUsd, getValidReferrerForSender, resolveTraderTier } from '../voltFee';
import {
  buildSessionPredictBetTx,
  executeWithLocalSessionKey,
  fetchSessionStatus,
  type SessionStatusSnapshot,
} from '../deepbookSessions';
import { PredictSessionPanel } from './PredictSessionPanel';
import { AiCopilotModal } from './AiCopilotModal';
import { ProCandleChart, type ChartTimeframe } from './ProCandleChart';
import type { PnlTradeData } from '../PnlShareModal';

interface PredictWorkspaceProps {
  onNotify: (
    type: 'success' | 'error' | 'info' | 'warning',
    title: string,
    message: string,
    actionLabel?: string,
    actionUrl?: string
  ) => void;
  onTradeRecorded: (trade: PnlTradeData) => void;
  onVolumeUpdated?: (newVolUsd: number) => void;
}

async function fetchBtcPredictCandles(tf: ChartTimeframe): Promise<DeepBookCandle[]> {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${tf}&limit=160`
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

function formatCountdown(msLeft: number): string {
  if (msLeft <= 0) return '00:00';
  const totalSec = Math.floor(msLeft / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatWindowLabel(market: PredictMarketBoardItem, nowMs: number): string {
  const diffMin = Math.max(1, Math.round((Number(market.market.expiryMs) - nowMs) / 60_000));
  if (diffMin >= 60) {
    const hrs = Math.round(diffMin / 60);
    return `${hrs}h`;
  }
  return `${diffMin}m`;
}

export const PredictWorkspace: React.FC<PredictWorkspaceProps> = ({
  onNotify,
  onTradeRecorded,
  onVolumeUpdated,
}) => {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();

  const [board, setBoard] = useState<PredictBoardState | null>(null);
  const [isLoadingBoard, setIsLoadingBoard] = useState(true);
  const [selectedMarketId, setSelectedMarketId] = useState<string>('');
  const [ladder, setLadder] = useState<PredictStrikeQuote[]>([]);
  const [isLoadingLadder, setIsLoadingLadder] = useState(false);

  const [side, setSide] = useState<'up' | 'down' | 'range'>('up');
  const [strikeInput, setStrikeInput] = useState<string>('');
  const [lowerStrikeInput, setLowerStrikeInput] = useState<string>('');
  const [upperStrikeInput, setUpperStrikeInput] = useState<string>('');
  const [amountInput, setAmountInput] = useState<string>('2');
  const [slippageCents, setSlippageCents] = useState<number | 'auto'>('auto');

  const [quotePlan, setQuotePlan] = useState<MintPlan | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [busyRecordKey, setBusyRecordKey] = useState<string | null>(null);

  const [walletUsdc, setWalletUsdc] = useState<number>(0);
  const [btcCandles, setBtcCandles] = useState<DeepBookCandle[]>([]);
  const [candlesLoading, setCandlesLoading] = useState<boolean>(true);
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('1m');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [bottomTab, setBottomTab] = useState<'orders' | 'positions'>('orders');
  const [sessionStatus, setSessionStatus] = useState<SessionStatusSnapshot | null>(null);
  const [isAiCopilotOpen, setIsAiCopilotOpen] = useState(false);

  const strikeInitializedRef = useRef<string>('');

  const loadBoard = useCallback(async () => {
    try {
      const [nextBoard, balMap, nextSession] = await Promise.all([
        fetchPredictBoard(account?.address),
        account?.address ? fetchWalletBalances(account.address) : Promise.resolve({}),
        account?.address
          ? fetchSessionStatus(account.address).catch(() => null)
          : Promise.resolve(null),
      ]);
      setBoard(nextBoard);
      setSessionStatus(nextSession);
      if (account?.address) {
        setWalletUsdc(readBalanceFromMap(balMap, MAINNET_CONFIG.quoteCoinType, 6));
      } else {
        setWalletUsdc(0);
      }

      if (nextBoard.markets.length > 0) {
        setSelectedMarketId((prev) => {
          if (prev && nextBoard.markets.some((m) => m.market.id === prev)) {
            return prev;
          }
          // Prefer ~2-5m active window when available, otherwise first open window
          const ideal =
            nextBoard.markets.find(
              (m) => m.acceptingMints && Number(m.market.expiryMs) - Date.now() >= 60_000
            ) || nextBoard.markets[0];
          return ideal.market.id;
        });
      }
    } catch {
      // Keep stale board cleanly on transient RPC lag
    } finally {
      setIsLoadingBoard(false);
    }
  }, [account?.address]);

  useEffect(() => {
    loadBoard();
    const poll = setInterval(loadBoard, 8_000);
    return () => clearInterval(poll);
  }, [loadBoard]);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setCandlesLoading(true);
    const loadCandles = async () => {
      const data = await fetchBtcPredictCandles(timeframe);
      if (!cancelled) {
        if (data.length > 0) setBtcCandles(data);
        setCandlesLoading(false);
      }
    };
    loadCandles();
    const timer = setInterval(loadCandles, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [timeframe]);

  const selectedMarket = useMemo<PredictMarketBoardItem | null>(() => {
    if (!board || board.markets.length === 0) return null;
    return board.markets.find((m) => m.market.id === selectedMarketId) || board.markets[0];
  }, [board, selectedMarketId]);

  useEffect(() => {
    if (!selectedMarket) {
      setLadder([]);
      return;
    }
    let cancelled = false;
    setIsLoadingLadder(true);
    fetchPredictStrikeLadder(selectedMarket.market, selectedMarket.forwardPrice)
      .then((rows) => {
        if (cancelled) return;
        setLadder(rows);
        const key = `${selectedMarket.market.id}:${side}`;
        if (strikeInitializedRef.current !== key && selectedMarket.forwardPrice > 0) {
          strikeInitializedRef.current = key;
          const step = Math.max(1, selectedMarket.market.admissionTickSize || 1);
          if (side === 'range') {
            setLowerStrikeInput(
              String(snapStrike(selectedMarket.forwardPrice * 0.997, step, 'down'))
            );
            setUpperStrikeInput(
              String(snapStrike(selectedMarket.forwardPrice * 1.003, step, 'up'))
            );
          } else {
            const best = pickDefaultValidStrike(
              rows,
              side,
              selectedMarket.market,
              selectedMarket.forwardPrice
            );
            setStrikeInput(String(best));
          }
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingLadder(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedMarket, side]);

  const parsedAmount = Number(amountInput) || 0;
  const parsedStrike = Number(strikeInput) || 0;
  const parsedLower = Number(lowerStrikeInput) || 0;
  const parsedUpper = Number(upperStrikeInput) || 0;

  useEffect(() => {
    if (!selectedMarket) {
      setQuotePlan(null);
      setQuoteError(null);
      return;
    }
    const timer = setTimeout(async () => {
      setIsQuoting(true);
      const res = await quotePredictTrade({
        owner: account?.address || VOLT_TREASURY_ADDRESS,
        market: selectedMarket.market,
        side,
        strike: parsedStrike,
        lowerStrike: parsedLower,
        upperStrike: parsedUpper,
        amountUsdc: parsedAmount,
        slippageCents,
      });
      setQuotePlan(res.plan);
      setQuoteError(res.error);
      setIsQuoting(false);
    }, 220);
    return () => clearTimeout(timer);
  }, [
    selectedMarket,
    account?.address,
    side,
    parsedStrike,
    parsedLower,
    parsedUpper,
    parsedAmount,
    slippageCents,
  ]);

  const handleBestOtmStrike = () => {
    if (!selectedMarket || side === 'range') return;
    const best = pickDefaultValidStrike(
      ladder,
      side,
      selectedMarket.market,
      selectedMarket.forwardPrice
    );
    setStrikeInput(String(best));
  };

  const handleStepStrike = (dir: -1 | 1) => {
    if (!selectedMarket) return;
    const step = Math.max(1, selectedMarket.market.admissionTickSize || 1);
    const cur = parsedStrike > 0 ? parsedStrike : selectedMarket.forwardPrice;
    const next = snapStrike(cur + dir * step, step, 'nearest');
    setStrikeInput(String(Math.max(step, next)));
  };

  const handlePlaceBet = async () => {
    if (!account?.address) {
      onNotify('warning', 'Wallet Not Connected', 'Connect your Sui wallet to place Predict trades.');
      return;
    }
    if (!selectedMarket || !board) return;
    if (!quotePlan || (!quotePlan.accepting && quotePlan.refusal !== 'fee')) {
      onNotify(
        'error',
        'Invalid Predict Order',
        quoteError || quotePlan?.refusal || 'Order parameters outside DeepBook Predict entry limits.'
      );
      return;
    }

    const availableRaw = usdcToRaw(board.account?.availableUsdc ?? 0);
    const totalDebitRaw = quotePlan.raw.totalDebit;
    const shortfallUsdc =
      availableRaw >= totalDebitRaw ? 0 : rawToUsdc(totalDebitRaw - availableRaw);

    if (shortfallUsdc > walletUsdc + 0.0001) {
      onNotify(
        'error',
        'Insufficient USDC',
        `Need ${shortfallUsdc.toFixed(2)} more USDC in your wallet (wallet holds ${walletUsdc.toFixed(2)} USDC).`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const canUseSession = Boolean(
        sessionStatus?.isActiveNow &&
          sessionStatus.localKey &&
          sessionStatus.sessionGasSui >= 0.005 &&
          availableRaw >= totalDebitRaw
      );

      let digest = '';
      if (canUseSession && sessionStatus?.localKey) {
        const tx = buildSessionPredictBetTx({
          owner: account.address,
          sessionAddress: sessionStatus.localKey.sessionAddress,
          market: selectedMarket.market,
          side,
          strike: parsedStrike,
          lowerStrike: parsedLower,
          upperStrike: parsedUpper,
          maxCostRaw: quotePlan.raw.maxCost ?? quotePlan.raw.budget,
          minQuantityRaw: quotePlan.raw.minQuantity,
        });
        const sim = await simulateTxBeforeWallet(tx, {
          sender: sessionStatus.localKey.sessionAddress,
        });
        if (!sim.ok) {
          onNotify(
            'error',
            'Session Preflight Failed',
            sim.errorMessage || 'Session transaction would abort on-chain.'
          );
          return;
        }
        const exec = await executeWithLocalSessionKey(tx, account.address);
        digest = exec.digest;
      } else {
        const tx = buildPredictPlaceBetTx({
          sender: account.address,
          market: selectedMarket.market,
          side,
          strike: parsedStrike,
          lowerStrike: parsedLower,
          upperStrike: parsedUpper,
          maxCostRaw: quotePlan.raw.maxCost ?? quotePlan.raw.budget,
          minQuantityRaw: quotePlan.raw.minQuantity,
          totalDebitRaw,
          hasAccount: Boolean(board.account?.hasAccount),
          availableRaw,
          protocol: board.protocol,
        });

        const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
        if (!sim.ok) {
          onNotify(
            'error',
            'Predict Preflight Failed',
            sim.errorMessage || 'Transaction would abort on-chain.'
          );
          return;
        }

        const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
        digest = extractTxDigest(res);
      }

      const sideText =
        side === 'up'
          ? `BTC > $${parsedStrike.toLocaleString()}`
          : side === 'down'
            ? `BTC <= $${parsedStrike.toLocaleString()}`
            : `BTC $${parsedLower.toLocaleString()}-$${parsedUpper.toLocaleString()}`;

      onNotify(
        'success',
        canUseSession ? `1-Click ${side.toUpperCase()} Enqueued` : `Predict ${side.toUpperCase()} Enqueued`,
        `${sideText} · Est. Payout $${quotePlan.potentialPayout.toFixed(2)} (${quotePlan.payoutMultiple.toFixed(2)}x)${canUseSession ? ' · 0-popup session' : ''}`,
        'Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );

      if (digest) {
        const nextVol = addWalletVolumeUsd(account.address, quotePlan.totalDebit);
        onVolumeUpdated?.(nextVol);
        const tier = resolveTraderTier(nextVol);
        const ref = getValidReferrerForSender(account.address);
        fetch('/api/record-swap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            digest,
            address: account.address,
            fromToken: 'USDC',
            toToken: `BTC-${side.toUpperCase()}`,
            fromAmount: quotePlan.totalDebit.toFixed(2),
            toAmount: quotePlan.potentialPayout.toFixed(2),
            volumeUsd: quotePlan.totalDebit,
            feeRate: board.protocol.builderFeeCutoverActive ? PREDICT_BUILDER_FEE_PCT / 100 : 0,
            tierName: tier.name,
            swapMode: 'DEEPBOOK_PREDICT',
            referrer: ref,
          }),
        }).catch(() => {});

        onTradeRecorded({
          fromToken: 'USDC',
          toToken: `BTC Predict (${side.toUpperCase()})`,
          fromAmount: quotePlan.totalDebit.toFixed(2),
          toAmount: `$${quotePlan.potentialPayout.toFixed(2)} max payout`,
          volumeUsd: quotePlan.totalDebit,
          digest,
          orderType: 'PERPS',
        });
      }

      await loadBoard();
    } catch (err: any) {
      onNotify('error', 'Predict Trade Failed', err?.message || 'Transaction rejected by wallet.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWithdrawAvailable = async () => {
    if (!account?.address || !board?.account || board.account.availableUsdc <= 0.001) return;
    setIsWithdrawing(true);
    try {
      const tx = buildPredictWithdrawTx(account.address, board.account.availableUsdc);
      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) {
        onNotify('error', 'Withdraw Simulation Failed', sim.errorMessage || 'Cannot withdraw right now.');
        return;
      }
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      onNotify(
        'success',
        'Predict USDC Withdrawn',
        `${board.account.availableUsdc.toFixed(2)} USDC returned to your Sui wallet.`,
        'Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
      await loadBoard();
    } catch (err: any) {
      onNotify('error', 'Withdraw Failed', err?.message || 'Wallet rejected withdrawal.');
    } finally {
      setIsWithdrawing(false);
    }
  };

  const handleRecordAction = async (
    rec: PredictUserOrderRecord,
    action: 'sell' | 'parked' | 'refund'
  ) => {
    if (!account?.address || !board) return;
    const recKey = `${rec.marketId}:${rec.recordId.toString()}:${action}`;
    setBusyRecordKey(recKey);
    try {
      let tx;
      let label = '';
      if (action === 'sell' && (rec.view.state === 'filled' || rec.view.state === 'refunded') && rec.view.position) {
        const qty = rawToUsdc(rec.view.position.quantityRaw);
        const built = await buildPredictEarlySellTx({
          sender: account.address,
          marketId: rec.marketId,
          expiryMs: rec.expiryMs,
          recordId: rec.recordId,
          quantity: qty,
          protocol: board.protocol,
        });
        tx = built.tx;
        label = `Early Sell Submitted (~$${built.sellPlan.net.toFixed(2)} USDC)`;
      } else {
        tx = await buildPredictClaimRecordTx(
          account.address,
          rec.marketId,
          rec.expiryMs,
          rec.recordId,
          action === 'parked' ? 'parked' : 'refund'
        );
        label = action === 'parked' ? 'Parked USDC Claimed' : 'Order Refund Requested';
      }

      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) {
        onNotify('error', 'Predict Action Failed', sim.errorMessage || 'Preflight simulation failed.');
        return;
      }
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      onNotify(
        'success',
        'DeepBook Predict Updated',
        label,
        'Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
      await loadBoard();
    } catch (err: any) {
      onNotify('error', 'Action Failed', err?.message || 'Transaction rejected.');
    } finally {
      setBusyRecordKey(null);
    }
  };

  const forward = selectedMarket?.forwardPrice || board?.spotForward || 0;
  const availableUsdc = board?.account?.availableUsdc ?? 0;
  const pendingUsdc = board?.account?.pendingUsdc ?? 0;
  const totalNeeded = quotePlan?.totalDebit ?? parsedAmount;
  const shortfallUsd = Math.max(0, totalNeeded - availableUsdc);
  // SDK refusal === 'fee' means internal Predict vault doesn't pre-hold USDC yet; our 1-tx PTB auto-deposits wallet shortfall
  const isVaultFundingOnly =
    quotePlan?.refusal === 'fee' && parsedAmount >= PREDICT_ORDER_USD_MIN;
  const canSubmitPredict = Boolean(
    selectedMarket && quotePlan && (quotePlan.accepting || isVaultFundingOnly)
  );

  return (
    <div className="w-full overflow-x-hidden bg-[#000000] border-b border-[#1A1E26] animate-panel-in">
      <div className="w-full grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_355px] xl:grid-cols-[minmax(0,1fr)_385px]">
        {/* Row 1, Col 1: Flush Market & Expiry Header Strip */}
        <div className="min-w-0 lg:col-start-1 lg:row-start-1 bg-[#000000] border-b lg:border-r border-[#1A1E26] px-3 sm:px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-md bg-[#2B7FFF]/15 border border-[#2B7FFF]/45 flex items-center justify-center shrink-0">
                <Target className="w-3.5 h-3.5 text-[#60A5FA]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white tracking-tight">BTC / USD Predict</span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-[#08D189]/12 text-[#08D189] border border-[#08D189]/30">
                    DeepBook v3
                  </span>
                </div>
                <div className="text-[11px] text-[#8E98A8]">
                  Pyth Lazer · Band 15%–50%
                </div>
              </div>
            </div>

            <div className="h-6 w-px bg-[#1A1E26] hidden sm:block" />

            <div className="flex flex-col">
              <span className="text-[10px] font-mono uppercase tracking-wider text-[#8E98A8]">BTC Forward</span>
              <span className="text-sm font-mono font-bold text-white tabular-nums">
                {forward > 0 ? `$${forward.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '--'}
              </span>
            </div>

            {/* Expiry Windows */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {(board?.markets || []).slice(0, 6).map((item) => {
                const isSelected = selectedMarket?.market.id === item.market.id;
                const remMs = Number(item.market.expiryMs) - nowMs;
                return (
                  <button
                    key={item.market.id}
                    type="button"
                    onClick={() => {
                      strikeInitializedRef.current = '';
                      setSelectedMarketId(item.market.id);
                    }}
                    className={`px-2 py-1 rounded text-xs font-mono border transition-all flex items-center gap-1.5 ${
                      isSelected
                        ? 'bg-[#2B7FFF]/18 border-[#2B7FFF] text-white font-semibold'
                        : 'bg-[#06070A] border-[#1E232D] text-[#8E98A8] hover:text-white hover:border-[#2B7FFF]/40'
                    }`}
                  >
                    <Clock className="w-3 h-3 text-[#60A5FA]" />
                    <span>{formatWindowLabel(item, nowMs)}</span>
                    <span className="text-[10px] text-[#8E98A8] tabular-nums">
                      {formatCountdown(remMs)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Account Balance & Refresh */}
          <div className="flex items-center gap-2 shrink-0">
            {account && (
              <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#06070A] border border-[#1E232D] text-xs font-mono">
                <span className="text-[#8E98A8]">Vault:</span>
                <span className="text-white font-semibold tabular-nums">
                  ${availableUsdc.toFixed(2)}
                </span>
                {pendingUsdc > 0 && (
                  <span className="text-amber-300 text-[11px]">(+${pendingUsdc.toFixed(2)})</span>
                )}
                {availableUsdc > 0.01 && (
                  <button
                    type="button"
                    disabled={isWithdrawing}
                    onClick={handleWithdrawAvailable}
                    className="ml-1 px-2 py-0.5 rounded bg-[#08D189]/15 border border-[#08D189]/35 text-[#08D189] hover:bg-[#08D189]/25 text-[11px] font-sans font-semibold inline-flex items-center gap-1"
                  >
                    {isWithdrawing ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <ArrowDownToLine className="w-3 h-3" />
                    )}
                    Withdraw
                  </button>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => setIsAiCopilotOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#06070A] border border-[#1E232D] text-slate-200 hover:border-[#2B7FFF]/60 text-xs font-semibold transition-colors"
            >
              <Bot className="w-3.5 h-3.5 text-[#60A5FA]" />
              <span>AI Copilot</span>
            </button>
            <button
              type="button"
              onClick={loadBoard}
              className="p-1.5 rounded-md bg-[#06070A] border border-[#1E232D] text-[#8E98A8] hover:text-white hover:border-[#2B7FFF]/50 transition-colors"
              title="Refresh Predict markets"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingBoard ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Col 1, Row 2: Chart + Institutional Strike Matrix + Orders/Positions */}
        <div className="min-w-0 lg:col-start-1 lg:row-start-2 lg:border-r border-[#1A1E26] divide-y divide-[#1A1E26]">
          <div className="bg-[#000000]">
            <ProCandleChart
              symbolLabel="BTC/USD"
              sourceLabel="Pyth Forward + Binance Feed"
              candles={btcCandles}
              timeframe={timeframe}
              onTimeframeChange={setTimeframe}
              isLoading={candlesLoading}
              heightClass="h-[340px] lg:h-[385px]"
              livePrice={forward}
              tvSymbol="BINANCE:BTCUSDT"
            />
          </div>

          {/* Institutional Option Strike Matrix (Table) */}
          <div className="bg-[#000000] p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-[#60A5FA]" />
                <span className="text-xs font-bold uppercase tracking-wider text-white">
                  Option Strike Matrix
                </span>
                <span className="text-[11px] text-[#8E98A8]">
                  Click UP or DOWN cell in shaded 15%–50% band to load ticket
                </span>
              </div>
              {selectedMarket && (
                <div className="text-[11px] font-mono text-[#8E98A8] flex items-center gap-3">
                  <span>Pool Cash: <strong className="text-white">${selectedMarket.spareCashUsdc.toLocaleString('en-US', { maximumFractionDigits: 0 })}</strong></span>
                  {selectedMarket.referencePrice && (
                    <span className="text-[#60A5FA]">
                      Anchor: ${selectedMarket.referencePrice.toLocaleString()}
                    </span>
                  )}
                </div>
              )}
            </div>

            {isLoadingLadder && ladder.length === 0 ? (
              <div className="py-6 flex items-center justify-center text-xs text-[#8E98A8] gap-2 font-mono">
                <Loader2 className="w-4 h-4 animate-spin text-[#60A5FA]" />
                Loading Black-Scholes strike probabilities...
              </div>
            ) : ladder.length === 0 ? (
              <div className="py-5 text-center text-xs text-[#8E98A8] font-mono">
                No active Predict expiry markets returned right now. Wait a few seconds for the next window roll.
              </div>
            ) : (
              <div className="overflow-x-auto border border-[#1E232D] rounded-lg">
                <table className="w-full text-xs font-mono tabular-nums">
                  <thead>
                    <tr className="bg-[#06070A] text-[#8E98A8] border-b border-[#1A1E26] text-[11px]">
                      <th className="text-left py-2 px-3">Strike Price</th>
                      <th className="text-right py-2 px-3">Distance</th>
                      <th className="text-center py-2 px-3 text-[#08D189]">Call / UP (Payout · Prob)</th>
                      <th className="text-center py-2 px-3 text-[#F0525E]">Put / DOWN (Payout · Prob)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#141821]">
                    {ladder.map((row) => {
                      const isStrikeSelected = Number(strikeInput) === row.strike && side !== 'range';
                      const isUpActive = isStrikeSelected && side === 'up';
                      const isDownActive = isStrikeSelected && side === 'down';
                      const distPct = forward > 0 ? ((row.strike - forward) / forward) * 100 : null;
                      return (
                        <tr
                          key={row.strike}
                          className={`transition-colors ${
                            isStrikeSelected ? 'bg-[#2B7FFF]/8' : 'hover:bg-white/[0.02]'
                          }`}
                        >
                          <td className="py-2 px-3 font-bold text-white">
                            ${row.strike.toLocaleString()}
                          </td>
                          <td className="py-2 px-3 text-right text-[#8E98A8]">
                            {distPct !== null ? `${distPct >= 0 ? '+' : ''}${distPct.toFixed(2)}%` : '—'}
                          </td>
                          <td className="py-1.5 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => {
                                setSide('up');
                                setStrikeInput(String(row.strike));
                              }}
                              className={`w-full max-w-[190px] mx-auto px-2.5 py-1 rounded border inline-flex items-center justify-between gap-2 transition-all ${
                                isUpActive
                                  ? 'bg-[#08D189]/25 border-[#08D189] text-white font-bold'
                                  : row.upInBand
                                    ? 'bg-[#08D189]/10 border-[#08D189]/35 text-[#08D189] hover:bg-[#08D189]/20'
                                    : 'bg-[#06070A] border-[#1A1E26] text-[#6B7280] hover:text-slate-300'
                              }`}
                            >
                              <span className="font-bold">{row.upMultiple.toFixed(2)}x</span>
                              <span className="text-[11px] opacity-90">{(row.upProb * 100).toFixed(1)}%</span>
                            </button>
                          </td>
                          <td className="py-1.5 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => {
                                setSide('down');
                                setStrikeInput(String(row.strike));
                              }}
                              className={`w-full max-w-[190px] mx-auto px-2.5 py-1 rounded border inline-flex items-center justify-between gap-2 transition-all ${
                                isDownActive
                                  ? 'bg-[#F0525E]/25 border-[#F0525E] text-white font-bold'
                                  : row.downInBand
                                    ? 'bg-[#F0525E]/10 border-[#F0525E]/35 text-[#F0525E] hover:bg-[#F0525E]/20'
                                    : 'bg-[#06070A] border-[#1A1E26] text-[#6B7280] hover:text-slate-300'
                              }`}
                            >
                              <span className="font-bold">{row.downMultiple.toFixed(2)}x</span>
                              <span className="text-[11px] opacity-90">{(row.downProb * 100).toFixed(1)}%</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Orders & Positions Dock */}
          <div className="bg-[#000000] p-3.5 sm:p-4 space-y-3 min-h-[190px]">
            <div className="flex items-center gap-4 border-b border-[#1A1E26] pb-2">
              <button
                type="button"
                onClick={() => setBottomTab('orders')}
                className={`pb-1.5 text-xs font-semibold transition-colors border-b-2 -mb-[9px] ${
                  bottomTab === 'orders'
                    ? 'border-[#2B7FFF] text-white'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                Queued & Settled Orders ({board?.orderRecords.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setBottomTab('positions')}
                className={`pb-1.5 text-xs font-semibold transition-colors border-b-2 -mb-[9px] ${
                  bottomTab === 'positions'
                    ? 'border-[#2B7FFF] text-white'
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                Open Positions ({board?.positions.length || 0})
              </button>
            </div>

            {!account ? (
              <div className="py-5 text-center text-xs text-slate-500">
                Connect your Sui wallet to view Predict orders, early-sell controls, and claimable USDC.
              </div>
            ) : bottomTab === 'orders' ? (
              (board?.orderRecords.length || 0) === 0 ? (
                <div className="py-5 text-center text-xs text-slate-500">
                  No recent DeepBook Predict orders found for this wallet.
                </div>
              ) : (
                <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                  {board!.orderRecords.map((rec) => {
                    const v = rec.view;
                    const qtyUsdc =
                      v.state === 'filled' && v.position
                        ? rawToUsdc(v.position.quantityRaw)
                        : v.state === 'filled' || v.state === 'closed'
                          ? rawToUsdc(v.quantityRaw)
                          : 0;
                    const sellable =
                      (v.state === 'filled' || v.state === 'refunded') && v.sellable && Boolean(v.position);
                    const hasParked =
                      (v.state === 'filled' || v.state === 'refunded' || v.state === 'closed') &&
                      v.parkedRaw > 0n;
                    const canRefund =
                      (v.state === 'placed' || v.state === 'priced' || v.state === 'refunding') &&
                      v.canRequestRefund;

                    const sellKey = `${rec.marketId}:${rec.recordId.toString()}:sell`;
                    const parkedKey = `${rec.marketId}:${rec.recordId.toString()}:parked`;
                    const refundKey = `${rec.marketId}:${rec.recordId.toString()}:refund`;

                    return (
                      <div
                        key={`${rec.marketId}:${rec.recordId.toString()}`}
                        className="rounded-lg bg-[#000000] border border-[#1A1E26] px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                              rec.sideLabel === 'UP'
                                ? 'bg-[#08D189]/15 text-[#08D189]'
                                : rec.sideLabel === 'DOWN'
                                  ? 'bg-[#F0525E]/15 text-[#F0525E]'
                                  : 'bg-[#2B7FFF]/15 text-[#60A5FA]'
                            }`}
                          >
                            {rec.sideLabel}
                          </span>
                          <div>
                            <div className="font-mono font-semibold text-white">
                              {rec.strikeLabel}
                              {qtyUsdc > 0 ? ` · $${qtyUsdc.toFixed(2)} max payout` : ''}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono">
                              Record #{rec.recordId.toString()} · State: <span className="text-slate-200 uppercase">{v.state}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {sellable && (
                            <button
                              type="button"
                              disabled={busyRecordKey === sellKey}
                              onClick={() => handleRecordAction(rec, 'sell')}
                              className="px-2.5 py-1 rounded bg-[#2B7FFF]/15 border border-[#2B7FFF]/45 text-[#60A5FA] hover:bg-[#2B7FFF]/25 font-semibold inline-flex items-center gap-1"
                            >
                              {busyRecordKey === sellKey && <Loader2 className="w-3 h-3 animate-spin" />}
                              Early Sell
                            </button>
                          )}
                          {hasParked && (
                            <button
                              type="button"
                              disabled={busyRecordKey === parkedKey}
                              onClick={() => handleRecordAction(rec, 'parked')}
                              className="px-2.5 py-1 rounded bg-[#08D189]/15 border border-[#08D189]/40 text-[#08D189] hover:bg-[#08D189]/25 font-semibold inline-flex items-center gap-1"
                            >
                              {busyRecordKey === parkedKey && <Loader2 className="w-3 h-3 animate-spin" />}
                              Claim Parked
                            </button>
                          )}
                          {canRefund && (
                            <button
                              type="button"
                              disabled={busyRecordKey === refundKey}
                              onClick={() => handleRecordAction(rec, 'refund')}
                              className="px-2.5 py-1 rounded bg-amber-500/15 border border-amber-400/40 text-amber-200 hover:bg-amber-500/25 font-semibold inline-flex items-center gap-1"
                            >
                              {busyRecordKey === refundKey && <Loader2 className="w-3 h-3 animate-spin" />}
                              Refund
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            ) : (board?.positions.length || 0) === 0 ? (
              <div className="py-5 text-center text-xs text-slate-500">
                No active open options held in your Predict account.
              </div>
            ) : (
              <div className="space-y-2">
                {board!.positions.map((pos) => (
                  <div
                    key={`${pos.marketId}:${pos.orderId.toString()}`}
                    className="rounded-lg bg-[#000000] border border-[#1A1E26] px-3 py-2 flex items-center justify-between text-xs font-mono"
                  >
                    <span className="text-slate-300">
                      Market {pos.marketId.slice(0, 8)}...{pos.marketId.slice(-6)}
                    </span>
                    <span className="text-[#08D189]">Order #{pos.orderId.toString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Flush Order Ticket */}
        <div className="min-w-0 lg:col-start-2 lg:row-start-1 lg:row-span-2 bg-[#000000] p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-white tracking-tight">Place Binary Option</span>
            <span className="text-[11px] font-mono text-slate-400">
              Wallet: {walletUsdc.toFixed(2)} USDC
            </span>
          </div>

          {/* Direction Selector */}
          <div className="grid grid-cols-3 gap-1 bg-[#000000] p-1 rounded-lg border border-[#1A1E26]">
            <button
              type="button"
              onClick={() => setSide('up')}
              className={`py-2 rounded text-xs font-bold flex items-center justify-center gap-1 transition-all border ${
                side === 'up'
                  ? 'bg-[#08D189]/18 border-[#08D189]/50 text-[#08D189]'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              UP
            </button>
            <button
              type="button"
              onClick={() => setSide('down')}
              className={`py-2 rounded text-xs font-bold flex items-center justify-center gap-1 transition-all border ${
                side === 'down'
                  ? 'bg-[#F0525E]/18 border-[#F0525E]/50 text-[#F0525E]'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              <TrendingDown className="w-3.5 h-3.5" />
              DOWN
            </button>
            <button
              type="button"
              onClick={() => setSide('range')}
              className={`py-2 rounded text-xs font-bold flex items-center justify-center gap-1 transition-all border ${
                side === 'range'
                  ? 'bg-[#2B7FFF]/18 border-[#2B7FFF]/50 text-[#60A5FA]'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              RANGE
            </button>
          </div>

          {/* Strike Input(s) */}
          {side !== 'range' ? (
            <div className="rounded-lg bg-[#000000] border border-[#1A1E26] focus-within:border-[#2B7FFF]/60 p-3 space-y-2 transition-colors">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">
                  Target Strike ({side === 'up' ? 'BTC finishes >' : 'BTC finishes <='})
                </span>
                <button
                  type="button"
                  onClick={handleBestOtmStrike}
                  className="text-[#60A5FA] hover:underline font-semibold"
                >
                  Best OTM (~2.4x)
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleStepStrike(-1)}
                  className="px-2.5 py-1.5 rounded bg-[#0C0E13] border border-[#1A1E26] text-slate-300 hover:text-white text-xs font-mono"
                >
                  -
                </button>
                <input
                  type="number"
                  value={strikeInput}
                  onChange={(e) => setStrikeInput(e.target.value)}
                  className="w-full bg-transparent text-white font-mono font-bold text-base focus:outline-none text-center tabular-nums"
                  placeholder="68700"
                />
                <button
                  type="button"
                  onClick={() => handleStepStrike(1)}
                  className="px-2.5 py-1.5 rounded bg-[#0C0E13] border border-[#1A1E26] text-slate-300 hover:text-white text-xs font-mono"
                >
                  +
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-[#000000] border border-[#1A1E26] focus-within:border-[#2B7FFF]/60 p-2.5 space-y-1">
                <span className="text-[11px] text-slate-400">Lower Strike ($)</span>
                <input
                  type="number"
                  value={lowerStrikeInput}
                  onChange={(e) => setLowerStrikeInput(e.target.value)}
                  className="w-full bg-transparent text-white font-mono font-bold text-sm focus:outline-none"
                />
              </div>
              <div className="rounded-lg bg-[#000000] border border-[#1A1E26] focus-within:border-[#2B7FFF]/60 p-2.5 space-y-1">
                <span className="text-[11px] text-slate-400">Upper Strike ($)</span>
                <input
                  type="number"
                  value={upperStrikeInput}
                  onChange={(e) => setUpperStrikeInput(e.target.value)}
                  className="w-full bg-transparent text-white font-mono font-bold text-sm focus:outline-none"
                />
              </div>
            </div>
          )}

          {/* Budget Amount */}
          <div className="rounded-lg bg-[#000000] border border-[#1A1E26] focus-within:border-[#2B7FFF]/60 p-3 space-y-2 transition-colors">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Budget (USDC)</span>
              <span className="text-slate-400 font-mono">
                Min ${PREDICT_ORDER_USD_MIN.toFixed(2)}
              </span>
            </div>
            <input
              type="number"
              min="1"
              step="0.5"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              className="w-full bg-transparent text-white font-mono font-bold text-xl focus:outline-none tabular-nums"
              placeholder="2.00"
            />
            <div className="grid grid-cols-5 gap-1">
              {['1.5', '2', '5', '10', '25'].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAmountInput(v)}
                  className={`py-1 rounded text-[11px] font-mono border transition-colors ${
                    amountInput === v
                      ? 'bg-[#2B7FFF]/18 border-[#2B7FFF]/50 text-[#60A5FA] font-semibold'
                      : 'bg-[#0C0E13] border-[#1A1E26] text-slate-400 hover:text-white'
                  }`}
                >
                  ${v}
                </button>
              ))}
            </div>
          </div>

          {/* Slippage Toggle */}
          <div className="flex items-center justify-between text-xs px-0.5">
            <span className="text-slate-400">Fill Slippage Guard</span>
            <div className="flex items-center gap-1">
              {(['auto', 2, 5] as const).map((s) => (
                <button
                  key={String(s)}
                  type="button"
                  onClick={() => setSlippageCents(s)}
                  className={`px-2 py-0.5 rounded font-mono text-[11px] border ${
                    slippageCents === s
                      ? 'bg-[#2B7FFF]/18 border-[#2B7FFF]/50 text-[#60A5FA]'
                      : 'border-[#1A1E26] text-slate-400 hover:text-white'
                  }`}
                >
                  {s === 'auto' ? 'Auto' : `${s}c`}
                </button>
              ))}
            </div>
          </div>

          {/* Live Quote Details */}
          <div className="rounded-lg bg-[#000000] border border-[#1A1E26] p-3 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Implied Odds / Contract</span>
              <span className="font-mono font-semibold text-white">
                {isQuoting
                  ? '...'
                  : quotePlan
                    ? `${(quotePlan.pricePerContract * 100).toFixed(1)}c (${(quotePlan.pricePerContract * 100).toFixed(1)}%)`
                    : '--'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Potential Win Payout</span>
              <span className="font-mono font-bold text-[#08D189]">
                {quotePlan
                  ? `$${quotePlan.potentialPayout.toFixed(2)} (${quotePlan.payoutMultiple.toFixed(2)}x)`
                  : '--'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Min Guaranteed Payout</span>
              <span className="font-mono text-slate-200">
                {quotePlan ? `$${quotePlan.minPayout.toFixed(2)}` : '--'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Queue Keeper Fee</span>
              <span className="font-mono text-slate-200">
                ${(quotePlan?.orderFee ?? 0.02).toFixed(2)} USDC
              </span>
            </div>
            <div className="flex items-center justify-between pt-1.5 border-t border-[#1A1E26]">
              <span className="text-slate-400">Wallet Shortfall (1-Tx Deposit)</span>
              <span className="font-mono text-[#60A5FA]">
                {shortfallUsd > 0 ? `$${shortfallUsd.toFixed(2)} USDC` : '$0.00 (Covered by Vault)'}
              </span>
            </div>
          </div>

          {quoteError && (
            <div className="rounded-lg bg-[#F0525E]/10 border border-[#F0525E]/35 px-3 py-2 text-[11px] text-[#F0525E] flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#F0525E]" />
              <span>{quoteError}</span>
            </div>
          )}

          {!quoteError && quotePlan && !quotePlan.accepting && !isVaultFundingOnly && (
            <div className="rounded bg-amber-500/8 border border-amber-400/25 px-2.5 py-1.5 text-[11px] text-amber-200 flex items-center gap-2 font-mono">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
              <span className="truncate">
                Outside 15%–50% band or min $1.00 ({quotePlan.refusal || 'limits'})
              </span>
            </div>
          )}

          {!quoteError && account && canSubmitPredict && shortfallUsd > walletUsdc + 0.0001 && (
            <div className="rounded bg-amber-500/8 border border-amber-400/25 px-2.5 py-1.5 text-[11px] text-amber-200 flex items-center justify-between gap-2 font-mono">
              <span className="inline-flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                <span>Need ${shortfallUsd.toFixed(2)} USDC</span>
              </span>
              <span className="text-[#8E98A8]">Wallet: ${walletUsdc.toFixed(2)}</span>
            </div>
          )}

          <button
            type="button"
            disabled={
              isSubmitting ||
              !selectedMarket ||
              (Boolean(account) && (!canSubmitPredict || shortfallUsd > walletUsdc + 0.0001))
            }
            onClick={handlePlaceBet}
            className={`w-full py-3 rounded-lg font-bold text-sm transition-all flex items-center justify-center gap-2 ${
              side === 'up'
                ? 'bg-[#08D189] hover:bg-[#0DE295] text-[#05120D]'
                : side === 'down'
                  ? 'bg-[#F0525E] hover:bg-[#FF6370] text-white'
                  : 'btn-deepbook'
            } disabled:opacity-45 disabled:cursor-not-allowed`}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Simulating & Signing 1-Tx Bet...</span>
              </>
            ) : !account ? (
              <span>Connect Sui Wallet to Trade</span>
            ) : (
              <>
                <Zap className="w-4 h-4" />
                <span>
                  {sessionStatus?.isActiveNow &&
                  shortfallUsd <= 0.0001 &&
                  (sessionStatus?.sessionGasSui ?? 0) >= 0.005
                    ? `1-Click Bet (No Popup) ${side.toUpperCase()} ($${parsedAmount.toFixed(2)})`
                    : `${board?.account?.hasAccount ? 'Place' : 'Create Vault & Place'} ${side.toUpperCase()} ($${parsedAmount.toFixed(2)})`}
                </span>
              </>
            )}
          </button>

          <PredictSessionPanel
            hasAccount={Boolean(board?.account?.hasAccount)}
            availableUsdc={availableUsdc}
            protocol={board?.protocol ?? null}
            sessionStatus={sessionStatus}
            onSessionUpdated={loadBoard}
            onNotify={onNotify}
          />

          {/* Native Monetization Status */}
          <div className="rounded-lg bg-[#000000] border border-[#1A1E26] px-3 py-2 text-[11px] text-slate-400 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-[#08D189]" />
              {board?.protocol.builderFeeCutoverActive && board?.protocol.builderCodeExists
                ? `Volt BuilderCode Active (${PREDICT_BUILDER_FEE_PCT}%)`
                : board?.protocol.referrerWrapperExists
                  ? `DeepBook Native Referrer (${board.protocol.referralFeeRatePct.toFixed(0)}% Split)`
                  : `Native BuilderCode v${board?.protocol.versionWatermark || 4} Ready`}
            </span>
            <span className="font-mono text-[10px] text-slate-500">1-Tx Auto</span>
          </div>
        </div>
      </div>

      <AiCopilotModal
        isOpen={isAiCopilotOpen}
        initialTab="predict"
        onClose={() => setIsAiCopilotOpen(false)}
        defaultCandles={btcCandles}
        onNotify={onNotify}
        onDeployed={loadBoard}
      />
    </div>
  );
};
