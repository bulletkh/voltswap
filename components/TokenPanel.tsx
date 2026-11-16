"use client";

import { Providers } from "@/app/providers";
import type { Token } from "@/lib/tokens";
import { TokenView } from "./TokenView";

export function TokenPanel({ token }: { token: Token }) {
  return (
    <Providers>
      <TokenView token={token} />
    </Providers>
  );
}
