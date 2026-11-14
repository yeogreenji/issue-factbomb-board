import { ArrowRight, Heart } from 'lucide-react';
import { formatNumber, weekRangeLabel } from '../lib/format';
import type { BestEntry } from '../lib/selectors';
import { cn } from './ui';

export function BestBoard({
  entries,
  liked,
  onLike,
  onOpenIssue,
  onOpenRanking,
  className,
}: {
  entries: BestEntry[];
  liked: string[];
  onLike: (commentId: string) => void;
  onOpenIssue: (issueId: string) => void;
  onOpenRanking: () => void;
  className?: string;
}) {
  return (
    <section className={cn('rounded-2xl border border-line bg-surface p-4 shadow-card', className)}>
      <div className="flex items-start justify-between">
        <div>
          <p className="mono text-[9.5px] uppercase tracking-[0.16em] text-faint">Top of the week</p>
          <h3 className="serif mt-1 flex items-center gap-1.5 text-[17px] font-bold text-ink">
            <span aria-hidden="true">🏆</span> 주간 베스트 팩폭
          </h3>
        </div>
        <span className="mono mt-1 text-[9.5px] text-faint">{weekRangeLabel()}</span>
      </div>

      <ol className="mt-3 divide-y divide-line/70">
        {entries.map((entry, index) => {
          const isLiked = liked.includes(entry.comment.id);
          return (
            <li key={entry.comment.id} className="py-3 first:pt-2 last:pb-1">
              <div className="flex gap-2.5">
                <span
                  className={cn(
                    'nums mono mt-0.5 w-4 shrink-0 text-[12px] font-bold',
                    index === 0 ? 'text-heat' : index < 3 ? 'text-ink-2' : 'text-faint',
                  )}
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => onOpenIssue(entry.issue.id)}
                    className="block w-full text-left"
                  >
                    <p className="serif text-[13.5px] font-semibold leading-[1.45] text-ink transition hover:text-heat-deep">
                      “{entry.comment.text}”
                    </p>
                    <p className="mt-1 truncate text-[10px] text-faint">
                      {entry.issue.headline} · {entry.temp}°
                    </p>
                  </button>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span className="text-[10px] text-muted">{entry.comment.author}</span>
                    <button
                      type="button"
                      onClick={() => onLike(entry.comment.id)}
                      aria-pressed={isLiked}
                      aria-label={`${entry.comment.author}의 팩폭에 좋아요`}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold transition',
                        isLiked ? 'bg-heat-soft text-heat' : 'text-faint hover:bg-paper-deep hover:text-ink-2',
                      )}
                    >
                      <Heart className={cn('h-3 w-3', isLiked && 'fill-current')} />
                      <span className="nums">{formatNumber(entry.comment.likes)}</span>
                    </button>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        onClick={onOpenRanking}
        className="group mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-paper/50 py-2 text-[11.5px] font-semibold text-ink-2 transition hover:border-line-strong hover:bg-paper-deep/60"
      >
        팩폭 랭킹 전체 보기
        <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
      </button>
    </section>
  );
}
