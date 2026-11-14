import { ArrowRight, MessageCircle, Share2 } from 'lucide-react';
import type { Issue, Reaction, ReactionCounts } from '../types';
import { CATEGORY_MAP } from '../lib/content';
import { formatNumber, relativeTime } from '../lib/format';
import { tempBand, topReaction, totalVotes } from '../lib/temp';
import { RichText, cn } from './ui';
import { Thermometer } from './Thermometer';
import { VotePanel } from './VotePanel';

export function HeroIssue({
  issue,
  temp,
  votes,
  myVote,
  commentCount,
  onVote,
  onOpen,
  onShare,
}: {
  issue: Issue;
  temp: number;
  votes: ReactionCounts;
  myVote?: Reaction;
  commentCount: number;
  onVote: (reaction: Reaction) => void;
  onOpen: () => void;
  onShare: () => void;
}) {
  const band = tempBand(temp);
  const category = CATEGORY_MAP[issue.category];
  const leader = topReaction(votes);
  const total = totalVotes(votes);

  return (
    <section
      aria-label="오늘의 최고 온도 이슈"
      className="hero-glow grain relative overflow-hidden rounded-[26px] text-white shadow-[0_40px_90px_-60px_rgba(23,19,15,0.9)] animate-rise"
    >
      <div className="relative z-10 grid gap-9 p-6 sm:p-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-10 lg:p-10">
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="relative inline-flex items-center gap-1.5 rounded-full bg-heat px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-white">
              <span className="live-dot relative h-1.5 w-1.5 rounded-full bg-white/90" />
              Live
            </span>
            <span className="mono text-[10px] uppercase tracking-[0.2em] text-white/40">Today&apos;s hottest</span>
            <span className="h-3 w-px bg-white/15" />
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-white/55">
              <span className={cn('h-1.5 w-1.5 rounded-full', category.dot)} />
              {category.label}
            </span>
            <span className="text-[11.5px] text-white/35">{issue.source} · {relativeTime(issue.publishedAt)}</span>
          </div>

          <h1 className="serif mt-5 text-[27px] font-bold leading-[1.28] tracking-[-0.035em] sm:text-[34px] lg:text-[42px]">
            {issue.headline}
          </h1>

          <p className="mt-3 text-[13px] leading-relaxed text-white/55">{issue.kicker}</p>

          <div className="mt-4 flex items-center gap-3 lg:hidden">
            <span className="nums serif text-[38px] font-black leading-none tracking-[-0.06em] text-white">
              {temp}
              <span className="ml-0.5 align-top text-[13px] font-semibold text-white/50">°</span>
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-white/12">
                {total > 0 ? (
                  <>
                    <span className="h-full bg-heat" style={{ width: `${(votes.hot / total) * 100}%` }} />
                    <span className="h-full bg-[#d8ab55]" style={{ width: `${(votes.watch / total) * 100}%` }} />
                    <span className="h-full bg-[#5aa7bd]" style={{ width: `${(votes.cool / total) * 100}%` }} />
                  </>
                ) : null}
              </div>
              <p className="mt-1.5 text-[11px] text-white/45">
                {band.emoji} {band.label} · 투표 {formatNumber(total)}명
              </p>
            </div>
          </div>

          <ol className="mt-6 space-y-0 border-t border-white/12">
            {issue.summary.map((line, index) => (
              <li
                key={index}
                className="flex gap-3 border-b border-white/8 py-2.5 last:border-b-0"
              >
                <span className="mono mt-0.5 shrink-0 text-[10px] font-semibold tracking-[0.1em] text-[#ff9c78]">
                  0{index + 1}
                </span>
                <span className="text-[13px] leading-[1.65] text-white/78">
                  <RichText text={line} className="[&>strong]:text-white" />
                </span>
              </li>
            ))}
          </ol>

          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onOpen}
              className="group inline-flex items-center gap-2 rounded-full bg-white px-4.5 py-2.5 text-[13px] font-bold text-ink transition hover:bg-[#ffe9df]"
            >
              3줄 요약 · 속마음 전체 보기
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </button>
            <button
              type="button"
              onClick={onShare}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/18 px-3.5 py-2.5 text-[12.5px] font-semibold text-white/80 transition hover:border-white/35 hover:text-white"
            >
              <Share2 className="h-3.5 w-3.5" />
              공유 카드
            </button>
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-white/40">
              <MessageCircle className="h-3.5 w-3.5" />
              팩폭 {formatNumber(commentCount)}개
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-5 border-t border-white/12 pt-6 lg:border-l lg:border-t-0 lg:pl-9 lg:pt-0">
          <div className="hidden items-center justify-between gap-4 lg:flex">
            <div>
              <span className="mono text-[10px] uppercase tracking-[0.2em] text-white/40">여론 온도</span>
              <div className="mt-1 flex items-start">
                <span className="nums serif text-[76px] font-black leading-[0.85] tracking-[-0.07em] text-white">
                  {temp}
                </span>
                <span className="mt-1 text-2xl font-semibold text-white/50">°</span>
              </div>
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-white/85 ring-1 ring-white/15">
                <span aria-hidden="true">{band.emoji}</span>
                {band.label} · {band.note}
              </div>
              <p className="mt-2.5 text-[11.5px] leading-relaxed text-white/40">
                {leader && total > 0
                  ? `${formatNumber(leader.count)}명이 “${leader.reaction === 'hot' ? '불타는 중' : leader.reaction === 'watch' ? '지켜보는 중' : '훈훈·냉각'}”에 투표했습니다.`
                  : '아직 투표가 없습니다. 첫 온도를 남겨 주세요.'}
              </p>
            </div>
            <Thermometer temp={temp} tone="dark" size="md" className="shrink-0" />
          </div>

          <VotePanel votes={votes} myVote={myVote} onVote={onVote} tone="dark" />
        </div>
      </div>
    </section>
  );
}
