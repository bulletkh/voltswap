"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeStructTag } from "@mysten/sui/utils";
import { useCurrentAccount, useCurrentClient, useDAppKit } from "@mysten/dapp-kit-react";
import { TOKENS, isCoinType, type Token } from "@/lib/tokens";
import { fetchTokenMeta } from "@/lib/meta";
import { fromBaseUnits } from "@/lib/format";
import { TokenIcon } from "./TokenIcon";

const SUI_RPC = "https://fullnode.mainnet.sui.io:443";
const SUI_TYPE = normalizeStructTag("0x2::sui::SUI");
const EST_REBATE_PER_OBJ = 0.0018; // ~0.0018 SUI storage rebate per destroyed coin object
const MAX_OBJECTS_PER_TX = 80;

type CoinObj = {
  coinType: string;
  coinObjectId: string;
  balance: bigint;
};

type MergeGroup = {
  coinType: string;
  token: Token;
  objects: CoinObj[];
  totalBalance: bigint;
  zeroCount: number;
  removableCount: number;
};

function shortAddr(a: string) {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

function formatAmount(raw: bigint, decimals: number): string {
  const n = Number(raw) / 10 ** decimals;
  if (!Number.isFinite(n)) return fromBaseUnits(raw, decimals);
  return n.toLocaleString("en-US", { maximumFractionDigits: n >= 1 ? 4 : 8 });
}

function friendlyErr(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/reject|denied|cancel/i.test(m)) return "Transaction was cancelled in the wallet.";
  return m;
}

async function fetchAllWalletCoins(owner: string): Promise<CoinObj[]> {
  const out: CoinObj[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 15; page++) {
    const r = await fetch(SUI_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "suix_getAllCoins",
        params: [owner, cursor, 100],
      }),
    });
    if (!r.ok) throw new Error(`Sui RPC ${r.status}`);
    const j = (await r.json()) as {
      result?: {
        data: { coinType: string; coinObjectId: string; balance: string }[];
        nextCursor: string | null;
        hasNextPage: boolean;
      };
      error?: { message: string };
    };
    if (j.error) throw new Error(j.error.message);
    const res = j.result;
    if (!res) break;
    for (const c of res.data) {
      out.push({
        coinType: c.coinType,
        coinObjectId: c.coinObjectId,
        balance: BigInt(c.balance),
      });
    }
    if (!res.hasNextPage || !res.nextCursor) break;
    cursor = res.nextCursor;
  }
  return out;
}

export function MergeView() {
  const account = useCurrentAccount();
  const client = useCurrentClient();
  const dAppKit = useDAppKit();

  const [groups, setGroups] = useState<MergeGroup[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txDigest, setTxDigest] = useState<string | null>(null);

  const loadCoins = useCallback(async () => {
    if (!account) {
      setGroups(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const all = await fetchAllWalletCoins(account.address);
      const byType = new Map<string, CoinObj[]>();
      for (const c of all) {
        if (!isCoinType(c.coinType)) continue;
        const norm = normalizeStructTag(c.coinType);
        // Keep SUI out unless it has 0-balance dust objects (avoid colliding with gas selection)
        if (norm === SUI_TYPE && c.balance > 0n) continue;
        const arr = byType.get(c.coinType) ?? [];
        arr.push(c);
        byType.set(c.coinType, arr);
      }

      const candidates: { coinType: string; objects: CoinObj[]; totalBalance: bigint; zeroCount: number; removableCount: number }[] = [];
      for (const [coinType, objects] of byType) {
        const zeroCount = objects.filter((o) => o.balance === 0n).length;
        const totalBalance = objects.reduce((s, o) => s + o.balance, 0n);
        const removableCount = totalBalance === 0n ? objects.length : objects.length - 1;
        if (removableCount <= 0) continue;
        candidates.push({ coinType, objects, totalBalance, zeroCount, removableCount });
      }

      candidates.sort((a, b) => b.removableCount - a.removableCount);

      const built: MergeGroup[] = await Promise.all(
        candidates.slice(0, 60).map(async (item) => {
          const norm = normalizeStructTag(item.coinType);
          const known = TOKENS.find((t) => normalizeStructTag(t.type) === norm);
          const meta = known ?? (await fetchTokenMeta(client, item.coinType).catch(() => null));
          const token: Token = meta ?? {
            type: item.coinType,
            symbol: item.coinType.split("::").pop() ?? "COIN",
            name: item.coinType,
            decimals: 0,
            iconUrl: null,
          };
          return { ...item, token };
        }),
      );

      setGroups(built);
      setSelected(new Set(built.map((g) => g.coinType)));
    } catch (e) {
      setError(friendlyErr(e));
    } finally {
      setLoading(false);
    }
  }, [account, client]);

  useEffect(() => {
    void loadCoins();
  }, [loadCoins]);

  const totals = useMemo(() => {
    if (!groups) return { types: 0, removable: 0, selectedRemovable: 0, estSui: 0 };
    let removable = 0;
    let selectedRemovable = 0;
    for (const g of groups) {
      removable += g.removableCount;
      if (selected.has(g.coinType)) selectedRemovable += g.removableCount;
    }
    return {
      types: groups.length,
      removable,
      selectedRemovable,
      estSui: selectedRemovable * EST_REBATE_PER_OBJ,
    };
  }, [groups, selected]);

  function toggleOne(coinType: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(coinType)) next.delete(coinType);
      else next.add(coinType);
      return next;
    });
  }

  async function executeMerge(targetTypes: string[]) {
    if (!account || !groups) return;
    const targets = groups.filter((g) => targetTypes.includes(g.coinType));
    if (targets.length === 0) return;

    setBusy(true);
    setError(null);
    setTxDigest(null);

    try {
      const txb = new Transaction();
      let objBudget = MAX_OBJECTS_PER_TX;

      for (const g of targets) {
        if (objBudget <= 0) break;
        const zeros = g.objects.filter((o) => o.balance === 0n);
        const nonZeros = g.objects.filter((o) => o.balance > 0n).sort((a, b) => (b.balance > a.balance ? 1 : -1));

        for (const z of zeros) {
          if (objBudget <= 0) break;
          txb.moveCall({
            target: "0x2::coin::destroy_zero",
            typeArguments: [g.coinType],
            arguments: [txb.object(z.coinObjectId)],
          });
          objBudget--;
        }

        if (nonZeros.length >= 2 && objBudget >= 1) {
          const primary = nonZeros[0];
          const rest = nonZeros.slice(1, 1 + objBudget);
          if (rest.length > 0) {
            txb.mergeCoins(
              txb.object(primary.coinObjectId),
              rest.map((r) => txb.object(r.coinObjectId)),
            );
            objBudget -= rest.length;
          }
        }
      }

      const result = await dAppKit.signAndExecuteTransaction({ transaction: txb });
      if (result.$kind === "FailedTransaction") {
        throw new Error("Transaction failed on-chain.");
      }
      setTxDigest(result.Transaction.digest);
      await loadCoins();
    } catch (e) {
      setError(friendlyErr(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pf-wrap">
      <section className="pf-hero">
        <div>
          <span className="eyebrow">
            <i aria-hidden="true" />
            Free Sui Utility · 0% Fee
          </span>
          <h1>Merge Coins & Reclaim SUI</h1>
          <p className="lede">
            Consolidate fragmented coin objects and destroy empty zero-balance coins in one transaction to reclaim locked SUI storage rebates.
          </p>
        </div>
        {account && (
          <div className="pf-total">
            <span>Est. SUI Reclaim</span>
            <b>+{totals.estSui.toFixed(4)} SUI</b>
            <small>{shortAddr(account.address)} · {totals.selectedRemovable} objects</small>
          </div>
        )}
      </section>

      {!account ? (
        <div className="pf-empty">
          <p>Connect your Sui wallet in the top right to scan for fragmented coins and reclaimable SUI storage rebates.</p>
        </div>
      ) : (
        <>
          {error && (
            <div className="pf-note pf-err" style={{ marginBottom: 14 }}>
              {error}
            </div>
          )}

          {txDigest && (
            <div className="pf-note" style={{ marginBottom: 14, borderColor: "rgba(52, 211, 153, 0.45)" }}>
              Merged successfully!{" "}
              <a
                href={`https://suiscan.xyz/mainnet/tx/${txDigest}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#38bdf8", textDecoration: "underline" }}
              >
                View transaction on Suiscan ↗
              </a>
            </div>
          )}

          {loading ? (
            <div className="pf-empty">
              <p>Scanning wallet coin objects on Sui mainnet…</p>
            </div>
          ) : !groups || groups.length === 0 ? (
            <div className="pf-empty">
              <p>Your wallet is clean — no fragmented coins or zero-balance dust objects found.</p>
            </div>
          ) : (
            <>
              <div className="pf-bar" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    type="button"
                    className="pf-pill"
                    onClick={() =>
                      setSelected(
                        selected.size === groups.length ? new Set() : new Set(groups.map((g) => g.coinType)),
                      )
                    }
                  >
                    {selected.size === groups.length ? "Deselect all" : "Select all"}
                  </button>
                  <button type="button" className="pf-pill" onClick={() => void loadCoins()} disabled={busy || loading}>
                    Rescan
                  </button>
                </div>

                <button
                  type="button"
                  className="btn"
                  disabled={busy || totals.selectedRemovable === 0}
                  onClick={() => void executeMerge([...selected])}
                  style={{
                    padding: "10px 18px",
                    borderRadius: 12,
                    fontWeight: 700,
                    cursor: busy || totals.selectedRemovable === 0 ? "not-allowed" : "pointer",
                  }}
                >
                  {busy
                    ? "Signing…"
                    : `Merge Selected (${Math.min(totals.selectedRemovable, MAX_OBJECTS_PER_TX)} objects · ~+${(Math.min(totals.selectedRemovable, MAX_OBJECTS_PER_TX) * EST_REBATE_PER_OBJ).toFixed(4)} SUI)`}
                </button>
              </div>

              <div className="pf-table-wrap">
                <table className="pf-table">
                  <thead>
                    <tr>
                      <th style={{ width: 38 }}></th>
                      <th>Token</th>
                      <th>Balance</th>
                      <th>Objects</th>
                      <th>Reclaimable</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g) => {
                      const isChecked = selected.has(g.coinType);
                      return (
                        <tr key={g.coinType}>
                          <td>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleOne(g.coinType)}
                              aria-label={`Select ${g.token.symbol}`}
                            />
                          </td>
                          <td>
                            <div className="pf-tok">
                              <TokenIcon token={g.token} size={28} />
                              <div>
                                <b>{g.token.symbol}</b>
                                <span>{g.zeroCount > 0 ? `${g.zeroCount} empty dust` : "Fragmented"}</span>
                              </div>
                            </div>
                          </td>
                          <td>{formatAmount(g.totalBalance, g.token.decimals)}</td>
                          <td>
                            <b>{g.objects.length}</b> → {g.totalBalance === 0n ? 0 : 1}
                          </td>
                          <td style={{ color: "#34d399" }}>
                            +{(g.removableCount * EST_REBATE_PER_OBJ).toFixed(4)} SUI
                          </td>
                          <td>
                            <button
                              type="button"
                              className="pf-pill"
                              disabled={busy}
                              onClick={() => void executeMerge([g.coinType])}
                            >
                              Merge
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
