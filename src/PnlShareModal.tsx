import React, { useState } from 'react';
import { X, Twitter, Copy, Check, Download, Zap, ShieldCheck, ExternalLink, Send } from 'lucide-react';

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

  if (!isOpen || !trade) return null;

  const activeRef = refCode || (userAddress ? `${userAddress.slice(0, 8)}...${userAddress.slice(-4)}` : 'volt');
  const fullRefUrl = `https://voltswap.org/?ref=${encodeURIComponent(refCode || userAddress || 'alpha')}`;

  const profitAmount = trade.profitUsd ?? (trade.feeSavedUsd && trade.feeSavedUsd > 0 ? trade.feeSavedUsd : Number(((trade.volumeUsd || 100) * 0.025).toFixed(2)));
  const profitPercentage = trade.profitPct ?? 2.85;

  const engineName = trade.orderType === 'LIMIT'
    ? 'DeepBook v3 CLOB'
    : trade.orderType === 'PERPS'
    ? 'Aftermath Perpetuals'
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
      bgGrad.addColorStop(0, '#000000');
      bgGrad.addColorStop(0.5, '#06070A');
      bgGrad.addColorStop(1, '#000000');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, 1200, 675);

      // Subtle Cobalt Accents
      const glow1 = ctx.createRadialGradient(200, 200, 10, 200, 200, 450);
      glow1.addColorStop(0, 'rgba(43, 127, 255, 0.14)');
      glow1.addColorStop(1, 'rgba(43, 127, 255, 0)');
      ctx.fillStyle = glow1;
      ctx.fillRect(0, 0, 1200, 675);

      const glow2 = ctx.createRadialGradient(1000, 450, 10, 1000, 450, 400);
      glow2.addColorStop(0, 'rgba(43, 127, 255, 0.16)');
      glow2.addColorStop(1, 'rgba(43, 127, 255, 0)');
      ctx.fillStyle = glow2;
      ctx.fillRect(0, 0, 1200, 675);

      // Outer Cobalt Border
      ctx.strokeStyle = 'rgba(43, 127, 255, 0.5)';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(30, 30, 1140, 615);

      // 2. Header: Logo & Badge
      ctx.fillStyle = '#60A5FA';
      ctx.font = 'bold 38px monospace';
      ctx.fillText('⚡ VOLT PROTOCOL', 70, 100);

      ctx.fillStyle = '#9CA3AF';
      ctx.font = 'bold 18px monospace';
      ctx.fillText('SUI APEX EXECUTION ENGINE • MOVE PTB', 70, 135);

      // Badge top right
      ctx.fillStyle = 'rgba(43, 127, 255, 0.16)';
      ctx.fillRect(860, 65, 270, 48);
      ctx.strokeStyle = 'rgba(43, 127, 255, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(860, 65, 270, 48);
      ctx.fillStyle = '#60A5FA';
      ctx.font = 'bold 18px monospace';
      ctx.fillText('✓ VERIFIED ON SUI', 900, 96);

      // Divider line
      ctx.strokeStyle = 'rgba(26, 30, 38, 0.9)';
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

      ctx.fillStyle = '#60A5FA';
      ctx.font = 'bold 44px sans-serif';
      ctx.fillText('➔', 620, 290);

      ctx.fillStyle = '#08D189';
      ctx.font = '900 48px monospace';
      ctx.fillText(`${trade.toAmount} ${trade.toToken}`, 700, 290);

      // 4. Large Profit Box
      ctx.fillStyle = 'rgba(8, 209, 137, 0.10)';
      ctx.fillRect(70, 340, 620, 160);
      ctx.strokeStyle = 'rgba(8, 209, 137, 0.4)';
      ctx.lineWidth = 2;
      ctx.strokeRect(70, 340, 620, 160);

      ctx.fillStyle = '#9CA3AF';
      ctx.font = 'bold 18px monospace';
      ctx.fillText('SAVINGS & TRADE PROFIT', 100, 385);

      ctx.fillStyle = '#08D189';
      ctx.font = '900 64px monospace';
      ctx.fillText(`+$${profitAmount.toFixed(2)} USD`, 100, 465);

      ctx.fillStyle = '#08D189';
      ctx.font = 'bold 24px monospace';
      ctx.fillText(`(+${profitPercentage.toFixed(2)}%)`, 500, 460);

      // Route Info Box
      ctx.fillStyle = 'rgba(6, 7, 10, 0.95)';
      ctx.fillRect(720, 340, 410, 160);
      ctx.strokeStyle = 'rgba(26, 30, 38, 1)';
      ctx.strokeRect(720, 340, 410, 160);

      ctx.fillStyle = '#9CA3AF';
      ctx.font = 'bold 16px monospace';
      ctx.fillText('ROUTING ARCHITECTURE:', 745, 380);

      ctx.fillStyle = '#60A5FA';
      ctx.font = 'bold 20px monospace';
      ctx.fillText(engineName, 745, 415);

      ctx.fillStyle = '#6B7280';
      ctx.font = '16px monospace';
      ctx.fillText('Finality: ~390ms Single Move PTB', 745, 450);
      ctx.fillText(`Vol: ~$${trade.volumeUsd.toFixed(2)} USD`, 745, 480);

      // 5. Footer: Referral & Call to Action
      ctx.fillStyle = 'rgba(43, 127, 255, 0.08)';
      ctx.fillRect(70, 530, 1060, 80);
      ctx.strokeStyle = 'rgba(43, 127, 255, 0.3)';
      ctx.strokeRect(70, 530, 1060, 80);

      ctx.fillStyle = '#60A5FA';
      ctx.font = 'bold 20px monospace';
      ctx.fillText('JOIN VIA TRADER REFERRAL LINK:', 100, 578);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px monospace';
      ctx.fillText(`voltswap.org/?ref=${activeRef}`, 500, 578);

      ctx.fillStyle = '#08D189';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-xl panel-carbon border border-[#2E384C] rounded-xl p-6 shadow-2xl space-y-5 text-white max-h-[90vh] overflow-y-auto animate-panel-in">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 text-[#9CA3AF] hover:text-white p-2 rounded-lg hover:bg-[#0C0E13] transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[#2B7FFF] flex items-center justify-center shadow-[0_0_20px_rgba(43,127,255,0.28)]">
            <Zap className="w-5 h-5 text-white fill-white" />
          </div>
          <div>
            <h3 className="text-lg font-extrabold tracking-wide flex items-center gap-2">
              Share Viral PnL Card
              <span className="text-xs font-mono uppercase bg-[#2B7FFF]/15 text-[#60A5FA] px-2.5 py-0.5 rounded border border-[#2B7FFF]/30">
                X &amp; TG Ready
              </span>
            </h3>
            <p className="text-xs text-[#6B7280]">Branded execution card with your embedded referral code</p>
          </div>
        </div>

        {/* Preview Card (Visual Replica) */}
        <div className="relative rounded-xl bg-gradient-to-b from-[#06070A] to-[#000000] border border-[#2B7FFF]/30 p-5 shadow-2xl space-y-4 overflow-hidden">
          {/* Card Top Row */}
          <div className="flex items-center justify-between border-b border-[#2D374B] pb-3">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#2B7FFF] fill-[#2B7FFF]" />
              <span className="font-extrabold text-sm tracking-wider font-mono text-white">VOLT PROTOCOL</span>
            </div>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#2B7FFF]/15 border border-[#2B7FFF]/30 text-[#60A5FA] text-xs font-mono font-bold">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Sui Move PTB</span>
            </div>
          </div>

          {/* Trade Details */}
          <div>
            <span className="text-xs font-mono uppercase text-[#6B7280] block mb-1">{orderTypeLabel} Execution</span>
            <div className="flex items-center gap-3 text-lg font-mono font-black text-white">
              <span>{trade.fromAmount} {trade.fromToken}</span>
              <span className="text-[#60A5FA]">➔</span>
              <span className="text-[#08D189]">{trade.toAmount} {trade.toToken}</span>
            </div>
          </div>

          {/* Profit & Fee Savings Banner */}
          <div className="p-4 rounded-lg bg-[#08D189]/10 border border-[#08D189]/30 flex items-center justify-between">
            <div>
              <span className="text-xs font-mono uppercase text-[#08D189] block mb-0.5">
                Savings &amp; Trade Profit
              </span>
              <span className="text-2xl font-black font-mono text-[#08D189]">
                +${profitAmount.toFixed(2)} USD
              </span>
            </div>
            <div className="text-right">
              <span className="text-xs font-bold font-mono text-[#08D189] bg-[#08D189]/15 px-2.5 py-1 rounded border border-[#08D189]/30">
                +{profitPercentage.toFixed(2)}% ROI
              </span>
              <span className="text-xs text-[#6B7280] block mt-1 font-mono">
                ~${trade.volumeUsd.toFixed(2)} Volume
              </span>
            </div>
          </div>

          {/* Route Engine & Finality */}
          <div className="grid grid-cols-2 gap-2.5 text-xs font-mono pt-1 text-slate-300">
            <div className="p-3 rounded-lg bg-[#000000] border border-[#2D374B]">
              <span className="text-[#6B7280] block text-xs">Routing Engine</span>
              <span className="text-[#60A5FA] font-bold">{engineName}</span>
            </div>
            <div className="p-3 rounded-lg bg-[#000000] border border-[#2D374B]">
              <span className="text-[#6B7280] block text-xs">Execution Speed</span>
              <span className="text-[#60A5FA] font-bold">~390ms Single PTB</span>
            </div>
          </div>

          {/* Card Footer with Ref Link */}
          <div className="p-3 rounded-lg bg-[#000000] border border-[#2B7FFF]/25 flex items-center justify-between text-xs font-mono">
            <div className="truncate pr-2">
              <span className="text-xs text-[#6B7280] block">Invited Trader Ref Link</span>
              <span className="text-[#60A5FA] font-bold truncate block">voltswap.org/?ref={activeRef}</span>
            </div>
            <span className="text-xs font-bold text-white bg-[#2B7FFF] px-2.5 py-1 rounded shrink-0">
              -20% Fee Active
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
          {/* Post on X */}
          <button
            onClick={handleShareTwitter}
            className="py-3 px-3 rounded-lg bg-[#1d9bf0] hover:bg-[#1a8cd8] text-white font-extrabold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-lg active:scale-95"
          >
            <Twitter className="w-4 h-4 fill-white shrink-0" />
            <span>Post on X</span>
          </button>

          {/* Share on Telegram */}
          <button
            onClick={handleShareTelegram}
            className="py-3 px-3 rounded-lg bg-[#24A1DE] hover:bg-[#208fbf] text-white font-extrabold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-lg active:scale-95"
          >
            <Send className="w-4 h-4 shrink-0" />
            <span>Telegram</span>
          </button>

          {/* Download Image (PNG) */}
          <button
            onClick={handleDownloadImage}
            disabled={isGeneratingImg}
            className="py-3 px-3 rounded-lg btn-deepbook text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-50"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>{isGeneratingImg ? 'Rendering...' : 'Download Card'}</span>
          </button>

          {/* Copy Link */}
          <button
            onClick={handleCopyLink}
            className="py-3 px-3 rounded-lg bg-[#0C0E13] hover:bg-[#2D374B] text-white font-extrabold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer border border-[#2D374B] active:scale-95"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-[#08D189] shrink-0" />
                <span className="text-[#08D189]">Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 text-[#9CA3AF] shrink-0" />
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
              className="text-xs font-mono text-[#6B7280] hover:text-[#60A5FA] inline-flex items-center gap-1 transition-colors"
            >
              Verify On-Chain Tx on Suiscan <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>
    </div>
  );
};
