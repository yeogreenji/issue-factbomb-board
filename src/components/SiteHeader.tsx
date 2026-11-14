import { useEffect, useState } from 'react';
import { LayoutGrid, PenLine, Trophy } from 'lucide-react';
import type { View } from '../types';
import { clockLabel, formatNumber, todayLabel } from '../lib/format';
import { cn } from './ui';

export type NavKey = 'feed' | 'ranking' | 'editor';

const NAV: { key: NavKey; label: string; icon: typeof LayoutGrid }[] = [
  { key: 'feed', label: '뉴스룸', icon: LayoutGrid },
  { key: 'ranking', label: '팩폭 랭킹', icon: Trophy },
  { key: 'editor', label: '에디터 스튜디오', icon: PenLine },
];

export function SiteHeader({
  view,
  onNavigate,
  issueCount,
}: {
  view: View;
  onNavigate: (key: NavKey) => void;
  issueCount: number;
}) {
  const [now, setNow] = useState(() => new Date());
  const active: NavKey = view.name === 'issue' ? 'feed' : view.name;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-paper/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-[1240px] items-center justify-between gap-4 px-4 sm:px-6">
        <button
          type="button"
          onClick={() => onNavigate('feed')}
          className="flex shrink-0 items-center gap-2.5 text-left"
          aria-label="이슈온도계 홈"
        >
          <span className="relative flex h-9 w-9 items-center justify-center rounded-[11px] bg-ink">
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
              <rect x="9.5" y="2.5" width="5" height="12" rx="2.5" fill="rgba(246,241,232,0.35)" />
              <rect x="10.8" y="7" width="2.4" height="9" rx="1.2" fill="#ff5a2c" />
              <circle cx="12" cy="17" r="4.4" fill="#ff5a2c" />
              <circle cx="12" cy="17" r="1.8" fill="#ffe0d4" />
            </svg>
          </span>
          <span className="leading-none">
            <span className="serif block text-[19px] font-bold tracking-[-0.04em] text-ink">이슈온도계</span>
            <span className="mono mt-1 block text-[8.5px] uppercase tracking-[0.22em] text-faint">
              Factbomb Board
            </span>
          </span>
        </button>

        <nav className="hidden items-center gap-0.5 md:flex" aria-label="주요 메뉴">
          {NAV.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onNavigate(item.key)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'relative inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-semibold transition',
                  isActive ? 'bg-ink text-paper' : 'text-muted hover:bg-paper-deep/70 hover:text-ink',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <div className="hidden text-right lg:block">
            <p className="mono text-[10.5px] tracking-[0.04em] text-ink-2">{todayLabel(now.getTime())}</p>
            <p className="mono text-[9.5px] tracking-[0.06em] text-faint">
              {clockLabel(now.getTime())} 기준 · 이슈 {formatNumber(issueCount)}건
            </p>
          </div>
          <span className="hidden h-8 w-px bg-line sm:block" />
          <button
            type="button"
            onClick={() => onNavigate('editor')}
            className="inline-flex items-center gap-1.5 rounded-full bg-heat px-3.5 py-2 text-[12px] font-bold text-white shadow-[0_8px_20px_-12px_rgba(224,69,31,0.9)] transition hover:bg-heat-deep"
          >
            <PenLine className="h-3.5 w-3.5" />
            이슈 발행
          </button>
        </div>
      </div>

      <div className="border-t border-line/70 md:hidden">
        <nav className="mx-auto flex w-full max-w-[1240px] items-center gap-1 overflow-x-auto px-3 py-2 hide-scroll" aria-label="주요 메뉴">
          {NAV.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onNavigate(item.key)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition',
                  isActive ? 'bg-ink text-paper' : 'text-muted',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
