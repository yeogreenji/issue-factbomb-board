/**
 * 이슈온도계 — A/B 투표 · 한 줄 반응 (Vercel 서버리스 함수)
 *
 * GET  /api/poll?ids=id1,id2&voterId=…   여러 카드의 투표 집계를 한 번에
 * POST /api/poll                          { action: "vote",  issueId, question, a, b, choice: "a"|"b", voterId }
 *                                         { action: "react", issueId, text, voterId }
 *
 * 저장소 자동 선택: Upstash Redis → Supabase → 함수 메모리.
 * 어디에도 계정·IP는 저장하지 않습니다. 브라우저가 만든 익명 voterId만 쓰고, 응답에는 다시 내보내지 않습니다.
 */

import {
  clean,
  clampInt,
  clientIp,
  kvGet,
  kvSet,
  parseBody,
  queryValue,
  rateLimited,
  setCors,
  storeLabel,
  type VercelRequest,
  type VercelResponse,
} from "./_shared.js";

export const config = { maxDuration: 30 };

const DOC_KEY = "issue-thermo:polls:v1";
const MAX_ISSUES = 400;
const MAX_VOTERS_PER_ISSUE = 20_000;
const MAX_REACTIONS_PER_ISSUE = 120;

const ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;
const VOTER_PATTERN = /^[A-Za-z0-9_-]{6,72}$/;

type Choice = "a" | "b";

interface PollItem {
  question: string;
  a: string;
  b: string;
  votes: Record<Choice, number>;
  voters: Record<string, Choice>;
  reactions: { text: string; at: number; tag: string }[];
}

interface PollDoc {
  version: 1;
  items: Record<string, PollItem>;
  updatedAt: number;
}

function emptyDoc(): PollDoc {
  return { version: 1, items: {}, updatedAt: 0 };
}

function normalizeDoc(raw: unknown): PollDoc {
  if (!raw || typeof raw !== "object") return emptyDoc();
  const row = raw as Record<string, unknown>;
  const doc = emptyDoc();
  const items = row.items && typeof row.items === "object" ? (row.items as Record<string, unknown>) : {};
  for (const [id, value] of Object.entries(items)) {
    if (!ID_PATTERN.test(id) || !value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    const voters: Record<string, Choice> = {};
    if (item.voters && typeof item.voters === "object") {
      for (const [voter, choice] of Object.entries(item.voters as Record<string, unknown>)) {
        if (VOTER_PATTERN.test(voter) && (choice === "a" || choice === "b")) voters[voter] = choice;
      }
    }
    const votesRaw = item.votes && typeof item.votes === "object" ? (item.votes as Record<string, unknown>) : {};
    const reactions = Array.isArray(item.reactions)
      ? item.reactions
          .map((entry) => {
            if (!entry || typeof entry !== "object") return null;
            const r = entry as Record<string, unknown>;
            const text = clean(r.text, 60);
            if (!text) return null;
            return { text, at: clampInt(r.at, 0, Number.MAX_SAFE_INTEGER, Date.now()), tag: clean(r.tag, 6) || "익명" };
          })
          .filter((entry): entry is { text: string; at: number; tag: string } => Boolean(entry))
          .slice(-MAX_REACTIONS_PER_ISSUE)
      : [];

    doc.items[id] = {
      question: clean(item.question, 60) || "이 이슈, 어떻게 봐요?",
      a: clean(item.a, 60) || "A",
      b: clean(item.b, 60) || "B",
      votes: {
        a: clampInt(votesRaw.a, 0, 10_000_000, 0),
        b: clampInt(votesRaw.b, 0, 10_000_000, 0),
      },
      voters,
      reactions,
    };
  }
  doc.updatedAt = clampInt(row.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0);
  return doc;
}

function voterTag(voterId: string): string {
  let h = 2166136261;
  for (let i = 0; i < voterId.length; i += 1) {
    h ^= voterId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 4);
}

/** 응답에는 집계와 내 선택만. 다른 사람의 voterId는 절대 나가지 않습니다. */
function snapshot(id: string, item: PollItem, voterId: string) {
  const total = item.votes.a + item.votes.b;
  return {
    id,
    question: item.question,
    a: item.a,
    b: item.b,
    counts: { a: item.votes.a, b: item.votes.b },
    total,
    my: voterId ? item.voters[voterId] ?? null : null,
    reactions: item.reactions.slice(-30).map((entry) => ({ text: entry.text, at: entry.at, tag: entry.tag })),
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const store = storeLabel();
  const voterIdRaw = queryValue(req, "voterId") || String(req.headers["x-voter-id"] ?? "");
  const voter = VOTER_PATTERN.test(voterIdRaw) ? voterIdRaw : "";

  if (req.method === "GET") {
    const ids = (queryValue(req, "ids") || "")
      .split(",")
      .map((id) => id.trim())
      .filter((id) => ID_PATTERN.test(id))
      .slice(0, 30);
    if (ids.length === 0) {
      res.status(200).json({ ok: true, mode: store.shared ? "shared" : "local", store: store.kind, polls: {} });
      return;
    }
    const doc = normalizeDoc(await kvGet<PollDoc>(DOC_KEY));
    const polls: Record<string, unknown> = {};
    for (const id of ids) {
      const item = doc.items[id];
      if (item) polls[id] = snapshot(id, item, voter);
    }
    res.status(200).json({ ok: true, mode: store.shared ? "shared" : "local", store: store.kind, polls });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method_not_allowed", message: "GET·POST만 지원합니다." });
    return;
  }

  if (rateLimited("poll", clientIp(req), 60, 60_000)) {
    res.status(429).json({ ok: false, error: "rate_limited", message: "잠시 요청이 몰렸습니다. 잠시 뒤 다시 시도해 주세요." });
    return;
  }

  const body = parseBody(req);
  if (!body) {
    res.status(400).json({ ok: false, error: "bad_request", message: "JSON 본문을 읽을 수 없습니다." });
    return;
  }

  const action = clean(body.action, 12);
  const issueId = clean(body.issueId, 64);
  const bodyVoter = clean(body.voterId, 72);
  const actor = VOTER_PATTERN.test(bodyVoter) ? bodyVoter : voter;

  if (!ID_PATTERN.test(issueId)) {
    res.status(400).json({ ok: false, error: "bad_issue", message: "카드 id를 확인해 주세요." });
    return;
  }
  if (!actor) {
    res.status(400).json({ ok: false, error: "no_voter", message: "익명 참여자 식별값이 필요합니다." });
    return;
  }

  const doc = normalizeDoc(await kvGet<PollDoc>(DOC_KEY));
  const existing = doc.items[issueId];
  const item: PollItem = existing ?? {
    question: clean(body.question, 60) || "이 이슈, 어떻게 봐요?",
    a: clean(body.a, 60) || "A",
    b: clean(body.b, 60) || "B",
    votes: { a: 0, b: 0 },
    voters: {},
    reactions: [],
  };

  if (action === "vote") {
    const choice = clean(body.choice, 2) as Choice;
    if (choice !== "a" && choice !== "b") {
      res.status(400).json({ ok: false, error: "bad_choice", message: "선택은 a 또는 b입니다." });
      return;
    }
    const previous = item.voters[actor];
    if (previous !== choice) {
      if (!previous && Object.keys(item.voters).length >= MAX_VOTERS_PER_ISSUE) {
        res.status(200).json({
          ok: true,
          mode: store.shared ? "shared" : "local",
          store: store.kind,
          capped: true,
          poll: snapshot(issueId, item, actor),
        });
        return;
      }
      if (previous) item.votes[previous] = Math.max(0, item.votes[previous] - 1);
      item.votes[choice] += 1;
      item.voters[actor] = choice;
    }
  } else if (action === "react") {
    const text = clean(body.text, 60);
    if (text.length < 2) {
      res.status(400).json({ ok: false, error: "bad_reaction", message: "한 줄 반응을 2자 이상 적어 주세요." });
      return;
    }
    item.reactions = [...item.reactions, { text, at: Date.now(), tag: voterTag(actor) }].slice(-MAX_REACTIONS_PER_ISSUE);
  } else {
    res.status(400).json({ ok: false, error: "unknown_action", message: "action은 vote·react 중 하나입니다." });
    return;
  }

  doc.items[issueId] = item;
  doc.updatedAt = Date.now();

  const ids = Object.keys(doc.items);
  if (ids.length > MAX_ISSUES) {
    const keep = ids.sort((a, b) => doc.items[a].reactions.length - doc.items[b].reactions.length).slice(-MAX_ISSUES);
    doc.items = Object.fromEntries(keep.map((id) => [id, doc.items[id]]));
  }

  await kvSet(DOC_KEY, doc, 60 * 60 * 24 * 30);

  res.status(200).json({
    ok: true,
    mode: store.shared ? "shared" : "local",
    store: store.kind,
    action,
    poll: snapshot(issueId, item, actor),
  });
}
