import type { BoardSnapshot, Comment, Issue, PendingAction, Reaction, ReactionCounts } from '../types';
import { SEED_COMMENTS, SEED_ISSUES } from './content';
import { EMPTY_VOTES } from './temp';

export const BOARD_VERSION = 2;
export const STORAGE_KEY = 'factbomb.board.v2';
const LEGACY_KEY = 'factbomb.board.v1';

/**
 * Storage seam for the board. 로컬 스냅샷은 언제나 이 저장소에 남고,
 * 공용 보드(Vercel /api/board)가 있으면 그 위에 얹습니다.
 */
export interface BoardRepository {
  load(): BoardSnapshot;
  save(snapshot: BoardSnapshot): void;
  reset(): BoardSnapshot;
}

/**
 * 데모 이슈의 초기 투표수는 '에디터 기준값'으로 남습니다.
 * 스냅샷에는 실제 참여표만 쌓이고, 화면에는 SEED_VOTES + 실제표로 보여 줍니다.
 * 그래서 공용 모드와 로컬 모드가 같은 숫자를 보여 줍니다.
 */
export function seedSnapshot(): BoardSnapshot {
  const votes: Record<string, ReactionCounts> = {};
  for (const issue of SEED_ISSUES) votes[issue.id] = { ...EMPTY_VOTES };
  return {
    version: BOARD_VERSION,
    issues: SEED_ISSUES.map((issue) => ({ ...issue })),
    votes,
    comments: SEED_COMMENTS.map((comment) => ({ ...comment })),
    myVotes: {},
    likedComments: [],
    outbox: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isReactionCounts(value: unknown): value is ReactionCounts {
  return (
    isRecord(value) &&
    typeof value.hot === 'number' &&
    typeof value.watch === 'number' &&
    typeof value.cool === 'number'
  );
}

const isReaction = (value: unknown): value is Reaction => value === 'hot' || value === 'watch' || value === 'cool';

function normalizeIssue(raw: unknown): Issue | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== 'string' || typeof raw.headline !== 'string' || !Array.isArray(raw.summary)) return null;
  return raw as unknown as Issue;
}

function normalizeComment(raw: unknown): Comment | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.id !== 'string' ||
    typeof raw.issueId !== 'string' ||
    typeof raw.text !== 'string' ||
    typeof raw.likes !== 'number'
  ) {
    return null;
  }
  return raw as unknown as Comment;
}

function normalizeOutbox(raw: unknown): PendingAction[] {
  if (!Array.isArray(raw)) return [];
  const out: PendingAction[] = [];
  for (const item of raw.slice(-50)) {
    if (!isRecord(item)) continue;
    const at = typeof item.at === 'number' ? item.at : Date.now();
    if (item.kind === 'publish') {
      const issue = normalizeIssue(item.issue);
      if (issue) out.push({ kind: 'publish', issue, at });
    } else if (item.kind === 'vote') {
      if (typeof item.issueId === 'string' && isReaction(item.reaction)) {
        out.push({ kind: 'vote', issueId: item.issueId, reaction: item.reaction, at });
      }
    } else if (item.kind === 'comment') {
      const comment = normalizeComment(item.comment);
      if (comment) out.push({ kind: 'comment', comment, at });
    }
  }
  return out;
}

/** Keeps a stored snapshot usable even if the shape drifted between versions. */
export function normalizeSnapshot(raw: unknown): BoardSnapshot | null {
  if (!isRecord(raw) || raw.version !== BOARD_VERSION) return null;
  if (!Array.isArray(raw.issues) || !Array.isArray(raw.comments)) return null;

  const issues = raw.issues.map(normalizeIssue).filter((issue): issue is Issue => issue !== null);
  if (issues.length === 0) return null;

  const comments = raw.comments
    .map(normalizeComment)
    .filter((comment): comment is Comment => comment !== null);

  const votes: Record<string, ReactionCounts> = {};
  if (isRecord(raw.votes)) {
    for (const issue of issues) {
      const stored = raw.votes[issue.id];
      votes[issue.id] = isReactionCounts(stored) ? { ...stored } : { ...EMPTY_VOTES };
    }
  } else {
    for (const issue of issues) votes[issue.id] = { ...EMPTY_VOTES };
  }

  const myVotes: Record<string, Reaction> = {};
  if (isRecord(raw.myVotes)) {
    for (const [id, value] of Object.entries(raw.myVotes)) {
      if (isReaction(value)) myVotes[id] = value;
    }
  }

  const likedComments = Array.isArray(raw.likedComments)
    ? raw.likedComments.filter((id): id is string => typeof id === 'string')
    : [];

  return {
    version: BOARD_VERSION,
    issues,
    votes,
    comments,
    myVotes,
    likedComments,
    outbox: normalizeOutbox(raw.outbox),
  };
}

export class LocalBoardRepository implements BoardRepository {
  private memory: string | null = null;

  constructor(private readonly key: string = STORAGE_KEY) {}

  private read(): string | null {
    try {
      return window.localStorage.getItem(this.key);
    } catch {
      return this.memory;
    }
  }

  private write(value: string): void {
    try {
      window.localStorage.setItem(this.key, value);
    } catch {
      this.memory = value;
    }
  }

  load(): BoardSnapshot {
    try {
      window.localStorage.removeItem(LEGACY_KEY);
    } catch {
      /* 저장소가 막힌 브라우저 */
    }
    const raw = this.read();
    if (!raw) return seedSnapshot();
    try {
      return normalizeSnapshot(JSON.parse(raw)) ?? seedSnapshot();
    } catch {
      return seedSnapshot();
    }
  }

  save(snapshot: BoardSnapshot): void {
    try {
      this.write(JSON.stringify(snapshot));
    } catch {
      /* snapshot has been sanitized upstream; nothing else to persist */
    }
  }

  reset(): BoardSnapshot {
    const fresh = seedSnapshot();
    this.save(fresh);
    return fresh;
  }
}

export function createBoardRepository(): BoardRepository {
  return new LocalBoardRepository();
}
