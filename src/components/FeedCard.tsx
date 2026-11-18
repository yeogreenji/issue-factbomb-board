import { ArrowRight } from "lucide-react";
import { CATEGORY_META, type Issue, type PollSnapshot } from "../types";
import { countLabel, percentOf, timeAgo } from "../lib/format";
import { TempGauge } from "./TempGauge";

interface Props {
  issue: Issue;
  index: number;
  poll: PollSnapshot | null;
  onOpen: (issue: Issue) => void;
}

function MiniVote({ poll }: { poll: PollSnapshot | null }) {
  if (!poll || poll.total === 0) {
    return (
      <span className="mini-vote is-empty">
        <span className="mini-hint">A vs B · 아직 아무도 안 골랐어요</span>
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
        {(poll.comments?.length ?? 0) > 0 && (
          <span className="mini-talk">· 댓글 {poll.comments.length}</span>
        )}
      </span>
    </span>
  );
}

export function FeedCard({ issue, index, poll, onOpen }: Props) {
  const meta = CATEGORY_META[issue.category];
  return (
    <article className="card" data-testid="feed-card" data-issue-id={issue.id}>
      <button
        type="button"
        className="card-hit"
        onClick={() => onOpen(issue)}
        aria-label={`${issue.hook} — 카드뉴스 열기`}
      >
        <span className="card-rank" aria-hidden="true">
          {String(index + 1).padStart(2, "0")}
        </span>

        <span className="card-body">
          <span className="card-meta">
            <span className="chip" style={{ ["--chip" as string]: meta.color, ["--chip-soft" as string]: meta.soft }}>
              {meta.label}
            </span>
            <TempGauge temp={issue.temp} size="sm" />
          </span>
          <span className="card-hook">{issue.hook}</span>
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
          <MiniVote poll={poll} />
        </span>

        {issue.image ? (
          <span className="card-thumb" aria-hidden="true">
            <img
              src={issue.image}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(event) => {
                const parent = event.currentTarget.parentElement;
                if (parent) parent.style.display = "none";
              }}
            />
          </span>
        ) : (
          <span className="card-thumb card-thumb-empty" aria-hidden="true" style={{ ["--chip" as string]: meta.color }}>
            {meta.short}
          </span>
        )}
      </button>
    </article>
  );
}

export function HeroCard({ issue, poll, onOpen }: { issue: Issue; poll: PollSnapshot | null; onOpen: (issue: Issue) => void }) {
  const meta = CATEGORY_META[issue.category];
  return (
    <article className="hero" data-testid="hero-card" data-issue-id={issue.id}>
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
          <TempGauge temp={issue.temp} size="sm" />
        </span>
        <span className="hero-bottom">
          <span className="hero-hook">{issue.hook}</span>
          <span className="hero-kicker">{issue.kicker}</span>
          <span className="hero-foot">
            <span className="hero-src">
              {issue.source}
              <span className="dot" aria-hidden="true" />
              {timeAgo(issue.publishedAt)}
            </span>
            {poll && poll.total > 0 && (
              <span className="hero-votes">
                {percentOf(poll.counts, "a")}% vs {percentOf(poll.counts, "b")}% · {countLabel(poll.total)}명
              </span>
            )}
            <span className="hero-open">
              카드뉴스로 보기 <ArrowRight size={15} />
            </span>
          </span>
        </span>
      </button>
    </article>
  );
}
