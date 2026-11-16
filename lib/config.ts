export const FEE_RECEIVER = process.env.NEXT_PUBLIC_FEE_RECEIVER ?? "";
export const FEE_RATE = Number(process.env.NEXT_PUBLIC_FEE_RATE ?? "0.001");
// In the browser we talk to our own /api/sui proxy (it adds the node token on the server).
// NEXT_PUBLIC_SUI_GRPC_URL, if set, overrides this and is used directly.
export const GRPC_URL =
  process.env.NEXT_PUBLIC_SUI_GRPC_URL ??
  (typeof window !== "undefined" ? `${window.location.origin}/api/sui` : "https://fullnode.mainnet.sui.io:443");

export const FEE_ENABLED =
  /^0x[0-9a-fA-F]{64}$/.test(FEE_RECEIVER) && FEE_RATE > 0 && FEE_RATE < 0.05;

export const DEFAULT_SLIPPAGE = 0.005; // 0.5%
export const EXPLORER_TX = "https://suiscan.xyz/mainnet/tx/";
