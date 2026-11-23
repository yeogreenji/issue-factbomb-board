/** 카드 문구 편집 — AI가 만든 원문을 지우지 않고, 고친 부분만 덮어씁니다. */

import type { CardCopy, CardCopyEdits, Issue } from "../types";

/** 카드에 지금 인쇄되는 문구를 한 벌로 뽑습니다(편집실의 시작값). */
export function copyFromIssue(issue: Issue): CardCopy {
  const sides = issue.sides;
  return {
    hook: issue.hook,
    kicker: issue.kicker,
    facts: [issue.facts[0] ?? "", issue.facts[1] ?? "", issue.facts[2] ?? ""],
    background: issue.background,
    point: issue.point,
    labelA: sides?.labelA ?? "",
    labelB: sides?.labelB ?? "",
    sideA: sides?.a ?? "",
    sideB: sides?.b ?? "",
    question: issue.poll.question,
    optionA: issue.poll.a,
    optionB: issue.poll.b,
  };
}

function pick(value: string | undefined, fallback: string): string {
  if (value === undefined) return fallback;
  const trimmed = value.trim();
  // 빈 칸으로 지우면 카드에 구멍이 나므로, 비었을 때는 원문을 그대로 씁니다.
  return trimmed ? trimmed : fallback;
}

/** 편집값을 얹은 새 이슈. 화면·PNG·캡션이 모두 이 객체를 씁니다. */
export function applyCopy(issue: Issue, edits: CardCopyEdits | undefined): Issue {
  if (!edits || Object.keys(edits).length === 0) return issue;
  const base = copyFromIssue(issue);
  const facts = [0, 1, 2].map((index) => pick(edits.facts?.[index], base.facts[index]));

  return {
    ...issue,
    hook: pick(edits.hook, base.hook),
    kicker: pick(edits.kicker, base.kicker),
    facts,
    background: pick(edits.background, base.background),
    point: pick(edits.point, base.point),
    sides: {
      labelA: pick(edits.labelA, base.labelA),
      labelB: pick(edits.labelB, base.labelB),
      a: pick(edits.sideA, base.sideA),
      b: pick(edits.sideB, base.sideB),
    },
    poll: {
      question: pick(edits.question, base.question),
      a: pick(edits.optionA, base.optionA),
      b: pick(edits.optionB, base.optionB),
    },
  };
}

/** 원문과 다른 칸이 하나라도 있는지 — "편집됨" 배지에 씁니다. */
export function countEditValues(edits: CardCopyEdits | undefined): number {
  if (!edits) return 0;
  let changed = 0;
  for (const [key, value] of Object.entries(edits)) {
    if (key === "facts") {
      if (Array.isArray(value)) changed += value.filter((fact) => typeof fact === "string" && fact.trim()).length;
    } else if (typeof value === "string" && value.trim()) {
      changed += 1;
    }
  }
  return changed;
}

export function countEdits(issue: Issue, edits: CardCopyEdits | undefined): number {
  if (!edits) return 0;
  const base = copyFromIssue(issue);
  let changed = 0;
  for (const key of [
    "hook",
    "kicker",
    "background",
    "point",
    "labelA",
    "labelB",
    "sideA",
    "sideB",
    "question",
    "optionA",
    "optionB",
  ] as const) {
    const value = edits[key];
    if (typeof value === "string" && value.trim() && value.trim() !== (base[key] ?? "").trim()) changed += 1;
  }
  if (edits.facts) {
    edits.facts.forEach((fact, index) => {
      if (typeof fact === "string" && fact.trim() && fact.trim() !== (base.facts[index] ?? "").trim()) changed += 1;
    });
  }
  return changed;
}
