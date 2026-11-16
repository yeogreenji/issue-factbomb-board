/**
 * 이슈온도계 — 오늘의 실제 뉴스 실시간 수집 (Vercel 서버리스 함수)
 *
 * GET /api/trending            오늘의 카드뉴스 묶음(캐시 12분)
 * GET /api/trending?refresh=1  캐시를 무시하고 새로 긁어옵니다
 * GET /api/trending?issue=ID   공유 링크로 받은 카드 하나만 다시 꺼냅니다
 *
 * 흐름: 한국 언론사 RSS 7곳 → 오늘 기사 후보 → 본문 확인 → AI가 카드뉴스 4~5장으로 정리
 *       (한 줄 훅 · 팩트 2줄 · 양쪽 입장 · A/B 투표 질문 · 논란 온도)
 *
 * AI 키가 없거나 실패하면 **실제 헤드라인 그대로**의 카드(제목·출처·시각·원문 링크)를 내려보냅니다.
 * 지어낸 뉴스는 어떤 경로에서도 만들지 않습니다.
 */

import {
  ENV,
  aiStatus,
  callModel,
  clean,
  cleanList,
  clampInt,
  decodeEntities,
  fetchArticle,
  kvGet,
  kvSet,
  once,
  parseJsonObject,
  queryValue,
  rateLimited,
  resolveRoute,
  setCors,
  shortId,
  stripBoilerplate,
  storeLabel,
  clientIp,
  type VercelRequest,
  type VercelResponse,
} from "./_shared.js";

export const config = { maxDuration: 60 };

const CACHE_KEY = "issue-thermo:trending:v1";
/** 공유 링크로 받은 사람이 며칠 뒤에 열어도 카드가 남아 있도록, 카드 하나씩 따로 보관합니다. */
const ISSUE_KEY_PREFIX = "issue-thermo:issue:v1:";
const ISSUE_TTL_SECONDS = 60 * 60 * 24 * 7;
const CACHE_TTL_SECONDS = 60 * 15;
const CACHE_FRESH_MS = 12 * 60 * 1000;
const FEED_TIMEOUT_MS = 9_000;
const MAX_ITEMS_PER_FEED = 60;

export type Category = "work" | "mz" | "money" | "tech" | "culture";
const CATEGORIES: Category[] = ["work", "mz", "money", "tech", "culture"];

export interface IssuePoll {
  question: string;
  a: string;
  b: string;
}

export interface Issue {
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
  poll: IssuePoll;
  temp: number | null;
  tags: string[];
  ai: boolean;
}

interface TrendingDoc {
  generatedAt: number;
  ai: { provider: string; model: string } | null;
  issues: Issue[];
  feeds: { name: string; ok: boolean }[];
  notice?: string;
}

/* ---------------------------------------------------------------- feeds */

interface Feed {
  name: string;
  slug: string;
  source: string;
  url: string;
  hint: Category;
}

/**
 * 실제 한국 언론사 RSS. 제목·요약·발행시각·원문 링크·대표 이미지를 함께 주는 피드만 씁니다.
 * (Google 뉴스 RSS는 요약이 링크뿐이라 사실 확인 근거로 쓸 수 없어 넣지 않았습니다.)
 */
const FEEDS: Feed[] = [
  { name: "연합뉴스 종합", slug: "yna-news", source: "연합뉴스", url: "https://www.yna.co.kr/rss/news.xml", hint: "mz" },
  { name: "연합뉴스 경제", slug: "yna-economy", source: "연합뉴스", url: "https://www.yna.co.kr/rss/economy.xml", hint: "money" },
  { name: "연합뉴스 산업", slug: "yna-industry", source: "연합뉴스", url: "https://www.yna.co.kr/rss/industry.xml", hint: "tech" },
  { name: "연합뉴스 문화", slug: "yna-culture", source: "연합뉴스", url: "https://www.yna.co.kr/rss/culture.xml", hint: "culture" },
  { name: "연합뉴스 정치", slug: "yna-politics", source: "연합뉴스", url: "https://www.yna.co.kr/rss/politics.xml", hint: "work" },
  { name: "블로터", slug: "bloter", source: "블로터", url: "https://www.bloter.net/rss/allArticle.xml", hint: "tech" },
  { name: "매일경제", slug: "mk", source: "매일경제", url: "https://www.mk.co.kr/rss/30000001/", hint: "money" },
];

/** 검증 하네스가 가짜 RSS를 띄울 때만 씁니다. 배포 환경에서는 비어 있어 실제 언론사 주소로 갑니다. */
const FEED_BASE = (ENV.ISSUE_FEED_BASE ?? "").trim();

function feedUrl(feed: Feed): string {
  return FEED_BASE ? `${FEED_BASE.replace(/\/+$/, "")}/${feed.slug}.xml` : feed.url;
}

interface Article {
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: number;
  image: string;
  hint: Category;
  body?: string;
  score: number;
}

/** RSS를 하나 읽어 기사 목록으로 바꿉니다. 실패하면 빈 배열(다른 피드는 계속 씁니다). */
async function readFeed(feed: Feed): Promise<Article[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const response = await fetch(feedUrl(feed), {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 IssueThermometer/1.0",
        Accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ko-KR,ko;q=0.9",
      },
    });
    if (!response.ok) return [];
    const xml = await response.text();
    return parseFeed(xml.slice(0, 900_000), feed);
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function tagText(block: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  if (!m) return "";
  return decodeEntities(
    m[1]
      .replace(/^<!\[CDATA\[/, "")
      .replace(/\]\]>$/, "")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function tagAttr(block: string, tag: string, attr: string): string {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, "i");
  return block.match(re)?.[1] ?? "";
}

/** RSS 2.0 / dc / media 네임스페이스가 섞여 있어도 필요한 값만 뽑습니다. */
export function parseFeed(xml: string, feed: Feed): Article[] {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, MAX_ITEMS_PER_FEED);
  const out: Article[] = [];
  for (const match of items) {
    const block = match[1];
    const title = clean(tagText(block, "title"), 160);
    const url = clean(tagText(block, "link"), 400) || clean(tagText(block, "guid"), 400);
    if (title.length < 8 || !/^https?:\/\//i.test(url)) continue;

    const rawSummary = tagText(block, "description");
    // 연합뉴스는 "(서울=연합뉴스) 홍길동 기자 =" 같은 머리말을 붙입니다.
    const summary = clean(
      stripBoilerplate(rawSummary)
        .replace(/^\([^)]{1,20}\)\s*/, "")
        .replace(/^\[[^\]]{1,20}\]\s*/, "")
        .replace(/^[가-힣]{2,4}\s*기자\s*=\s*/, "")
        .replace(/\s*\.\.\.$/, ""),
      400,
    );
    const image = clean(tagAttr(block, "media:content", "url") || tagAttr(block, "enclosure", "url"), 400);
    const publishedAt = parseDate(tagText(block, "pubDate") || tagText(block, "dc:date"));

    out.push({
      title: stripBoilerplate(title),
      summary,
      url,
      source: feed.source,
      publishedAt,
      image: /^https?:\/\//i.test(image) ? image : "",
      hint: feed.hint,
      score: 0,
    });
  }
  return out;
}

function parseDate(raw: string): number {
  const value = clean(raw, 60);
  if (!value) return 0;
  // "2026-11-16 18:15:09" 처럼 시간대가 없으면 한국 시간으로 읽습니다.
  const naive = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (naive) {
    return Date.parse(`${naive[1]}-${naive[2]}-${naive[3]}T${naive[4]}:${naive[5]}:${naive[6]}+09:00`);
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/* --------------------------------------------------------- candidate pick */

const DROP_TITLE =
  /(부고|인사\s*$|인사\s*=|포토\]|화보\]|\[영상\]|\[그래픽\]|\[속보\]|사설\]|칼럼\]|\[오늘의 날씨\]|운세|주요\s*일정|정부\s*일정|공지)/;

/** 20~30대가 실제로 말하게 되는 키워드에 점수를 줍니다. */
const HOT_KEYWORDS: { re: RegExp; weight: number; category?: Category }[] = [
  { re: /(MZ|Z세대|2030|청년|사회초년생)/, weight: 30, category: "mz" },
  { re: /(연봉|월급|성과급|수당|최저임금|주\s*4일|재택|야근|회식|채용|공채|면접|퇴사|이직|번아웃|갑질)/, weight: 28, category: "work" },
  { re: /(물가|장바구니|치킨|커피|배달|구독|요금|인상|환율|부동산|전세|월세|대출|세금|지원금|소비|가격)/, weight: 26, category: "money" },
  { re: /(AI|인공지능|챗GPT|반도체|플랫폼|앱|서비스|개인정보|해킹|유출|알고리즘)/, weight: 24, category: "tech" },
  { re: /(드라마|예능|웹툰|아이돌|팬덤|티켓팅|공연|넷플릭스|유튜브|쇼츠|밈|시즌)/, weight: 22, category: "culture" },
  { re: /(논란|의혹|사과|파문|반발|비판|고소|소송|철회|중단|1위|신기록|돌파)/, weight: 18 },
];

function scoreArticle(item: Article, now: number): number {
  const ageHours = item.publishedAt > 0 ? (now - item.publishedAt) / 3_600_000 : 48;
  if (ageHours > 30) return -1;
  let score = Math.max(0, 40 - ageHours * 1.6);
  if (item.summary.length > 60) score += 12;
  if (item.image) score += 6;
  for (const rule of HOT_KEYWORDS) if (rule.re.test(item.title) || rule.re.test(item.summary)) score += rule.weight;
  if (DROP_TITLE.test(item.title)) score -= 80;
  if (item.title.length > 70) score -= 6;
  return score;
}

function normalizeTitle(title: string): string {
  return title.replace(/[^가-힣a-zA-Z0-9]/g, "").slice(0, 40);
}

function pickCandidates(items: Article[], limit: number): Article[] {
  const now = Date.now();
  const seenTitle = new Set<string>();
  const seenUrl = new Set<string>();
  const scored: Article[] = [];

  for (const item of items) {
    if (seenUrl.has(item.url)) continue;
    const key = normalizeTitle(item.title);
    if (key.length < 6 || seenTitle.has(key)) continue;
    const score = scoreArticle(item, now);
    if (score < 0) continue;
    const categoryRule = HOT_KEYWORDS.find((rule) => rule.category && rule.re.test(item.title));
    seenUrl.add(item.url);
    seenTitle.add(key);
    scored.push({ ...item, hint: categoryRule?.category ?? item.hint, score });
  }

  scored.sort((a, b) => b.score - a.score);

  // 카테고리가 한쪽으로 몰리지 않게 한 번씩 돌려 가며 담습니다.
  const byCategory = new Map<Category, Article[]>();
  for (const item of scored) {
    const list = byCategory.get(item.hint) ?? [];
    list.push(item);
    byCategory.set(item.hint, list);
  }
  const order: Category[] = [...CATEGORIES].sort(
    (a, b) => (byCategory.get(b)?.length ?? 0) - (byCategory.get(a)?.length ?? 0),
  );
  const picked: Article[] = [];
  let round = 0;
  while (picked.length < limit && round < 12) {
    let added = false;
    for (const category of order) {
      const item = byCategory.get(category)?.[round];
      if (item && !picked.includes(item)) {
        picked.push(item);
        added = true;
        if (picked.length >= limit) break;
      }
    }
    if (!added) break;
    round += 1;
  }
  return picked;
}

/** 후보 상위 기사의 본문을 확인해 AI에 사실 근거를 넣어 줍니다(실패해도 요약으로 진행). */
async function enrichWithBody(items: Article[]): Promise<Article[]> {
  const targets = items.slice(0, 6).filter((item) => item.summary.length < 220);
  await Promise.all(
    targets.map(async (item) => {
      const outcome = await fetchArticle(item.url, 8_000);
      if (outcome.ok && outcome.article.body.length > 120) {
        item.body = outcome.article.body.slice(0, 1_400);
      }
    }),
  );
  return items;
}

/* ------------------------------------------------------------------- AI */

const SYSTEM_PROMPT = `당신은 20~30대가 실제로 반응하는 뉴스를 골라 카드뉴스로 바꾸는 한국 뉴스레터 에디터입니다.
독자는 퇴근길에 폰으로 30초 동안 훑습니다. 길게 쓰면 읽지 않습니다.

절대 규칙:
- 주어진 후보 기사에 적힌 사실만 씁니다. 없는 수치·기관명·인물명·회사명·날짜를 만들어내지 마세요.
- 확인되지 않은 추측을 사실처럼 쓰지 마세요. 불확실하면 그 문장을 빼세요.
- 실존 인물의 실명을 새로 만들지 마세요. 기사에 있는 이름만 그대로 씁니다.
- 한 카드에 문장은 1~2개. 줄글 금지. 구어체 존댓말("~했어요", "~인데요")로 짧게.
- 투표는 그 이슈를 읽은 사람이 바로 고를 수 있는 양자택일이어야 합니다. 정답이 없는 질문만 만드세요.

카드 구성(각 이슈):
- hook: 카드 표지의 한 줄. 40자 이내. 숫자나 대비로 눈에 걸리게.
- kicker: 훅 아래 한 줄 맥락. 45자 이내.
- facts: "무슨 일인데" 카드에 넣을 팩트 2개. 각 70자 이내.
- sides: "어디서 갈리나" 카드의 양쪽 입장. a는 이해하는 쪽, b는 비판하는 쪽. 각 60자 이내.
- poll.question: 30자 이내 질문. poll.a / poll.b: 각 24자 이내 선택지.
- temp: 지금 여론이 달아오른 정도 0~100 정수(사과·철회·논란·품절은 70 이상, 단순 발표는 30~50).
- category: work(직장·커리어) | mz(MZ·트렌드) | money(소비·경제) | tech(테크·AI) | culture(문화·연예) 중 하나.
- tags: 검색 키워드 2~3개.

출력은 아래 스키마의 JSON 객체 하나뿐입니다. 코드블록·설명을 붙이지 마세요.
{"issues":[{"pick":1,"category":"work","hook":"...","kicker":"...","facts":["...","..."],"sides":{"a":"...","b":"..."},"poll":{"question":"...","a":"...","b":"..."},"temp":68,"tags":["...","..."]}]}`;

function buildPrompt(items: Article[]): string {
  const lines = items.map((item, index) => {
    const excerpt = (item.body || item.summary || "").slice(0, 700);
    const at = item.publishedAt ? new Date(item.publishedAt).toISOString() : "";
    return [
      `[${index + 1}] ${item.title}`,
      `- 출처: ${item.source} / 발행: ${at}`,
      excerpt ? `- 내용: ${excerpt}` : "- 내용: (요약 없음 — 제목만으로 확인 가능한 범위에서만 쓰세요)",
    ].join("\n");
  });
  return [
    "아래는 오늘 한국 언론사 RSS에서 모은 후보 기사입니다. 이 중 20~30대가 실제로 말하게 될 이슈 4~5개를 골라 카드뉴스로 만드세요.",
    "카테고리가 겹치지 않게 골라 주세요(가능하면 work·mz·money·tech·culture를 하나씩).",
    "pick에는 고른 후보 번호를 정확히 적으세요. 없는 번호는 쓰지 마세요.",
    "",
    ...lines,
    "",
    "각 이슈의 facts는 위 '내용'에 실제로 적힌 사실만으로 쓰세요. 내용이 부족한 후보는 고르지 마세요.",
  ].join("\n");
}


function normalizeCards(raw: unknown, items: Article[]): Issue[] {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(row.issues) ? row.issues : Array.isArray(raw) ? (raw as unknown[]) : [];
  const used = new Set<number>();
  const issues: Issue[] = [];

  for (const entry of list.slice(0, 6)) {
    if (!entry || typeof entry !== "object") continue;
    const card = entry as Record<string, unknown>;
    const pick = clampInt(card.pick, 1, items.length, 0);
    if (!pick || used.has(pick)) continue;
    const item = items[pick - 1];
    if (!item) continue;

    const hook = clean(card.hook, 80);
    const facts = cleanList(card.facts, 2, 100);
    if (hook.length < 6 || facts.length < 1) continue;

    const categoryRaw = clean(card.category, 12) as Category;
    const sidesRaw = card.sides && typeof card.sides === "object" ? (card.sides as Record<string, unknown>) : {};
    const sideA = clean(sidesRaw.a, 80);
    const sideB = clean(sidesRaw.b, 80);
    const pollRaw = card.poll && typeof card.poll === "object" ? (card.poll as Record<string, unknown>) : {};
    const pollA = clean(pollRaw.a, 40);
    const pollB = clean(pollRaw.b, 40);

    used.add(pick);
    issues.push({
      id: shortId(item.url),
      category: CATEGORIES.includes(categoryRaw) ? categoryRaw : item.hint,
      title: item.title,
      source: item.source,
      url: item.url,
      publishedAt: item.publishedAt || Date.now(),
      image: item.image,
      hook,
      kicker: clean(card.kicker, 60) || clean(item.summary, 60),
      facts: facts.length >= 2 ? facts : [facts[0], clean(item.summary, 100)].filter(Boolean),
      sides: sideA && sideB ? { a: sideA, b: sideB } : null,
      poll:
        pollA && pollB
          ? { question: clean(pollRaw.question, 60) || "이 이슈, 어떻게 봐요?", a: pollA, b: pollB }
          : { question: "이 뉴스, 내 일상에 영향 있나요?", a: "이미 체감 중", b: "아직 남 일" },
      temp: typeof card.temp === "undefined" ? null : clampInt(card.temp, 0, 100, 55),
      tags: cleanList(card.tags, 3, 14),
      ai: true,
    });
  }
  return issues;
}

/** AI가 없거나 실패했을 때 — 실제 기사 그대로의 최소 카드. 없는 내용은 채우지 않습니다. */
function headlineCards(items: Article[]): Issue[] {
  return items.slice(0, 5).map((item) => ({
    id: shortId(item.url),
    category: item.hint,
    title: item.title,
    source: item.source,
    url: item.url,
    publishedAt: item.publishedAt || Date.now(),
    image: item.image,
    hook: item.title,
    kicker: `${item.source} · 헤드라인`,
    facts: [item.summary || item.title].filter(Boolean),
    sides: null,
    poll: { question: "이 뉴스, 내 일상에 영향 있나요?", a: "이미 체감 중", b: "아직 남 일" },
    temp: null,
    tags: [],
    ai: false,
  }));
}

/* ------------------------------------------------------------ collection */

async function collect(): Promise<TrendingDoc> {
  const settled = await Promise.all(
    FEEDS.map(async (feed) => ({ feed, items: await readFeed(feed) })),
  );
  const feeds = settled.map(({ feed, items }) => ({ name: feed.name, ok: items.length > 0 }));
  const all = settled.flatMap(({ items }) => items);
  const reachable = feeds.filter((feed) => feed.ok).length;

  if (all.length === 0) {
    return { generatedAt: Date.now(), ai: null, issues: [], feeds, notice: "언론사 RSS에 연결하지 못했습니다." };
  }

  const candidates = await enrichWithBody(pickCandidates(all, 10));
  const aiInfo = aiStatus();
  const route = resolveRoute("");

  let issues: Issue[] = [];
  let aiUsed: { provider: string; model: string } | null = null;
  let aiMessage = "";

  if (route && candidates.length > 0) {
    const outcome = await callModel(route, {
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(candidates),
      temperature: 0.6,
      maxTokens: 2_600,
      timeoutMs: 40_000,
    });
    if (outcome.ok) {
      const parsed = parseJsonObject(outcome.content);
      issues = normalizeCards(parsed, candidates);
      if (issues.length > 0) aiUsed = { provider: outcome.provider, model: outcome.model };
      else aiMessage = "AI 응답 형식이 맞지 않아 헤드라인 카드로 대신했습니다.";
    } else {
      aiMessage = outcome.message;
    }
  } else if (!route) {
    aiMessage = "AI 키가 없어 헤드라인 카드로 보여드립니다.";
  }

  if (issues.length === 0) issues = headlineCards(candidates);

  const noticeParts: string[] = [];
  if (reachable < FEEDS.length) noticeParts.push(`언론사 ${FEEDS.length}곳 중 ${reachable}곳에서만 받았습니다`);
  if (aiMessage) noticeParts.push(aiMessage);

  return {
    generatedAt: Date.now(),
    ai: aiUsed ?? aiInfo,
    issues,
    feeds,
    notice: noticeParts.length > 0 ? noticeParts.join(" · ") : undefined,
  };
}

async function loadDoc(refresh: boolean): Promise<TrendingDoc> {
  if (!refresh) {
    const cached = await kvGet<TrendingDoc>(CACHE_KEY);
    if (cached && Array.isArray(cached.issues) && cached.issues.length > 0) {
      const fresh = Date.now() - cached.generatedAt < CACHE_FRESH_MS;
      if (fresh) return cached;
    }
  }
  return once(CACHE_KEY, async () => {
    const doc = await collect();
    if (doc.issues.length > 0) {
      await kvSet(CACHE_KEY, doc, CACHE_TTL_SECONDS);
      await Promise.all(
        doc.issues.map((issue) => kvSet(`${ISSUE_KEY_PREFIX}${issue.id}`, issue, ISSUE_TTL_SECONDS)),
      );
    }
    return doc;
  });
}

/* --------------------------------------------------------------- handler */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "method_not_allowed", message: "GET만 지원합니다." });
    return;
  }

  const issueId = clean(queryValue(req, "issue"), 40);
  const refresh = queryValue(req, "refresh") === "1";
  const store = storeLabel();

  if (issueId) {
    const doc = await kvGet<TrendingDoc>(CACHE_KEY);
    const found =
      doc?.issues.find((issue) => issue.id === issueId) ?? (await kvGet<Issue>(`${ISSUE_KEY_PREFIX}${issueId}`));
    if (!found) {
      res.status(404).json({ ok: false, error: "issue_not_found", message: "이 카드는 보관 기간이 지났습니다. 피드에서 다시 열어 주세요." });
      return;
    }
    res.status(200).json({ ok: true, mode: store.shared ? "shared" : "local", store: store.kind, issue: found });
    return;
  }

  if (rateLimited("trending", clientIp(req), refresh ? 6 : 40, 60_000)) {
    res.status(429).json({ ok: false, error: "rate_limited", message: "잠시 요청이 몰렸습니다. 1분 뒤 다시 시도해 주세요." });
    return;
  }

  const startedAt = Date.now();
  const doc = await loadDoc(refresh);
  if (doc.issues.length === 0) {
    res.status(503).json({
      ok: false,
      error: "feeds_unreachable",
      message: doc.notice || "지금은 뉴스를 가져오지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
      feeds: doc.feeds,
    });
    return;
  }

  res.status(200).json({
    ok: true,
    mode: store.shared ? "shared" : "local",
    store: store.kind,
    ai: doc.ai,
    aiKey: Boolean(ENV.GEMINI_API_KEY?.trim() || ENV.OPENAI_API_KEY?.trim()),
    generatedAt: doc.generatedAt,
    stale: Date.now() - doc.generatedAt > CACHE_FRESH_MS,
    latencyMs: Date.now() - startedAt,
    feeds: doc.feeds,
    notice: doc.notice,
    issues: doc.issues,
  });
}
