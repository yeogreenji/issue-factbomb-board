/** 앱 전체가 쓰는 데이터 모양. 서버(api/_shared, api/trending, api/briefing)와 같은 이름을 씁니다. */

export type Category = "entertainment" | "society" | "culture" | "tech" | "money" | "work";

export interface IssuePoll {
  question: string;
  a: string;
  b: string;
}

export interface IssueSides {
  labelA: string;
  labelB: string;
  a: string;
  b: string;
}

export interface Issue {
  id: string;
  category: Category;
  title: string;
  source: string;
  url: string;
  publishedAt: number;
  image: string;
  /** 기사에서 확인한 사진 후보(대표 → 본문 사진 순). 카드 5장이 같은 사진만 쓰지 않게 합니다. */
  images?: string[];
  /** 기사에 실제로 있던 인용 한 줄 — 표지 '한마디' 판에만 씁니다. */
  quote?: string;
  /** 표지 편집 판(서버가 골라 카드마다 다르게 내려 줍니다). */
  layout?: "overlay" | "quote" | "stat" | "split" | "breaking";
  hook: string;
  kicker: string;
  /** 팩트 3줄 */
  facts: string[];
  /** 왜 지금 떴나 · 배경 */
  background: string;
  /** 핵심 쟁점 한 줄 */
  point: string;
  sides: IssueSides | null;
  poll: IssuePoll;
  temp: number | null;
  /** 제목·키워드로 계산한 화제성(0~99) — 인스타에 올렸을 때 반응이 붙을 만한 정도. */
  buzz?: number;
  tags: string[];
  ai: boolean;
}

export interface FeedStatus {
  name: string;
  ok: boolean;
}

export interface TrendingResponse {
  ok: boolean;
  mode?: "shared" | "local";
  store?: string;
  ai?: { provider: string; model: string } | null;
  aiKey?: boolean;
  generatedAt?: number;
  stale?: boolean;
  latencyMs?: number;
  feeds?: FeedStatus[];
  notice?: string;
  issues?: Issue[];
  error?: string;
  message?: string;
}

export interface BriefingResponse {
  ok: boolean;
  engine?: "ai" | "headline";
  ai?: { provider: string; model: string } | null;
  issue?: Issue;
  notice?: string;
  error?: string;
  message?: string;
}

export interface PollComment {
  id: string;
  side: "a" | "b";
  text: string;
  at: number;
  tag: string;
  likes: number;
  liked: boolean;
  mine: boolean;
}

export interface PollSnapshot {
  id: string;
  question: string;
  a: string;
  b: string;
  counts: { a: number; b: number };
  total: number;
  my: "a" | "b" | null;
  commentCount?: number;
  comments: PollComment[];
}

export interface PollsResponse {
  ok: boolean;
  mode?: "shared" | "local";
  store?: string;
  polls?: Record<string, PollSnapshot>;
  poll?: PollSnapshot;
  localOnly?: boolean;
  error?: string;
  message?: string;
}

/** 카드에 실제로 인쇄되는 문구 — 크리에이터가 편집실에서 직접 고칠 수 있는 전부. */
export interface CardCopy {
  hook: string;
  kicker: string;
  facts: string[];
  background: string;
  point: string;
  labelA: string;
  labelB: string;
  sideA: string;
  sideB: string;
  question: string;
  optionA: string;
  optionB: string;
}

export type CardCopyEdits = Partial<CardCopy>;

/** 필터 칩에 쓰는 순서(전체는 UI에서 따로 붙입니다). */
export const CATEGORY_ORDER: Category[] = ["entertainment", "society", "culture", "tech", "money", "work"];

/**
 * 카테고리 색 — 두 벌을 둡니다.
 *  color : 카드(캔버스)에 쓰는 밝은 색. 어두운 종이 위에서 읽히도록.
 *  ui    : 화면(밝은 종이)에 쓰는 인쇄 잉크 톤. 흰 바탕에서 읽히도록.
 */
export const CATEGORY_META: Record<
  Category,
  { label: string; short: string; color: string; soft: string; ui: string; uiSoft: string }
> = {
  entertainment: {
    label: "연예",
    short: "연예",
    color: "#FF6E9C",
    soft: "rgba(255, 110, 156, 0.18)",
    ui: "#b3195c",
    uiSoft: "rgba(179, 25, 92, 0.1)",
  },
  society: {
    label: "사회",
    short: "사회",
    color: "#5FD3F3",
    soft: "rgba(95, 211, 243, 0.18)",
    ui: "#136479",
    uiSoft: "rgba(19, 100, 121, 0.1)",
  },
  culture: {
    label: "문화·라이프",
    short: "문화",
    color: "#C9A7FF",
    soft: "rgba(201, 167, 255, 0.18)",
    ui: "#5b3f96",
    uiSoft: "rgba(91, 63, 150, 0.1)",
  },
  tech: {
    label: "테크·AI",
    short: "테크",
    color: "#8FB6FF",
    soft: "rgba(143, 182, 255, 0.18)",
    ui: "#2b4c8c",
    uiSoft: "rgba(43, 76, 140, 0.1)",
  },
  money: {
    label: "경제·소비",
    short: "경제",
    color: "#FFC46B",
    soft: "rgba(255, 196, 107, 0.16)",
    ui: "#8a5a10",
    uiSoft: "rgba(138, 90, 16, 0.1)",
  },
  work: {
    label: "직장·커리어",
    short: "직장",
    color: "#7EF0C0",
    soft: "rgba(126, 240, 192, 0.16)",
    ui: "#1d5c46",
    uiSoft: "rgba(29, 92, 70, 0.1)",
  },
};
