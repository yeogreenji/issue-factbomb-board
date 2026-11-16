export type CategoryId = 'tech' | 'retail' | 'culture' | 'work';

export type Reaction = 'hot' | 'watch' | 'cool';

export interface Category {
  id: CategoryId;
  label: string;
  short: string;
  /** tailwind text color utility for the category hue */
  text: string;
  soft: string;
  dot: string;
}

/** 여론 찬반 포인트 — AI 초안이 만들어 준 양쪽 논리 */
export interface Debate {
  pro: string[];
  con: string[];
}

export interface Issue {
  id: string;
  category: CategoryId;
  /** headline as the newsroom would run it */
  headline: string;
  /** one-line context under the headline */
  kicker: string;
  /** exactly three sentences: what happened in 30 seconds */
  summary: string[];
  /** candid insider read — the reason this board exists */
  insider: string;
  /** second insider take (AI 초안의 두 번째 속마음) */
  insiderAlt?: string;
  /** 여론 찬반 포인트 (AI 초안에서 넘어온 경우) */
  debate?: Debate;
  /** editorial starting temperature, 0–100 */
  baseTemp: number;
  source: string;
  publishedAt: number;
  tags: string[];
  editorPick?: boolean;
  /** true for issues published in this session */
  fresh?: boolean;
}

export interface ReactionCounts {
  hot: number;
  watch: number;
  cool: number;
}

export interface Comment {
  id: string;
  issueId: string;
  author: string;
  text: string;
  likes: number;
  createdAt: number;
}

/** 공용 보드에 아직 못 올린 작업 (연결되면 자동으로 다시 올립니다) */
export type PendingAction =
  | { kind: 'publish'; issue: Issue; at: number }
  | { kind: 'vote'; issueId: string; reaction: Reaction; at: number }
  | { kind: 'comment'; comment: Comment; at: number };

export interface BoardSnapshot {
  version: number;
  issues: Issue[];
  votes: Record<string, ReactionCounts>;
  comments: Comment[];
  myVotes: Record<string, Reaction>;
  likedComments: string[];
  outbox: PendingAction[];
}

export type View =
  | { name: 'feed' }
  | { name: 'ranking' }
  | { name: 'editor' }
  | { name: 'issue'; id: string };
