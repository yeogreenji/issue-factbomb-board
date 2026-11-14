import type { BoardSnapshot, Comment, Issue, Reaction, ReactionCounts } from '../types';
import { SEED_COMMENTS, SEED_ISSUES, SEED_VOTES } from './content';
import { EMPTY_VOTES } from './temp';

export const BOARD_VERSION = 1;
export const STORAGE_KEY = 'factbomb.board.v1';

/**
 * Storage seam for the board. Today everything lives in localStorage; a future
 * backend only has to implement these three methods (see README).
 */
export interface BoardRepository {
  load(): BoardSnapshot;
  save(snapshot: BoardSnapshot): void;
  reset(): BoardSnapshot;
}

export function seedSnapshot(): BoardSnapshot {
  const votes: Record<string, ReactionCounts> = {};
  for (const issue of SEED_ISSUES) {
    votes[issue.id] = { ...(SEED_VOTES[issue.id] ?? EMPTY_VOTES) };
  }
  return {
    version: BOARD_VERSION,
    issues: SEED_ISSUES.map((issue) => ({ ...issue })),
    votes,
    comments: SEED_COMMENTS.map((comment) => ({ ...comment })),
    myVotes: {},
    likedComments: [],
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

/** Keeps a stored snapshot usable even if the shape drifted between versions. */
export function normalizeSnapshot(raw: unknown): BoardSnapshot | null {
  if (!isRecord(raw) || raw.version !== BOARD_VERSION) return null;
  if (!Array.isArray(raw.issues) || !Array.isArray(raw.comments)) return null;

  const issues = raw.issues.filter(
    (issue): issue is Issue =>
      isRecord(issue) &&
      typeof issue.id === 'string' &&
      typeof issue.headline === 'string' &&
      Array.isArray(issue.summary),
  );
  if (issues.length === 0) return null;

  const comments = raw.comments.filter(
    (comment): comment is Comment =>
      isRecord(comment) &&
      typeof comment.id === 'string' &&
      typeof comment.issueId === 'string' &&
      typeof comment.text === 'string' &&
      typeof comment.likes === 'number',
  );

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
      if (value === 'hot' || value === 'watch' || value === 'cool') myVotes[id] = value;
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

/**
 * Swap this for an `HttpBoardRepository` when the shared backend arrives; every
 * component talks to `BoardRepository`, never to localStorage directly.
 */
export function createBoardRepository(): BoardRepository {
  return new LocalBoardRepository();
}
