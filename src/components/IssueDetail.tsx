import { ArrowLeft, MessageCircle, Share2 } from 'lucide-react';
import type { Comment, Issue, Reaction, ReactionCounts } from '../types';
import { formatNumber, relativeTime } from '../lib/format';
import { tempBand } from '../lib/temp';
import { CategoryChip, RichText, cn } from './ui';
import { Thermometer } from './Thermometer';
import { VotePanel } from './VotePanel';
import { CommentBattle } from './CommentBattle';

export function IssueDetail({
  issue,
  temp,
  votes,
  myVote,
  comments,
  liked,
  related,
  onVote,
  onLike,
  onComment,
  onShare,
  onBack,
  onOpenIssue,
}: {
  issue: Issue;
  temp: number;
  votes: ReactionCounts;
  myVote?: Reaction;
  comments: Comment[];
  liked: string[];
  related: { issue: Issue; temp: number }[];
  onVote: (reaction: Reaction) => void;
  onLike: (commentId: string) => void;
  onComment: (text: string) => boolean;
  onShare: () => void;
  onBack: () => void;
  onOpenIssue: (id: string) => void;
}) {
  const band = tempBand(temp);

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6 sm:py-8">
      <button
        type="button"
        onClick={onBack}
        className="group inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted transition hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5 transition group-hover:-translate-x-0.5" />
        오늘의 이슈로
      </button>

      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-10">
        <article className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CategoryChip category={issue.category} />
            {Date.now() - issue.publishedAt < 20 * 60 * 1000 ? (
              <span className="rounded-full bg-heat px-2 py-0.5 text-[10px] font-bold text-white">방금 발행</span>
            ) : null}
            <span className="text-[11px] text-faint">{issue.source} · {relativeTime(issue.publishedAt)}</span>
          </div>

          <h1 className="serif mt-3 text-[28px] font-bold leading-[1.32] tracking-[-0.035em] text-ink sm:text-[36px]">
            {issue.headline}
          </h1>
          <p className="mt-3 text-[13.5px] leading-relaxed text-muted">{issue.kicker}</p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {issue.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-line bg-paper/60 px-2.5 py-0.5 text-[10.5px] text-muted"
              >
                #{tag}
              </span>
            ))}
            <span className="ml-auto inline-flex items-center gap-3 text-[11px] text-faint">
              <span className="inline-flex items-center gap-1">
                <MessageCircle className="h-3.5 w-3.5" />
                {formatNumber(comments.length)}
              </span>
              <button
                type="button"
                onClick={onShare}
                className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-[11px] font-semibold text-ink-2 transition hover:border-line-strong hover:text-heat"
              >
                <Share2 className="h-3 w-3" />
                공유 카드
              </button>
            </span>
          </div>

          <section className="mt-7 rounded-2xl border border-line bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="serif text-[18px] font-bold text-ink">30초 요약</h2>
              <span className="mono text-[9.5px] uppercase tracking-[0.16em] text-faint">3 lines</span>
            </div>
            <ol className="mt-3 divide-y divide-line/70">
              {issue.summary.map((line, index) => (
                <li key={index} className="flex gap-3 py-3 first:pt-1 last:pb-1">
                  <span className="serif mt-0.5 w-6 shrink-0 text-[20px] font-bold leading-none text-heat/35">
                    {index + 1}
                  </span>
                  <p className="text-[13.5px] leading-[1.75] text-ink-2">
                    <RichText text={line} />
                  </p>
                </li>
              ))}
            </ol>
          </section>

          <section className="hero-glow grain relative mt-4 overflow-hidden rounded-2xl p-5 text-white sm:p-6">
            <div className="relative z-10">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="text-[15px]">💼</span>
                <h2 className="serif text-[17px] font-bold">PR·업계인 속마음</h2>
                <span className="mono ml-auto rounded-full border border-white/15 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em] text-white/45">
                  insider take
                </span>
              </div>
              <p className="serif mt-3 text-[15px] leading-[1.85] text-white/85 sm:text-[16.5px]">
                <RichText text={issue.insider} className="[&>strong]:text-white" />
              </p>
              <p className="mt-4 border-t border-white/12 pt-3 text-[11px] text-white/40">
                뉴스 요약은 어디에나 있습니다. 이 보드는 “그래서 업계에서는 이렇게 읽는다”를 남깁니다.
              </p>
            </div>
          </section>

          <div className="mt-5 lg:hidden">
            <div className="rounded-2xl border border-line bg-surface p-5">
              <div className="mb-4 flex items-end justify-between">
                <div>
                  <p className="mono text-[9.5px] uppercase tracking-[0.16em] text-faint">여론 온도</p>
                  <p className="mt-1 flex items-baseline gap-1">
                    <span className={cn('nums serif text-[56px] font-black leading-none tracking-[-0.06em]', band.text)}>
                      {temp}
                    </span>
                    <span className={cn('text-lg font-semibold', band.text)}>°</span>
                    <span className="ml-2 text-[11.5px] text-muted">
                      {band.emoji} {band.label}
                    </span>
                  </p>
                </div>
                <Thermometer temp={temp} size="md" />
              </div>
              <VotePanel votes={votes} myVote={myVote} onVote={onVote} />
            </div>
          </div>

          <div className="mt-5">
            <CommentBattle
              issueId={issue.id}
              comments={comments}
              liked={liked}
              onLike={onLike}
              onSubmit={onComment}
              onLimit={() => onComment('')}
            />
          </div>
        </article>

        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-4">
            <div className="rounded-2xl border border-line bg-surface p-5 shadow-card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="mono text-[9.5px] uppercase tracking-[0.16em] text-faint">여론 온도</p>
                  <p className="mt-1 flex items-baseline gap-1">
                    <span className={cn('nums serif text-[58px] font-black leading-none tracking-[-0.06em]', band.text)}>
                      {temp}
                    </span>
                    <span className={cn('text-lg font-semibold', band.text)}>°</span>
                  </p>
                  <p className="mt-1 text-[11.5px] font-semibold text-ink-2">
                    {band.emoji} {band.label} · {band.note}
                  </p>
                </div>
                <Thermometer temp={temp} size="md" />
              </div>
              <div className="mt-4 border-t border-line/70 pt-4">
                <VotePanel votes={votes} myVote={myVote} onVote={onVote} />
              </div>
              <button
                type="button"
                onClick={onShare}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-paper/50 py-2.5 text-[12px] font-semibold text-ink-2 transition hover:border-line-strong hover:text-heat"
              >
                <Share2 className="h-3.5 w-3.5" />
                이 온도로 공유 카드 만들기
              </button>
            </div>

            {related.length > 0 ? (
              <div className="rounded-2xl border border-line bg-surface p-4">
                <p className="mono text-[9.5px] uppercase tracking-[0.16em] text-faint">같은 카테고리</p>
                <ul className="mt-2 divide-y divide-line/70">
                  {related.map((item) => (
                    <li key={item.issue.id}>
                      <button
                        type="button"
                        onClick={() => onOpenIssue(item.issue.id)}
                        className="group flex w-full items-start gap-2 py-2.5 text-left"
                      >
                        <span className="nums mt-0.5 w-7 shrink-0 text-[11px] font-bold text-heat">{item.temp}°</span>
                        <span className="clamp-2 text-[12px] leading-snug text-ink-2 transition group-hover:text-heat-deep">
                          {item.issue.headline}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
