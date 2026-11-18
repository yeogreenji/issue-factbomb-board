/** 서버(api/trending·api/briefing·api/poll)와 이야기하는 얇은 클라이언트. */

import type {
  BriefingResponse,
  Issue,
  PollComment,
  PollsResponse,
  PollSnapshot,
  TrendingResponse,
} from "../types";

/** GitHub Pages 같은 정적 빌드에서는 서버가 없습니다(vite define). */
export const STATIC_BUILD = typeof __FACTBOMB_STATIC__ !== "undefined" && __FACTBOMB_STATIC__;

const VOTER_KEY = "issue-thermo.voter.v1";
const LOCAL_KEY = "issue-thermo.local.v2";

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

/* ------------------------------------------------------------ local cache */

interface LocalIssue {
  my?: "a" | "b";
  comments: PollComment[];
  likes: Record<string, true>;
}

type LocalStore = Record<string, LocalIssue>;

function readLocal(): LocalStore {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as LocalStore;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocal(store: LocalStore): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(store));
  } catch {
    /* 저장 공간이 없으면 그냥 넘어갑니다 */
  }
}

function localIssue(issueId: string): LocalIssue {
  const store = readLocal();
  return store[issueId] ?? { comments: [], likes: {} };
}

function updateLocal(issueId: string, patch: (current: LocalIssue) => LocalIssue): void {
  const store = readLocal();
  const current = store[issueId] ?? { comments: [], likes: {} };
  store[issueId] = patch(current);
  writeLocal(store);
}

/** 내 표·댓글·좋아요를 이 브라우저에도 남깁니다 — 서버 메모리가 비어도 내 것은 다시 보입니다. */
function mergeLocal(issueId: string, remote: PollSnapshot | null): PollSnapshot {
  const local = localIssue(issueId);
  const base: PollSnapshot = remote ?? {
    id: issueId,
    question: "",
    a: "",
    b: "",
    counts: { a: 0, b: 0 },
    total: 0,
    my: null,
    comments: [],
  };

  const counts = { ...base.counts };
  let my = base.my;
  if (!my && local.my) {
    my = local.my;
    counts[local.my] += 1;
  }
  const total = counts.a + counts.b;

  const seen = new Set<string>();
  const comments: PollComment[] = [];
  for (const comment of [...base.comments, ...local.comments]) {
    if (!comment?.id || seen.has(comment.id)) continue;
    seen.add(comment.id);
    const liked = comment.liked || Boolean(local.likes[comment.id]);
    comments.push({
      ...comment,
      liked,
      likes: comment.likes + (liked && !comment.liked ? 1 : 0),
      mine: comment.mine || local.comments.some((own) => own.id === comment.id),
    });
  }
  comments.sort((a, b) => b.at - a.at);

  return {
    ...base,
    counts,
    total,
    my,
    comments,
    commentCount: comments.length,
  };
}

/* ------------------------------------------------------------------ http */

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

export async function fetchPolls(ids: string[], issues: Issue[] = []): Promise<PollsResponse> {
  if (ids.length === 0) return { ok: true, polls: {} };
  const query = `ids=${ids.map((id) => encodeURIComponent(id)).join(",")}&voterId=${encodeURIComponent(voterId())}`;
  try {
    const res = await requestJson<PollsResponse>(`/api/poll?${query}`, { headers: { Accept: "application/json" } }, 20_000);
    const polls: Record<string, PollSnapshot> = {};
    for (const issue of issues) {
      polls[issue.id] = withIssueLabels(mergeLocal(issue.id, res.polls?.[issue.id] ?? null), issue);
    }
    for (const [id, poll] of Object.entries(res.polls ?? {})) {
      if (!polls[id]) polls[id] = mergeLocal(id, poll);
    }
    return { ...res, polls };
  } catch {
    const polls: Record<string, PollSnapshot> = {};
    for (const issue of issues) polls[issue.id] = mergeLocal(issue.id, null);
    return { ok: false, polls, localOnly: true };
  }
}

export async function sendVote(issue: Issue, choice: "a" | "b"): Promise<PollsResponse> {
  updateLocal(issue.id, (current) => ({ ...current, my: choice }));
  try {
    const res = await requestJson<PollsResponse>(
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
    return { ...res, poll: res.poll ? withIssueLabels(mergeLocal(issue.id, res.poll), issue) : undefined };
  } catch {
    return { ok: false, localOnly: true };
  }
}

export async function sendComment(
  issue: Issue,
  side: "a" | "b",
  text: string,
): Promise<PollsResponse> {
  const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  try {
    const res = await requestJson<PollsResponse>(
      "/api/poll",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          action: "comment",
          issueId: issue.id,
          question: issue.poll.question,
          a: issue.poll.a,
          b: issue.poll.b,
          side,
          text,
          commentId: id,
          voterId: voterId(),
        }),
      },
      20_000,
    );
    if (!res.ok || !res.poll) throw new Error(res.message ?? "comment failed");
    const mine = res.poll.comments.find((comment) => comment.id === id) ?? res.poll.comments.find((comment) => comment.mine);
    if (mine) updateLocal(issue.id, (current) => ({ ...current, comments: [mine, ...current.comments].slice(0, 20) }));
    return { ...res, poll: withIssueLabels(mergeLocal(issue.id, res.poll), issue) };
  } catch {
    const pending: PollComment = {
      id,
      side,
      text,
      at: Date.now(),
      tag: "나",
      likes: 0,
      liked: false,
      mine: true,
    };
    updateLocal(issue.id, (current) => ({ ...current, comments: [pending, ...current.comments].slice(0, 20) }));
    return {
      ok: false,
      localOnly: true,
      poll: mergeLocal(issue.id, {
        id: issue.id,
        question: issue.poll.question,
        a: issue.poll.a,
        b: issue.poll.b,
        counts: { a: 0, b: 0 },
        total: 0,
        my: null,
        comments: [],
      }),
    };
  }
}

export async function sendLike(issue: Issue, commentId: string): Promise<PollsResponse> {
  updateLocal(issue.id, (current) => {
    const likes = { ...current.likes };
    if (likes[commentId]) delete likes[commentId];
    else likes[commentId] = true;
    return { ...current, likes };
  });
  try {
    const res = await requestJson<PollsResponse>(
      "/api/poll",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action: "like", issueId: issue.id, commentId, voterId: voterId() }),
      },
      20_000,
    );
    if (!res.ok || !res.poll) throw new Error("like failed");
    return { ...res, poll: withIssueLabels(mergeLocal(issue.id, res.poll), issue) };
  } catch {
    return { ok: false, localOnly: true };
  }
}

/** 카드에 적힌 문항이 기준입니다 — 예전에 저장된 집계가 남아 있어도 화면에는 새 A/B가 나갑니다. */
function withIssueLabels(poll: PollSnapshot, issue: Issue): PollSnapshot {
  return {
    ...poll,
    question: issue.poll.question,
    a: issue.poll.a,
    b: issue.poll.b,
  };
}

/** 서버 집계가 아직 없을 때 화면에 보여 줄 빈 값. */
export function emptyPoll(issue: Issue): PollSnapshot {
  return mergeLocal(issue.id, {
    id: issue.id,
    question: issue.poll.question,
    a: issue.poll.a,
    b: issue.poll.b,
    counts: { a: 0, b: 0 },
    total: 0,
    my: null,
    comments: [],
  });
}
