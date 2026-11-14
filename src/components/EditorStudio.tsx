import { useMemo, useState } from 'react';
import { Check, Sparkles, Wand2 } from 'lucide-react';
import type { CategoryId, Issue } from '../types';
import { CATEGORIES } from '../lib/content';
import { formToTags, structurize, type DraftForm } from '../lib/draft';
import { clamp } from '../lib/format';
import { tempBand } from '../lib/temp';
import type { NewIssueInput } from '../hooks/useBoard';
import { CategoryChip, RichText, cn } from './ui';
import { Thermometer } from './Thermometer';

const SAMPLE_MEMO = `페이퍼백이 수수료 정책을 바꿨다. 개인 간 송금은 계속 무료지만, 가맹점 결제 수수료를 1.2%에서 1.8%로 올린다.
소상공인 커뮤니티에서는 “무료 송금으로 키운 이용자를 가맹점에 청구하는 구조”라는 비판이 나왔다.
회사는 “결제망 고도화 투자”라고 설명했지만 구체적인 투자 계획은 공개하지 않았다.`;

const LIMITS = { headline: 72, kicker: 60, summary: 120, insider: 260, memo: 1200 };

function emptyDraft(): DraftForm {
  return {
    headline: '',
    kicker: '',
    summary: ['', '', ''],
    insider: '',
    category: 'tech',
    baseTemp: 55,
    tags: '',
  };
}

export function EditorStudio({
  onPublish,
  onToast,
}: {
  onPublish: (input: NewIssueInput) => Issue;
  onToast: (message: string) => void;
}) {
  const [form, setForm] = useState<DraftForm>(emptyDraft);
  const [memo, setMemo] = useState('');
  const [notes, setNotes] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const band = tempBand(form.baseTemp);

  const filledSummary = form.summary.filter((line) => line.trim().length > 0).length;
  const checks = useMemo(
    () => [
      { label: '헤드라인', done: form.headline.trim().length >= 8 },
      { label: '3줄 요약', done: filledSummary === 3 },
      { label: '업계인 속마음', done: form.insider.trim().length >= 10 },
    ],
    [form.headline, form.insider, filledSummary],
  );

  const update = <K extends keyof DraftForm>(key: K, value: DraftForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!prev[key as string]) return prev;
      const next = { ...prev };
      delete next[key as string];
      return next;
    });
  };

  const updateSummary = (index: number, value: string) => {
    setForm((prev) => {
      const summary = [...prev.summary];
      summary[index] = value;
      return { ...prev, summary };
    });
    setErrors((prev) => {
      const next = { ...prev };
      delete next[`summary-${index}`];
      delete next.summary;
      return next;
    });
  };

  const runStructurize = () => {
    if (memo.trim().length < 10) {
      onToast('메모를 10자 이상 붙여넣어 주세요.');
      return;
    }
    const draft = structurize(memo);
    setForm({
      headline: draft.headline,
      kicker: draft.kicker,
      summary: [0, 1, 2].map((i) => draft.summary[i] ?? ''),
      insider: draft.insider,
      category: draft.category,
      baseTemp: draft.baseTemp,
      tags: draft.tags.join(', '),
    });
    setNotes(draft.notes);
    setKeywords(draft.keywords);
    setErrors({});
    onToast('초안을 구조화했습니다. 문장은 직접 다듬어 주세요.');
  };

  const validate = () => {
    const next: Record<string, string> = {};
    if (form.headline.trim().length < 8) next.headline = '헤드라인을 8자 이상 입력해 주세요.';
    if (form.headline.trim().length > LIMITS.headline) next.headline = '헤드라인은 72자 이내로 줄여 주세요.';
    form.summary.forEach((line, index) => {
      if (line.trim().length < 5) next[`summary-${index}`] = '한 줄 이상의 요약이 필요합니다.';
    });
    if (form.insider.trim().length < 10) next.insider = '업계인 속마음을 10자 이상 남겨 주세요.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const publish = () => {
    if (!validate()) {
      onToast('비어 있는 항목이 있습니다. 표시된 곳을 확인해 주세요.');
      return;
    }
    onPublish({
      headline: form.headline,
      category: form.category,
      kicker: form.kicker.trim() || form.summary[0].trim().slice(0, 58),
      summary: form.summary,
      insider: form.insider,
      baseTemp: form.baseTemp,
      tags: formToTags(form.tags),
    });
    setForm(emptyDraft());
    setMemo('');
    setNotes([]);
    setKeywords([]);
    setErrors({});
    onToast('발행 완료 — 뉴스룸 최상단에 올렸습니다.');
  };

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 py-7 sm:px-6 sm:py-9">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="mono text-[10px] uppercase tracking-[0.18em] text-faint">Editor mode</p>
          <h1 className="serif mt-1.5 text-[26px] font-bold tracking-[-0.035em] text-ink sm:text-[32px]">
            에디터 발행 스튜디오
          </h1>
          <p className="mt-2 max-w-xl text-[12.5px] leading-relaxed text-muted">
            기사 URL이나 취재 메모를 붙여넣고 <strong className="font-semibold text-ink-2">초안 구조화</strong>를 누르면
            헤드라인·3줄 요약·속마음 초안이 잡힙니다. 문장을 다듬어 발행하면 뉴스룸 최상단에 바로 올라갑니다.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-heat" />
          <span className="mono text-[10px] uppercase tracking-[0.12em] text-muted">발행 즉시 피드 반영</span>
        </div>
      </header>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)]">
        <div className="space-y-4">
          {/* memo */}
          <section className="rounded-2xl border border-[#e8dbc4] bg-[#f8f1e4] p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="mono text-[9.5px] uppercase tracking-[0.16em] text-[#a8804a]">Step 01 · memo</p>
                <h2 className="serif mt-1 flex items-center gap-1.5 text-[16px] font-bold text-ink">
                  <Sparkles className="h-4 w-4 text-heat" />
                  기사 메모 · URL 붙여넣기
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMemo(SAMPLE_MEMO);
                  onToast('예시 메모를 넣었습니다. 초안 구조화를 눌러 보세요.');
                }}
                className="rounded-full border border-[#d8c4a3] bg-white/70 px-2.5 py-1 text-[10.5px] font-semibold text-[#8a6a3c] transition hover:bg-white"
              >
                예시 메모 넣기
              </button>
            </div>
            <textarea
              value={memo}
              onChange={(event) => setMemo(event.target.value.slice(0, LIMITS.memo))}
              rows={5}
              placeholder="기사 요지나 현장 메모를 그대로 붙여넣으세요. URL만 넣으면 본문을 읽을 수 없으니 요지를 함께 적어 주세요."
              className="mt-3 w-full resize-y rounded-xl border border-[#e0d2b8] bg-white/80 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-[#b3a17f] focus:border-heat/40 focus:bg-white"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="nums text-[10px] text-[#a8804a]">{memo.length}/{LIMITS.memo}</span>
              <button
                type="button"
                onClick={runStructurize}
                className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-[12px] font-bold text-paper transition hover:bg-heat"
              >
                <Wand2 className="h-3.5 w-3.5" />
                초안 구조화
              </button>
            </div>
            {notes.length > 0 ? (
              <ul className="mt-3 space-y-1 rounded-xl border border-[#e0d2b8] bg-white/60 px-3 py-2 text-[11px] leading-relaxed text-[#7d6642]">
                {notes.map((note) => (
                  <li key={note} className="flex gap-1.5">
                    <span aria-hidden="true">·</span>
                    {note}
                  </li>
                ))}
              </ul>
            ) : null}
            {keywords.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="mono text-[9px] uppercase tracking-[0.14em] text-[#a8804a]">추출 키워드</span>
                {keywords.map((keyword) => (
                  <span key={keyword} className="rounded-full bg-white/80 px-2 py-0.5 text-[10.5px] text-[#7d6642]">
                    {keyword}
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          {/* issue fields */}
          <section className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
            <p className="mono text-[9.5px] uppercase tracking-[0.16em] text-faint">Step 02 · briefing</p>
            <h2 className="serif mt-1 text-[16px] font-bold text-ink">이슈 브리핑 쓰기</h2>

            <div className="mt-4">
              <div className="flex items-baseline justify-between">
                <label htmlFor="headline" className="text-[11.5px] font-semibold text-ink-2">
                  헤드라인 <span className="text-heat">*</span>
                </label>
                <span className="nums text-[10px] text-faint">{form.headline.length}/{LIMITS.headline}</span>
              </div>
              <input
                id="headline"
                value={form.headline}
                maxLength={LIMITS.headline}
                onChange={(event) => update('headline', event.target.value)}
                placeholder="예: 루나뷰티 성수 팝업, 재고 200개에 줄 3,000명"
                className={cn(
                  'mt-1.5 w-full rounded-xl border bg-paper/40 px-3 py-2.5 text-[13.5px] font-medium text-ink outline-none transition placeholder:text-faint focus:bg-surface',
                  errors.headline ? 'border-heat/60' : 'border-line focus:border-ink/30',
                )}
              />
              {errors.headline ? <p className="mt-1 text-[10.5px] text-heat">{errors.headline}</p> : null}
            </div>

            <div className="mt-3.5">
              <label htmlFor="kicker" className="text-[11.5px] font-semibold text-ink-2">
                한 줄 맥락
              </label>
              <input
                id="kicker"
                value={form.kicker}
                maxLength={LIMITS.kicker}
                onChange={(event) => update('kicker', event.target.value)}
                placeholder="비워 두면 첫 번째 요약 줄로 채웁니다."
                className="mt-1.5 w-full rounded-xl border border-line bg-paper/40 px-3 py-2 text-[12.5px] text-ink outline-none transition placeholder:text-faint focus:border-ink/30 focus:bg-surface"
              />
            </div>

            <div className="mt-4">
              <p className="text-[11.5px] font-semibold text-ink-2">
                3줄 핵심 요약 <span className="text-heat">*</span>
              </p>
              <div className="mt-1.5 space-y-2">
                {form.summary.map((line, index) => (
                  <div key={index}>
                    <div className="flex items-start gap-2">
                      <span className="serif mt-2 w-4 shrink-0 text-[15px] font-bold leading-none text-heat/35">
                        {index + 1}
                      </span>
                      <textarea
                        value={line}
                        rows={2}
                        maxLength={LIMITS.summary}
                        onChange={(event) => updateSummary(index, event.target.value)}
                        placeholder={
                          index === 0
                            ? '무슨 일이 있었나'
                            : index === 1
                              ? '어떻게 됐나'
                              : '그래서 지금 무엇이 문제인가'
                        }
                        className={cn(
                          'w-full resize-none rounded-xl border bg-paper/40 px-3 py-2 text-[12.5px] leading-relaxed text-ink outline-none transition placeholder:text-faint focus:bg-surface',
                          errors[`summary-${index}`] ? 'border-heat/60' : 'border-line focus:border-ink/30',
                        )}
                      />
                    </div>
                    {errors[`summary-${index}`] ? (
                      <p className="ml-6 mt-0.5 text-[10.5px] text-heat">요약을 한 줄 채워 주세요.</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4">
              <div className="flex items-baseline justify-between">
                <label htmlFor="insider" className="text-[11.5px] font-semibold text-ink-2">
                  💼 PR·업계인 속마음 <span className="text-heat">*</span>
                </label>
                <span className="nums text-[10px] text-faint">{form.insider.length}/{LIMITS.insider}</span>
              </div>
              <textarea
                id="insider"
                value={form.insider}
                rows={3}
                maxLength={LIMITS.insider}
                onChange={(event) => update('insider', event.target.value)}
                placeholder="뉴스 요약과 다른 지점 — 업계 사람만 하는 이야기를 한두 문장으로."
                className={cn(
                  'mt-1.5 w-full resize-y rounded-xl border bg-paper/40 px-3 py-2.5 text-[12.5px] leading-relaxed text-ink outline-none transition placeholder:text-faint focus:bg-surface',
                  errors.insider ? 'border-heat/60' : 'border-line focus:border-ink/30',
                )}
              />
              {errors.insider ? <p className="mt-1 text-[10.5px] text-heat">{errors.insider}</p> : null}
            </div>

            <div className="mt-4">
              <p className="text-[11.5px] font-semibold text-ink-2">카테고리</p>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                {CATEGORIES.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => update('category', category.id as CategoryId)}
                    aria-pressed={form.category === category.id}
                    className={cn(
                      'rounded-xl border px-2 py-2 text-[11.5px] font-semibold transition',
                      form.category === category.id
                        ? 'border-ink bg-ink text-paper'
                        : 'border-line bg-paper/40 text-ink-2 hover:border-line-strong',
                    )}
                  >
                    {category.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="temp" className="text-[11.5px] font-semibold text-ink-2">
                    초기 여론 온도
                  </label>
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', band.bg, band.text)}>
                    {form.baseTemp}° · {band.emoji} {band.label}
                  </span>
                </div>
                <input
                  id="temp"
                  type="range"
                  min={0}
                  max={100}
                  value={form.baseTemp}
                  onChange={(event) => update('baseTemp', clamp(Number(event.target.value), 0, 100))}
                  className="mt-2 w-full accent-[#e0451f]"
                />
                <div className="mono flex justify-between text-[9px] text-faint">
                  <span>0 냉각</span>
                  <span>50 지켜보는 중</span>
                  <span>100 과열</span>
                </div>
              </div>
              <Thermometer temp={form.baseTemp} size="sm" withTicks={false} className="hidden sm:flex" />
            </div>

            <div className="mt-4">
              <label htmlFor="tags" className="text-[11.5px] font-semibold text-ink-2">
                태그 <span className="text-faint">(선택 · 쉼표로 구분)</span>
              </label>
              <input
                id="tags"
                value={form.tags}
                maxLength={80}
                onChange={(event) => update('tags', event.target.value)}
                placeholder="오픈런, 팝업, 품절"
                className="mt-1.5 w-full rounded-xl border border-line bg-paper/40 px-3 py-2 text-[12.5px] text-ink outline-none transition placeholder:text-faint focus:border-ink/30 focus:bg-surface"
              />
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line/70 pt-4">
              <button
                type="button"
                onClick={publish}
                className="inline-flex items-center gap-2 rounded-xl bg-heat px-4 py-3 text-[13px] font-bold text-white shadow-[0_14px_30px_-18px_rgba(224,69,31,0.9)] transition hover:bg-heat-deep"
              >
                <Check className="h-4 w-4" />
                지금 발행하기
              </button>
              <button
                type="button"
                onClick={() => {
                  setForm(emptyDraft());
                  setErrors({});
                  setNotes([]);
                  setKeywords([]);
                  onToast('작성 중인 내용을 비웠습니다.');
                }}
                className="rounded-xl border border-line px-3.5 py-3 text-[12px] font-semibold text-muted transition hover:border-line-strong hover:text-ink"
              >
                비우기
              </button>
            </div>
          </section>
        </div>

        {/* preview */}
        <aside className="lg:sticky lg:top-24">
          <div className="rounded-2xl border border-line bg-surface p-4 shadow-card">
            <div className="flex items-center justify-between">
              <p className="mono text-[9.5px] uppercase tracking-[0.16em] text-faint">Live preview</p>
              <span className="mono text-[9.5px] text-faint">피드 카드</span>
            </div>

            <div className="mt-3 rounded-xl border border-line bg-paper/40 p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <CategoryChip category={form.category} size="xs" />
                    <span className="rounded-full bg-heat px-1.5 py-0.5 text-[9px] font-bold text-white">방금 발행</span>
                  </div>
                  <p className="serif mt-2 text-[16px] font-bold leading-[1.4] text-ink">
                    {form.headline.trim() || '헤드라인이 여기에 표시됩니다.'}
                  </p>
                  <p className="mt-1 text-[10.5px] text-muted">
                    {form.kicker.trim() || form.summary[0].trim() || '한 줄 맥락이 여기에 표시됩니다.'}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end">
                  <span className="nums text-[24px] font-bold leading-none tracking-[-0.05em] text-ink">
                    {form.baseTemp}
                    <span className={cn('ml-0.5 align-top text-[10px]', band.text)}>°</span>
                  </span>
                  <span className={cn('mono mt-1 text-[8.5px] uppercase tracking-[0.1em]', band.text)}>{band.label}</span>
                </div>
              </div>

              <ol className="mt-3 space-y-1.5">
                {form.summary.map((line, index) => (
                  <li key={index} className="flex gap-2">
                    <span className="mono mt-[3px] text-[8.5px] font-semibold text-faint">0{index + 1}</span>
                    <span className={cn('text-[11.5px] leading-[1.6]', line.trim() ? 'text-ink-2' : 'text-faint')}>
                      <RichText text={line.trim() || '요약이 들어갈 자리입니다.'} />
                    </span>
                  </li>
                ))}
              </ol>

              <div className="mt-3 rounded-lg border border-[#e8dbc4] bg-[#f8f1e4] px-2.5 py-2">
                <span className="mono block text-[8.5px] font-semibold uppercase tracking-[0.12em] text-[#a8804a]">
                  업계인 속마음
                </span>
                <span className="clamp-3 mt-0.5 block text-[10.5px] leading-[1.6] text-[#6b5942]">
                  {form.insider.trim() || '속마음 한 문장이 이 카드의 차이를 만듭니다.'}
                </span>
              </div>
            </div>

            <div className="mt-4">
              <p className="mono text-[9.5px] uppercase tracking-[0.16em] text-faint">발행 전 체크</p>
              <ul className="mt-2 space-y-1.5">
                {checks.map((check) => (
                  <li key={check.label} className="flex items-center gap-2 text-[11.5px]">
                    <span
                      className={cn(
                        'flex h-4 w-4 items-center justify-center rounded-full border',
                        check.done ? 'border-heat bg-heat text-white' : 'border-line-strong text-transparent',
                      )}
                    >
                      <Check className="h-2.5 w-2.5" strokeWidth={3} />
                    </span>
                    <span className={check.done ? 'text-ink-2' : 'text-faint'}>{check.label}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[10.5px] leading-relaxed text-faint">
                초안 구조화는 오프라인 규칙 엔진입니다. 문장을 대신 써 주지 않고, 붙여넣은 메모에 있는 사실만
                옮깁니다. 숫자와 고유명사는 발행 전에 원문과 대조하세요.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
