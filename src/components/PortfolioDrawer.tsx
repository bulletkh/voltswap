import React, { useEffect, useState } from 'react';
import { ExternalLink, Loader2, RefreshCw, Wallet, X } from 'lucide-react';
import { useCurrentAccount, useDAppKit } from '@mysten/dapp-kit-react';
import { POPULAR_TOKENS } from '../constants';
import { fetchWalletBalances, readBalanceFromMap } from '../suiClient';
import { simulateTxBeforeWallet } from '../suiSimulate';
import { fetchAftermathAccountState, type AfAccountState } from '../aftermathPerps';
import {
  buildWithdrawAllManagersAndCancelTx,
  DEFAULT_DEEPBOOK_POOLS,
  discoverBalanceManagers,
  fetchAllDeepBookManagerStates,
  type DeepBookManagerState,
} from '../deepbookV3';
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
const DEFAULT_CLOB_POOL = DEFAULT_DEEPBOOK_POOLS[0];

export const PortfolioDrawer: React.FC<PortfolioDrawerProps> = ({ isOpen, onClose }) => {
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [afState, setAfState] = useState<AfAccountState | null>(null);
  const [marginPositions, setMarginPositions] = useState<Record<string, UserMarginPosition>>({});
  const [marginVaults, setMarginVaults] = useState<DeepBookMarginVault[]>([]);
  const [clobManagers, setClobManagers] = useState<DeepBookManagerState[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isWithdrawingClob, setIsWithdrawingClob] = useState(false);
  const [clobStatus, setClobStatus] = useState<string | null>(null);
  const [clobError, setClobError] = useState<string | null>(null);

  const loadPortfolio = async () => {
    if (!account?.address) return;
    setIsLoading(true);
    try {
      const [balMap, af, posData, vaults, clobIds] = await Promise.all([
        fetchWalletBalances(account.address),
        fetchAftermathAccountState(account.address).catch(() => null),
        fetchUserDeepBookMarginPositions(account.address).catch(() => ({
          supplierCapIds: [],
          positions: {},
        })),
        fetchDeepBookMarginVaults().catch(() => []),
        discoverBalanceManagers(account.address).catch(() => [] as string[]),
      ]);
      const clobStates =
        clobIds.length > 0
          ? await fetchAllDeepBookManagerStates(account.address, clobIds, DEFAULT_CLOB_POOL).catch(
              () => []
            )
          : [];
      setBalances(balMap);
      setAfState(af);
      setMarginPositions(posData.positions);
      setMarginVaults(vaults);
      setClobManagers(clobStates);
    } finally {
      setIsLoading(false);
    }
  };

  const handleWithdrawClob = async (cancelOpenOrders: boolean) => {
    if (!account?.address || clobManagers.length === 0) return;
    setIsWithdrawingClob(true);
    setClobStatus(null);
    setClobError(null);
    try {
      const tx = buildWithdrawAllManagersAndCancelTx({
        owner: account.address,
        pool: DEFAULT_CLOB_POOL,
        managers: clobManagers.map((m) => ({
          managerId: m.managerId,
          openOrderIds: cancelOpenOrders ? m.openOrders.map((o) => o.orderId) : [],
        })),
      });
      await simulateTxBeforeWallet(tx);
      await dAppKit.signAndExecuteTransaction({ transaction: tx });
      setClobStatus(
        cancelOpenOrders
          ? 'Open CLOB orders cancelled and all vault balances returned to your wallet.'
          : 'Unlocked DeepBook CLOB funds withdrawn to your wallet.'
      );
      await loadPortfolio();
    } catch (e) {
      setClobError(e instanceof Error ? e.message : 'CLOB withdrawal failed');
    } finally {
      setIsWithdrawingClob(false);
    }
  };

  useEffect(() => {
    if (isOpen && account?.address) {
      setClobStatus(null);
      setClobError(null);
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

  const suiPrice = SUI_TOKENS.find((t) => t.symbol === 'SUI')?.priceUsd || 0.8;
  const usdcPrice = SUI_TOKENS.find((t) => t.symbol === 'USDC')?.priceUsd || 1;
  const deepPrice = SUI_TOKENS.find((t) => t.symbol === 'DEEP')?.priceUsd || 0;

  const clobOpenOrders = clobManagers.flatMap((m) => m.openOrders);
  const clobUnlockedSui = clobManagers.reduce((s, m) => s + m.baseBalance + m.settledBase, 0);
  const clobUnlockedUsdc = clobManagers.reduce((s, m) => s + m.quoteBalance + m.settledQuote, 0);
  const clobUnlockedDeep = clobManagers.reduce((s, m) => s + m.deepBalance, 0);
  const clobLockedSui = clobOpenOrders
    .filter((o) => !o.isBid)
    .reduce((s, o) => s + Math.max(0, o.quantity - o.filledQuantity), 0);
  const clobLockedUsdc = clobOpenOrders
    .filter((o) => o.isBid)
    .reduce((s, o) => s + Math.max(0, o.quantity - o.filledQuantity) * o.price, 0);

  const clobVaultsUsd =
    (clobUnlockedSui + clobLockedSui) * suiPrice +
    (clobUnlockedUsdc + clobLockedUsdc) * usdcPrice +
    clobUnlockedDeep * deepPrice;

  const hasClobUnlocked =
    clobUnlockedSui > 0.00001 || clobUnlockedUsdc > 0.00001 || clobUnlockedDeep > 0.00001;
  const hasClobFundsOrOrders = hasClobUnlocked || clobOpenOrders.length > 0;
  const nonEmptyClobManagers = clobManagers.filter(
    (m) =>
      m.baseBalance + m.settledBase > 0.00001 ||
      m.quoteBalance + m.settledQuote > 0.00001 ||
      m.deepBalance > 0.00001 ||
      m.openOrders.length > 0
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/80">
      <div className="panel-carbon w-full max-w-md h-full flex flex-col border-l border-white/[0.14]">
        <div className="px-5 py-4 border-b border-white/[0.1] flex items-center justify-between bg-[#0A1019]">
          <div className="flex items-center gap-2.5">
            <Wallet className="w-5 h-5 text-[#18C8FF]" />
            <span className="text-base font-bold text-white">Wallet Portfolio</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadPortfolio}
              className="p-2 rounded-xl bg-[#0A1019] border border-white/[0.1] text-slate-300 hover:text-white hover:border-[#18C8FF]/50"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-[#0A1019] border border-white/[0.1] text-slate-300 hover:text-white hover:border-[#18C8FF]/50"
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
                  ${(spotUsd + perpsUsd + vaultsUsd + clobVaultsUsd).toFixed(2)}
                </div>
                <div className="flex items-center justify-between text-xs font-mono text-slate-300 pt-1">
                  <span>Spot: ${spotUsd.toFixed(2)}</span>
                  <span>Vaults: ${(vaultsUsd + clobVaultsUsd).toFixed(2)}</span>
                  <span>Perps: ${perpsUsd.toFixed(2)}</span>
                </div>
              </div>

              {hasClobFundsOrOrders && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <span className="text-sm font-semibold text-white">
                      DeepBook Spot CLOB Vaults ({nonEmptyClobManagers.length})
                    </span>
                    <span className="text-xs font-mono text-[#18C8FF]">
                      ${clobVaultsUsd.toFixed(2)}
                    </span>
                  </div>
                  <div className="panel-carbon-sub rounded-2xl p-3.5 space-y-3 border border-[#18C8FF]/25">
                    <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                      <div className="rounded-xl bg-[#0A1019] border border-white/[0.08] px-3 py-2">
                        <div className="text-[11px] text-slate-400 font-sans">Unlocked in Vaults</div>
                        <div className="text-white font-semibold mt-0.5 tabular-nums">
                          {clobUnlockedSui.toFixed(4)} SUI
                        </div>
                        <div className="text-slate-300 tabular-nums">
                          {clobUnlockedUsdc.toFixed(4)} USDC
                        </div>
                      </div>
                      <div className="rounded-xl bg-[#0A1019] border border-white/[0.08] px-3 py-2">
                        <div className="text-[11px] text-slate-400 font-sans">
                          In Open Orders ({clobOpenOrders.length})
                        </div>
                        <div className="text-amber-300 font-semibold mt-0.5 tabular-nums">
                          {clobLockedSui.toFixed(4)} SUI
                        </div>
                        <div className="text-slate-300 tabular-nums">
                          {clobLockedUsdc.toFixed(4)} USDC
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      {nonEmptyClobManagers.map((m) => {
                        const mSui = m.baseBalance + m.settledBase;
                        const mUsdc = m.quoteBalance + m.settledQuote;
                        return (
                          <div
                            key={m.managerId}
                            className="flex items-center justify-between text-[11px] font-mono px-2.5 py-1.5 rounded-lg bg-[#0A1019]/70 border border-white/[0.06]"
                          >
                            <a
                              href={`https://suiscan.xyz/mainnet/object/${m.managerId}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[#18C8FF] hover:underline"
                            >
                              <span>
                                {m.managerId.slice(0, 6)}...{m.managerId.slice(-4)}
                              </span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                            <span className="text-slate-200 tabular-nums">
                              {mSui.toFixed(3)} SUI · {mUsdc.toFixed(3)} USDC
                              {m.openOrders.length > 0 ? ` · ${m.openOrders.length} ord` : ''}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex flex-col gap-2">
                      {hasClobUnlocked && (
                        <button
                          type="button"
                          disabled={isWithdrawingClob}
                          onClick={() => handleWithdrawClob(false)}
                          className="w-full py-2 px-3 rounded-xl text-xs font-semibold bg-[#18C8FF]/15 border border-[#18C8FF]/40 text-[#9CE7FF] hover:bg-[#18C8FF]/25 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                        >
                          {isWithdrawingClob && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          <span>Withdraw Unlocked Funds to Wallet</span>
                        </button>
                      )}
                      {clobOpenOrders.length > 0 && (
                        <button
                          type="button"
                          disabled={isWithdrawingClob}
                          onClick={() => handleWithdrawClob(true)}
                          className="w-full py-2 px-3 rounded-xl text-xs font-semibold bg-amber-500/15 border border-amber-400/40 text-amber-200 hover:bg-amber-500/25 disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
                        >
                          {isWithdrawingClob && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          <span>
                            Cancel All ({clobOpenOrders.length}) & Withdraw All to Wallet
                          </span>
                        </button>
                      )}
                    </div>

                    {clobStatus && (
                      <div className="text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-400/30 rounded-xl px-3 py-2">
                        {clobStatus}
                      </div>
                    )}
                    {clobError && (
                      <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-400/30 rounded-xl px-3 py-2">
                        {clobError}
                      </div>
                    )}
                  </div>
                </div>
              )}

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
                          <div className="text-xs text-[#18C8FF]">{m.apr.toFixed(2)}% APR</div>
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
                    className="inline-flex items-center gap-1 text-xs text-[#18C8FF] hover:underline font-mono"
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
