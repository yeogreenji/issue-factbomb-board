/**
 * 이슈온도계 — 기사 링크·한 줄 이슈를 즉석 카드뉴스로 (Vercel 서버리스 함수)
 *
 * POST /api/briefing
 *   body: { url?, text?, angle?, apiKey? }
 *     · url  : 언론사 기사 주소. 서버가 본문을 직접 읽어(SSRF 차단) 사실 근거로 씁니다.
 *     · text : 링크 없이 궁금한 이슈를 한 줄로 적어도 됩니다(20자 이상).
 *   → 카드뉴스 1장 묶음: 한 줄 훅 · 팩트 2줄 · 양쪽 입장 · A/B 투표 질문 · 논란 온도
 *
 * GET /api/briefing  → 서버 AI 상태(제공자·모델)만. 키 값은 내보내지 않습니다.
 *
 * AI 키가 없으면 기사 제목과 첫 문장만으로 카드를 만듭니다(ai:false). 없는 내용은 채우지 않습니다.
 */

import {
  ENV,
  aiStatus,
  callModel,
  clean,
  cleanList,
  clampInt,
  clientIp,
  fetchArticle,
  headerValue,
  parseBody,
  parseJsonObject,
  rateLimited,
  resolveRoute,
  setCors,
  shortId,
  stripBoilerplate,
  storeLabel,
  type VercelRequest,
  type VercelResponse,
} from "./_shared.js";

export const config = { maxDuration: 60 };

type Category = "work" | "mz" | "money" | "tech" | "culture";
const CATEGORIES: Category[] = ["work", "mz", "money", "tech", "culture"];

const MIN_TEXT_CHARS = 12;
const MAX_TEXT_CHARS = 6_000;

const SYSTEM_PROMPT = `당신은 20~30대가 실제로 반응하는 뉴스를 카드뉴스로 바꾸는 한국 뉴스레터 에디터입니다.
독자는 폰으로 30초 안에 훑습니다. 긴 줄글은 쓰지 않습니다.

절대 규칙:
- 주어진 기사·메모에 적힌 사실만 씁니다. 없는 수치·기관명·인물명·회사명·날짜를 만들어내지 마세요.
- 확인되지 않은 추측을 사실처럼 쓰지 마세요. 불확실하면 그 문장을 빼세요.
- 한 카드에 문장은 1~2개. 구어체 존댓말("~했어요", "~인데요")로 짧게.
- 투표는 이 내용을 읽은 사람이 바로 고를 수 있는 양자택일이어야 합니다. 정답이 없는 질문만 만드세요.

카드 구성:
- hook: 카드 표지의 한 줄. 40자 이내. 숫자나 대비로 눈에 걸리게.
- kicker: 훅 아래 한 줄 맥락. 45자 이내.
- facts: "무슨 일인데" 카드에 넣을 팩트 2개. 각 70자 이내.
- sides: "어디서 갈리나" 카드의 양쪽 입장. a는 이해하는 쪽, b는 비판하는 쪽. 각 60자 이내.
- poll.question: 30자 이내 질문. poll.a / poll.b: 각 24자 이내 선택지.
- temp: 지금 여론이 달아오른 정도 0~100 정수(사과·철회·논란·품절은 70 이상, 단순 발표는 30~50).
- category: work | mz | money | tech | culture 중 하나.
- tags: 검색 키워드 2~3개.

출력은 아래 스키마의 JSON 객체 하나뿐입니다. 코드블록·설명을 붙이지 마세요.
{"category":"tech","hook":"...","kicker":"...","facts":["...","..."],"sides":{"a":"...","b":"..."},"poll":{"question":"...","a":"...","b":"..."},"temp":64,"tags":["...","..."]}`;

interface IssueCard {
  id: string;
  category: Category;
  title: string;
  source: string;
  url: string;
  publishedAt: number;
  image: string;
  hook: string;
  kicker: string;
  facts: string[];
  sides: { a: string; b: string } | null;
  poll: { question: string; a: string; b: string };
  temp: number | null;
  tags: string[];
  ai: boolean;
}

function sentences(text: string, limit: number): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((line) => clean(line, 160))
    .filter((line) => line.length > 14)
    .slice(0, limit);
}

function fallbackCard(input: { title: string; source: string; url: string; body: string; image: string }): IssueCard {
  const facts = sentences(input.body, 3);
  return {
    id: shortId(input.url || input.title),
    category: "mz",
    title: input.title || clean(input.body, 80),
    source: input.source,
    url: input.url,
    publishedAt: Date.now(),
    image: input.image,
    hook: clean(input.title || facts[0] || input.body, 60),
    kicker: input.source ? `${input.source} · 원문에서 확인` : "원문에서 확인",
    facts: facts.length > 0 ? facts.slice(0, 2) : [clean(input.body, 100)],
    sides: null,
    poll: { question: "이 이슈, 내 일상에 영향 있나요?", a: "이미 체감 중", b: "아직 남 일" },
    temp: null,
    tags: [],
    ai: false,
  };
}

function normalizeCard(raw: unknown, base: { title: string; source: string; url: string; image: string; body: string }): IssueCard | null {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!row) return null;
  const hook = clean(row.hook, 80);
  const facts = cleanList(row.facts, 2, 100);
  if (hook.length < 6 || facts.length < 1) return null;

  const categoryRaw = clean(row.category, 12) as Category;
  const sidesRaw = row.sides && typeof row.sides === "object" ? (row.sides as Record<string, unknown>) : {};
  const sideA = clean(sidesRaw.a, 80);
  const sideB = clean(sidesRaw.b, 80);
  const pollRaw = row.poll && typeof row.poll === "object" ? (row.poll as Record<string, unknown>) : {};
  const pollA = clean(pollRaw.a, 40);
  const pollB = clean(pollRaw.b, 40);

  return {
    id: shortId(base.url || base.title),
    category: CATEGORIES.includes(categoryRaw) ? categoryRaw : "mz",
    title: base.title || hook,
    source: base.source,
    url: base.url,
    publishedAt: Date.now(),
    image: base.image,
    hook,
    kicker: clean(row.kicker, 60) || clean(base.title, 60),
    facts,
    sides: sideA && sideB ? { a: sideA, b: sideB } : null,
    poll:
      pollA && pollB
        ? { question: clean(pollRaw.question, 60) || "이 이슈, 어떻게 봐요?", a: pollA, b: pollB }
        : { question: "이 이슈, 어떻게 봐요?", a: "이해된다", b: "아니다" },
    temp: typeof row.temp === "undefined" ? null : clampInt(row.temp, 0, 100, 55),
    tags: cleanList(row.tags, 3, 14),
    ai: true,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method === "GET") {
    const status = aiStatus();
    res.status(200).json({
      ok: true,
      ai: status,
      aiKey: Boolean(status),
      store: storeLabel(),
      hasKey: Boolean(ENV.GEMINI_API_KEY?.trim() || ENV.OPENAI_API_KEY?.trim()),
    });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method_not_allowed", message: "POST만 지원합니다." });
    return;
  }

  if (rateLimited("briefing", clientIp(req), 10, 60_000)) {
    res.status(429).json({ ok: false, error: "rate_limited", message: "잠시 요청이 몰렸습니다. 1분 뒤 다시 시도해 주세요." });
    return;
  }

  const body = parseBody(req);
  if (!body) {
    res.status(400).json({ ok: false, error: "bad_request", message: "JSON 본문을 읽을 수 없습니다." });
    return;
  }

  const url = clean(body.url, 600);
  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT_CHARS + 1) : "";
  const angle = clean(body.angle, 160);

  if (!url && text.replace(/\s/g, "").length < MIN_TEXT_CHARS) {
    res.status(400).json({
      ok: false,
      error: "too_short",
      message: `기사 링크를 넣거나, 궁금한 이슈를 ${MIN_TEXT_CHARS}자 이상 적어 주세요.`,
    });
    return;
  }
  if (text.length > MAX_TEXT_CHARS) {
    res.status(413).json({ ok: false, error: "too_long", message: `한 번에 ${MAX_TEXT_CHARS}자까지 정리합니다.` });
    return;
  }

  let title = "";
  let source = "";
  let articleBody = text;
  let image = "";
  let originalUrl = "";
  let publishedAt = Date.now();

  if (url) {
    if (/^https?:\/\/(?:www\.)?news\.google\.com\//i.test(url)) {
      res.status(400).json({
        ok: false,
        error: "google_news_link",
        message: "구글 뉴스 링크는 본문을 바로 읽을 수 없어요. 언론사 기사 주소를 넣어 주세요.",
      });
      return;
    }
    const outcome = await fetchArticle(url);
    if (!outcome.ok) {
      res.status(outcome.status >= 400 && outcome.status < 500 ? 400 : 502).json({
        ok: false,
        error: "article_unreadable",
        message: `${outcome.reason} 기사 링크 대신 이슈를 한 줄로 적어 주시면 카드로 만들 수 있어요.`,
      });
      return;
    }
    title = stripBoilerplate(outcome.article.title);
    source = new URL(outcome.article.url).hostname.replace(/^www\./, "");
    articleBody = outcome.article.body || outcome.article.description || text;
    image = outcome.article.image;
    originalUrl = outcome.article.url;
    publishedAt = outcome.article.publishedAt;
  }

  const route = resolveRoute(headerValue(req, "x-api-key") || clean(body.apiKey, 200));
  const base = { title, source, url: originalUrl, image, body: articleBody };

  if (!route) {
    const card = fallbackCard(base);
    card.publishedAt = publishedAt;
    res.status(200).json({
      ok: true,
      engine: "headline",
      ai: null,
      issue: card,
      notice: "서버에 AI 키가 없어 제목과 첫 문장만으로 카드를 만들었습니다.",
    });
    return;
  }

  const prompt = [
    title ? `[기사 제목] ${title}` : "",
    source ? `[출처] ${source}` : "",
    angle ? `[에디터가 짚고 싶은 관점] ${angle}` : "",
    "[기사 본문 / 메모]",
    articleBody,
    "",
    "위 내용만 근거로 스키마에 맞는 JSON을 만드세요. 본문에 없는 수치·회사명·인물은 쓰지 마세요.",
  ]
    .filter(Boolean)
    .join("\n");

  const startedAt = Date.now();
  const outcome = await callModel(route, { system: SYSTEM_PROMPT, prompt, temperature: 0.55, maxTokens: 1_200 });

  if (!outcome.ok) {
    const card = fallbackCard(base);
    card.publishedAt = publishedAt;
    res.status(200).json({
      ok: true,
      engine: "headline",
      ai: null,
      issue: card,
      notice: `AI를 쓰지 못해 제목과 첫 문장만으로 만들었습니다. (${outcome.message})`,
    });
    return;
  }

  const card = normalizeCard(parseJsonObject(outcome.content), base);
  if (!card) {
    const fallback = fallbackCard(base);
    fallback.publishedAt = publishedAt;
    res.status(200).json({
      ok: true,
      engine: "headline",
      ai: null,
      issue: fallback,
      notice: "AI 응답 형식이 맞지 않아 제목과 첫 문장만으로 만들었습니다.",
    });
    return;
  }

  card.publishedAt = publishedAt;
  res.status(200).json({
    ok: true,
    engine: "ai",
    ai: { provider: outcome.provider, model: outcome.model },
    latencyMs: Date.now() - startedAt,
    usage: outcome.usage,
    issue: card,
  });
}
