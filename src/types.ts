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

export interface BoardSnapshot {
  version: number;
  issues: Issue[];
  votes: Record<string, ReactionCounts>;
  comments: Comment[];
  myVotes: Record<string, Reaction>;
  likedComments: string[];
}

export type View =
  | { name: 'feed' }
  | { name: 'ranking' }
  | { name: 'editor' }
  | { name: 'issue'; id: string };
