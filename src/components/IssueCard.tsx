import { MessageCircle, Share2 } from 'lucide-react';
import type { Issue, ReactionCounts } from '../types';
import { formatNumber, relativeTime } from '../lib/format';
import { tempBand, topReaction, totalVotes } from '../lib/temp';
import { CategoryChip, RichText, cn } from './ui';
import { TempRail } from './Thermometer';

export function IssueCard({
  issue,
  temp,
  votes,
  commentCount,
  onOpen,
  onShare,
  index = 0,
}: {
  issue: Issue;
  temp: number;
  votes: ReactionCounts;
  commentCount: number;
  onOpen: () => void;
  onShare: () => void;
  index?: number;
}) {
  const band = tempBand(temp);
  const leader = topReaction(votes);
  const total = totalVotes(votes);
  const isFresh = Date.now() - issue.publishedAt < 20 * 60 * 1000;

  return (
    <article
      className="group relative flex gap-3.5 rounded-2xl border border-line bg-surface p-4 transition duration-300 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift sm:gap-4 sm:p-5 animate-rise"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <TempRail temp={temp} className="mt-0.5 hidden shrink-0 self-stretch sm:flex" />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <CategoryChip category={issue.category} size="xs" />
            {isFresh ? (
              <span className="rounded-full bg-heat px-2 py-0.5 text-[10px] font-bold text-white">방금 발행</span>
            ) : null}
            {issue.editorPick ? (
              <span className="rounded-full border border-gold/30 bg-gold-soft px-2 py-0.5 text-[10px] font-semibold text-gold">
                에디터 픽
              </span>
            ) : null}
            <span className="text-[10.5px] text-faint">{relativeTime(issue.publishedAt)}</span>
          </div>
          <div className="flex shrink-0 items-start">
            <div className="text-right">
              <span className="nums text-[26px] font-bold leading-none tracking-[-0.05em] text-ink">
                {temp}
                <span className={cn('ml-0.5 align-top text-[11px]', band.text)}>°</span>
              </span>
              <span className={cn('mono mt-1 block text-[9px] uppercase tracking-[0.12em]', band.text)}>
                {band.label}
              </span>
            </div>
          </div>
        </div>

        <button type="button" onClick={onOpen} className="mt-2 block w-full text-left">
          <h3 className="serif text-[19px] font-bold leading-[1.42] tracking-[-0.03em] text-ink transition group-hover:text-heat-deep sm:text-[21px]">
            {issue.headline}
          </h3>
          <p className="mt-1.5 text-[11.5px] text-muted">{issue.kicker}</p>
        </button>

        <ol className="mt-3 space-y-1.5">
          {issue.summary.map((line, i) => (
            <li key={i} className="flex gap-2">
              <span className="mono mt-[3px] shrink-0 text-[9px] font-semibold tracking-[0.06em] text-faint">
                0{i + 1}
              </span>
              <span className="clamp-2 text-[12.5px] leading-[1.62] text-ink-2">
                <RichText text={line} />
              </span>
            </li>
          ))}
        </ol>

        <button
          type="button"
          onClick={onOpen}
          className="mt-3 flex w-full items-start gap-2 rounded-xl border border-[#e8dbc4] bg-[#f8f1e4] px-3 py-2.5 text-left transition hover:border-[#d8c4a3] hover:bg-[#f5ecdb]"
        >
          <span aria-hidden="true" className="mt-px text-[12px]">💼</span>
          <span className="min-w-0">
            <span className="mono mb-0.5 block text-[9px] font-semibold uppercase tracking-[0.14em] text-[#a8804a]">
              업계인 속마음
            </span>
            <span className="clamp-2 block text-[11.5px] leading-[1.6] text-[#6b5942]">
              <RichText text={issue.insider} />
            </span>
          </span>
        </button>

        <div className="mt-3.5 flex items-center justify-between gap-3 border-t border-line/70 pt-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-1.5 w-16 overflow-hidden rounded-full bg-paper-deep sm:w-20">
              {total > 0 ? (
                <>
                  <span className="h-full bg-heat" style={{ width: `${(votes.hot / total) * 100}%` }} />
                  <span className="h-full bg-gold" style={{ width: `${(votes.watch / total) * 100}%` }} />
                  <span className="h-full bg-cool" style={{ width: `${(votes.cool / total) * 100}%` }} />
                </>
              ) : null}
            </div>
            <span className="nums truncate text-[10.5px] text-faint">
              {leader && total > 0
                ? `${leader.reaction === 'hot' ? '🔥' : leader.reaction === 'watch' ? '🤔' : '❄️'} ${Math.round((leader.count / total) * 100)}% · ${formatNumber(total)}명`
                : '투표 없음'}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className="inline-flex items-center gap-1 px-1 text-[10.5px] text-faint">
              <MessageCircle className="h-3.5 w-3.5" />
              {formatNumber(commentCount)}
            </span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onShare();
              }}
              aria-label="공유 카드 만들기"
              className="rounded-full p-1.5 text-faint transition hover:bg-paper-deep hover:text-ink"
            >
              <Share2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
