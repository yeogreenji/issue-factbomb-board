import type { Issue } from "../types";

/**
 * 카드 표지 레이아웃 — 모든 카드가 같은 틀으로 보이지 않게, 이슈마다 다른 편집 판을 씁니다.
 * 다섯 판 모두 **실제 사진을 크게 깔고** 그 위에 활자를 얹는 인스타 매거진 구성입니다.
 *
 *  overlay  : 사진 전체 + 아래에서 올라오는 헤드라인 (가장 기본)
 *  quote    : 기사에 실제로 있던 한마디를 주인공으로 세우는 판
 *  stat     : 사진 띠 + 숫자 하나를 거대하게 키운 지표 판
 *  split    : 사진을 왼쪽 세로로 세우고 오른쪽 지면에 활자를 쌓는 잡지 표지 판
 *  breaking : 붉은 톤 + 큰 활자로 긴급함을 주는 판
 */
export type CardLayout = "overlay" | "quote" | "stat" | "split" | "breaking";

export const CARD_LAYOUTS: CardLayout[] = ["overlay", "quote", "stat", "split", "breaking"];

export const LAYOUT_LABEL: Record<CardLayout, string> = {
  overlay: "포토 헤드라인",
  quote: "한마디",
  stat: "숫자",
  split: "포토 스트립",
  breaking: "속보",
};

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/** 인용으로 쓸 만한 말인지 — 조각난 명사("개과천선 서인영")는 표지 주인공이 될 수 없습니다. */
export function looksLikeRemark(text: string): boolean {
  const value = text.trim();
  if (value.length < 10) return false;
  if (!/\s/.test(value)) return false;
  return /(다|요|죠|네|까|지|라|자|야|어|아|해|함|음|임|게|데|걸)$/.test(value) || value.length >= 16;
}

/** 기사에 실제로 있던 인용 한 줄 — 따옴표 안의 말이 카드의 주인공이 될 수 있는지. */
export function hasQuote(issue: Issue): boolean {
  return looksLikeRemark(quoteOf(issue));
}

/** 이 판으로 그릴 수 있는지 — 숫자가 없는데 '숫자 판'을 그리면 빈 카드가 됩니다. */
export function canDrawLayout(issue: Issue, layout: CardLayout): boolean {
  if (layout === "stat") return Boolean(headlineStat(issue));
  if (layout === "quote") return hasQuote(issue);
  return true;
}

/** 같은 카드 안에서는 늘 같은 판, 옆 카드와는 다른 판 — 첫 화면이 한 틀로 보이지 않게. */
export function layoutOf(issue: Issue, index = 0): CardLayout {
  if (issue.layout && CARD_LAYOUTS.includes(issue.layout) && canDrawLayout(issue, issue.layout)) {
    return issue.layout;
  }
  // 피드에서는 자리 순서로 판을 돌려, 옆 카드가 절대 같은 판이 되지 않게 합니다.
  if (index > 0) {
    for (let step = 0; step < CARD_LAYOUTS.length; step += 1) {
      const candidate = CARD_LAYOUTS[(index + step) % CARD_LAYOUTS.length];
      if (canDrawLayout(issue, candidate)) return candidate;
    }
  }
  const base = hash(issue.id || issue.url || issue.title) % CARD_LAYOUTS.length;
  for (let step = 0; step < CARD_LAYOUTS.length; step += 1) {
    const candidate = CARD_LAYOUTS[(base + step) % CARD_LAYOUTS.length];
    if (canDrawLayout(issue, candidate)) return candidate;
  }
  return "overlay";
}

/** 표지·내지에 쓸 인용 한 줄 — 없으면 빈 문자열(그때는 헤드라인 판으로 그립니다). */
export function quoteOf(issue: Issue): string {
  const own = (issue.quote ?? "").trim();
  if (own.length >= 6) return own;
  const pool = [issue.kicker, issue.point, issue.background, issue.title];
  for (const text of pool) {
    if (!text) continue;
    const match = text.match(/["“”‘’]([^"“”‘’]{6,58})["“”‘’]/);
    if (match) return match[1].trim();
  }
  return "";
}

/** 카드에서 가장 센 숫자 하나 — "62%", "1조5천억", "50만" 같은 표지용 지표. */
export function headlineStat(issue: Issue): { value: string; unit: string; context: string } | null {
  const pool = [issue.hook, issue.kicker, ...(issue.facts ?? []), issue.title].filter(Boolean);
  const pattern = /(\d[\d,]*(?:\.\d+)?)\s*(%p|%|퍼센트|배|만\s*원|억\s*원|조\s*원|원|만|억|조|명|개|위|시간|분|년|개월|대|포인트)/g;
  // 단위마다 "얼마나 지표다운가" — 50대(나이)·3년(기간)보다 62%·10억·3만명을 먼저 고릅니다.
  const weight = (unit: string): number => {
    if (unit === "%" || unit === "%p" || unit === "퍼센트") return 8;
    if (unit === "배") return 7;
    if (unit.includes("억") || unit.includes("조") || unit.includes("만")) return 6;
    if (unit === "원") return 5;
    if (unit === "명" || unit === "개" || unit === "위") return 4;
    if (unit === "시간" || unit === "분") return 3;
    return 1;
  };

  interface Candidate {
    value: string;
    unit: string;
    score: number;
    context: string;
  }
  let best: Candidate | null = null;
  for (let order = 0; order < pool.length; order += 1) {
    const text = pool[order];
    for (const match of text.matchAll(pattern)) {
      const value = match[1].replace(/\s/g, "");
      const unit = match[2].replace(/\s/g, "");
      // 연도(2024년)나 순번은 표지 숫자로 쓰지 않습니다.
      if (unit === "년" && /^(19|20)\d{2}$/.test(value)) continue;
      if (/^[12]$/.test(value) && /^(개|명)$/.test(unit)) continue;
      const score = weight(unit) * 10 + Math.max(0, 12 - order * 3) + Math.min(3, value.length);
      if (best === null || score > best.score) {
        best = { value, unit, score, context: text.replace(/\s+/g, " ").slice(0, 40) };
      }
    }
  }
  return best ? { value: best.value, unit: best.unit, context: best.context } : null;
}
