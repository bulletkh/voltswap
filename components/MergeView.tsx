"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { normalizeStructTag } from "@mysten/sui/utils";
import { useCurrentAccount, useCurrentClient, useDAppKit } from "@mysten/dapp-kit-react";
import { TOKENS, isCoinType, type Token } from "@/lib/tokens";
import { fetchTokenMeta } from "@/lib/meta";
import { fromBaseUnits } from "@/lib/format";
import { TokenIcon } from "./TokenIcon";

const SUI_TYPE = normalizeStructTag("0x2::sui::SUI");
const EST_REBATE_PER_OBJ = 0.0018;
const MAX_OBJECTS_PER_TX = 80;

type CoinObj = {
  coinType: string;
  coinObjectId: string;
  balance: bigint;
  version: string;
  digest: string;
};

type MergeGroup = {
  coinType: string;
  normType: string;
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
      const r = await fetch(`/api/merge/coins?owner=${encodeURIComponent(account.address)}`, { cache: "no-store" });
      const j = (await r.json()) as {
        coins?: { coinType: string; coinObjectId: string; balance: string; version: string; digest: string }[];
        error?: string;
      };
      if (!r.ok || !j.coins) throw new Error(j.error ?? `HTTP ${r.status}`);

      const byNorm = new Map<string, { coinType: string; objects: CoinObj[] }>();
      for (const c of j.coins) {
        if (!isCoinType(c.coinType)) continue;
        const norm = normalizeStructTag(c.coinType);
        const entry = byNorm.get(norm) ?? { coinType: c.coinType, objects: [] };
        entry.objects.push({
          coinType: c.coinType,
          coinObjectId: c.coinObjectId,
          balance: BigInt(c.balance),
          version: c.version,
          digest: c.digest,
        });
        byNorm.set(norm, entry);
      }

      const candidates: { coinType: string; normType: string; objects: CoinObj[]; totalBalance: bigint; zeroCount: number; removableCount: number }[] = [];
      for (const [normType, { coinType, objects }] of byNorm) {
        const zeroCount = objects.filter((o) => o.balance === 0n).length;
        const totalBalance = objects.reduce((s, o) => s + o.balance, 0n);
        const removableCount = totalBalance === 0n ? objects.length : objects.length - 1;
        if (removableCount <= 0) continue;
        candidates.push({ coinType, normType, objects, totalBalance, zeroCount, removableCount });
      }

      candidates.sort((a, b) => b.removableCount - a.removableCount);

      const built: MergeGroup[] = await Promise.all(
        candidates.slice(0, 60).map(async (item) => {
          const known = TOKENS.find((t) => normalizeStructTag(t.type) === item.normType);
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
      setSelected(new Set(built.map((g) => g.normType)));
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
      if (selected.has(g.normType)) selectedRemovable += g.removableCount;
    }
    return {
      types: groups.length,
      removable,
      selectedRemovable,
      estSui: selectedRemovable * EST_REBATE_PER_OBJ,
    };
  }, [groups, selected]);

  function toggleOne(normType: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(normType)) next.delete(normType);
      else next.add(normType);
      return next;
    });
  }

  async function executeMerge(targetNorms: string[]) {
    if (!account || !groups) return;
    const targets = groups.filter((g) => targetNorms.includes(g.normType));
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

        if (g.normType === SUI_TYPE) {
          if (nonZeros.length >= 1) {
            const primary = nonZeros[0];
            txb.setGasPayment([
              { objectId: primary.coinObjectId, version: primary.version, digest: primary.digest },
            ]);
            const extras = [...zeros, ...nonZeros.slice(1)].slice(0, objBudget);
            if (extras.length > 0) {
              txb.mergeCoins(
                txb.gas,
                extras.map((r) => txb.object(r.coinObjectId)),
              );
              objBudget -= extras.length;
            }
          }
          continue;
        }

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

  if (!account) {
    return (
      <div className="pf-empty">
        <p>Connect your Sui wallet in the top right to scan for fragmented coins and reclaimable SUI storage rebates.</p>
      </div>
    );
  }

  const batchCount = Math.min(totals.selectedRemovable, MAX_OBJECTS_PER_TX);

  return (
    <div>
      <div className="pf-head">
        <span>Est. SUI Reclaim ({totals.selectedRemovable} extra objects)</span>
        <span className="pf-addr">{shortAddr(account.address)}</span>
      </div>
      <div className="pf-total">
        +{totals.estSui.toFixed(4)} SUI <small>· 0% fee</small>
      </div>

      {error && <p className="pf-note pf-err">{error}</p>}

      {txDigest && (
        <p className="pf-note" style={{ color: "var(--ok)" }}>
          Merged successfully!{" "}
          <a
            href={`https://suiscan.xyz/mainnet/tx/${txDigest}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "inherit", textDecoration: "underline" }}
          >
            View on Suiscan ↗
          </a>
        </p>
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, margin: "12px 0 14px" }}>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                type="button"
                className="pf-toggle"
                onClick={() =>
                  setSelected(selected.size === groups.length ? new Set() : new Set(groups.map((g) => g.normType)))
                }
              >
                {selected.size === groups.length ? "Deselect all" : "Select all"}
              </button>
              <button type="button" className="pf-toggle" onClick={() => void loadCoins()} disabled={busy || loading}>
                Rescan
              </button>
            </div>

            <button
              type="button"
              className="btn-primary"
              disabled={busy || batchCount === 0}
              onClick={() => void executeMerge([...selected])}
              style={{
                padding: "10px 18px",
                borderRadius: 10,
                fontWeight: 700,
                cursor: busy || batchCount === 0 ? "not-allowed" : "pointer",
              }}
            >
              {busy
                ? "Signing…"
                : `Merge Selected (${batchCount} obj · ~+${(batchCount * EST_REBATE_PER_OBJ).toFixed(4)} SUI)`}
            </button>
          </div>

          <ul className="pf-list">
            {groups.map((g) => {
              const isChecked = selected.has(g.normType);
              return (
                <li key={g.normType}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleOne(g.normType)}
                    aria-label={`Select ${g.token.symbol}`}
                  />
                  <TokenIcon token={g.token} size={32} />
                  <div className="pf-name">
                    <b>{g.token.symbol}</b>
                    <span>
                      {formatAmount(g.totalBalance, g.token.decimals)} · {g.objects.length} →{" "}
                      {g.totalBalance === 0n ? 0 : 1} objects
                    </span>
                  </div>
                  <div className="pf-val">
                    <b className="mk-up">+{(g.removableCount * EST_REBATE_PER_OBJ).toFixed(4)} SUI</b>
                    <button
                      type="button"
                      className="pf-toggle"
                      style={{ padding: 0, textAlign: "right" }}
                      disabled={busy}
                      onClick={() => void executeMerge([g.normType])}
                    >
                      Merge
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
