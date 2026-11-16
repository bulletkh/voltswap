"use client";

import { useEffect, useState } from "react";
import { useCurrentClient } from "@mysten/dapp-kit-react";
import { fetchTokenMeta } from "@/lib/meta";
import type { Token } from "@/lib/tokens";

export function TokenIcon({ token, size = 24 }: { token: Token; size?: number }) {
  const client = useCurrentClient();
  const [url, setUrl] = useState<string | null>(token.iconUrl ?? null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let alive = true;
    setBroken(false);
    setUrl(token.iconUrl ?? null);
    if (!token.iconUrl) {
      void fetchTokenMeta(client, token.type).then(async (m) => {
        if (!alive) return;
        if (m?.iconUrl) return setUrl(m.iconUrl);
        if (token.iconFrom) {
          const f = await fetchTokenMeta(client, token.iconFrom);
          if (alive && f?.iconUrl) setUrl(f.iconUrl);
        }
      });
    }
    return () => {
      alive = false;
    };
  }, [client, token.type, token.iconUrl, token.iconFrom]);

  const style = { width: size, height: size, fontSize: Math.round(size * 0.45) };
  if (url && (/^https:\/\//.test(url) || url.startsWith("/sui-icon")) && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img className="ticon" src={url} alt="" style={style} loading="lazy" onError={() => setBroken(true)} />
    );
  }
  return (
    <span className="ticon ticon-fallback" style={style} aria-hidden="true">
      {token.symbol.slice(0, 1).toUpperCase()}
    </span>
  );
}
