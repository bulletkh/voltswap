import React, { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, Wallet, X } from 'lucide-react';
import { useCurrentAccount } from '@mysten/dapp-kit-react';
import { POPULAR_TOKENS } from '../constants';
import { fetchWalletBalances, readBalanceFromMap } from '../suiClient';
import { fetchAftermathAccountState, type AfAccountState } from '../aftermathPerps';

interface PortfolioDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

const SUI_TOKENS = POPULAR_TOKENS.filter((t) => t.chain === 'sui');

export const PortfolioDrawer: React.FC<PortfolioDrawerProps> = ({ isOpen, onClose }) => {
  const account = useCurrentAccount();
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [afState, setAfState] = useState<AfAccountState | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadPortfolio = async () => {
    if (!account?.address) return;
    setIsLoading(true);
    try {
      const [balMap, af] = await Promise.all([
        fetchWalletBalances(account.address),
        fetchAftermathAccountState(account.address).catch(() => null),
      ]);
      setBalances(balMap);
      setAfState(af);
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

  const spotUsd = heldTokens.reduce((sum, item) => sum + item.usd, 0);
  const perpsUsd = afState?.totalEquityUsd ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70">
      <div className="panel-carbon w-full max-w-md h-full flex flex-col border-l border-white/[0.08]">
        <div className="px-4 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-[#38BDF8]" />
            <span className="text-sm font-semibold text-white">Wallet Portfolio</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadPortfolio}
              className="p-1.5 rounded bg-[#0C0E12] text-slate-400 hover:text-white"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded bg-[#0C0E12] text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!account ? (
            <div className="text-xs text-slate-500 text-center py-12">
              Connect your Sui wallet to inspect live balances and perpetual equity.
            </div>
          ) : (
            <>
              <div className="panel-carbon-sub rounded-xl p-4 space-y-2">
                <div className="text-xs text-slate-400">Net Estimated Equity</div>
                <div className="text-2xl font-mono tabular-nums font-semibold text-white">
                  ${(spotUsd + perpsUsd).toFixed(2)}
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-1">
                  <span>Spot: ${spotUsd.toFixed(2)}</span>
                  <span>Aftermath Perps: ${perpsUsd.toFixed(2)}</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                  <span>On-Chain Assets</span>
                  <a
                    href={`https://suiscan.xyz/mainnet/account/${account.address}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:text-[#38BDF8] font-mono"
                  >
                    <span>Suiscan</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                {heldTokens.length === 0 ? (
                  <div className="panel-carbon-sub rounded-lg p-4 text-center text-xs text-slate-500">
                    No tracked Sui balances found in wallet.
                  </div>
                ) : (
                  <div className="divide-y divide-white/[0.04] panel-carbon-sub rounded-xl overflow-hidden">
                    {heldTokens.map(({ token, amount, usd }) => (
                      <div
                        key={token.address + token.symbol}
                        className="px-3.5 py-2.5 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-2.5">
                          <img src={token.logo} alt={token.symbol} className="w-6 h-6 rounded-full" />
                          <div>
                            <div className="text-xs font-semibold text-white">{token.symbol}</div>
                            <div className="text-[11px] text-slate-500">{token.name}</div>
                          </div>
                        </div>
                        <div className="text-right font-mono tabular-nums">
                          <div className="text-xs text-white font-semibold">
                            {amount.toFixed(token.decimals > 6 ? 4 : 2)}
                          </div>
                          <div className="text-[11px] text-slate-500">${usd.toFixed(2)}</div>
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
