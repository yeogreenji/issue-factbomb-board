/**
 * 이슈온도계 — 기사 링크·한 줄 이슈를 즉석 카드뉴스로 (Vercel 서버리스 함수)
 *
 * POST /api/briefing
 *   body: { url?, text?, angle?, apiKey? }
 *     · url  : 언론사 기사 주소. 서버가 본문을 직접 읽어(SSRF 차단) 사실 근거로 씁니다.
 *     · text : 링크 없이 궁금한 이슈를 한 줄로 적어도 됩니다(20자 이상).
 *   → 카드뉴스 1장 묶음: 한 줄 훅 · 팩트 3줄 · 배경·쟁점 · 양쪽 입장 · A/B 투표 질문 · 논란 온도
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
import { buildPoll, isBlandPoll } from "./debate.js";

export const config = { maxDuration: 60 };

type Category = "entertainment" | "society" | "culture" | "tech" | "money" | "work";
const CATEGORIES: Category[] = ["entertainment", "society", "culture", "tech", "money", "work"];

const MIN_TEXT_CHARS = 12;
const MAX_TEXT_CHARS = 6_000;

const SYSTEM_PROMPT = `당신은 20~30대가 실제로 반응하는 뉴스를 카드뉴스로 바꾸는 한국 뉴스레터 에디터입니다.
독자는 폰으로 30초 안에 훑습니다. 긴 줄글은 쓰지 않습니다.

절대 규칙:
- 주어진 기사·메모에 적힌 사실만 씁니다. 없는 수치·기관명·인물명·회사명·날짜를 만들어내지 마세요.
- 확인되지 않은 추측을 사실처럼 쓰지 마세요. 불확실하면 그 문장을 빼세요.
- 한 카드에 문장은 1~2개. 구어체 존댓말("~했어요", "~인데요")로 짧게.
- 투표는 이 내용을 읽은 사람이 바로 고를 수 있는 양자택일이어야 합니다. 정답이 없는 질문만 만드세요.
- 투표 문항은 기사 속 갈등(누가 손해인지, 무엇이 부당한지, 어디까지 받아들일지)을 정면으로 묻습니다.

카드 구성(인스타 5장):
- hook: 카드 표지의 한 줄. 38자 이내. 숫자나 대비로 눈에 걸리게.
- kicker: 훅 아래 한 줄 맥락. 42자 이내.
- facts: "무슨 일인데" 카드의 팩트 **정확히 3개**. 각 65자 이내. 서로 다른 내용.
- background: 배경 2문장, 110자 이내. 왜 갑자기 화제인지.
- point: 핵심 쟁점 한 줄, 55자 이내.
- sides: 갈리는 두 진영. labelA/labelB 10자 이내, a/b 각 55자 이내.
- poll: 이 기사에서만 통하는 A/B 양자택일. 20~30대 댓글창에서 편 갈릴 만큼 팽팽하게.
  · question 32자 이내(기사 속 주제어를 넣은 도발적인 한 줄), a/b 각 22자 이내(한쪽으로 기운 단정형).
  · 금지: "찬성/반대", "이해된다/아니다", "어떻게 보시나요", "영향 있나요", "이미 체감 중", "아직 남 일".
  · 예: "소비자 기만, 즉시 불매" / "원가 상승 불가피, 기업 옹호".
- temp: 지금 여론이 달아오른 정도 0~100 정수(사과·철회·논란·품절은 70 이상, 단순 발표는 30~50).
- category: entertainment | society | culture | tech | money | work 중 하나.
- tags: 검색 키워드 3개(# 없이).
- caption: 인스타 피드에 그대로 붙일 캡션용 문장. 카드 팩트를 되풀이하지 말고 '왜 지금 싸우는지'만 다시 쓰세요.
  · caption.lead 구어체 두 문장(각 45자 이내, "~인데요/~거든요/~했어요") — 보도체("~혐의를 받는다", "~송치했다") 금지
  · caption.sideA / caption.sideB A·B 진영 주장 한 줄씩(각 40자 이내, sides를 그대로 옮기지 말 것)
  · caption.ask A와 B 중 어느 쪽이 더 문제인지 정면으로 묻는 한 줄(40자 이내, "어떻게 생각하세요?" 금지)

출력은 아래 스키마의 JSON 객체 하나뿐입니다. 코드블록·설명을 붙이지 마세요.
{"category":"tech","hook":"...","kicker":"...","facts":["...","...","..."],"background":"...","point":"...","sides":{"labelA":"...","labelB":"...","a":"...","b":"..."},"poll":{"question":"...","a":"...","b":"..."},"temp":64,"tags":["...","...","..."],"caption":{"lead":"...","sideA":"...","sideB":"...","ask":"..."}}}`;

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
  background: string;
  point: string;
  sides: { labelA: string; labelB: string; a: string; b: string } | null;
  poll: { question: string; a: string; b: string };
  temp: number | null;
  tags: string[];
  caption?: { hook?: string; lead: string; sideA: string; sideB: string; ask: string } | null;
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
  const sentencesPool = sentences(input.body, 6);
  const facts = sentencesPool.slice(0, 3);
  const title = input.title || clean(input.body, 80);
  return {
    id: shortId(input.url || input.title),
    category: "society",
    title,
    source: input.source,
    url: input.url,
    publishedAt: Date.now(),
    image: input.image,
    hook: clean(input.title || facts[0] || input.body, 60),
    kicker: input.source ? `${input.source} · 원문에서 확인` : "원문에서 확인",
    facts: facts.length > 0 ? facts : [clean(input.body, 100)],
    background: sentencesPool.slice(3, 5).join(" "),
    point: "",
    sides: null,
    poll: buildPoll({ title, summary: input.body.slice(0, 300), body: input.body, category: "society" }),
    temp: null,
    tags: [],
    caption: null,
    ai: false,
  };
}

/** AI가 캡션용 문장을 줬으면 다듬어 보관합니다. 없으면 null — 클라이언트가 카드 문구로 채웁니다. */
function readCaption(raw: unknown): { hook?: string; lead: string; sideA: string; sideB: string; ask: string } | null {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!row) return null;
  const text = (value: unknown, max: number) => clean(value, max);
  const hook = text(row.hook, 90);
  const lead = text(row.lead, 200);
  const sideA = text(row.sideA, 90);
  const sideB = text(row.sideB, 90);
  const ask = text(row.ask, 90);
  return hook || lead || sideA || sideB || ask ? { hook, lead, sideA, sideB, ask } : null;
}

function normalizeCard(raw: unknown, base: { title: string; source: string; url: string; image: string; body: string }): IssueCard | null {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!row) return null;
  const hook = clean(row.hook, 80);
  const facts = cleanList(row.facts, 3, 100);
  if (hook.length < 6 || facts.length < 1) return null;

  const categoryRaw = clean(row.category, 12) as Category;
  const sidesRaw = row.sides && typeof row.sides === "object" ? (row.sides as Record<string, unknown>) : {};
  const sideA = clean(sidesRaw.a, 90);
  const sideB = clean(sidesRaw.b, 90);
  const labelA = clean(sidesRaw.labelA, 14) || "이해하는 쪽";
  const labelB = clean(sidesRaw.labelB, 14) || "비판하는 쪽";
  const pollRaw = row.poll && typeof row.poll === "object" ? (row.poll as Record<string, unknown>) : {};
  const pollA = clean(pollRaw.a, 40);
  const pollB = clean(pollRaw.b, 40);

  return {
    id: shortId(base.url || base.title),
    category: CATEGORIES.includes(categoryRaw) ? categoryRaw : "society",
    title: base.title || hook,
    source: base.source,
    url: base.url,
    publishedAt: Date.now(),
    image: base.image,
    hook,
    kicker: clean(row.kicker, 60) || clean(base.title, 60),
    facts,
    background: clean(row.background, 200),
    point: clean(row.point, 80),
    sides: sideA && sideB ? { labelA, labelB, a: sideA, b: sideB } : null,
    poll:
      pollA && pollB && !isBlandPoll({ question: clean(pollRaw.question, 60), a: pollA, b: pollB }, base.title)
        ? { question: clean(pollRaw.question, 60) || buildPoll({ title: base.title, body: base.body }).question, a: pollA, b: pollB }
        : buildPoll({ title: base.title || hook, summary: base.body.slice(0, 300), body: base.body }),
    temp: typeof row.temp === "undefined" ? null : clampInt(row.temp, 0, 100, 55),
    tags: cleanList(row.tags, 3, 14),
    caption: readCaption(row.caption),
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
