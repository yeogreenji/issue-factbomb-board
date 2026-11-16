/** 카드 공유 — 링크 복사·문자 공유. 서버에 아무것도 저장하지 않습니다. */

import type { Issue } from "../types";

export function issueLink(issue: Issue): string {
  const base = `${location.origin}${location.pathname}`;
  return `${base}#/i/${issue.id}`;
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
