"use client";

import { useEffect, useMemo, useState } from "react";
import type { Whale } from "@/lib/whales";

const POLL_MS = 10_000;
const LEVELS = [1_000, 2_000, 3_000, 5_000, 7_500, 10_000, 15_000, 25_000, 50_000, 100_000];
const GROUP_MS = 15 * 60 * 1000;

type Row = Whale & { count: number };

// Fold repeated swaps by the same wallet on the same pair and exchange (bots) into one row.
function group(list: Whale[]): Row[] {
  const out: Row[] = [];
  const open = new Map<string, Row>();
  for (const w of list) {
    const key = `${w.sender ?? w.digest}|${w.dex}|${w.inSym}|${w.outSym}`;
    const cur = open.get(key);
    if (cur && cur.t - w.t <= GROUP_MS) {
      cur.count += 1;
      cur.usd += w.usd;
      cur.inAmt += w.inAmt;
      cur.outAmt += w.outAmt;
            continue;
    }
    const row: Row = { ...w, count: 1 };
    open.set(key, row);
    out.push(row);
  }
  return out;
}

function usd(v: number) {
  return "$" + Math.round(v).toLocaleString("en-US");
}
function amt(v: number) {
  if (!v) return "";
  return v.toLocaleString("en-US", { maximumFractionDigits: v >= 100 ? 0 : v >= 1 ? 2 : 4 });
}
function ago(t: number, now: number) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}
const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);

export function WhalesView() {
  const [items, setItems] = useState<Whale[] | null>(null);
  const [error, setError] = useState(false);
  const [level, setLevel] = useState(0);
  const min = LEVELS[level];
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch("/api/whales", { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const j = (await r.json()) as { items: Whale[]; error: string | null };
        if (!alive) return;
        setItems(j.items);
        setError(Boolean(j.error) && j.items.length === 0);
      } catch {
        if (alive) setError(true);
      }
    };
    void run();
    const a = setInterval(run, POLL_MS);
    const b = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  const shown = useMemo(
    () => group((items ?? []).filter((w) => w.usd >= min).sort((a, b) => b.t - a.t)),
    [items, min],
  );

  return (
    <section className="card pf" aria-label="Whale radar">
      <div className="pf-head">
        <span className="pf-label">Large swaps on Sui</span>
        <label className="wh-filter">
          Min size <strong>{usd(min)}</strong>
          <input
            type="range"
            min={0}
            max={LEVELS.length - 1}
            step={1}
            value={level}
            onChange={(e) => setLevel(Number(e.target.value))}
            aria-label="Minimum swap size in US dollars"
            aria-valuetext={usd(min)}
          />
        </label>
      </div>

      {items === null && !error && <p className="pf-note">Loading recent swaps…</p>}
      {error && <p className="pf-note pf-err">Could not load swaps right now. It will retry automatically.</p>}
      {items !== null && shown.length === 0 && !error && (
        <p className="pf-note">No swaps this large in the last hour. New ones appear here as they happen.</p>
      )}

      <ul className="pf-list">
        {shown.map((w) => (
          <li key={w.id}>
            <div className="pf-name">
              <strong>
                {w.inSym} → {w.outSym}
              </strong>
              <span>
                {w.dex} · {w.count > 1 ? `${w.count} swaps · ` : ""}{amt(w.inAmt)} {w.inSym}
                {w.outAmt ? ` → ${amt(w.outAmt)} ${w.outSym}` : ""}
              </span>
            </div>
            <div className="pf-val">
              <strong>{usd(w.usd)}</strong>
              <span>
                {ago(w.t, now)} ·{" "}
                <a href={`https://suiscan.xyz/mainnet/tx/${w.digest}`} target="_blank" rel="noopener noreferrer">
                  tx
                </a>
                {w.sender && (
                  <>
                    {" "}·{" "}
                    <a href={`https://suiscan.xyz/mainnet/account/${w.sender}`} target="_blank" rel="noopener noreferrer">
                      {short(w.sender)}
                    </a>
                  </>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>

      <p className="pf-note">
        A live feed of large swaps on Cetus, Bluefin, Momentum, Turbos and DeepBook, read from public Sui data and valued at market prices. It covers the
        last hour, and only while the page is open does it update every few seconds. Swaps through other exchanges, and
        tokens without reliable prices, are not shown. Wallet addresses are public on-chain information; a large
        trade says nothing about what the trader will do next. Not financial advice.
      </p>
    </section>
  );
}
