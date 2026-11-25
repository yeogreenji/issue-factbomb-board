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
import { composeEditorial } from "./editorial.js";

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
const CARD_LIMIT = 8;

export type Category = "entertainment" | "society" | "culture" | "tech" | "money" | "work";
const CATEGORIES: Category[] = ["entertainment", "society", "culture", "tech", "money", "work"];

/** 표지 편집 판 — 클라이언트(lib/layout.ts)와 같은 이름을 씁니다. */
export type CardLayoutId = "overlay" | "quote" | "stat" | "split" | "breaking";
const CARD_LAYOUTS: CardLayoutId[] = ["overlay", "quote", "stat", "split", "breaking"];

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
  /** 기사에서 확인한 사진 후보(대표 → 본문). 카드 5장이 같은 사진만 쓰지 않게 합니다. */
  images: string[];
  /** 기사에 실제로 있던 인용 한 줄 — 표지 '한마디' 판의 주인공. */
  quote: string;
  /** 표지 편집 판 — 카드마다 다른 판으로 그리도록 서버가 골라 줍니다. */
  layout: CardLayoutId;
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
  // 연예 — 인스타에서 가장 잘 도는 사진·소식. 카드뉴스의 앞자리를 채웁니다.
  { name: "연합뉴스 연예", slug: "yna-ent", source: "연합뉴스", url: "https://www.yna.co.kr/rss/entertainment.xml", hint: "entertainment" },
  { name: "톱스타뉴스", slug: "topstar", source: "톱스타뉴스", url: "https://www.topstarnews.net/rss/allArticle.xml", hint: "entertainment" },
  { name: "조선일보 연예", slug: "chosun-ent", source: "조선일보", url: "https://www.chosun.com/arc/outboundfeeds/rss/category/entertainments/?outputType=xml", hint: "entertainment" },
  // 사회 — 사건·사고·생활. 정치 기사는 후보에서 걸러 냅니다.
  { name: "연합뉴스 사회", slug: "yna-society", source: "연합뉴스", url: "https://www.yna.co.kr/rss/society.xml", hint: "society" },
  { name: "SBS 사회", slug: "sbs-society", source: "SBS", url: "https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=03", hint: "society" },
  { name: "SBS 뉴스", slug: "sbs", source: "SBS", url: "https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=01", hint: "society" },
  { name: "연합뉴스 종합", slug: "yna-news", source: "연합뉴스", url: "https://www.yna.co.kr/rss/news.xml", hint: "society" },
  { name: "경향신문", slug: "khan", source: "경향신문", url: "https://www.khan.co.kr/rss/rssdata/total_news.xml", hint: "society" },
  { name: "동아일보", slug: "donga", source: "동아일보", url: "https://rss.donga.com/total.xml", hint: "society" },
  { name: "오마이뉴스", slug: "ohmynews", source: "오마이뉴스", url: "https://rss.ohmynews.com/rss/ohmynews.xml", hint: "society" },
  { name: "조선일보", slug: "chosun", source: "조선일보", url: "https://www.chosun.com/arc/outboundfeeds/rss/?outputType=xml", hint: "society" },
  // 문화·라이프 — 영화·드라마·전시·여행·건강.
  { name: "연합뉴스 문화", slug: "yna-culture", source: "연합뉴스", url: "https://www.yna.co.kr/rss/culture.xml", hint: "culture" },
  { name: "SBS 문화·라이프", slug: "sbs-life", source: "SBS", url: "https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=08", hint: "culture" },
  // 테크·경제.
  { name: "연합뉴스 산업", slug: "yna-industry", source: "연합뉴스", url: "https://www.yna.co.kr/rss/industry.xml", hint: "tech" },
  { name: "블로터", slug: "bloter", source: "블로터", url: "https://www.bloter.net/rss/allArticle.xml", hint: "tech" },
  { name: "전자신문", slug: "etnews", source: "전자신문", url: "https://rss.etnews.com/Section901.xml", hint: "tech" },
  { name: "연합뉴스 경제", slug: "yna-economy", source: "연합뉴스", url: "https://www.yna.co.kr/rss/economy.xml", hint: "money" },
  { name: "동아일보 경제", slug: "donga-economy", source: "동아일보", url: "https://rss.donga.com/economy.xml", hint: "money" },
  { name: "SBS 경제", slug: "sbs-economy", source: "SBS", url: "https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=02", hint: "money" },
  { name: "매일경제", slug: "mk", source: "매일경제", url: "https://www.mk.co.kr/rss/30000001/", hint: "money" },
  { name: "머니투데이", slug: "mt", source: "머니투데이", url: "https://rss.mt.co.kr/mt_news.xml", hint: "money" },
  { name: "한국경제", slug: "hankyung", source: "한국경제", url: "https://www.hankyung.com/feed/all-news", hint: "work" },
  // 노컷뉴스 — 사건·생활·직장 이야기가 고르게 섞여 인스타에서 말이 되는 소재가 많습니다(사진은 본문에서 가져옵니다).
  { name: "노컷뉴스", slug: "nocut", source: "노컷뉴스", url: "https://rss.nocutnews.co.kr/nocutnews.xml", hint: "society" },
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
  /** 기사에서 확인한 사진 후보 — 카드 5장이 같은 사진만 쓰지 않게 합니다. */
  images: string[];
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

/** description/content 안에 들어 있는 첫 <img> — 사진은 없지만 본문 HTML에 사진을 넣는 피드가 많습니다. */
function firstImageIn(raw: string): string {
  // 피드에 따라 src=""를 쓰지 않고 src=https://… 처럼 따옴표 없이 넣습니다(머니투데이).
  const match = raw.match(/<img[^>]+src=["']?([^"'\s>]+)/i);
  if (!match) return "";
  return match[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"');
}

/** 피드가 준 사진 주소를 절대 주소로 — HTML 엔티티(&amp;)가 남으면 이미지 서버가 400을 냅니다. */
function normalizeImage(value: string, base: string): string {
  const cleaned = decodeEntities(clean(value, 1_500)).trim().replace(/&amp;/g, "&");
  if (!cleaned) return "";
  try {
    const absolute = new URL(cleaned, base).toString();
    return /^https?:\/\//i.test(absolute) ? absolute : "";
  } catch {
    return "";
  }
}

/**
 * 대표 사진 주소 — 피드마다 담는 자리가 달라서 아는 자리를 모두 확인합니다.
 * 서명(auth=…)이 붙은 CDN 주소가 있어 400자에서 자르지 않습니다(자르면 사진이 깨집니다).
 */
function imageOf(block: string, rawSummary: string, base: string): string {
  const candidates = [
    tagAttr(block, "media:content", "url"),
    tagAttr(block, "media:thumbnail", "url"),
    tagAttr(block, "enclosure", "url"),
    tagAttr(block, "image", "url"),
    tagAttr(block, "og:image", "content"),
    firstImageIn(rawSummary),
  ];
  for (const value of candidates) {
    const src = normalizeImage(value, base);
    if (src) return src;
  }
  return "";
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
    const image = imageOf(block, rawSummary, feed.url);
    const publishedAt = parseDate(tagText(block, "pubDate") || tagText(block, "dc:date"));

    out.push({
      title,
      summary,
      url,
      source: feed.source,
      publishedAt,
      image,
      images: image ? [image] : [],
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
  { re: /(아이돌|배우|가수|연예인|드라마|예능|영화|팬덤|콘서트|티켓팅|웹툰|넷플릭스|유튜버|쇼츠|앨범|컴백|열애|결혼|이혼|출연|시청률|공연|뮤지컬|오디션|팬미팅|굿즈|K팝|케이팝)/, weight: 30, category: "entertainment" },
  { re: /(연봉|월급|성과급|수당|최저임금|주\s*4일|재택|야근|회식|채용|공채|면접|퇴사|이직|번아웃|갑질|노조|파업|권고사직|정년|알바)/, weight: 28, category: "work" },
  { re: /(물가|장바구니|치킨|커피|배달|구독|요금|인상|환율|부동산|전세|월세|대출|세금|지원금|소비|가격|금리|집값)/, weight: 26, category: "money" },
  { re: /(AI|인공지능|챗GPT|반도체|플랫폼|앱|서비스|개인정보|해킹|유출|알고리즘|로봇|전기차|배터리|스타트업|게임)/, weight: 24, category: "tech" },
  { re: /(사건|사고|화재|경찰|소방|실종|사망|부상|학교|학생|학부모|교사|주민|아파트|주택|교통|지하철|병원|응급|복지|환경|한파|폭설|미세먼지|반려|입양|동물|봉사|기부)/, weight: 22, category: "society" },
  { re: /(전시|미술|도서|책|여행|맛집|카페|패션|뷰티|건강|다이어트|육아|인테리어|캠핑|취미|웰빙|축제|와인|라이프)/, weight: 20, category: "culture" },
  { re: /(MZ|Z세대|2030|청년|사회초년생|20대|30대)/, weight: 18, category: "society" },
  { re: /(논란|의혹|사과|파문|반발|비판|고소|소송|철회|중단|1위|신기록|돌파|최저|최고)/, weight: 16 },
];

/**
 * 장르 판정 — 제목에 강하게 걸리는 말을 점수로 모으고, 애매하면 피드 성격을 따릅니다.
 * ("복귀"처럼 여러 분야에 쓰는 말 하나로 연예 기사가 되지 않도록 가중치를 둡니다.)
 */
const CATEGORY_HINTS: { re: RegExp; category: Category; weight: number }[] = [
  { re: /(아이돌|배우(?!자)|가수|연예인|드라마|예능|영화|개봉|박스오피스|관객|팬덤|콘서트|티켓팅|웹툰|넷플릭스|시청률|공연(?!원)|뮤지컬|앨범|컴백|열애|결혼|이혼|출연|오디션|팬미팅|K팝|케이팝|스타(?!트업)|방송(?!통신))/, category: "entertainment", weight: 26 },
  { re: /(AI|인공지능|챗GPT|반도체|엔비디아|플랫폼|앱|개인정보|해킹|유출|알고리즘|로봇|전기차|배터리|스타트업|게임|젠슨\s*황)/, category: "tech", weight: 24 },
  { re: /(주가|증시|코스피|금리|환율|물가|장바구니|배달비|구독료|부동산|전세|월세|대출|세금|지원금|소비|가격|집값|매출|실적|투자|모기지)/, category: "money", weight: 22 },
  { re: /(연봉|월급|성과급|최저임금|주\s*4일|재택|야근|회식|채용|공채|면접|퇴사|이직|번아웃|갑질|노조|파업|권고사직|정년|알바|실업급여|직장인)/, category: "work", weight: 22 },
  { re: /(사건|사고|화재|경찰|소방|실종|사망|부상|학교|학생|학부모|교사|주민|아파트|주택|교통|지하철|병원|응급|복지|환경|한파|폭설|미세먼지|반려|입양|동물|봉사|기부)/, category: "society", weight: 20 },
  { re: /(전시|미술|도서|여행|맛집|카페|패션|뷰티|건강|다이어트|육아|인테리어|캠핑|취미|웰빙|축제|와인|라이프|문화)/, category: "culture", weight: 18 },
];

function classifyCategory(title: string, feedHint: Category): Category {
  let best: Category = feedHint;
  let bestScore = 8; // 피드 성격은 기본값 — 제목에 분명한 말이 있으면 그쪽이 이깁니다.
  for (const rule of CATEGORY_HINTS) {
    if (!rule.re.test(title)) continue;
    if (rule.weight > bestScore) {
      best = rule.category;
      bestScore = rule.weight;
    }
  }
  return best;
}

/**
 * 정치·정부 공격 기사 — 카드뉴스 보드가 한쪽 색으로 물들지 않게 후보에서 뺍니다.
 * (연예·문화 기사 안에 '계엄' 같은 단어가 섞여도 그건 그대로 둡니다.)
 */
const POLITICS_NEWS =
  /(대통령|대통령실|청와대|국무총리|총리|장관|차관|국회|여당|야당|여야|민주당|국민의힘|국힘|개혁신당|조국혁신당|정의당|원내대표|당대표|의원|비례대표|공천|출마|사퇴|탄핵|공소|특검|검찰|법무부|국정감사|청문회|예산안|법안|개각|선거|투표소|대선|총선|지선|정부|정치권|계엄|비상계엄|시국선언|성명서|논평)/;

const SHOWBIZ_PASS = /(드라마|영화|예능|배우|가수|아이돌|앨범|공연|뮤지컬|웹툰|넷플릭스|시청률|팬덤|캐릭터|작품|연출|출연)/;

function isPolitics(item: Article): boolean {
  if (!POLITICS_NEWS.test(item.title)) return false;
  return !SHOWBIZ_PASS.test(item.title);
}

/** 장르별 최소 자리 — 연예·사회가 먼저 보이고, 테크·경제·직장이 뒤를 받칩니다. */
const GENRE_QUOTA: Record<Category, number> = {
  entertainment: 2,
  society: 2,
  culture: 1,
  tech: 1,
  money: 1,
  work: 1,
};

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
  { re: /(열애|결혼|이혼|파혼|임신|출산|복귀|컴백|탈퇴|사퇴|은퇴|입대|전역)/, weight: 18, category: "entertainment" },
  { re: /(아이돌|배우|가수|드라마|예능|영화|팬덤|콘서트|티켓팅|웹툰|넷플릭스|유튜버|쇼츠|밈)/, weight: 14, category: "entertainment" },
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

/** 같은 사건을 여러 언론사가 다른 문장으로 쓴 경우를 잡기 위한 제목 토큰. */
const TOPIC_STOP = new Set([
  "그리고", "하지만", "그런데", "이번", "오늘", "지금", "관련", "대한", "위한", "라며", "라고",
  "한다", "했다", "된다", "있다", "없다", "것이다", "사람", "정도", "기자", "뉴스", "단독", "속보",
  "종합", "우리", "이런", "저런", "그런", "모두", "모든", "다시", "계속", "이후", "때문", "예정",
  "오전", "오후", "오늘", "내일", "어제", "사진", "영상", "인터뷰", "발표", "공개", "확인", "논란",
]);

function topicTokens(title: string): Set<string> {
  const out = new Set<string>();
  for (const raw of title.split(/[^가-힣A-Za-z0-9]+/)) {
    const word = raw.replace(/(은|는|이|가|을|를|의|에|와|과|도|만|로|으로|에서|에게|부터|까지|께서)$/, "");
    if (word.length < 2 || TOPIC_STOP.has(word) || /^\d+$/.test(word)) continue;
    out.add(word);
  }
  return out;
}

/** 제목이 사실상 같은 사건인지 — 단어 겹침으로 판단합니다. */
function sameTopic(a: string, b: string): boolean {
  const A = topicTokens(a);
  const B = topicTokens(b);
  if (A.size < 2 || B.size < 2) return false;
  let shared = 0;
  for (const token of A) if (B.has(token)) shared += 1;
  const union = A.size + B.size - shared;
  return union > 0 && shared / union >= 0.3;
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
  const acceptedTitles: string[] = [];
  const scored: Article[] = [];

  for (const item of items) {
    if (seenUrl.has(item.url)) continue;
    if (isPolitics(item)) continue;
    const key = normalizeTitle(item.title);
    if (key.length < 6 || seenTitle.has(key)) continue;
    // 같은 사안을 여러 곳이 받아쓴 기사(제목 앞부분이 같음)는 한 번만 씁니다.
    const prefix = key.slice(0, 18);
    if (prefix.length >= 12 && seenTitle.has(`p:${prefix}`)) continue;
    // 같은 사건을 다른 제목으로 쓴 기사(고경표 음주운전 3건 등)는 한 장만 씁니다.
    if (acceptedTitles.some((title) => sameTopic(title, item.title))) continue;
    const withBuzz = { ...item, buzz: buzzOf(item, now) };
    const score = scoreArticle(withBuzz, now);
    if (score < 0) continue;
    seenUrl.add(item.url);
    seenTitle.add(key);
    if (prefix.length >= 12) seenTitle.add(`p:${prefix}`);
    acceptedTitles.push(item.title);
    scored.push({ ...withBuzz, hint: classifyCategory(item.title, item.hint), score });
  }

  scored.sort((a, b) => b.score - a.score);
  // ① 장르별 최소 자리를 먼저 채웁니다 — 연예·사회 없이 정치·경제만 나오던 문제를 막습니다.
  const byCategory = new Map<Category, Article[]>();
  for (const item of scored) {
    const list = byCategory.get(item.hint) ?? [];
    list.push(item);
    byCategory.set(item.hint, list);
  }
  // ① 장르별 최소 자리 — 이 묶음이 화면에 먼저 나갑니다(연예·사회·문화·테크·경제·직장).
  const core: Article[] = [];
  for (const category of CATEGORIES) {
    const quota = GENRE_QUOTA[category] ?? 1;
    const list = byCategory.get(category) ?? [];
    for (const item of list.slice(0, quota)) {
      if (core.includes(item)) continue;
      core.push(item);
    }
  }
  // ② 남은 후보는 화제성 순으로 뒤에 붙입니다(AI가 고를 여지를 남겨 둡니다).
  const filler = scored.filter((item) => !core.includes(item)).slice(0, Math.max(0, limit - core.length));

  // ③ 카드 순서는 화제성 — 단, 같은 장르가 연달아 붙지 않게 한 번 섞습니다.
  core.sort((a, b) => b.score - a.score);
  const ordered: Article[] = [];
  const pool = [...core];
  while (pool.length > 0) {
    const lastCategory = ordered[ordered.length - 1]?.hint;
    const nextIndex = pool.findIndex((item) => item.hint !== lastCategory);
    ordered.push(pool.splice(nextIndex >= 0 ? nextIndex : 0, 1)[0]);
  }
  ordered.push(...filler);
  return ordered;
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
        // 카드 5장이 같은 사진만 쓰지 않도록, 기사 페이지의 대표 사진 후보를 모아 둡니다.
        // (본문 <img>는 광고·배너·기자 사진이 섞여 카드에 엉뚱한 그림이 깔리므로 쓰지 않습니다.)
        const gathered = [item.image, outcome.article.image].filter(
          (src) => /^https?:\/\//i.test(src) && !/\.svg(\?|$)/i.test(src),
        );
        item.images = [...new Set(gathered)].slice(0, 2);
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
1) hook: 표지에 박히는 한 줄. **34자 이내**. 인스타 피드를 넘기던 사람이 손을 멈출 만큼 — 숫자 대비·반전·손해/이득·궁금증 중 최소 하나는 꼭.
   - 금지: 날짜("25일", "지난달")·기관명으로 시작하기, "~에 따르면", "~밝혔다/전했다/발표했다"로 끝내기, 제목을 그대로 복사하기.
   - 좋은 예: "월급 210만원인데 190만원 저축, 200억 만든 비결", "반값이라더니 3배로…구독료 인상에 난리".
   - 낚시성 왜곡 금지. 기사에 없는 사실은 절대 넣지 마세요.
2) kicker: 훅 아래 한 줄 맥락. **36자 이내**. 왜 지금 뜨는지, 무엇이 문제인지 한 번에. 훅과 같은 말 반복 금지.
3) facts: "무슨 일인데" 카드의 팩트 **정확히 3개**. 각 65자 이내. 서로 다른 내용이어야 하고, 가능하면 숫자·주체·행동이 들어가게.
4) background: "왜 지금 뜨나" 카드의 배경 2문장, 110자 이내. 앞서 무슨 일이 있었는지·왜 갑자기 화제인지.
5) point: "핵심 쟁점" 한 줄. 55자 이내. 무엇을 두고 갈리는지 한 문장으로. 가능하면 질문형("~해야 하나?").
6) quote: 기사에 **따옴표로 실제 인용된 말** 하나를 그대로(따옴표 제거, 50자 이내). 없으면 빈 문자열(""). 만들어 내지 마세요.
7) sides: 갈리는 두 진영. labelA/labelB는 각 10자 이내(예: "찬성", "회사 쪽"), a/b는 각 55자 이내 주장.
8) poll: 이 기사에서만 통하는 A/B 양자택일. 20~30대 댓글창에서 편 갈릴 만큼 팽팽하고 직관적으로.
   - poll.question: 32자 이내. 기사 속 주제어를 넣은 도발적인 한 줄(예: "도시락 12% 인상, 그냥 넘어갈까?").
   - poll.a / poll.b: 각 22자 이내. 한쪽으로 기운 단정형 문장(예: "소비자 기만, 즉시 불매" / "원가 상승 불가피, 기업 옹호").
   - 금지: "찬성/반대", "이해된다/아니다", "어떻게 보시나요", "영향 있나요", "이미 체감 중", "아직 남 일" 처럼 어느 기사에나 붙는 말.
   - 카드마다 질문·선택지가 완전히 달라야 합니다. 다른 이슈와 같은 문장을 재사용하면 실패입니다.
9) temp: 지금 여론이 달아오른 정도 0~100 정수(사과·철회·논란·품절은 70 이상, 단순 발표는 30~50).
10) category: entertainment(연예) | society(사회) | culture(문화·라이프) | tech(테크·AI) | money(경제·소비) | work(직장·커리어) 중 하나.
11) tags: 검색 키워드 3개(각 12자 이내, # 없이).

출력은 아래 스키마의 JSON 객체 하나뿐입니다. 코드블록·설명을 붙이지 마세요.
{"issues":[{"pick":1,"category":"work","hook":"...","kicker":"...","facts":["...","...","..."],"background":"...","point":"...","quote":"...","sides":{"labelA":"...","labelB":"...","a":"...","b":"..."},"poll":{"question":"...","a":"...","b":"..."},"temp":68,"tags":["...","...","..."]}]}`;

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
    "분야를 골고루 섞으세요 — 연예, 사회, 문화·라이프(여행·맛집·건강·관계), 테크·AI, 경제·소비(물가·구독·연봉), 직장·커리어 중 최소 4개 분야가 들어가야 합니다.",
    "정치·정부 공격 기사는 고르지 마세요. 화제성이 높은 후보를 먼저 보세요.",
    "카드끼리 문장이 겹치면 실패입니다. 훅·리드·팩트 3줄·쟁점·인용·A/B가 각 기사에만 있는 고유한 숫자·인물·발언으로 채워지게 쓰세요. 같은 표현을 두 카드에 복사하지 마세요.",
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

    const draft = composeEditorial({
      title: item.title,
      summary: item.summary,
      body: item.body,
      source: item.source,
      buzz: item.buzz,
    });
    const hook = cleanNewsText(card.hook, 80) || draft.hook;
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
    const point = cleanNewsText(card.point, 80) || draft.point || cleanNewsText(pollRaw.question, 60);
    const background = cleanNewsText(card.background, 180) || draft.background || fallbackBackground(item, facts);
    const quote = cleanNewsText(card.quote, 90) || draft.quote;
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
      images: uniqueImages(item),
      quote,
      layout: "overlay",
      hook,
      kicker: cleanNewsText(card.kicker, 70) || draft.kicker,
      facts,
      background,
      point,
      sides: sideA && sideB ? { labelA, labelB, a: sideA.replace(/[.]$/, ""), b: sideB.replace(/[.]$/, "") } : draft.sides,
      poll:
        pollA && pollB
          ? { question: cleanNewsText(pollRaw.question, 60) || ownPoll.question, a: pollA, b: pollB }
          : ownPoll,
      temp: typeof card.temp === "undefined" ? null : clampInt(card.temp, 0, 100, 55),
      buzz: item.buzz,
      tags: cleanList(card.tags, 3, 16).map((tag) => tag.replace(/^#/, "")).slice(0, 3).concat(draft.tags).slice(0, 3),
      ai: true,
    });
  }
  return issues;
}

function pollOf(item: Article) {
  return buildPoll({ title: item.title, summary: item.summary, body: item.body, category: item.hint });
}

/**
 * AI가 없거나 실패했을 때 — 그래도 카드마다 문장이 달라야 합니다.
 * 기사 본문에서 훅·리드·팩트 3줄·배경·쟁점·두 진영을 각각 다른 재료로 뽑습니다.
 */
function headlineCards(items: Article[]): Issue[] {
  return items.slice(0, CARD_LIMIT).map((item) => {
    const editorial = composeEditorial({
      title: item.title,
      summary: item.summary,
      body: item.body,
      source: item.source,
      buzz: item.buzz,
    });
    return {
      id: shortId(item.url),
      category: item.hint,
      title: item.title,
      source: item.source,
      url: item.url,
      publishedAt: item.publishedAt || Date.now(),
      image: item.image,
      images: uniqueImages(item),
      quote: editorial.quote,
      layout: "overlay",
      hook: editorial.hook,
      kicker: editorial.kicker,
      facts: editorial.facts,
      background: editorial.background,
      point: editorial.point || pollOf(item).question,
      sides: editorial.sides,
      // 제목만으로도 그 기사에만 통하는 A/B를 만듭니다(카드마다 다른 문항).
      poll: pollOf(item),
      // AI 없이 제목만으로 매긴 값은 '논란 온도'가 아닙니다 — 측정값이 없으면 비워 둡니다.
      temp: null,
      buzz: item.buzz,
      tags: editorial.tags,
      ai: false,
    };
  });
}

/* ------------------------------------------------------------ collection */

/** 기사 사진 후보 — 대표 사진이 없거나 막혀도 다음 컷으로 넘어갈 수 있게. */
function uniqueImages(item: Article): string[] {
  const pool = [item.image, ...(item.images ?? [])].filter(
    (src) => /^https?:\/\//i.test(src) && !/\.svg(\?|$)/i.test(src),
  );
  return [...new Set(pool)].slice(0, 4);
}

function canDrawLayout(issue: Issue, layout: CardLayoutId): boolean {
  if (layout === "stat") return /\d/.test(`${issue.hook} ${issue.kicker} ${issue.facts.join(" ")}`);
  if (layout === "quote") return Boolean(issue.quote && issue.quote.length >= 10 && /\s/.test(issue.quote));
  return true;
}

/**
 * 표지 판 배분 — 카드가 옆 카드와 같은 판이 되지 않게 돌려 가면서,
 * 그 판을 그릴 수 있는 카드(숫자가 있는 카드만 '숫자 판', 인용이 있는 카드만 '한마디' 판)에만 줍니다.
 */
function assignLayouts(issues: Issue[]): void {
  const used = new Set<CardLayoutId>();
  issues.forEach((issue, index) => {
    if (used.size >= CARD_LAYOUTS.length) used.clear();
    const start = index % CARD_LAYOUTS.length;
    const order = [...CARD_LAYOUTS.slice(start), ...CARD_LAYOUTS.slice(0, start)];
    const pick =
      order.find((layout) => !used.has(layout) && canDrawLayout(issue, layout)) ??
      order.find((layout) => canDrawLayout(issue, layout)) ??
      "overlay";
    issue.layout = pick;
    used.add(pick);
  });
}

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
  // 화제성 순으로 줄을 세운 다음에 표지 판을 배분합니다 — 순서가 바뀌어 같은 판이 옆에 붙지 않게.
  assignLayouts(doc.issues);
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
