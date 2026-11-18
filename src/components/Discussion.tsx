import { useMemo, useState } from "react";
import { Heart, MessageCircle, Send } from "lucide-react";
import type { Issue, PollSnapshot } from "../types";
import { countLabel, percentOf, timeAgo } from "../lib/format";

interface Props {
  issue: Issue;
  poll: PollSnapshot;
  voting: boolean;
  localOnly?: boolean;
  onVote: (choice: "a" | "b") => void;
  onComment: (side: "a" | "b", text: string) => Promise<boolean>;
  onLike: (commentId: string) => void;
}

const MAX_CHARS = 220;

export function Discussion({ issue, poll, voting, localOnly, onVote, onComment, onLike }: Props) {
  const [side, setSide] = useState<"a" | "b">(poll.my ?? "a");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "a" | "b">("all");

  const labelA = poll.a || issue.poll.a;
  const labelB = poll.b || issue.poll.b;
  const pctA = percentOf(poll.counts, "a");
  const pctB = poll.total > 0 ? 100 - pctA : 50;
  const comments = useMemo(
    () => poll.comments.filter((comment) => (filter === "all" ? true : comment.side === filter)),
    [poll.comments, filter],
  );
  const countA = poll.comments.filter((comment) => comment.side === "a").length;
  const countB = poll.comments.filter((comment) => comment.side === "b").length;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (value.length < 2 || busy) return;
    setBusy(true);
    const ok = await onComment(side, value);
    setBusy(false);
    if (ok) setText("");
  };

  return (
    <section className="discuss" data-testid="discussion" aria-label="투표와 토론">
      <div className="discuss-head">
        <h3>
          <MessageCircle size={17} /> 토론
        </h3>
        <span className="discuss-count" data-testid="comment-count">
          댓글 {countLabel(poll.comments.length)}
        </span>
      </div>

      <div className="dlg-vote" data-testid="vote-box">
        <p className="dlg-q" data-testid="poll-question">
          {poll.question || issue.poll.question}
        </p>

        <div className="dlg-rows" data-voted={Boolean(poll.my)}>
          {(["a", "b"] as const).map((key) => {
            const pct = key === "a" ? pctA : pctB;
            const mine = poll.my === key;
            return (
              <button
                key={key}
                type="button"
                className="dlg-row"
                data-side={key}
                data-mine={mine}
                aria-pressed={mine}
                disabled={voting}
                onClick={() => onVote(key)}
                data-testid={`vote-${key}`}
              >
                <span className="dlg-fill" style={{ width: poll.my ? `${pct}%` : "0%" }} aria-hidden="true" />
                <span className="dlg-key" aria-hidden="true">
                  {key.toUpperCase()}
                </span>
                <span className="dlg-label">{key === "a" ? labelA : labelB}</span>
                {poll.my && (
                  <span className="dlg-pct" data-testid={`result-${key}`}>
                    {pct}%
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <p className="dlg-foot" aria-live="polite">
          {poll.total > 0 ? `${countLabel(poll.total)}명 참여` : "첫 표를 남겨 보세요"}
          {poll.my ? " · 다시 누르면 바뀝니다" : ""}
        </p>
      </div>

      <form className="talk-form" onSubmit={submit} data-testid="comment-form">
        <div className="side-toggle" role="group" aria-label="어느 쪽 의견인가요">
          {(["a", "b"] as const).map((key) => (
            <button
              key={key}
              type="button"
              className="side-btn"
              data-side={key}
              data-on={side === key}
              aria-pressed={side === key}
              onClick={() => setSide(key)}
              data-testid={`comment-side-${key}`}
            >
              {key.toUpperCase()} · {key === "a" ? labelA : labelB}
            </button>
          ))}
        </div>

        <div className="talk-input-row">
          <input
            value={text}
            onChange={(event) => setText(event.target.value.slice(0, MAX_CHARS))}
            placeholder={side === "a" ? "A쪽 의견을 한 줄로" : "B쪽 의견을 한 줄로"}
            maxLength={MAX_CHARS}
            aria-label="토론 의견"
            data-testid="comment-input"
          />
          <button type="submit" disabled={busy || text.trim().length < 2} data-testid="comment-submit">
            <Send size={15} /> 남기기
          </button>
        </div>
        <p className="talk-note">
          {localOnly ? "지금은 이 기기에만 저장돼요. 연결되면 함께 집계됩니다. · " : ""}
          {text.length}/{MAX_CHARS}
        </p>
      </form>

      <div className="talk-filter" role="tablist" aria-label="댓글 필터">
        {(
          [
            { key: "all", label: `전체 ${poll.comments.length}` },
            { key: "a", label: `A ${countA}` },
            { key: "b", label: `B ${countB}` },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={filter === tab.key}
            data-on={filter === tab.key}
            onClick={() => setFilter(tab.key)}
            data-testid={`comment-filter-${tab.key}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {comments.length === 0 ? (
        <p className="talk-empty" data-testid="comment-empty">
          아직 댓글이 없어요. 첫 의견을 남겨 보세요.
        </p>
      ) : (
        <ul className="talk-list" data-testid="comment-list">
          {comments.map((comment) => (
            <li key={comment.id} className="talk-item" data-side={comment.side} data-testid="comment-item">
              <div className="talk-meta">
                <span className="talk-side">{comment.side.toUpperCase()}</span>
                <span className="talk-tag">{comment.mine ? "나" : `익명 ${comment.tag}`}</span>
                <span className="talk-time">{timeAgo(comment.at)}</span>
              </div>
              <p className="talk-text">{comment.text}</p>
              <button
                type="button"
                className="talk-like"
                data-on={comment.liked}
                onClick={() => onLike(comment.id)}
                aria-label="공감"
                aria-pressed={comment.liked}
                data-testid="comment-like"
              >
                <Heart size={14} fill={comment.liked ? "currentColor" : "none"} />
                {comment.likes > 0 ? comment.likes : "공감"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
