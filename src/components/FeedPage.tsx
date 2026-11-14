import { useMemo, useState } from 'react';
import { ArrowRight, Flame, PenLine, Thermometer as ThermometerIcon, TrendingUp } from 'lucide-react';
import type { CategoryId, Comment, Issue, Reaction } from '../types';
import { CATEGORIES } from '../lib/content';
import { formatNumber } from '../lib/format';
import type { BoardApi } from '../hooks/useBoard';
import { bestEntries } from '../lib/selectors';
import { HeroIssue } from './HeroIssue';
import { IssueCard } from './IssueCard';
import { CategoryTabs, type SortKey } from './CategoryTabs';
import { BestBoard } from './BestBoard';
import { SectionHead } from './ui';
import type { NavKey } from './SiteHeader';

export function FeedPage({
  board,
  onOpenIssue,
  onShare,
  onNavigate,
}: {
  board: BoardApi;
  onOpenIssue: (id: string) => void;
  onShare: (issue: Issue) => void;
  onNavigate: (key: NavKey) => void;
}) {
  const [category, setCategory] = useState<CategoryId | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('temp');

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const issue of board.issues) map[issue.category] = (map[issue.category] ?? 0) + 1;
    return map;
  }, [board.issues]);

  const hero = useMemo(
    () =>
      [...board.issues].sort(
        (a, b) => (board.temps[b.id] ?? 0) - (board.temps[a.id] ?? 0),
      )[0],
    [board.issues, board.temps],
  );

  const feed = useMemo(() => {
    const list = board.issues.filter((issue) => category === 'all' || issue.category === category);
    return list.sort((a, b) =>
      sort === 'temp'
        ? (board.temps[b.id] ?? 0) - (board.temps[a.id] ?? 0)
        : b.publishedAt - a.publishedAt,
    );
  }, [board.issues, board.temps, category, sort]);

  const best = useMemo(
    () => bestEntries(board.comments, board.issues, board.temps, 5),
    [board.comments, board.issues, board.temps],
  );

  const categoryTemps = useMemo(
    () =>
      CATEGORIES.map((cat) => {
        const issues = board.issues.filter((issue) => issue.category === cat.id);
        const avg = issues.length
          ? issues.reduce((sum, issue) => sum + (board.temps[issue.id] ?? 0), 0) / issues.length
          : 0;
        return { ...cat, avg: Math.round(avg), count: issues.length };
      }),
    [board.issues, board.temps],
  );

  const commentCountOf = (issueId: string) =>
    board.comments.filter((comment: Comment) => comment.issueId === issueId).length;

  const topVote = hero ? board.myVotes[hero.id] : undefined;
  const voteFor = (issueId: string) => (reaction: Reaction) => board.vote(issueId, reaction);

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-5 sm:px-6 sm:py-7">
      {hero ? (
        <HeroIssue
          issue={hero}
          temp={board.temps[hero.id] ?? 0}
          votes={board.votesOf(hero.id)}
          myVote={topVote}
          commentCount={commentCountOf(hero.id)}
          onVote={voteFor(hero.id)}
          onOpen={() => onOpenIssue(hero.id)}
          onShare={() => onShare(hero)}
        />
      ) : null}

      <div className="mt-5 grid grid-cols-2 gap-y-4 rounded-2xl border border-line bg-surface px-5 py-4 sm:grid-cols-4 sm:divide-x sm:divide-line">
        {[
          { label: '오늘의 이슈', value: formatNumber(board.issues.length), suffix: '건', hint: '4개 카테고리' },
          {
            label: '평균 여론 온도',
            value: board.averageTemp.toFixed(1),
            suffix: '°',
            hint: '투표 반영 실시간',
          },
          { label: '누적 투표', value: formatNumber(board.totalVotes), suffix: '명', hint: '익명 참여' },
          { label: '팩폭', value: formatNumber(board.comments.length), suffix: '개', hint: '한 줄 100자' },
        ].map((stat) => (
          <div key={stat.label} className="px-0 sm:px-4 sm:first:pl-0 sm:last:pr-0">
            <p className="mono text-[9.5px] uppercase tracking-[0.16em] text-faint">{stat.label}</p>
            <p className="mt-1 flex items-baseline gap-1">
              <span className="nums text-[22px] font-bold tracking-tight text-ink">{stat.value}</span>
              <span className="text-[11px] font-medium text-muted">{stat.suffix}</span>
            </p>
            <p className="mt-0.5 text-[10.5px] text-faint">{stat.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-7 grid gap-7 lg:grid-cols-[minmax(0,1fr)_336px] lg:gap-8">
        <section className="min-w-0">
          <SectionHead
            eyebrow="Today's briefing"
            title="이슈 피드"
            action={
              <span className="nums inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[10.5px] font-semibold text-muted">
                <Flame className="h-3 w-3 text-heat" />
                {feed.length}건 · {sort === 'temp' ? '온도순' : '최신순'}
              </span>
            }
          />

          <div className="mt-4">
            <CategoryTabs
              active={category}
              counts={counts}
              onChange={setCategory}
              sort={sort}
              onSortChange={setSort}
            />
          </div>

          {feed.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-line-strong bg-surface/60 px-5 py-14 text-center">
              <p className="serif text-[16px] font-semibold text-ink">이 카테고리는 아직 비어 있습니다.</p>
              <p className="mt-1 text-[12px] text-muted">에디터 스튜디오에서 첫 이슈를 발행해 보세요.</p>
              <button
                type="button"
                onClick={() => onNavigate('editor')}
                className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-[11.5px] font-bold text-paper transition hover:bg-heat"
              >
                <PenLine className="h-3.5 w-3.5" />
                이슈 발행하기
              </button>
            </div>
          ) : (
            <div className="mt-4 grid gap-3.5 sm:grid-cols-2">
              {feed.map((issue, index) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  index={index}
                  temp={board.temps[issue.id] ?? 0}
                  votes={board.votesOf(issue.id)}
                  commentCount={commentCountOf(issue.id)}
                  onOpen={() => onOpenIssue(issue.id)}
                  onShare={() => onShare(issue)}
                />
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <BestBoard
            entries={best}
            liked={board.likedComments}
            onLike={board.toggleLike}
            onOpenIssue={onOpenIssue}
            onOpenRanking={() => onNavigate('ranking')}
          />

          <section className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex items-center justify-between">
              <h3 className="serif flex items-center gap-1.5 text-[15px] font-bold text-ink">
                <ThermometerIcon className="h-4 w-4 text-heat" />
                오늘의 온도 지도
              </h3>
              <span className="mono text-[9px] uppercase tracking-[0.14em] text-faint">avg</span>
            </div>
            <ul className="mt-3 space-y-3">
              {categoryTemps.map((category) => (
                <li key={category.id}>
                  <div className="flex items-baseline justify-between text-[11px]">
                    <button
                      type="button"
                      onClick={() => setCategory(category.id)}
                      className="font-semibold text-ink-2 transition hover:text-heat"
                    >
                      {category.label}
                      <span className="ml-1.5 text-[9.5px] font-normal text-faint">{category.count}</span>
                    </button>
                    <span className="nums font-bold text-ink">{category.avg}°</span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-paper-deep">
                    <div
                      className="temp-fill h-full rounded-full bg-gradient-to-r from-[#e6c98c] via-[#ee7a2c] to-[#d0341a]"
                      style={{ width: `${Math.max(6, category.avg)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-line bg-paper-deep/60 p-4">
            <p className="mono text-[9.5px] uppercase tracking-[0.16em] text-faint">이 보드 읽는 법</p>
            <ul className="mt-2.5 space-y-2.5">
              {[
                { n: '01', title: '3줄 요약', body: '30초 안에 무슨 일이 있었는지' },
                { n: '02', title: '업계인 속마음', body: '뉴스에는 안 나오는 현장의 해석' },
                { n: '03', title: '여론 온도계', body: '눌러서 온도를 움직이는 3지선다' },
              ].map((item) => (
                <li key={item.n} className="flex gap-2.5">
                  <span className="mono mt-0.5 text-[9.5px] font-bold text-heat">{item.n}</span>
                  <div>
                    <p className="text-[11.5px] font-semibold text-ink-2">{item.title}</p>
                    <p className="text-[10.5px] leading-relaxed text-muted">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <button
            type="button"
            onClick={() => onNavigate('editor')}
            className="group relative w-full overflow-hidden rounded-2xl border border-night-3 bg-night p-4 text-left text-white"
          >
            <span className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-heat/25 blur-2xl transition group-hover:bg-heat/40" />
            <span className="relative flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#ff9c78]">
              <TrendingUp className="h-3 w-3" />
              Editor studio
            </span>
            <p className="serif relative mt-2 text-[16px] font-bold leading-snug">
              업계인만 아는 이야기,
              <br />
              한 줄로 남겨 두세요.
            </p>
            <p className="relative mt-1.5 text-[11px] leading-relaxed text-white/45">
              메모를 붙여넣으면 3줄 요약과 속마음 초안이 잡힙니다.
            </p>
            <span className="relative mt-3 inline-flex items-center gap-1 text-[11.5px] font-bold text-white">
              이슈 발행하기
              <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
            </span>
          </button>
        </aside>
      </div>
    </div>
  );
}
