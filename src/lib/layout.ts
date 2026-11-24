import type { Issue } from "../types";

/**
 * 카드 표지 레이아웃 — 모든 카드가 같은 틀으로 보이지 않게, 이슈마다 다른 편집 판을 씁니다.
 *
 *  overlay  : 사진 위에 헤드라인을 얹는 인스타 뉴스 표지(가장 기본)
 *  quote    : 큰 따옴표 + 한 문장 인용을 주인공으로 세우는 판
 *  stat     : 숫자 하나를 거대하게 키운 지표 판
 *  split    : A vs B 두 진영을 화면을 갈라 보여 주는 판
 *  breaking : 붉은 띠 + 큰 활자로 긴급함을 주는 판
 */
export type CardLayout = "overlay" | "quote" | "stat" | "split" | "breaking";

export const CARD_LAYOUTS: CardLayout[] = ["overlay", "quote", "stat", "split", "breaking"];

export const LAYOUT_LABEL: Record<CardLayout, string> = {
  overlay: "포토 헤드라인",
  quote: "한마디",
  stat: "숫자",
  split: "A vs B",
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

/** 같은 카드 안에서는 늘 같은 판, 옆 카드와는 다른 판 — 첫 화면이 한 틀로 보이지 않게. */
export function layoutOf(issue: Issue, index = 0): CardLayout {
  // 피드에서는 자리 순서로 판을 돌려, 옆 카드가 절대 같은 판이 되지 않게 합니다.
  if (index > 0) return CARD_LAYOUTS[index % CARD_LAYOUTS.length];
  const base = hash(issue.id || issue.url || issue.title) % CARD_LAYOUTS.length;
  return CARD_LAYOUTS[base];
}

/** 카드에서 가장 센 숫자 하나 — "62%", "1조5천억", "50만" 같은 표지용 지표. */
export function headlineStat(issue: Issue): { value: string; unit: string; context: string } | null {
  const pool = [issue.hook, issue.kicker, ...(issue.facts ?? []), issue.title].filter(Boolean);
  const pattern = /(\d[\d,]*(?:\.\d+)?)\s*(%|퍼센트|배|만\s*원|억\s*원|조\s*원|원|만|억|조|명|개|년|개월|시간|분|위|대|포인트|%p)/;
  for (const text of pool) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = match[1].replace(/\s/g, "");
    const unit = match[2].replace(/\s/g, "");
    // 연도(2024년)나 순번은 표지 숫자로 쓰지 않습니다.
    if (unit === "년" && /^(19|20)\d{2}$/.test(value)) continue;
    if (/^[12]$/.test(value) && /^(개|명)$/.test(unit)) continue;
    const context = (issue.point || issue.kicker || issue.hook || "").replace(/\s+/g, " ").slice(0, 40);
    return { value, unit, context };
  }
  return null;
}
