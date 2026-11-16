"use client";

import { useEffect, useMemo, useState } from "react";
import { useCurrentClient } from "@mysten/dapp-kit-react";
import { TOKENS, isCoinType, loadCustomTokens, saveCustomTokens, type Token } from "@/lib/tokens";
import { fetchTokenMeta } from "@/lib/meta";
import { formatUsd } from "@/lib/price";
import { TokenIcon } from "./TokenIcon";

type Row = { token: Token; price: number | null; change: number | null };

const REFRESH_MS = 60_000;
const key = (t: Token) => `sui:${t.type}`;

function formatPrice(v: number): string {
  if (v >= 1) return formatUsd(v);
  if (v >= 0.01) return "$" + v.toFixed(4);
  return "$" + v.toPrecision(3);
}

async function load(tokens: Token[]): Promise<Row[]> {
  const ids = tokens.map(key).join(",");
  const [p, c] = await Promise.all([
    fetch(`https://coins.llama.fi/prices/current/${ids}`).then((r) => (r.ok ? r.json() : Promise.reject(new Error("prices")))),
    fetch(`https://coins.llama.fi/percentage/${ids}?period=24h`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ]);
  return tokens.map((token) => {
    const price = p?.coins?.[key(token)]?.price;
    const change = c?.coins?.[key(token)];
    return {
      token,
      price: typeof price === "number" ? price : null,
      change: typeof change === "number" ? change : null,
    };
  });
}

export function MarketView() {
  const client = useCurrentClient();
  const [custom, setCustom] = useState<Token[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState(false);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [addr, setAddr] = useState("");
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => setCustom(loadCustomTokens()), []);

  const tokens = useMemo(
    () => [...TOKENS, ...custom.filter((c) => !TOKENS.some((t) => t.type === c.type))],
    [custom],
  );

  useEffect(() => {
    let alive = true;
    const run = () =>
      load(tokens)
        .then((r) => {
          if (!alive) return;
          setRows(r);
          setError(false);
          setUpdated(new Date());
        })
        .catch(() => alive && setError(true));
    void run();
    const t = setInterval(run, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [tokens]);

  async function addToken() {
    const type = addr.trim();
    setAddMsg(null);
    if (!isCoinType(type)) {
      setAddMsg("That does not look like a coin address. Example: 0x2::sui::SUI");
      return;
    }
    if (tokens.some((t) => t.type.toLowerCase() === type.toLowerCase())) {
      setAddMsg("This token is already in the list.");
      return;
    }
    setAdding(true);
    const meta = await fetchTokenMeta(client, type);
    setAdding(false);
    if (!meta) {
      setAddMsg("No coin found at this address. Check that you copied the full coin type.");
      return;
    }
    const next = [...custom, { ...meta, custom: true }];
    setCustom(next);
    saveCustomTokens(next);
    setAddr("");
  }

  function removeToken(type: string) {
    const next = custom.filter((t) => t.type !== type);
    setCustom(next);
    saveCustomTokens(next);
  }

  return (
    <section className="card pf" aria-label="Market">
      <div className="pf-head">
        <span className="pf-label">Token</span>
        <span>Price · 24h</span>
      </div>

      {rows === null && !error && <p className="pf-note">Loading prices…</p>}
      {error && <p className="pf-note pf-err">Could not load prices right now. {rows ? "Showing the last data." : "Try again in a minute."}</p>}

      {rows && (
        <ul className="pf-list">
          {rows.map((r) => (
            <li key={r.token.type}>
              <TokenIcon token={r.token} size={36} />
              <div className="pf-name">
                <strong>{r.token.symbol}</strong>
                <span>{r.token.custom ? "Added by you" : r.token.name}</span>
              </div>
              <div className="pf-val">
                <strong>{r.price === null ? "no price" : formatPrice(r.price)}</strong>
                {r.change === null ? (
                  <span>—</span>
                ) : (
                  <span className={r.change >= 0 ? "mk-up" : "mk-down"}>
                    {r.change >= 0 ? "+" : ""}
                    {r.change.toFixed(2)}%
                  </span>
                )}
              </div>
              {r.token.custom ? (
                <button type="button" className="mk-swap" onClick={() => removeToken(r.token.type)} aria-label={`Remove ${r.token.symbol}`}>
                  Remove
                </button>
              ) : (
                <a className="mk-swap" href={`/token/${r.token.symbol}`}>Open</a>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="mk-add"
        onSubmit={(e) => {
          e.preventDefault();
          void addToken();
        }}
      >
        <label htmlFor="mk-addr">Add any Sui token by its coin address</label>
        <div className="mk-add-row">
          <input
            id="mk-addr"
            className="picker-search"
            placeholder="0x…::module::TOKEN"
            autoComplete="off"
            spellCheck={false}
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
          />
          <button type="submit" className="mk-swap" disabled={adding || !addr.trim()}>
            {adding ? "Looking…" : "Add"}
          </button>
        </div>
        {addMsg && <p className="pf-note pf-err">{addMsg}</p>}
      </form>

      <p className="pf-note">
        The main list is short on purpose: Voltswap only features tokens it has checked. Anyone can create a token with
        any name, so verify the address on the project&rsquo;s official site before you add or trade one. Tokens you add
        are saved in this browser only. Some tokens have no price data.
      </p>
      <p className="pf-note">
        Prices come from DeFiLlama and refresh every minute{updated ? ` (last update ${updated.toLocaleTimeString()})` : ""}.
        They can differ from the price you get in a swap. This is not financial advice.
      </p>
    </section>
  );
}
