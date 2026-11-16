import type { MetadataRoute } from "next";

const BASE = "https://voltswap.org";

export default function sitemap(): MetadataRoute.Sitemap {
  const paths = ["", "/market", "/portfolio", "/whales", "/terms", "/risks"];
  return paths.map((p) => ({ url: BASE + p, changeFrequency: "weekly", priority: p === "" ? 1 : 0.6 }));
}
