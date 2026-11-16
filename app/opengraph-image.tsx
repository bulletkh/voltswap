import { ImageResponse } from "next/og";

export const alt = "Voltswap: swap tokens on Sui";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
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
          <div
            style={{
              width: 88,
              height: 88,
              borderRadius: 22,
              background: "#2447ff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="52" height="52" viewBox="0 0 24 24">
              <path d="M13.5 2 5 13.5h6L10 22l9-12.5h-6.2L13.5 2Z" fill="#ffd60a" />
            </svg>
          </div>
          <div style={{ marginLeft: 28, fontSize: 64, fontWeight: 700, letterSpacing: -1 }}>Voltswap</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2, maxWidth: 980 }}>
            One quote across every major Sui pool.
          </div>
          <div style={{ marginTop: 28, fontSize: 34, color: "#44506b" }}>
            Non-custodial swaps. Your tokens never leave your wallet.
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 30, color: "#2447ff", fontWeight: 700 }}>voltswap.org</div>
      </div>
    ),
    { ...size },
  );
}
