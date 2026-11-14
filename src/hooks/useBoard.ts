import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BoardSnapshot, CategoryId, Comment, Issue, Reaction, ReactionCounts } from '../types';
import { STORAGE_KEY, createBoardRepository } from '../lib/repo';
import { EMPTY_VOTES, computeTemp } from '../lib/temp';
import { uid } from '../lib/format';

const repository = createBoardRepository();

export interface NewIssueInput {
  headline: string;
  category: CategoryId;
  kicker: string;
  summary: string[];
  insider: string;
  baseTemp: number;
  tags: string[];
}

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
  publish: (input: NewIssueInput) => Issue;
  reset: () => void;
  totalVotes: number;
  totalComments: number;
  averageTemp: number;
}

export function useBoard(): BoardApi {
  const [snapshot, setSnapshot] = useState<BoardSnapshot>(() => repository.load());

  useEffect(() => {
    repository.save(snapshot);
  }, [snapshot]);

  // keep tabs of the same board in step
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === STORAGE_KEY) setSnapshot(repository.load());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const votesOf = useCallback(
    (issueId: string): ReactionCounts => snapshot.votes[issueId] ?? EMPTY_VOTES,
    [snapshot.votes],
  );

  const issuesById = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const issue of snapshot.issues) map.set(issue.id, issue);
    return map;
  }, [snapshot.issues]);

  const temps = useMemo(() => {
    const map: Record<string, number> = {};
    for (const issue of snapshot.issues) {
      map[issue.id] = computeTemp(issue, snapshot.votes[issue.id] ?? EMPTY_VOTES);
    }
    return map;
  }, [snapshot.issues, snapshot.votes]);

  const commentsByIssue = useMemo(() => {
    const map = new Map<string, Comment[]>();
    for (const comment of snapshot.comments) {
      const list = map.get(comment.issueId) ?? [];
      list.push(comment);
      map.set(comment.issueId, list);
    }
    for (const list of map.values()) list.sort((a, b) => b.createdAt - a.createdAt);
    return map;
  }, [snapshot.comments]);

  const vote = useCallback((issueId: string, reaction: Reaction) => {
    setSnapshot((prev) => {
      const current = prev.votes[issueId] ?? { ...EMPTY_VOTES };
      const previous = prev.myVotes[issueId];
      if (previous === reaction) return prev;
      const nextVotes: ReactionCounts = { ...current };
      if (previous) nextVotes[previous] = Math.max(0, nextVotes[previous] - 1);
      nextVotes[reaction] += 1;
      return {
        ...prev,
        votes: { ...prev.votes, [issueId]: nextVotes },
        myVotes: { ...prev.myVotes, [issueId]: reaction },
      };
    });
  }, []);

  const addComment = useCallback((issueId: string, text: string): Comment | null => {
    const trimmed = text.trim().slice(0, 100);
    if (trimmed.length === 0) return null;
    const comment: Comment = {
      id: uid('c'),
      issueId,
      author: '나 · 익명',
      text: trimmed,
      likes: 0,
      createdAt: Date.now(),
    };
    setSnapshot((prev) => ({ ...prev, comments: [comment, ...prev.comments] }));
    return comment;
  }, []);

  const toggleLike = useCallback((commentId: string) => {
    setSnapshot((prev) => {
      const liked = prev.likedComments.includes(commentId);
      return {
        ...prev,
        likedComments: liked
          ? prev.likedComments.filter((id) => id !== commentId)
          : [...prev.likedComments, commentId],
        comments: prev.comments.map((comment) =>
          comment.id === commentId
            ? { ...comment, likes: Math.max(0, comment.likes + (liked ? -1 : 1)) }
            : comment,
        ),
      };
    });
  }, []);

  const publish = useCallback((input: NewIssueInput): Issue => {
    const issue: Issue = {
      id: uid('issue'),
      category: input.category,
      headline: input.headline.trim(),
      kicker: input.kicker.trim(),
      summary: input.summary.map((line) => line.trim()),
      insider: input.insider.trim(),
      baseTemp: input.baseTemp,
      source: '에디터 발행',
      publishedAt: Date.now(),
      tags: input.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 4),
      fresh: true,
    };
    setSnapshot((prev) => ({
      ...prev,
      issues: [issue, ...prev.issues],
      votes: { ...prev.votes, [issue.id]: { ...EMPTY_VOTES } },
    }));
    return issue;
  }, []);

  const reset = useCallback(() => {
    setSnapshot(repository.reset());
  }, []);

  const totalVotes = useMemo(
    () => Object.values(snapshot.votes).reduce((sum, v) => sum + v.hot + v.watch + v.cool, 0),
    [snapshot.votes],
  );

  const averageTemp = useMemo(() => {
    const values = Object.values(temps);
    if (values.length === 0) return 0;
    return values.reduce((sum, t) => sum + t, 0) / values.length;
  }, [temps]);

  return {
    issues: snapshot.issues,
    comments: snapshot.comments,
    myVotes: snapshot.myVotes,
    likedComments: snapshot.likedComments,
    temps,
    votesOf,
    tempOf: (issueId: string) => temps[issueId] ?? 0,
    issueById: (issueId: string) => issuesById.get(issueId),
    commentsOf: (issueId: string) => commentsByIssue.get(issueId) ?? [],
    vote,
    addComment,
    toggleLike,
    publish,
    reset,
    totalVotes,
    totalComments: snapshot.comments.length,
    averageTemp,
  };
}
