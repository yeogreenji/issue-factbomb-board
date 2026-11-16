import type { CategoryId, Comment, Debate, Issue, PendingAction, Reaction, ReactionCounts } from '../types';

/**
 * 백엔드 주소. Vercel에서는 `/api/...`, GitHub Pages 같은 정적 호스팅에서는
 * `/<repo>/api/...` 로 404가 나고, 그때 앱은 로컬 체험 모드로 남습니다.
 */
const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
const endpoint = (path: string) => `${BASE}${path}`;

export const BOARD_ENDPOINT = endpoint('/api/board');
export const BRIEFING_ENDPOINT = endpoint('/api/briefing');

/** 정적 호스팅 빌드(GitHub Pages)에서는 서버 탐색 자체를 하지 않습니다. */
const STATIC_ONLY = typeof __FACTBOMB_STATIC__ !== 'undefined' ? __FACTBOMB_STATIC__ : false;

export type BoardMode = 'shared' | 'local';
export type StoreKind = 'redis' | 'supabase' | 'memory';

export interface RemoteBoard {
  mode: BoardMode;
  store: StoreKind;
  note?: string;
  issues: Issue[];
  votes: Record<string, ReactionCounts>;
  comments: Comment[];
  myVotes: Record<string, Reaction>;
  updatedAt: number;
}

export interface BoardHealth {
  mode: BoardMode;
  store: StoreKind;
  note?: string;
}

export interface AiHealth {
  connected: boolean;
  serverKey: boolean;
  model: string;
  provider?: 'gemini' | 'openai' | null;
  note?: string;
}

/* --------------------------------------------------------------- transport */

interface RequestOptions {
  timeoutMs?: number;
  body?: unknown;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
}

async function request<T>(url: string, options: RequestOptions = {}): Promise<{ ok: boolean; status: number; data: T | null }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 8_000);
  try {
    const response = await fetch(url, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: { Accept: 'application/json', ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    const text = await response.text();
    let data: T | null = null;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = null;
      }
    }
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    window.clearTimeout(timer);
  }
}

/* -------------------------------------------------------------- board API */

interface RawBoardResponse {
  ok?: boolean;
  mode?: string;
  store?: string;
  note?: string;
  issues?: unknown;
  votes?: unknown;
  comments?: unknown;
  myVotes?: unknown;
  updatedAt?: number;
}

const asReactionCounts = (value: unknown): ReactionCounts | null => {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const num = (key: string) => (typeof row[key] === 'number' && Number.isFinite(row[key]) ? Math.max(0, Math.round(row[key] as number)) : 0);
  return { hot: num('hot'), watch: num('watch'), cool: num('cool') };
};

const asReaction = (value: unknown): Reaction | null =>
  value === 'hot' || value === 'watch' || value === 'cool' ? value : null;

const CATEGORY_IDS: CategoryId[] = ['tech', 'retail', 'culture', 'work'];

function asIssue(value: unknown): Issue | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.headline !== 'string') return null;
  const category = CATEGORY_IDS.includes(row.category as CategoryId) ? (row.category as CategoryId) : 'tech';
  const summary = Array.isArray(row.summary) ? row.summary.filter((line): line is string => typeof line === 'string') : [];
  const debateRaw = row.debate && typeof row.debate === 'object' ? (row.debate as Record<string, unknown>) : null;
  const debate: Debate | undefined = debateRaw
    ? {
        pro: Array.isArray(debateRaw.pro) ? debateRaw.pro.filter((line): line is string => typeof line === 'string') : [],
        con: Array.isArray(debateRaw.con) ? debateRaw.con.filter((line): line is string => typeof line === 'string') : [],
      }
    : undefined;
  return {
    id: row.id,
    category,
    headline: row.headline,
    kicker: typeof row.kicker === 'string' ? row.kicker : '',
    summary: summary.length > 0 ? summary : [row.headline],
    insider: typeof row.insider === 'string' ? row.insider : '',
    insiderAlt: typeof row.insiderAlt === 'string' && row.insiderAlt ? row.insiderAlt : undefined,
    debate: debate && debate.pro.length + debate.con.length > 0 ? debate : undefined,
    baseTemp: typeof row.baseTemp === 'number' ? Math.min(100, Math.max(0, Math.round(row.baseTemp))) : 55,
    source: typeof row.source === 'string' ? row.source : '공용 보드',
    publishedAt: typeof row.publishedAt === 'number' ? row.publishedAt : Date.now(),
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 4) : [],
    editorPick: row.editorPick === true,
    fresh: false,
  };
}

function asComment(value: unknown): Comment | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || typeof row.issueId !== 'string' || typeof row.text !== 'string') return null;
  return {
    id: row.id,
    issueId: row.issueId,
    author: typeof row.author === 'string' ? row.author : '익명',
    text: row.text,
    likes: typeof row.likes === 'number' && Number.isFinite(row.likes) ? Math.max(0, Math.round(row.likes)) : 0,
    createdAt: typeof row.createdAt === 'number' ? row.createdAt : Date.now(),
  };
}

/** 공용 보드 읽기. 서버가 없거나(GitHub Pages) 응답하지 않으면 null — 호출 측이 로컬 모드로 남습니다. */
export async function fetchBoard(voterId: string): Promise<RemoteBoard | null> {
  if (STATIC_ONLY) return null;
  const { ok, data } = await request<RawBoardResponse>(`${BOARD_ENDPOINT}?voterId=${encodeURIComponent(voterId)}`, {
    timeoutMs: 7_000,
  });
  if (!ok || !data || data.ok === false) return null;

  const votes: Record<string, ReactionCounts> = {};
  if (data.votes && typeof data.votes === 'object') {
    for (const [issueId, value] of Object.entries(data.votes as Record<string, unknown>)) {
      const counts = asReactionCounts(value);
      if (counts) votes[issueId] = counts;
    }
  }

  const myVotes: Record<string, Reaction> = {};
  if (data.myVotes && typeof data.myVotes === 'object') {
    for (const [issueId, value] of Object.entries(data.myVotes as Record<string, unknown>)) {
      const reaction = asReaction(value);
      if (reaction) myVotes[issueId] = reaction;
    }
  }

  return {
    mode: data.mode === 'shared' ? 'shared' : 'local',
    store: data.store === 'redis' || data.store === 'supabase' ? data.store : 'memory',
    note: typeof data.note === 'string' ? data.note : undefined,
    issues: Array.isArray(data.issues)
      ? data.issues.map(asIssue).filter((issue): issue is Issue => issue !== null)
      : [],
    votes,
    comments: Array.isArray(data.comments)
      ? data.comments.map(asComment).filter((comment): comment is Comment => comment !== null)
      : [],
    myVotes,
    updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
  };
}

export interface BoardWriteResult {
  ok: boolean;
  mode?: BoardMode;
  store?: StoreKind;
  note?: string;
  votes?: ReactionCounts;
  myVote?: Reaction | null;
  comment?: Comment;
  issue?: Issue;
}

/** 발행·투표·팩폭 등록. 실패해도 예외를 던지지 않고 ok:false로 돌려줍니다(로컬 보관 → 나중에 재시도). */
export async function postBoard(action: PendingAction, voterId: string): Promise<BoardWriteResult> {
  if (STATIC_ONLY) return { ok: false, note: '정적 호스팅 모드입니다.' };
  const payload =
    action.kind === 'publish'
      ? { action: 'publish', voterId, issue: action.issue }
      : action.kind === 'vote'
        ? { action: 'vote', voterId, issueId: action.issueId, reaction: action.reaction }
        : { action: 'comment', voterId, comment: action.comment };

  const { ok, data } = await request<Record<string, unknown>>(BOARD_ENDPOINT, {
    method: 'POST',
    body: payload,
    timeoutMs: 7_000,
  });
  if (!ok || !data || data.ok === false) {
    return { ok: false, note: typeof data?.message === 'string' ? data.message : undefined };
  }
  return {
    ok: true,
    mode: data.mode === 'shared' ? 'shared' : 'local',
    store: data.store === 'redis' || data.store === 'supabase' ? data.store : 'memory',
    note: typeof data.note === 'string' ? data.note : undefined,
    votes: asReactionCounts(data.votes) ?? undefined,
    myVote: asReaction(data.myVote) ?? null,
    comment: asComment(data.comment) ?? undefined,
    issue: asIssue(data.issue) ?? undefined,
  };
}

/* ----------------------------------------------------------- briefing API */

export interface BriefingDraft {
  headline: string;
  oneLiner: string;
  kicker: string;
  summary: string[];
  insider: string[];
  debate: Debate;
  category: CategoryId;
  baseTemp: number;
  tags: string[];
}

export type BriefingFailure = 'no_key' | 'offline' | 'too_short' | 'too_long' | 'rate_limited' | 'server';

export type BriefingOutcome =
  | { ok: true; draft: BriefingDraft; model: string; latencyMs: number }
  | { ok: false; reason: BriefingFailure; message: string };

const FAILURE_BY_CODE: Record<string, BriefingFailure> = {
  no_key: 'no_key',
  memo_too_short: 'too_short',
  memo_too_long: 'too_long',
  rate_limited: 'rate_limited',
};

interface RawBriefingResponse {
  ok?: boolean;
  error?: string;
  message?: string;
  model?: string;
  latencyMs?: number;
  result?: Record<string, unknown>;
}

export async function generateBriefing(input: {
  title?: string;
  body: string;
  angle?: string;
  category?: CategoryId;
  apiKey?: string;
}): Promise<BriefingOutcome> {
  if (STATIC_ONLY) {
    return { ok: false, reason: 'no_key', message: '이 페이지는 정적 호스팅이라 AI 서버가 없습니다. 규칙 요약으로 초안을 만듭니다.' };
  }
  const { ok, status, data } = await request<RawBriefingResponse>(BRIEFING_ENDPOINT, {
    method: 'POST',
    body: {
      title: input.title ?? '',
      body: input.body,
      angle: input.angle ?? '',
      category: input.category ?? '',
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    },
    timeoutMs: 50_000,
  });

  if (!ok || !data || data.ok === false) {
    if (status === 0) {
      return { ok: false, reason: 'offline', message: 'AI 서버에 연결하지 못했습니다. 규칙 요약으로 초안을 만듭니다.' };
    }
    const reason = FAILURE_BY_CODE[data?.error ?? ''] ?? (status === 501 ? 'no_key' : 'server');
    return { ok: false, reason, message: data?.message ?? 'AI 초안을 만들지 못했습니다. 규칙 요약으로 대신합니다.' };
  }

  const result = data.result ?? {};
  const text = (value: unknown, max = 400) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
  const list = (value: unknown, maxItems: number, maxChars = 400) =>
    Array.isArray(value) ? value.map((item) => text(item, maxChars)).filter(Boolean).slice(0, maxItems) : [];

  const headline = text(result.headline, 72);
  const summary = list(result.summary, 3, 180);
  if (!headline || summary.length === 0) {
    return { ok: false, reason: 'server', message: 'AI 응답이 비어 있었습니다. 규칙 요약으로 대신합니다.' };
  }

  const debateRaw = result.debate && typeof result.debate === 'object' ? (result.debate as Record<string, unknown>) : {};
  const category = text(result.category, 12) as CategoryId;

  return {
    ok: true,
    model: text(data.model, 40) || 'gpt-4o-mini',
    latencyMs: typeof data.latencyMs === 'number' ? data.latencyMs : 0,
    draft: {
      headline,
      oneLiner: text(result.oneLiner, 90) || summary[0],
      kicker: text(result.kicker, 60) || text(result.oneLiner, 60),
      summary: [0, 1, 2].map((index) => summary[index] ?? summary[summary.length - 1] ?? ''),
      insider: list(result.insider, 2, 400),
      debate: { pro: list(debateRaw.pro, 2, 160), con: list(debateRaw.con, 2, 160) },
      category: CATEGORY_IDS.includes(category) ? category : 'tech',
      baseTemp: typeof result.baseTemp === 'number' ? Math.min(99, Math.max(5, Math.round(result.baseTemp))) : 55,
      tags: list(result.tags, 4, 20),
    },
  };
}

/** AI 키가 서버에 있는지만 확인합니다(키 값은 오지 않습니다). */
export async function fetchAiHealth(): Promise<AiHealth> {
  if (STATIC_ONLY) {
    return { connected: false, serverKey: false, model: '', note: '정적 호스팅' };
  }
  const { ok, data } = await request<{ ok?: boolean; model?: string; serverKey?: boolean; ai?: boolean; provider?: string | null }>(
    BRIEFING_ENDPOINT,
    { timeoutMs: 5_000 },
  );
  if (!ok || !data || data.ok === false) {
    return { connected: false, serverKey: false, model: '', note: '정적 호스팅' };
  }
  const serverKey = Boolean(data.serverKey ?? data.ai);
  return {
    connected: serverKey,
    serverKey,
    model: typeof data.model === 'string' ? data.model : 'gpt-4o-mini',
    provider: data.provider === 'gemini' || data.provider === 'openai' ? data.provider : null,
  };
}

/* ------------------------------------------------------------ voter / key */

const VOTER_KEY = 'factbomb.voter.v1';
const AI_KEY = 'factbomb.aiKey.v1';

/** 이 브라우저의 익명 참여자 id. 계정·연락처와 무관한 임의 문자열입니다. */
export function getVoterId(): string {
  try {
    const stored = window.localStorage.getItem(VOTER_KEY);
    if (stored && /^[A-Za-z0-9_-]{6,72}$/.test(stored)) return stored;
  } catch {
    /* 저장소가 막힌 브라우저 */
  }
  const random = Math.random().toString(36).slice(2, 10);
  const id = `v${Date.now().toString(36)}${random}`.slice(0, 32);
  try {
    window.localStorage.setItem(VOTER_KEY, id);
  } catch {
    /* 메모리로만 동작 */
  }
  return id;
}

/** 같은 브라우저가 남긴 팩폭에 붙는 꼬리표 — 서버의 voterTag와 같은 규칙입니다. */
export function voterTag(voterId: string): string {
  let h = 2166136261;
  for (let i = 0; i < voterId.length; i += 1) {
    h ^= voterId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 4);
}

export function myAuthorLabel(voterId: string): string {
  return `익명 ${voterTag(voterId)}`;
}

export function getSavedAiKey(): string {
  try {
    return window.localStorage.getItem(AI_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveAiKey(value: string): void {
  try {
    if (value.trim()) window.localStorage.setItem(AI_KEY, value.trim());
    else window.localStorage.removeItem(AI_KEY);
  } catch {
    /* 저장소가 막힌 브라우저 — 이번 세션에서만 씁니다 */
  }
}
