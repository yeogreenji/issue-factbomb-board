/** 카드 공유 — PNG 저장 · 인스타 캡션 복사 · 링크 공유. 서버에 아무것도 저장하지 않습니다. */

import { CATEGORY_META, type Issue } from "../types";

export function issueLink(issue: Issue): string {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#/i/${issue.id}`;
}

const BASE_TAGS = ["이슈온도계", "카드뉴스", "오늘의뉴스", "뉴스요약", "이슈", "MZ", "직장인"];
const CATEGORY_TAGS: Record<Issue["category"], string[]> = {
  work: ["직장인공감", "커리어"],
  mz: ["MZ세대", "트렌드"],
  money: ["물가", "소비"],
  tech: ["AI", "테크"],
  culture: ["연예", "문화"],
};

function hashtags(issue: Issue): string[] {
  const raw = [...BASE_TAGS, ...CATEGORY_TAGS[issue.category], ...issue.tags]
    .map((tag) => tag.replace(/^#/, "").replace(/\s+/g, ""))
    .filter((tag) => tag.length >= 2);
  return [...new Set(raw)].slice(0, 12);
}

/** 인스타그램에 그대로 붙여 넣는 캡션 — 훅 → 팩트 3줄 → 쟁점 → 투표 → 링크 → 해시태그. */
export function captionFor(issue: Issue): string {
  const meta = CATEGORY_META[issue.category];
  const lines: string[] = [];
  lines.push(`🔥 ${issue.hook}`);
  lines.push("");
  lines.push(`${meta.label} · ${issue.source}`);
  lines.push("");
  issue.facts.slice(0, 3).forEach((fact, index) => {
    lines.push(`${index + 1}. ${fact}`);
  });
  if (issue.point) {
    lines.push("");
    lines.push(`👉 ${issue.point}`);
  }
  lines.push("");
  lines.push(`Q. ${issue.poll.question}`);
  lines.push(`A. ${issue.poll.a}`);
  lines.push(`B. ${issue.poll.b}`);
  lines.push("");
  lines.push("여러분 선택은? 댓글로 A 아니면 B, 이유도 한 줄!");
  lines.push(`전체 카드와 원문 → ${issueLink(issue)}`);
  lines.push("");
  lines.push(hashtags(issue).map((tag) => `#${tag}`).join(" "));
  return lines.join("\n").slice(0, 2_100);
}

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
