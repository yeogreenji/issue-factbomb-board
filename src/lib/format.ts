export function formatNumber(value: number): string {
  return value.toLocaleString('ko-KR');
}

export function relativeTime(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return `${Math.floor(days / 7)}주 전`;
}

export function todayLabel(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  const week = ['일', '월', '화', '수', '목', '금', '토'][date.getDay()];
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} (${week})`;
}

export function clockLabel(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function weekRangeLabel(now = Date.now()): string {
  const end = new Date(now);
  const start = new Date(now - 6 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => `${d.getMonth() + 1}.${String(d.getDate()).padStart(2, '0')}`;
  return `${fmt(start)} – ${fmt(end)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

let counter = 0;
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

/** Splits text on **bold** markers for lightweight emphasis. */
export function splitEmphasis(text: string): { text: string; strong: boolean }[] {
  return text
    .split(/(\*\*[^*]+\*\*)/g)
    .filter((chunk) => chunk.length > 0)
    .map((chunk) =>
      chunk.startsWith('**') && chunk.endsWith('**')
        ? { text: chunk.slice(2, -2), strong: true }
        : { text: chunk, strong: false },
    );
}
