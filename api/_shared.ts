/**
 * 이슈온도계 공통 모듈 — 서버리스 함수들이 함께 쓰는 도구 모음.
 *
 * - AI 호출: Gemini(GEMINI_API_KEY, 무료 키 AQ.…/AIza…) → OpenAI(OPENAI_API_KEY) 순.
 *   모델은 GEMINI_MODEL 로 바꿀 수 있고, 쓸 수 없는 모델이면 다음 후보로 자동으로 내려갑니다.
 * - 저장소: Upstash Redis → Supabase → 함수 메모리 순으로 자동 선택(키가 없어도 죽지 않음).
 * - 기사 읽기: http(s)만, 사설망·메타데이터 호스트 차단(SSRF), 12초·300KB 상한.
 *
 * 키 값은 어떤 응답에도 실어 보내지 않습니다.
 */

/* ------------------------------------------------------------------ env */

export const ENV: Record<string, string | undefined> =
  (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

const OPENAI_MODEL = ENV.OPENAI_MODEL?.trim() || "gpt-4o-mini";
const OPENAI_BASE = (ENV.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const OPENAI_URL = `${OPENAI_BASE}/chat/completions`;

const GEMINI_BASE = (ENV.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta").replace(/\/+$/, "");
/** 무료 키에서 우선 시도할 모델. 앞의 모델이 이 계정에서 막히면 다음 후보로 내려갑니다. */
const GEMINI_PREFERRED = ENV.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
const GEMINI_FALLBACKS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-2.5-flash"];

const OPENAI_KEY_PREFIX = "sk-";

export const MAX_ARTICLE_BYTES = 320_000;
export const MAX_ARTICLE_CHARS = 6_000;

/* -------------------------------------------------------------- types */

export interface VercelRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface VercelResponse {
  status(code: number): VercelResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
}

export type Provider = "gemini" | "openai";

/* ------------------------------------------------------------ strings */

export const clean = (value: unknown, max = 2_000): string =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";

export const cleanMultiline = (value: unknown, max = 2_000): string =>
  typeof value === "string"
    ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max)
    : "";

export const cleanList = (value: unknown, maxItems: number, maxChars: number): string[] =>
  Array.isArray(value) ? value.map((item) => clean(item, maxChars)).filter(Boolean).slice(0, maxItems) : [];

export const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

/** URL·제목으로 만드는 짧은 고정 id — 같은 기사는 언제나 같은 id를 갖습니다. */
export function shortId(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < seed.length; i += 1) {
    const code = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 16777619);
    h2 = Math.imul(h2 + code, 2654435761);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36).slice(0, 4);
}

/* --------------------------------------------------------------- http */

export function setCors(res: VercelResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Cache-Control", "no-store");
}

export function headerValue(req: VercelRequest, name: string): string {
  const raw = req.headers[name] ?? req.headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0]?.trim() ?? "";
  return typeof raw === "string" ? raw.trim() : "";
}

export function queryValue(req: VercelRequest, name: string): string {
  const direct = req.query?.[name];
  if (typeof direct === "string") return direct;
  if (Array.isArray(direct)) return direct[0] ?? "";
  const url = headerValue(req, "x-forwarded-uri") || req.url || "";
  const index = url.indexOf("?");
  if (index < 0) return "";
  return new URLSearchParams(url.slice(index + 1)).get(name) ?? "";
}

export function parseBody(req: VercelRequest): Record<string, unknown> | null {
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

export function clientIp(req: VercelRequest): string {
  return headerValue(req, "x-forwarded-for").split(",")[0]?.trim() || headerValue(req, "x-real-ip") || "unknown";
}

/* --------------------------------------------------------- rate limit */

const buckets = new Map<string, number[]>();

/** 함수 인스턴스 단위의 가벼운 요청 제한 — 공개 배포에서 키 비용이 무한정 새지 않도록. */
export function rateLimited(scope: string, ip: string, max: number, windowMs: number): boolean {
  const key = `${scope}:${ip}`;
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((time) => now - time < windowMs);
  if (hits.length >= max) {
    buckets.set(key, hits);
    return true;
  }
  hits.push(now);
  buckets.set(key, hits);
  if (buckets.size > 800) {
    for (const [name, times] of buckets) {
      if (times.every((time) => now - time >= windowMs)) buckets.delete(name);
    }
  }
  return false;
}

/* ------------------------------------------------------------ article */

const BLOCKED_HOST =
  /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0|\[::1\]|metadata\.|.*\.local$)/i;
const BLOCKED_SUFFIX = [".internal", ".local", ".localhost"];

/** 검증 하네스가 127.0.0.1 기사 서버를 읽을 때만 켭니다. 배포 환경에서는 항상 차단합니다. */
export const ALLOW_LOCAL_FETCH = ENV.ISSUE_ALLOW_LOCAL_FETCH === "1";

export function safeUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (!host.includes(".") && !ALLOW_LOCAL_FETCH) return null;
    if (!ALLOW_LOCAL_FETCH) {
      if (BLOCKED_HOST.test(host)) return null;
      if (BLOCKED_SUFFIX.some((suffix) => host.endsWith(suffix))) return null;
      if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
    }
    return url;
  } catch {
    return null;
  }
}

export const decodeEntities = (value: string): string =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(Number.parseInt(n, 16) || 32))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n) || 32));

function metaContent(html: string, patterns: RegExp[]): string {
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const value = decodeEntities(m[1]).replace(/\s+/g, " ").trim();
      if (value.length > 1) return value.slice(0, 300);
    }
  }
  return "";
}

/** 기사 페이지에 늘 붙는 안내·저작권 문구 — 사실 근거로 쓰면 안 되므로 걷어냅니다. */
const BOILERPLATE = [
  /Google\s*검색에서[^.]{0,40}기사를\s*더\s*자주\s*볼\s*수\s*있습니다\.?/g,
  /무단\s*전재[^.\n]{0,30}(금지|삼가)[^.]{0,10}\.?/g,
  /재배포\s*금지[^.]{0,10}\.?/g,
  /\[[^\]]{0,24}\s*제공[^\]]{0,24}\]/g,
  /ⓒ[^.\n]{0,40}/g,
  /저작권자[^.\n]{0,40}/g,
  /구독[^.]{0,10}알림[^.]{0,10}\.?/g,
  /많이\s*본\s*뉴스[^.]{0,20}/g,
];

export function stripBoilerplate(text: string): string {
  let out = text;
  for (const pattern of BOILERPLATE) out = out.replace(pattern, " ");
  return out.replace(/\s{2,}/g, " ").trim();
}

/* ------------------------------------------------------- news cleaning */

/**
 * 기사에 늘 따라붙는 사진·영상 캡션, 기자 머리말, 특수문자 — 카드에 넣으면 읽기가 나빠집니다.
 * 사실은그대로 두고 장식만 걷어냅니다.
 */
const PRESS_MARKS: RegExp[] = [
  /\[(?:사진|영상|그래픽|포토|단독|속보|종합|1보|2보|3보)\]/g,
  /\((?:사진|자료\s*사진|연합뉴스|뉴시스|사진\s*=)[^)]{0,60}\)/g,
  /\([^)]{1,25}\)\s*[가-힣]{2,4}\s*(?:기자|특파원)\s*=/g,
  /[가-힣]{2,4}\s*(?:기자|특파원)\s*=\s*/g,
  /사진\s*=\s*[^\s,]{1,30}/g,
  /▶[^\n]{0,60}/g,
  /(?:무단\s*전재|재배포)\s*(?:및\s*재배포)?\s*금지[^.\n]{0,20}\.?/g,
  /ⓒ[^\n]{0,80}/g,
  /Copyrights?[^\n]{0,80}/gi,
  /구독\s*알림\s*설정[^.\n]{0,20}\.?/g,
  /네이버\s*(?:채널|포스트|블로그)[^.]{0,30}\.?/g,
  /카카오톡\s*(?:채널|구독)[^.]{0,30}\.?/g,
];

/** 홈페이지·RSS에서 섞여 들어오는 깨진 문자·제로폭·중복 공백을 걷어냅니다. */
export function cleanNewsText(value: unknown, max = 600): string {
  if (typeof value !== "string") return "";
  let text = value
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, (entity) => decodeEntities(entity))
    .replace(/\uFFFD+/g, "")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  for (const mark of PRESS_MARKS) text = text.replace(mark, " ");
  return text
    .replace(/([.!?])(?=[가-힣])/g, "$1 ")
    .replace(/([가-힣][.!?])(?=[0-9])/g, "$1 ")
    .replace(/[\u00a0\u3000]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s·•\-–—|,]+/, "")
    .trim()
    .slice(0, max);
}

/** 문장 단위로 자릅니다. 너무 짧은 조각(제목·캡션 잔여)과 따옴표로 시작하는 토막은 버립니다. */
export function splitSentences(value: string, max = 6): string[] {
  return cleanNewsText(value, 4_000)
    .split(/(?<=[.!?。])\s+|(?<=다\.)\s+|\n+/)
    .map((line) => cleanNewsText(line, 400))
    .filter((line) => line.length >= 20 && !/^["'”’]/.test(line))
    .slice(0, max);
}

/** 숫자·고유명사가 들어간 문장을 팩트로 우선합니다(추상적인 문장보다 읽을거리가 됩니다). */
export function factScore(sentence: string): number {
  let score = Math.min(sentence.length, 90) / 10;
  if (/\d/.test(sentence)) score += 4;
  if (/%|배|명|원|만|억|년|개월|시간/.test(sentence)) score += 2;
  if (/(밝혔|발표|결정|확인|집계|조사|전망|예정|기록|돌파)/.test(sentence)) score += 1.5;
  return score;
}

/** 문장을 팩트 카드용으로 다듬습니다 — 단어 중간에서 자르지 않고, 끝맺음이 없으면 마침표를 붙입니다. */
export function asSentence(value: string, max = 90): string {
  let text = cleanNewsText(value, max * 3);
  if (!text) return "";
  let clipped = false;
  if (text.length > max) {
    const cut = text.slice(0, max - 1);
    const space = cut.lastIndexOf(" ");
    text = (space > max * 0.55 ? cut.slice(0, space) : cut).replace(/[,.·\-–—]?$/, "").trim();
    clipped = true;
  }
  if (clipped) return `${text}…`;
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

export function htmlToText(html: string): string {
  const withoutNoise = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const article = withoutNoise.match(/<article[\s\S]*?<\/article>/i)?.[0];
  const main = withoutNoise.match(/<main[\s\S]*?<\/main>/i)?.[0];
  const scope = article || main || withoutNoise;
  const paragraphs = [...scope.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 20);
  const cleaned = paragraphs.map((line) => stripBoilerplate(line)).filter((line) => line.length > 20);
  const text =
    cleaned.length >= 3
      ? cleaned.join("\n")
      : stripBoilerplate(decodeEntities(scope.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim());
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, maxBytes);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  try {
    await reader.cancel();
  } catch {
    /* 이미 끝났으면 무시 */
  }
  const merged = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= merged.length) break;
    merged.set(chunk.slice(0, merged.length - offset), offset);
    offset += Math.min(chunk.byteLength, merged.length - offset);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}

export interface FetchedArticle {
  url: string;
  title: string;
  description: string;
  body: string;
  image: string;
  publishedAt: number;
}

export type FetchOutcome =
  | { ok: true; article: FetchedArticle }
  | { ok: false; reason: string; status: number };

export async function fetchArticle(rawUrl: string, timeoutMs = 12_000): Promise<FetchOutcome> {
  const parsed = safeUrl(rawUrl);
  if (!parsed) {
    return { ok: false, status: 400, reason: "주소를 읽을 수 없거나 접근할 수 없는 호스트입니다." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(parsed.toString(), {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 IssueThermometer/1.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
      },
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      status: aborted ? 504 : 502,
      reason: aborted ? "기사 응답이 제한 시간을 넘겼습니다." : "기사 서버에 연결하지 못했습니다.",
    };
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) return { ok: false, status: 502, reason: `기사 서버가 ${res.status} 응답을 보냈습니다.` };
  const type = (res.headers.get("content-type") || "").toLowerCase();
  if (!/text\/html|application\/xhtml|text\/plain/.test(type)) {
    return { ok: false, status: 415, reason: `기사 본문이 아닌 형식(${type || "알 수 없음"})입니다.` };
  }

  const raw = await readCapped(res, MAX_ARTICLE_BYTES);
  const title = metaContent(raw, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
  ]);
  const description = metaContent(raw, [
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i,
  ]);
  const image = metaContent(raw, [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
  ]);

  let body = htmlToText(raw);
  if (title && body.startsWith(title)) body = body.slice(title.length).trim();
  if (body.length < 120 && description.length < 40) {
    return { ok: false, status: 422, reason: "본문을 충분히 읽지 못했습니다(로그인·페이월·스크립트 렌더링 페이지일 수 있음)." };
  }

  return {
    ok: true,
    article: {
      url: parsed.toString(),
      title: title.slice(0, 200),
      description,
      body: (body || description).slice(0, MAX_ARTICLE_CHARS),
      image: /^https?:\/\//.test(image) ? image : "",
      publishedAt: Date.now(),
    },
  };
}

/* ----------------------------------------------------------------- AI */

export interface ChatRoute {
  provider: Provider;
  key: string;
}

/** `sk-`로 시작하지 않는 요청 키는 Gemini 키로 봅니다(AIza…·AQ.… 모두). */
function isGeminiRequestKey(key: string): boolean {
  return key.length > 0 && !key.startsWith(OPENAI_KEY_PREFIX);
}

export function resolveRoute(requestKey: string): ChatRoute | null {
  const geminiEnv = ENV.GEMINI_API_KEY?.trim() ?? "";
  const openaiEnv = ENV.OPENAI_API_KEY?.trim() ?? "";
  if (geminiEnv) return { provider: "gemini", key: geminiEnv };
  if (isGeminiRequestKey(requestKey)) return { provider: "gemini", key: requestKey };
  if (openaiEnv) return { provider: "openai", key: openaiEnv };
  if (requestKey) return { provider: "openai", key: requestKey };
  return null;
}

/** 서버에 어떤 키가 붙어 있는지(값은 절대 내보내지 않음). */
export function aiStatus(): { provider: Provider; model: string } | null {
  if (ENV.GEMINI_API_KEY?.trim()) return { provider: "gemini", model: currentGeminiModel() };
  if (ENV.OPENAI_API_KEY?.trim()) return { provider: "openai", model: OPENAI_MODEL };
  return null;
}

function errorDetail(rawText: string): string {
  let detail = rawText.slice(0, 240);
  try {
    const parsed = JSON.parse(rawText) as { error?: { message?: string } };
    if (parsed?.error?.message) detail = parsed.error.message.slice(0, 240);
  } catch {
    /* 원문 유지 */
  }
  return detail;
}

function upstreamHint(provider: Provider, status: number): string {
  const label = provider === "gemini" ? "Gemini" : "OpenAI";
  if (status === 401 || status === 403) return `${label} API 키가 유효하지 않거나 권한이 없습니다.`;
  if (status === 429) return `${label} 요청 한도에 걸렸습니다.`;
  if (status === 400 || status === 402) return `${label} 결제·키 설정을 확인해 주세요.`;
  if (status === 404) return `${label} 모델명을 확인해 주세요.`;
  return `${label} 응답 오류입니다.`;
}

let geminiModelInUse = "";

function currentGeminiModel(): string {
  return geminiModelInUse || GEMINI_PREFERRED;
}

function geminiCandidates(): string[] {
  const all = [geminiModelInUse || GEMINI_PREFERRED, GEMINI_PREFERRED, ...GEMINI_FALLBACKS];
  return all.filter((model, index) => Boolean(model) && all.indexOf(model) === index);
}

function modelUnavailable(status: number, detail: string): boolean {
  if (status !== 404 && status !== 400) return false;
  return /not found|not supported|no longer available|does not exist|unsupported|NOT_FOUND|INVALID_ARGUMENT.*model/i.test(
    detail,
  );
}

export type ModelOutcome =
  | { ok: true; content: string; provider: Provider; model: string; usage: unknown }
  | { ok: false; status: number; error: "no_key" | "upstream_error" | "empty_completion" | "timeout"; message: string };

export interface ModelInput {
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

async function callGemini(route: ChatRoute, input: ModelInput, signal: AbortSignal): Promise<ModelOutcome> {
  let last: ModelOutcome | null = null;

  for (const model of geminiCandidates()) {
    const url = `${GEMINI_BASE}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(route.key)}`;
    let upstream: Response;
    try {
      upstream = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": route.key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ role: "user", parts: [{ text: input.prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: input.temperature ?? 0.5,
            maxOutputTokens: input.maxTokens ?? 2_400,
          },
        }),
        signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return {
        ok: false,
        status: aborted ? 504 : 502,
        error: aborted ? "timeout" : "upstream_error",
        message: aborted ? "AI 응답이 제한 시간을 넘겼습니다." : "AI 제공자에 연결하지 못했습니다.",
      };
    }

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
          ? `AI가 내용을 만들지 못했습니다(${blocked}). 다시 시도해 주세요.`
          : "AI가 빈 응답을 보냈습니다.",
      };
    }

    geminiModelInUse = model;
    return { ok: true, content, provider: "gemini", model, usage: data.usageMetadata ?? null };
  }

  return last ?? { ok: false, status: 502, error: "upstream_error", message: "Gemini 호출에 실패했습니다." };
}

async function callOpenAI(route: ChatRoute, input: ModelInput, signal: AbortSignal): Promise<ModelOutcome> {
  let upstream: Response;
  try {
    upstream = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${route.key}` },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: input.temperature ?? 0.5,
        max_tokens: input.maxTokens ?? 2_400,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.prompt },
        ],
      }),
      signal,
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      status: aborted ? 504 : 502,
      error: aborted ? "timeout" : "upstream_error",
      message: aborted ? "AI 응답이 제한 시간을 넘겼습니다." : "AI 제공자에 연결하지 못했습니다.",
    };
  }

  if (!upstream.ok) {
    const detail = errorDetail(await upstream.text().catch(() => ""));
    return {
      ok: false,
      status: upstream.status,
      error: "upstream_error",
      message: `${upstreamHint("openai", upstream.status)} ${detail}`.trim(),
    };
  }

  const data = (await upstream.json()) as { choices?: { message?: { content?: string } }[]; usage?: unknown };
  const content = (data.choices?.[0]?.message?.content ?? "").trim();
  if (!content) return { ok: false, status: 502, error: "empty_completion", message: "AI가 빈 응답을 보냈습니다." };
  return { ok: true, content, provider: "openai", model: OPENAI_MODEL, usage: data.usage ?? null };
}

export async function callModel(route: ChatRoute, input: ModelInput): Promise<ModelOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 45_000);
  try {
    return route.provider === "gemini"
      ? await callGemini(route, input, controller.signal)
      : await callOpenAI(route, input, controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

export function parseJsonObject(content: string): unknown {
  const text = content
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/g, "")
    .trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/* --------------------------------------------------------------- store */

type StoreKind = "redis" | "supabase" | "memory";

const memoryKv = (globalThis as unknown as { __issueThermoKv?: Map<string, unknown> }).__issueThermoKv ??
  new Map<string, unknown>();
(globalThis as unknown as { __issueThermoKv?: Map<string, unknown> }).__issueThermoKv = memoryKv;

const STORE_TIMEOUT_MS = 4_000;

function storeKind(): StoreKind {
  if (ENV.UPSTASH_REDIS_REST_URL?.trim() && ENV.UPSTASH_REDIS_REST_TOKEN?.trim()) return "redis";
  if (ENV.SUPABASE_URL?.trim() && (ENV.SUPABASE_SERVICE_ROLE_KEY || ENV.SUPABASE_ANON_KEY)) return "supabase";
  return "memory";
}

/** 지금 실제로 쓰는 저장소 이름 — 앱이 상태를 정직하게 표시할 때 씁니다. */
export function storeLabel(): { kind: StoreKind; shared: boolean } {
  const kind = storeKind();
  return { kind, shared: kind !== "memory" };
}

function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STORE_TIMEOUT_MS);
  return run(controller.signal).finally(() => clearTimeout(timer));
}

async function redisSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const base = (ENV.UPSTASH_REDIS_REST_URL ?? "").replace(/\/+$/, "");
  const token = ENV.UPSTASH_REDIS_REST_TOKEN ?? "";
  await withTimeout(async (signal) => {
    const response = await fetch(base, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(["SET", key, JSON.stringify(value), "EX", String(ttlSeconds)]),
      signal,
    });
    if (!response.ok) throw new Error(`redis set ${response.status}`);
    const payload = (await response.json()) as { error?: string };
    if (payload.error) throw new Error(payload.error);
  });
}

async function redisGet(key: string): Promise<unknown> {
  const base = (ENV.UPSTASH_REDIS_REST_URL ?? "").replace(/\/+$/, "");
  const token = ENV.UPSTASH_REDIS_REST_TOKEN ?? "";
  const payload = await withTimeout(async (signal) => {
    const response = await fetch(base, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(["GET", key]),
      signal,
    });
    if (!response.ok) throw new Error(`redis get ${response.status}`);
    return (await response.json()) as { result?: string | null; error?: string };
  });
  if (payload.error || !payload.result) return null;
  try {
    return JSON.parse(payload.result);
  } catch {
    return null;
  }
}

async function supabaseSet(key: string, value: unknown): Promise<void> {
  const base = (ENV.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const token = (ENV.SUPABASE_SERVICE_ROLE_KEY || ENV.SUPABASE_ANON_KEY || "").trim();
  await withTimeout(async (signal) => {
    const response = await fetch(`${base}/rest/v1/issue_thermo_kv`, {
      method: "POST",
      headers: {
        apikey: token,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({ key, data: value, updated_at: new Date().toISOString() }),
      signal,
    });
    if (!response.ok) throw new Error(`supabase set ${response.status}`);
  });
}

async function supabaseGet(key: string): Promise<unknown> {
  const base = (ENV.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const token = (ENV.SUPABASE_SERVICE_ROLE_KEY || ENV.SUPABASE_ANON_KEY || "").trim();
  const rows = await withTimeout(async (signal) => {
    const response = await fetch(`${base}/rest/v1/issue_thermo_kv?key=eq.${encodeURIComponent(key)}&select=data`, {
      headers: { apikey: token, Authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) throw new Error(`supabase get ${response.status}`);
    return (await response.json()) as { data?: unknown }[];
  });
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows[0]?.data ?? null;
}

/** 저장소가 죽어 있어도 요청을 실패시키지 않습니다(메모리로 내려감). */
export async function kvGet<T>(key: string): Promise<T | null> {
  const kind = storeKind();
  try {
    if (kind === "redis") return (await redisGet(key)) as T | null;
    if (kind === "supabase") return (await supabaseGet(key)) as T | null;
  } catch {
    /* 메모리로 폴백 */
  }
  return (memoryKv.get(key) as T | undefined) ?? null;
}

export async function kvSet(key: string, value: unknown, ttlSeconds = 3_600): Promise<void> {
  memoryKv.set(key, value);
  const kind = storeKind();
  try {
    if (kind === "redis") await redisSet(key, value, ttlSeconds);
    else if (kind === "supabase") await supabaseSet(key, value);
  } catch {
    /* 메모리에만 남겨도 동작은 계속됩니다 */
  }
}

/** 짧은 시간 여러 요청이 겹쳐도 실제 작업은 한 번만 — 같은 인스턴스 안에서만 보장되는 가벼운 잠금. */
const inflight = new Map<string, Promise<unknown>>();

export function once<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const task = run().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, task);
  return task;
}
