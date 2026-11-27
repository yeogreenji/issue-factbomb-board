/** 카드 공유 — PNG 저장 · 인스타 캡션 복사 · 링크 공유. 서버에 아무것도 저장하지 않습니다. */

import type { Issue, IssueCaption } from "../types";

export function issueLink(issue: Issue): string {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#/i/${issue.id}`;
}

/* ------------------------------------------------------------------ 태그 */

/** 서비스 태그 — 캡션 맨 뒤에 늘 붙는 두 개. */
const SERVICE_TAGS = ["이슈온도계", "카드뉴스"];

/** 분야 태그 — 기사만으로는 모자랄 때 계정의 결을 잡아 주는 말. */
const CATEGORY_TAGS: Record<Issue["category"], string[]> = {
  entertainment: ["연예뉴스", "스타", "방송가"],
  society: ["사회뉴스", "사건사고", "공감"],
  culture: ["문화", "라이프", "요즘뜨는것"],
  tech: ["AI", "테크", "IT뉴스"],
  money: ["물가", "경제뉴스", "생활경제"],
  work: ["직장인공감", "커리어", "회사생활"],
};

/** 태그가 8개 아래로 떨어질 때만 보태는 범용 태그. */
const FILLER_TAGS = ["핫이슈", "실시간이슈", "뉴스스타그램", "토론"];

/** 제목에서 뽑은 낱말이 태그로 어색해지는 꼬리 — 서술어·부사는 태그로 쓰지 않습니다. */
const TAG_STOP = new Set([
  "오늘", "어제", "내일", "이번", "지난", "지난달", "지난해", "올해", "관련", "대한", "위한", "통해",
  "라며", "라고", "한다", "했다", "된다", "됐다", "이다", "있다", "없다", "같다", "보다", "만에",
  "동안", "경우", "사실", "현재", "당시", "이후", "이전", "예정", "가능", "문제", "상황", "내용",
  "정도", "이상", "이하", "최초", "최고", "최저", "역대", "모두", "다시", "여전히", "아직", "벌써",
  "결국", "무더기", "단독", "속보", "종합", "포토", "영상", "인터뷰", "발표", "공개", "확인",
  "논란", "충격", "경악", "난리", "화제", "직접", "관련", "서로", "결국",
]);

/** 태그로 쓰기 어색한 꼬리(서술어·구어 꼬리) — 낱말 자체가 문장 조각인 경우를 걸러 냅니다. */
const TAG_TAIL =
  /(하다|한다|했다|된다|됐다|이다|있다|없다|같다|보다|위해|대해|통해|라며|라고|지만|면서|으로|에서|부터|까지|자마자|는데|려고|하려|한|난|된|될|다|까봐|니까|습니다|세요|네요|죠|들)$/;

function tidyTag(raw: string): string {
  return raw
    .replace(/^#+/, "")
    .replace(/[\s#.,"'“”‘’()[\]~!?·…]+/g, "")
    .trim();
}

/** 제목에서 해시태그로 쓸 만한 낱말만 뽑습니다(조사·서술어·숫자는 버립니다). */
function titleKeywords(title: string): string[] {
  return title
    .replace(/[“”"'‘’]/g, " ")
    .split(/[^가-힣A-Za-z0-9]+/)
    .map((word) => word.replace(/(은|는|이|가|을|를|의|에|와|과|도|로|으로|만|보다|까지|에서|에게|부터|께서)$/, ""))
    .filter((word) => word.length >= 2 && word.length <= 8 && !/^\d/.test(word))
    .filter((word) => !TAG_STOP.has(word) && !TAG_TAIL.test(word))
    .slice(0, 2);
}

export const TAG_MIN = 8;
export const TAG_MAX = 10;

/**
 * 인스타에 그대로 붙일 해시태그 8~10개.
 *
 * 이 기사에만 통하는 키워드(AI가 고른 tags → 제목 낱말) → 분야 → 서비스 순으로 채웁니다.
 * 서비스 태그 두 자리는 늘 비워 두고, 8개가 안 될 때만 범용 태그로 보탭니다.
 */
export function hashtagList(issue: Issue): string[] {
  const keywordSlots = TAG_MAX - SERVICE_TAGS.length;
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (tag: string, limit = keywordSlots) => {
    if (out.length >= limit) return;
    const clean = tidyTag(tag);
    if (clean.length < 2 || clean.length > 16) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  };

  [...issue.tags, ...titleKeywords(issue.title)].forEach((tag) => push(tag));
  (CATEGORY_TAGS[issue.category] ?? []).forEach((tag) => push(tag));
  // 8개를 채우려면 범용 태그로 조금 보탭니다(서비스 태그 2개는 남겨 둡니다).
  if (out.length < TAG_MIN - SERVICE_TAGS.length) FILLER_TAGS.forEach((tag) => push(tag));
  SERVICE_TAGS.forEach((tag) => push(tag, TAG_MAX));

  return out.slice(0, TAG_MAX);
}

/* ---------------------------------------------------------------- 캡션 */

/** 한 줄 길이에 맞춰 자릅니다. */
function clip(text: string, max: number): string {
  const value = (text ?? "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1).trim()}…` : value;
}

/** 긴 글을 문장 단위로 끊습니다(문장 안에서 억지로 줄을 바꾸면 토막 말이 남습니다). */
function sentences(text: string): string[] {
  return clip(text, 300)
    .split(/(?<=[.!?…])\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * ② 핵심 맥락 두 줄 — 카드 5장에 팩트가 이미 있으니 캡션에서는 '왜 지금 논란인지'만.
 * AI가 캡션용 문장(lead)을 줬으면 그것을, 없으면 킥커·배경에서 두 문장을 만듭니다.
 * (분량이 모자라는 카드에서만 세 번째 문장까지 보탭니다 — limit을 늘려 호출.)
 */
function contextLines(issue: Issue, aiLead: string, max: number, limit = 2): string[] {
  const pool = [
    ...sentences(aiLead),
    issue.kicker || "",
    ...sentences(issue.background || ""),
    issue.point || "",
  ];
  const out: string[] = [];
  for (const line of pool) {
    if (out.length >= limit) break;
    const value = clip(line, max);
    if (value.length < 12) continue;
    // 같은 말을 두 줄로 되풀이하지 않습니다.
    if (out.some((kept) => kept.slice(0, 18) === value.slice(0, 18))) continue;
    out.push(value);
  }
  return out.slice(0, limit);
}

/** 양쪽 입장 — A 진영과 B 진영을 한 줄씩 마주 세웁니다. */
function sideLines(issue: Issue, ai: IssueCaption, max: number): string[] {
  const labelA = clip(issue.sides?.labelA || "A", 10);
  const labelB = clip(issue.sides?.labelB || "B", 10);
  const a = clip(ai.sideA || issue.sides?.a || issue.poll.a || "", max);
  const b = clip(ai.sideB || issue.sides?.b || issue.poll.b || "", max);
  if (!a || !b) return [];
  return [`🗣 ${labelA}: ${a}`, `🗣 ${labelB}: ${b}`];
}

/** ④ 댓글 싸움을 부르는 질문 — AI가 캡션용 질문을 줬으면 그것, 없으면 기본 문장. */
function askLines(ai: IssueCaption, max: number): string[] {
  const question = clip(ai.ask || "", max);
  if (!question) return ["여러분은 어느 쪽이 더 문제라고 보세요?", "댓글로 의견 남겨주세요 👇"];
  // AI가 이미 댓글을 부르는 문장을 줬으면 한 줄로 끝냅니다(같은 말 반복 금지).
  if (/댓글/.test(question)) return [question];
  return [question, "댓글로 의견 남겨주세요 👇"];
}

/** 카드 링크 한 줄 — 온도를 알 수 있으면 함께 적습니다(이슈온도계의 숫자). */
function linkLine(issue: Issue): string {
  const temp = issue.temp;
  if (temp === null || temp === undefined) return `👉 카드 5장 전체 보기 ${issueLink(issue)}`;
  return `🌡️ 이슈온도 ${temp}° · 카드 5장 전체 보기 ${issueLink(issue)}`;
}

export interface CaptionOptions {
  /** 카드에 박은 크리에이터 핸들(@my_channel) — 캡션 끝에 함께 남깁니다. */
  handle?: string;
}

/** 캡션 목표 분량 — 인스타 피드에서 비어 보이지도, 뉴스 전달문처럼 길지도 않은 구간.
 * (이모지(🔥🗣👇)는 브라우저에서 2글자로 세어져 화면 숫자가 실제보다 4~6자 크게 나옵니다.
 *  350자 아래로 떨어지지 않게 아래쪽에 그만큼 여유를 둡니다.) */
export const CAPTION_MIN = 358;
export const CAPTION_MAX = 450;

/**
 * 인스타그램에 그대로 붙여 넣는 캡션 — 댓글 싸움을 부르는 350~450자.
 *
 *  ① 후킹 첫 줄 — 카드 표지의 헤드라인(이미 34자 안쪽으로 세게 쓴 문장)
 *  ② 핵심 맥락 두 줄 — 왜 지금 이게 논란인지, 구어체로 두 줄만
 *  ③ 양쪽 입장 — A 진영 vs B 진영을 한 줄씩 부딪히게
 *  ④ 댓글 싸움 질문 — 어느 쪽이 더 문제인지 묻고 댓글을 부릅니다
 *  ⑤ 카드 링크(+ @핸들)
 *  ⑥ 이슈 키워드 중심 해시태그 8~10개
 *
 * 팩트 3줄·Q/A/B는 카드 5장이 이미 들고 있으므로 캡션에서 되풀이하지 않습니다.
 * AI가 캡션용 문장(caption.lead/sideA/sideB/ask)을 줬으면 그것을 먼저 씁니다.
 */
export function captionFor(issue: Issue, options: CaptionOptions = {}): string {
  const ai = issue.caption ?? {};
  const hookText = issue.hook || ai.hook || issue.title;
  const tags = hashtagList(issue);
  let hookMax = 46;
  let contextMax = 72;
  let sideMax = 56;
  let contextCount = 2;
  let tagCount = tags.length;
  /** 분량이 모자라는 카드에서만 카드의 투표 질문·저장 한 줄을 보탭니다. */
  let extraPoll = false;
  let saveCta = false;

  /** 서비스 태그(#이슈온도계·#카드뉴스)는 줄여도 항상 남깁니다 — 계정 검색으로 들어오는 두 자리. */
  const tagLine = (): string => {
    const service = tags.length > 2 ? tags.slice(-2) : [];
    const keywords = tags.slice(0, tags.length - service.length);
    const keepKeywords = Math.max(0, Math.min(keywords.length, tagCount - service.length));
    return [...keywords.slice(0, keepKeywords), ...service].map((tag) => `#${tag}`).join(" ");
  };

  const build = (): string => {
    const parts: string[] = [];
    parts.push(`🔥 ${clip(hookText, hookMax)}`);

    const context = contextLines(issue, ai.lead ?? "", contextMax, contextCount);
    if (context.length > 0) parts.push("", ...context);

    const sides = sideLines(issue, ai, sideMax);
    if (sides.length > 0) parts.push("", ...sides);

    if (extraPoll && issue.poll?.question) parts.push("", `📊 ${clip(issue.poll.question, 50)}`);

    parts.push("", ...askLines(ai, 62));
    if (saveCta) parts.push("🔖 지금 저장해 두면 저녁에 다시 보기 좋아요.");
    parts.push("", linkLine(issue));
    if (options.handle) parts.push(options.handle);
    parts.push("", tagLine());

    return tidy(parts);
  };

  let text = build();
  // 길면 두 진영 문장 → 맥락 → 태그 순으로 조금씩 다듬습니다(태그는 8개 밑으로 줄이지 않음).
  while (text.length > CAPTION_MAX && sideMax > 40) {
    sideMax -= 4;
    text = build();
  }
  while (text.length > CAPTION_MAX && contextMax > 48) {
    contextMax -= 6;
    text = build();
  }
  while (text.length > CAPTION_MAX && tagCount > TAG_MIN) {
    tagCount -= 1;
    text = build();
  }
  while (text.length > CAPTION_MAX && hookMax > 34) {
    hookMax -= 4;
    text = build();
  }
  // 짧으면 태그를 10개까지 채우고, 그래도 짧으면 맥락을 세 문장까지 보탭니다.
  while (text.length < CAPTION_MIN && tagCount < TAG_MAX) {
    tagCount += 1;
    text = build();
  }
  while (text.length < CAPTION_MIN && contextCount < 3) {
    contextCount += 1;
    text = build();
  }
  while (text.length < CAPTION_MIN && contextMax < 90) {
    contextMax += 6;
    text = build();
  }
  while (text.length < CAPTION_MIN && !extraPoll) {
    extraPoll = true;
    text = build();
  }
  while (text.length < CAPTION_MIN && !saveCta) {
    saveCta = true;
    text = build();
  }

  return text;
}

/** 빈 줄 3개 이상은 2개로, 앞뒤 공백은 지우고, 인스타 한도(2,200자)로 자릅니다. */
function tidy(lines: string[]): string {
  return lines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 2_180);
}

/* 인스타 캡션은 2,200자가 한도입니다 — 화면에서 남은 글자를 보여 주려고 함께 둡니다. */
export const CAPTION_LIMIT = 2_200;

export function shareText(issue: Issue): string {
  const parts = [issue.hook];
  if (issue.facts[0]) parts.push(issue.facts[0]);
  parts.push(`→ ${issueLink(issue)}`);
  return parts.join("\n");
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 아래 폴백 */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** 모바일이면 기본 공유 시트, 아니면 링크 복사. */
export async function shareIssue(issue: Issue): Promise<"shared" | "copied" | "failed"> {
  const text = shareText(issue);
  if (navigator.share) {
    try {
      await navigator.share({ title: issue.hook, text: issue.hook, url: issueLink(issue) });
      return "shared";
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return "failed";
    }
  }
  return (await copyText(text)) ? "copied" : "failed";
}
