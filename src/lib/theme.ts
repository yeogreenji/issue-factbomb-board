/**
 * 카드뉴스 표지·내지에 쓰는 4가지 상용 매거진 테마.
 *
 * 캔버스는 색을 직접 칠하기 때문에 CSS 테마처럼 클래스로 바꿀 수 없습니다.
 * 그래서 테마 하나를 "역할별 색 묶음(palette)"으로 정의해 두고, 그리는 함수들이
 * 역할 이름(바탕·글자·강조·사진 위 글자…)으로만 색을 고릅니다.
 * → 새 테마를 추가해도 그리는 코드는 그대로 두고 색 묶음만 더하면 됩니다.
 */

export type CardThemeId = "editorial" | "modern" | "breaking" | "pastel";

export interface CardPalette {
  id: CardThemeId;
  label: string;
  note: string;
  /** 테마 고르는 칸에 보여 줄 대표색 3개 */
  swatch: [string, string, string];

  /** 카드 바탕 */
  paper: string;
  /** 진한 블록(엔딩 CTA·VS 원·선택지 번호) */
  solid: string;
  onSolid: string;
  /** 바탕 위 기본 글자 */
  fg: string;
  fgDim: string;
  /** 1차 강조 — 형광 하이라이트·A 진영(면) */
  accent: string;
  accentDeep: string;
  onAccent: string;
  /** 바탕 위에 '글자·선'으로 쓸 때의 강조색 — 파스텔처럼 옅은 테마에서 읽히도록 따로 둡니다. */
  accentText: string;
  /** 2차 강조 — B 진영 */
  alt: string;
  onAlt: string;
  /** 사진 위에 얹는 글자 */
  photoInk: string;
  /** 사진 위 그라데이션 색 "r,g,b" */
  scrim: string;
  /** 망점(인쇄 질감) 색 */
  grain: string;
  /** 반투명 박스 */
  panel: string;
  /** 머리선·테두리 */
  line: string;

  /** 위쪽에 색 띠를 두르는 테마(브레이킹) */
  strip?: boolean;
  /** 안쪽에 얇은 액자를 두르는 테마(파스텔) */
  frame?: boolean;
  /** 브랜드 아래 머리선을 긋는 테마(모던) */
  rule?: boolean;
}

export const CARD_THEMES: Record<CardThemeId, CardPalette> = {
  editorial: {
    id: "editorial",
    label: "에디토리얼 다크",
    note: "검정 바탕 · 라임 형광펜 · 사진 표지",
    swatch: ["#0b0b0c", "#d9ff3d", "#ff5a2b"],
    paper: "#0b0b0c",
    solid: "#0b0b0c",
    onSolid: "#fffdf8",
    fg: "#fffdf8",
    fgDim: "#a9a7a1",
    accent: "#d9ff3d",
    accentDeep: "#b8e01f",
    onAccent: "#0b0b0c",
    accentText: "#d9ff3d",
    alt: "#ff5a2b",
    onAlt: "#0b0b0c",
    photoInk: "#fffdf8",
    scrim: "6,6,8",
    grain: "rgba(255,255,255,0.10)",
    panel: "rgba(255,255,255,0.06)",
    line: "rgba(255,253,248,0.24)",
  },
  modern: {
    id: "modern",
    label: "모던 화이트",
    note: "아이보리 종이 · 검정 활자 · 시그널 레드",
    swatch: ["#f6f3ec", "#14140f", "#e8452a"],
    paper: "#f6f3ec",
    solid: "#14140f",
    onSolid: "#f6f3ec",
    fg: "#14140f",
    fgDim: "#5c5a52",
    accent: "#14140f",
    accentDeep: "#33332c",
    onAccent: "#f6f3ec",
    accentText: "#14140f",
    alt: "#e8452a",
    onAlt: "#fff8f4",
    photoInk: "#14140f",
    scrim: "246,243,236",
    grain: "rgba(20,20,15,0.06)",
    panel: "rgba(20,20,15,0.05)",
    line: "rgba(20,20,15,0.22)",
    rule: true,
  },
  breaking: {
    id: "breaking",
    label: "브레이킹 레드",
    note: "먹빛 바탕 · 속보 레드 · 옐로 포인트",
    swatch: ["#100406", "#ff2b1f", "#ffd21f"],
    paper: "#100406",
    solid: "#100406",
    onSolid: "#fff6f0",
    fg: "#fff6f0",
    fgDim: "#d5a9a3",
    accent: "#ff2b1f",
    accentDeep: "#c81209",
    onAccent: "#fff6f0",
    accentText: "#ff4a3a",
    alt: "#ffd21f",
    onAlt: "#140406",
    photoInk: "#fff6f0",
    scrim: "12,3,5",
    grain: "rgba(255,60,40,0.12)",
    panel: "rgba(255,45,32,0.12)",
    line: "rgba(255,246,240,0.22)",
    strip: true,
  },
  pastel: {
    id: "pastel",
    label: "트렌디 파스텔",
    note: "크림 바탕 · 핑크·민트 블록 · 둥근 액자",
    swatch: ["#fff5f1", "#ffc2d4", "#bce8d5"],
    paper: "#fff5f1",
    solid: "#3a2033",
    onSolid: "#fff7f3",
    fg: "#3a2033",
    fgDim: "#8b6b7e",
    accent: "#ffc2d4",
    accentDeep: "#ffa1bd",
    onAccent: "#3a2033",
    accentText: "#d94f7c",
    alt: "#bce8d5",
    onAlt: "#233a30",
    photoInk: "#3a2033",
    scrim: "255,245,241",
    grain: "rgba(58,32,51,0.05)",
    panel: "rgba(58,32,51,0.06)",
    line: "rgba(58,32,51,0.2)",
    frame: true,
  },
};

export const CARD_THEME_LIST: CardPalette[] = [
  CARD_THEMES.editorial,
  CARD_THEMES.modern,
  CARD_THEMES.breaking,
  CARD_THEMES.pastel,
];

export const DEFAULT_THEME: CardThemeId = "editorial";

export function paletteOf(theme: CardThemeId | string | undefined): CardPalette {
  if (theme && theme in CARD_THEMES) return CARD_THEMES[theme as CardThemeId];
  return CARD_THEMES[DEFAULT_THEME];
}

/** "#123456" + 투명도 → rgba(). 캔버스에서 색을 흐리게 쓸 때 씁니다. */
export function alpha(hex: string, opacity: number): string {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const num = Number.parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(num)) return `rgba(255,255,255,${opacity})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r},${g},${b},${opacity})`;
}

/** #rrggbb + 알파 16진(cc·33) — 캔버스 그라데이션 정지점에 그대로 넣습니다. */
export function hexWith(hex: string, alphaHex: string): string {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  return `#${full.slice(0, 6)}${alphaHex}`;
}
