import { useEffect, useRef, useState } from "react";
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
import {
  SLIDE_COUNT,
  releaseSlideAssets,
  renderSlideAsset,
  saveAllCards,
  saveSlidePng,
  type SlideAsset,
} from "../lib/cardImage";
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
  const [slides, setSlides] = useState<(SlideAsset | null)[]>(() => Array.from({ length: SLIDE_COUNT }, () => null));
  const renderedRef = useRef<SlideAsset[]>([]);
  const meta = CATEGORY_META[issue.category];

  /* 화면에 보이는 카드 = 저장되는 PNG. 둘 다 같은 캔버스 결과를 씁니다. */
  useEffect(() => {
    let cancelled = false;
    renderedRef.current = [];
    setSlides(Array.from({ length: SLIDE_COUNT }, () => null));

    void (async () => {
      for (let slide = 0; slide < SLIDE_COUNT; slide += 1) {
        const asset = await renderSlideAsset(issue, slide);
        if (cancelled) {
          URL.revokeObjectURL(asset.url);
          return;
        }
        renderedRef.current.push(asset);
        setSlides((prev) => {
          const next = [...prev];
          next[slide] = asset;
          return next;
        });
      }
    })();

    return () => {
      cancelled = true;
      releaseSlideAssets(renderedRef.current);
      renderedRef.current = [];
    };
  }, [issue]);

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
      await saveSlidePng(issue, index, slides[index] ?? undefined);
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
      const ready = slides.every((slide): slide is SlideAsset => Boolean(slide)) ? (slides as SlideAsset[]) : undefined;
      const count = await saveAllCards(issue, ready);
      onToast(`${count}장을 ZIP 파일로 저장했어요.`);
    } catch {
      onToast("이미지를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setSaving(null);
    }
  };

  const caption = captionFor(issue);
  const ready = slides[index] !== null;

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
              {issue.temp === null && issue.buzz !== undefined && ` · 화제 ${issue.buzz}`}
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
                  {Array.from({ length: SLIDE_COUNT }).map((_, i) => {
                    const asset = slides[i];
                    return (
                      <section
                        key={i}
                        className="slide cn-slide"
                        data-testid={`slide-${i + 1}`}
                        data-index={i}
                        data-rendered={Boolean(asset)}
                        aria-hidden={index !== i}
                        aria-label={asset?.text ?? `${i + 1}장을 만드는 중`}
                        role="img"
                      >
                        {asset ? (
                          <img
                            className="cn-slide-img"
                            src={asset.url}
                            alt=""
                            width={1080}
                            height={1350}
                            draggable={false}
                            data-testid={`slide-img-${i + 1}`}
                            data-hash={asset.hash}
                          />
                        ) : (
                          <span className="cn-slide-loading" aria-hidden="true">
                            <span className="cn-slide-shimmer" />
                            <span className="cn-slide-note">{i === 0 ? "표지를 만드는 중…" : "카드를 만드는 중…"}</span>
                          </span>
                        )}
                      </section>
                    );
                  })}
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
              <button
                type="button"
                className="cn-action"
                onClick={() => void saveCurrent()}
                disabled={saving !== null || !ready}
                data-testid="save-png"
              >
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

            <p className="cn-hint" aria-hidden="true">
              화면의 카드와 내려받는 PNG는 같은 이미지예요 · 1080×1350
            </p>
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

/** 표지 한 장만 미리 그려 목록 카드에 보여 줄 때 씁니다(홈 미리보기) — lib/useSlidePreview 로 옮겼습니다. */
