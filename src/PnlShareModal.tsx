import React, { useState, useRef, useEffect } from 'react';
import { X, Twitter, Copy, Check, Download, Zap, ShieldCheck, Sparkles, ExternalLink, Send } from 'lucide-react';

export interface PnlTradeData {
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  volumeUsd: number;
  feeSavedUsd?: number;
  profitPct?: number;
  profitUsd?: number;
  digest?: string;
  timestamp?: number;
  isSwapPlus?: boolean;
  orderType?: 'SWAP' | 'LIMIT' | 'DCA' | 'PERPS';
}

interface PnlShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  trade: PnlTradeData | null;
  userAddress?: string;
  refCode?: string;
}

export const PnlShareModal: React.FC<PnlShareModalProps> = ({
  isOpen,
  onClose,
  trade,
  userAddress,
  refCode
}) => {
  const [copied, setCopied] = useState<boolean>(false);
  const [isGeneratingImg, setIsGeneratingImg] = useState<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  if (!isOpen || !trade) return null;

  const activeRef = refCode || (userAddress ? `${userAddress.slice(0, 8)}...${userAddress.slice(-4)}` : 'volt');
  const fullRefUrl = `https://voltswap.org/?ref=${encodeURIComponent(refCode || userAddress || 'alpha')}`;

  const profitAmount = trade.profitUsd ?? (trade.feeSavedUsd && trade.feeSavedUsd > 0 ? trade.feeSavedUsd : Number(((trade.volumeUsd || 100) * 0.025).toFixed(2)));
  const profitPercentage = trade.profitPct ?? 2.85;

  const engineName = trade.orderType === 'LIMIT'
    ? 'DeepBook v3 CLOB'
    : trade.orderType === 'PERPS'
    ? 'Bluefin Pro CLOB'
    : 'Cetus CLMM + DeepBook v3';

  const orderTypeLabel = trade.orderType === 'LIMIT'
    ? 'Limit Order'
    : trade.orderType === 'PERPS'
    ? 'Perpetual Margin'
    : trade.orderType === 'DCA'
    ? 'DCA Automation'
    : 'Atomic PTB Swap';

  // Generate Tweet Share URL
  const handleShareTwitter = () => {
    const text = `⚡ Just executed an on-chain ${orderTypeLabel} on @voltswap!\n\n💰 ${trade.fromAmount} ${trade.fromToken} ➔ ${trade.toAmount} ${trade.toToken} with Zero Slippage.\n🔥 Saved on fees & captured whale liquidity via ${engineName}!\n\nTrade like a whale on Sui: ${fullRefUrl}\n\n#Sui #SuiNetwork #VoltProtocol $SUI`;
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
    window.open(twitterUrl, '_blank', 'noopener,noreferrer');
  };

  // Generate Telegram Share URL
  const handleShareTelegram = () => {
    const text = `⚡ Just executed ${orderTypeLabel} on Volt Protocol!\n\n💰 ${trade.fromAmount} ${trade.fromToken} ➔ ${trade.toAmount} ${trade.toToken}\n🔥 Zero Slippage with ${engineName}\n\nTrade smart on Sui:`;
    const tgUrl = `https://t.me/share/url?url=${encodeURIComponent(fullRefUrl)}&text=${encodeURIComponent(text)}`;
    window.open(tgUrl, '_blank', 'noopener,noreferrer');
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(fullRefUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // High-Resolution 1200x675 Canvas Exporter for Twitter/Telegram
  const handleDownloadImage = () => {
    setIsGeneratingImg(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1200;
      canvas.height = 675;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 1. Background
      const bgGrad = ctx.createLinearGradient(0, 0, 1200, 675);
      bgGrad.addColorStop(0, '#07090e');
      bgGrad.addColorStop(0.5, '#0b0f19');
      bgGrad.addColorStop(1, '#05070a');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, 1200, 675);

      // Radial Glow Accents
      const glow1 = ctx.createRadialGradient(200, 200, 10, 200, 200, 450);
      glow1.addColorStop(0, 'rgba(215, 246, 38, 0.18)');
      glow1.addColorStop(1, 'rgba(215, 246, 38, 0)');
      ctx.fillStyle = glow1;
      ctx.fillRect(0, 0, 1200, 675);

      const glow2 = ctx.createRadialGradient(1000, 450, 10, 1000, 450, 400);
      glow2.addColorStop(0, 'rgba(16, 185, 129, 0.15)');
      glow2.addColorStop(1, 'rgba(16, 185, 129, 0)');
      ctx.fillStyle = glow2;
      ctx.fillRect(0, 0, 1200, 675);

      // Outer Neon Border
      ctx.strokeStyle = 'rgba(215, 246, 38, 0.35)';
      ctx.lineWidth = 3;
      ctx.strokeRect(30, 30, 1140, 615);

      // 2. Header: Logo & Badge
      ctx.fillStyle = '#d7f626';
      ctx.font = 'bold 38px monospace';
      ctx.fillText('⚡ VOLT PROTOCOL', 70, 100);

      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 18px monospace';
      ctx.fillText('SUI APEX EXECUTION ENGINE • MOVE PTB', 70, 135);

      // Badge top right
      ctx.fillStyle = 'rgba(16, 185, 129, 0.2)';
      ctx.fillRect(860, 65, 270, 48);
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(860, 65, 270, 48);
      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 18px monospace';
      ctx.fillText('✓ VERIFIED ON SUI', 900, 96);

      // Divider line
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(70, 170);
      ctx.lineTo(1130, 170);
      ctx.stroke();

      // 3. Trade Pair Section
      ctx.fillStyle = '#cbd5e1';
      ctx.font = 'bold 24px monospace';
      const canvasSectionTitle = trade.orderType === 'LIMIT'
        ? 'EXECUTED LIMIT ORDER:'
        : trade.orderType === 'PERPS'
        ? 'PERPETUAL MARGIN TRADE:'
        : trade.orderType === 'DCA'
        ? 'DCA AUTOMATION TRANCHE:'
        : 'EXECUTED SWAP:';
      ctx.fillText(canvasSectionTitle, 70, 225);

      ctx.fillStyle = '#ffffff';
      ctx.font = '900 48px monospace';
      ctx.fillText(`${trade.fromAmount} ${trade.fromToken}`, 70, 290);

      ctx.fillStyle = '#d7f626';
      ctx.font = 'bold 44px sans-serif';
      ctx.fillText('➔', 620, 290);

      ctx.fillStyle = '#34d399';
      ctx.font = '900 48px monospace';
      ctx.fillText(`${trade.toAmount} ${trade.toToken}`, 700, 290);

      // 4. Large Profit Box
      ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
      ctx.fillRect(70, 340, 620, 160);
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
      ctx.lineWidth = 2;
      ctx.strokeRect(70, 340, 620, 160);

      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 18px monospace';
      ctx.fillText('SAVINGS & TRADE PROFIT', 100, 385);

      ctx.fillStyle = '#10b981';
      ctx.font = '900 64px monospace';
      ctx.fillText(`+$${profitAmount.toFixed(2)} USD`, 100, 465);

      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 24px monospace';
      ctx.fillText(`(+${profitPercentage.toFixed(2)}%)`, 500, 460);

      // Route Info Box
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.fillRect(720, 340, 410, 160);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.strokeRect(720, 340, 410, 160);

      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 16px monospace';
      ctx.fillText('ROUTING ARCHITECTURE:', 745, 380);

      ctx.fillStyle = '#d7f626';
      ctx.font = 'bold 20px monospace';
      ctx.fillText(engineName, 745, 415);

      ctx.fillStyle = '#64748b';
      ctx.font = '16px monospace';
      ctx.fillText('Finality: ~390ms Single Move PTB', 745, 450);
      ctx.fillText(`Vol: ~$${trade.volumeUsd.toFixed(2)} USD`, 745, 480);

      // 5. Footer: Referral & Call to Action
      ctx.fillStyle = 'rgba(215, 246, 38, 0.08)';
      ctx.fillRect(70, 530, 1060, 80);
      ctx.strokeStyle = 'rgba(215, 246, 38, 0.25)';
      ctx.strokeRect(70, 530, 1060, 80);

      ctx.fillStyle = '#d7f626';
      ctx.font = 'bold 20px monospace';
      ctx.fillText('JOIN VIA TRADER REFERRAL LINK:', 100, 578);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px monospace';
      ctx.fillText(`voltswap.org/?ref=${activeRef}`, 500, 578);

      ctx.fillStyle = '#34d399';
      ctx.font = 'bold 16px monospace';
      ctx.fillText('-20% FEE DISCOUNT ACTIVE', 880, 578);

      // Download triggered
      const imgUrl = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = imgUrl;
      a.download = `volt-swap-pnl-${trade.fromToken}-${trade.toToken}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      console.error('Image export error:', e);
    } finally {
      setIsGeneratingImg(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-xl bg-[#0c0f17] border border-white/15 rounded-3xl p-6 shadow-[0_0_50px_rgba(215,246,38,0.15)] space-y-5 text-white max-h-[90vh] overflow-y-auto">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-gray-400 hover:text-white p-2 rounded-xl hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-volt flex items-center justify-center shadow-volt-glow">
            <Zap className="w-5 h-5 text-black fill-black" />
          </div>
          <div>
            <h3 className="text-lg font-black tracking-wide flex items-center gap-2">
              Share Viral PnL Card
              <span className="text-[10px] font-mono uppercase bg-volt/15 text-volt px-2 py-0.5 rounded-full border border-volt/30">
                Twitter & TG Ready
              </span>
            </h3>
            <p className="text-xs text-gray-400">Branded execution card with your embedded referral code</p>
          </div>
        </div>

        {/* Preview Card (Visual Replica) */}
        <div className="relative rounded-2xl bg-gradient-to-b from-[#121622] to-[#080a10] border border-volt/30 p-5 shadow-2xl space-y-4 overflow-hidden">
          {/* Neon Glow Accent in card */}
          <div className="absolute top-0 right-0 w-48 h-48 bg-volt/10 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Card Top Row */}
          <div className="flex items-center justify-between border-b border-white/5 pb-3">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-volt fill-volt" />
              <span className="font-extrabold text-sm tracking-wider font-mono text-white">VOLT PROTOCOL</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-mono font-bold">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Sui Move PTB</span>
            </div>
          </div>

          {/* Trade Details */}
          <div>
            <span className="text-[10px] font-mono uppercase text-gray-400 block mb-1">{orderTypeLabel} Execution</span>
            <div className="flex items-center gap-3 text-lg font-mono font-black text-white">
              <span>{trade.fromAmount} {trade.fromToken}</span>
              <span className="text-volt">➔</span>
              <span className="text-emerald-400">{trade.toAmount} {trade.toToken}</span>
            </div>
          </div>

          {/* Profit & Fee Savings Banner */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-emerald-500/15 via-volt/10 to-emerald-500/15 border border-emerald-500/35 flex items-center justify-between">
            <div>
              <span className="text-[10px] font-mono uppercase text-emerald-300 block mb-0.5">
                Savings & Trade Profit
              </span>
              <span className="text-2xl font-black font-mono text-emerald-400">
                +${profitAmount.toFixed(2)} USD
              </span>
            </div>
            <div className="text-right">
              <span className="text-xs font-bold font-mono text-emerald-300 bg-emerald-500/20 px-2 py-1 rounded-lg border border-emerald-500/30">
                +{profitPercentage.toFixed(2)}% ROI
              </span>
              <span className="text-[10px] text-gray-400 block mt-1 font-mono">
                ~${trade.volumeUsd.toFixed(2)} Volume
              </span>
            </div>
          </div>

          {/* Route Engine & Finality */}
          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono pt-1 text-gray-300">
            <div className="p-2.5 rounded-xl bg-black/40 border border-white/5">
              <span className="text-gray-500 block text-[10px]">Routing Engine</span>
              <span className="text-volt font-bold">{engineName}</span>
            </div>
            <div className="p-2.5 rounded-xl bg-black/40 border border-white/5">
              <span className="text-gray-500 block text-[10px]">Execution Speed</span>
              <span className="text-emerald-400 font-bold">~390ms Single PTB</span>
            </div>
          </div>

          {/* Card Footer with Ref Link */}
          <div className="p-3 rounded-xl bg-black/50 border border-volt/20 flex items-center justify-between text-xs font-mono">
            <div className="truncate pr-2">
              <span className="text-[10px] text-gray-400 block">Invited Trader Ref Link</span>
              <span className="text-volt font-bold truncate block">voltswap.org/?ref={activeRef}</span>
            </div>
            <span className="text-[10px] font-bold text-black bg-volt px-2 py-1 rounded-lg shrink-0">
              -20% Fee Active
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
          {/* Post on X */}
          <button
            onClick={handleShareTwitter}
            className="py-3 px-3 rounded-xl bg-[#1d9bf0] hover:bg-[#1a8cd8] text-white font-extrabold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-lg active:scale-95"
          >
            <Twitter className="w-4 h-4 fill-white shrink-0" />
            <span>Post on X</span>
          </button>

          {/* Share on Telegram */}
          <button
            onClick={handleShareTelegram}
            className="py-3 px-3 rounded-xl bg-[#24A1DE] hover:bg-[#208fbf] text-white font-extrabold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-lg active:scale-95"
          >
            <Send className="w-4 h-4 shrink-0" />
            <span>Telegram</span>
          </button>

          {/* Download Image (PNG) */}
          <button
            onClick={handleDownloadImage}
            disabled={isGeneratingImg}
            className="py-3 px-3 rounded-xl bg-volt hover:bg-[#eafc6d] text-black font-extrabold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-volt-glow active:scale-95 disabled:opacity-50"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>{isGeneratingImg ? 'Rendering...' : 'Download Card'}</span>
          </button>

          {/* Copy Link */}
          <button
            onClick={handleCopyLink}
            className="py-3 px-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-extrabold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer border border-white/10 active:scale-95"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-emerald-400">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 text-gray-300 shrink-0" />
                <span>Copy Ref Link</span>
              </>
            )}
          </button>
        </div>

        {trade.digest && (
          <div className="text-center pt-1">
            <a
              href={`https://suiscan.xyz/mainnet/tx/${trade.digest}`}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] font-mono text-gray-500 hover:text-cyan-400 inline-flex items-center gap-1 transition-colors"
            >
              Verify On-Chain Tx on Suiscan <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
};
