import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Download,
  FileArchive,
  Link2,
  Share2,
  X,
} from "lucide-react";
import { CATEGORY_META, type Issue, type PollSnapshot } from "../types";
import { tempLabel, timeAgo } from "../lib/format";
import { useSwipeDeck } from "../lib/useSwipeDeck";
import { captionFor } from "../lib/share";
import { SLIDE_COUNT, saveAllCards, saveSlidePng } from "../lib/cardImage";
import { TempGauge } from "./TempGauge";
import { Discussion } from "./Discussion";

interface Props {
  issue: Issue;
  poll: PollSnapshot;
  voting: boolean;
  localOnly?: boolean;
  startIndex?: number;
  onClose: () => void;
  onVote: (choice: "a" | "b") => void;
  onComment: (side: "a" | "b", text: string) => Promise<boolean>;
  onLike: (commentId: string) => void;
  onShare: () => void;
  onCopy: () => void;
  onCopyCaption: (caption: string) => void;
  onToast: (message: string) => void;
}

export function CardNewsViewer({
  issue,
  poll,
  voting,
  localOnly,
  startIndex = 0,
  onClose,
  onVote,
  onComment,
  onLike,
  onShare,
  onCopy,
  onCopyCaption,
  onToast,
}: Props) {
  const { index, wrapRef, trackRef, go, jump, handlers } = useSwipeDeck(SLIDE_COUNT, startIndex);
  const [saving, setSaving] = useState<"one" | "all" | null>(null);
  const [captionOpen, setCaptionOpen] = useState(false);
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

  const saveCurrent = async () => {
    if (saving) return;
    setSaving("one");
    try {
      await saveSlidePng(issue, index);
      onToast(`${index + 1}장을 PNG로 저장했어요.`);
    } catch {
      onToast("이미지를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setSaving(null);
    }
  };

  const saveAll = async () => {
    if (saving) return;
    setSaving("all");
    try {
      const count = await saveAllCards(issue);
      onToast(`${count}장을 ZIP 파일로 저장했어요.`);
    } catch {
      onToast("이미지를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setSaving(null);
    }
  };

  const caption = captionFor(issue);

  return (
    <div className="cn" data-testid="viewer" style={{ ["--accent" as string]: meta.color, ["--accent-soft" as string]: meta.soft }}>
      <div className="cn-shell">
        <header className="cn-top">
          <button type="button" className="cn-icon" onClick={onClose} aria-label="닫기" data-testid="close-viewer">
            <X size={18} />
          </button>
          <div className="cn-top-mid">
            <a className="cn-src" href={issue.url} target="_blank" rel="noreferrer noopener">
              {issue.source} <ArrowUpRight size={12} />
            </a>
            <span className="cn-top-meta">
              {timeAgo(issue.publishedAt)}
              {issue.temp !== null && ` · ${issue.temp}° ${tempLabel(issue.temp)}`}
            </span>
          </div>
          <span className="cn-count" aria-hidden="true">
            {index + 1} / {SLIDE_COUNT}
          </span>
          <button type="button" className="cn-icon" onClick={onShare} aria-label="공유" data-testid="share">
            <Share2 size={17} />
          </button>
        </header>

        <div className="cn-scroll">
          <div className="cn-left">
            <div className="cn-progress" aria-hidden="true">
              {Array.from({ length: SLIDE_COUNT }).map((_, i) => (
                <button
                  key={i}
                  type="button"
                  className="cn-seg"
                  data-on={i <= index}
                  aria-label={`${i + 1}장으로 이동`}
                  aria-current={i === index}
                  onClick={() => jump(i)}
                  data-testid={`progress-${i + 1}`}
                />
              ))}
            </div>

            <div className="cn-card">
              <div className="cn-track-wrap" ref={wrapRef} data-testid="slides" data-index={index} {...handlers}>
                <div className="cn-track" ref={trackRef} style={{ transform: `translate3d(${-index * 100}%, 0, 0)` }}>
                  {/* ① 표지 */}
                  <section className="slide cn-cover" data-testid="slide-1" aria-hidden={index !== 0}>
                    <span className="cn-ghost" aria-hidden="true">
                      01
                    </span>
                    <div className="cn-cover-top">
                      <span className="cn-chip">{meta.label}</span>
                      <span className="cn-temp">
                        <TempGauge temp={issue.temp} size="lg" showBand />
                      </span>
                    </div>
                    <div className="cn-cover-text">
                      <span className="cn-cover-eyebrow">TODAY&apos;S ISSUE</span>
                      <h2 className="cn-hook">{issue.hook}</h2>
                      <p className="cn-kicker">{issue.kicker}</p>
                    </div>
                    <p className="cn-cover-foot">
                      <span>{issue.source}</span>
                      <span className="cn-cover-swipe">밀어서 보기 →</span>
                    </p>
                  </section>

                  {/* ② 팩트 3줄 */}
                  <section className="slide cn-facts" data-testid="slide-2" aria-hidden={index !== 1}>
                    <p className="cn-eyebrow">01 · 무슨 일인데</p>
                    <ul className="cn-fact-list">
                      {issue.facts.slice(0, 3).map((fact, i) => (
                        <li key={i}>
                          <span className="cn-fact-num" aria-hidden="true">
                            {i + 1}
                          </span>
                          <span className="cn-fact-text">{fact}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="cn-fact-foot">
                      {issue.tags.length > 0 && (
                        <p className="cn-tags">
                          {issue.tags.map((tag) => (
                            <span key={tag}>#{tag}</span>
                          ))}
                        </p>
                      )}
                      <p className="cn-origin">원제 · {issue.title}</p>
                      {!issue.ai && <p className="cn-note">AI 요약 없이 언론사 제목·요약만 옮겼어요. 자세한 내용은 원문에서 확인해 주세요.</p>}
                      <a className="cn-link" href={issue.url} target="_blank" rel="noreferrer noopener">
                        원문 기사 보기 <ArrowUpRight size={13} />
                      </a>
                    </div>
                  </section>

                  {/* ③ 배경·쟁점 */}
                  <section className="slide cn-issue" data-testid="slide-3" aria-hidden={index !== 2}>
                    <span className="cn-ghost" aria-hidden="true">
                      02
                    </span>
                    <p className="cn-eyebrow">02 · 왜 지금 뜨나</p>
                    <div className="cn-issue-main">
                      <p className="cn-background">{issue.background || issue.kicker}</p>
                      <div className="cn-point">
                        <span>핵심 쟁점</span>
                        <p>{issue.point || issue.poll.question}</p>
                      </div>
                    </div>
                    <p className="cn-slide-foot-note">{issue.source} 보도 · {timeAgo(issue.publishedAt)}</p>
                  </section>

                  {/* ④ A vs B */}
                  <section className="slide cn-sides" data-testid="slide-4" aria-hidden={index !== 3}>
                    <p className="cn-eyebrow">03 · A vs B</p>
                    {issue.sides ? (
                      <div className="cn-side-stack">
                        <div className="cn-side cn-side-a">
                          <span className="cn-side-label">A · {issue.sides.labelA}</span>
                          <p>{issue.sides.a}</p>
                        </div>
                        <span className="cn-vs" aria-hidden="true">
                          VS
                        </span>
                        <div className="cn-side cn-side-b">
                          <span className="cn-side-label">B · {issue.sides.labelB}</span>
                          <p>{issue.sides.b}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="cn-side-empty">
                        <p>이 카드는 AI 요약이 없어 양쪽 입장 정리가 없어요.</p>
                        <a className="cn-link" href={issue.url} target="_blank" rel="noreferrer noopener">
                          원문에서 확인하기 <ArrowUpRight size={13} />
                        </a>
                      </div>
                    )}
                    <p className="cn-slide-foot-note">넘겨서 바로 투표하고 토론해 보세요 →</p>
                  </section>

                  {/* ⑤ 한 줄 팩폭 · 질문 */}
                  <section className="slide cn-question" data-testid="slide-5" aria-hidden={index !== 4}>
                    <span className="cn-vote-ghost" aria-hidden="true">
                      A/B
                    </span>
                    <p className="cn-eyebrow">04 · 당신은?</p>
                    <h3 className="cn-question-hook">{poll.question || issue.poll.question}</h3>
                    {issue.point && <p className="cn-poll-q">{issue.point}</p>}
                    <div className="cn-options">
                      {(["a", "b"] as const).map((key) => (
                        <span key={key} className="cn-option" data-mine={poll.my === key}>
                          <b>{key.toUpperCase()}</b>
                          {key === "a" ? labelA : labelB}
                        </span>
                      ))}
                    </div>
                    <p className="cn-call">댓글로 A 아니면 B, 이유도 한 줄 남겨 주세요</p>
                    <p className="cn-slide-foot-note">{issue.source} · 원문은 카드 링크에서</p>
                  </section>
                </div>
              </div>
            </div>

            <div className="cn-nav">
              <button type="button" onClick={() => go(-1)} disabled={index === 0} aria-label="이전 카드" data-testid="prev">
                <ChevronLeft size={20} />
              </button>
              <div className="cn-dots">
                {Array.from({ length: SLIDE_COUNT }).map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    className="cn-dot"
                    data-on={i === index}
                    aria-label={`${i + 1}장으로 이동`}
                    aria-current={i === index}
                    onClick={() => jump(i)}
                  />
                ))}
              </div>
              {index < SLIDE_COUNT - 1 ? (
                <button type="button" onClick={() => go(1)} aria-label="다음 카드" data-testid="next">
                  <ChevronRight size={20} />
                </button>
              ) : (
                <button type="button" onClick={onClose} aria-label="닫기" className="cn-done">
                  닫기
                </button>
              )}
            </div>

            <div className="cn-actions">
              <button type="button" className="cn-action" onClick={() => void saveCurrent()} disabled={saving !== null} data-testid="save-png">
                <Download size={15} /> {saving === "one" ? "만드는 중…" : "이 장 PNG"}
              </button>
              <button type="button" className="cn-action" onClick={() => void saveAll()} disabled={saving !== null} data-testid="save-all">
                <FileArchive size={15} /> {saving === "all" ? "만드는 중…" : "5장 한 번에"}
              </button>
              <button
                type="button"
                className="cn-action"
                onClick={() => setCaptionOpen((open) => !open)}
                aria-expanded={captionOpen}
                data-testid="open-caption"
              >
                <Clipboard size={15} /> 인스타 캡션
              </button>
              <button type="button" className="cn-action is-ghost" onClick={onCopy} data-testid="copy-link">
                <Link2 size={15} /> 링크
              </button>
            </div>

            {captionOpen && (
              <div className="cn-caption" data-testid="caption-panel">
                <div className="cn-caption-head">
                  <b>인스타 캡션 + 해시태그</b>
                  <button type="button" onClick={() => onCopyCaption(caption)} data-testid="copy-caption">
                    <Clipboard size={14} /> 복사
                  </button>
                </div>
                <textarea readOnly value={caption} data-testid="caption-text" aria-label="인스타 캡션" />
                <p className="cn-caption-help">
                  인스타 앱 → 새 게시물 → 저장한 5장 선택 → 캡션 붙여넣기. 이미지는 '이 장 PNG' 또는 '5장 한 번에'로 받으세요.
                </p>
              </div>
            )}
          </div>

          <Discussion
            issue={issue}
            poll={poll}
            voting={voting}
            localOnly={localOnly}
            onVote={onVote}
            onComment={onComment}
            onLike={onLike}
          />
        </div>
      </div>
    </div>
  );
}
