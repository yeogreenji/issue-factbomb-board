import { ArrowUpRight } from "lucide-react";
import { CATEGORY_META, type Issue, type PollSnapshot } from "../types";
import { countLabel, percentOf, timeAgo } from "../lib/format";
import { TempGauge } from "./TempGauge";

interface Props {
  issue: Issue;
  index: number;
  poll: PollSnapshot | null;
  onOpen: (issue: Issue) => void;
}

/** 카드에서 바로 보이는 A/B — 이슈마다 문장이 다르다는 걸 목록에서 확인할 수 있게 합니다. */
function PollTeaser({ issue, compact = false }: { issue: Issue; compact?: boolean }) {
  return (
    <span className={`teaser${compact ? " is-compact" : ""}`}>
      <span className="teaser-q">{issue.poll.question}</span>
      <span className="teaser-opts">
        <span className="teaser-opt" data-side="a">
          <b>A</b>
          <span>{issue.poll.a}</span>
        </span>
        <span className="teaser-vs" aria-hidden="true">
          VS
        </span>
        <span className="teaser-opt" data-side="b">
          <b>B</b>
          <span>{issue.poll.b}</span>
        </span>
      </span>
    </span>
  );
}

function MiniVote({ poll }: { poll: PollSnapshot | null }) {
  if (!poll || poll.total === 0) {
    return (
      <span className="mini-vote is-empty">
        <span className="mini-hint">아직 표가 없어요 · 첫 표를 남겨 보세요</span>
      </span>
    );
  }
  const a = percentOf(poll.counts, "a");
  const b = 100 - a;
  return (
    <span className="mini-vote">
      <span className="mini-bar" aria-hidden="true">
        <span className="mini-a" style={{ width: `${a}%` }} />
        <span className="mini-b" style={{ width: `${b}%` }} />
      </span>
      <span className="mini-nums">
        <b>{a}%</b>
        <span className="mini-dot" aria-hidden="true" />
        <b>{b}%</b>
        <span className="mini-total">· {countLabel(poll.total)}명</span>
        {(poll.comments?.length ?? 0) > 0 && <span className="mini-talk">· 댓글 {poll.comments.length}</span>}
      </span>
    </span>
  );
}

export function FeedCard({ issue, index, poll, onOpen }: Props) {
  const meta = CATEGORY_META[issue.category];
  return (
    <article
      className="card"
      data-testid="feed-card"
      data-issue-id={issue.id}
      style={{ ["--accent" as string]: meta.color }}
    >
      <button
        type="button"
        className="card-hit"
        onClick={() => onOpen(issue)}
        aria-label={`${issue.hook} — 카드뉴스 열기`}
      >
        <span className="card-media">
          {issue.image ? (
            <img
              src={issue.image}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(event) => {
                const parent = event.currentTarget.parentElement;
                if (parent) parent.classList.add("is-empty");
                event.currentTarget.remove();
              }}
            />
          ) : (
            <span className="card-media-fallback" aria-hidden="true">
              {meta.short}
            </span>
          )}
          <span className="card-rank" aria-hidden="true">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="card-temp">
            <TempGauge temp={issue.temp} size="sm" />
          </span>
        </span>

        <span className="card-body">
          <span className="card-meta">
            <span className="chip">{meta.label}</span>
            <span className="card-src">
              {issue.source}
              <span className="dot" aria-hidden="true" />
              {timeAgo(issue.publishedAt)}
              {!issue.ai && (
                <>
                  <span className="dot" aria-hidden="true" />
                  <span className="card-warn">AI 없이 제목</span>
                </>
              )}
            </span>
          </span>
          <span className="card-hook">{issue.hook}</span>
          <PollTeaser issue={issue} compact />
          <MiniVote poll={poll} />
        </span>
      </button>
    </article>
  );
}

export function HeroCard({ issue, poll, onOpen }: { issue: Issue; poll: PollSnapshot | null; onOpen: (issue: Issue) => void }) {
  const meta = CATEGORY_META[issue.category];
  const pctA = poll && poll.total > 0 ? percentOf(poll.counts, "a") : null;
  return (
    <article
      className="hero"
      data-testid="hero-card"
      data-issue-id={issue.id}
      style={{ ["--accent" as string]: meta.color }}
    >
      <button type="button" className="hero-hit" onClick={() => onOpen(issue)} aria-label={`${issue.hook} — 오늘의 1위 카드뉴스 열기`}>
        {issue.image && (
          <img
            className="hero-img"
            src={issue.image}
            alt=""
            referrerPolicy="no-referrer"
            onError={(event) => {
              event.currentTarget.style.display = "none";
            }}
          />
        )}
        <span className="hero-veil" aria-hidden="true" />

        <span className="hero-top">
          <span className="chip chip-onDark">{meta.label}</span>
          <span className="hero-temp">
            <TempGauge temp={issue.temp} size="lg" showBand />
          </span>
        </span>

        <span className="hero-bottom">
          <span className="hero-flag">
            <span className="hero-flag-num">01</span>
            <span className="hero-flag-text">TODAY&apos;S HOTTEST</span>
          </span>
          <span className="hero-hook">{issue.hook}</span>
          <span className="hero-kicker">{issue.kicker}</span>

          <PollTeaser issue={issue} />

          {pctA !== null ? (
            <span className="hero-result">
              <span className="hero-result-bar" aria-hidden="true">
                <span className="hero-result-a" style={{ width: `${pctA}%` }} />
                <span className="hero-result-b" style={{ width: `${100 - pctA}%` }} />
              </span>
              <span className="hero-result-text">
                A {pctA}% · B {100 - pctA}% · {countLabel(poll?.total ?? 0)}명 참여
              </span>
            </span>
          ) : (
            <span className="hero-result-text is-dim">아직 표가 없어요 · 먼저 골라 보세요</span>
          )}

          <span className="hero-foot">
            <span className="hero-src">
              {issue.source}
              <span className="dot" aria-hidden="true" />
              {timeAgo(issue.publishedAt)}
            </span>
            <span className="hero-open">
              카드뉴스로 보기 <ArrowUpRight size={15} />
            </span>
          </span>
        </span>
      </button>
    </article>
  );
}
