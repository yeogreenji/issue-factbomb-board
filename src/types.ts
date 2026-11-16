/** 앱 전체가 쓰는 데이터 모양. 서버(api/_shared, api/trending, api/briefing)와 같은 이름을 씁니다. */

export type Category = "work" | "mz" | "money" | "tech" | "culture";

export interface IssuePoll {
  question: string;
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
  facts: string[];
  sides: { a: string; b: string } | null;
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

export interface PollSnapshot {
  id: string;
  question: string;
  a: string;
  b: string;
  counts: { a: number; b: number };
  total: number;
  my: "a" | "b" | null;
  reactions: { text: string; at: number; tag: string }[];
}

export interface PollsResponse {
  ok: boolean;
  mode?: "shared" | "local";
  store?: string;
  polls?: Record<string, PollSnapshot>;
  poll?: PollSnapshot;
  error?: string;
  message?: string;
}

export interface PollUi {
  counts: { a: number; b: number };
  my: "a" | "b" | null;
  pending: boolean;
  offline: boolean;
}

export const CATEGORY_META: Record<Category, { label: string; short: string; color: string; soft: string }> = {
  work: { label: "직장·커리어", short: "직장", color: "#1f7a5c", soft: "#e4f2ec" },
  mz: { label: "MZ·트렌드", short: "MZ", color: "#7040b8", soft: "#efe7fb" },
  money: { label: "소비·경제", short: "소비", color: "#a65a1c", soft: "#fbeedf" },
  tech: { label: "테크·AI", short: "테크", color: "#3753c4", soft: "#e9ecfc" },
  culture: { label: "문화·연예", short: "문화", color: "#b03a6a", soft: "#fbe7f0" },
};
