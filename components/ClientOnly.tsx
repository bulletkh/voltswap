"use client";

import dynamic from "next/dynamic";

// Кошелёк работает только в браузере (window/document), поэтому без SSR.
export const ConnectSlot = dynamic(() => import("./Header").then((m) => m.Header), {
  ssr: false,
  loading: () => <span className="connect-ph" aria-hidden="true" />,
});

export const PortfolioSlot = dynamic(() => import("./PortfolioPanel").then((m) => m.PortfolioPanel), {
  ssr: false,
  loading: () => <section className="card card-ph" aria-busy="true" aria-label="Portfolio loading" />,
});

export const MarketSlot = dynamic(() => import("./MarketPanel").then((m) => m.MarketPanel), {
  ssr: false,
  loading: () => <section className="card card-ph" aria-busy="true" aria-label="Market loading" />,
});

export const SwapSlot = dynamic(() => import("./SwapPanel").then((m) => m.SwapPanel), {
  ssr: false,
  loading: () => <section className="card card-ph" aria-busy="true" aria-label="Swap loading" />,
});

export const TokenSlot = dynamic(() => import("./TokenPanel").then((m) => m.TokenPanel), {
  ssr: false,
  loading: () => <section className="card card-ph" aria-busy="true" aria-label="Token loading" />,
});

export const OwnerSlot = dynamic(() => import("./OwnerPanel").then((m) => m.OwnerPanel), {
  ssr: false,
  loading: () => <section className="card card-ph" aria-busy="true" aria-label="Cabinet loading" />,
});

export const PartnerSlot = dynamic(() => import("./PartnerPanel").then((m) => m.PartnerPanel), {
  ssr: false,
  loading: () => <section className="card card-ph" aria-busy="true" aria-label="Partner cabinet loading" />,
});
