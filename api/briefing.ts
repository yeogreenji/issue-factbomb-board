/**
 * 이슈온도계 팩폭 초안 백엔드 (Vercel 서버리스 함수)
 *
 * POST /api/briefing
 *   body: { title?, body, angle?, category?, apiKey? }
 *   - 키 우선순위: GEMINI_API_KEY(서버) → 요청 키가 sk-…가 아닐 때(AIza…·AQ.… 등 Google 키) → OPENAI_API_KEY(서버) → 요청 키(sk-…)
 *     · Gemini 키는 Google Gemini REST API(generativelanguage.googleapis.com)로, 그 외 키는 기존 OpenAI Chat Completions로 보냅니다.
 *   - 요청 키는 x-api-key 헤더 → body.apiKey 순으로 찾습니다. 서버 키가 있으면 요청 키는 쓰지 않습니다.
 *   - 키가 없으면 501 { error: "no_key" } 를 돌려주고, 앱은 규칙 요약으로 초안을 만듭니다.
 *   - 결과: 한 줄 팩폭 · 3줄 요약 · 업계인 속마음 2건 · 여론 찬반 포인트
 *
 * GET /api/briefing  → 서버 상태(키 설정 여부·제공자·모델명)만 반환합니다. 키 값은 절대 내려보내지 않습니다.
 */

const ENV: Record<string, string | undefined> =
  (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

const OPENAI_MODEL = ENV.OPENAI_MODEL?.trim() || "gpt-4o-mini";
const OPENAI_BASE = (ENV.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const OPENAI_URL = `${OPENAI_BASE}/chat/completions`;

const GEMINI_MODEL = ENV.GEMINI_MODEL?.trim() || "gemini-3.8-flash";
const GEMINI_BASE = (ENV.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");

const OPENAI_KEY_PREFIX = "sk-";

const MIN_BODY_CHARS = 20;
const MAX_BODY_CHARS = 6_000;
const UPSTREAM_TIMEOUT_MS = 45_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 15;

const CATEGORIES = ["tech", "retail", "culture", "work"] as const;
type Category = (typeof CATEGORIES)[number];

type Provider = "gemini" | "openai";

interface Route {
  provider: Provider;
  key: string;
}

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

export const config = { maxDuration: 60 };

const SYSTEM_PROMPT = `당신은 한국 PR 에이전시에서 미디어 트렌드를 읽는 수석 에디터입니다.
기자·업계 실무자·일반 독자가 30초 안에 "무슨 일이 있었고, 그래서 뭐가 문제인지"를 잡을 수 있는 브리핑을 씁니다.
이 보드의 무기는 뉴스 요약이 아니라 '업계 사람만 하는 해석'입니다. 그 해석을 담백하고 정확하게 씁니다.

반드시 지킬 것:
- 제공된 기사 본문·메모에 없는 사실, 수치, 기관명, 인물명, 회사명을 만들어내지 마세요.
- 실존 인물의 실명·연락처·이메일·계정·직함을 새로 쓰지 마세요. 필요하면 "관계자", "해당 기업"처럼 씁니다.
- 확인되지 않은 내용을 단정하지 말고, 메모에 있는 사실만 근거로 씁니다.
- "최선을 다하겠습니다", "지켜보겠습니다" 같은 빈 문장 금지. 판단과 근거를 씁니다.
- 말투: 짧고 단호한 한국어. 팩폭은 비꼬지 않되 뼈를 때리는 한 문장.
- 출력은 아래 스키마의 JSON 객체 하나뿐입니다. 코드블록·설명·인사말·주석을 붙이지 마세요.

JSON 스키마:
{
  "headline": "팩폭 헤드라인. 40자 이내, 사실 기반, 클릭베이트 금지",
  "oneLiner": "한 줄 팩폭. 60자 이내. 이 이슈의 핵심을 찌르는 문장",
  "kicker": "헤드라인 아래 한 줄 맥락. 50자 이내",
  "summary": ["무슨 일이 있었나", "어떻게 됐나", "그래서 지금 무엇이 문제인가 — 정확히 3개, 각 90자 이내"],
  "insider": ["업계인 속마음 1 — 뉴스에 안 나오는 현장의 해석, 120자 이내", "업계인 속마음 2 — 다른 각도에서 본 판단, 120자 이내"],
  "debate": {
    "pro": ["이 이슈를 옹호하거나 이해하는 쪽의 논리 1", "논리 2 (각 100자 이내)"],
    "con": ["비판하는 쪽의 논리 1", "논리 2 (각 100자 이내)"]
  },
  "category": "tech | retail | culture | work 중 하나",
  "baseTemp": 0~100 정수 (지금 여론이 달아오른 정도. 사과·철회·품절·논란이면 70 이상, 단순 발표면 30~50),
  "tags": ["검색에 쓸 키워드 2~4개"]
}`;

/* ------------------------------------------------------------------ helpers */

const clean = (value: unknown, max = 2_000): string =>
  typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, max)
    : "";

const cleanMultiline = (value: unknown, max = 2_000): string =>
  typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max)
    : "";

const cleanList = (value: unknown, maxItems: number, maxChars: number): string[] =>
  Array.isArray(value)
    ? value.map((item) => clean(item, maxChars)).filter(Boolean).slice(0, maxItems)
    : [];

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

function setCors(res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Cache-Control", "no-store");
}

function headerValue(req: VercelRequest, name: string): string {
  const raw = req.headers[name] ?? req.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0]?.trim() ?? "";
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * 요청 키가 Google Gemini 키인지 판별합니다.
 * Google AI Studio 키는 `AIza…`, 새로 발급되는 키는 `AQ.…` 형태이고, OpenAI 키만 `sk-…` 입니다.
 * 그래서 `sk-`로 시작하지 않는 요청 키는 Gemini 키로 봅니다.
 */
function isGeminiRequestKey(key: string): boolean {
  return key.length > 0 && !key.startsWith(OPENAI_KEY_PREFIX);
}

/**
 * 어느 제공자로 보낼지 정합니다.
 * 무료 Google Gemini 키(GEMINI_API_KEY, 또는 AIza…·AQ.… 요청 키)를 먼저 쓰고, 없으면 기존 OpenAI 경로로 갑니다.
 * 서버 환경변수 GEMINI_API_KEY는 접두사와 무관하게 항상 Gemini로 보냅니다.
 */
function resolveRoute(requestKey: string): Route | null {
  const geminiEnv = ENV.GEMINI_API_KEY?.trim() ?? "";
  const openaiEnv = ENV.OPENAI_API_KEY?.trim() ?? "";

  if (geminiEnv) return { provider: "gemini", key: geminiEnv };
  if (isGeminiRequestKey(requestKey)) return { provider: "gemini", key: requestKey };
  if (openaiEnv) return { provider: "openai", key: openaiEnv };
  if (requestKey) return { provider: "openai", key: requestKey };
  return null;
}

function clientIp(req: VercelRequest): string {
  return (
    headerValue(req, "x-forwarded-for").split(",")[0]?.trim() ||
    headerValue(req, "x-real-ip") ||
    "unknown"
  );
}

/** 함수 인스턴스 단위의 가벼운 요청 제한 — 공개 배포에서 키 비용이 무한정 새지 않도록. */
const buckets = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (buckets.get(ip) ?? []).filter((time) => now - time < RATE_LIMIT_WINDOW_MS);
  if (hits.length >= RATE_LIMIT_MAX) {
    buckets.set(ip, hits);
    return true;
  }
  hits.push(now);
  buckets.set(ip, hits);
  if (buckets.size > 500) {
    for (const [key, times] of buckets) {
      if (times.every((time) => now - time >= RATE_LIMIT_WINDOW_MS)) buckets.delete(key);
    }
  }
  return false;
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

interface BriefingResult {
  headline: string;
  oneLiner: string;
  kicker: string;
  summary: string[];
  insider: string[];
  debate: { pro: string[]; con: string[] };
  category: Category;
  baseTemp: number;
  tags: string[];
}

/** AI 응답을 앱이 바로 쓸 수 있는 형태로만 남깁니다. 형식이 어긋나면 null. */
function normalizeResult(raw: unknown): BriefingResult | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const headline = clean(row.headline, 72);
  const summary = cleanList(row.summary, 3, 180);
  const insider = cleanList(row.insider, 2, 400);
  if (headline.length < 4 || summary.length < 2) return null;

  const debateRaw = row.debate && typeof row.debate === "object" ? (row.debate as Record<string, unknown>) : {};
  const pro = cleanList(debateRaw.pro, 2, 160);
  const con = cleanList(debateRaw.con, 2, 160);
  const category = clean(row.category, 12);
  const tags = cleanList(row.tags, 4, 20);
  const oneLiner = clean(row.oneLiner, 90) || clean(row.kicker, 60) || summary[0] || headline;

  return {
    headline,
    oneLiner,
    kicker: clean(row.kicker, 60) || oneLiner,
    summary: summary.length >= 3 ? summary : [...summary, summary[summary.length - 1] ?? headline].slice(0, 3),
    insider,
    debate: { pro, con },
    category: (CATEGORIES as readonly string[]).includes(category) ? (category as Category) : "tech",
    baseTemp: clampInt(row.baseTemp, 5, 99, 55),
    tags: tags.length > 0 ? tags : [category],
  };
}

function buildUserPrompt(input: { title: string; body: string; angle: string; category: string }): string {
  const lines: string[] = [];
  if (input.title) lines.push(`[기사 제목] ${input.title}`);
  if (input.category) lines.push(`[에디터가 고른 카테고리] ${input.category}`);
  if (input.angle) lines.push(`[에디터가 짚고 싶은 관점] ${input.angle}`);
  lines.push(`[기사 본문 / 현장 메모]\n${input.body}`);
  lines.push(
    "\n위 내용만 근거로 스키마에 맞는 JSON을 만드세요. 메모에 없는 수치·회사명·인물은 쓰지 말고, 요약 3줄은 정확히 3개, insider는 정확히 2개로 작성하세요.",
  );
  return lines.join("\n");
}

type UpstreamResult =
  | { ok: true; content: string; usage: unknown; model: string }
  | { ok: false; status: number; error: "upstream_error" | "empty_completion"; message: string };

const PROVIDER_LABEL: Record<Provider, string> = { gemini: "Gemini", openai: "OpenAI" };

function upstreamHint(provider: Provider, status: number): string {
  if (status === 401 || status === 403) return "API 키가 유효하지 않습니다.";
  if (status === 429) return `${PROVIDER_LABEL[provider]} 요청 한도에 걸렸습니다.`;
  if (status === 402 || status === 400) return `${PROVIDER_LABEL[provider]} 결제·키 설정을 확인해 주세요.`;
  if (status === 404) return `${PROVIDER_LABEL[provider]} 모델명을 확인해 주세요.`;
  return "AI 제공자 응답 오류입니다.";
}

function errorDetail(rawText: string): string {
  let detail = rawText.slice(0, 240);
  try {
    const parsed = JSON.parse(rawText) as { error?: { message?: string; status?: string } };
    if (parsed?.error?.message) detail = parsed.error.message.slice(0, 240);
  } catch {
    /* 원문 유지 */
  }
  return detail;
}

/** Google Gemini REST API — 무료 티어 키(AIza…·AQ.…)로도 동작합니다. */
const GEMINI_FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash"];
/** 이 함수 인스턴스에서 성공한 모델을 기억해, 이후 호출은 바로 그 모델로 보냅니다. */
let geminiModelInUse = "";

function geminiModelCandidates(): string[] {
  const preferred = [geminiModelInUse || GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS];
  return preferred.filter((model, index) => Boolean(model) && preferred.indexOf(model) === index);
}

/** 모델 ID가 이 계정에서 쓸 수 없다는 응답인지(구 모델·오타·신규 사용자 차단) 판별합니다. */
function modelUnavailable(status: number, detail: string): boolean {
  if (status !== 404 && status !== 400) return false;
  return /not found|not supported|no longer available|does not exist|unsupported|NOT_FOUND|INVALID_ARGUMENT.*model/i.test(detail);
}

async function callGemini(route: Route, prompt: string, signal: AbortSignal): Promise<UpstreamResult> {
  const candidates = geminiModelCandidates();
  let last: UpstreamResult | null = null;

  for (const model of candidates) {
    // 키는 x-goog-api-key 헤더로 보내고(로그에 키가 남지 않게), ?key= 도 함께 실어 보냅니다.
    const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(route.key)}`;
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": route.key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.4, maxOutputTokens: 1_400 },
      }),
      signal,
    });

    if (!upstream.ok) {
      const detail = errorDetail(await upstream.text().catch(() => ""));
      last = {
        ok: false,
        status: upstream.status,
        error: "upstream_error",
        message: `${upstreamHint("gemini", upstream.status)} [${model}] ${detail}`.trim(),
      };
      if (modelUnavailable(upstream.status, detail)) continue;
      return last;
    }

    const data = (await upstream.json()) as {
      candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
      promptFeedback?: { blockReason?: string };
      usageMetadata?: unknown;
    };
    // 생각(thought) 파트는 답이 아니므로 빼고, 실제 답 텍스트만 붙입니다.
    const content = (data.candidates?.[0]?.content?.parts ?? [])
      .filter((part) => part && part.thought !== true && typeof part.text === "string")
      .map((part) => part.text ?? "")
      .join("")
      .trim();

    if (!content) {
      const blocked = data.promptFeedback?.blockReason || data.candidates?.[0]?.finishReason;
      return {
        ok: false,
        status: 502,
        error: "empty_completion",
        message: blocked
          ? `Gemini가 내용을 만들지 못했습니다(${blocked}). 메모를 다듬어 다시 시도해 주세요.`
          : "AI가 빈 응답을 보냈습니다. 다시 시도해 주세요.",
      };
    }

    geminiModelInUse = model;
    return { ok: true, content, usage: data.usageMetadata ?? null, model };
  }

  return (
    last ?? {
      ok: false,
      status: 502,
      error: "upstream_error",
      message: "Gemini 호출에 실패했습니다.",
    }
  );
}

/** 기존 OpenAI Chat Completions 경로(sk-… 키). */
async function callOpenAI(route: Route, prompt: string, signal: AbortSignal): Promise<UpstreamResult> {
  const model = OPENAI_MODEL;
  const upstream = await fetch(OPENAI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${route.key}` },
    body: JSON.stringify({
      model,
      temperature: 0.5,
      max_tokens: 1_400,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
    }),
    signal,
  });

  if (!upstream.ok) {
    const detail = errorDetail(await upstream.text().catch(() => ""));
    return {
      ok: false,
      status: upstream.status,
      error: "upstream_error",
      message: `${upstreamHint("openai", upstream.status)} ${detail}`.trim(),
    };
  }

  const data = (await upstream.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { total_tokens?: number };
  };
  const content = (data.choices?.[0]?.message?.content ?? "").trim();
  if (!content) {
    return {
      ok: false,
      status: 502,
      error: "empty_completion",
      message: "AI가 빈 응답을 보냈습니다. 다시 시도해 주세요.",
    };
  }

  return { ok: true, content, usage: data.usage ?? null, model };
}

function callUpstream(route: Route, prompt: string, signal: AbortSignal): Promise<UpstreamResult> {
  return route.provider === "gemini" ? callGemini(route, prompt, signal) : callOpenAI(route, prompt, signal);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method === "GET") {
    const geminiKey = Boolean(ENV.GEMINI_API_KEY?.trim());
    const openaiKey = Boolean(ENV.OPENAI_API_KEY?.trim());
    const provider: Provider | null = geminiKey ? "gemini" : openaiKey ? "openai" : null;
    res.status(200).json({
      ok: true,
      ai: Boolean(provider),
      provider,
      model: provider === "gemini" ? GEMINI_MODEL : OPENAI_MODEL,
      serverKey: Boolean(provider),
      keys: { gemini: geminiKey, openai: openaiKey },
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method_not_allowed", message: "POST 요청만 지원합니다." });
    return;
  }

  const body = parseBody(req);
  if (!body) {
    res.status(400).json({ ok: false, error: "bad_request", message: "JSON 본문을 읽을 수 없습니다." });
    return;
  }

  const memo = cleanMultiline(body.body ?? body.memo, MAX_BODY_CHARS + 1);
  if (memo.replace(/\s/g, "").length < MIN_BODY_CHARS) {
    res.status(400).json({
      ok: false,
      error: "memo_too_short",
      message: `기사 본문이나 메모를 ${MIN_BODY_CHARS}자 이상 붙여넣어 주세요.`,
    });
    return;
  }
  if (memo.length > MAX_BODY_CHARS) {
    res.status(413).json({
      ok: false,
      error: "memo_too_long",
      message: `한 번에 ${MAX_BODY_CHARS.toLocaleString("en-US")}자까지 정리합니다. 앞부분을 줄여 주세요.`,
    });
    return;
  }

  const requestKey = headerValue(req, "x-api-key") || clean(body.apiKey, 200);
  const route = resolveRoute(requestKey);
  if (!route) {
    res.status(501).json({
      ok: false,
      error: "no_key",
      message:
        "서버에 GEMINI_API_KEY(또는 OPENAI_API_KEY)가 없습니다. 배포 환경변수에 무료 Gemini 키를 넣거나, 화면의 AI 키 설정에서 개인 키를 입력하면 실시간 AI로 초안을 만듭니다.",
    });
    return;
  }

  if (rateLimited(clientIp(req))) {
    res.status(429).json({
      ok: false,
      error: "rate_limited",
      message: "잠시 요청이 몰렸습니다. 1분 뒤에 다시 시도해 주세요.",
    });
    return;
  }

  const title = clean(body.title, 120);
  const angle = clean(body.angle, 200);
  const category = clean(body.category, 12);

  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const prompt = buildUserPrompt({ title, body: memo, angle, category });
    const upstream = await callUpstream(route, prompt, controller.signal);

    if (!upstream.ok) {
      if (upstream.error === "empty_completion") {
        res.status(502).json({ ok: false, error: "empty_completion", provider: route.provider, message: upstream.message });
        return;
      }
      res
        .status(502)
        .json({ ok: false, error: "upstream_error", provider: route.provider, status: upstream.status, message: upstream.message });
      return;
    }

    const content = upstream.content;
    let parsed: unknown;
    try {
      parsed = JSON.parse(content.replace(/^```(?:json)?/i, "").replace(/```$/g, "").trim());
    } catch {
      res.status(502).json({ ok: false, error: "bad_json", provider: route.provider, message: "AI 응답을 JSON으로 해석하지 못했습니다. 다시 시도해 주세요." });
      return;
    }

    const result = normalizeResult(parsed);
    if (!result) {
      res.status(502).json({
        ok: false,
        error: "bad_shape",
        provider: route.provider,
        message: "AI 응답에 헤드라인이나 요약이 비었습니다. 메모를 조금 더 넣고 다시 시도해 주세요.",
      });
      return;
    }

    res.status(200).json({
      ok: true,
      engine: "ai",
      provider: route.provider,
      model: upstream.model,
      latencyMs: Date.now() - startedAt,
      usage: upstream.usage,
      result,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    res.status(aborted ? 504 : 502).json({
      ok: false,
      error: aborted ? "timeout" : "upstream_unreachable",
      provider: route.provider,
      message: aborted
        ? "AI 응답이 제한 시간을 넘겼습니다. 메모를 줄이거나 잠시 후 다시 시도해 주세요."
        : "AI 제공자에 연결하지 못했습니다. 규칙 요약으로 초안을 만들 수 있습니다.",
    });
  } finally {
    clearTimeout(timer);
  }
}
