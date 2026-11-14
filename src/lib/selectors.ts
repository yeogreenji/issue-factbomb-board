import type { Comment, Issue } from '../types';

export interface BestEntry {
  comment: Comment;
  issue: Issue;
  temp: number;
}

export function bestEntries(
  comments: Comment[],
  issues: Issue[],
  temps: Record<string, number>,
  limit = 5,
): BestEntry[] {
  const byId = new Map(issues.map((issue) => [issue.id, issue]));
  return comments
    .map((comment) => {
      const issue = byId.get(comment.issueId);
      if (!issue) return null;
      return { comment, issue, temp: temps[issue.id] ?? 0 };
    })
    .filter((entry): entry is BestEntry => entry !== null)
    .sort((a, b) => b.comment.likes - a.comment.likes || b.comment.createdAt - a.comment.createdAt)
    .slice(0, limit);
}
