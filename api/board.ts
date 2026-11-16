/**
 * 이슈온도계 공용 보드 백엔드 (Vercel 서버리스 함수)
 *
 * GET  /api/board?voterId=…   이슈 목록 · 투표 집계 · 팩폭 댓글 · 내 투표
 * POST /api/board             이슈 발행 / 여론 온도계 투표 / 팩폭 댓글 등록
 *
 * 저장소는 환경변수에 따라 자동으로 고릅니다.
 *   1) UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN  → mode: "shared" (store: "redis")
 *   2) SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY(또는 SUPABASE_ANON_KEY) → mode: "shared" (store: "supabase")
 *   3) 아무 키도 없음 → 함수 인스턴스 임시 저장소 → mode: "local" (store: "memory")
 *
 * 어떤 경우에도 500으로 죽지 않습니다. 저장소가 응답하지 않으면 임시 저장소로 내려가고,
 * 응답의 mode/store가 지금 실제로 어디에 저장됐는지를 정직하게 알려 줍니다.
 * 데모 이슈의 초기 투표수(에디터 기준값)는 클라이언트가 갖고 있고, 여기에는 실제 참여표만 쌓입니다.
 */

const ENV: Record<string, string | undefined> =
  (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

const DOC_KEY = "factbomb:board:v1";
const DOC_VERSION = 2;
const MAX_ISSUES = 300;
const MAX_COMMENTS = 2000;
const MAX_VOTERS_PER_ISSUE = 50_000;
const STORE_TIMEOUT_MS = 4_000;

export const config = { maxDuration: 30 };

type Reaction = "hot" | "watch" | "cool";
const REACTIONS: Reaction[] = ["hot", "watch", "cool"];
const CATEGORIES = ["tech", "retail", "culture", "work"];

interface VercelRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface VercelResponse {
  status(code: number): VercelResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
}

interface VoteRecord {
  hot: number;
  watch: number;
  cool: number;
  voters: Record<string, Reaction>;
}

interface StoredIssue {
  id: string;
  category: string;
  headline: string;
  kicker: string;
  summary: string[];
  insider: string;
  insiderAlt?: string;
  debate?: { pro: string[]; con: string[] };
  baseTemp: number;
  source: string;
  publishedAt: number;
  tags: string[];
}

interface StoredComment {
  id: string;
  issueId: string;
  author: string;
  text: string;
  likes: number;
  createdAt: number;
}

interface BoardDoc {
  version: number;
  issues: StoredIssue[];
  votes: Record<string, VoteRecord>;
  comments: StoredComment[];
  updatedAt: number;
}

type StoreKind = "redis" | "supabase" | "memory";

interface Store {
  kind: StoreKind;
  read(): Promise<BoardDoc>;
  write(doc: BoardDoc): Promise<void>;
}

/* ------------------------------------------------------------------ helpers */

const clean = (value: unknown, max = 2_000): string =>
  typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, max)
    : "";

const cleanLine = (value: unknown, max = 200): string => clean(value, max);

const cleanList = (value: unknown, maxItems: number, maxChars: number): string[] =>
  Array.isArray(value)
    ? value.map((item) => cleanLine(item, maxChars)).filter(Boolean).slice(0, maxItems)
    : [];

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const ID_PATTERN = /^[A-Za-z0-9_-]{6,72}$/;
const VOTER_PATTERN = /^[A-Za-z0-9_-]{6,72}$/;

/** 익명 작성자 표기 — 같은 브라우저의 팩폭은 같은 꼬리표를 갖습니다(개인 식별 정보 없음). */
function voterTag(voterId: string): string {
  let h = 2166136261;
  for (let i = 0; i < voterId.length; i += 1) {
    h ^= voterId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 4);
}

function emptyDoc(): BoardDoc {
  return { version: DOC_VERSION, issues: [], votes: {}, comments: [], updatedAt: 0 };
}

function normalizeDoc(raw: unknown): BoardDoc {
  if (!raw || typeof raw !== "object") return emptyDoc();
  const row = raw as Record<string, unknown>;
  const out = emptyDoc();

  if (Array.isArray(row.issues)) {
    for (const item of row.issues) {
      const issue = sanitizeIssue(item, true);
      if (issue) out.issues.push(issue);
    }
  }
  if (row.votes && typeof row.votes === "object") {
    for (const [issueId, value] of Object.entries(row.votes as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      const voters: Record<string, Reaction> = {};
      if (v.voters && typeof v.voters === "object") {
        for (const [voter, reaction] of Object.entries(v.voters as Record<string, unknown>)) {
          if (typeof reaction === "string" && (REACTIONS as string[]).includes(reaction)) {
            voters[voter] = reaction as Reaction;
          }
        }
      }
      out.votes[issueId] = {
        hot: clampInt(v.hot, 0, 10_000_000, 0),
        watch: clampInt(v.watch, 0, 10_000_000, 0),
        cool: clampInt(v.cool, 0, 10_000_000, 0),
        voters,
      };
    }
  }
  if (Array.isArray(row.comments)) {
    for (const item of row.comments) {
      const comment = sanitizeComment(item);
      if (comment) out.comments.push(comment);
    }
  }
  out.updatedAt = clampInt(row.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0);
  return out;
}

function sanitizeIssue(raw: unknown, fromStore = false): StoredIssue | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = clean(row.id, 72);
  if (!ID_PATTERN.test(id)) return null;
  const headline = cleanLine(row.headline, 72);
  if (headline.length < 4) return null;
  const category = clean(row.category, 12);
  const summary = cleanList(row.summary, 3, 180);
  const baseTemp = clampInt(row.baseTemp, 0, 100, 55);
  const now = Date.now();
  const publishedAtRaw = typeof row.publishedAt === "number" ? row.publishedAt : Number(row.publishedAt);
  const publishedAt = Number.isFinite(publishedAtRaw) && publishedAtRaw > now - 1000 * 60 * 60 * 24 * 60
    ? Math.min(publishedAtRaw, now + 60 * 60 * 1000)
    : now;
  const debateRaw = row.debate && typeof row.debate === "object" ? (row.debate as Record<string, unknown>) : null;
  const debate = debateRaw
    ? { pro: cleanList(debateRaw.pro, 3, 140), con: cleanList(debateRaw.con, 3, 140) }
    : undefined;

  const issue: StoredIssue = {
    id,
    category: (CATEGORIES as string[]).includes(category) ? category : "tech",
    headline,
    kicker: cleanLine(row.kicker, 60),
    summary: summary.length > 0 ? summary : [headline],
    insider: cleanLine(row.insider, 400),
    baseTemp,
    source: cleanLine(row.source, 40) || (fromStore ? "공용 보드" : "에디터 발행"),
    publishedAt: Math.round(publishedAt),
    tags: cleanList(row.tags, 4, 20),
  };
  const insiderAlt = cleanLine(row.insiderAlt, 400);
  if (insiderAlt) issue.insiderAlt = insiderAlt;
  if (debate && (debate.pro.length || debate.con.length)) issue.debate = debate;
  return issue;
}

function sanitizeComment(raw: unknown): StoredComment | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = clean(row.id, 72);
  const issueId = clean(row.issueId, 72);
  const text = cleanLine(row.text, 100);
  if (!ID_PATTERN.test(id) || !ID_PATTERN.test(issueId) || text.length === 0) return null;
  return {
    id,
    issueId,
    author: cleanLine(row.author, 24) || "익명",
    text,
    likes: clampInt(row.likes, 0, 10_000_000, 0),
    createdAt: clampInt(row.createdAt, 0, Number.MAX_SAFE_INTEGER, Date.now()),
  };
}

/* ------------------------------------------------------------------- stores */

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STORE_TIMEOUT_MS);
  return run(controller.signal).finally(() => clearTimeout(timer));
}

function memoryStore(): Store {
  const holder = globalThis as unknown as { __factbombBoardDoc?: BoardDoc };
  return {
    kind: "memory",
    async read() {
      if (!holder.__factbombBoardDoc) holder.__factbombBoardDoc = emptyDoc();
      return normalizeDoc(holder.__factbombBoardDoc);
    },
    async write(doc) {
      holder.__factbombBoardDoc = doc;
    },
  };
}

function redisStore(url: string, token: string): Store {
  const base = url.replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${token}` };
  return {
    kind: "redis",
    async read() {
      const raw = await withTimeout(async (signal) => {
        const response = await fetch(base, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(["GET", DOC_KEY]),
          signal,
        });
        if (!response.ok) throw new Error(`redis get ${response.status}`);
        return (await response.json()) as { result?: string | null; error?: string };
      });
      if (raw.error) throw new Error(raw.error);
      if (!raw.result) return emptyDoc();
      try {
        return normalizeDoc(JSON.parse(raw.result));
      } catch {
        return emptyDoc();
      }
    },
    async write(doc) {
      await withTimeout(async (signal) => {
        const response = await fetch(base, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(["SET", DOC_KEY, JSON.stringify(doc)]),
          signal,
        });
        if (!response.ok) throw new Error(`redis set ${response.status}`);
        const payload = (await response.json()) as { error?: string };
        if (payload.error) throw new Error(payload.error);
      });
    },
  };
}

function supabaseStore(url: string, key: string): Store {
  const base = url.replace(/\/+$/, "");
  const table = `${base}/rest/v1/factbomb_board`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  return {
    kind: "supabase",
    async read() {
      const rows = await withTimeout(async (signal) => {
        const response = await fetch(`${table}?id=eq.main&select=data`, { headers, signal });
        if (!response.ok) throw new Error(`supabase get ${response.status}`);
        return (await response.json()) as { data?: unknown }[];
      });
      if (!Array.isArray(rows) || rows.length === 0) return emptyDoc();
      return normalizeDoc(rows[0]?.data);
    },
    async write(doc) {
      await withTimeout(async (signal) => {
        const response = await fetch(table, {
          method: "POST",
          headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ id: "main", data: doc, updated_at: new Date().toISOString() }),
          signal,
        });
        if (!response.ok) throw new Error(`supabase write ${response.status}`);
      });
    },
  };
}

interface ResolvedStore {
  store: Store;
  /** 저장소가 설정값과 달리 내려간 경우의 안내 (정직한 상태 표시용) */
  fallbackFrom?: "redis" | "supabase";
  note?: string;
}

function pickStore(): ResolvedStore {
  const upstashUrl = ENV.UPSTASH_REDIS_REST_URL?.trim();
  const upstashToken = ENV.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (upstashUrl && upstashToken) return { store: redisStore(upstashUrl, upstashToken) };

  const supabaseUrl = ENV.SUPABASE_URL?.trim();
  const supabaseKey = (ENV.SUPABASE_SERVICE_ROLE_KEY || ENV.SUPABASE_ANON_KEY || "").trim();
  if (supabaseUrl && supabaseKey) return { store: supabaseStore(supabaseUrl, supabaseKey) };

  return { store: memoryStore() };
}

/**
 * 읽고-고치고-쓰기. 공용 저장소가 죽어 있으면 임시 저장소로 내려가서라도 요청을 실패시키지 않습니다.
 */
async function withStore<T>(
  run: (store: Store, doc: BoardDoc) => Promise<T> | T,
): Promise<{ result: T; storeKind: StoreKind; mode: "shared" | "local"; note?: string }> {
  const picked = pickStore();
  try {
    const doc = await picked.store.read();
    const result = await run(picked.store, doc);
    return {
      result,
      storeKind: picked.store.kind,
      mode: picked.store.kind === "memory" ? "local" : "shared",
    };
  } catch (error) {
    const memory = memoryStore();
    const doc = await memory.read();
    const result = await run(memory, doc);
    return {
      result,
      storeKind: "memory",
      mode: "local",
      note: `${picked.store.kind === "redis" ? "Upstash Redis" : "Supabase"}에 연결하지 못해 임시 저장소로 동작 중입니다. (${
        error instanceof Error ? error.message : "unknown"
      })`,
    };
  }
}

/* ----------------------------------------------------------------- handlers */

function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Cache-Control", "no-store");
}

function headerValue(req: VercelRequest, name: string): string {
  const raw = req.headers[name] ?? req.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0]?.trim() ?? "";
  return typeof raw === "string" ? raw.trim() : "";
}

function queryValue(req: VercelRequest, name: string): string {
  const direct = req.query?.[name];
  if (typeof direct === "string") return direct;
  if (Array.isArray(direct)) return direct[0] ?? "";
  const url = headerValue(req, "x-forwarded-uri") || req.url || "";
  const index = url.indexOf("?");
  if (index < 0) return "";
  const params = new URLSearchParams(url.slice(index + 1));
  return params.get(name) ?? "";
}

function parseBody(req: VercelRequest): Record<string, unknown> | null {
  const raw = req.body;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

/** 응답에서는 voterId 원본을 절대 내보내지 않고, 요청자 본인의 선택만 골라 돌려줍니다. */
function publicVotes(doc: BoardDoc): Record<string, { hot: number; watch: number; cool: number }> {
  const out: Record<string, { hot: number; watch: number; cool: number }> = {};
  for (const [issueId, value] of Object.entries(doc.votes)) {
    out[issueId] = { hot: value.hot, watch: value.watch, cool: value.cool };
  }
  return out;
}

function myVotesOf(doc: BoardDoc, voterId: string): Record<string, Reaction> {
  const out: Record<string, Reaction> = {};
  if (!voterId) return out;
  for (const [issueId, value] of Object.entries(doc.votes)) {
    const reaction = value.voters?.[voterId];
    if (reaction) out[issueId] = reaction;
  }
  return out;
}

function snapshotFor(doc: BoardDoc, voterId: string) {
  return {
    issues: [...doc.issues].sort((a, b) => b.publishedAt - a.publishedAt),
    votes: publicVotes(doc),
    comments: doc.comments.slice(-Math.min(doc.comments.length, 1000)),
    myVotes: myVotesOf(doc, voterId),
    updatedAt: doc.updatedAt,
    counts: {
      issues: doc.issues.length,
      comments: doc.comments.length,
      votes: Object.values(doc.votes).reduce((sum, v) => sum + v.hot + v.watch + v.cool, 0),
    },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const voterIdRaw = queryValue(req, "voterId") || headerValue(req, "x-voter-id");
  const voterId = VOTER_PATTERN.test(voterIdRaw) ? voterIdRaw : "";

  if (req.method === "GET") {
    const { result, storeKind, mode, note } = await withStore(async (store, doc) => {
      // 아직 아무것도 저장되지 않은 저장소라면 문서를 한 번 만들어 둡니다(다음 쓰기가 바로 되도록).
      if (!doc.updatedAt) {
        doc.updatedAt = Date.now();
        await store.write(doc);
      }
      return snapshotFor(doc, voterId);
    });

    res.status(200).json({ ok: true, mode, store: storeKind, ...(note ? { note } : {}), ...result });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method_not_allowed", message: "GET·POST만 지원합니다." });
    return;
  }

  const body = parseBody(req);
  if (!body) {
    res.status(400).json({ ok: false, error: "bad_request", message: "JSON 본문을 읽을 수 없습니다." });
    return;
  }

  const action = clean(body.action, 16);
  const bodyVoter = clean(body.voterId, 72);
  const actor = VOTER_PATTERN.test(bodyVoter) ? bodyVoter : voterId;
  if (!actor) {
    res.status(400).json({ ok: false, error: "no_voter", message: "익명 참여자 식별값(voterId)이 필요합니다." });
    return;
  }

  if (action === "publish") {
    const issue = sanitizeIssue(body.issue);
    if (!issue) {
      res.status(400).json({ ok: false, error: "bad_issue", message: "이슈 형식이 올바르지 않습니다. (id·헤드라인 확인)" });
      return;
    }
    const { result, storeKind, mode, note } = await withStore(async (store, doc) => {
      const existing = doc.issues.findIndex((item) => item.id === issue.id);
      if (existing >= 0) doc.issues[existing] = issue;
      else doc.issues.push(issue);
      if (doc.issues.length > MAX_ISSUES) {
        doc.issues = [...doc.issues].sort((a, b) => b.publishedAt - a.publishedAt).slice(0, MAX_ISSUES);
      }
      doc.updatedAt = Date.now();
      await store.write(doc);
      return { issue, updatedAt: doc.updatedAt };
    });
    res.status(200).json({ ok: true, mode, store: storeKind, action, ...(note ? { note } : {}), ...result });
    return;
  }

  if (action === "vote") {
    const issueId = clean(body.issueId, 72);
    const reaction = clean(body.reaction, 8) as Reaction;
    if (!ID_PATTERN.test(issueId) || !(REACTIONS as string[]).includes(reaction)) {
      res.status(400).json({ ok: false, error: "bad_vote", message: "이슈 id와 반응(hot·watch·cool)을 확인해 주세요." });
      return;
    }
    const { result, storeKind, mode, note } = await withStore(async (store, doc) => {
      const current: VoteRecord = doc.votes[issueId] ?? { hot: 0, watch: 0, cool: 0, voters: {} };
      const voters = { ...current.voters };
      const previous = voters[actor];
      if (previous !== reaction) {
        if (!previous && Object.keys(voters).length >= MAX_VOTERS_PER_ISSUE) {
          return { votes: { hot: current.hot, watch: current.watch, cool: current.cool }, myVote: previous ?? null, capped: true };
        }
        const counts = { hot: current.hot, watch: current.watch, cool: current.cool };
        if (previous) counts[previous] = Math.max(0, counts[previous] - 1);
        counts[reaction] += 1;
        voters[actor] = reaction;
        doc.votes[issueId] = { ...counts, voters };
        doc.updatedAt = Date.now();
        await store.write(doc);
        return { votes: counts, myVote: reaction };
      }
      return { votes: { hot: current.hot, watch: current.watch, cool: current.cool }, myVote: reaction };
    });
    res.status(200).json({ ok: true, mode, store: storeKind, action, issueId, ...(note ? { note } : {}), ...result });
    return;
  }

  if (action === "comment") {
    const candidate = body.comment;
    const comment = sanitizeComment(candidate);
    if (!comment) {
      res.status(400).json({ ok: false, error: "bad_comment", message: "팩폭은 1~100자로 입력해 주세요." });
      return;
    }
    const author = `익명 ${voterTag(actor)}`;
    const { result, storeKind, mode, note } = await withStore(async (store, doc) => {
      const stored: StoredComment = { ...comment, author, likes: 0 };
      const existing = doc.comments.findIndex((item) => item.id === stored.id);
      if (existing >= 0) doc.comments[existing] = stored;
      else doc.comments.push(stored);
      if (doc.comments.length > MAX_COMMENTS) doc.comments = doc.comments.slice(-MAX_COMMENTS);
      doc.updatedAt = Date.now();
      await store.write(doc);
      return { comment: stored, updatedAt: doc.updatedAt };
    });
    res.status(200).json({ ok: true, mode, store: storeKind, action, ...(note ? { note } : {}), ...result });
    return;
  }

  res.status(400).json({ ok: false, error: "unknown_action", message: "action은 publish·vote·comment 중 하나입니다." });
}
