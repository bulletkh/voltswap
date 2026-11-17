"use client";

import { useEffect, useRef, useState } from "react";
import { TOKENS, type Token } from "@/lib/tokens";

const SYMBOLS = ["SUI", "CETUS", "DEEP", "WAL", "WBTC", "suiETH", "wSOL", "NAVX", "SEND", "HAEDAL", "NS", "SCA", "BLUE", "IKA", "MMT", "TURBOS"];
const LIST: Token[] = SYMBOLS.map((s) => TOKENS.find((t) => t.symbol === s)).filter((t): t is Token => Boolean(t));
const key = (t: Token) => `sui:${t.type}`;
const REFRESH_MS = 30_000;

type Row = { token: Token; price: number; change: number | null; flash: "up" | "down" | null };

function fmt(v: number) {
  if (v >= 1000) return "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (v >= 1) return "$" + v.toFixed(2);
  if (v >= 0.01) return "$" + v.toFixed(4);
  return "$" + v.toPrecision(3);
}

export function Ticker() {
  const [rows, setRows] = useState<Row[]>([]);
  const last = useRef<Record<string, number>>({});

  useEffect(() => {
    let alive = true;
    const run = async () => {
      const ids = LIST.map(key).map(encodeURIComponent).join(",");
      try {
        const [p, c] = await Promise.all([
          fetch(`https://coins.llama.fi/prices/current/${ids}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error("prices")))),
          fetch(`https://coins.llama.fi/percentage/${ids}?period=24h`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]);
        if (!alive) return;
        const next: Row[] = [];
        for (const token of LIST) {
          const price = p?.coins?.[key(token)]?.price;
          if (typeof price !== "number") continue;
          const ch = c?.coins?.[key(token)];
          const prev = last.current[token.type];
          last.current[token.type] = price;
          next.push({
            token,
            price,
            change: typeof ch === "number" ? ch : null,
            flash: prev === undefined || prev === price ? null : price > prev ? "up" : "down",
          });
        }
        setRows(next);
      } catch {
        /* keep the previous tape */
      }
    };
    void run();
    const t = setInterval(run, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (rows.length === 0) return <div className="tape tape-ph" aria-hidden="true" />;

  const pick = (symbol: string) => window.dispatchEvent(new CustomEvent("vs:pick", { detail: { symbol } }));
  const items = (hidden: boolean) =>
    rows.map((r) => (
      <button
        key={(hidden ? "b" : "a") + r.token.type}
        type="button"
        className={"tape-item" + (r.flash ? " flash-" + r.flash : "")}
        onClick={() => pick(r.token.symbol)}
        tabIndex={hidden ? -1 : 0}
        aria-hidden={hidden || undefined}
        title={`Buy ${r.token.symbol} with USDC`}
      >
        <span className="tape-sym">{r.token.symbol}</span>
        <span className="tape-price">{fmt(r.price)}</span>
        {r.change !== null && (
          <span className={"tape-chg " + (r.change >= 0 ? "up" : "down")}>
            {r.change >= 0 ? "▲" : "▼"} {Math.abs(r.change).toFixed(2)}%
          </span>
        )}
      </button>
    ));

  return (
    <div className="tape" role="region" aria-label="Token prices. Click a token to buy it with USDC.">
      <div className="tape-track">
        {items(false)}
        {items(true)}
      </div>
    </div>
  );
}
