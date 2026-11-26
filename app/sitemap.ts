import { GUIDES, PAIRS } from "@/lib/seo";
import { TOKENS } from "@/lib/tokens";
import type { MetadataRoute } from "next";

const BASE = "https://voltswap.org";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["", "/market", "/portfolio", "/merge", "/whales", "/partner", "/terms", "/risks"];
  const all = [
    ...paths,
    "/guides",
    ...GUIDES.map((g) => `/guides/${g.slug}`),
    ...PAIRS.map((p) => `/swap/${p.slug}`),
    ...TOKENS.map((t) => `/token/${t.symbol}`),
  ];
  return all.map((p) => ({ url: BASE + p, changeFrequency: "weekly", priority: p === "" ? 1 : 0.6 }));
}
