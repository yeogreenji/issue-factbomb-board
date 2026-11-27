/** 카드 공유 — PNG 저장 · 인스타 캡션 복사 · 링크 공유. 서버에 아무것도 저장하지 않습니다. */

import { CATEGORY_META, type Issue } from "../types";
import { tempLabel } from "./format";

export function issueLink(issue: Issue): string {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#/i/${issue.id}`;
}

/** 서비스·카테고리 기본 태그 — 캡션 아래 12~15개를 채우는 뼈대. */
const BASE_TAGS = ["이슈온도계", "카드뉴스", "오늘의뉴스", "뉴스요약", "이슈", "인스타카드뉴스"];
const CATEGORY_TAGS: Record<Issue["category"], string[]> = {
  entertainment: ["연예뉴스", "스타", "연예가화제", "방송가"],
  society: ["사회뉴스", "사건사고", "세상돌아가는일", "공감"],
  culture: ["문화", "라이프", "요즘뜨는것", "일상"],
  tech: ["AI", "테크", "IT뉴스", "기술"],
  money: ["물가", "소비", "경제뉴스", "생활경제"],
  work: ["직장인공감", "커리어", "회사생활", "직장인"],
};
/** 태그가 모자랄 때 채우는 범용 태그 — 12개 아래로 떨어지지 않게. */
const FILLER_TAGS = ["핫이슈", "실시간이슈", "오늘의이슈", "뉴스스타그램", "정보공유", "토론", "여론", "데일리뉴스"];

/** 카테고리마다 반응이 붙는 이유가 다릅니다 — 관전 포인트 한 줄에 섞어 씁니다. */
const CATEGORY_ANGLE: Record<Issue["category"], string> = {
  entertainment: "연예 이슈는 첫 장 사진에서 판가름 나요.",
  society: "사회 이슈는 '내 얘기'로 읽혀야 댓글이 붙어요.",
  culture: "문화·라이프 이슈는 저장이 먼저 붙는 편이에요.",
  tech: "테크 이슈는 숫자 하나로 승부가 갈려요.",
  money: "내 지갑 얘기라 반응이 유난히 빨라요.",
  work: "직장 이슈는 댓글창이 카드보다 뜨거워요.",
};

function tidyTag(raw: string): string {
  return raw
    .replace(/^#+/, "")
    .replace(/[\s#.,"'“”‘’()[\]~!?·…]+/g, "")
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
 * 이 기사에만 통하는 키워드(AI가 고른 tags) → 카테고리 → 서비스 순으로 채우고,
 * 그래도 모자랄 때만 제목 낱말과 범용 태그를 보탭니다(제목 조각이 태그로 새는 걸 막습니다).
 */
export function hashtagList(issue: Issue): string[] {
  const primary = [...issue.tags, ...(CATEGORY_TAGS[issue.category] ?? []), ...BASE_TAGS];
  const extra = [...titleKeywords(issue.title).slice(0, 2), ...FILLER_TAGS];
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (tag: string) => {
    if (out.length >= 15) return;
    const clean = tidyTag(tag);
    if (clean.length < 2 || clean.length > 20) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  };
  primary.forEach(push);
  // 태그가 12개 아래로 떨어질 때만 제목·범용 태그로 채웁니다.
  if (out.length < 12) extra.forEach(push);
  else {
    for (const tag of FILLER_TAGS) {
      if (out.length >= 15) break;
      push(tag);
    }
  }
  return out.slice(0, 15);
}

/** 한 줄 요약을 캡션 길이에 맞게 다듬습니다. */
function clip(text: string, max: number): string {
  const value = (text ?? "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1).trim()}…` : value;
}

/** 문장이 마침표 없이 끝나면 캡션에서는 마침표를 붙여 호흡을 맞춥니다. */
function sentence(text: string, max: number): string {
  const value = clip(text, max);
  if (!value) return "";
  return /[.!?…]$/.test(value) ? value : `${value}.`;
}

/**
 * 🌡️ 관전 포인트 — 온도계 수치와 여론 결을 짚는 에디터 한 줄.
 * AI가 캡션용 문장을 줬으면 그것을 쓰고, 없으면 수치에서 만들어 냅니다(없는 수치는 만들지 않습니다).
 */
function viewpoint(issue: Issue): string {
  const ai = clip(issue.caption?.view ?? "", 90);
  if (ai) return sentence(ai, 90);

  const temp = issue.temp;
  if (temp !== null) {
    if (temp >= 85) return "끓는점 직전이에요. 댓글창이 카드보다 뜨거울 수 있어요.";
    if (temp >= 70) return "오늘 논란 상위권이에요. 아직 정리된 입장이 없어서 지금이 타이밍이에요.";
    if (temp >= 55) return "관심은 붙었는데 여론은 아직 반반이에요. 한 표가 눈에 보이는 구간이에요.";
    if (temp >= 40) return "미지근하게 오르는 중이에요. 먼저 정리해 올리면 이 이슈의 첫 카드가 됩니다.";
    return "아직 조용해요. 대신 지금 올리면 남들보다 하루 빠른 카드예요.";
  }
  if (issue.buzz !== undefined && issue.buzz > 0) {
    return `아직 기사 수가 적어 온도는 못 쟀어요(화제성 ${issue.buzz}점). 대신 먼저 올리면 선점이에요.`;
  }
  return CATEGORY_ANGLE[issue.category];
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
 *
 *  ① 후킹 1~2줄(훅 + 킥커) — 더보기 전에 보이는 구간
 *  ② 📌 무슨 일인데 — 팩트 3줄 / 🗞️ 왜 지금 떴나 — 배경
 *  ③ 🧐 갈리는 지점 — 두 진영 (없으면 핵심 쟁점)
 *  ④ 🌡️ 이슈온도계 — 온도·여론 결을 짚는 에디터 한 줄
 *  ⑤ 💬 Q/A/B + 댓글·저장·공유 CTA
 *  ⑥ 카드 링크 · @핸들 · 맞춤 해시태그 12~15개
 *
 * 크리에이터가 카드 문구를 고쳤다면 고친 문구(edited issue)를 그대로 받아 씁니다.
 * AI가 캡션용 문장(caption.hook/lead/view/ask)을 줬으면 도입·맥락·관전 포인트·질문에 먼저 씁니다.
 */
export function captionFor(issue: Issue, options: CaptionOptions = {}): string {
  const meta = CATEGORY_META[issue.category];
  const ai = issue.caption ?? {};
  const lines: string[] = [];

  // 첫 줄은 카드 표지의 헤드라인 그대로 — 카드와 캡션이 같은 말로 시작해야 넘겨 볼 이유가 생깁니다.
  const hook = clip(issue.hook, 110);
  // 카드 표지의 헤드라인을 첫 줄에 그대로 두고, 그 아래 한 줄은 AI가 다듬은 문장 → 킥커 순으로 씁니다.
  const second = clip(ai.hook || issue.kicker, 80);

  if (options.pro === false) {
    // Free — 후킹 2줄·맥락 한 줄·링크·기본 태그 5개까지만.
    lines.push(`🔥 ${hook}`);
    if (second) lines.push(second);
    lines.push("");
    const lead = sentence(ai.lead || issue.background || issue.facts[0] || "", 130);
    if (lead) {
      lines.push(lead);
      lines.push("");
    }
    lines.push(`${meta.label} · ${issue.source} · 이슈온도계`);
    lines.push("");
    lines.push(`카드 5장·투표 → ${issueLink(issue)}`);
    lines.push("");
    lines.push(FREE_CAPTION_TAGS.map((tag) => `#${tag}`).join(" "));
    return tidy(lines);
  }

  lines.push(`🔥 ${hook}`);
  if (second) lines.push(second);

  const facts = issue.facts.map((fact) => sentence(fact, 110)).filter(Boolean).slice(0, 3);
  if (facts.length > 0) {
    lines.push("");
    lines.push("📌 무슨 일인데");
    facts.forEach((fact, index) => lines.push(`${index + 1}. ${fact}`));
  }

  const background = sentence(ai.lead || issue.background, 150);
  if (background) {
    lines.push("");
    lines.push("🗞️ 왜 지금 떴나");
    lines.push(background);
  }

  if (issue.sides?.a && issue.sides?.b) {
    lines.push("");
    lines.push("🧐 갈리는 지점");
    lines.push(`· ${clip(issue.sides.labelA || "A", 14)} 쪽 — ${sentence(issue.sides.a, 90)}`);
    lines.push(`· ${clip(issue.sides.labelB || "B", 14)} 쪽 — ${sentence(issue.sides.b, 90)}`);
  } else if (issue.point) {
    lines.push("");
    lines.push("🧐 갈리는 지점");
    lines.push(`· ${sentence(issue.point, 100)}`);
  }

  const tempLine = issue.temp !== null ? `🌡️ 이슈온도계 ${issue.temp}° ${tempLabel(issue.temp)}` : "🌡️ 이슈온도계";
  lines.push("");
  lines.push(`${tempLine} — ${viewpoint(issue)}`);
  lines.push(`(${meta.label} · ${issue.source})`);

  lines.push("");
  lines.push(`💬 Q. ${clip(issue.poll.question, 60)}`);
  lines.push(`A. ${clip(issue.poll.a, 40)}`);
  lines.push(`B. ${clip(issue.poll.b, 40)}`);

  lines.push("");
  lines.push(ai.ask ? sentence(ai.ask, 90) : "여러분 선택은? 댓글로 A 아니면 B, 이유도 한 줄 부탁해요.");
  lines.push("🔖 저장해 두면 오늘 저녁 뉴스 볼 때 다시 꺼내 보기 좋아요.");
  lines.push("📤 친구 생각도 궁금하면 공유해 주세요.");
  lines.push("");
  lines.push(`📎 카드 5장·투표 → ${issueLink(issue)}`);
  if (options.handle) lines.push(options.handle);
  lines.push("");
  lines.push(hashtagList(issue).map((tag) => `#${tag}`).join(" "));

  return tidy(lines);
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
