import type { Token } from "./tokens";

type MetaClient = {
  core: {
    getCoinMetadata: (o: { coinType: string }) => Promise<{
      coinMetadata: { decimals: number; name: string; symbol: string; iconUrl: string | null } | null;
    }>;
  };
};

const cache = new Map<string, Promise<Token | null>>();

/** On-chain metadata for a coin type; null if the coin has none. Cached per visit. */
export function fetchTokenMeta(client: MetaClient, type: string): Promise<Token | null> {
  const key = type.trim();
  let p = cache.get(key);
  if (!p) {
    p = client.core
      .getCoinMetadata({ coinType: key })
      .then((r) =>
        r.coinMetadata
          ? {
              type: key,
              symbol: r.coinMetadata.symbol,
              name: r.coinMetadata.name,
              decimals: r.coinMetadata.decimals,
              iconUrl: r.coinMetadata.iconUrl,
            }
          : null,
      )
      .catch(() => {
        cache.delete(key);
        return null;
      });
    cache.set(key, p);
  }
  return p;
}
