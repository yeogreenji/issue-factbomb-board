/** 앱 전체가 쓰는 데이터 모양. 서버(api/_shared, api/trending, api/briefing)와 같은 이름을 씁니다. */

export type Category = "work" | "mz" | "money" | "tech" | "culture";

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

/** 카테고리 색은 검정 바탕에서 바로 읽히는 네온 톤으로 맞췄습니다. */
export const CATEGORY_META: Record<Category, { label: string; short: string; color: string; soft: string }> = {
  work: { label: "직장·커리어", short: "직장", color: "#7EF0C0", soft: "rgba(126, 240, 192, 0.16)" },
  mz: { label: "MZ·트렌드", short: "MZ", color: "#C9A7FF", soft: "rgba(201, 167, 255, 0.18)" },
  money: { label: "소비·경제", short: "소비", color: "#FFC46B", soft: "rgba(255, 196, 107, 0.16)" },
  tech: { label: "테크·AI", short: "테크", color: "#8FB6FF", soft: "rgba(143, 182, 255, 0.18)" },
  culture: { label: "문화·연예", short: "문화", color: "#FF9EC4", soft: "rgba(255, 158, 196, 0.18)" },
};
