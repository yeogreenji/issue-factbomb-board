import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Heart, Trophy } from 'lucide-react';
import type { CategoryId } from '../types';
import { CATEGORIES } from '../lib/content';
import { formatNumber, weekRangeLabel } from '../lib/format';
import { cn } from './ui';
import type { BestEntry } from '../lib/selectors';

export function RankingPage({
  entries,
  liked,
  onLike,
  onOpenIssue,
  onBack,
}: {
  entries: BestEntry[];
  liked: string[];
  onLike: (commentId: string) => void;
  onOpenIssue: (issueId: string) => void;
  onBack: () => void;
}) {
  const [filter, setFilter] = useState<CategoryId | 'all'>('all');

  const filtered = useMemo(
    () =>
      entries
        .filter((entry) => filter === 'all' || entry.issue.category === filter)
        .sort((a, b) => b.comment.likes - a.comment.likes || b.comment.createdAt - a.comment.createdAt),
    [entries, filter],
  );

  const podium = filtered.slice(0, 3);
  const rest = filtered.slice(3);
  const totalLikes = filtered.reduce((sum, entry) => sum + entry.comment.likes, 0);

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-7 sm:px-6 sm:py-9">
      <button
        type="button"
        onClick={onBack}
        className="group inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted transition hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5 transition group-hover:-translate-x-0.5" />
        뉴스룸으로
      </button>

      <header className="mt-4 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="mono text-[10px] uppercase tracking-[0.18em] text-faint">Weekly fact bomb · {weekRangeLabel()}</p>
          <h1 className="serif mt-1.5 text-[28px] font-bold tracking-[-0.035em] text-ink sm:text-[36px]">
            이번 주, 가장 아픈 한 줄
          </h1>
          <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-muted">
            독자가 직접 남긴 한 줄 팩폭을 좋아요로 정렬했습니다. 문장은 짧을수록 오래 남습니다.
          </p>
        </div>
        <div className="flex items-center gap-5">
          <div>
            <p className="mono text-[9.5px] uppercase tracking-[0.14em] text-faint">팩폭</p>
            <p className="nums text-[22px] font-bold text-ink">{formatNumber(filtered.length)}</p>
          </div>
          <span className="h-9 w-px bg-line" />
          <div>
            <p className="mono text-[9.5px] uppercase tracking-[0.14em] text-faint">좋아요</p>
            <p className="nums text-[22px] font-bold text-ink">{formatNumber(totalLikes)}</p>
          </div>
        </div>
      </header>

      <div className="-mx-1 mt-5 flex items-center gap-1.5 overflow-x-auto px-1 pb-1 hide-scroll">
        <button
          type="button"
          onClick={() => setFilter('all')}
          aria-pressed={filter === 'all'}
          className={cn(
            'shrink-0 rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition',
            filter === 'all' ? 'border-ink bg-ink text-paper' : 'border-line bg-surface text-ink-2 hover:border-line-strong',
          )}
        >
          전체
        </button>
        {CATEGORIES.map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => setFilter(category.id)}
            aria-pressed={filter === category.id}
            className={cn(
              'shrink-0 rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition',
              filter === category.id
                ? 'border-ink bg-ink text-paper'
                : 'border-line bg-surface text-ink-2 hover:border-line-strong',
            )}
          >
            {category.label}
          </button>
        ))}
      </div>

      {podium.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-dashed border-line-strong bg-surface/60 px-4 py-16 text-center text-[13px] text-muted">
          이 카테고리에는 아직 팩폭이 없습니다. 첫 한 줄을 남겨 보세요.
        </p>
      ) : (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {podium.map((entry, index) => {
            const first = index === 0;
            const isLiked = liked.includes(entry.comment.id);
            return (
              <article
                key={entry.comment.id}
                className={cn(
                  'relative flex flex-col overflow-hidden rounded-2xl border p-5',
                  first
                    ? 'hero-glow grain border-night-3 text-white md:col-span-2'
                    : 'border-line bg-surface text-ink',
                )}
              >
                <div className="relative z-10 flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        'mono text-[10px] font-bold uppercase tracking-[0.16em]',
                        first ? 'text-white/45' : 'text-faint',
                      )}
                    >
                      Rank {String(index + 1).padStart(2, '0')}
                    </span>
                    {first ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-heat px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.1em] text-white">
                        <Trophy className="h-2.5 w-2.5" />
                        Best
                      </span>
                    ) : null}
                  </div>
                  <span className={cn('nums text-[12px] font-semibold', first ? 'text-white/60' : 'text-muted')}>
                    {entry.temp}°
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => onOpenIssue(entry.issue.id)}
                  className={cn(
                    "relative z-10 mt-3 flex flex-col text-left",
                    first ? "gap-6 md:flex-row md:items-end" : "flex-1 justify-start",
                  )}
                >
                  <p
                    className={cn(
                      'serif font-semibold leading-[1.55]',
                      first ? 'text-[19px] text-white sm:text-[26px]' : 'text-[15px] text-ink',
                    )}
                  >
                    “{entry.comment.text}”
                  </p>
                  <p
                    className={cn(
                      'clamp-2 text-[10.5px] leading-relaxed',
                      first ? 'text-white/45 md:mt-0 md:max-w-[320px] md:text-right' : 'mt-3 text-faint',
                    )}
                  >
                    {entry.issue.headline}
                  </p>
                </button>

                <div
                  className={cn(
                    'relative z-10 mt-3 flex items-center justify-between border-t pt-3',
                    first ? 'border-white/12' : 'border-line/70',
                  )}
                >
                  <span className={cn('text-[10.5px]', first ? 'text-white/50' : 'text-muted')}>{entry.comment.author}</span>
                  <button
                    type="button"
                    onClick={() => onLike(entry.comment.id)}
                    aria-pressed={isLiked}
                    aria-label="이 팩폭에 좋아요"
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition',
                      isLiked
                        ? first
                          ? 'bg-heat/25 text-[#ffcdbc]'
                          : 'bg-heat-soft text-heat'
                        : first
                          ? 'bg-white/10 text-white/70 hover:bg-white/15'
                          : 'text-faint hover:bg-paper-deep hover:text-ink-2',
                    )}
                  >
                    <Heart className={cn('h-3 w-3', isLiked && 'fill-current')} />
                    <span className="nums">{formatNumber(entry.comment.likes)}</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {rest.length > 0 ? (
        <section className="mt-6 overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="serif text-[15px] font-bold text-ink">이어지는 팩폭</h2>
            <span className="mono text-[9.5px] uppercase tracking-[0.14em] text-faint">{filtered.length - 3} more</span>
          </div>
          <ol className="divide-y divide-line/70">
            {rest.map((entry, index) => {
              const isLiked = liked.includes(entry.comment.id);
              return (
                <li key={entry.comment.id} className="flex items-start gap-3 px-4 py-3.5">
                  <span className="mono mt-1 w-6 shrink-0 text-[12px] font-bold text-faint">
                    {String(index + 4).padStart(2, '0')}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenIssue(entry.issue.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="serif text-[14px] font-semibold leading-[1.5] text-ink transition hover:text-heat-deep">
                      “{entry.comment.text}”
                    </p>
                    <p className="mt-1 truncate text-[10px] text-faint">
                      {entry.comment.author} · {entry.issue.headline} · {entry.temp}°
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => onLike(entry.comment.id)}
                    aria-pressed={isLiked}
                    aria-label="이 팩폭에 좋아요"
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-semibold transition',
                      isLiked ? 'bg-heat-soft text-heat' : 'text-faint hover:bg-paper-deep hover:text-ink-2',
                    )}
                  >
                    <Heart className={cn('h-3 w-3', isLiked && 'fill-current')} />
                    <span className="nums">{formatNumber(entry.comment.likes)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-paper-deep/50 px-4 py-4">
        <p className="text-[12px] text-muted">
          내 한 줄도 이 랭킹에 들어갈 수 있습니다. 이슈를 열고 팩폭을 남겨 보세요.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="group inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-[11.5px] font-bold text-paper transition hover:bg-heat"
        >
          이슈 보러 가기
          <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  );
}
