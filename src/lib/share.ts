/** 카드 공유 — PNG 저장 · 인스타 캡션 복사 · 링크 공유. 서버에 아무것도 저장하지 않습니다. */

import { CATEGORY_META, type Issue } from "../types";

export function issueLink(issue: Issue): string {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#/i/${issue.id}`;
}

/** 서비스·카테고리 기본 태그 — 캡션 아래 12~15개를 채우는 뼈대. */
const BASE_TAGS = ["이슈온도계", "카드뉴스", "오늘의뉴스", "뉴스요약", "이슈", "인스타카드뉴스"];
const CATEGORY_TAGS: Record<Issue["category"], string[]> = {
  work: ["직장인공감", "커리어", "회사생활", "직장인"],
  mz: ["MZ세대", "트렌드", "요즘것들", "밈"],
  money: ["물가", "소비", "경제뉴스", "생활경제"],
  tech: ["AI", "테크", "IT뉴스", "기술"],
  culture: ["연예", "문화", "연예뉴스", "방송"],
};
/** 태그가 모자랄 때 채우는 범용 태그 — 12개 아래로 떨어지지 않게. */
const FILLER_TAGS = ["핫이슈", "실시간이슈", "오늘의이슈", "뉴스스타그램", "정보공유", "토론", "여론", "데일리뉴스"];

function tidyTag(raw: string): string {
  return raw
    .replace(/^#+/, "")
    .replace(/[\s#.,"'“”‘’()[\]]+/g, "")
    .trim();
}

/** 제목에서 해시태그로 쓸 만한 낱말만 뽑습니다(조사·숫자만 있는 말은 버립니다). */
function titleKeywords(title: string): string[] {
  return title
    .split(/[^가-힣A-Za-z0-9]+/)
    .map((word) => word.replace(/(은|는|이|가|을|를|의|에|와|과|도|로|으로|만|보다|까지|에서)$/, ""))
    .filter((word) => word.length >= 2 && word.length <= 12 && !/^\d+$/.test(word));
}

/**
 * 인스타에 그대로 붙일 해시태그 12~15개.
 * 서비스 태그 → 카테고리 → 기사 키워드 → 범용 태그 순으로 채우고 중복은 지웁니다.
 */
export function hashtagList(issue: Issue): string[] {
  const raw = [
    ...BASE_TAGS,
    ...(CATEGORY_TAGS[issue.category] ?? []),
    ...issue.tags,
    ...titleKeywords(issue.title).slice(0, 4),
    ...FILLER_TAGS,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of raw) {
    const clean = tidyTag(tag);
    if (clean.length < 2 || clean.length > 20) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= 15) break;
  }
  return out.slice(0, 15);
}

/** 한 줄 요약을 캡션 길이에 맞게 다듬습니다. */
function clip(text: string, max: number): string {
  const value = text.replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1).trim()}…` : value;
}

export interface CaptionOptions {
  /** 카드에 박은 크리에이터 핸들(@my_channel) — 캡션 끝에 함께 남깁니다. */
  handle?: string;
  /** Pro면 3줄 요약·A/B·해시태그 12~15개를 채운 긴 캡션, Free면 짧은 기본 캡션. */
  pro?: boolean;
}

/** Free 캡션에 붙는 기본 태그 — 5개. 나머지 해시태그 묶음은 Pro입니다. */
export const FREE_CAPTION_TAGS = ["이슈온도계", "카드뉴스", "오늘의뉴스", "뉴스요약", "이슈"];

/**
 * 인스타그램에 그대로 붙여 넣는 캡션.
 * 훅 → 3줄 요약 → 쟁점 → A/B 토론 질문 → 링크 → 해시태그 12~15개.
 * 크리에이터가 카드 문구를 고쳤다면 고친 문구(edited issue)를 그대로 받아 씁니다.
 */
export function captionFor(issue: Issue, options: CaptionOptions = {}): string {
  const meta = CATEGORY_META[issue.category];
  const lines: string[] = [];

  if (options.pro === false) {
    // Free — 훅·한 줄 요약·링크·기본 태그까지만. 3줄 요약과 해시태그 묶음은 Pro.
    lines.push(`🔥 ${clip(issue.hook, 70)}`);
    lines.push("");
    lines.push(`${meta.label} · ${issue.source}`);
    if (issue.kicker) {
      lines.push("");
      lines.push(clip(issue.kicker, 90));
    }
    lines.push("");
    lines.push(`카드 5장·토론 → ${issueLink(issue)}`);
    lines.push("");
    lines.push(FREE_CAPTION_TAGS.map((tag) => `#${tag}`).join(" "));
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").slice(0, 2_100);
  }

  const facts = issue.facts.map((fact) => clip(fact, 72)).filter(Boolean).slice(0, 3);

  lines.push(`🔥 ${clip(issue.hook, 70)}`);
  lines.push("");
  lines.push(`${meta.label} · ${issue.source}`);
  lines.push("");
  facts.forEach((fact, index) => lines.push(`${index + 1}. ${fact}`));
  if (issue.point) {
    lines.push("");
    lines.push(`👉 ${clip(issue.point, 80)}`);
  }
  lines.push("");
  lines.push(`Q. ${issue.poll.question}`);
  lines.push(`A. ${issue.poll.a}`);
  lines.push(`B. ${issue.poll.b}`);
  lines.push("");
  lines.push("여러분 선택은? 댓글로 A 아니면 B, 이유도 한 줄!");
  lines.push(`카드 5장·투표 → ${issueLink(issue)}`);
  if (issue.sides?.labelA || issue.sides?.labelB) {
    lines.push(`(A ${issue.sides.labelA || "찬성"} vs B ${issue.sides.labelB || "반대"})`);
  }
  if (options.handle) lines.push(options.handle);
  lines.push("");
  lines.push(hashtagList(issue).map((tag) => `#${tag}`).join(" "));

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").slice(0, 2_100);
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
