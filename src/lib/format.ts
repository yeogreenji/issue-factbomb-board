/** 화면에 쓰는 짧은 표기들 — 전부 사실만: 시간, 비율, 온도 구간. */

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function todayLabel(date = new Date()): string {
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${WEEKDAYS[date.getDay()]}요일`;
}

export function clockLabel(date = new Date()): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function timeAgo(timestamp: number): string {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  if (diff < 0) return "방금";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export function percentOf(counts: { a: number; b: number }, choice: "a" | "b"): number {
  const total = counts.a + counts.b;
  if (total === 0) return 0;
  return Math.round((counts[choice] / total) * 100);
}

export function countLabel(value: number): string {
  if (value >= 10_000) return `${(value / 10_000).toFixed(1).replace(/\.0$/, "")}만`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}천`;
  return String(value);
}

export function tempLabel(temp: number | null): string {
  if (temp === null || Number.isNaN(temp)) return "온도 미측정";
  if (temp >= 80) return "과열";
  if (temp >= 60) return "뜨거움";
  if (temp >= 40) return "미지근";
  return "차분";
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
