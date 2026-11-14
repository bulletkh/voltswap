import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Clock,
  RefreshCw,
  Loader2,
  ArrowDownToLine,
  ArrowUpFromLine,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Wallet,
  X,
  Zap,
  Pencil,
  ArrowRight,
  ChevronRight,
} from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import {
  rawToUsdc,
  usdcToRaw,
  snapStrike,
  MAINNET_CONFIG,
  type MintPlan,
} from '@mysten/deepbook-v3/predict';
import {
  fetchPredictBoard,
  fetchPredictStrikeLadder,
  pickDefaultValidStrike,
  quotePredictTrade,
  buildPredictPlaceBetTx,
  buildPredictEarlySellTx,
  buildPredictDepositTx,
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
import { type ChartTimeframe } from './ProCandleChart';
import { PredictLiveChart, type PredictPricePoint } from './PredictLiveChart';
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

async function fetchBtcSpotTicker(): Promise<number> {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
    if (!res.ok) return 0;
    const data = await res.json();
    const p = Number(data?.price);
    return Number.isFinite(p) && p > 0 ? p : 0;
  } catch {
    return 0;
  }
}

function formatCountdown(msLeft: number): string {
  if (msLeft <= 0) return '0:00';
  const totalSec = Math.floor(msLeft / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatClockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatExpiryChip(market: PredictMarketBoardItem, nowMs: number): string {
  const diffMin = Math.max(1, Math.round((Number(market.market.expiryMs) - nowMs) / 60_000));
  const clock = formatClockTime(Number(market.market.expiryMs));
  if (diffMin < 60) {
    return `${clock} (${diffMin}m)`;
  }
  const hrs = Math.round(diffMin / 60);
  return `${clock} (${hrs}h)`;
}

export const PredictWorkspace: React.FC<PredictWorkspaceProps> = ({
  onNotify,
  onTradeRecorded,
  onVolumeUpdated,
}) => {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();

  const [predictMode, setPredictMode] = useState<'simple' | 'trader'>('simple');
  const [board, setBoard] = useState<PredictBoardState | null>(null);
  const [isLoadingBoard, setIsLoadingBoard] = useState(true);
  const [selectedMarketId, setSelectedMarketId] = useState<string>('');
  const [ladder, setLadder] = useState<PredictStrikeQuote[]>([]);
  const [isLoadingLadder, setIsLoadingLadder] = useState(false);

  const [side, setSide] = useState<'up' | 'down' | 'range'>('up');
  const [strikeInput, setStrikeInput] = useState<string>('');
  const [lowerStrikeInput, setLowerStrikeInput] = useState<string>('');
  const [upperStrikeInput, setUpperStrikeInput] = useState<string>('');
  const [rangePickStep, setRangePickStep] = useState<'lower' | 'upper'>('lower');
  const [amountInput, setAmountInput] = useState<string>('5');
  const [isCustomAmountOpen, setIsCustomAmountOpen] = useState<boolean>(false);
  const [slippageCents, setSlippageCents] = useState<number | 'auto'>('auto');

  const [quotePlan, setQuotePlan] = useState<MintPlan | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);

  // Simple mode dual quotes (Up & Down around reference price)
  const [simpleUpPlan, setSimpleUpPlan] = useState<MintPlan | null>(null);
  const [simpleDownPlan, setSimpleDownPlan] = useState<MintPlan | null>(null);
  const [showSimpleSessionDrawer, setShowSimpleSessionDrawer] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDepositing, setIsDepositing] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [vaultModal, setVaultModal] = useState<'deposit' | 'withdraw' | null>(null);
  const [vaultAmt, setVaultAmt] = useState<string>('');
  const [busyRecordKey, setBusyRecordKey] = useState<string | null>(null);

  const [walletUsdc, setWalletUsdc] = useState<number>(0);
  const [btcCandles, setBtcCandles] = useState<DeepBookCandle[]>([]);
  const [livePoints, setLivePoints] = useState<PredictPricePoint[]>([]);
  const [liveBtcSpot, setLiveBtcSpot] = useState<number>(0);
  const [candlesLoading, setCandlesLoading] = useState<boolean>(true);
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('1m');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [bottomTab, setBottomTab] = useState<'positions' | 'orders' | 'history'>('positions');
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
        if (data.length > 0) {
          setBtcCandles(data);
          setLiveBtcSpot((prev) => (prev > 0 ? prev : data[data.length - 1].close));
        }
        setCandlesLoading(false);
      }
    };
    loadCandles();
    const timer = setInterval(loadCandles, 12_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [timeframe]);

  // 2-second real-time BTC price tick for smooth DeepBook Predict area/baseline chart
  useEffect(() => {
    let cancelled = false;
    const pollTick = async () => {
      const p = await fetchBtcSpotTicker();
      if (!cancelled && p > 0) {
        setLiveBtcSpot(p);
        const nowSec = Math.floor(Date.now() / 1000);
        setLivePoints((prev) => {
          const next = [...prev, { time: nowSec, value: p }];
          return next.length > 140 ? next.slice(-140) : next;
        });
      }
    };
    pollTick();
    const timer = setInterval(pollTick, 2_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const selectedMarket = useMemo<PredictMarketBoardItem | null>(() => {
    if (!board || board.markets.length === 0) return null;
    return board.markets.find((m) => m.market.id === selectedMarketId) || board.markets[0];
  }, [board, selectedMarketId]);

  // Simple mode picks the nearest active round with referencePrice set (usually 1m / 5m)
  const simpleMarket = useMemo<PredictMarketBoardItem | null>(() => {
    if (!board || board.markets.length === 0) return null;
    return (
      board.markets.find(
        (m) =>
          m.referencePrice != null &&
          m.acceptingMints &&
          Number(m.market.expiryMs) - nowMs > 15_000
      ) ||
      board.markets.find((m) => Number(m.market.expiryMs) - nowMs > 15_000) ||
      board.markets[0]
    );
  }, [board, nowMs]);

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

  // Trader Mode Quote
  useEffect(() => {
    if (predictMode !== 'trader' || !selectedMarket) {
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
    predictMode,
    selectedMarket,
    account?.address,
    side,
    parsedStrike,
    parsedLower,
    parsedUpper,
    parsedAmount,
    slippageCents,
  ]);

  // Simple Mode Dual Quotes (Up & Down around referencePrice)
  useEffect(() => {
    if (predictMode !== 'simple' || !simpleMarket) {
      setSimpleUpPlan(null);
      setSimpleDownPlan(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const owner = account?.address || VOLT_TREASURY_ADDRESS;
      const strikeArg: number | 'reference' =
        simpleMarket.referencePrice != null
          ? 'reference'
          : Math.round(simpleMarket.forwardPrice || liveBtcSpot || 1);
      const [upRes, downRes] = await Promise.all([
        quotePredictTrade({
          owner,
          market: simpleMarket.market,
          side: 'up',
          strike: strikeArg,
          amountUsdc: parsedAmount,
          slippageCents,
        }),
        quotePredictTrade({
          owner,
          market: simpleMarket.market,
          side: 'down',
          strike: strikeArg,
          amountUsdc: parsedAmount,
          slippageCents,
        }),
      ]);
      if (!cancelled) {
        setSimpleUpPlan(upRes.plan);
        setSimpleDownPlan(downRes.plan);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [predictMode, simpleMarket, account?.address, parsedAmount, slippageCents, liveBtcSpot]);

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

  const handleSelectStrikeFromColumn = (strikeVal: number) => {
    if (side !== 'range') {
      setStrikeInput(String(strikeVal));
      return;
    }
    if (rangePickStep === 'lower') {
      const curUpper = parsedUpper > strikeVal ? parsedUpper : strikeVal + 100;
      setLowerStrikeInput(String(strikeVal));
      setUpperStrikeInput(String(curUpper));
      setRangePickStep('upper');
    } else {
      if (strikeVal <= parsedLower) {
        setUpperStrikeInput(String(parsedLower));
        setLowerStrikeInput(String(strikeVal));
      } else {
        setUpperStrikeInput(String(strikeVal));
      }
      setRangePickStep('lower');
    }
  };

  const executePredictBet = async (opts: {
    targetMarket: PredictMarketBoardItem;
    betSide: 'up' | 'down' | 'range';
    betStrike: number;
    plan: MintPlan | null;
    errorHint?: string | null;
  }) => {
    const { targetMarket, betSide, betStrike, plan, errorHint } = opts;
    if (!account?.address) {
      onNotify(
        'warning',
        'Wallet Not Connected',
        'Connect your Sui wallet to place Predict trades.'
      );
      return;
    }
    if (!board) return;
    if (!plan || (!plan.accepting && plan.refusal !== 'fee')) {
      onNotify(
        'error',
        'Invalid Predict Order',
        errorHint || plan?.refusal || 'Order parameters outside DeepBook Predict entry limits.'
      );
      return;
    }

    const availableRaw = usdcToRaw(board.account?.availableUsdc ?? 0);
    const totalDebitRaw = plan.raw.totalDebit;
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
          market: targetMarket.market,
          side: betSide,
          strike: betStrike,
          lowerStrike: parsedLower,
          upperStrike: parsedUpper,
          maxCostRaw: plan.raw.maxCost ?? plan.raw.budget,
          minQuantityRaw: plan.raw.minQuantity,
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
          market: targetMarket.market,
          side: betSide,
          strike: betStrike,
          lowerStrike: parsedLower,
          upperStrike: parsedUpper,
          maxCostRaw: plan.raw.maxCost ?? plan.raw.budget,
          minQuantityRaw: plan.raw.minQuantity,
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
        betSide === 'up'
          ? `BTC > $${betStrike.toLocaleString()}`
          : betSide === 'down'
            ? `BTC <= $${betStrike.toLocaleString()}`
            : `BTC $${parsedLower.toLocaleString()}-$${parsedUpper.toLocaleString()}`;

      onNotify(
        'success',
        canUseSession
          ? `1-Click ${betSide.toUpperCase()} Enqueued`
          : `Predict ${betSide.toUpperCase()} Enqueued`,
        `${sideText} · Est. Payout $${plan.potentialPayout.toFixed(2)} (${plan.payoutMultiple.toFixed(2)}x)${canUseSession ? ' · 0-popup session' : ''}`,
        'Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );

      if (digest) {
        const nextVol = addWalletVolumeUsd(account.address, plan.totalDebit);
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
            toToken: `BTC-${betSide.toUpperCase()}`,
            fromAmount: plan.totalDebit.toFixed(2),
            toAmount: plan.potentialPayout.toFixed(2),
            volumeUsd: plan.totalDebit,
            feeRate: board.protocol.builderFeeCutoverActive ? PREDICT_BUILDER_FEE_PCT / 100 : 0,
            tierName: tier.name,
            swapMode: 'DEEPBOOK_PREDICT',
            referrer: ref,
          }),
        }).catch(() => {});

        onTradeRecorded({
          fromToken: 'USDC',
          toToken: `BTC Predict (${betSide.toUpperCase()})`,
          fromAmount: plan.totalDebit.toFixed(2),
          toAmount: `$${plan.potentialPayout.toFixed(2)} max payout`,
          volumeUsd: plan.totalDebit,
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

  const handlePlaceBet = async () => {
    if (!selectedMarket) return;
    await executePredictBet({
      targetMarket: selectedMarket,
      betSide: side,
      betStrike: parsedStrike,
      plan: quotePlan,
      errorHint: quoteError,
    });
  };

  const handleSimpleBet = async (dir: 'up' | 'down') => {
    if (!simpleMarket) return;
    const refStrike =
      simpleMarket.referencePrice != null
        ? simpleMarket.referencePrice
        : Math.round(simpleMarket.forwardPrice || liveBtcSpot);
    const plan = dir === 'up' ? simpleUpPlan : simpleDownPlan;
    await executePredictBet({
      targetMarket: simpleMarket,
      betSide: dir,
      betStrike: refStrike,
      plan,
    });
  };

  const handleDepositUsdc = async (amtNum: number) => {
    if (!account?.address || !board || !(amtNum > 0)) return;
    setIsDepositing(true);
    try {
      const tx = buildPredictDepositTx({
        sender: account.address,
        amountUsdc: amtNum,
        hasAccount: Boolean(board.account?.hasAccount),
        protocol: board.protocol,
      });
      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) {
        onNotify(
          'error',
          'Deposit Simulation Failed',
          sim.errorMessage || 'Cannot deposit right now.'
        );
        return;
      }
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      setVaultModal(null);
      setVaultAmt('');
      onNotify(
        'success',
        'Deposited to Predict Vault',
        `+${amtNum.toFixed(2)} USDC funded for popup-free Predict execution.`,
        'Suiscan',
        `https://suiscan.xyz/mainnet/tx/${digest}`
      );
      await loadBoard();
    } catch (err: any) {
      onNotify('error', 'Deposit Failed', err?.message || 'Wallet rejected deposit.');
    } finally {
      setIsDepositing(false);
    }
  };

  const handleWithdrawAvailable = async (customAmount?: number) => {
    if (!account?.address || !board?.account || board.account.availableUsdc <= 0.001) return;
    const amt = Math.min(
      board.account.availableUsdc,
      customAmount && customAmount > 0 ? customAmount : board.account.availableUsdc
    );
    if (!(amt > 0.001)) return;
    setIsWithdrawing(true);
    try {
      const tx = buildPredictWithdrawTx(account.address, amt);
      const sim = await simulateTxBeforeWallet(tx, { sender: account.address });
      if (!sim.ok) {
        onNotify(
          'error',
          'Withdraw Simulation Failed',
          sim.errorMessage || 'Cannot withdraw right now.'
        );
        return;
      }
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      const digest = extractTxDigest(res);
      setVaultModal(null);
      setVaultAmt('');
      onNotify(
        'success',
        'Predict USDC Withdrawn',
        `${amt.toFixed(2)} USDC returned to your Sui wallet.`,
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
      if (
        action === 'sell' &&
        (rec.view.state === 'filled' || rec.view.state === 'refunded') &&
        rec.view.position
      ) {
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
        onNotify(
          'error',
          'Predict Action Failed',
          sim.errorMessage || 'Preflight simulation failed.'
        );
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

  const forward =
    liveBtcSpot > 0
      ? liveBtcSpot
      : selectedMarket?.forwardPrice || board?.spotForward || 0;
  const availableUsdc = board?.account?.availableUsdc ?? 0;
  const totalNeeded = quotePlan?.totalDebit ?? parsedAmount;
  const shortfallUsd = Math.max(0, totalNeeded - availableUsdc);
  const isVaultFundingOnly = quotePlan?.refusal === 'fee' && parsedAmount >= PREDICT_ORDER_USD_MIN;
  const canSubmitPredict = Boolean(
    selectedMarket && quotePlan && (quotePlan.accepting || isVaultFundingOnly)
  );

  // Split user records for Predict Positions | Limit Orders | History tabs
  const allRecords = board?.orderRecords || [];
  const positionRecords = allRecords.filter((r) => r.view.state === 'filled');
  const limitOrderRecords = allRecords.filter(
    (r) => r.view.state === 'placed' || r.view.state === 'priced'
  );
  const historyRecords = allRecords.filter(
    (r) =>
      r.view.state !== 'filled' &&
      r.view.state !== 'placed' &&
      r.view.state !== 'priced'
  );
  const totalPositionsCount = positionRecords.length + (board?.positions.length ?? 0);

  // Trader right-column strike ladder sorted descending (highest strike at top like DeepBook)
  const verticalStrikes = useMemo(() => {
    return [...ladder].sort((a, b) => b.strike - a.strike);
  }, [ladder]);

  const simpleMsLeft = simpleMarket ? Math.max(0, Number(simpleMarket.market.expiryMs) - nowMs) : 0;
  const simpleRefPrice = simpleMarket?.referencePrice ?? null;
  const simpleUpReady = Boolean(
    simpleUpPlan && (simpleUpPlan.accepting || simpleUpPlan.refusal === 'fee')
  );
  const simpleDownReady = Boolean(
    simpleDownPlan && (simpleDownPlan.accepting || simpleDownPlan.refusal === 'fee')
  );
  const simpleCanCoverAmount = availableUsdc + walletUsdc + 0.0001 >= parsedAmount;

  return (
    <div className="space-y-3 animate-panel-in">
      {/* ===================================================================== */}
      {/* SIMPLE MODE (DeepBook 1-Minute Round Up/Down)                         */}
      {/* ===================================================================== */}
      {predictMode === 'simple' ? (
        <div className="rounded-xl border border-[#2D374B] bg-[#05070B] overflow-hidden shadow-2xl">
          {/* Top Minimal Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-[#1E2636] bg-[#080B11]">
            <div className="flex items-center gap-2.5 text-xs">
              <span className="inline-flex items-center gap-1.5 font-bold text-white">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
                BTC / USD
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                DeepBook Predict · Pyth Lazer
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-md border border-[#2D374B] bg-[#000000] px-2.5 py-1 text-xs font-mono">
                <span className="text-slate-400">Balance:</span>
                <span className="font-bold text-white tabular-nums">
                  ${availableUsdc.toFixed(2)}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setVaultAmt('');
                    setVaultModal('deposit');
                  }}
                  className="ml-1 px-1.5 py-0.5 rounded bg-[#2B7FFF]/20 text-[#60A5FA] hover:bg-[#2B7FFF]/30 text-[10px] font-semibold"
                >
                  Deposit
                </button>
                {availableUsdc > 0.01 && (
                  <button
                    type="button"
                    onClick={() => {
                      setVaultAmt(availableUsdc.toFixed(2));
                      setVaultModal('withdraw');
                    }}
                    className="px-1.5 py-0.5 rounded border border-[#2D374B] text-slate-300 hover:text-white text-[10px]"
                  >
                    Withdraw
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setPredictMode('trader')}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-md border border-[#2D374B] bg-[#0C0E13] hover:border-[#2B7FFF]/60 text-xs font-semibold text-slate-200 hover:text-white transition-colors"
              >
                <span>Switch to Trader mode</span>
                <ArrowRight className="w-3.5 h-3.5 text-[#60A5FA]" />
              </button>
            </div>
          </div>

          {/* Full-bleed Split Baseline Chart */}
          <div className="relative">
            <PredictLiveChart
              mode="simple"
              candles={btcCandles}
              livePoints={livePoints}
              spotPrice={forward}
              referencePrice={simpleRefPrice}
              expiryMs={simpleMarket ? Number(simpleMarket.market.expiryMs) : null}
              height={410}
              isLoading={candlesLoading}
            />
          </div>

          {/* Centered Floating Round Card (Matching DeepBook Simple Mode) */}
          <div className="px-4 pb-6 pt-3 bg-[#05070B] flex flex-col items-center">
            <div className="w-full max-w-[420px]">
              <div className="flex justify-end mb-1.5">
                <button
                  type="button"
                  onClick={() => setPredictMode('trader')}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-white transition-colors"
                >
                  <span>Switch to Trader mode</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>

              <div className="rounded-xl border border-[#2D374B] bg-[#0B0E14] p-3.5 space-y-3 shadow-xl">
                {/* Round Title & Countdown */}
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 font-semibold text-white">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
                    <span>
                      BTC ·{' '}
                      {simpleMarket
                        ? `${Math.max(1, Math.round((Number(simpleMarket.market.expiryMs) - nowMs) / 60_000))}-minute round`
                        : '1-minute round'}
                    </span>
                  </div>
                  <span className="font-mono font-bold text-slate-200 tabular-nums">
                    {simpleMarket ? formatCountdown(simpleMsLeft) : '--:--'}
                  </span>
                </div>

                {/* Big Up / Down Buttons */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isSubmitting || !simpleMarket || !simpleUpReady || !account}
                    onClick={() => handleSimpleBet('up')}
                    className="rounded-lg border border-[#08D189]/40 bg-[#08D189]/12 hover:bg-[#08D189]/22 disabled:opacity-45 disabled:cursor-not-allowed py-2.5 px-3 flex flex-col items-center justify-center transition-all"
                  >
                    <span className="inline-flex items-center gap-1 text-sm font-bold text-[#08D189]">
                      <TrendingUp className="w-4 h-4" />
                      Up
                    </span>
                    <span className="text-[11px] font-mono text-[#08D189]/85 mt-0.5">
                      {simpleUpReady && simpleUpPlan
                        ? `Win $${simpleUpPlan.potentialPayout.toFixed(2)}`
                        : simpleUpPlan
                          ? `~${Math.round(simpleUpPlan.pricePerContract * 100)}c · Locked`
                          : simpleMarket?.referencePrice == null
                            ? 'Waiting ref price'
                            : 'Locked'}
                    </span>
                  </button>

                  <button
                    type="button"
                    disabled={isSubmitting || !simpleMarket || !simpleDownReady || !account}
                    onClick={() => handleSimpleBet('down')}
                    className="rounded-lg border border-[#F0525E]/40 bg-[#F0525E]/12 hover:bg-[#F0525E]/22 disabled:opacity-45 disabled:cursor-not-allowed py-2.5 px-3 flex flex-col items-center justify-center transition-all"
                  >
                    <span className="inline-flex items-center gap-1 text-sm font-bold text-[#F0525E]">
                      <TrendingDown className="w-4 h-4" />
                      Down
                    </span>
                    <span className="text-[11px] font-mono text-[#F0525E]/85 mt-0.5">
                      {simpleDownReady && simpleDownPlan
                        ? `Win $${simpleDownPlan.potentialPayout.toFixed(2)}`
                        : simpleDownPlan
                          ? `~${Math.round(simpleDownPlan.pricePerContract * 100)}c · Locked`
                          : simpleMarket?.referencePrice == null
                            ? 'Waiting ref price'
                            : 'Locked'}
                    </span>
                  </button>
                </div>

                {/* Enable 1-Click Trading */}
                <div className="flex items-center justify-center">
                  <button
                    type="button"
                    onClick={() => setShowSimpleSessionDrawer((v) => !v)}
                    className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-300 hover:text-white transition-colors"
                  >
                    <Zap
                      className={`w-3.5 h-3.5 ${
                        sessionStatus?.isActiveNow ? 'text-[#08D189]' : 'text-[#60A5FA]'
                      }`}
                    />
                    <span>
                      {sessionStatus?.isActiveNow
                        ? '1-click trading active (0 popups)'
                        : 'Enable 1-click trading'}
                    </span>
                  </button>
                </div>

                {showSimpleSessionDrawer && (
                  <PredictSessionPanel
                    hasAccount={Boolean(board?.account?.hasAccount)}
                    availableUsdc={availableUsdc}
                    protocol={board?.protocol ?? null}
                    sessionStatus={sessionStatus}
                    onSessionUpdated={loadBoard}
                    onNotify={onNotify}
                  />
                )}

                {/* Quick Amount Chips + Balance */}
                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <div className="flex items-center gap-1.5">
                    {['5', '10', '25'].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => {
                          setAmountInput(v);
                          setIsCustomAmountOpen(false);
                        }}
                        className={`px-2.5 py-1 rounded text-xs font-mono border transition-colors ${
                          amountInput === v && !isCustomAmountOpen
                            ? 'bg-[#2B7FFF]/20 border-[#2B7FFF] text-white font-bold'
                            : 'bg-[#05070B] border-[#2D374B] text-slate-400 hover:text-white'
                        }`}
                      >
                        ${v}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setIsCustomAmountOpen((v) => !v)}
                      title="Custom bet amount"
                      className={`p-1.5 rounded border transition-colors ${
                        isCustomAmountOpen
                          ? 'bg-[#2B7FFF]/20 border-[#2B7FFF] text-white'
                          : 'bg-[#05070B] border-[#2D374B] text-slate-400 hover:text-white'
                      }`}
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="inline-flex items-center gap-1 text-xs font-mono text-slate-300">
                    <Wallet className="w-3.5 h-3.5 text-slate-400" />
                    <span>${(availableUsdc + walletUsdc).toFixed(2)}</span>
                  </div>
                </div>

                {isCustomAmountOpen && (
                  <div className="flex items-center gap-2 rounded-lg bg-[#05070B] border border-[#2D374B] px-3 py-1.5">
                    <span className="text-xs font-mono text-slate-400">$</span>
                    <input
                      type="number"
                      min={PREDICT_ORDER_USD_MIN}
                      step="0.5"
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                      className="w-full bg-transparent text-sm font-mono font-bold text-white focus:outline-none"
                      placeholder="5.00"
                    />
                    <span className="text-[10px] font-mono text-slate-500">
                      min ${PREDICT_ORDER_USD_MIN}
                    </span>
                  </div>
                )}

                {/* Insufficient Balance Banner (Matching DeepBook Screenshot 1) */}
                {account && !simpleCanCoverAmount && (
                  <div className="rounded-lg border border-[#2B7FFF]/45 bg-[#2B7FFF]/10 px-3 py-2 text-[11px] flex items-start gap-2 text-slate-200">
                    <AlertCircle className="w-3.5 h-3.5 text-[#60A5FA] shrink-0 mt-0.5" />
                    <div>
                      <div className="font-semibold text-white">Insufficient USDC balance</div>
                      <div className="text-slate-400">
                        Lower the size or{' '}
                        <button
                          type="button"
                          onClick={() => {
                            setVaultAmt('');
                            setVaultModal('deposit');
                          }}
                          className="text-[#60A5FA] underline hover:text-white"
                        >
                          deposit
                        </button>{' '}
                        to your trade balance.
                      </div>
                    </div>
                  </div>
                )}

                {!account && (
                  <div className="rounded-lg border border-[#2D374B] bg-[#05070B] px-3 py-2 text-[11px] text-slate-400 text-center">
                    Connect Sui Wallet in header to place 1-minute Up/Down trades
                  </div>
                )}

                {/* Footer metadata */}
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-500 pt-1 border-t border-[#1E2636]">
                  <span>
                    last close{' '}
                    {simpleRefPrice != null
                      ? `$${simpleRefPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                      : '--'}
                    {simpleMarket ? ` · ends ${formatClockTime(Number(simpleMarket.market.expiryMs))}` : ''}
                  </span>
                  {allRecords.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setPredictMode('trader')}
                      className="text-[#60A5FA] hover:underline inline-flex items-center gap-0.5"
                    >
                      {allRecords.length} orders <ChevronRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* =================================================================== */
        /* TRADER MODE (DeepBook Area Chart + Vertical Strike Column + Ticket) */
        /* =================================================================== */
        <>
          {/* Top Market Header */}
          <div className="panel-carbon rounded-lg border border-[#2D374B] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
                <span className="text-sm font-bold text-white">BTC</span>
                <span className="text-base font-mono font-extrabold text-white tabular-nums">
                  {forward > 0
                    ? `$${forward.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    : '--'}
                </span>
              </div>

              <div className="flex items-center gap-1 rounded-md border border-[#2D374B] bg-[#000000] p-0.5">
                {(['1m', '5m', '15m', '1h'] as ChartTimeframe[]).map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => setTimeframe(tf)}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                      timeframe === tf
                        ? 'bg-[#2B7FFF]/22 text-[#60A5FA] font-bold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-md border border-[#2D374B] bg-[#000000] px-2.5 py-1 text-xs font-mono">
                <span className="text-slate-400">Vault:</span>
                <span className="font-bold text-white tabular-nums">${availableUsdc.toFixed(2)}</span>
                <button
                  type="button"
                  onClick={() => {
                    setVaultAmt('');
                    setVaultModal('deposit');
                  }}
                  className="ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#2B7FFF]/20 text-[#60A5FA] hover:bg-[#2B7FFF]/30 font-semibold text-[11px]"
                >
                  <ArrowDownToLine className="w-3 h-3" />
                  Deposit
                </button>
                {availableUsdc > 0.01 && (
                  <button
                    type="button"
                    onClick={() => {
                      setVaultAmt(availableUsdc.toFixed(2));
                      setVaultModal('withdraw');
                    }}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-[#2D374B] text-slate-300 hover:text-white text-[11px]"
                  >
                    <ArrowUpFromLine className="w-3 h-3" />
                    Withdraw
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setIsAiCopilotOpen(true)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-[#2B7FFF]/40 bg-[#2B7FFF]/12 hover:bg-[#2B7FFF]/22 text-xs font-semibold text-[#93C5FD]"
              >
                <Sparkles className="w-3.5 h-3.5" />
                AI Copilot
              </button>

              <button
                type="button"
                onClick={loadBoard}
                className="p-1.5 rounded-md border border-[#2D374B] text-slate-400 hover:text-white"
                title="Refresh markets"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingBoard ? 'animate-spin' : ''}`} />
              </button>

              <button
                type="button"
                onClick={() => setPredictMode('simple')}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-[#2D374B] bg-[#0C0E13] hover:border-[#2B7FFF]/60 text-xs font-semibold text-slate-200 hover:text-white"
              >
                <span>Switch to Simple mode</span>
                <ArrowRight className="w-3.5 h-3.5 text-[#60A5FA]" />
              </button>
            </div>
          </div>

          {/* 3-Column DeepBook Trader Layout: Chart | Vertical Strike Picker | Order Ticket */}
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_165px_340px] gap-2.5 items-stretch">
            {/* Column 1: Clean Area Chart + Bottom Tabs */}
            <div className="flex flex-col gap-2.5 min-w-0">
              <div className="rounded-lg border border-[#2D374B] bg-[#030509] overflow-hidden">
                <PredictLiveChart
                  mode="trader"
                  candles={btcCandles}
                  livePoints={livePoints}
                  spotPrice={forward}
                  side={side}
                  strike={parsedStrike}
                  lowerStrike={parsedLower}
                  upperStrike={parsedUpper}
                  height={445}
                  isLoading={candlesLoading}
                />
              </div>

              {/* Bottom Dock: Predict Positions | Limit Orders | History */}
              <div className="panel-carbon rounded-lg border border-[#2D374B] overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 border-b border-[#2D374B] bg-[#000000]/50">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setBottomTab('positions')}
                      className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                        bottomTab === 'positions'
                          ? 'bg-[#2B7FFF]/20 text-white border border-[#2B7FFF]/40'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Predict Positions ({totalPositionsCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setBottomTab('orders')}
                      className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                        bottomTab === 'orders'
                          ? 'bg-[#2B7FFF]/20 text-white border border-[#2B7FFF]/40'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      Limit Orders ({limitOrderRecords.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setBottomTab('history')}
                      className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                        bottomTab === 'history'
                          ? 'bg-[#2B7FFF]/20 text-white border border-[#2B7FFF]/40'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      History ({historyRecords.length})
                    </button>
                  </div>
                </div>

                <div className="p-3 min-h-[130px]">
                  {!account ? (
                    <div className="py-8 text-center text-xs text-slate-500 font-mono">
                      Connect wallet to view Predict positions and orders.
                    </div>
                  ) : bottomTab === 'positions' ? (
                    positionRecords.length === 0 && (board?.positions.length ?? 0) === 0 ? (
                      <div className="py-8 text-center text-xs text-slate-500 font-mono">
                        No positions yet.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[240px] overflow-y-auto">
                        {positionRecords.map((rec) => {
                          const qty =
                            rec.view.state === 'filled' && rec.view.position
                              ? rawToUsdc(rec.view.position.quantityRaw)
                              : 0;
                          const sellKey = `${rec.marketId}:${rec.recordId.toString()}:sell`;
                          return (
                            <div
                              key={`${rec.marketId}:${rec.recordId.toString()}`}
                              className="rounded-lg bg-[#000000] border border-[#2D374B] p-2.5 flex items-center justify-between gap-3 text-xs"
                            >
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-2 font-mono font-bold text-white">
                                  <span>{rec.sideLabel}</span>
                                  <span>{rec.strikeLabel}</span>
                                  <span className="px-1.5 py-0.5 rounded bg-[#08D189]/15 text-[#08D189] text-[10px]">
                                    OPEN
                                  </span>
                                </div>
                                <div className="text-[11px] font-mono text-slate-400">
                                  Max Payout: ${qty.toFixed(2)} · Exp{' '}
                                  {formatClockTime(Number(rec.expiryMs))}
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={busyRecordKey === sellKey}
                                onClick={() => handleRecordAction(rec, 'sell')}
                                className="px-2.5 py-1 rounded bg-[#2B7FFF]/20 border border-[#2B7FFF]/40 text-[#93C5FD] hover:bg-[#2B7FFF]/30 font-semibold text-[11px]"
                              >
                                {busyRecordKey === sellKey ? 'Selling...' : 'Early Sell'}
                              </button>
                            </div>
                          );
                        })}

                        {(board?.positions || []).map((pos) => (
                          <div
                            key={`${pos.marketId}:${pos.orderId.toString()}`}
                            className="rounded-lg bg-[#000000] border border-[#2D374B] p-2.5 flex items-center justify-between text-xs font-mono"
                          >
                            <span className="text-white">
                              Legacy Position #{pos.orderId.toString()}
                            </span>
                            <span className="text-[#08D189] font-bold">Active</span>
                          </div>
                        ))}
                      </div>
                    )
                  ) : bottomTab === 'orders' ? (
                    limitOrderRecords.length === 0 ? (
                      <div className="py-8 text-center text-xs text-slate-500 font-mono">
                        No queued orders.
                      </div>
                    ) : (
                      <div className="space-y-2 max-h-[240px] overflow-y-auto">
                        {limitOrderRecords.map((rec) => {
                          const refKey = `${rec.marketId}:${rec.recordId.toString()}:refund`;
                          return (
                            <div
                              key={`${rec.marketId}:${rec.recordId.toString()}`}
                              className="rounded-lg bg-[#000000] border border-[#2D374B] p-2.5 flex items-center justify-between gap-3 text-xs"
                            >
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-2 font-mono font-bold text-white">
                                  <span>{rec.sideLabel}</span>
                                  <span>{rec.strikeLabel}</span>
                                  <span className="px-1.5 py-0.5 rounded bg-[#2B7FFF]/20 text-[#93C5FD] text-[10px]">
                                    QUEUED
                                  </span>
                                </div>
                                <div className="text-[11px] font-mono text-slate-400">
                                  #{rec.recordId.toString()} · Exp{' '}
                                  {formatClockTime(Number(rec.expiryMs))}
                                </div>
                              </div>
                              <button
                                type="button"
                                disabled={busyRecordKey === refKey}
                                onClick={() => handleRecordAction(rec, 'refund')}
                                className="px-2.5 py-1 rounded border border-[#2D374B] text-slate-300 hover:text-white text-[11px]"
                              >
                                {busyRecordKey === refKey ? '...' : 'Refund'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )
                  ) : historyRecords.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-500 font-mono">
                      No settled or cancelled history yet.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[240px] overflow-y-auto">
                      {historyRecords.map((rec) => {
                        const state = rec.view.state;
                        const parkKey = `${rec.marketId}:${rec.recordId.toString()}:parked`;
                        return (
                          <div
                            key={`${rec.marketId}:${rec.recordId.toString()}`}
                            className="rounded-lg bg-[#000000] border border-[#2D374B] p-2.5 flex items-center justify-between gap-3 text-xs"
                          >
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2 font-mono font-bold text-white">
                                <span>{rec.sideLabel}</span>
                                <span>{rec.strikeLabel}</span>
                                <span className="px-1.5 py-0.5 rounded bg-white/10 text-slate-300 text-[10px] uppercase">
                                  {state}
                                </span>
                              </div>
                              <div className="text-[11px] font-mono text-slate-400">
                                #{rec.recordId.toString()} · Exp{' '}
                                {formatClockTime(Number(rec.expiryMs))}
                              </div>
                            </div>
                            {state === 'refunded' && (
                              <button
                                type="button"
                                disabled={busyRecordKey === parkKey}
                                onClick={() => handleRecordAction(rec, 'parked')}
                                className="px-2.5 py-1 rounded bg-amber-500/20 border border-amber-400/40 text-amber-200 hover:bg-amber-500/30 font-semibold text-[11px]"
                              >
                                {busyRecordKey === parkKey ? 'Claiming...' : 'Claim Parked'}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Column 2: Vertical Strike Ladder ("Set a Price or Range" like DeepBook Screenshot 2) */}
            <div className="rounded-lg border border-[#2D374B] bg-[#06080D] flex flex-col overflow-hidden max-h-[640px]">
              <div className="px-2.5 py-2 border-b border-[#2D374B] bg-[#000000]/70 text-center">
                <div className="text-[11px] font-semibold text-slate-200">
                  Set a Price or Range
                </div>
                {side === 'range' && (
                  <div className="text-[10px] font-mono text-[#60A5FA] mt-0.5">
                    Pick {rangePickStep === 'lower' ? 'Lower' : 'Upper'} bound
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-[#151B26]">
                {isLoadingLadder && verticalStrikes.length === 0 ? (
                  <div className="p-4 text-center text-[11px] font-mono text-slate-500">
                    Loading strikes...
                  </div>
                ) : (
                  verticalStrikes.map((row) => {
                    const isExactSelected =
                      side !== 'range' && Math.abs(row.strike - parsedStrike) < 0.5;
                    const isInRange =
                      side === 'range' &&
                      row.strike >= Math.min(parsedLower, parsedUpper) &&
                      row.strike <= Math.max(parsedLower, parsedUpper);
                    const isSpotRow =
                      forward > 0 &&
                      Math.abs(row.strike - forward) <=
                        Math.max(15, (selectedMarket?.market.admissionTickSize || 25) * 0.6);

                    const activeProb = side === 'down' ? row.downProb : row.upProb;
                    const activeMult = side === 'down' ? row.downMultiple : row.upMultiple;
                    const inBand = side === 'down' ? row.downInBand : row.upInBand;

                    return (
                      <button
                        key={row.strike}
                        type="button"
                        onClick={() => handleSelectStrikeFromColumn(row.strike)}
                        className={`w-full px-2.5 py-1.5 flex items-center justify-between text-xs font-mono transition-colors ${
                          isExactSelected || isInRange
                            ? 'bg-[#2B7FFF] text-white font-bold'
                            : isSpotRow
                              ? 'bg-[#2B7FFF]/15 text-[#93C5FD]'
                              : inBand
                                ? 'text-slate-200 hover:bg-white/5'
                                : 'text-slate-500 hover:bg-white/5'
                        }`}
                      >
                        <span className="tabular-nums">${row.strike.toLocaleString()}</span>
                        <span
                          className={`text-[10px] tabular-nums ${
                            isExactSelected || isInRange ? 'text-white/90' : 'text-slate-400'
                          }`}
                        >
                          {inBand && activeMult > 0
                            ? `${activeMult.toFixed(1)}x`
                            : `${Math.round(activeProb * 100)}c`}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Column 3: Order Ticket (ABOVE | RANGE | BELOW, Expiry, Purchase, Session) */}
            <div className="panel-carbon rounded-lg border border-[#2D374B] p-3.5 space-y-3 h-fit">
              {/* ABOVE / RANGE / BELOW */}
              <div className="grid grid-cols-3 gap-1 rounded-lg bg-[#000000] p-1 border border-[#2D374B]">
                {(
                  [
                    { id: 'up', label: 'ABOVE' },
                    { id: 'range', label: 'RANGE' },
                    { id: 'down', label: 'BELOW' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setSide(tab.id)}
                    className={`py-1.5 rounded text-xs font-bold transition-all border ${
                      side === tab.id
                        ? 'bg-[#2B7FFF]/22 border-[#2B7FFF]/60 text-white'
                        : 'border-transparent text-slate-400 hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Expiry Selector inside Ticket (Matching DeepBook Screenshot 2) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Expiry</span>
                  {selectedMarket && (
                    <span className="font-mono text-slate-300 inline-flex items-center gap-1">
                      <Clock className="w-3 h-3 text-[#60A5FA]" />
                      {formatCountdown(Math.max(0, Number(selectedMarket.market.expiryMs) - nowMs))}
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(board?.markets || []).slice(0, 6).map((item) => {
                    const isSelected = selectedMarket?.market.id === item.market.id;
                    return (
                      <button
                        key={item.market.id}
                        type="button"
                        onClick={() => setSelectedMarketId(item.market.id)}
                        className={`px-2 py-1 rounded text-[11px] font-mono border transition-all ${
                          isSelected
                            ? 'bg-[#2B7FFF]/20 border-[#2B7FFF] text-white font-bold'
                            : 'bg-[#000000] border-[#2D374B] text-slate-400 hover:text-white'
                        }`}
                      >
                        {formatExpiryChip(item, nowMs)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Selected Strike / Range */}
              {side !== 'range' ? (
                <div className="rounded-lg bg-[#000000] border border-[#2D374B] focus-within:border-[#2B7FFF]/60 p-2.5 space-y-1.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">
                      Wins if BTC {side === 'up' ? '>' : '<='} ${parsedStrike.toLocaleString()}
                    </span>
                    <button
                      type="button"
                      onClick={handleBestOtmStrike}
                      className="text-[#60A5FA] hover:underline font-semibold"
                    >
                      Best OTM
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleStepStrike(-1)}
                      className="px-2 py-1 rounded bg-[#0C0E13] border border-[#2D374B] text-slate-300 hover:text-white text-xs font-mono"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      value={strikeInput}
                      onChange={(e) => setStrikeInput(e.target.value)}
                      className="w-full bg-transparent text-white font-mono font-bold text-sm focus:outline-none text-center tabular-nums"
                      placeholder="68700"
                    />
                    <button
                      type="button"
                      onClick={() => handleStepStrike(1)}
                      className="px-2 py-1 rounded bg-[#0C0E13] border border-[#2D374B] text-slate-300 hover:text-white text-xs font-mono"
                    >
                      +
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-[#000000] border border-[#2D374B] p-2 space-y-1">
                    <span className="text-[10px] text-slate-400">Lower ($)</span>
                    <input
                      type="number"
                      value={lowerStrikeInput}
                      onChange={(e) => setLowerStrikeInput(e.target.value)}
                      className="w-full bg-transparent text-white font-mono font-bold text-sm focus:outline-none"
                    />
                  </div>
                  <div className="rounded-lg bg-[#000000] border border-[#2D374B] p-2 space-y-1">
                    <span className="text-[10px] text-slate-400">Upper ($)</span>
                    <input
                      type="number"
                      value={upperStrikeInput}
                      onChange={(e) => setUpperStrikeInput(e.target.value)}
                      className="w-full bg-transparent text-white font-mono font-bold text-sm focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Trade Balance */}
              <div className="flex items-center justify-between text-xs px-0.5">
                <span className="text-slate-400">Trade Balance (Vault)</span>
                <span className="font-mono font-semibold text-white">
                  ${availableUsdc.toFixed(2)}
                </span>
              </div>

              {/* Purchase Amount */}
              <div className="rounded-lg bg-[#000000] border border-[#2D374B] focus-within:border-[#2B7FFF]/60 p-2.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Purchase</span>
                  <span className="text-slate-500 font-mono text-[11px]">
                    Wallet: ${walletUsdc.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400 font-mono font-bold text-lg">$</span>
                  <input
                    type="number"
                    min="1"
                    step="0.5"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value)}
                    className="w-full bg-transparent text-white font-mono font-bold text-lg focus:outline-none tabular-nums"
                    placeholder="5"
                  />
                </div>
                <div className="grid grid-cols-4 gap-1">
                  {['5', '10', '25', '50'].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setAmountInput(v)}
                      className={`py-1 rounded text-[11px] font-mono border transition-colors ${
                        amountInput === v
                          ? 'bg-[#2B7FFF]/20 border-[#2B7FFF]/60 text-white font-bold'
                          : 'bg-[#0C0E13] border-[#2D374B] text-slate-400 hover:text-white'
                      }`}
                    >
                      ${v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quote Summary */}
              <div className="space-y-1.5 text-xs px-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Payout Multiple</span>
                  <span className="font-mono font-semibold text-white">
                    {isQuoting
                      ? '...'
                      : quotePlan
                        ? `${quotePlan.payoutMultiple.toFixed(2)}x`
                        : '-'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Potential Payout</span>
                  <span className="font-mono font-bold text-[#08D189]">
                    {quotePlan ? `$${quotePlan.potentialPayout.toFixed(2)}` : '-'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Max Slippage</span>
                  <div className="flex items-center gap-1">
                    {(['auto', 2, 5] as const).map((s) => (
                      <button
                        key={String(s)}
                        type="button"
                        onClick={() => setSlippageCents(s)}
                        className={`px-1.5 py-0.5 rounded font-mono text-[10px] border ${
                          slippageCents === s
                            ? 'bg-[#2B7FFF]/20 border-[#2B7FFF]/60 text-[#60A5FA]'
                            : 'border-[#2D374B] text-slate-400 hover:text-white'
                        }`}
                      >
                        {s === 'auto' ? 'Auto' : `${s}c`}
                      </button>
                    ))}
                  </div>
                </div>
                {shortfallUsd > 0 && (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">1-Tx Wallet Top-up</span>
                    <span className="font-mono text-[#60A5FA]">
                      +${shortfallUsd.toFixed(2)} USDC
                    </span>
                  </div>
                )}
              </div>

              {quoteError && (
                <div className="rounded-lg bg-[#F0525E]/10 border border-[#F0525E]/35 px-2.5 py-1.5 text-[11px] text-[#F0525E] flex items-start gap-2">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{quoteError}</span>
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
                className="w-full py-2.5 rounded-lg btn-deepbook font-bold text-xs uppercase tracking-wide transition-all flex items-center justify-center gap-2 disabled:opacity-45 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Submitting...</span>
                  </>
                ) : !account ? (
                  <span>Connect Sui Wallet</span>
                ) : !canSubmitPredict && quotePlan ? (
                  <span>CONTRACT PRICE OUTSIDE BAND ({quotePlan.refusal || 'LIMITS'})</span>
                ) : shortfallUsd > walletUsdc + 0.0001 ? (
                  <span>INSUFFICIENT USDC BALANCE</span>
                ) : sessionStatus?.isActiveNow &&
                  shortfallUsd <= 0.0001 &&
                  (sessionStatus?.sessionGasSui ?? 0) >= 0.005 ? (
                  <>
                    <Zap className="w-3.5 h-3.5" />
                    <span>
                      1-Click {side === 'up' ? 'ABOVE' : side === 'down' ? 'BELOW' : 'RANGE'} ($
                      {parsedAmount.toFixed(2)})
                    </span>
                  </>
                ) : (
                  <span>
                    Place {side === 'up' ? 'ABOVE' : side === 'down' ? 'BELOW' : 'RANGE'} ($
                    {parsedAmount.toFixed(2)})
                  </span>
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

              <div className="rounded-lg bg-[#000000] border border-[#2D374B] px-2.5 py-1.5 text-[10px] text-slate-400 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5">
                  <CheckCircle2 className="w-3 h-3 text-[#08D189]" />
                  {board?.protocol.builderFeeCutoverActive && board?.protocol.builderCodeExists
                    ? `Volt BuilderCode (${PREDICT_BUILDER_FEE_PCT}%)`
                    : board?.protocol.referrerWrapperExists
                      ? `DeepBook Referrer (${board.protocol.referralFeeRatePct.toFixed(0)}%)`
                      : `DeepBook Predict v${board?.protocol.versionWatermark || 4}`}
                </span>
                <span className="font-mono text-slate-500">1-Tx Auto</span>
              </div>
            </div>
          </div>
        </>
      )}

      <AiCopilotModal
        isOpen={isAiCopilotOpen}
        initialTab="predict"
        onClose={() => setIsAiCopilotOpen(false)}
        defaultCandles={btcCandles}
        onNotify={onNotify}
        onDeployed={loadBoard}
      />

      {/* Predict Vault Deposit / Withdraw Modal */}
      {vaultModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="panel-carbon w-full max-w-sm rounded-xl p-5 space-y-4 border border-[#38445B] animate-panel-in">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white">
                {vaultModal === 'deposit' ? 'Deposit USDC to Predict' : 'Withdraw Predict USDC'}
              </h3>
              <button
                type="button"
                onClick={() => setVaultModal(null)}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="panel-carbon-sub rounded-xl p-3 space-y-2">
              <div className="flex justify-between text-xs text-slate-300 font-mono">
                <span>{vaultModal === 'deposit' ? 'Wallet USDC' : 'Available Predict Vault'}</span>
                <button
                  type="button"
                  onClick={() =>
                    setVaultAmt(
                      (vaultModal === 'deposit' ? walletUsdc : availableUsdc).toFixed(2)
                    )
                  }
                  className="inline-flex items-center gap-1 text-[#60A5FA] hover:underline"
                >
                  <Wallet className="w-3 h-3" />
                  MAX {(vaultModal === 'deposit' ? walletUsdc : availableUsdc).toFixed(2)} USDC
                </button>
              </div>
              <input
                type="number"
                step="any"
                min="0"
                value={vaultAmt}
                onChange={(e) => setVaultAmt(e.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent text-2xl font-mono font-bold text-white outline-none"
              />
            </div>
            <button
              type="button"
              disabled={isDepositing || isWithdrawing || !(Number(vaultAmt) > 0)}
              onClick={() =>
                vaultModal === 'deposit'
                  ? handleDepositUsdc(Number(vaultAmt))
                  : handleWithdrawAvailable(Number(vaultAmt))
              }
              className="w-full py-2.5 rounded-xl btn-deepbook font-bold text-sm inline-flex items-center justify-center gap-2 disabled:opacity-45"
            >
              {(isDepositing || isWithdrawing) && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>
                {vaultModal === 'deposit'
                  ? board?.account?.hasAccount
                    ? 'Deposit to Predict Vault'
                    : 'Create Vault & Deposit'
                  : 'Withdraw to Wallet'}
              </span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
