import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Link2,
  MessageCircle,
  Share2,
  X,
} from "lucide-react";
import { CATEGORY_META, type Issue, type PollSnapshot } from "../types";
import { countLabel, percentOf, tempLabel, timeAgo } from "../lib/format";
import { useSwipeDeck } from "../lib/useSwipeDeck";
import { TempGauge } from "./TempGauge";

interface Props {
  issue: Issue;
  poll: PollSnapshot;
  voting: boolean;
  onClose: () => void;
  onVote: (choice: "a" | "b") => void;
  onReact: (text: string) => Promise<boolean>;
  onShare: () => void;
  onCopy: () => void;
}

const SLIDES = 4;

export function CardNewsViewer({ issue, poll, voting, onClose, onVote, onReact, onShare, onCopy }: Props) {
  const { index, wrapRef, trackRef, go, jump, handlers } = useSwipeDeck(SLIDES);
  const meta = CATEGORY_META[issue.category];
  const labelA = poll.a || issue.poll.a;
  const labelB = poll.b || issue.poll.b;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") go(1);
      if (event.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose, go]);

  return (
    <div className="viewer" data-testid="viewer" style={{ ["--accent" as string]: meta.color }}>
      <div className="viewer-shell">
        <div className="viewer-top">
          <div className="progress">
            {Array.from({ length: SLIDES }).map((_, i) => (
              <button
                key={i}
                type="button"
                className="progress-seg"
                data-on={i <= index}
                aria-label={`${i + 1}장으로 이동`}
                aria-current={i === index}
                onClick={() => jump(i)}
                data-testid={`progress-${i + 1}`}
              />
            ))}
          </div>
          <div className="viewer-bar">
            <a className="viewer-src" href={issue.url} target="_blank" rel="noreferrer noopener">
              {issue.source}
              <ArrowUpRight size={13} />
            </a>
            <span className="viewer-count" aria-hidden="true">
              {index + 1} / {SLIDES}
            </span>
            <button type="button" className="viewer-close" onClick={onClose} aria-label="닫기" data-testid="close-viewer">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="slides-wrap" ref={wrapRef} data-testid="slides" data-index={index} {...handlers}>
          <div className="slides" ref={trackRef} style={{ transform: `translate3d(${-index * 100}%, 0, 0)` }}>
            {/* ① 표지 */}
            <section className="slide slide-cover" data-testid="slide-1" aria-hidden={index !== 0}>
              <div className="cover-full" style={{ ["--chip" as string]: meta.color }}>
                {issue.image ? (
                  <img
                    className="cover-photo"
                    src={issue.image}
                    alt=""
                    draggable={false}
                    referrerPolicy="no-referrer"
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                ) : (
                  <span className="cover-glyph" aria-hidden="true">
                    {meta.short}
                  </span>
                )}
                <span className="cover-shade" aria-hidden="true" />
                <div className="cover-top">
                  <span className="chip chip-onDark">{meta.label}</span>
                  <span className="cover-temp">
                    <TempGauge temp={issue.temp} size="sm" />
                  </span>
                </div>
                <div className="cover-text">
                  <h2 className="cover-hook">{issue.hook}</h2>
                  <p className="cover-kicker">{issue.kicker}</p>
                  <p className="cover-src">
                    {issue.source}
                    <span> · {timeAgo(issue.publishedAt)}</span>
                    {issue.temp !== null && <span> · 지금 {issue.temp}° {tempLabel(issue.temp)}</span>}
                  </p>
                </div>
                <p className="cover-next">
                  3장 더 있어요 · 옆으로 넘기세요 <ChevronRight size={13} />
                </p>
              </div>
            </section>

            {/* ② 무슨 일인데 */}
            <section className="slide slide-facts" data-testid="slide-2" aria-hidden={index !== 1}>
              <span className="slide-ghost" aria-hidden="true">
                01
              </span>
              <p className="eyebrow">01 · 무슨 일인데</p>
              <div className="slide-body">
                <ul className="facts">
                  {issue.facts.slice(0, 2).map((fact, i) => (
                    <li key={i}>
                      <span className="fact-num" aria-hidden="true">
                        {i + 1}
                      </span>
                      <span className="fact-text">{fact}</span>
                    </li>
                  ))}
                </ul>
                {issue.tags.length > 0 && (
                  <div className="slide-tags">
                    {issue.tags.map((tag) => (
                      <span key={tag} className="slide-tag-chip">
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="slide-foot">
                <p className="origin-title">원제 · {issue.title}</p>
                {!issue.ai && (
                  <p className="slide-note">
                    AI 요약이 꺼져 있어 언론사 제목과 요약만 옮겼어요. 자세한 내용은 원문에서 확인해 주세요.
                  </p>
                )}
                <a className="slide-link" href={issue.url} target="_blank" rel="noreferrer noopener">
                  원문 기사 보기 <ArrowUpRight size={14} />
                </a>
              </div>
            </section>

            {/* ③ 어디서 갈리나 */}
            <section className="slide slide-sides" data-testid="slide-3" aria-hidden={index !== 2}>
              <span className="slide-ghost" aria-hidden="true">
                02
              </span>
              <p className="eyebrow">02 · 어디서 갈리나</p>
              <div className="slide-body">
                {issue.sides ? (
                  <div className="sides">
                    <div className="side side-a">
                      <span className="side-tag">한쪽은</span>
                      <p>{issue.sides.a}</p>
                    </div>
                    <div className="side-vs" aria-hidden="true">
                      VS
                    </div>
                    <div className="side side-b">
                      <span className="side-tag">다른 쪽은</span>
                      <p>{issue.sides.b}</p>
                    </div>
                  </div>
                ) : (
                  <div className="sides-empty">
                    <p>이 카드는 AI 요약이 없어 양쪽 입장 정리가 없어요.</p>
                    <a className="slide-link" href={issue.url} target="_blank" rel="noreferrer noopener">
                      원문에서 확인하기 <ArrowUpRight size={14} />
                    </a>
                  </div>
                )}
              </div>
              <div className="slide-foot">
                <p className="slide-hint">넘겨서 바로 투표해 보세요 →</p>
              </div>
            </section>

            {/* ④ 투표 */}
            <section className="slide slide-vote" data-testid="slide-4" aria-hidden={index !== 3}>
              <span className="slide-ghost" aria-hidden="true">
                03
              </span>
              <p className="eyebrow">03 · 당신은?</p>
              <div className="slide-body">
                <h3 className="vote-q">{poll.question}</h3>

                <div className="opts" data-voted={Boolean(poll.my)}>
                  {(["a", "b"] as const).map((side) => {
                    const pct = percentOf(poll.counts, side);
                    const mine = poll.my === side;
                    return (
                      <button
                        key={side}
                        type="button"
                        className="opt"
                        data-side={side}
                        data-mine={mine}
                        aria-pressed={mine}
                        onClick={() => onVote(side)}
                        disabled={voting}
                        data-testid={`vote-${side}`}
                      >
                        <span className="opt-bar" style={{ width: `${poll.my ? pct : 0}%` }} aria-hidden="true" />
                        <span className="opt-line">
                          <span className="opt-key" aria-hidden="true">
                            {side.toUpperCase()}
                          </span>
                          <span className="opt-label">{side === "a" ? labelA : labelB}</span>
                          {poll.my && (
                            <span className="opt-pct" data-testid={`result-${side}`}>
                              {pct}%
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <p className="vote-foot" aria-live="polite">
                  {poll.total > 0 ? `${countLabel(poll.total)}명 참여` : "첫 표를 남겨 보세요"}
                  {poll.my ? " · 다시 누르면 바뀝니다" : ""}
                </p>

                <Reactions poll={poll} onReact={onReact} />
              </div>
              <div className="slide-foot share-row">
                <button type="button" className="share-btn" onClick={onShare} data-testid="share">
                  <Share2 size={16} /> 공유하기
                </button>
                <button type="button" className="share-btn is-ghost" onClick={onCopy} data-testid="copy-link">
                  <Link2 size={16} /> 링크 복사
                </button>
              </div>
            </section>
          </div>
        </div>

        <div className="viewer-nav">
          <button type="button" onClick={() => go(-1)} disabled={index === 0} aria-label="이전 카드" data-testid="prev">
            <ChevronLeft size={20} />
          </button>
          <div className="dots">
            {Array.from({ length: SLIDES }).map((_, i) => (
              <button
                key={i}
                type="button"
                className="dot-item"
                data-on={i === index}
                aria-label={`${i + 1}장으로 이동`}
                aria-current={i === index}
                onClick={() => jump(i)}
              />
            ))}
          </div>
          {index < SLIDES - 1 ? (
            <button type="button" onClick={() => go(1)} aria-label="다음 카드" data-testid="next">
              <ChevronRight size={20} />
            </button>
          ) : (
            <button type="button" onClick={onClose} aria-label="닫기" className="nav-done">
              닫기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Reactions({ poll, onReact }: { poll: PollSnapshot; onReact: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const list = poll.reactions.slice(-4).reverse();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (value.length < 2 || busy) return;
    setBusy(true);
    const ok = await onReact(value);
    setBusy(false);
    if (ok) setText("");
  };

  return (
    <div className="react-block">
      <form className="react-form" onSubmit={submit}>
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="한 줄로 한마디 (선택)"
          maxLength={60}
          aria-label="한 줄 반응"
          data-testid="reaction-input"
        />
        <button type="submit" disabled={busy || text.trim().length < 2} data-testid="reaction-submit">
          <MessageCircle size={15} />
          남기기
        </button>
      </form>
      {list.length > 0 && (
        <ul className="react-list" data-testid="reaction-list">
          {list.map((item, i) => (
            <li key={`${item.at}-${i}`}>
              <span className="react-tag">{item.tag}</span>
              {item.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
