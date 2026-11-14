import { useId } from 'react';
import { tempBand } from '../lib/temp';
import { cn } from './ui';

const COLORS: Record<string, [string, string, string]> = {
  blazing: ['#ff8a52', '#e0451f', '#9d260a'],
  hot: ['#ffb877', '#ee7a2c', '#a8501a'],
  watch: ['#f0d9a2', '#c9a24a', '#96742a'],
  mild: ['#c9dbcd', '#8fae99', '#5f7f6c'],
  cool: ['#a9d6e2', '#4e9cb6', '#245c72'],
};

const HEIGHTS = { sm: 132, md: 190, hero: 268 } as const;

export function Thermometer({
  temp,
  tone = 'light',
  size = 'md',
  withTicks = true,
  className,
}: {
  temp: number;
  tone?: 'light' | 'dark';
  size?: keyof typeof HEIGHTS;
  withTicks?: boolean;
  className?: string;
}) {
  const band = tempBand(temp);
  const [top, mid, bottom] = COLORS[band.id];
  const gradientId = useId().replace(/:/g, '');
  const clipId = useId().replace(/:/g, '');
  const trackFill = tone === 'dark' ? 'rgba(255,255,255,0.10)' : '#eadfcb';
  const tubeFill = tone === 'dark' ? 'rgba(255,255,255,0.06)' : '#f7f0e2';
  const tubeStroke = tone === 'dark' ? 'rgba(255,255,255,0.18)' : '#ddcfb6';
  const tickColor = tone === 'dark' ? 'rgba(255,255,255,0.28)' : 'rgba(23,19,15,0.18)';
  const ratio = Math.max(0.02, Math.min(1, temp / 100));

  return (
    <div className={cn('relative flex items-end justify-center', className)}>
      <svg
        viewBox="0 0 76 300"
        style={{ height: HEIGHTS[size] }}
        className="w-auto overflow-visible"
        role="img"
        aria-label={`여론 온도 ${temp}도, ${band.label}`}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={bottom} />
            <stop offset="55%" stopColor={mid} />
            <stop offset="100%" stopColor={top} />
          </linearGradient>
          <clipPath id={clipId}>
            <rect x="26" y="8" width="24" height="228" rx="12" />
          </clipPath>
        </defs>

        {temp >= 85 ? (
          <circle cx="38" cy="258" r="42" fill={mid} opacity="0.22" />
        ) : null}

        {/* tube */}
        <rect x="26" y="8" width="24" height="228" rx="12" fill={tubeFill} stroke={tubeStroke} strokeWidth="1.5" />
        <rect x="31" y="13" width="14" height="218" rx="7" fill={trackFill} />

        {/* mercury */}
        <g clipPath={`url(#${clipId})`}>
          <rect
            x="31"
            y="13"
            width="14"
            height="218"
            fill={`url(#${gradientId})`}
            style={{
              transform: `scaleY(${ratio})`,
              transformOrigin: '38px 231px',
              transition: 'transform 1s cubic-bezier(0.22, 0.9, 0.25, 1)',
            }}
          />
        </g>

        {/* bulb */}
        <circle cx="38" cy="262" r="24" fill={`url(#${gradientId})`} />
        <circle cx="38" cy="262" r="24" fill="none" stroke={tubeStroke} strokeWidth="1.5" />
        <circle cx="31" cy="255" r="6" fill="#ffffff" opacity="0.38" />

        {withTicks
          ? [0, 25, 50, 75, 100].map((tick) => {
              const y = 231 - (tick / 100) * 213;
              return (
                <g key={tick}>
                  <line x1="52" y1={y} x2={tick % 50 === 0 ? 62 : 58} y2={y} stroke={tickColor} strokeWidth="1.5" strokeLinecap="round" />
                </g>
              );
            })
          : null}
      </svg>
    </div>
  );
}

/** Thin vertical temperature rail used on feed cards. */
export function TempRail({ temp, className }: { temp: number; className?: string }) {
  const band = tempBand(temp);
  const height = Math.max(8, Math.min(100, temp));
  return (
    <div className={cn('relative flex h-full w-1.5 flex-col justify-end overflow-hidden rounded-full bg-paper-deep', className)}>
      <div
        className={cn('temp-fill w-full rounded-full bg-gradient-to-t', band.bar)}
        style={{ height: `${height}%` }}
      />
    </div>
  );
}
