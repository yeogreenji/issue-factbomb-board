import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Brush,
  Check,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Download,
  FileArchive,
  Link2,
  Lock,
  Share2,
  Sparkles,
  X,
} from "lucide-react";
import { CATEGORY_META, type Issue, type PollSnapshot } from "../types";
import { tempLabel, timeAgo } from "../lib/format";
import { useSwipeDeck } from "../lib/useSwipeDeck";
import { CAPTION_LIMIT, captionFor } from "../lib/share";
import { clearCaption, saveCaption, useActiveBrand, useCaptions, useCopies, usePlan } from "../lib/prefs";
import { entitlements, planLabel } from "../lib/plan";
import { countEditValues } from "../lib/copy";
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
  onOpenStudio: () => void;
  onOpenPricing: () => void;
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
  onOpenStudio,
  onOpenPricing,
  onToast,
}: Props) {
  const { index, wrapRef, trackRef, go, jump, handlers } = useSwipeDeck(SLIDE_COUNT, startIndex);
  const [saving, setSaving] = useState<"one" | "all" | null>(null);
  const [captionOpen, setCaptionOpen] = useState(false);
  const captionRef = useRef<HTMLDivElement | null>(null);
  const [slides, setSlides] = useState<(SlideAsset | null)[]>(() => Array.from({ length: SLIDE_COUNT }, () => null));
  const renderedRef = useRef<SlideAsset[]>([]);
  const meta = CATEGORY_META[issue.category];

  const brand = useActiveBrand();
  const planPrefs = usePlan();
  const can = entitlements(planPrefs.plan);
  const copies = useCopies();
  const captions = useCaptions();
  const edits = copies[issue.id];
  const editCount = useMemo(() => countEditValues(edits), [edits]);

  /* 화면에 보이는 카드 = 저장되는 PNG. 테마·워터마크·고친 문구가 그대로 반영됩니다. */
  useEffect(() => {
    let cancelled = false;
    renderedRef.current = [];
    setSlides(Array.from({ length: SLIDE_COUNT }, () => null));
    const options = { theme: brand.theme, handle: brand.handle };

    void (async () => {
      // 5장을 한꺼번에 그려 첫 장부터 빠르게 뜨게 합니다(사진은 한 번만 받아 옵니다).
      await Promise.all(
        Array.from({ length: SLIDE_COUNT }, (_, slide) =>
          (async () => {
            const asset = await renderSlideAsset(issue, slide, options);
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
          })(),
        ),
      );
    })();

    return () => {
      cancelled = true;
      releaseSlideAssets(renderedRef.current);
      renderedRef.current = [];
    };
  }, [issue, brand.theme, brand.handle]);

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
      await saveSlidePng(issue, index, slides[index] ?? undefined, { theme: brand.theme, handle: brand.handle });
      onToast(`${index + 1}장을 PNG로 저장했어요.`);
    } catch {
      onToast("이미지를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setSaving(null);
    }
  };

  const saveAll = async () => {
    if (saving) return;
    if (!can.batchZip) {
      onToast("5장 ZIP은 Creator Pro에서 열립니다.");
      onOpenPricing();
      return;
    }
    setSaving("all");
    try {
      const ready = slides.every((slide): slide is SlideAsset => Boolean(slide)) ? (slides as SlideAsset[]) : undefined;
      const count = await saveAllCards(issue, ready, { theme: brand.theme, handle: brand.handle });
      onToast(`${count}장을 ZIP 파일로 저장했어요.`);
    } catch {
      onToast("이미지를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setSaving(null);
    }
  };

  /** 캡션은 요금제와 상관없이 완성형(350~450자·해시태그 8~10개)으로 바로 나갑니다 — 계정 운영에 그대로 쓰는 문장. */
  const autoCaption = captionFor(issue, { handle: brand.handle });
  const caption = captions[issue.id] ?? autoCaption;
  const captionEdited = captions[issue.id] !== undefined;
  const ready = slides[index] !== null;

  /* 캡션을 열면 그 패널이 화면 가운데로 — 폰에서 ‘복사’ 버튼이 보이게. */
  useEffect(() => {
    if (!captionOpen) return;
    const timer = window.setTimeout(() => {
      captionRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [captionOpen]);

  return (
    <div className="cn" data-testid="viewer" data-theme={brand.theme} style={{ ["--accent" as string]: meta.ui, ["--accent-soft" as string]: meta.uiSoft }}>
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
              <button
                type="button"
                className="cn-action"
                onClick={() => void saveAll()}
                disabled={saving !== null}
                data-locked={can.batchZip ? "false" : "true"}
                data-testid="save-all"
              >
                {can.batchZip ? <FileArchive size={15} /> : <Lock size={14} />}
                {saving === "all" ? "만드는 중…" : "5장 한 번에"}
                {!can.batchZip && <span className="pro-dot">Pro</span>}
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
              <button type="button" className="cn-action is-edit" onClick={onOpenStudio} data-testid="open-editor">
                <Brush size={15} /> 문구·테마
                {editCount > 0 && <span className="cn-edit-dot" aria-label={`${editCount}칸 수정됨`} />}
              </button>
              <button type="button" className="cn-action is-ghost" onClick={onCopy} data-testid="copy-link">
                <Link2 size={15} /> 링크
              </button>
            </div>

            {captionOpen && (
              <div className="cn-caption" data-testid="caption-panel" ref={captionRef}>
                <div className="cn-caption-head">
                  <b>인스타 캡션 + 해시태그</b>
                  <div className="cn-caption-tools">
                    <button
                      type="button"
                      className="is-ghost"
                      onClick={() => {
                        clearCaption(issue.id);
                        onToast("캡션을 자동 생성으로 되돌렸어요.");
                      }}
                      data-testid="reset-caption"
                    >
                      다시 생성
                    </button>
                    <button type="button" onClick={() => onCopyCaption(caption)} data-testid="copy-caption">
                      <Clipboard size={14} /> 복사
                    </button>
                  </div>
                </div>
                {!issue.ai && (
                  <div className="caption-lock" data-testid="caption-fallback">
                    <Sparkles size={13} />
                    <span>
                      오늘은 AI가 잠깐 쉬어서 <b>헤드라인 카드</b>로 만들었어요. 캡션도 기사 문구 그대로니, 잠시 뒤{" "}
                      <b>다시 생성</b>을 누르면 논쟁 구도까지 세워 드려요.
                    </span>
                  </div>
                )}
                <textarea
                  value={caption}
                  onChange={(event) => saveCaption(issue.id, event.target.value.slice(0, CAPTION_LIMIT))}
                  aria-label="인스타 캡션"
                  data-testid="caption-text"
                  data-edited={captionEdited ? "true" : "false"}
                />
                <div className="cn-caption-meta">
                  <span>
                    {caption.length.toLocaleString("ko-KR")} / {CAPTION_LIMIT.toLocaleString("ko-KR")}자 · 해시태그{" "}
                    {(caption.match(/(^|\s)#[^\s#]+/g) ?? []).length}개
                  </span>
                  {captionEdited ? <span className="is-edited">직접 고친 캡션</span> : <span>자동 생성</span>}
                  <button type="button" className="caption-plan" onClick={onOpenPricing}>
                    {planLabel(planPrefs.plan, planPrefs.trial)}
                  </button>
                </div>
                <p className="cn-caption-help">
                  인스타 앱 → 새 게시물 → 저장한 5장 선택 → 캡션 붙여넣기. 이미지는 '이 장 PNG' 또는 '5장 한 번에'로 받으세요.
                </p>
              </div>
            )}

            <p className="cn-hint" aria-hidden="true">
              <Check size={11} /> 화면의 카드 = 내려받는 PNG · 1080×1350 · 테마 {brand.theme === "editorial" ? "에디토리얼 다크" : brand.theme === "modern" ? "모던 화이트" : brand.theme === "breaking" ? "브레이킹 레드" : "트렌디 파스텔"}
              {brand.handle ? ` · ${brand.handle}` : ""}
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
