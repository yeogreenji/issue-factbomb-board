import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BoardSnapshot, CategoryId, Comment, Debate, Issue, PendingAction, Reaction, ReactionCounts } from '../types';
import { createBoardRepository } from '../lib/repo';
import { EMPTY_VOTES, computeTemp } from '../lib/temp';
import { SEED_VOTES } from '../lib/content';
import { uid } from '../lib/format';
import {
  fetchAiHealth,
  fetchBoard,
  getSavedAiKey,
  getVoterId,
  myAuthorLabel,
  postBoard,
  saveAiKey,
  type AiHealth,
  type BoardMode,
  type RemoteBoard,
  type StoreKind,
} from '../lib/api';

const repository = createBoardRepository();
const POLL_MS = 25_000;

export interface NewIssueInput {
  headline: string;
  category: CategoryId;
  kicker: string;
  summary: string[];
  insider: string;
  insiderAlt?: string;
  debate?: Debate;
  baseTemp: number;
  tags: string[];
}

export type BoardStatus = 'connecting' | 'ready';

export interface BoardApi {
  issues: Issue[];
  comments: Comment[];
  myVotes: Record<string, Reaction>;
  likedComments: string[];
  temps: Record<string, number>;
  votesOf: (issueId: string) => ReactionCounts;
  tempOf: (issueId: string) => number;
  issueById: (issueId: string) => Issue | undefined;
  commentsOf: (issueId: string) => Comment[];
  vote: (issueId: string, reaction: Reaction) => void;
  addComment: (issueId: string, text: string) => Comment | null;
  toggleLike: (commentId: string) => void;
  publish: (input: NewIssueInput) => Promise<{ issue: Issue; synced: boolean }>;
  reset: () => void;
  refresh: () => void;
  setPersonalAiKey: (key: string) => void;
  totalVotes: number;
  totalComments: number;
  averageTemp: number;
  /* 연결 상태 */
  status: BoardStatus;
  mode: BoardMode;
  store: StoreKind | null;
  syncEnabled: boolean;
  pending: number;
  notice: string | null;
  ai: AiHealth & { personalKey: boolean; ready: boolean };
}

function sameAction(a: PendingAction, b: PendingAction): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'vote' && b.kind === 'vote') return a.issueId === b.issueId;
  if (a.kind === 'publish' && b.kind === 'publish') return a.issue.id === b.issue.id;
  if (a.kind === 'comment' && b.kind === 'comment') return a.comment.id === b.comment.id;
  return false;
}

export function useBoard(): BoardApi {
  const voterId = useMemo(() => getVoterId(), []);
  const myAuthor = useMemo(() => myAuthorLabel(voterId), [voterId]);

  const [snapshot, setSnapshot] = useState<BoardSnapshot>(() => repository.load());
  const [remote, setRemote] = useState<RemoteBoard | null>(null);
  const [status, setStatus] = useState<BoardStatus>('connecting');
  const [mode, setMode] = useState<BoardMode>('local');
  const [store, setStore] = useState<StoreKind | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [aiServer, setAiServer] = useState<AiHealth>({ connected: false, serverKey: false, model: '' });
  const [personalKey, setPersonalKey] = useState<string>(() => getSavedAiKey());

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const syncRef = useRef(false);
  const flushing = useRef(false);

  useEffect(() => {
    repository.save(snapshot);
  }, [snapshot]);

  /* ------------------------------------------------------------- 읽기: 서버 */

  const applyRemote = useCallback(
    (next: RemoteBoard) => {
      setRemote(next);
      setMode(next.mode);
      setStore(next.store);
      setNotice(next.note ?? null);
      // 서버가 기억하는 '내 투표'를 로컬에도 남깁니다(재접속·오프라인 표시용).
      // 아직 올리지 못한 투표가 있으면 서버 값으로 덮지 않습니다.
      setSnapshot((prev) => {
        const pendingVotes = new Set(
          prev.outbox.filter((action) => action.kind === 'vote').map((action) => (action.kind === 'vote' ? action.issueId : '')),
        );
        const myVotes = { ...prev.myVotes };
        for (const [issueId, reaction] of Object.entries(next.myVotes)) {
          if (!pendingVotes.has(issueId)) myVotes[issueId] = reaction;
        }
        return { ...prev, myVotes };
      });
    },
    [],
  );

  const refresh = useCallback(async () => {
    const next = await fetchBoard(voterId);
    if (next) {
      applyRemote(next);
      syncRef.current = true;
      setMode(next.mode);
    } else {
      setRemote(null);
      syncRef.current = false;
      setMode('local');
      setStore(null);
    }
    setStatus('ready');
  }, [applyRemote, voterId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [board, ai] = await Promise.all([fetchBoard(voterId), fetchAiHealth()]);
      if (cancelled) return;
      if (board) {
        applyRemote(board);
        syncRef.current = true;
      } else {
        setRemote(null);
        syncRef.current = false;
        setMode('local');
      }
      setAiServer(ai);
      setStatus('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, [applyRemote, voterId]);

  // 공용 보드일 때는 25초마다(다른 사람의 표·팩폭 반영), 연결 전에는 45초마다 조용히 다시 시도합니다.
  // 정적 호스팅 빌드에서는 fetchBoard가 네트워크를 타지 않고 바로 null을 돌려줍니다.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const timer = window.setInterval(tick, syncRef.current ? POLL_MS : 45_000);
    window.addEventListener('focus', tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
    };
  }, [refresh, mode]);

  /* -------------------------------------------------------------- 쓰기: 큐 */

  const removeAction = useCallback((action: PendingAction) => {
    setSnapshot((prev) => ({ ...prev, outbox: prev.outbox.filter((item) => !sameAction(item, action)) }));
  }, []);

  const retryTimer = useRef<number | null>(null);

  const flush = useCallback(async () => {
    if (flushing.current || !syncRef.current) return;
    if (retryTimer.current !== null) {
      window.clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    flushing.current = true;
    try {
      const queue = [...snapshotRef.current.outbox];
      for (const action of queue) {
        const result = await postBoard(action, voterId);
        if (!result.ok) break;
        if (action.kind === 'vote') {
          const counts = result.votes;
          setSnapshot((prev) => ({
            ...prev,
            votes: counts ? { ...prev.votes, [action.issueId]: counts } : prev.votes,
            outbox: prev.outbox.filter((item) => !sameAction(item, action)),
          }));
        } else if (action.kind === 'comment' && result.comment) {
          const serverComment = result.comment;
          setSnapshot((prev) => ({
            ...prev,
            comments: prev.comments.map((comment) => (comment.id === serverComment.id ? { ...comment, author: serverComment.author } : comment)),
            outbox: prev.outbox.filter((item) => !sameAction(item, action)),
          }));
        } else {
          removeAction(action);
        }
        if (result.note) setNotice(result.note);
        if (result.mode) setMode(result.mode);
        if (result.store) setStore(result.store);
      }
    } finally {
      flushing.current = false;
      // 아직 못 올린 게 남아 있으면 조용히 다시 시도합니다(네트워크가 돌아오면 자동 반영).
      if (snapshotRef.current.outbox.length > 0 && syncRef.current) {
        retryTimer.current = window.setTimeout(() => void flush(), 10_000);
      }
    }
  }, [removeAction, voterId]);

  // 연결되어 있고 큐에 쌓인 게 있으면 순서대로 올립니다(새로 읽어 온 뒤에도 한 번 시도).
  useEffect(() => {
    if (!syncRef.current || snapshot.outbox.length === 0) return;
    const timer = window.setTimeout(() => void flush(), 120);
    return () => window.clearTimeout(timer);
  }, [snapshot.outbox, remote, flush]);

  useEffect(() => {
    const onOnline = () => {
      void refresh().then(() => flush());
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [flush, refresh]);

  /* ------------------------------------------------------------- 파생 상태 */

  const remoteIssues = remote?.issues;
  const issues = useMemo(() => {
    if (!remoteIssues) return snapshot.issues;
    const seen = new Set(remoteIssues.map((issue) => issue.id));
    return [...remoteIssues, ...snapshot.issues.filter((issue) => !seen.has(issue.id))];
  }, [remoteIssues, snapshot.issues]);

  const pendingVotes = useMemo(() => {
    const set = new Set<string>();
    for (const action of snapshot.outbox) if (action.kind === 'vote') set.add(action.issueId);
    return set;
  }, [snapshot.outbox]);

  /** 실제 참여표(기준값 제외) — 공용 보드가 있으면 서버 집계가 우선입니다. */
  const liveVotes = useMemo(() => {
    const map: Record<string, ReactionCounts> = {};
    for (const issue of issues) {
      const local = snapshot.votes[issue.id] ?? EMPTY_VOTES;
      const upstream = remote?.votes[issue.id];
      map[issue.id] = pendingVotes.has(issue.id) || !upstream ? { ...local } : { ...upstream };
    }
    return map;
  }, [issues, pendingVotes, remote, snapshot.votes]);

  /** 화면에 보이는 투표수 = 데모 기준값 + 실제 참여표 */
  const displayVotes = useMemo(() => {
    const map: Record<string, ReactionCounts> = {};
    for (const issue of issues) {
      const base = SEED_VOTES[issue.id] ?? EMPTY_VOTES;
      const live = liveVotes[issue.id] ?? EMPTY_VOTES;
      map[issue.id] = { hot: base.hot + live.hot, watch: base.watch + live.watch, cool: base.cool + live.cool };
    }
    return map;
  }, [issues, liveVotes]);

  const myVotes = useMemo(() => {
    if (!remote) return snapshot.myVotes;
    const merged = { ...snapshot.myVotes };
    for (const [issueId, reaction] of Object.entries(remote.myVotes)) {
      if (!pendingVotes.has(issueId)) merged[issueId] = reaction;
    }
    return merged;
  }, [pendingVotes, remote, snapshot.myVotes]);

  const comments = useMemo(() => {
    const base = remote ? [...remote.comments, ...snapshot.comments.filter((comment) => !remote.comments.some((item) => item.id === comment.id))] : snapshot.comments;
    return base.map((comment) => {
      const liked = snapshot.likedComments.includes(comment.id);
      const own = comment.author === myAuthor && !comment.author.includes('나 ·');
      return {
        ...comment,
        author: own ? `나 · ${comment.author}` : comment.author,
        likes: comment.likes + (liked ? 1 : 0),
      };
    });
  }, [myAuthor, remote, snapshot.comments, snapshot.likedComments]);

  const temps = useMemo(() => {
    const map: Record<string, number> = {};
    for (const issue of issues) {
      map[issue.id] = computeTemp(issue, displayVotes[issue.id] ?? EMPTY_VOTES);
    }
    return map;
  }, [issues, displayVotes]);

  const commentsByIssue = useMemo(() => {
    const map = new Map<string, Comment[]>();
    for (const comment of comments) {
      const list = map.get(comment.issueId) ?? [];
      list.push(comment);
      map.set(comment.issueId, list);
    }
    for (const list of map.values()) list.sort((a, b) => b.createdAt - a.createdAt);
    return map;
  }, [comments]);

  const issuesById = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const issue of issues) map.set(issue.id, issue);
    return map;
  }, [issues]);

  /* ---------------------------------------------------------------- 액션 */

  const vote = useCallback((issueId: string, reaction: Reaction) => {
    setSnapshot((prev) => {
      if (prev.myVotes[issueId] === reaction) return prev;
      const current = prev.votes[issueId] ?? { ...EMPTY_VOTES };
      const next: ReactionCounts = { ...current };
      const previous = prev.myVotes[issueId];
      if (previous) next[previous] = Math.max(0, next[previous] - 1);
      next[reaction] += 1;
      const action: PendingAction = { kind: 'vote', issueId, reaction, at: Date.now() };
      const outbox = [...prev.outbox.filter((item) => !sameAction(item, action)), action].slice(-50);
      return {
        ...prev,
        votes: { ...prev.votes, [issueId]: next },
        myVotes: { ...prev.myVotes, [issueId]: reaction },
        outbox,
      };
    });
  }, []);

  const addComment = useCallback(
    (issueId: string, text: string): Comment | null => {
      const trimmed = text.trim().slice(0, 100);
      if (trimmed.length === 0) return null;
      const comment: Comment = {
        id: uid('c'),
        issueId,
        author: myAuthor,
        text: trimmed,
        likes: 0,
        createdAt: Date.now(),
      };
      const action: PendingAction = { kind: 'comment', comment, at: Date.now() };
      setSnapshot((prev) => ({
        ...prev,
        comments: [comment, ...prev.comments],
        outbox: [...prev.outbox, action].slice(-50),
      }));
      return comment;
    },
    [myAuthor],
  );

  const toggleLike = useCallback((commentId: string) => {
    setSnapshot((prev) => {
      const liked = prev.likedComments.includes(commentId);
      return {
        ...prev,
        likedComments: liked ? prev.likedComments.filter((id) => id !== commentId) : [...prev.likedComments, commentId],
      };
    });
  }, []);

  const publish = useCallback(
    async (input: NewIssueInput): Promise<{ issue: Issue; synced: boolean }> => {
      const issue: Issue = {
        id: uid('issue'),
        category: input.category,
        headline: input.headline.trim(),
        kicker: input.kicker.trim(),
        summary: input.summary.map((line) => line.trim()).filter(Boolean),
        insider: input.insider.trim(),
        insiderAlt: input.insiderAlt?.trim() || undefined,
        debate: input.debate && (input.debate.pro.length > 0 || input.debate.con.length > 0) ? input.debate : undefined,
        baseTemp: input.baseTemp,
        source: '에디터 발행',
        publishedAt: Date.now(),
        tags: input.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 4),
        fresh: true,
      };
      const queued: PendingAction = { kind: 'publish', issue, at: Date.now() };
      setSnapshot((prev) => ({
        ...prev,
        issues: [issue, ...prev.issues],
        votes: { ...prev.votes, [issue.id]: { ...EMPTY_VOTES } },
        outbox: [...prev.outbox, queued].slice(-50),
      }));

      if (syncRef.current) {
        const result = await postBoard({ kind: 'publish', issue, at: Date.now() }, voterId);
        if (result.ok) {
          removeAction({ kind: 'publish', issue, at: 0 });
          return { issue, synced: true };
        }
        if (result.note) setNotice(result.note);
      }
      return { issue, synced: false };
    },
    [removeAction, voterId],
  );

  const reset = useCallback(() => {
    setSnapshot(repository.reset());
    void refresh();
  }, [refresh]);

  const setPersonalAiKey = useCallback((key: string) => {
    saveAiKey(key);
    setPersonalKey(key.trim());
  }, []);

  const totalVotes = useMemo(
    () => Object.values(displayVotes).reduce((sum, votes) => sum + votes.hot + votes.watch + votes.cool, 0),
    [displayVotes],
  );

  const averageTemp = useMemo(() => {
    const values = Object.values(temps);
    if (values.length === 0) return 0;
    return values.reduce((sum, temp) => sum + temp, 0) / values.length;
  }, [temps]);

  return {
    issues,
    comments,
    myVotes,
    likedComments: snapshot.likedComments,
    temps,
    votesOf: (issueId: string) => displayVotes[issueId] ?? EMPTY_VOTES,
    tempOf: (issueId: string) => temps[issueId] ?? 0,
    issueById: (issueId: string) => issuesById.get(issueId),
    commentsOf: (issueId: string) => commentsByIssue.get(issueId) ?? [],
    vote,
    addComment,
    toggleLike,
    publish,
    reset,
    refresh: () => void refresh(),
    setPersonalAiKey,
    totalVotes,
    totalComments: comments.length,
    averageTemp,
    status,
    mode,
    store,
    syncEnabled: remote !== null,
    pending: snapshot.outbox.length,
    notice,
    ai: {
      ...aiServer,
      personalKey: personalKey.length > 0,
      ready: aiServer.serverKey || personalKey.length > 0,
      model: aiServer.model || 'gpt-4o-mini',
    },
  };
}
