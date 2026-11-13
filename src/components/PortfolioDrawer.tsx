import React, { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, Wallet, X } from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { POPULAR_TOKENS } from '../constants';
import { fetchWalletBalances, readBalanceFromMap } from '../suiClient';
import { fetchAftermathAccountState, type AfAccountState } from '../aftermathPerps';
import {
  fetchDeepBookMarginVaults,
  fetchUserDeepBookMarginPositions,
  type DeepBookMarginVault,
  type UserMarginPosition,
} from '../earnPools';

interface PortfolioDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

const SUI_TOKENS = POPULAR_TOKENS.filter((t) => t.chain === 'sui');

export const PortfolioDrawer: React.FC<PortfolioDrawerProps> = ({ isOpen, onClose }) => {
  const account = useCurrentAccount();
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [afState, setAfState] = useState<AfAccountState | null>(null);
  const [marginPositions, setMarginPositions] = useState<Record<string, UserMarginPosition>>({});
  const [marginVaults, setMarginVaults] = useState<DeepBookMarginVault[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadPortfolio = async () => {
    if (!account?.address) return;
    setIsLoading(true);
    try {
      const [balMap, af, posData, vaults] = await Promise.all([
        fetchWalletBalances(account.address),
        fetchAftermathAccountState(account.address).catch(() => null),
        fetchUserDeepBookMarginPositions(account.address).catch(() => ({
          supplierCapIds: [],
          positions: {},
        })),
        fetchDeepBookMarginVaults().catch(() => []),
      ]);
      setBalances(balMap);
      setAfState(af);
      setMarginPositions(posData.positions);
      setMarginVaults(vaults);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && account?.address) {
      loadPortfolio();
    }
  }, [isOpen, account?.address]);

  if (!isOpen) return null;

  const heldTokens = SUI_TOKENS.map((t) => {
    const amount = account?.address ? readBalanceFromMap(balances, t.address, t.decimals) : 0;
    const usd = amount * (t.priceUsd || 0);
    return { token: t, amount, usd };
  }).filter((item) => item.amount > 0.00001);

  const activeMarginEntries = Object.values(marginPositions).map((pos) => {
    const meta = marginVaults.find((v) => v.coinKey === pos.coinKey);
    const usd = pos.suppliedAmount * (meta?.priceUsd ?? 1);
    return { ...pos, apr: meta?.supplyAprPct ?? 0, usd };
  });

  const spotUsd = heldTokens.reduce((sum, item) => sum + item.usd, 0);
  const perpsUsd = afState?.totalEquityUsd ?? 0;
  const vaultsUsd = activeMarginEntries.reduce((sum, item) => sum + item.usd, 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/80">
      <div className="panel-carbon w-full max-w-md h-full flex flex-col border-l border-white/[0.14]">
        <div className="px-5 py-4 border-b border-white/[0.1] flex items-center justify-between bg-[#0B1017]">
          <div className="flex items-center gap-2.5">
            <Wallet className="w-5 h-5 text-[#2AF5D2]" />
            <span className="text-base font-bold text-white">Wallet Portfolio</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadPortfolio}
              className="p-2 rounded-xl bg-[#0B1017] border border-white/[0.1] text-slate-300 hover:text-white hover:border-[#00E0B8]/50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-[#0B1017] border border-white/[0.1] text-slate-300 hover:text-white hover:border-[#00E0B8]/50"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {!account ? (
            <div className="text-sm text-slate-300 text-center py-12">
              Connect your Sui wallet to inspect live balances, DeepBook vaults, and perpetual equity.
            </div>
          ) : (
            <>
              <div className="panel-carbon-sub rounded-2xl p-4 space-y-2.5">
                <div className="text-sm text-slate-300">Net Estimated Equity</div>
                <div className="text-3xl font-mono tabular-nums font-bold text-white">
                  ${(spotUsd + perpsUsd + vaultsUsd).toFixed(2)}
                </div>
                <div className="flex items-center justify-between text-xs font-mono text-slate-300 pt-1">
                  <span>Spot: ${spotUsd.toFixed(2)}</span>
                  <span>Vaults: ${vaultsUsd.toFixed(2)}</span>
                  <span>Perps: ${perpsUsd.toFixed(2)}</span>
                </div>
              </div>

              {activeMarginEntries.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-semibold text-white px-1">
                    DeepBook v3 Lending Deposits
                  </div>
                  <div className="divide-y divide-white/[0.06] panel-carbon-sub rounded-2xl overflow-hidden">
                    {activeMarginEntries.map((m) => (
                      <div
                        key={m.coinKey}
                        className="px-4 py-3 flex items-center justify-between text-xs font-mono"
                      >
                        <div>
                          <div className="text-sm font-bold text-white font-sans">{m.coinKey} Vault</div>
                          <div className="text-xs text-[#00E0B8]">{m.apr.toFixed(2)}% APR</div>
                        </div>
                        <div className="text-right tabular-nums">
                          <div className="text-sm font-semibold text-white">
                            {m.suppliedAmount.toFixed(4)} {m.coinKey}
                          </div>
                          <div className="text-xs text-slate-300">${m.usd.toFixed(2)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm text-slate-300 px-1">
                  <span className="font-semibold text-white">On-Chain Assets</span>
                  <a
                    href={`https://suiscan.xyz/mainnet/account/${account.address}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-[#2AF5D2] hover:underline font-mono"
                  >
                    <span>Suiscan</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                {heldTokens.length === 0 ? (
                  <div className="panel-carbon-sub rounded-xl p-4 text-center text-sm text-slate-400">
                    No tracked Sui balances found in wallet.
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.06] panel-carbon-sub rounded-2xl overflow-hidden">
                    {heldTokens.map(({ token, amount, usd }) => (
                      <div
                        key={token.address + token.symbol}
                        className="px-4 py-3 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <img src={token.logo} alt={token.symbol} className="w-7 h-7 rounded-full" />
                          <div>
                            <div className="text-sm font-bold text-white">{token.symbol}</div>
                            <div className="text-xs text-slate-300">{token.name}</div>
                          </div>
                        </div>
                        <div className="text-right font-mono tabular-nums">
                          <div className="text-sm text-white font-semibold">
                            {amount.toFixed(token.decimals > 6 ? 4 : 2)}
                          </div>
                          <div className="text-xs text-slate-300">${usd.toFixed(2)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
