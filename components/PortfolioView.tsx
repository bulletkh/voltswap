"use client";

import { useEffect, useMemo, useState } from "react";
import type { SuiGrpcClient } from "@mysten/sui/grpc";
import { normalizeStructTag } from "@mysten/sui/utils";
import { AggregatorClient, Env } from "@cetusprotocol/aggregator-sdk";
import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import { TOKENS, isCoinType, type Token } from "@/lib/tokens";
import { fetchTokenMeta } from "@/lib/meta";
import { formatUsd, getUsdPrice } from "@/lib/price";
import { fromBaseUnits } from "@/lib/format";
import { TokenIcon } from "./TokenIcon";

const ZERO_ADDRESS = "0x" + "0".repeat(64);
const MAX_COINS = 40;

type Row = { token: Token; raw: bigint; price: number | null | undefined };

function shortAddr(a: string) {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

function formatAmount(raw: bigint, decimals: number): string {
  const n = Number(raw) / 10 ** decimals;
  if (!Number.isFinite(n)) return fromBaseUnits(raw, decimals);
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 4 : 8 });
}

export function PortfolioView() {
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [showUnpriced, setShowUnpriced] = useState(false);

  const priceAgg = useMemo(
    () => new AggregatorClient({ env: Env.Mainnet, client: client as unknown as SuiGrpcClient, signer: ZERO_ADDRESS }),
    [client],
  );

  useEffect(() => {
    if (!account) {
      setRows(null);
      return;
    }
    let alive = true;
    setRows(null);
    setError(null);
    setTruncated(false);

    (async () => {
      try {
        const res = await client.core.listBalances({ owner: account.address, limit: 200 });
        const owned = res.balances
          .map((b) => ({ type: b.coinType, raw: BigInt(b.balance) }))
          .filter((b) => b.raw > 0n && isCoinType(b.type));
        if (alive && (owned.length > MAX_COINS || res.hasNextPage)) setTruncated(true);

        // Сначала показываем балансы, цены подтягиваем следом
        const base: Row[] = await Promise.all(
          owned.slice(0, MAX_COINS).map(async (b) => {
            const known = TOKENS.find((t) => normalizeStructTag(t.type) === normalizeStructTag(b.type));
            const token = known ?? (await fetchTokenMeta(client, b.type));
            return {
              token: token ?? {
                type: b.type,
                symbol: b.type.split("::").pop() ?? "?",
                name: b.type,
                decimals: 0,
                iconUrl: null,
              },
              raw: b.raw,
              price: undefined,
            } as Row;
          }),
        );
        if (!alive) return;
        setRows(base);

        await Promise.all(
          base.map(async (r) => {
            const p = await getUsdPrice(priceAgg, r.token);
            if (!alive) return;
            setRows((cur) => cur && cur.map((x) => (x.token.type === r.token.type ? { ...x, price: p } : x)));
          }),
        );
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "Could not load balances.");
      }
    })();

    return () => {
      alive = false;
    };
  }, [account, client, priceAgg]);

  if (!account) {
    return (
      <section className="card pf-empty">
        <h2>Connect your wallet</h2>
        <p>Use the button in the top right to see your Sui tokens and their value. Voltswap only reads public balances; nothing is signed.</p>
      </section>
    );
  }

  const valued = rows
    ? rows
        .filter((r) => typeof r.price === "number")
        .map((r) => ({ ...r, usd: (Number(r.raw) / 10 ** r.token.decimals) * (r.price as number) }))
        .sort((a, b) => b.usd - a.usd)
    : [];
  const pending = rows ? rows.filter((r) => r.price === undefined).length : 0;
  const unpriced = rows ? rows.filter((r) => r.price === null) : [];
  const total = valued.reduce((s, r) => s + (Number.isFinite(r.usd) ? r.usd : 0), 0);

  return (
    <section className="card pf">
      <div className="pf-head">
        <span className="pf-label">Total value</span>
        <span className="pf-addr">{shortAddr(account.address)}</span>
      </div>
      <div className="pf-total">
        {rows === null ? "…" : formatUsd(total)}
        {pending > 0 && <small> updating prices…</small>}
      </div>

      {error && <p className="pf-note pf-err">{error}</p>}
      {rows !== null && rows.length === 0 && !error && <p className="pf-note">No tokens found in this wallet.</p>}

      <ul className="pf-list">
        {valued.map((r) => (
          <li key={r.token.type}>
            <TokenIcon token={r.token} size={36} />
            <div className="pf-name">
              <strong>{r.token.symbol}</strong>
              <span>{formatAmount(r.raw, r.token.decimals)}</span>
            </div>
            <div className="pf-val">
              <strong>{formatUsd(r.usd)}</strong>
              <span>{formatUsd(r.price as number)}</span>
            </div>
          </li>
        ))}
      </ul>

      {unpriced.length > 0 && (
        <>
          <button className="pf-toggle" onClick={() => setShowUnpriced((v) => !v)} aria-expanded={showUnpriced}>
            {showUnpriced ? "Hide" : "Show"} {unpriced.length} token{unpriced.length > 1 ? "s" : ""} without a price
          </button>
          {showUnpriced && (
            <ul className="pf-list pf-dim">
              {unpriced.map((r) => (
                <li key={r.token.type}>
                  <TokenIcon token={r.token} size={36} />
                  <div className="pf-name">
                    <strong>{r.token.symbol}</strong>
                    <span>{formatAmount(r.raw, r.token.decimals)}</span>
                  </div>
                  <div className="pf-val">
                    <span>no liquidity</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {truncated && <p className="pf-note">Showing the first {MAX_COINS} tokens only.</p>}
      <p className="pf-note">
        Values are estimates from live swap quotes into USDC, not guaranteed sale prices. Tokens you did not choose to
        hold may be spam; never interact with unknown tokens.
      </p>
    </section>
  );
}
