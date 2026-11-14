import type { Issue } from '../types';
import { formatNumber } from '../lib/format';

export function Ticker({
  issues,
  temps,
  onOpenIssue,
}: {
  issues: Issue[];
  temps: Record<string, number>;
  onOpenIssue: (id: string) => void;
}) {
  const ranked = [...issues].sort((a, b) => (temps[b.id] ?? 0) - (temps[a.id] ?? 0)).slice(0, 7);
  const strip = [...ranked, ...ranked];

  return (
    <div className="marquee-host relative overflow-hidden border-b border-night-3 bg-night text-paper">
      <div className="flex items-center">
        <span className="relative z-10 flex shrink-0 items-center gap-2 bg-heat px-4 py-2 text-[10.5px] font-bold uppercase tracking-[0.14em] text-white">
          <span className="live-dot relative h-1.5 w-1.5 rounded-full bg-white/90" />
          지금 뜨는
        </span>
        <div className="relative min-w-0 flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-night to-transparent" />
          <span className="pointer-events-none absolute inset-y-0 right-0 z-10 w-14 bg-gradient-to-l from-night to-transparent" />
          <div className="marquee-track flex w-max items-center whitespace-nowrap py-2">
            {strip.map((issue, index) => (
              <button
                key={`${issue.id}-${index}`}
                type="button"
                onClick={() => onOpenIssue(issue.id)}
                className="group inline-flex items-center gap-2 px-4 text-[11.5px] text-paper/70 transition hover:text-paper"
              >
                <span className="nums font-bold text-[#ff9c78]">{temps[issue.id] ?? 0}°</span>
                <span className="max-w-[420px] overflow-hidden text-ellipsis">{issue.headline}</span>
                <span className="text-paper/25">/</span>
              </button>
            ))}
          </div>
        </div>
        <span className="mono hidden shrink-0 border-l border-white/10 px-4 text-[9.5px] uppercase tracking-[0.16em] text-paper/35 sm:block">
          {formatNumber(issues.length)} issues · live
        </span>
      </div>
    </div>
  );
}
