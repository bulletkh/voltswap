"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import { AggregatorClient, Env } from "@cetusprotocol/aggregator-sdk";
import { useCurrentAccount, useCurrentClient, useDAppKit } from "@mysten/dapp-kit-react";
import { SUI_TYPE, TOKENS, loadCustomTokens, saveCustomTokens, type Token } from "@/lib/tokens";
import { formatUsd, getUsdPrice } from "@/lib/price";
import { TokenPicker } from "./TokenPicker";
import { fromBaseUnits, toBaseUnits } from "@/lib/format";
import { DEFAULT_SLIPPAGE, EXPLORER_TX, FEE_ENABLED, FEE_RATE, FEE_RECEIVER } from "@/lib/config";
import {
  VOLUME_EVENT,
  addOptimisticVolume,
  captureReferralFromUrl,
  effectiveSwapFeeRate,
  formatFeePct,
  getOptimisticVolume,
  getValidReferrerForSender,
  resolveTraderTier,
  syncOptimisticVolume,
} from "@/lib/ranks";
import type { RefCheck, RanksPayload } from "@/lib/owner";

const ZERO_ADDRESS = "0x" + "0".repeat(64);
const SLIPPAGE_OPTIONS = [0.003, 0.005, 0.01];
const GAS_RESERVE_SUI = 50_000_000n; // 0.05 SUI оставляем на газ при "Max"

type Quote = NonNullable<Awaited<ReturnType<AggregatorClient["findRouters"]>>>;
type Status =
  | { kind: "idle" }
  | { kind: "signing" }
  | { kind: "done"; digest: string }
  | { kind: "error"; message: string };

function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel/i.test(m)) return "Transaction was cancelled in the wallet.";
  return m.length > 220 ? m.slice(0, 220) + "…" : m;
}

function Celebrate() {
  return (
    <div className="burst" aria-hidden="true">
      <i className="burst-flash" />
      <i className="burst-ring" />
      <i className="burst-ring r2" />
      <svg className="burst-bolt" viewBox="0 0 24 24">
        <path d="M13.5 2 5 13.5h6L10 22l9-12.5h-6.2L13.5 2Z" />
      </svg>
      {Array.from({ length: 20 }, (_, i) => (
        <b key={i} className="spark" style={{ "--a": `${i * 18}deg`, "--d": `${150 + ((i * 37) % 70)}px`, "--i": i } as React.CSSProperties} />
      ))}
    </div>
  );
}

export function SwapCard() {
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const dAppKit = useDAppKit();

  const [from, setFrom] = useState<Token>(TOKENS[0]);
  const [to, setTo] = useState<Token>(TOKENS[1]);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState(DEFAULT_SLIPPAGE);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const requestId = useRef(0);
  const [custom, setCustom] = useState<Token[]>([]);
  const [prices, setPrices] = useState<Record<string, number | null>>({});
  const [walletVol, setWalletVol] = useState(0);
  const [storedRef, setStoredRef] = useState<string | null>(null);
  const [refInfo, setRefInfo] = useState<RefCheck | null>(null);

  useEffect(() => {
    setCustom(loadCustomTokens());
    captureReferralFromUrl();
    setStoredRef(getValidReferrerForSender(account?.address, FEE_RECEIVER));
  }, [account?.address]);

  useEffect(() => {
    const addr = account?.address;
    setWalletVol(getOptimisticVolume(addr));
    const onVol = () => setWalletVol(getOptimisticVolume(addr));
    window.addEventListener(VOLUME_EVENT, onVol);
    return () => window.removeEventListener(VOLUME_EVENT, onVol);
  }, [account?.address]);

  useEffect(() => {
    const addr = account?.address ?? null;
    const ref = getValidReferrerForSender(addr, FEE_RECEIVER);
    setStoredRef(ref);
    if (!addr && !ref) {
      setRefInfo(null);
      return;
    }
    let alive = true;
    const qs = new URLSearchParams();
    if (addr) qs.set("wallet", addr);
    if (ref) qs.set("ref", ref);
    void fetch(`/api/ranks?${qs.toString()}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: RanksPayload | null) => {
        if (!alive || !d) return;
        if (addr && d.wallet) {
          setWalletVol(syncOptimisticVolume(addr, d.wallet.volume));
        }
        setRefInfo(d.referrer ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [account?.address]);

  const activeRef = useMemo(
    () => (storedRef && refInfo && refInfo.address === storedRef && refInfo.active && refInfo.revSharePct > 0 ? refInfo : null),
    [storedRef, refInfo],
  );
  const traderTier = useMemo(() => resolveTraderTier(walletVol, Boolean(activeRef)), [walletVol, activeRef]);
  const effectiveFee = useMemo(
    () => (FEE_ENABLED ? effectiveSwapFeeRate(FEE_RATE, traderTier) : 0),
    [traderTier],
  );
  const [win, setWin] = useState(0);

  // the price tape asks for a token: buy it with USDC
  useEffect(() => {
    const on = (e: Event) => {
      const sym = (e as CustomEvent<{ symbol: string }>).detail?.symbol;
      const t = TOKENS.find((x) => x.symbol === sym);
      const usdc = TOKENS.find((x) => x.symbol === "USDC");
      if (!t || !usdc || t.type === usdc.type) return;
      setFrom(usdc);
      setTo(t);
      setAmount("");
    };
    const celebrate = () => setWin(Date.now());
    window.addEventListener("vs:pick", on);
    window.addEventListener("vs:celebrate", celebrate);
    return () => {
      window.removeEventListener("vs:pick", on);
      window.removeEventListener("vs:celebrate", celebrate);
    };
  }, []);
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("vs:pair", { detail: { from: from.symbol, fromType: from.type, to: to.symbol, toType: to.type } }),
    );
  }, [from, to]);
  useEffect(() => {
    if (!win) return;
    const t = setTimeout(() => setWin(0), 2600);
    return () => clearTimeout(t);
  }, [win]);

  // ?from=SUI&to=USDC (by symbol) preselects a pair, e.g. links from token pages
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const find = (v: string | null) => (v ? TOKENS.find((t) => t.symbol.toLowerCase() === v.toLowerCase()) : undefined);
      const f = find(q.get("from"));
      const t = find(q.get("to"));
      if (f && t && f.type !== t.type) {
        setFrom(f);
        setTo(t);
      } else if (f && !t) {
        setFrom(f);
        if (f.type === TOKENS[1].type) setTo(TOKENS[0]);
      } else if (t && !f) {
        setTo(t);
        if (t.type === TOKENS[0].type) setFrom(TOKENS[1]);
      }
    } catch {
      /* ignore malformed query */
    }
  }, []);
  const tokens = useMemo(
    () => [...TOKENS, ...custom.filter((c) => !TOKENS.some((t) => t.type === c.type))],
    [custom],
  );
  function importToken(t: Token) {
    setCustom((prev) => {
      if (prev.some((x) => x.type === t.type) || TOKENS.some((x) => x.type === t.type)) return prev;
      const next = [...prev, { ...t, custom: true }];
      saveCustomTokens(next);
      return next;
    });
  }

  const amountIn = toBaseUnits(amount, from.decimals);

  // Atomic PTB fee split when an active partner referral link is present
  const refSplit = useMemo(() => {
    if (!amountIn || !FEE_ENABLED || effectiveFee <= 0 || !activeRef) return null;
    const ppm = BigInt(Math.round(effectiveFee * 1_000_000));
    const totalFee = (amountIn * ppm) / 1_000_000n;
    const refUnits = (totalFee * BigInt(Math.round(activeRef.revSharePct * 1000))) / 1000n;
    const treasuryUnits = totalFee - refUnits;
    const netIn = amountIn - totalFee;
    if (totalFee <= 0n || refUnits <= 0n || treasuryUnits <= 0n || netIn <= 0n) return null;
    return {
      referrer: activeRef.address,
      totalFee,
      refUnits,
      treasuryUnits,
      netIn,
    };
  }, [amountIn, effectiveFee, activeRef]);

  const aggregator = useMemo(
    () =>
      new AggregatorClient({
        env: Env.Mainnet,
        client: client as unknown as SuiGrpcClient,
        signer: account?.address ?? ZERO_ADDRESS,
        ...(FEE_ENABLED && effectiveFee > 0 && !refSplit
          ? { overlayFeeRate: effectiveFee, overlayFeeReceiver: FEE_RECEIVER }
          : {}),
      }),
    [client, account?.address, effectiveFee, refSplit],
  );

  // Отдельный клиент без комиссии — для оценки цены в долларах и маршрутов с ручным PTB-сплитом
  const priceAgg = useMemo(
    () =>
      new AggregatorClient({
        env: Env.Mainnet,
        client: client as unknown as SuiGrpcClient,
        signer: account?.address ?? ZERO_ADDRESS,
      }),
    [client, account?.address],
  );
  useEffect(() => {
    let alive = true;
    for (const t of [from, to]) {
      void getUsdPrice(priceAgg, t).then((v) => {
        if (alive) setPrices((p) => (p[t.type] === v ? p : { ...p, [t.type]: v }));
      });
    }
    return () => {
      alive = false;
    };
  }, [priceAgg, from, to]);

  // Баланс выбранного токена
  const loadBalance = useCallback(async () => {
    if (!account) return setBalance(null);
    try {
      const res = await client.core.getBalance({ owner: account.address, coinType: from.type });
      setBalance(BigInt(res.balance.balance));
    } catch {
      setBalance(null);
    }
  }, [account, client, from.type]);

  useEffect(() => {
    void loadBalance();
  }, [loadBalance]);

  // Котировка с задержкой 400 мс; устаревшие ответы отбрасываем
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    setStatus((s) => (s.kind === "signing" ? s : { kind: "idle" }));
    if (!amountIn || from.type === to.type) {
      setQuoting(false);
      return;
    }
    const id = ++requestId.current;
    setQuoting(true);
    const quoteAmount = refSplit ? refSplit.netIn : amountIn;
    const activeClient = refSplit ? priceAgg : aggregator;
    const timer = setTimeout(async () => {
      try {
        const r = await activeClient.findRouters({
          from: from.type,
          target: to.type,
          amount: quoteAmount.toString(),
          byAmountIn: true,
        });
        if (id !== requestId.current) return;
        if (!r || r.error) setQuoteError("No route found for this pair and amount.");
        else if (r.insufficientLiquidity) setQuoteError("Not enough liquidity for this amount.");
        else setQuote(r);
      } catch (e) {
        if (id === requestId.current) setQuoteError(errorText(e));
      } finally {
        if (id === requestId.current) setQuoting(false);
      }
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, from.type, to.type, aggregator, priceAgg, refSplit]);

  const amountOut = quote ? BigInt(quote.amountOut.toString()) : null;
  const minReceived =
    amountOut !== null
      ? (amountOut * BigInt(Math.round((1 - slippage) * 10_000))) / 10_000n
      : null;
  const providers = quote ? [...new Set(quote.paths.map((p) => String(p.provider)))] : [];
  const deviation = quote?.deviationRatio ?? null;
  const highDeviation = deviation !== null && deviation > 0.03;
  const insufficient = balance !== null && amountIn !== null && amountIn > balance;

  const usd = (t: Token, base: bigint | null) => {
    const price = prices[t.type];
    if (base === null || price === null || price === undefined) return null;
    return formatUsd((Number(base) / 10 ** t.decimals) * price);
  };
  const usdIn = usd(from, amountIn);
  const usdOut = usd(to, amountOut);

  function pickFrom(t: Token) {
    if (t.type === to.type) setTo(from);
    setFrom(t);
  }
  function pickTo(t: Token) {
    if (t.type === from.type) setFrom(to);
    setTo(t);
  }
  function flip() {
    setFrom(to);
    setTo(from);
    setAmount("");
  }
  function setMax() {
    if (balance === null) return;
    const usable =
      from.type === SUI_TYPE ? (balance > GAS_RESERVE_SUI ? balance - GAS_RESERVE_SUI : 0n) : balance;
    setAmount(fromBaseUnits(usable, from.decimals, from.decimals).replaceAll(",", ""));
  }

  async function swap() {
    if (!quote || !account || !amountIn) return;
    setStatus({ kind: "signing" });
    try {
      const txb = new Transaction();
      txb.setSender(account.address);
      if (refSplit) {
        const isSui = from.type === SUI_TYPE || from.type.endsWith("::sui::SUI");
        if (isSui) {
          const [treasuryCoin, refCoin, swapCoin] = txb.splitCoins(txb.gas, [
            refSplit.treasuryUnits,
            refSplit.refUnits,
            refSplit.netIn,
          ]);
          txb.transferObjects([treasuryCoin], FEE_RECEIVER);
          txb.transferObjects([refCoin], refSplit.referrer);
          const outCoin = await priceAgg.routerSwap({
            router: quote,
            inputCoin: swapCoin,
            slippage,
            txb,
          });
          txb.transferObjects([outCoin], account.address);
        } else {
          const sourceCoin = txb.add(
            coinWithBalance({ type: from.type, balance: amountIn }),
          );
          const [treasuryCoin, refCoin] = txb.splitCoins(sourceCoin, [
            refSplit.treasuryUnits,
            refSplit.refUnits,
          ]);
          txb.transferObjects([treasuryCoin], FEE_RECEIVER);
          txb.transferObjects([refCoin], refSplit.referrer);
          const outCoin = await priceAgg.routerSwap({
            router: quote,
            inputCoin: sourceCoin,
            slippage,
            txb,
          });
          txb.transferObjects([outCoin], account.address);
        }
      } else {
        await aggregator.fastRouterSwap({ router: quote, txb, slippage });
      }
      const result = await dAppKit.signAndExecuteTransaction({ transaction: txb });
      if (result.$kind === "FailedTransaction") {
        throw new Error("The transaction failed on-chain. No funds were swapped.");
      }
      // Optimistically update wallet volume so the glowing header rank & $10 partner unlock update right away
      const fromPrice = prices[from.type];
      const toPrice = prices[to.type];
      const deltaUsd =
        fromPrice && fromPrice > 0
          ? (Number(amountIn) / 10 ** from.decimals) * fromPrice
          : toPrice && toPrice > 0 && amountOut
            ? (Number(amountOut) / 10 ** to.decimals) * toPrice
            : 0;
      if (deltaUsd > 0) addOptimisticVolume(account.address, deltaUsd);

      setStatus({ kind: "done", digest: result.Transaction.digest });
      setWin(Date.now());
      void fetch("/api/notify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "swap", digest: result.Transaction.digest }),
      }).catch(() => {});
      setAmount("");
      void loadBalance();
    } catch (e) {
      setStatus({ kind: "error", message: errorText(e) });
    }
  }

  let action: { label: string; disabled: boolean; onClick?: () => void };
  if (!account) action = { label: "Connect a wallet to swap", disabled: true };
  else if (!amountIn) action = { label: "Enter an amount", disabled: true };
  else if (insufficient) action = { label: `Not enough ${from.symbol}`, disabled: true };
  else if (quoting) action = { label: "Finding the best route…", disabled: true };
  else if (!quote) action = { label: "No quote available", disabled: true };
  else if (status.kind === "signing") action = { label: "Confirm in your wallet…", disabled: true };
  else action = { label: highDeviation ? "Swap anyway" : "Swap", disabled: false, onClick: swap };

  return (
    <section className={"card" + (win ? " win" : "")} aria-label="Swap">
      {win ? <Celebrate key={win} /> : null}
      <div className="field">
        <div className="field-head">
          <label htmlFor="amount-in">You pay</label>
          {account && balance !== null && (
            <button type="button" className="linklike" onClick={setMax}>
              Balance {fromBaseUnits(balance, from.decimals, 4)} · Max
            </button>
          )}
        </div>
        <div className="field-body">
          <input
            id="amount-in"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <TokenPicker label="Token to pay with" value={from} tokens={tokens} onPick={pickFrom} onImport={importToken} />
        </div>
        <div className="usd">{usdIn ? `≈ ${usdIn}` : "\u00a0"}</div>
      </div>

      <button type="button" className="flip" onClick={flip} aria-label="Switch tokens">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3" />
        </svg>
      </button>

      <div className="field">
        <div className="field-head">
          <span>You receive</span>
        </div>
        <div className="field-body">
          <output className={amountOut === null ? "out muted" : "out"} aria-live="polite">
            {amountOut !== null ? fromBaseUnits(amountOut, to.decimals, 6) : quoting ? "…" : "0.0"}
          </output>
          <TokenPicker label="Token to receive" value={to} tokens={tokens} onPick={pickTo} onImport={importToken} />
        </div>
        <div className="usd">{usdOut ? `≈ ${usdOut}` : "\u00a0"}</div>
      </div>

      {quote && amountOut !== null && minReceived !== null && (
        <dl className="details">
          <div>
            <dt>Rate</dt>
            <dd>
              1 {from.symbol} ≈{" "}
              {fromBaseUnits(
                (amountOut * 10n ** BigInt(from.decimals)) / (amountIn ?? 1n),
                to.decimals,
                6,
              )}{" "}
              {to.symbol}
            </dd>
          </div>
          <div>
            <dt>Minimum received</dt>
            <dd>
              {fromBaseUnits(minReceived, to.decimals, 6)} {to.symbol}
            </dd>
          </div>
          <div>
            <dt>Route</dt>
            <dd>
              {providers.join(", ")} ({quote.paths.length} {quote.paths.length === 1 ? "path" : "paths"})
            </dd>
          </div>
          {deviation !== null && (
            <div className={highDeviation ? "warn" : undefined}>
              <dt>Price deviation</dt>
              <dd>{(deviation * 100).toFixed(2)}%</dd>
            </div>
          )}
          {FEE_ENABLED && (
            <div>
              <dt>Voltswap fee</dt>
              <dd>
                {formatFeePct(effectiveFee)}
                {traderTier.discountPct > 0 && (
                  <>
                    {" "}
                    <a className="fee-rank-tag" href="/partner" style={{ color: traderTier.color }}>
                      {traderTier.emoji} {traderTier.name} (-{traderTier.discountPct}%)
                    </a>
                  </>
                )}
              </dd>
            </div>
          )}
          {activeRef && (
            <div>
              <dt>Partner link</dt>
              <dd style={{ color: "#34d399" }}>Active · -20% Plankton boost</dd>
            </div>
          )}
        </dl>
      )}

      {(from.custom || to.custom) && (
        <p className="notice warn" role="note">
          {[from, to].filter((t) => t.custom).map((t) => t.symbol).join(" and ")} is not on
          Voltswap&rsquo;s list. Check the coin address before you swap.
        </p>
      )}
      {highDeviation && (
        <p className="notice warn" role="alert">
          This quote is {(deviation! * 100).toFixed(1)}% away from the market price. Check the amount
          and the tokens before you continue.
        </p>
      )}
      {quoteError && (
        <p className="notice" role="alert">
          {quoteError}
        </p>
      )}

      <div className="slippage" role="group" aria-label="Slippage tolerance">
        <span>Slippage</span>
        {SLIPPAGE_OPTIONS.map((s) => (
          <button
            key={s}
            type="button"
            className={s === slippage ? "chip on" : "chip"}
            aria-pressed={s === slippage}
            onClick={() => setSlippage(s)}
          >
            {(s * 100).toFixed(1)}%
          </button>
        ))}
      </div>

      <button type="button" className="cta" disabled={action.disabled} onClick={action.onClick}>
        {action.label}
      </button>

      {status.kind === "done" && (
        <p className="notice ok" role="status">
          <span className="ok-bolt" aria-hidden="true">⚡</span> Swap complete.{" "}
          <a href={EXPLORER_TX + status.digest} target="_blank" rel="noreferrer">
            View on Suiscan
          </a>
        </p>
      )}
      {status.kind === "error" && (
        <p className="notice" role="alert">
          {status.message}
        </p>
      )}
    </section>
  );
}
