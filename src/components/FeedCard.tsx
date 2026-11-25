import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Bookmark, Check } from "lucide-react";
import { CATEGORY_META, type Issue, type PollSnapshot } from "../types";
import { countLabel, percentOf, timeAgo } from "../lib/format";
import { proxiedImage } from "../lib/api";
import { headlineStat, layoutOf, quoteOf, type CardLayout } from "../lib/layout";
import { fallbackPhoto } from "../lib/cardImage";
import { TempGauge } from "./TempGauge";

interface Props {
  issue: Issue;
  index: number;
  poll: PollSnapshot | null;
  recommended?: boolean;
  saved?: boolean;
  published?: boolean;
  onOpen: (issue: Issue) => void;
  onToggleSave?: (issue: Issue) => void;
  onTogglePublished?: (issue: Issue) => void;
}

/**
 * 카드 썸네일 — 첫 화면의 모든 카드가 반드시 '사진'을 갖게 합니다.
 *
 *  ① 기사 사진(대표 → 본문 사진) → ② 같은 출처 프록시(/api/img) → ③ 분야별 실사 사진 풀(public/photos).
 * (예전처럼 캔버스로 표지를 그려 사진 대신 쓰지 않습니다 — 첫 화면이 훨씬 가볍고, 색면도 사라집니다.)
 */
function thumbAttempts(issue: Issue): string[] {
  const direct = [...new Set([...(issue.images ?? []), issue.image].filter(Boolean))];
  const out: string[] = [...direct];
  for (const src of direct) {
    const viaProxy = proxiedImage(src);
    if (viaProxy !== src && !out.includes(viaProxy)) out.push(viaProxy);
  }
  for (let offset = 0; offset < 3; offset += 1) {
    const pool = fallbackPhoto(issue, offset);
    if (!out.includes(pool)) out.push(pool);
  }
  return out;
}

function useThumb(issue: Issue) {
  const attempts = useMemo(() => thumbAttempts(issue), [issue.id, issue.image, issue.images]);
  const [step, setStep] = useState(0);

  useEffect(() => {
    setStep(0);
  }, [attempts]);

  const src = step < attempts.length ? attempts[step] : "";
  const onError = () => setStep((prev) => Math.min(prev + 1, attempts.length));
  return { src, onError, isStock: src.includes("/photos/") };
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

export function FeedCard({
  issue,
  index,
  poll,
  recommended,
  saved,
  published,
  onOpen,
  onToggleSave,
  onTogglePublished,
}: Props) {
  const meta = CATEGORY_META[issue.category];
  const layout: CardLayout = layoutOf(issue, index);
  const thumb = useThumb(issue);
  const stat = headlineStat(issue);
  return (
    <article
      className="card"
      data-testid="feed-card"
      data-layout={layout}
      data-issue-id={issue.id}
      data-recommended={recommended ? "true" : "false"}
      data-saved={saved ? "true" : "false"}
      data-published={published ? "true" : "false"}
      style={{ ["--accent" as string]: meta.ui }}
    >
      <button
        type="button"
        className="card-hit"
        onClick={() => onOpen(issue)}
        aria-label={`${issue.hook} — 카드뉴스 열기`}
      >
        <span className="card-media">
          {thumb.src ? (
            <img
              className="card-thumb"
              src={thumb.src}
              alt=""
              loading={index < 4 ? "eager" : "lazy"}
              referrerPolicy="no-referrer"
              data-thumb={thumb.isStock ? "stock" : "photo"}
              onError={thumb.onError}
            />
          ) : (
            <span className="card-media-fallback" aria-hidden="true">
              {meta.short}
            </span>
          )}
          <span className="card-overlay" aria-hidden="true">
            {layout === "quote" && (
              <>
                <span className="card-quote-mark">“</span>
                <span className="card-quote">{quoteOf(issue) || issue.kicker || issue.hook}</span>
              </>
            )}
            {layout === "stat" && stat && (
              <span className="card-stat">
                <b>{stat.value}</b>
                <i>{stat.unit}</i>
              </span>
            )}
            {layout === "split" && (
              <span className="card-split">
                <span data-side="a">
                  <b>{issue.sides?.labelA || "A"}</b>
                  <span>{issue.poll.a}</span>
                </span>
                <span data-side="b">
                  <b>{issue.sides?.labelB || "B"}</b>
                  <span>{issue.poll.b}</span>
                </span>
              </span>
            )}
            {layout === "breaking" && <span className="card-flash">지금 터진 이야기</span>}
            {layout === "overlay" && issue.kicker && issue.kicker !== issue.hook && (
              <span className="card-kicker">{issue.kicker}</span>
            )}
          </span>
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
            {published && <span className="chip chip-done">발행 완료</span>}
            {recommended && !published && <span className="chip chip-pick">오늘 올릴 카드</span>}
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
          <span className="card-buzz">
            <b>화제 {issue.buzz ?? "-"}</b>
            <span>{issue.temp !== null ? `논란 온도 ${issue.temp}°` : "제목·키워드 화제성"}</span>
          </span>
          <PollTeaser issue={issue} compact />
          <MiniVote poll={poll} />
        </span>
      </button>

      {(onToggleSave || onTogglePublished) && (
        <div className="card-acts">
          {onToggleSave && (
            <button
              type="button"
              className="card-act"
              data-on={saved ? "true" : "false"}
              aria-pressed={Boolean(saved)}
              aria-label={saved ? "저장함에서 빼기" : "저장함에 담기"}
              title={saved ? "저장함에서 빼기" : "저장함에 담기"}
              onClick={() => onToggleSave(issue)}
              data-testid="toggle-save"
            >
              <Bookmark size={15} fill={saved ? "currentColor" : "none"} />
            </button>
          )}
          {onTogglePublished && (
            <button
              type="button"
              className="card-act is-done"
              data-on={published ? "true" : "false"}
              aria-pressed={Boolean(published)}
              aria-label={published ? "발행 완료 취소" : "발행 완료로 표시"}
              title={published ? "발행 완료 취소" : "발행 완료로 표시"}
              onClick={() => onTogglePublished(issue)}
              data-testid="toggle-published"
            >
              <Check size={15} strokeWidth={3} />
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export function HeroCard({ issue, poll, onOpen }: { issue: Issue; poll: PollSnapshot | null; onOpen: (issue: Issue) => void }) {
  const meta = CATEGORY_META[issue.category];
  const pctA = poll && poll.total > 0 ? percentOf(poll.counts, "a") : null;
  const thumb = useThumb(issue);
  return (
    <article
      className="hero"
      data-testid="hero-card"
      data-issue-id={issue.id}
      style={{ ["--accent" as string]: meta.ui }}
    >
      <button type="button" className="hero-hit" onClick={() => onOpen(issue)} aria-label={`${issue.hook} — 오늘의 1위 카드뉴스 열기`}>
        {thumb.src && (
          <img
            className="hero-img"
            src={thumb.src}
            alt=""
            referrerPolicy="no-referrer"
            data-thumb={thumb.isStock ? "stock" : "photo"}
            onError={thumb.onError}
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
