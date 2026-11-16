"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Transaction } from "@mysten/sui/transactions";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import { AggregatorClient, Env } from "@cetusprotocol/aggregator-sdk";
import { useCurrentAccount, useCurrentClient, useDAppKit } from "@mysten/dapp-kit-react";
import { SUI_TYPE, TOKENS, loadCustomTokens, saveCustomTokens, type Token } from "@/lib/tokens";
import { formatUsd, getUsdPrice } from "@/lib/price";
import { TokenPicker } from "./TokenPicker";
import { fromBaseUnits, toBaseUnits } from "@/lib/format";
import { DEFAULT_SLIPPAGE, EXPLORER_TX, FEE_ENABLED, FEE_RATE, FEE_RECEIVER } from "@/lib/config";

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

  useEffect(() => setCustom(loadCustomTokens()), []);
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

  const aggregator = useMemo(
    () =>
      new AggregatorClient({
        env: Env.Mainnet,
        client: client as unknown as SuiGrpcClient,
        signer: account?.address ?? ZERO_ADDRESS,
        ...(FEE_ENABLED ? { overlayFeeRate: FEE_RATE, overlayFeeReceiver: FEE_RECEIVER } : {}),
      }),
    [client, account?.address],
  );

  // Отдельный клиент без комиссии — только для оценки цены в долларах
  const priceAgg = useMemo(
    () => new AggregatorClient({ env: Env.Mainnet, client: client as unknown as SuiGrpcClient, signer: ZERO_ADDRESS }),
    [client],
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

  const amountIn = toBaseUnits(amount, from.decimals);

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
    const timer = setTimeout(async () => {
      try {
        const r = await aggregator.findRouters({
          from: from.type,
          target: to.type,
          amount: amountIn.toString(),
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
  }, [amount, from.type, to.type, aggregator]);

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
    if (!quote || !account) return;
    setStatus({ kind: "signing" });
    try {
      const txb = new Transaction();
      await aggregator.fastRouterSwap({ router: quote, txb, slippage });
      const result = await dAppKit.signAndExecuteTransaction({ transaction: txb });
      if (result.$kind === "FailedTransaction") {
        throw new Error("The transaction failed on-chain. No funds were swapped.");
      }
      setStatus({ kind: "done", digest: result.Transaction.digest });
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
    <section className="card" aria-label="Swap">
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
              <dd>{(FEE_RATE * 100).toFixed(2).replace(/\.?0+$/, "")}%</dd>
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
          Swap complete.{" "}
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
