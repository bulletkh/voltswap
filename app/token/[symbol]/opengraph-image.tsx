import { ImageResponse } from "next/og";
import { TOKENS } from "@/lib/tokens";

export const alt = "Voltswap token page";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return TOKENS.map((t) => ({ symbol: t.symbol }));
}

export default async function Image({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const t = TOKENS.find((x) => x.symbol === decodeURIComponent(symbol));
  const name = t?.name ?? "Token";
  const sym = t?.symbol ?? "";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#eef1f6",
          padding: "72px 80px",
          color: "#0b1533",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ width: 72, height: 72, borderRadius: 18, background: "#2447ff", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="42" height="42" viewBox="0 0 24 24">
              <path d="M13.5 2 5 13.5h6L10 22l9-12.5h-6.2L13.5 2Z" fill="#ffd60a" />
            </svg>
          </div>
          <div style={{ marginLeft: 22, fontSize: 52, fontWeight: 700 }}>Voltswap</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 120, fontWeight: 700, letterSpacing: -3, lineHeight: 1 }}>{sym}</div>
          <div style={{ marginTop: 16, fontSize: 48, color: "#44506b" }}>{name} price, chart and swap on Sui</div>
        </div>
        <div style={{ display: "flex", fontSize: 30, color: "#2447ff", fontWeight: 700 }}>voltswap.org/token/{sym}</div>
      </div>
    ),
    { ...size },
  );
}
