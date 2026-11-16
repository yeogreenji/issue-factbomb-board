/** 서버(api/trending·api/briefing·api/poll)와 이야기하는 얇은 클라이언트. */

import type {
  BriefingResponse,
  Issue,
  PollsResponse,
  PollSnapshot,
  TrendingResponse,
} from "../types";

/** GitHub Pages 같은 정적 빌드에서는 서버가 없습니다(vite define). */
export const STATIC_BUILD = typeof __FACTBOMB_STATIC__ !== "undefined" && __FACTBOMB_STATIC__;

const VOTER_KEY = "issue-thermo.voter.v1";

/** 브라우저가 만든 익명 id — 계정도 IP도 아닙니다. 같은 사람의 중복 투표만 막습니다. */
export function voterId(): string {
  try {
    const saved = localStorage.getItem(VOTER_KEY);
    if (saved && /^[A-Za-z0-9_-]{6,72}$/.test(saved)) return saved;
    const fresh =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID().replace(/-/g, "")
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(VOTER_KEY, fresh);
    return fresh;
  } catch {
    return "anon0000000000";
  }
}

async function requestJson<T>(input: string, init?: RequestInit, timeoutMs = 55_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const payload = (await response.json().catch(() => ({}))) as T;
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchTrending(opts: { refresh?: boolean } = {}): Promise<TrendingResponse> {
  const query = opts.refresh ? "?refresh=1" : "";
  return requestJson<TrendingResponse>(`/api/trending${query}`, { headers: { Accept: "application/json" } });
}

export async function fetchIssue(id: string): Promise<{ ok: boolean; issue?: Issue; message?: string }> {
  return requestJson<{ ok: boolean; issue?: Issue; message?: string }>(
    `/api/trending?issue=${encodeURIComponent(id)}`,
    { headers: { Accept: "application/json" } },
  );
}

export async function createBriefing(input: { url?: string; text?: string }): Promise<BriefingResponse> {
  return requestJson<BriefingResponse>(
    "/api/briefing",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(input),
    },
    60_000,
  );
}

export async function fetchPolls(ids: string[]): Promise<PollsResponse> {
  if (ids.length === 0) return { ok: true, polls: {} };
  const query = `ids=${ids.map((id) => encodeURIComponent(id)).join(",")}&voterId=${encodeURIComponent(voterId())}`;
  return requestJson<PollsResponse>(`/api/poll?${query}`, { headers: { Accept: "application/json" } }, 20_000);
}

export async function sendVote(issue: Issue, choice: "a" | "b"): Promise<PollsResponse> {
  return requestJson<PollsResponse>(
    "/api/poll",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        action: "vote",
        issueId: issue.id,
        question: issue.poll.question,
        a: issue.poll.a,
        b: issue.poll.b,
        choice,
        voterId: voterId(),
      }),
    },
    20_000,
  );
}

export async function sendReaction(issue: Issue, text: string): Promise<PollsResponse> {
  return requestJson<PollsResponse>(
    "/api/poll",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        action: "react",
        issueId: issue.id,
        question: issue.poll.question,
        a: issue.poll.a,
        b: issue.poll.b,
        text,
        voterId: voterId(),
      }),
    },
    20_000,
  );
}

/** 서버 집계가 아직 없을 때 화면에 보여 줄 빈 값. */
export function emptyPoll(issue: Issue): PollSnapshot {
  return {
    id: issue.id,
    question: issue.poll.question,
    a: issue.poll.a,
    b: issue.poll.b,
    counts: { a: 0, b: 0 },
    total: 0,
    my: null,
    reactions: [],
  };
}
