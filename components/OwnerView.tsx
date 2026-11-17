"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { OWNER } from "@/lib/owner-address";
import type { OwnerStats } from "@/lib/owner";

type Range = "d1" | "d7" | "d30" | "all";
const RANGES: [Range, string][] = [["d1", "24h"], ["d7", "7 days"], ["d30", "30 days"], ["all", "All time"]];

const usd = (v: number) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: v < 100 ? 2 : 0, maximumFractionDigits: v < 100 ? 2 : 0 });
const amt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: v >= 100 ? 0 : v >= 1 ? 2 : 6 });
const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
function ago(t: number) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function csv(name: string, rows: (string | number)[][]) {
  const body = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type: "text/csv" }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function OwnerView() {
  const account = useCurrentAccount();
  const address = account?.address?.toLowerCase();
  const isOwner = address === OWNER;
  const [data, setData] = useState<OwnerStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>("d30");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/owner/stats", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? String(r.status));
      setData(j as OwnerStats);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOwner) return;
    void load();
    const t = setInterval(() => !document.hidden && void load(), 60_000);
    return () => clearInterval(t);
  }, [isOwner, load]);

  if (!address) {
    return (
      <section className="card pf">
        <h2 className="ow-gate">Owner cabinet</h2>
        <p className="pf-note">Connect the owner wallet (top right) to open it.</p>
      </section>
    );
  }
  if (!isOwner) {
    return (
      <section className="card pf">
        <h2 className="ow-gate">Owner cabinet</h2>
        <p className="pf-note">This page is only available for the owner wallet.</p>
      </section>
    );
  }

  const p = data?.periods[range];
  const maxFee = data ? Math.max(0.0001, ...data.daily.map((d) => d.fee)) : 1;

  return (
    <div className="ow">
      <div className="ow-top">
        <div className="wh-tabs" role="tablist">
          {RANGES.map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={range === k} className={range === k ? "on" : ""} onClick={() => setRange(k)}>
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="ow-btn" onClick={() => void load()} disabled={loading}>
          {loading ? "Updating…" : "Refresh"}
        </button>
      </div>

      {error && !data && <p className="pf-note pf-err">Could not load stats: {error}</p>}
      {!data && !error && <p className="pf-note">Reading the treasury from the chain…</p>}

      {data && p && (
        <>
          <div className="rd-kpis ow-kpis">
            <div><span>Earned (fees)</span><strong className="ow-big">{usd(p.fee)}</strong></div>
            <div><span>Swap volume</span><strong>{usd(p.volume)}</strong></div>
            <div><span>Swaps</span><strong>{p.swaps}</strong></div>
            <div><span>Wallets</span><strong>{p.wallets}</strong></div>
          </div>
          <p className="ow-sub">
            Effective fee {p.volume > 0 ? ((p.fee / p.volume) * 100).toFixed(2) : (data.feeRate * 100).toFixed(2)}% · average swap {p.swaps ? usd(p.volume / p.swaps) : "—"} · fee per swap {p.swaps ? usd(p.fee / p.swaps) : "—"}
          </p>

          <section className="card pf ow-card">
            <h2 className="tk-sub">Fees per day, last 30 days</h2>
            <div className="ow-bars" role="img" aria-label="Fees per day">
              {data.daily.map((d) => (
                <div key={d.day} className="ow-bar" title={`${d.day}: ${usd(d.fee)} from ${d.swaps} swap(s), volume ${usd(d.volume)}`}>
                  <i style={{ height: `${Math.max(d.fee > 0 ? 4 : 1, (d.fee / maxFee) * 100)}%` }} />
                </div>
              ))}
            </div>
            <div className="ow-axis"><span>{data.daily[0].day.slice(5)}</span><span>{data.daily[data.daily.length - 1].day.slice(5)}</span></div>
          </section>

          <section className="card pf ow-card">
            <div className="ow-row">
              <h2 className="tk-sub">Top wallets by volume</h2>
              <button type="button" className="ow-btn" onClick={() => csv("voltswap-wallets.csv", [["wallet", "swaps", "volume_usd", "fee_usd", "last_swap"], ...data.wallets.map((w) => [w.address, w.swaps, w.volume.toFixed(2), w.fee.toFixed(4), new Date(w.last).toISOString()])])}>
                CSV
              </button>
            </div>
            <ul className="pf-list">
              {data.wallets.length === 0 && <li><p className="pf-note">No swaps through Voltswap yet.</p></li>}
              {data.wallets.map((w) => (
                <li key={w.address}>
                  <div className="pf-name">
                    <strong><a href={`https://suiscan.xyz/mainnet/account/${w.address}`} target="_blank" rel="noopener noreferrer">{short(w.address)}</a></strong>
                    <span>{w.swaps} swap{w.swaps > 1 ? "s" : ""} · last {ago(w.last)}</span>
                  </div>
                  <div className="pf-val">
                    <strong>{usd(w.volume)}</strong>
                    <span>fee {usd(w.fee)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <div className="ow-two">
            <section className="card pf ow-card">
              <h2 className="tk-sub">Fees by token</h2>
              <ul className="pf-list">
                {data.coins.map((c) => (
                  <li key={c.symbol}>
                    <div className="pf-name"><strong>{c.symbol}</strong><span>{c.swaps} payment{c.swaps > 1 ? "s" : ""}</span></div>
                    <div className="pf-val"><strong>{c.usd === null ? "—" : usd(c.usd)}</strong><span>{amt(c.amount)} {c.symbol}</span></div>
                  </li>
                ))}
                {data.coins.length === 0 && <li><p className="pf-note">Nothing yet.</p></li>}
              </ul>
            </section>
            <section className="card pf ow-card">
              <h2 className="tk-sub">Treasury balance {data.balanceTotal > 0 && <span className="ow-total">{usd(data.balanceTotal)}</span>}</h2>
              <ul className="pf-list">
                {data.balances.map((b) => (
                  <li key={b.symbol}>
                    <div className="pf-name"><strong>{b.symbol}</strong></div>
                    <div className="pf-val"><strong>{usd(b.usd)}</strong><span>{amt(b.amount)}</span></div>
                  </li>
                ))}
                {data.balances.length === 0 && <li><p className="pf-note">No priced balances.</p></li>}
              </ul>
            </section>
          </div>

          <section className="card pf ow-card">
            <div className="ow-row">
              <h2 className="tk-sub">Recent swaps</h2>
              <button type="button" className="ow-btn" onClick={() => csv("voltswap-swaps.csv", [["time", "wallet", "volume_usd", "fee_usd", "fee_coin", "fee_amount", "tx"], ...data.recent.map((s) => [new Date(s.t).toISOString(), s.wallet, s.volumeUsd?.toFixed(2) ?? "", s.feeUsd?.toFixed(4) ?? "", s.coin, s.fee, s.digest])])}>
                CSV
              </button>
            </div>
            <ul className="pf-list">
              {data.recent.map((s) => (
                <li key={s.digest}>
                  <div className="pf-name">
                    <strong>{s.volumeUsd === null ? "—" : usd(s.volumeUsd)}</strong>
                    <span>{short(s.wallet)} · {ago(s.t)}</span>
                  </div>
                  <div className="pf-val">
                    <strong>{s.feeUsd === null ? "—" : usd(s.feeUsd)}</strong>
                    <span><a href={`https://suiscan.xyz/mainnet/tx/${s.digest}`} target="_blank" rel="noopener noreferrer">tx</a> · {amt(s.fee)} {s.coin}</span>
                  </div>
                </li>
              ))}
              {data.recent.length === 0 && <li><p className="pf-note">No swaps yet.</p></li>}
            </ul>
          </section>

          <details className="rd-about">
            <summary>How this is calculated</summary>
            <p>
              Read from the chain: every successful transaction where a wallet swaps tokens and your treasury receives roughly 0.01–1% of the swapped amount counts as a fee payment. Volume is the swapped amount in the fee token. USD uses the market price on the day of each payment (DeFiLlama), or the current price if no historical one exists.
              {data.unpriced > 0 ? ` ${data.unpriced} payment(s) could not be priced and are left out of the USD totals.` : ""} Plain transfers and airdrops to the treasury are ignored. Scanned {data.scanned} transactions{data.complete ? "" : " (the oldest ones were not reached)"}. Treasury balance counts only tokens that have a market price.
            </p>
          </details>
        </>
      )}
    </div>
  );
}
