import { useEffect, useMemo, useState } from "react";
import { FileText, Lock, Palette, RotateCcw, Sparkles, Stamp, X } from "lucide-react";
import type { CardCopy, CardCopyEdits, Issue } from "../types";
import { copyFromIssue, applyCopy } from "../lib/copy";
import { usePlan, type BrandPrefs } from "../lib/prefs";
import { normalizeHandle } from "../lib/prefs";
import { CARD_THEME_LIST } from "../lib/theme";
import { entitlements } from "../lib/plan";
import { LiveCardPreview, FeedGridPreview } from "./StudioPreview";

interface Props {
  open: boolean;
  /** null이면 브랜드 설정만(테마·워터마크). */
  issue: Issue | null;
  /** 그리드 미리보기에 함께 놓을 최근 카드들. */
  recent: Issue[];
  brand: BrandPrefs;
  edits: CardCopyEdits | undefined;
  onClose: () => void;
  onBrand: (patch: Partial<BrandPrefs>) => void;
  onSaveCopy: (edits: CardCopyEdits) => void;
  onResetCopy: () => void;
  onOpenPricing: () => void;
}

type FieldKey = keyof CardCopy;

interface FieldSpec {
  key: FieldKey;
  label: string;
  hint?: string;
  long?: boolean;
  max: number;
}

/** 카드 한 장에 인쇄되는 칸 — 여기 있는 것만 고칠 수 있습니다. */
const SLIDES: { tab: string; title: string; note: string; fields: FieldSpec[] }[] = [
  {
    tab: "① 표지",
    title: "① 표지",
    note: "인스타 썸네일 — 훅이 제일 크게 박힙니다.",
    fields: [
      { key: "hook", label: "헤드라인(훅)", long: true, max: 90 },
      { key: "kicker", label: "한 줄 부제", long: true, max: 80 },
    ],
  },
  {
    tab: "② 팩트",
    title: "② 무슨 일인데",
    note: "팩트 3줄. 숫자는 자동으로 형광펜 처리됩니다.",
    fields: [
      { key: "facts", label: "팩트 1", long: true, max: 90 },
      { key: "facts", label: "팩트 2", long: true, max: 90 },
      { key: "facts", label: "팩트 3", long: true, max: 90 },
    ],
  },
  {
    tab: "③ 쟁점",
    title: "③ 왜 지금 뜨나",
    note: "배경 설명과 핵심 쟁점 한 줄.",
    fields: [
      { key: "background", label: "배경", long: true, max: 160 },
      { key: "point", label: "핵심 쟁점", long: true, max: 90 },
    ],
  },
  {
    tab: "④ A vs B",
    title: "④ A vs B",
    note: "두 진영의 이름과 주장. 카드에서 가장 크게 갈립니다.",
    fields: [
      { key: "labelA", label: "A 진영 이름", max: 18 },
      { key: "sideA", label: "A 주장", long: true, max: 70 },
      { key: "labelB", label: "B 진영 이름", max: 18 },
      { key: "sideB", label: "B 주장", long: true, max: 70 },
    ],
  },
  {
    tab: "⑤ 투표",
    title: "⑤ 당신의 선택",
    note: "투표 질문과 선택지 — 앱 투표·캡션에도 같은 문구가 나갑니다.",
    fields: [
      { key: "question", label: "투표 질문", long: true, max: 60 },
      { key: "optionA", label: "선택지 A", max: 34 },
      { key: "optionB", label: "선택지 B", max: 34 },
    ],
  },
];

const KEYS = [
  "hook",
  "kicker",
  "background",
  "point",
  "labelA",
  "labelB",
  "sideA",
  "sideB",
  "question",
  "optionA",
  "optionB",
] as const;

/** 원문과 다른 칸만 골라 편집값으로 — 저장·되돌리기 판단에 함께 씁니다. */
function diffCopy(draft: CardCopy, original: CardCopy): CardCopyEdits {
  const out: CardCopyEdits = {};
  for (const key of KEYS) {
    if (draft[key].trim() !== original[key].trim()) out[key] = draft[key].trim();
  }
  const facts = draft.facts.map((fact, index) => (fact.trim() === original.facts[index].trim() ? fact : fact.trim()));
  if (facts.some((fact, index) => fact !== original.facts[index])) out.facts = facts;
  return out;
}

function canon(edits: CardCopyEdits | undefined): string {
  if (!edits) return "[]";
  return JSON.stringify(
    Object.keys(edits)
      .sort()
      .map((key) => [key, (edits as Record<string, unknown>)[key]]),
  );
}

export function CardStudioSheet({
  open,
  issue,
  recent,
  brand,
  edits,
  onClose,
  onBrand,
  onSaveCopy,
  onResetCopy,
  onOpenPricing,
}: Props) {
  const planPrefs = usePlan();
  const can = entitlements(planPrefs.plan);

  const original = useMemo<CardCopy | null>(() => (issue ? copyFromIssue(issue) : null), [issue]);
  const base = useMemo<CardCopy | null>(() => (issue ? copyFromIssue(applyCopy(issue, edits)) : null), [issue, edits]);
  const [draft, setDraft] = useState<CardCopy | null>(base);
  const [slide, setSlide] = useState(0);
  const [handle, setHandle] = useState(brand.handle);
  const [savedFlash, setSavedFlash] = useState(false);

  /* 카드가 바뀌면 편집실도 그 카드의 현재 문구로 다시 채웁니다. */
  useEffect(() => {
    setDraft(base);
    setSlide(0);
    setSavedFlash(false);
  }, [base]);

  useEffect(() => {
    setHandle(brand.handle);
  }, [brand.handle]);

  useEffect(() => {
    if (!savedFlash) return;
    const timer = setTimeout(() => setSavedFlash(false), 1600);
    return () => clearTimeout(timer);
  }, [savedFlash]);

  const setField = (key: FieldKey, value: string, index = 0) => {
    setDraft((prev) => {
      if (!prev) return prev;
      if (key === "facts") {
        const facts = [...prev.facts];
        facts[index] = value;
        return { ...prev, facts };
      }
      return { ...prev, [key]: value };
    });
  };

  const nextEdits = useMemo<CardCopyEdits>(
    () => (draft && original ? diffCopy(draft, original) : {}),
    [draft, original],
  );
  const changed = Object.keys(nextEdits).length;
  const dirty = canon(nextEdits) !== canon(edits);

  /** 편집 중인 문구를 얹은 카드 — 미리보기(화면·PNG와 같은 캔버스)가 이 객체로 그려집니다. */
  const draftIssue = useMemo(() => {
    if (!issue || !draft) return null;
    return applyCopy(issue, diffCopy(draft, original ?? draft));
  }, [issue, draft, original]);

  const previewIssue = draftIssue ?? recent[0] ?? null;
  const previewSlide = draftIssue ? slide : 0;

  if (!open) return null;

  /** 닫아도 작업을 잃지 않도록 — 저장하지 않은 수정이 있으면 닫을 때 반영합니다. */
  const closeWithCommit = () => {
    const nextHandle = can.customHandle ? normalizeHandle(handle) : brand.handle;
    if (nextHandle !== brand.handle) onBrand({ handle: nextHandle });
    if (issue && dirty) onSaveCopy(nextEdits);
    onClose();
  };

  const commitHandle = () => {
    if (!can.customHandle) {
      onOpenPricing();
      return;
    }
    const next = normalizeHandle(handle);
    setHandle(next);
    if (next !== brand.handle) onBrand({ handle: next });
  };

  const pickTheme = (id: (typeof CARD_THEME_LIST)[number]["id"]) => {
    if (!can.allThemes && id !== "editorial") {
      onOpenPricing();
      return;
    }
    onBrand({ theme: id });
  };

  return (
    <div className="sheet-backdrop" onClick={closeWithCommit} role="presentation" data-testid="studio-sheet">
      <div
        className="sheet studio-sheet"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="카드 스튜디오"
      >
        <div className="sheet-head studio-head">
          <div className="studio-head-text">
            <span className="eyebrow">CARD STUDIO</span>
            <h2>카드 스튜디오</h2>
            <p>
              문구·테마·워터마크를 바꾸면 미리보기와 내려받는 PNG가 함께 바뀝니다.
              {issue ? " 고친 문구는 이 기기에만 저장되고, 닫으면 자동으로 반영됩니다." : ""}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={closeWithCommit} aria-label="닫기">
            <X size={18} />
          </button>
        </div>

        <div className="studio-body">
          <div className="studio-preview-rail">
            {previewIssue ? (
              <>
                <LiveCardPreview
                  issue={previewIssue}
                  slide={previewSlide}
                  theme={can.allThemes ? brand.theme : "editorial"}
                  handle={can.customHandle ? brand.handle : ""}
                />
                <FeedGridPreview
                  cover={previewIssue}
                  recent={recent}
                  theme={can.allThemes ? brand.theme : "editorial"}
                  handle={can.customHandle ? brand.handle : ""}
                  profileHandle={can.customHandle ? brand.handle : undefined}
                />
              </>
            ) : (
              <div className="live-card is-empty">
                <p>뉴스를 불러오면 이 자리에 카드 미리보기가 나타납니다.</p>
              </div>
            )}
          </div>

          <div className="studio-editor">
            <section className="studio-block">
              <h3>
                <Palette size={15} /> 매거진 테마
                {!can.allThemes && (
                  <button type="button" className="pro-tag" onClick={onOpenPricing}>
                    <Lock size={10} /> Pro 4종
                  </button>
                )}
              </h3>
              <div className="theme-grid" role="radiogroup" aria-label="카드 테마">
                {CARD_THEME_LIST.map((theme) => {
                  const locked = !can.allThemes && theme.id !== "editorial";
                  return (
                    <button
                      key={theme.id}
                      type="button"
                      role="radio"
                      aria-checked={brand.theme === theme.id}
                      className="theme-card"
                      data-on={brand.theme === theme.id}
                      data-locked={locked ? "true" : "false"}
                      onClick={() => pickTheme(theme.id)}
                      data-testid={`theme-${theme.id}`}
                      title={locked ? "Creator Pro에서 열립니다" : theme.note}
                    >
                      <span className="theme-swatch" aria-hidden="true">
                        {theme.swatch.map((color) => (
                          <span key={color} style={{ background: color }} />
                        ))}
                      </span>
                      <span className="theme-name">
                        {theme.label}
                        {locked && <Lock size={10} className="theme-lock" />}
                      </span>
                      <span className="theme-note">{theme.note}</span>
                    </button>
                  );
                })}
              </div>
              {!can.allThemes && (
                <p className="studio-hint">
                  지금은 <b>에디토리얼 다크</b> 한 종만 인쇄됩니다. 4종 전체는 Creator Pro에서 열립니다.
                </p>
              )}
            </section>

            <section className="studio-block">
              <h3>
                <Stamp size={15} /> 워터마크 핸들
                {!can.customHandle && (
                  <button type="button" className="pro-tag" onClick={onOpenPricing}>
                    <Lock size={10} /> Pro
                  </button>
                )}
              </h3>
              <div className="handle-row" data-locked={!can.customHandle ? "true" : "false"}>
                <input
                  value={can.customHandle ? handle : ""}
                  onChange={(event) => setHandle(event.target.value)}
                  onBlur={commitHandle}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder={can.customHandle ? "@my_channel" : "@my_channel · Creator Pro"}
                  aria-label="크리에이터 핸들"
                  maxLength={26}
                  readOnly={!can.customHandle}
                  onClick={() => {
                    if (!can.customHandle) onOpenPricing();
                  }}
                  data-testid="handle-input"
                />
                <button type="button" onClick={commitHandle} data-testid="apply-handle">
                  {can.customHandle ? "적용" : "Pro로 열기"}
                </button>
              </div>
              <p className="studio-hint">
                {can.customHandle ? (
                  <>
                    카드 5장 모두 위쪽과 아래쪽에 박힙니다. 비우면 <b>이슈온도계</b>가 들어갑니다.
                  </>
                ) : (
                  <>
                    Free에서는 카드에 <b>이슈온도계</b>가 박힙니다. 내 핸들로 바꾸려면 Creator Pro가 필요합니다.
                  </>
                )}
              </p>
            </section>

            {issue && draft ? (
              <section className="studio-block">
                <h3>
                  <FileText size={15} /> 카드 문구
                  <span className="studio-count" data-testid="edit-count" data-dirty={dirty ? "true" : "false"}>
                    {dirty
                      ? changed > 0
                        ? `${changed}칸 수정 · 저장 전`
                        : "원문으로 되돌림"
                      : changed > 0
                        ? `${changed}칸 반영됨`
                        : "원문 그대로"}
                  </span>
                </h3>

                <div className="studio-tabs" role="tablist" aria-label="카드 장 선택">
                  {SLIDES.map((item, index) => (
                    <button
                      key={item.title}
                      type="button"
                      role="tab"
                      aria-selected={slide === index}
                      aria-label={item.title}
                      data-on={slide === index}
                      onClick={() => setSlide(index)}
                      data-testid={`edit-tab-${index + 1}`}
                    >
                      {item.tab}
                    </button>
                  ))}
                </div>

                <p className="studio-slide-note">
                  <b>{SLIDES[slide].title}</b> — {SLIDES[slide].note}
                </p>

                <div className="studio-fields">
                  {SLIDES[slide].fields.map((field, index) => {
                    const value =
                      field.key === "facts" ? (draft.facts[index] ?? "") : (draft[field.key] as string) ?? "";
                    const id = `copy-${field.key}-${index}`;
                    return (
                      <label key={id} className="studio-field" htmlFor={id}>
                        <span>{field.label}</span>
                        {field.long ? (
                          <textarea
                            id={id}
                            value={value}
                            maxLength={field.max}
                            rows={field.key === "background" ? 3 : 2}
                            onChange={(event) => setField(field.key, event.target.value, index)}
                            data-testid={id}
                          />
                        ) : (
                          <input
                            id={id}
                            value={value}
                            maxLength={field.max}
                            onChange={(event) => setField(field.key, event.target.value, index)}
                            data-testid={id}
                          />
                        )}
                      </label>
                    );
                  })}
                </div>
              </section>
            ) : (
              <section className="studio-block">
                <h3>
                  <Sparkles size={15} /> 카드 문구
                </h3>
                <p className="studio-hint">
                  테마와 핸들은 모든 카드에 함께 적용됩니다. 문구를 고치려면 카드뉴스를 열어 <b>문구·테마</b>를
                  누르세요.
                </p>
              </section>
            )}
          </div>
        </div>

        <div className="studio-foot">
          <button type="button" className="foot-plan" onClick={onOpenPricing} data-testid="studio-plan">
            {planPrefs.plan === "free" ? "Free · 카드 1장 PNG" : planPrefs.plan === "team" ? "Team Studio" : "Creator Pro · 5장 ZIP"}
            <span aria-hidden="true">→</span>
          </button>
          {issue ? (
            <div className="studio-foot-actions">
              <button
                type="button"
                className="studio-reset"
                onClick={() => {
                  setDraft(original);
                  onResetCopy();
                }}
                data-testid="reset-copy"
              >
                <RotateCcw size={14} /> 원문 문구로
              </button>
              <button
                type="button"
                className="cta"
                onClick={() => {
                  onSaveCopy(nextEdits);
                  setSavedFlash(true);
                }}
                data-testid="save-copy"
              >
                <Sparkles size={15} /> {savedFlash ? "카드에 반영했어요" : "이 문구로 카드 만들기"}
              </button>
            </div>
          ) : (
            <button type="button" className="cta studio-alone" onClick={onClose}>
              닫기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
