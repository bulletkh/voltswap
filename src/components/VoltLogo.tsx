import React from 'react';

interface VoltLogoProps {
  className?: string;
  showWordmark?: boolean;
  subtitle?: string;
}

export const VoltLogo: React.FC<VoltLogoProps> = ({
  className = 'w-9 h-9',
  showWordmark = false,
  subtitle = 'SUI PRO',
}) => {
  return (
    <div className="inline-flex items-center gap-2.5 select-none">
      <div className={`relative shrink-0 ${className}`}>
        <div
          className="absolute inset-0 rounded-xl blur-md opacity-45 pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(215,246,38,0.55) 0%, transparent 72%)' }}
        />
        <svg viewBox="0 0 64 64" fill="none" className="relative w-full h-full drop-shadow-[0_2px_10px_rgba(215,246,38,0.28)]">
          <defs>
            <linearGradient id="voltNavBg" x1="8" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#191E26" />
              <stop offset="100%" stopColor="#080A0D" />
            </linearGradient>
            <linearGradient id="voltNavBolt" x1="18" y1="10" x2="46" y2="54" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#F6FF82" />
              <stop offset="52%" stopColor="#D7F626" />
              <stop offset="100%" stopColor="#A6E200" />
            </linearGradient>
            <linearGradient id="voltNavRim" x1="10" y1="6" x2="54" y2="58" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#D7F626" stopOpacity="0.85" />
              <stop offset="55%" stopColor="#D7F626" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#00D98B" stopOpacity="0.45" />
            </linearGradient>
          </defs>
          <path
            d="M32 3L57 17.5V46.5L32 61L7 46.5V17.5L32 3Z"
            fill="url(#voltNavBg)"
            stroke="url(#voltNavRim)"
            strokeWidth="2.4"
          />
          <path
            d="M32 8.5L52 20V44L32 55.5L12 44V20L32 8.5Z"
            stroke="#D7F626"
            strokeOpacity="0.18"
            strokeWidth="1"
          />
          <path
            d="M35.5 13L18.5 34.5H29.5L26.5 51L45.5 28.5H34L35.5 13Z"
            fill="url(#voltNavBolt)"
          />
          <path
            d="M35.5 13L29.5 30H35L35.5 13Z"
            fill="#FFFFFF"
            fillOpacity="0.34"
          />
        </svg>
      </div>

      {showWordmark && (
        <div className="flex items-baseline gap-1.5 leading-none">
          <span className="text-[18px] font-extrabold tracking-tight text-white">
            VOLT
          </span>
          {subtitle && (
            <span className="hidden xl:inline-block px-1.5 py-0.5 rounded bg-[#D7F626]/10 border border-[#D7F626]/30 text-[10px] font-bold tracking-widest text-[#D7F626] uppercase">
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default VoltLogo;
