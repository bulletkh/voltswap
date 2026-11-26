"use client";

import { Providers } from "@/app/providers";
import { MergeView } from "./MergeView";

export function MergePanel() {
  return (
    <Providers>
      <MergeView />
    </Providers>
  );
}
