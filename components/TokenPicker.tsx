"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCurrentClient } from "@mysten/dapp-kit-react";
import { fetchTokenMeta } from "@/lib/meta";
import { isCoinType, type Token } from "@/lib/tokens";
import { TokenIcon } from "./TokenIcon";

type Props = {
  label: string;
  value: Token;
  tokens: Token[];
  onPick: (t: Token) => void;
  onImport: (t: Token) => void;
};

function shortType(type: string) {
  const [pkg, ...rest] = type.split("::");
  return pkg.length > 14 ? `${pkg.slice(0, 8)}…${pkg.slice(-4)}::${rest.join("::")}` : type;
}

export function TokenPicker({ label, value, tokens, onPick, onImport }: Props) {
  const client = useCurrentClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Token | null>(null);
  const [lookup, setLookup] = useState<"idle" | "loading" | "missing">("idle");

  const q = query.trim();
  const byAddress = isCoinType(q);
  const known = useMemo(
    () => tokens.find((t) => t.type.toLowerCase() === q.toLowerCase()) ?? null,
    [tokens, q],
  );

  const filtered = useMemo(() => {
    if (!q) return tokens;
    if (byAddress) return known ? [known] : [];
    const s = q.toLowerCase();
    return tokens.filter((t) => t.symbol.toLowerCase().includes(s) || t.name.toLowerCase().includes(s));
  }, [tokens, q, byAddress, known]);

  useEffect(() => {
    setFound(null);
    if (!byAddress || known) {
      setLookup("idle");
      return;
    }
    let alive = true;
    setLookup("loading");
    void fetchTokenMeta(client, q).then((m) => {
      if (!alive) return;
      if (m) {
        setFound({ ...m, custom: true });
        setLookup("idle");
      } else setLookup("missing");
    });
    return () => {
      alive = false;
    };
  }, [client, q, byAddress, known]);

  function open() {
    setQuery("");
    dialog.current?.showModal();
  }
  function choose(t: Token) {
    onPick(t);
    dialog.current?.close();
  }
  function importAndChoose(t: Token) {
    onImport(t);
    choose(t);
  }

  return (
    <>
      <button type="button" className="tbtn" onClick={open} aria-label={`${label}: ${value.symbol}. Change token`}>
        <TokenIcon token={value} size={22} />
        <span>{value.symbol}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 4.5 6 8.5l4-4" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </button>

      <dialog
        ref={dialog}
        className="picker"
        aria-label={label}
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
      >
        <div className="picker-in">
          <div className="picker-head">
            <h2>{label}</h2>
            <button type="button" className="picker-x" onClick={() => dialog.current?.close()} aria-label="Close">
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path d="m3 3 10 10M13 3 3 13" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </button>
          </div>
          <input
            className="picker-search"
            placeholder="Search by name or paste a coin address"
            aria-label="Search by name or paste a coin address"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <ul className="picker-list">
            {filtered.map((t) => (
              <li key={t.type}>
                <button type="button" className={t.type === value.type ? "trow on" : "trow"} onClick={() => choose(t)}>
                  <TokenIcon token={t} size={32} />
                  <span className="trow-main">
                    <strong>{t.symbol}</strong>
                    <small>{t.name}</small>
                  </span>
                  {t.custom && <span className="tag">Added by you</span>}
                </button>
              </li>
            ))}
          </ul>

          {found && (
            <div className="import">
              <div className="trow static">
                <TokenIcon token={found} size={32} />
                <span className="trow-main">
                  <strong>{found.symbol}</strong>
                  <small>{shortType(found.type)}</small>
                </span>
              </div>
              <p>
                This token is not on Voltswap&rsquo;s list. Anyone can create a token with any name, so
                check the address against the project&rsquo;s official site before you trade it.
              </p>
              <button type="button" className="import-btn" onClick={() => importAndChoose(found)}>
                Add {found.symbol} and select it
              </button>
            </div>
          )}
          {lookup === "loading" && <p className="picker-note">Looking up this address…</p>}
          {lookup === "missing" && (
            <p className="picker-note">No coin found at this address. Check that you copied the full coin type.</p>
          )}
          {!byAddress && q && filtered.length === 0 && (
            <p className="picker-note">
              Nothing on the list matches &ldquo;{q}&rdquo;. Paste the coin address to add any Sui token,
              for example 0x2::sui::SUI.
            </p>
          )}
        </div>
      </dialog>
    </>
  );
}
