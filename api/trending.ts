/**
 * 이슈온도계 — 오늘의 실제 뉴스 실시간 수집 (Vercel 서버리스 함수)
 *
 * GET /api/trending            오늘의 카드뉴스 묶음(캐시 12분)
 * GET /api/trending?refresh=1  캐시를 무시하고 새로 긁어옵니다
 * GET /api/trending?issue=ID   공유 링크로 받은 카드 하나만 다시 꺼냅니다
 *
 * 흐름: 한국 언론사 RSS 13곳 → 오늘 기사 후보 → 본문 확인 → AI가 카드뉴스 5장으로 정리
 *       (표지 훅 · 팩트 3줄 · 배경·쟁점 · A vs B · 한 줄 팩폭/투표 질문)
 *
 * AI 키가 없거나 실패하면 **실제 헤드라인 그대로**의 카드(제목·출처·시각·원문 링크)를 내려보냅니다.
 * 지어낸 뉴스는 어떤 경로에서도 만들지 않습니다.
 */

import {
  ENV,
  aiStatus,
  asSentence,
  callModel,
  clean,
  cleanList,
  cleanNewsText,
  clampInt,
  decodeEntities,
  factScore,
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
  splitSentences,
  storeLabel,
  clientIp,
  type VercelRequest,
  type VercelResponse,
} from "./_shared.js";
import { buildPoll, ensureDistinctPolls } from "./debate.js";

export const config = { maxDuration: 60 };

const CACHE_KEY = "issue-thermo:trending:v3";
/** 공유 링크로 받은 사람이 며칠 뒤에 열어도 카드가 남아 있도록, 카드 하나씩 따로 보관합니다. */
const ISSUE_KEY_PREFIX = "issue-thermo:issue:v3:";
const ISSUE_TTL_SECONDS = 60 * 60 * 24 * 7;
const CACHE_TTL_SECONDS = 60 * 15;
const CACHE_FRESH_MS = 12 * 60 * 1000;
const FEED_TIMEOUT_MS = 8_000;
const MAX_ITEMS_PER_FEED = 40;
const MAX_AGE_HOURS = 26;
const CANDIDATE_LIMIT = 20;
const CARD_LIMIT = 6;

export type Category = "work" | "mz" | "money" | "tech" | "culture";
const CATEGORIES: Category[] = ["work", "mz", "money", "tech", "culture"];

export interface IssuePoll {
  question: string;
  a: string;
  b: string;
}

export interface IssueSides {
  labelA: string;
  labelB: string;
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
  /** 팩트 3줄 — 무슨 일인데 */
  facts: string[];
  /** 왜 지금 떴나 · 배경 */
  background: string;
  /** 핵심 쟁점 한 줄 */
  point: string;
  sides: IssueSides | null;
  poll: IssuePoll;
  temp: number | null;
  /** 제목·키워드로 계산한 화제성(0~99) — 인스타에 올렸을 때 반응이 붙을 만한 정도. */
  buzz: number;
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
 * 한 곳이 막혀도 나머지로 계속 갑니다 — 어느 피드가 살아 있는지는 응답의 feeds 에 그대로 나갑니다.
 */
const FEEDS: Feed[] = [
  { name: "연합뉴스 종합", slug: "yna-news", source: "연합뉴스", url: "https://www.yna.co.kr/rss/news.xml", hint: "mz" },
  { name: "연합뉴스 경제", slug: "yna-economy", source: "연합뉴스", url: "https://www.yna.co.kr/rss/economy.xml", hint: "money" },
  { name: "연합뉴스 산업", slug: "yna-industry", source: "연합뉴스", url: "https://www.yna.co.kr/rss/industry.xml", hint: "tech" },
  { name: "연합뉴스 문화", slug: "yna-culture", source: "연합뉴스", url: "https://www.yna.co.kr/rss/culture.xml", hint: "culture" },
  { name: "연합뉴스 정치", slug: "yna-politics", source: "연합뉴스", url: "https://www.yna.co.kr/rss/politics.xml", hint: "work" },
  { name: "경향신문", slug: "khan", source: "경향신문", url: "https://www.khan.co.kr/rss/rssdata/total_news.xml", hint: "mz" },
  { name: "동아일보", slug: "donga", source: "동아일보", url: "https://rss.donga.com/total.xml", hint: "mz" },
  { name: "동아일보 경제", slug: "donga-economy", source: "동아일보", url: "https://rss.donga.com/economy.xml", hint: "money" },
  { name: "오마이뉴스", slug: "ohmynews", source: "오마이뉴스", url: "https://rss.ohmynews.com/rss/ohmynews.xml", hint: "mz" },
  { name: "SBS 뉴스", slug: "sbs", source: "SBS", url: "https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=01", hint: "mz" },
  { name: "SBS 경제", slug: "sbs-economy", source: "SBS", url: "https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=02", hint: "money" },
  { name: "블로터", slug: "bloter", source: "블로터", url: "https://www.bloter.net/rss/allArticle.xml", hint: "tech" },
  { name: "전자신문", slug: "etnews", source: "전자신문", url: "https://rss.etnews.com/Section901.xml", hint: "tech" },
  // 인스타에서 반응이 붙는 쪽 — 연예·사회 사건·소비자 논란. 사진이 붙는 피드만 넣었습니다.
  { name: "연합뉴스 연예", slug: "yna-ent", source: "연합뉴스", url: "https://www.yna.co.kr/rss/entertainment.xml", hint: "culture" },
  { name: "연합뉴스 사회", slug: "yna-society", source: "연합뉴스", url: "https://www.yna.co.kr/rss/society.xml", hint: "mz" },
  { name: "SBS 사회", slug: "sbs-society", source: "SBS", url: "https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=03", hint: "mz" },
  { name: "SBS 문화·라이프", slug: "sbs-life", source: "SBS", url: "https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=08", hint: "culture" },
  { name: "조선일보", slug: "chosun", source: "조선일보", url: "https://www.chosun.com/arc/outboundfeeds/rss/?outputType=xml", hint: "mz" },
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
  /** 화제성 0~99 — 제목의 논란성·연예·사건 키워드와 최신성으로 계산합니다. */
  buzz: number;
}

const FEED_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** RSS를 하나 읽어 기사 목록으로 바꿉니다. 실패하면 빈 배열(다른 피드는 계속 씁니다). */
async function readFeed(feed: Feed): Promise<Article[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const response = await fetch(feedUrl(feed), {
      signal: controller.signal,
      headers: {
        "User-Agent": FEED_USER_AGENT,
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
    const title = cleanNewsText(tagText(block, "title"), 160);
    const url = clean(tagText(block, "link"), 400) || clean(tagText(block, "guid"), 400);
    if (title.length < 8 || !/^https?:\/\//i.test(url)) continue;

    const rawSummary = tagText(block, "description") || tagText(block, "content:encoded");
    // 연합뉴스는 "(서울=연합뉴스) 홍길동 기자 =" 같은 머리말을 붙입니다.
    const summary = cleanNewsText(
      rawSummary
        .replace(/^\([^)]{1,24}\)\s*/, "")
        .replace(/^\[[^\]]{1,24}\]\s*/, "")
        .replace(/^[가-힣]{2,4}\s*(?:기자|특파원)\s*=\s*/, "")
        .replace(/\s*\.\.\.$/, ""),
      600,
    );
    const image = clean(tagAttr(block, "media:content", "url") || tagAttr(block, "enclosure", "url"), 400);
    const publishedAt = parseDate(tagText(block, "pubDate") || tagText(block, "dc:date"));

    out.push({
      title,
      summary,
      url,
      source: feed.source,
      publishedAt,
      image: /^https?:\/\//i.test(image) ? image : "",
      hint: feed.hint,
      score: 0,
      buzz: 0,
    });
  }
  return out;
}

function parseDate(raw: string): number {
  const value = clean(raw, 80);
  if (!value) return 0;
  // "2026-11-16 18:15:09" 처럼 시간대가 없으면 한국 시간으로 읽습니다.
  const naive = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (naive) {
    return Date.parse(`${naive[1]}-${naive[2]}-${naive[3]}T${naive[4]}:${naive[5]}:${naive[6] ?? "00"}+09:00`);
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/* --------------------------------------------------------- candidate pick */

const DROP_TITLE =
  /(부고|인사\s*$|인사\s*=|포토\]|화보\]|\[영상\]|\[그래픽\]|사설\]|칼럼\]|\[오늘의 날씨\]|운세|주요\s*일정|정부\s*일정|공지|정치\s*일정|증시\s*전망|코스피\s*(?:마감|출발)|환율\s*(?:마감|출발)|오늘의\s*증시)/;

/** 인스타에서 아무도 반응하지 않는 동네 단신·시세 기사 — 오늘의 이슈로 올리지 않습니다. */
const MICRO_NEWS =
  /(시세|경매|위판|어획|양식장|출하량|작황|개화|단풍|첫눈|물때|제철\s*(?:과일|음식|생선|수산물)|조개|굴\s*값|김장)/;

/** 20~30대가 실제로 말하게 되는 키워드에 점수를 줍니다. */
const HOT_KEYWORDS: { re: RegExp; weight: number; category?: Category }[] = [
  { re: /(MZ|Z세대|2030|청년|사회초년생|20대|30대)/, weight: 30, category: "mz" },
  { re: /(연봉|월급|성과급|수당|최저임금|주\s*4일|재택|야근|회식|채용|공채|면접|퇴사|이직|번아웃|갑질|노조|파업)/, weight: 28, category: "work" },
  { re: /(물가|장바구니|치킨|커피|배달|구독|요금|인상|환율|부동산|전세|월세|대출|세금|지원금|소비|가격|금리)/, weight: 26, category: "money" },
  { re: /(AI|인공지능|챗GPT|반도체|플랫폼|앱|서비스|개인정보|해킹|유출|알고리즘|로봇|전기차)/, weight: 24, category: "tech" },
  { re: /(드라마|예능|웹툰|아이돌|팬덤|티켓팅|공연|넷플릭스|유튜브|쇼츠|밈|시즌|영화)/, weight: 22, category: "culture" },
  { re: /(논란|의혹|사과|파문|반발|비판|고소|소송|철회|중단|1위|신기록|돌파|최저|최고)/, weight: 18 },
];

/** 정례 보도·알림성 기사 — 인스타에서 아무도 반응하지 않습니다. 화제성에서 크게 깎습니다. */
const ROUTINE_NEWS =
  /(인사\s*발표|선임|위촉|협약|MOU|개최|개막|참석|방문|간담회|정례\s*브리핑|발표회|시상식|공모\s*시작|모집|접수\s*시작|안내문|캐패인|봉사|기부|추모|동정|논평|성명서)/;

/**
 * 인스타에서 공유·댓글이 티지는 결 — 논란·사건·연예·생활버. 제목에 걸리면 화제성을 올립니다.
 * (팩트를 바꾸지 않습니다. 어떤 기사를 위로 올릴지 정하는 데만 씁니다.)
 */
const VIRAL_RULES: { re: RegExp; weight: number; category?: Category }[] = [
  { re: /(논란|의혹|폭로|고발|저격|반박|사과|해명|진상|공분|분노|원성|비판|막말|갑질|황당)/, weight: 22 },
  { re: /(사건|사고|충격|경악|발킵|소름|난리|아찔|역대급|사상\s*최초|최초|신기록|돌파)/, weight: 16 },
  { re: /(단독|속보|긴급|특종|1보)/, weight: 14 },
  { re: /(열애|결혼|이혼|파혼|임신|출산|복귀|컴백|탈퇴|사퇴|은퇴|입대|전역)/, weight: 18, category: "culture" },
  { re: /(아이돌|배우|가수|드라마|예능|영화|팬덤|콘서트|티켓팅|웹툰|넷플릭스|유튜버|쇼츠|밈)/, weight: 14, category: "culture" },
  { re: /(폭행|음주|마약|학폭|성추행|성희롱|탈세|횡령|배임|사기|소송|고소|구속|기소|사망|숨져|실종|화재|참사)/, weight: 26 },
  { re: /(월급|연봉|성과급|최저임금|물가|장바구니|배달비|구독료|집값|전세|월세|대출|금리|세금|지원금|실업|해고|권고사직|정년|주\s*4일)/, weight: 18, category: "money" },
  { re: /(불매|보이콧|집단\s*민원|서명|시위|집회|연대)/, weight: 16 },
  { re: /(억대|수백억|수천억|\d+\s*배|\d+%|\d+만\s*원|\d+위|\d+명)/, weight: 10 },
];

/** 제목·최신성만으로 매기는 화제성(0~99) — 화면에도 그대로 숫자로 보여 줍니다. */
function buzzOf(item: Article, now: number): number {
  const ageHours = item.publishedAt > 0 ? (now - item.publishedAt) / 3_600_000 : 18;
  let buzz = 46 - Math.min(30, ageHours * 1.2);
  let hits = 0;
  for (const rule of VIRAL_RULES) {
    if (rule.re.test(item.title)) {
      buzz += rule.weight;
      hits += 1;
    } else if (rule.re.test(item.summary)) {
      buzz += rule.weight * 0.45;
    }
  }
  if (hits >= 3) buzz += 6;
  if (/\d/.test(item.title)) buzz += 7;
  if (/[?!]$/.test(item.title.trim())) buzz += 4;
  if (item.image) buzz += 6;
  if (item.title.length >= 18 && item.title.length <= 46) buzz += 4;
  if (ROUTINE_NEWS.test(item.title)) buzz -= 22;
  if (DROP_TITLE.test(item.title)) buzz -= 30;
  if (MICRO_NEWS.test(item.title)) buzz -= 18;
  return Math.max(4, Math.min(99, Math.round(buzz)));
}

function scoreArticle(item: Article, now: number): number {
  const ageHours = item.publishedAt > 0 ? (now - item.publishedAt) / 3_600_000 : 40;
  if (ageHours > MAX_AGE_HOURS) return -1;
  let score = Math.max(0, 44 - ageHours * 1.7) * 0.5;
  let relevant = false;
  for (const rule of HOT_KEYWORDS) {
    if (!rule.re.test(item.title) && !rule.re.test(item.summary)) continue;
    score += rule.weight * 0.6;
    relevant = true;
  }
  // 화제성이 높은 기사를 위로 — 인스타에 올렸을 때 반응이 붙는 쪽입니다.
  score += item.buzz * 0.95;
  // 2030이 말하게 되는 키워드가 하나도 없는 기사는 뒤로 밀립니다(조개 시세 같은 단신).
  if (!relevant) score -= 22;
  if (item.summary.length > 70) score += 8;
  if (DROP_TITLE.test(item.title)) score -= 90;
  if (MICRO_NEWS.test(item.title)) score -= 60;
  if (item.title.length > 78) score -= 8;
  if (/^\[(속보|1보|2보)\]/.test(item.title)) score -= 4;
  return score;
}

function normalizeTitle(title: string): string {
  return title
    .replace(/^\[[^\]]{1,10}\]\s*/, "")
    .replace(/[^가-힣a-zA-Z0-9]/g, "")
    .slice(0, 44);
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
    // 같은 사안을 여러 곳이 받아쓴 기사(제목 앞부분이 같음)는 한 번만 씁니다.
    const prefix = key.slice(0, 18);
    if (prefix.length >= 12 && seenTitle.has(`p:${prefix}`)) continue;
    const withBuzz = { ...item, buzz: buzzOf(item, now) };
    const score = scoreArticle(withBuzz, now);
    if (score < 0) continue;
    // 연예·사건 키워드가 붙은 기사는 그 결에 맞는 카테고리로 보내 카드가 한쪽에 몰리지 않게 합니다.
    const viralCategory = VIRAL_RULES.find((rule) => rule.category && rule.re.test(item.title))?.category;
    const categoryRule = HOT_KEYWORDS.find((rule) => rule.category && rule.re.test(item.title));
    seenUrl.add(item.url);
    seenTitle.add(key);
    if (prefix.length >= 12) seenTitle.add(`p:${prefix}`);
    scored.push({ ...withBuzz, hint: categoryRule?.category ?? viralCategory ?? item.hint, score });
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
  while (picked.length < limit && round < 14) {
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
  // 카테고리 순환으로도 자리가 남으면 점수 순으로 채웁니다.
  for (const item of scored) {
    if (picked.length >= limit) break;
    if (!picked.includes(item)) picked.push(item);
  }
  return picked;
}

const BODY_CONCURRENCY = 6;
const BODY_BUDGET_MS = 12_000;

/**
 * 후보 기사의 본문을 확인해 AI에 사실 근거를 넣어 줍니다.
 * 요약이 짧은 기사만 골라 동시 6건씩 읽고, 전체 12초를 넘으면 남은 기사는 요약으로 진행합니다
 * (서버리스 함수 제한 시간 안에서 AI 호출 몫을 남겨 두기 위한 장치).
 */
async function enrichWithBody(items: Article[]): Promise<Article[]> {
  const targets = items.slice(0, 12).filter((item) => item.summary.length < 260);
  const deadline = Date.now() + BODY_BUDGET_MS;
  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length && Date.now() < deadline) {
      const item = targets[cursor];
      cursor += 1;
      const outcome = await fetchArticle(item.url, 6_000);
      if (outcome.ok) {
        const body = outcome.article.body;
        if (body.length > 140) item.body = body.slice(0, 1_600);
        if (!item.summary && outcome.article.description) item.summary = cleanNewsText(outcome.article.description, 600);
        if (!item.image && outcome.article.image) item.image = outcome.article.image;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(BODY_CONCURRENCY, targets.length) }, worker));
  return items;
}

/* ------------------------------------------------------------------- AI */

const SYSTEM_PROMPT = `당신은 20~30대가 실제로 반응하는 뉴스를 골라 인스타그램 카드뉴스로 바꾸는 한국 뉴스레터 에디터입니다.
독자는 퇴근길에 폰으로 30초 동안 훑습니다. 길게 쓰면 읽지 않습니다.

절대 규칙:
- 주어진 후보 기사에 적힌 사실만 씁니다. 없는 수치·기관명·인물명·회사명·날짜를 만들어내지 마세요.
- 확인되지 않은 추측을 사실처럼 쓰지 마세요. 불확실하면 그 문장을 빼세요.
- 실존 인물의 실명을 새로 만들지 마세요. 기사에 있는 이름만 그대로 씁니다.
- 숫자는 기사에 적힌 그대로 씁니다(반올림·변형 금지). 숫자가 없으면 억지로 만들지 마세요.
- 한 카드에 문장은 1~2개. 줄글 금지. 구어체 존댓말("~했어요", "~인데요")로 짧게.
- 투표는 그 이슈를 읽은 사람이 바로 고를 수 있는 양자택일이어야 합니다. 정답이 없는 질문만 만드세요.
- 투표 문항은 기사 속 갈등(누가 손해인지, 무엇이 부당한지, 어디까지 받아들일지)을 정면으로 묻습니다.

카드 구성(각 이슈, 인스타 5장):
1) hook: 표지에 박히는 한 줄. 38자 이내. 인스타 피드를 넘기던 사람이 손을 멈출 만큼 — 숫자·반전·궁금증 중 최소 하나는 꼭. 낚시성 왜곡 금지.
2) kicker: 훅 아래 한 줄 맥락. 42자 이내. 왜 지금 뜨는지 한 번에.
3) facts: "무슨 일인데" 카드의 팩트 **정확히 3개**. 각 65자 이내. 서로 다른 내용이어야 하고, 가능하면 숫자·주체·행동이 들어가게.
4) background: "왜 지금 뜨나" 카드의 배경 2문장, 110자 이내. 앞서 무슨 일이 있었는지·왜 갑자기 화제인지.
5) point: "핵심 쟁점" 한 줄. 55자 이내. 무엇을 두고 갈리는지 한 문장으로.
6) sides: 갈리는 두 진영. labelA/labelB는 각 10자 이내(예: "찬성", "회사 쪽"), a/b는 각 55자 이내 주장.
7) poll: 이 기사에서만 통하는 A/B 양자택일. 20~30대 댓글창에서 편 갈릴 만큼 팽팽하고 직관적으로.
   - poll.question: 32자 이내. 기사 속 주제어를 넣은 도발적인 한 줄(예: "도시락 12% 인상, 그냥 넘어갈까?").
   - poll.a / poll.b: 각 22자 이내. 한쪽으로 기운 단정형 문장(예: "소비자 기만, 즉시 불매" / "원가 상승 불가피, 기업 옹호").
   - 금지: "찬성/반대", "이해된다/아니다", "어떻게 보시나요", "영향 있나요", "이미 체감 중", "아직 남 일" 처럼 어느 기사에나 붙는 말.
   - 카드마다 질문·선택지가 완전히 달라야 합니다. 다른 이슈와 같은 문장을 재사용하면 실패입니다.
8) temp: 지금 여론이 달아오른 정도 0~100 정수(사과·철회·논란·품절은 70 이상, 단순 발표는 30~50).
9) category: work(직장·커리어) | mz(MZ·트렌드) | money(소비·경제) | tech(테크·AI) | culture(문화·연예) 중 하나.
10) tags: 검색 키워드 3개(각 12자 이내, # 없이).

출력은 아래 스키마의 JSON 객체 하나뿐입니다. 코드블록·설명을 붙이지 마세요.
{"issues":[{"pick":1,"category":"work","hook":"...","kicker":"...","facts":["...","...","..."],"background":"...","point":"...","sides":{"labelA":"...","labelB":"...","a":"...","b":"..."},"poll":{"question":"...","a":"...","b":"..."},"temp":68,"tags":["...","...","..."]}]}`;

function buildPrompt(items: Article[]): string {
  const lines = items.map((item, index) => {
    const excerpt = cleanNewsText(item.body || item.summary || "", 900);
    const at = item.publishedAt ? new Date(item.publishedAt).toISOString() : "";
    return [
      `[${index + 1}] ${item.title}`,
      `- 출처: ${item.source} / 발행: ${at} / 화제성: ${item.buzz}`,
      excerpt ? `- 내용: ${excerpt}` : "- 내용: (요약 없음 — 제목만으로 확인 가능한 범위에서만 쓰세요)",
    ].join("\n");
  });
  return [
    "아래는 오늘 한국 언론사 RSS에서 모은 후보 기사입니다. 인스타에 올렸을 때 저장·공유·댓글 싸움이 붙을 이슈 5~6개를 골라 카드뉴스로 만드세요.",
    "그중 최소 2개는 연예·사건·소비자 논란·직장 갑질처럼 댓글창이 갈리는 주제여야 합니다. 점잖은 발표 기사만 고르면 실패입니다.",
    "카테고리가 겹치지 않게 골라 주세요(가능하면 work·mz·money·tech·culture를 하나씩). 화제성이 높은 후보를 먼저 보세요.",
    "pick에는 고른 후보 번호를 정확히 적으세요. 없는 번호는 쓰지 마세요.",
    "내용이 2문장도 안 되는 후보는 고르지 마세요. 팩트 3개를 채울 수 있는 기사만 고르세요.",
    "",
    ...lines,
    "",
    "각 이슈의 facts·background는 위 '내용'에 실제로 적힌 사실만으로 쓰세요.",
  ].join("\n");
}

/** 형태만 조금 다른 같은 문장(“…반발하고 있어요” vs “…반발하고 있다”)을 같은 팩트로 봅니다. */
function similarFact(a: string, b: string): boolean {
  const norm = (value: string) => value.replace(/[^가-힣a-zA-Z0-9]/g, "").replace(/(어요|습니다|한다|있다|이다|된다)$/g, "");
  const x = norm(a);
  const y = norm(b);
  if (x.length < 8 || y.length < 8) return false;
  if (x.includes(y) || y.includes(x)) return true;
  if (x.slice(0, 22) === y.slice(0, 22)) return true;
  const bigrams = (value: string) => {
    const set = new Set<string>();
    for (let i = 0; i < value.length - 1; i += 1) set.add(value.slice(i, i + 2));
    return set;
  };
  const A = bigrams(x);
  const B = bigrams(y);
  if (A.size === 0 || B.size === 0) return false;
  let shared = 0;
  for (const gram of A) if (B.has(gram)) shared += 1;
  return shared / Math.min(A.size, B.size) > 0.72;
}

/** 팩트 3줄을 어떤 경우에도 채웁니다 — AI가 2개만 줬거나 요약이 짧아도 빈칸을 남기지 않습니다. */
function fillFacts(facts: string[], item: Article): string[] {
  const picked: string[] = [];
  const push = (value: string) => {
    const text = asSentence(value, 95);
    if (!text || text.length < 12) return;
    if (picked.some((existing) => similarFact(existing, text))) return;
    picked.push(text);
  };
  facts.forEach(push);
  const pool = [...splitSentences(item.summary, 4), ...splitSentences(item.body ?? "", 6)];
  const ranked = pool
    .map((sentence, order) => ({ sentence, order, score: factScore(sentence) }))
    .sort((a, b) => b.score - a.score);
  const chosen: { sentence: string; order: number }[] = [];
  const already = (sentence: string) =>
    picked.some((existing) => similarFact(existing, sentence)) || chosen.some((item) => similarFact(item.sentence, sentence));
  for (const entry of ranked) {
    if (picked.length + chosen.length >= 3) break;
    if (already(entry.sentence)) continue;
    chosen.push(entry);
  }
  // 점수로 고르되, 카드에는 기사 순서대로 읽히도록 정렬합니다.
  chosen.sort((a, b) => a.order - b.order).forEach((entry) => push(entry.sentence));
  if (picked.length < 3 && item.summary) push(item.summary);
  return picked.slice(0, 3);
}

function fallbackBackground(item: Article, facts: string[]): string {
  const pool = [...splitSentences(item.summary, 5), ...splitSentences(item.body ?? "", 7)];
  const rest: string[] = [];
  for (const sentence of pool) {
    if (rest.length >= 2) break;
    if (facts.some((fact) => similarFact(fact, sentence))) continue;
    if (rest.some((kept) => similarFact(kept, sentence))) continue;
    if (sentence.length < 30) continue;
    rest.push(sentence);
  }
  if (rest.length > 0) return rest.join(" ");
  return `${item.source}가 오늘 보도한 기사예요. 전체 내용은 원문에서 확인할 수 있어요.`;
}

/** AI가 제목을 함께 적어 보냈을 때, 그 제목으로 후보 기사를 찾습니다. */
function matchByTitle(card: Record<string, unknown>, items: Article[], used: Set<number>): Article | undefined {
  const hint = normalizeTitle(clean(card.title, 200));
  if (hint.length < 6) return undefined;
  const head = hint.slice(0, 14);
  for (let index = 0; index < items.length; index += 1) {
    if (used.has(index + 1)) continue;
    const candidate = normalizeTitle(items[index].title);
    if (candidate.length < 6) continue;
    if (candidate.includes(head) || hint.includes(candidate.slice(0, 14))) return items[index];
  }
  return undefined;
}

/**
 * AI가 JSON을 중간에 끊어 보내도 완성된 카드 객체만 건져 냅니다.
 * (예전에는 이 경우 카드가 0장이 되어 "AI 응답 형식이 맞지 않아"로 전부 헤드라인으로 내려갔습니다.)
 */
export function salvageIssues(content: string): unknown[] {
  const text = content.replace(/```(?:json)?/gi, " ");
  const out: unknown[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf("{", cursor);
    if (start < 0) break;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }
    if (end < 0) {
      // 바깥 객체가 잘렸으면 그 안의 완성된 카드라도 계속 찾습니다.
      cursor = start + 1;
      continue;
    }
    const slice = text.slice(start, end + 1);
    try {
      const parsed = JSON.parse(slice) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && ("hook" in parsed || "pick" in parsed)) out.push(parsed);
      else if (parsed && Array.isArray(parsed.issues)) out.push(...parsed.issues);
    } catch {
      /* 잘린 객체는 건너뜁니다 */
    }
    cursor = end + 1;
  }
  return out;
}

function normalizeCards(raw: unknown, items: Article[]): Issue[] {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const list = Array.isArray(row.issues) ? row.issues : Array.isArray(raw) ? (raw as unknown[]) : [];
  const used = new Set<number>();
  const issues: Issue[] = [];

  for (const entry of list.slice(0, CARD_LIMIT + 3)) {
    if (!entry || typeof entry !== "object") continue;
    const card = entry as Record<string, unknown>;
    const pick = clampInt(card.pick, 1, items.length, 0);
    // pick이 없거나 틀려도 AI가 제목을 함께 줬으면 그 기사를 찾아 붙입니다(카드를 통째로 버리지 않도록).
    const item = (pick && !used.has(pick) ? items[pick - 1] : undefined) ?? matchByTitle(card, items, used);
    if (!item) continue;
    const slot = items.indexOf(item) + 1;

    const hook = cleanNewsText(card.hook, 80);
    const facts = fillFacts(cleanList(card.facts, 4, 110), item);
    if (hook.length < 6 || facts.length < 2) continue;

    const categoryRaw = clean(card.category, 12) as Category;
    const sidesRaw = card.sides && typeof card.sides === "object" ? (card.sides as Record<string, unknown>) : {};
    const sideA = cleanNewsText(sidesRaw.a, 90);
    const sideB = cleanNewsText(sidesRaw.b, 90);
    const labelA = cleanNewsText(sidesRaw.labelA, 14) || "이해하는 쪽";
    const labelB = cleanNewsText(sidesRaw.labelB, 14) || "비판하는 쪽";
    const pollRaw = card.poll && typeof card.poll === "object" ? (card.poll as Record<string, unknown>) : {};
    const pollA = cleanNewsText(pollRaw.a, 34);
    const pollB = cleanNewsText(pollRaw.b, 34);
    const point = cleanNewsText(card.point, 80) || cleanNewsText(pollRaw.question, 60);
    const background = cleanNewsText(card.background, 180) || fallbackBackground(item, facts);
    const category = CATEGORIES.includes(categoryRaw) ? categoryRaw : item.hint;
    // AI가 밋밋한 문항을 주거나 아예 없을 때를 대비해 이 기사 전용 문항을 항상 준비합니다.
    const ownPoll = buildPoll({
      title: item.title,
      summary: item.summary,
      body: item.body,
      category,
    });

    used.add(slot);
    issues.push({
      id: shortId(item.url),
      category,
      title: item.title,
      source: item.source,
      url: item.url,
      publishedAt: item.publishedAt || Date.now(),
      image: item.image,
      hook,
      kicker: cleanNewsText(card.kicker, 70) || cleanNewsText(item.title, 70),
      facts,
      background,
      point: point || "지금 이 이슈, 어디까지 받아들일 수 있을까요?",
      sides: sideA && sideB ? { labelA, labelB, a: sideA.replace(/[.]$/, ""), b: sideB.replace(/[.]$/, "") } : null,
      poll:
        pollA && pollB
          ? { question: cleanNewsText(pollRaw.question, 60) || ownPoll.question, a: pollA, b: pollB }
          : ownPoll,
      temp: typeof card.temp === "undefined" ? null : clampInt(card.temp, 0, 100, 55),
      buzz: item.buzz,
      tags: cleanList(card.tags, 3, 16).map((tag) => tag.replace(/^#/, "")),
      ai: true,
    });
  }
  return issues;
}

/** AI가 없거나 실패했을 때 — 실제 기사 그대로의 최소 카드. 없는 내용은 채우지 않습니다. */
function headlineCards(items: Article[]): Issue[] {
  return items.slice(0, 6).map((item) => {
    const facts = fillFacts([], item);
    return {
      id: shortId(item.url),
      category: item.hint,
      title: item.title,
      source: item.source,
      url: item.url,
      publishedAt: item.publishedAt || Date.now(),
      image: item.image,
      hook: cleanNewsText(item.title, 70),
      kicker: `${item.source} · 헤드라인`,
      facts: facts.length > 0 ? facts : [asSentence(item.title, 95)],
      background: fallbackBackground(item, facts),
      point: "",
      sides: null,
      // 제목만으로도 그 기사에만 통하는 A/B를 만듭니다(카드마다 다른 문항).
      poll: buildPoll({ title: item.title, summary: item.summary, body: item.body, category: item.hint }),
      temp: null,
      buzz: item.buzz,
      tags: [],
      ai: false,
    };
  });
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

  const candidates = await enrichWithBody(pickCandidates(all, CANDIDATE_LIMIT));
  const aiInfo = aiStatus();
  const route = resolveRoute("");

  let issues: Issue[] = [];
  let aiUsed: { provider: string; model: string } | null = null;
  let aiMessage = "";

  if (route && candidates.length > 0) {
    const outcome = await callModel(route, {
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(candidates),
      temperature: 0.55,
      maxTokens: 3_200,
      timeoutMs: 35_000,
    });
    if (outcome.ok) {
      const parsed = parseJsonObject(outcome.content) ?? salvageIssues(outcome.content);
      issues = normalizeCards(parsed, candidates);
      if (issues.length > 0) aiUsed = { provider: outcome.provider, model: outcome.model };
      else aiMessage = "AI 응답에서 카드를 찾지 못해 헤드라인 카드로 대신했습니다.";
    } else {
      aiMessage = outcome.message;
    }
  } else if (!route) {
    aiMessage = "AI 키가 없어 헤드라인 카드로 보여드립니다.";
  }

  if (issues.length === 0) issues = headlineCards(candidates);

  // AI가 밋밋하거나 겹치는 A/B를 줬어도, 화면에는 카드마다 다른 문항만 나가게 마지막으로 맞춥니다.
  const distinct = ensureDistinctPolls(
    issues.map((issue) => ({
      ...issue,
      body: `${issue.facts.join(" ")} ${issue.background}`,
    })),
  );
  distinct.forEach((entry, index) => {
    issues[index].poll = entry.card.poll;
  });

  const noticeParts: string[] = [];
  if (reachable < FEEDS.length) noticeParts.push(`언론사 ${FEEDS.length}곳 중 ${reachable}곳에서 받았습니다`);
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
  const sorted = [...doc.issues].sort((a, b) => b.buzz - a.buzz || (b.temp ?? 0) - (a.temp ?? 0));
  doc.issues = sorted;
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
