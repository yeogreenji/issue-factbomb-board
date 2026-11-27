/**
 * 날짜별 카드 보관 — 하루가 지나면 사라지던 피드를 브라우저에 날짜로 남깁니다.
 *
 *  · 서버(/api/trending?date=)도 날짜별로 보관하지만, 저장소가 비어 있는 환경(메모리)에서는
 *    서버가 재시작하면 사라집니다. 그래서 이 기기에서 본 날짜의 피드는 브라우저에도 남겨,
 *    2~3일 못 들어와도 그 사이 카드를 다시 꺼내 올릴 수 있게 합니다.
 *  · 담는 것은 카드 문구·출처·링크뿐입니다(투표·댓글·개인정보 없음).
 *  · 날짜는 한국 시간 자정 기준입니다.
 */

import type { Issue } from "../types";

const DAY_STORE_KEY = "issue-thermo.days.v1";
/** 오늘 + 3일 전까지 — 2~3일 못 본 사이의 카드가 남아 있게. */
export const DAY_KEEP = 4;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export interface DaySnapshot {
  date: string;
  generatedAt: number;
  issues: Issue[];
}

/** 시각 → 한국 날짜 열쇠(YYYY-MM-DD). */
export function kstDayKey(timestamp: number = Date.now()): string {
  return new Date(timestamp + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 오늘부터 거슬러 올라가는 날짜 열쇠 목록(최신 먼저). */
export function recentDayKeys(keep = DAY_KEEP, now: number = Date.now()): string[] {
  return Array.from({ length: keep }, (_, index) => kstDayKey(now - index * 24 * 60 * 60 * 1000));
}

/** "11/27" — 칩에 쓰는 짧은 날짜. */
export function shortDate(date: string): string {
  const [, month, day] = date.split("-");
  if (!month || !day) return date;
  return `${Number(month)}/${Number(day)}`;
}

/** 오늘·어제·그제는 이름으로, 그 이전은 날짜로 부릅니다. */
export function dayName(date: string, today: string = kstDayKey()): string {
  const diff = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
  if (diff === 0) return "오늘";
  if (diff === 1) return "어제";
  if (diff === 2) return "그제";
  return shortDate(date);
}

/** 날짜 칩에 보이는 문구 — "오늘 (11/27)", 그 이전 날짜는 "11/24"처럼 날짜만. */
export function dayChipLabel(date: string, today: string = kstDayKey()): string {
  const name = dayName(date, today);
  const short = shortDate(date);
  return name === short ? short : `${name} (${short})`;
}

function isIssue(value: unknown): value is Issue {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.hook === "string" &&
    Array.isArray(row.facts) &&
    Boolean(row.poll && typeof row.poll === "object")
  );
}

function readStore(): Record<string, DaySnapshot> {
  try {
    const raw = localStorage.getItem(DAY_STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, DaySnapshot> = {};
    for (const [date, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      if (!value || typeof value !== "object") continue;
      const row = value as Record<string, unknown>;
      const issues = Array.isArray(row.issues) ? row.issues.filter(isIssue) : [];
      if (issues.length === 0) continue;
      out[date] = {
        date,
        generatedAt: typeof row.generatedAt === "number" ? row.generatedAt : Date.now(),
        issues,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, DaySnapshot>): void {
  // 최근 DAY_KEEP 날짜만 남기고 버립니다 — 오래된 날짜가 쌓여 저장 공간을 먹지 않게.
  const keep = new Set(recentDayKeys(DAY_KEEP));
  const kept: Record<string, DaySnapshot> = {};
  for (const [date, snapshot] of Object.entries(store)) {
    if (keep.has(date)) kept[date] = snapshot;
  }
  try {
    localStorage.setItem(DAY_STORE_KEY, JSON.stringify(kept));
  } catch {
    /* 저장 공간이 없으면 이번 방문에만 남습니다 */
  }
}

/** 이 기기에 남아 있는 날짜별 카드 묶음. */
export function loadDays(): Record<string, DaySnapshot> {
  return readStore();
}

/** 그 날짜의 카드 묶음(없으면 null). */
export function loadDay(date: string): DaySnapshot | null {
  return readStore()[date] ?? null;
}

/** 그 날짜 칸에 카드를 남깁니다 — 같은 날 여러 번 받으면 마지막 것을 씁니다. */
export function saveDay(date: string, issues: Issue[], generatedAt: number = Date.now()): DaySnapshot | null {
  const list = issues.filter(isIssue);
  if (list.length === 0) return null;
  const store = readStore();
  const previous = store[date];
  // 카드가 더 적게 들어온 응답(일부 실패)이 기존 보관분을 지우지 않게, 많은 쪽을 남깁니다.
  const snapshot: DaySnapshot =
    previous && previous.issues.length > list.length ? previous : { date, generatedAt, issues: list };
  store[date] = snapshot;
  writeStore(store);
  return snapshot;
}

/**
 * 기사 발행일로 날짜를 나눠 본 날짜 칸을 채웁니다.
 * (그날 사이트에 들어오지 않아 보관분이 없을 때의 마지막 대비책 — 지금 받은 피드에서 뽑습니다.)
 */
export function issuesByPublishedDay(issues: Issue[], date: string): Issue[] {
  return issues.filter((issue) => issue.publishedAt && kstDayKey(issue.publishedAt) === date);
}
