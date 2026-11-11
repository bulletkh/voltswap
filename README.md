# VoltSwap ⚡

> **Next-Generation Decentralized Exchange & Liquidity Protocol on Sui**

VoltSwap is a high-performance decentralized exchange (DEX), smart liquidity aggregator, and yield protocol built on the Sui blockchain. It combines concentrated liquidity routing, instant cross-DEX aggregation, automated fee compounding, and non-custodial yield vaults with institutional-grade UI/UX.

---

## 🚀 Key Features

* **Smart DEX Aggregation:** Instant optimal route discovery across Cetus CLMM, DeepBook v3, 7k, FlowX, and Aftermath with minimal slippage.
* **Concentrated Liquidity & Yield Vaults:** High-capital-efficiency market making with automated rebalancing and fee harvesting.
* **Sui dApp Kit Integration:** Native wallet support (Sui Wallet, Suiet, Nightly, Martian, OKX Wallet, Phantom).
* **On-Chain Analytics & Whale Radar:** Real-time on-chain transaction monitoring, DEX swap tracking, and Telegram alerts.
* **Modern UI/UX:** Built with React 18, TypeScript, TailwindCSS, Lucide Icons, and Vercel Analytics.

---

## 🛠 Tech Stack

* **Frontend:** React 18, TypeScript, Vite, TailwindCSS
* **Blockchain / SDKs:** `@mysten/sui`, `@mysten/dapp-kit`, `@cetusprotocol/aggregator-sdk`, `@7kprotocol/sdk-ts`, `navi-sdk`
* **State & Query:** `@tanstack/react-query`
* **Serverless Backend:** Vercel Functions (`/api/*`)
* **Styling & Icons:** Lucide React, Tailwind CSS

---

## 📦 Getting Started

### Prerequisites

* [Node.js](https://nodejs.org/) (v18 or higher recommended)
* [pnpm](https://pnpm.io/) or [npm](https://www.npmjs.com/)

### Installation

```bash
# Clone the repository
git clone https://github.com/bulletkh/voltswap.git
cd voltswap

# Install dependencies
npm install
```

### Development

```bash
# Run local development server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Production Build

```bash
# Build for production
npm run build

# Preview production build locally
npm run preview
```

---

## 🌐 Deployment

VoltSwap is configured for automatic deployment on [Vercel](https://vercel.com/) with native support for serverless API routes and edge caching.

---

## 📄 License

Proprietary & Confidential. All rights reserved.
