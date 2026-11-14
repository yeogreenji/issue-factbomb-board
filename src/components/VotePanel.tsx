import type { Reaction, ReactionCounts } from '../types';
import { REACTIONS } from '../lib/content';
import { formatNumber } from '../lib/format';
import { cn } from './ui';

export function VotePanel({
  votes,
  myVote,
  onVote,
  tone = 'light',
  compact = false,
}: {
  votes: ReactionCounts;
  myVote?: Reaction;
  onVote: (reaction: Reaction) => void;
  tone?: 'light' | 'dark';
  compact?: boolean;
}) {
  const total = votes.hot + votes.watch + votes.cool;
  const shares: Record<Reaction, number> = {
    hot: total ? Math.round((votes.hot / total) * 100) : 0,
    watch: total ? Math.round((votes.watch / total) * 100) : 0,
    cool: total ? Math.round((votes.cool / total) * 100) : 0,
  };
  const dark = tone === 'dark';

  return (
    <div>
      <div className="mb-2.5 flex items-baseline justify-between">
        <span
          className={cn(
            'mono text-[10px] uppercase tracking-[0.16em]',
            dark ? 'text-white/45' : 'text-faint',
          )}
        >
          🌡️ 여론 온도계
        </span>
        <span className={cn('nums text-[11px]', dark ? 'text-white/45' : 'text-faint')}>
          {formatNumber(total)}명 참여
        </span>
      </div>

      <div className={cn('grid gap-2', compact ? 'grid-cols-3' : 'grid-cols-1')} role="group" aria-label="여론 온도계 투표">
        {REACTIONS.map((reaction) => {
          const count = votes[reaction.id];
          const pct = shares[reaction.id];
          const selected = myVote === reaction.id;
          return (
            <button
              key={reaction.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onVote(reaction.id)}
              className={cn(
                'group relative overflow-hidden rounded-xl border text-left transition no-tap',
                compact ? 'px-2.5 py-2' : 'px-3.5 py-2.5',
                dark
                  ? 'border-white/12 bg-white/[0.04] hover:border-white/25 hover:bg-white/[0.08]'
                  : 'border-line bg-surface hover:border-line-strong hover:bg-paper/60',
                selected &&
                  (dark
                    ? 'border-heat/60 bg-heat/15 ring-1 ring-heat/30'
                    : 'border-heat/35 bg-heat-soft/60 ring-1 ring-heat/15'),
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'absolute inset-y-0 left-0 rounded-r-md opacity-[0.16] transition-[width] duration-700',
                  reaction.bar,
                )}
                style={{ width: `${pct}%` }}
              />
              <span className="relative flex items-center justify-between gap-2">
                <span className={cn('flex items-center gap-1.5 text-[12.5px] font-semibold', dark ? 'text-white/88' : 'text-ink-2')}>
                  <span aria-hidden="true">{reaction.emoji}</span>
                  <span className={compact ? 'text-[11.5px]' : ''}>{reaction.label}</span>
                  {selected ? (
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-px text-[9px] font-bold',
                        dark ? 'bg-heat/30 text-[#ffc7b3]' : 'bg-heat/12 text-heat',
                      )}
                    >
                      내 선택
                    </span>
                  ) : null}
                </span>
                <span className="flex items-baseline gap-1">
                  <span className={cn('nums text-[13px] font-bold', dark ? 'text-white' : 'text-ink')}>{pct}%</span>
                  {!compact ? (
                    <span className={cn('nums text-[10.5px]', dark ? 'text-white/40' : 'text-faint')}>
                      {formatNumber(count)}
                    </span>
                  ) : null}
                </span>
              </span>
              {!compact ? (
                <span className={cn('relative mt-0.5 block text-[10.5px]', dark ? 'text-white/35' : 'text-faint')}>
                  {reaction.hint}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <p className={cn('mt-2 text-[11px]', dark ? 'text-white/40' : 'text-faint')}>
        {total === 0
          ? '아직 투표가 없습니다. 첫 온도를 남겨 주세요.'
          : myVote
            ? '선택은 언제든 바꿀 수 있습니다. 비율과 온도에 바로 반영됩니다.'
            : '누르는 즉시 비율에 반영됩니다. 표가 쌓일수록 온도가 움직입니다.'}
      </p>
    </div>
  );
}
