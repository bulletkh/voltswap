"use client";

import { useEffect, useState } from "react";
import type { Token } from "@/lib/tokens";
import type { Whale } from "@/lib/whales";
import { TokenIcon } from "./TokenIcon";

type Pt = { t: number; p: number };

function fmtPrice(p: number) {
  if (p >= 100) return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (p >= 1) return "$" + p.toFixed(3);
  return "$" + p.toPrecision(3);
}
const usd = (v: number) => "$" + Math.round(v).toLocaleString("en-US");

function Chart({ pts }: { pts: Pt[] }) {
  const W = 600;
  const H = 160;
  const ps = pts.map((x) => x.p);
  const lo = Math.min(...ps);
  const hi = Math.max(...ps);
  const span = hi - lo || 1;
  const d = pts
    .map((x, i) => `${i ? "L" : "M"}${((i / (pts.length - 1)) * W).toFixed(1)},${(H - 6 - ((x.p - lo) / span) * (H - 12)).toFixed(1)}`)
    .join(" ");
  const up = ps[ps.length - 1] >= ps[0];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="tk-chart" role="img" aria-label="Price over the last 30 days">
      <path d={d} fill="none" stroke={up ? "#12805c" : "#b3261e"} strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function TokenView({ token }: { token: Token }) {
  const id = `sui:${token.type}`;
  const [price, setPrice] = useState<number | null | undefined>(undefined);
  const [chg, setChg] = useState<number | null>(null);
  const [pts, setPts] = useState<Pt[] | null>(null);
  const [whales, setWhales] = useState<Whale[] | null>(null);

  useEffect(() => {
    let alive = true;
    const enc = encodeURIComponent(id);
    fetch(`https://coins.llama.fi/prices/current/${enc}`)
      .then((r) => r.json())
      .then((j) => alive && setPrice(j?.coins?.[id]?.price ?? null))
      .catch(() => alive && setPrice(null));
    fetch(`https://coins.llama.fi/percentage/${enc}?period=24h`)
      .then((r) => r.json())
      .then((j) => alive && setChg(typeof j?.coins?.[id] === "number" ? j.coins[id] : null))
      .catch(() => {});
    fetch(`https://coins.llama.fi/chart/${enc}?span=30&period=1d`)
      .then((r) => r.json())
      .then((j) => {
        const arr = j?.coins?.[id]?.prices as { timestamp: number; price: number }[] | undefined;
        if (alive && arr && arr.length > 2) setPts(arr.map((x) => ({ t: x.timestamp, p: x.price })));
      })
      .catch(() => {});
    fetch("/api/whales")
      .then((r) => r.json())
      .then((j) => alive && setWhales((j.items as Whale[]).filter((w) => w.inSym === token.symbol || w.outSym === token.symbol)))
      .catch(() => alive && setWhales([]));
    return () => {
      alive = false;
    };
  }, [id, token.symbol]);

  return (
    <section className="card pf" aria-label={`${token.name} price`}>
      <div className="tk-head">
        <TokenIcon token={token} size={40} />
        <div>
          <h1 className="page-title tk-title">
            {token.name} <span>{token.symbol}</span>
          </h1>
          <div className="tk-price">
            {price === undefined ? "…" : price === null ? "Price unavailable" : fmtPrice(price)}
            {chg !== null && (
              <span className={chg >= 0 ? "mk-up" : "mk-down"}>
                {" "}
                {chg >= 0 ? "+" : ""}
                {chg.toFixed(2)}% 24h
              </span>
            )}
          </div>
        </div>
        <a className="mk-swap tk-swap" href={`/?${token.symbol === "SUI" ? "to=USDC&from=SUI" : `to=${token.symbol}&from=SUI`}`}>
          Buy
        </a>
        <a className="mk-swap" href={`/?from=${token.symbol}&to=${token.symbol === "USDC" ? "SUI" : "USDC"}`}>
          Sell
        </a>
      </div>

      {pts && <Chart pts={pts} />}
      {pts && <p className="pf-note">Last 30 days, daily prices.</p>}

      <h2 className="tk-sub">Large swaps in the last hour</h2>
      {whales === null && <p className="pf-note">Loading…</p>}
      {whales !== null && whales.length === 0 && <p className="pf-note">No large swaps with {token.symbol} in the last hour.</p>}
      <ul className="pf-list">
        {(whales ?? []).slice(0, 10).map((w) => (
          <li key={w.id}>
            <div className="pf-name">
              <strong>
                {w.inSym} → {w.outSym}
              </strong>
              <span>{w.dex}</span>
            </div>
            <div className="pf-val">
              <strong>{usd(w.usd)}</strong>
              <span>
                <a href={`https://suiscan.xyz/mainnet/tx/${w.digest}`} target="_blank" rel="noopener noreferrer">
                  tx
                </a>
              </span>
            </div>
          </li>
        ))}
      </ul>
      <p className="pf-note">
        <a href={`/whales?token=${token.symbol}`}>See all {token.symbol} swaps on the radar →</a>
      </p>
      <p className="pf-note">Prices from DeFiLlama. Informational only, not financial advice.</p>
    </section>
  );
}
