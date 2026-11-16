export const FEE_RECEIVER = process.env.NEXT_PUBLIC_FEE_RECEIVER ?? "";
export const FEE_RATE = Number(process.env.NEXT_PUBLIC_FEE_RATE ?? "0.001");
export const GRPC_URL =
  process.env.NEXT_PUBLIC_SUI_GRPC_URL ?? "https://fullnode.mainnet.sui.io:443";

export const FEE_ENABLED =
  /^0x[0-9a-fA-F]{64}$/.test(FEE_RECEIVER) && FEE_RATE > 0 && FEE_RATE < 0.05;

export const DEFAULT_SLIPPAGE = 0.005; // 0.5%
export const EXPLORER_TX = "https://suiscan.xyz/mainnet/tx/";
