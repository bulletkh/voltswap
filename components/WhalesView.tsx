"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  const [tab, setTab] = useState<"feed" | "top">("feed");
  const [fToken, setFToken] = useState("");
  const [fDex, setFDex] = useState("");
  const [fWallet, setFWallet] = useState("");
  const [alertAt, setAlertAt] = useState<number>(0); // 0 = off
  const seen = useRef<Set<string> | null>(null);

  // shareable filters: /whales?token=DEEP&dex=Cetus&wallet=0x…
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setFToken(q.get("token") ?? "");
    setFDex(q.get("dex") ?? "");
    setFWallet(q.get("wallet") ?? "");
  }, []);
  useEffect(() => {
    const q = new URLSearchParams();
    if (fToken) q.set("token", fToken);
    if (fDex) q.set("dex", fDex);
    if (fWallet) q.set("wallet", fWallet);
    const qs = q.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [fToken, fDex, fWallet]);

  useEffect(() => {
    try {
      const v = Number(window.localStorage.getItem("voltswap:alert-usd"));
      if (v > 0 && "Notification" in window && Notification.permission === "granted") setAlertAt(v);
    } catch {
      /* storage unavailable */
    }
  }, []);

  async function setAlert(v: number) {
    if (v > 0) {
      if (!("Notification" in window)) return;
      const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      if (perm !== "granted") return;
    }
    setAlertAt(v);
    try {
      window.localStorage.setItem("voltswap:alert-usd", String(v));
    } catch {
      /* ignore */
    }
  }

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

  useEffect(() => {
    if (!items) return;
    if (seen.current === null) {
      seen.current = new Set(items.map((w) => w.id));
      return;
    }
    for (const w of items) {
      if (seen.current.has(w.id)) continue;
      seen.current.add(w.id);
      if (alertAt > 0 && w.usd >= alertAt && "Notification" in window && Notification.permission === "granted") {
        try {
          new Notification(`Whale swap ${usd(w.usd)}`, { body: `${w.inSym} → ${w.outSym} on ${w.dex}` });
        } catch {
          /* notifications blocked */
        }
      }
    }
  }, [items, alertAt]);

  const filtered = useMemo(
    () =>
      (items ?? []).filter(
        (w) =>
          w.usd >= min &&
          (!fToken || w.inSym === fToken || w.outSym === fToken) &&
          (!fDex || w.dex === fDex) &&
          (!fWallet || w.sender === fWallet),
      ),
    [items, min, fToken, fDex, fWallet],
  );
  const shown = useMemo(() => group([...filtered].sort((a, b) => b.t - a.t)), [filtered]);

  const top = useMemo(() => {
    const m = new Map<string, { total: number; n: number }>();
    for (const w of filtered) {
      if (!w.sender) continue;
      const c = m.get(w.sender) ?? { total: 0, n: 0 };
      c.total += w.usd;
      c.n += 1;
      m.set(w.sender, c);
    }
    return [...m.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 10);
  }, [filtered]);

  const tokenOpts = useMemo(() => [...new Set((items ?? []).flatMap((w) => [w.inSym, w.outSym]))].sort(), [items]);
  const dexOpts = useMemo(() => [...new Set((items ?? []).map((w) => w.dex))].sort(), [items]);

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

      <div className="wh-tools">
        <select value={fToken} onChange={(e) => setFToken(e.target.value)} aria-label="Filter by token">
          <option value="">All tokens</option>
          {tokenOpts.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select value={fDex} onChange={(e) => setFDex(e.target.value)} aria-label="Filter by exchange">
          <option value="">All exchanges</option>
          {dexOpts.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select
          value={alertAt}
          onChange={(e) => void setAlert(Number(e.target.value))}
          aria-label="Browser alerts for swaps above"
        >
          <option value={0}>Alerts off</option>
          {[10_000, 25_000, 50_000, 100_000].map((v) => (
            <option key={v} value={v}>
              Alert ≥ {usd(v)}
            </option>
          ))}
        </select>
      </div>
      {fWallet && (
        <p className="pf-note">
          Wallet {short(fWallet)}{" "}
          <button type="button" className="linklike" onClick={() => setFWallet("")}>
            clear
          </button>
        </p>
      )}
      <div className="wh-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "feed"} className={"chip" + (tab === "feed" ? " on" : "")} onClick={() => setTab("feed")}>
          Live feed
        </button>
        <button type="button" role="tab" aria-selected={tab === "top"} className={"chip" + (tab === "top" ? " on" : "")} onClick={() => setTab("top")}>
          Top wallets
        </button>
      </div>

      {tab === "top" && (
        <ul className="pf-list">
          {top.map(([addr, v]) => (
            <li key={addr}>
              <div className="pf-name">
                <strong>{short(addr)}</strong>
                <span>{v.n} swap{v.n > 1 ? "s" : ""} in the last hour</span>
              </div>
              <div className="pf-val">
                <strong>{usd(v.total)}</strong>
                <span>
                  <button type="button" className="linklike" onClick={() => { setFWallet(addr); setTab("feed"); }}>
                    show swaps
                  </button>
                </span>
              </div>
            </li>
          ))}
          {top.length === 0 && <li><p className="pf-note">No wallets match the current filters.</p></li>}
        </ul>
      )}

      {items === null && !error && <p className="pf-note">Loading recent swaps…</p>}
      {error && <p className="pf-note pf-err">Could not load swaps right now. It will retry automatically.</p>}
      {items !== null && shown.length === 0 && !error && (
        <p className="pf-note">No swaps this large in the last hour. New ones appear here as they happen.</p>
      )}

      <ul className="pf-list" hidden={tab !== "feed"}>
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
                    <button type="button" className="linklike" onClick={() => setFWallet(w.sender!)} title="Show only this wallet">
                      {short(w.sender)}
                    </button>
                    {" "}
                    <a href={`https://suiscan.xyz/mainnet/account/${w.sender}`} target="_blank" rel="noopener noreferrer" aria-label="Open wallet on Suiscan">
                      ↗
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
        last hour, and only while the page is open does it update every few seconds. Browser alerts work only while this tab stays open. Swaps through other exchanges, and
        tokens without reliable prices, are not shown. Wallet addresses are public on-chain information; a large
        trade says nothing about what the trader will do next. Not financial advice.
      </p>
    </section>
  );
}
