/**
 * 카드뉴스 PNG 만들기 — 인스타그램 4:5(1080×1350) 규격 5장을 캔버스에 직접 그립니다.
 *
 * 화면 미리보기도 **이 캔버스로 그린 결과 그대로**를 보여 줍니다(별도 DOM 조판 없음).
 * 그래서 "보는 카드"와 "저장되는 PNG"가 100% 같은 파일입니다 — 저장은 렌더된 blob을 그대로 내려받습니다.
 *
 * v10 설계 — 색면·도형만 채우던 PPT식 카드를 없애고, **다섯 장 모두 실제 사진 위에 활자를 얹는
 * 인스타 매거진 채널(디에디트·캐릿·인사이트) 구성**으로 다시 짰습니다.
 *
 *  ① 표지   — 기사 사진 전체 + 굵은 헤드라인. 판 5종(포토 헤드라인·한마디·숫자·포토 스트립·속보)
 *  ② 무슨 일인데 — 사진 띠 위에 헤드라인, 아래에 번호 붙은 팩트 3줄(숫자는 강조색)
 *  ③ 왜 지금 뜨나 — 사진 전체 위에 큰 인용/배경, 아래 지면에 '핵심 쟁점' 바
 *  ④ 어디서 갈렸나 — 사진 띠 + 종이 지면을 세로 괘선으로 갈라 A/B 두 진영(색 블록 없음)
 *  ⑤ 당신의 선택 — 사진 위 질문, 아래 지면에 A/B 선택지와 댓글 유도 바
 *
 * 사진은 ① 기사 대표 사진 → ② 기사 본문 사진 → ③ 분야별 실사 사진 풀(public/photos) 순으로
 * 반드시 한 장 이상 깔립니다. 단색 배경으로 때우는 폴백은 없습니다.
 *
 * 색은 테마(lib/theme.ts)에서 역할별로 가져옵니다 — 에디토리얼 다크·모던 화이트·브레이킹 레드·트렌디 파스텔.
 * 크리에이터가 고친 문구(lib/copy.ts)와 워터마크 핸들이 그대로 PNG에 박힙니다.
 */

import { CATEGORY_META, type Category, type Issue } from "../types";
import { timeAgo } from "./format";
import { buildZip } from "./zip";
import { proxiedImage } from "./api";
import { headlineStat, layoutOf, quoteOf, type CardLayout } from "./layout";
import {
  CARD_THEMES,
  DEFAULT_THEME,
  alpha,
  hexWith,
  paletteOf,
  type CardPalette,
  type CardThemeId,
} from "./theme";

export const CARD_W = 1080;
export const CARD_H = 1350;
export const SLIDE_COUNT = 5;

/** 바깥 여백 — 잡지 지면처럼 넉넉하게. */
const M = 76;
const SANS = '"Pretendard Variable", Pretendard, "SUIT Variable", SUIT, sans-serif';
/** 사진 위 글자는 테마와 상관없이 밝은 잉크를 씁니다(어두운 사진 위 검정 글자를 막습니다). */
const ON_PHOTO = "#fffdf8";
const ON_PHOTO_DIM = "rgba(255,253,248,0.78)";
const ON_PHOTO_FAINT = "rgba(255,253,248,0.56)";

type Ctx = CanvasRenderingContext2D;

/**
 * 지금 그리고 있는 테마와 워터마크.
 * 그리는 함수들은 전부 동기(await 없음)라, renderSlide가 시작 직전에 바꿔 두면
 * 한 장이 그려지는 동안 다른 테마로 바뀌지 않습니다.
 */
let P: CardPalette = CARD_THEMES[DEFAULT_THEME];
let HANDLE = "";
/** 이 카드에 쓸 사진들 — renderSlide가 미리 받아 둡니다. */
let PLATES: Plate[] = [];

export interface RenderOptions {
  theme?: CardThemeId | string;
  /** 카드마다 박히는 워터마크(@my_channel). 비우면 서비스 이름. */
  handle?: string;
  /** 표지 판(레이아웃) — 지정하지 않으면 이슈 성격으로 고릅니다. */
  layout?: CardLayout;
}

function useOptions(options: RenderOptions = {}): void {
  P = paletteOf(options.theme);
  HANDLE = (options.handle ?? "").trim().slice(0, 24);
}

function brandName(): string {
  return HANDLE || "이슈온도계";
}

function isLight(hex: string): boolean {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const num = Number.parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(num)) return false;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

/** 사진 위 강조색 — 테마 강조색이 어두우면(모던 화이트의 검정) 밝은 잉크로 대체합니다. */
function photoAccent(): string {
  return isLight(P.accent) ? P.accent : ON_PHOTO;
}

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

/* ---------------------------------------------------------------- helpers */

function setFont(ctx: Ctx, weight: number, size: number, family = SANS): void {
  ctx.font = `${weight} ${size}px ${family}`;
}

/** 자간 — 마이크로 라벨을 잡지처럼 벌려 씁니다. 지원하지 않는 브라우저에서는 그냥 붙습니다. */
function setTracking(ctx: Ctx, px: number): void {
  try {
    (ctx as Ctx & { letterSpacing?: string }).letterSpacing = `${px}px`;
  } catch {
    /* letterSpacing 미지원 — 무시 */
  }
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function fillRect(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** 한글은 띄어쓰기 단위로, 한 단어가 폭을 넘으면 글자 단위로 잘라 줄바꿈합니다(자르지 않고 전부). */
function wrapWords(ctx: Ctx, text: string, maxWidth: number): string[] {
  const value = text.replace(/\s+/g, " ").trim();
  if (!value) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) {
      lines.push(line);
      line = "";
    }
    if (ctx.measureText(word).width <= maxWidth) {
      line = word;
      continue;
    }
    let chunk = "";
    for (const char of word) {
      if (chunk && ctx.measureText(chunk + char).width > maxWidth) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

function clipLines(ctx: Ctx, lines: string[], maxLines: number, maxWidth: number): { lines: string[]; clipped: boolean } {
  if (lines.length <= maxLines) return { lines, clipped: false };
  const kept = lines.slice(0, Math.max(1, maxLines));
  let last = kept[kept.length - 1];
  while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
  kept[kept.length - 1] = `${last.trim()}…`;
  return { lines: kept, clipped: true };
}

interface Fit {
  size: number;
  lines: string[];
  lineHeight: number;
  height: number;
  clipped: boolean;
}

/**
 * 정해진 영역 안에 들어오는 가장 큰 글자 크기를 찾습니다.
 * 영역을 넘으면 한 단계씩 줄이고, 최소 크기에서도 넘칠 때만 말줄임합니다 —
 * 그래서 아래·위 블록과 글자가 겹치는 일이 생기지 않습니다.
 */
function fitRegion(
  ctx: Ctx,
  text: string,
  options: {
    w: number;
    h: number;
    max: number;
    min: number;
    weight?: number;
    lineFactor?: number;
    maxLines?: number;
    family?: string;
  },
): Fit {
  const weight = options.weight ?? 900;
  const lf = options.lineFactor ?? 1.12;
  const family = options.family ?? SANS;
  const value = text.replace(/\s+/g, " ").trim();
  if (!value) return { size: options.min, lines: [], lineHeight: options.min * lf, height: 0, clipped: false };

  let fallback: Fit | null = null;
  for (let size = Math.round(options.max); size >= options.min; size -= 2) {
    setFont(ctx, weight, size, family);
    const lineHeight = Math.round(size * lf);
    const maxLines = Math.min(options.maxLines ?? 99, Math.max(1, Math.floor(options.h / lineHeight)));
    const clipped = clipLines(ctx, wrapWords(ctx, value, options.w), maxLines, options.w);
    const fit: Fit = {
      size,
      lines: clipped.lines,
      lineHeight,
      height: clipped.lines.length * lineHeight,
      clipped: clipped.clipped,
    };
    if (!clipped.clipped) return fit;
    if (!fallback) fallback = fit;
  }
  setFont(ctx, weight, options.min, family);
  const lineHeight = Math.round(options.min * lf);
  const maxLines = Math.min(options.maxLines ?? 99, Math.max(1, Math.floor(options.h / lineHeight)));
  const clipped = clipLines(ctx, wrapWords(ctx, value, options.w), maxLines, options.w);
  return {
    size: options.min,
    lines: clipped.lines,
    lineHeight,
    height: clipped.lines.length * lineHeight,
    clipped: true,
  };
}

function drawLines(ctx: Ctx, lines: string[], x: number, y: number, lineHeight: number): number {
  let cursor = y;
  for (const line of lines) {
    ctx.fillText(line, x, cursor);
    cursor += lineHeight;
  }
  return cursor;
}

/* ---------------------------------------------- 숫자 하이라이트 (형광펜) */

interface Seg {
  text: string;
  hot: boolean;
}

/** "1년 새 12% 올랐다" → 숫자 덩어리만 hot으로 잘라 카드에서 강조합니다. */
export function splitSegments(text: string): Seg[] {
  const parts = text.split(/(\d[\d,.]*\s*(?:%|퍼센트|배|만\s*원|억\s*원|조\s*원|원|만|억|조|명|개|년|개월|시간|분|위|대|포인트|%p)?)/g);
  const out: Seg[] = [];
  for (const part of parts) {
    if (!part) continue;
    const hot = /^\d/.test(part) && /\d/.test(part);
    const last = out[out.length - 1];
    if (last && last.hot === hot) last.text += part;
    else out.push({ text: part, hot });
  }
  return out;
}

/**
 * 줄바꿈은 fitRegion이 정한 그대로 두고, 각 줄 안의 숫자만 강조색으로 칠합니다.
 * (사진 위에서는 marker를 쓰지 않습니다 — 사진이 가려지니까요.)
 */
function drawEmphasisLines(
  ctx: Ctx,
  lines: string[],
  x: number,
  y: number,
  size: number,
  lineHeight: number,
  options: { color: string; hot: string; weight?: number; marker?: string; markerInk?: string },
): void {
  setFont(ctx, options.weight ?? 900, size);
  let cursor = y;
  for (const line of lines) {
    let px = x;
    for (const seg of splitSegments(line)) {
      const width = ctx.measureText(seg.text).width;
      if (seg.hot && options.marker) {
        ctx.fillStyle = options.marker;
        roundRect(ctx, px - 5, cursor + size * 0.1, width + 10, size * 0.94, 7);
        ctx.fill();
        ctx.fillStyle = options.markerInk ?? P.onAccent;
      } else {
        ctx.fillStyle = seg.hot ? options.hot : options.color;
      }
      ctx.fillText(seg.text, px, cursor);
      px += width;
    }
    cursor += lineHeight;
  }
}

/* ------------------------------------------------------------- 사진 */

export interface Plate {
  img: HTMLImageElement;
  src: string;
  /** 기사 사진이 아니라 분야별 실사 사진 풀에서 온 '자료사진'. */
  stock: boolean;
}

/** 분야별 실사 사진 풀 — 기사에 사진이 없거나 사진 서버가 막아도 카드가 색면이 되지 않게. */
const PHOTO_POOL: Record<Category, string[]> = {
  entertainment: ["ent-1", "ent-2", "ent-3"],
  society: ["soc-1", "soc-2", "soc-3"],
  culture: ["cul-1", "cul-2", "cul-3"],
  tech: ["tec-1", "tec-2", "tec-3"],
  money: ["mon-1", "mon-2", "mon-3"],
  work: ["wrk-1", "wrk-2", "wrk-3"],
};

const BASE = (import.meta.env?.BASE_URL as string | undefined) || "/";

function poolSrc(category: Category, seed: string, offset: number): string {
  const list = PHOTO_POOL[category] ?? PHOTO_POOL.society;
  const pick = (hash(`${seed}:${offset}`) + offset) % list.length;
  return `${BASE}photos/${list[pick]}.jpg`;
}

function isStockSrc(src: string): boolean {
  return src.includes("/photos/");
}

/** 분야별 실사 사진 풀에서 한 장 — 기사 사진이 없을 때 카드·썸네일이 빈 칸이 되지 않게. */
export function fallbackPhoto(issue: Issue, offset = 0): string {
  return poolSrc(issue.category, issue.id || issue.title, offset);
}

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

function loadOne(src: string, crossOrigin: boolean): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = "anonymous";
    img.referrerPolicy = "no-referrer";
    img.decoding = "async";
    const timer = setTimeout(() => resolve(null), 9_000);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img.naturalWidth > 0 ? img : null);
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    img.src = src;
  });
}

/**
 * 기사 사진을 캔버스에 그릴 수 있는 형태로 가져옵니다.
 * ① 원본 직접(CORS 허용 시) → ② 같은 출처 프록시(/api/img) → ③ 없음.
 * 프록시를 거치지 않으면 언론사 서버가 CORS 헤더를 안 줄 때 캔버스가 오염돼 PNG 저장이 막힙니다.
 */
export function loadIssueImage(src: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  const cached = imageCache.get(src);
  if (cached) return cached;
  const task = (async () => {
    const viaProxy = await loadOne(proxiedImage(src), true);
    if (viaProxy) return viaProxy;
    return loadOne(src, true);
  })();
  imageCache.set(src, task);
  return task;
}

/** 카드 한 장마다 사진 후보를 다시 받아 오지 않도록, 이슈 단위로 결과를 기억합니다. */
const platesCache = new Map<string, Promise<Plate[]>>();

function resolvePlates(issue: Issue): Promise<Plate[]> {
  const key = `${issue.id}|${issue.image}|${(issue.images ?? []).join(",")}|${issue.category}`;
  const cached = platesCache.get(key);
  if (cached) return cached;
  const task = loadPlates(issue);
  platesCache.set(key, task);
  if (platesCache.size > 48) {
    const first = platesCache.keys().next().value;
    if (first) platesCache.delete(first);
  }
  return task;
}

/** 이 카드에 쓸 사진 — 기사 사진(대표·본문)이 있으면 그것만, 없을 때만 분야별 실사 사진으로 채웁니다. */
async function loadPlates(issue: Issue): Promise<Plate[]> {
  const sources: string[] = [];
  for (const src of [...(issue.images ?? []), issue.image]) {
    if (src && !sources.includes(src)) sources.push(src);
  }

  const plates: Plate[] = [];
  const loaded = await Promise.all(sources.slice(0, 3).map((src) => loadIssueImage(src)));
  loaded.forEach((img, index) => {
    // 기자 프로필 같은 작은 사진은 카드에 깔지 않습니다(원본이 320px보다 작으면 확대해도 못 씁니다).
    if (!img || img.naturalWidth < 320 || plates.length >= 2) return;
    const src = sources[index];
    plates.push({ img, src, stock: isStockSrc(src) });
  });
  // 기사 사진이 한 장이라도 있으면 그것만 씁니다 — 관계없는 자료사진으로 카드를 채우지 않습니다.
  if (plates.length > 0) return plates;

  for (let offset = 0; offset < 3 && plates.length < 3; offset += 1) {
    const src = poolSrc(issue.category, issue.id || issue.title, offset);
    if (plates.some((plate) => plate.src === src)) continue;
    const img = await loadOne(src, true);
    if (img) plates.push({ img, src, stock: true });
  }
  return plates;
}

function plateFor(index: number): Plate | null {
  if (PLATES.length === 0) return null;
  if (index < PLATES.length) return PLATES[index];
  return PLATES[0];
}
function coverRect(img: HTMLImageElement, w: number, h: number, focusY = 0.42) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.max(w / iw, h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  return { x: (w - dw) / 2, y: (h - dh) * focusY, w: dw, h: dh };
}

function drawPhoto(
  ctx: Ctx,
  img: HTMLImageElement | null,
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 0,
  focusY = 0.42,
): void {
  if (!img) return;
  ctx.save();
  if (radius > 0) {
    roundRect(ctx, x, y, w, h, radius);
    ctx.clip();
  } else {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
  }
  const rect = coverRect(img, w, h, focusY);
  ctx.drawImage(img, x + rect.x, y + rect.y, rect.w, rect.h);
  ctx.restore();
}

/** 테마별 사진 위 색 — 네 테마가 같은 사진을 써도 다른 잡지처럼 보이게. */
function tintPhoto(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  const color =
    P.id === "breaking"
      ? "rgba(140,10,8,0.30)"
      : P.id === "pastel"
        ? "rgba(255,186,206,0.20)"
        : P.id === "modern"
          ? "rgba(246,243,236,0.06)"
          : "rgba(10,10,12,0.10)";
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** 모던·파스텔은 사진을 종이 액자 안에 넣습니다 — 표지 색이 테마마다 확실히 달라집니다. */
function frameInset(): number {
  if (P.id === "modern") return 44;
  if (P.id === "pastel") return 28;
  return 0;
}

/** 화면 밖에 작은 캔버스로 줄여 그린 뒤 크게 늘려 그리는 방식 — 어느 브라우저에서나 부드러운 배경 흐림이 됩니다. */
function drawBlurFill(ctx: Ctx, img: HTMLImageElement, x: number, y: number, w: number, h: number): void {
  const sw = 64;
  const sh = Math.max(1, Math.round((sw * h) / w));
  const small = document.createElement("canvas");
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext("2d");
  if (!sctx) return;
  const rect = coverRect(img, sw, sh, 0.4);
  sctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(small, 0, 0, sw, sh, x, y, w, h);
  ctx.restore();
}

/**
 * 언론사 사진은 대부분 가로로 작습니다(800×450 정도). 그대로 4:5로 늘리면 3배 확대돼 뿌옇습니다.
 * 그래서 작은 가로 사진은 "사진 창"으로 그립니다 — 카드 전체는 같은 사진을 크게 흐린 배경으로 깔고,
 * 가운데에 원본 비율 그대로의 선명한 사진 띠를 놓습니다. 사진이 선명하고, 빈 색면도 생기지 않습니다.
 */
function needsPhotoWindow(img: HTMLImageElement): boolean {
  const w = img.naturalWidth || 1;
  const h = img.naturalHeight || 1;
  return w < 860 && w / h > 1.06;
}

/** 카드 전체를 사진으로 채우는 판(표지·인용 카드) — 필요하면 선명한 사진 창을 함께 그립니다. */
function drawFullPlate(ctx: Ctx, plate: Plate | null, focusY = 0.34): void {
  fillRect(ctx, 0, 0, CARD_W, CARD_H, P.paper);
  if (!plate) {
    const glow = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
    glow.addColorStop(0, hexWith(P.accent, P.id === "modern" || P.id === "pastel" ? "40" : "22"));
    glow.addColorStop(1, hexWith(P.solid, "00"));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, CARD_W, CARD_H);
    return;
  }
  const img = plate.img;
  if (!needsPhotoWindow(img)) {
    drawPhoto(ctx, img, 0, 0, CARD_W, CARD_H, 0, focusY);
    tintPhoto(ctx, 0, 0, CARD_W, CARD_H);
    return;
  }

  drawBlurFill(ctx, img, 0, 0, CARD_W, CARD_H);
  ctx.fillStyle = P.id === "modern" || P.id === "pastel" ? "rgba(246,243,236,0.2)" : "rgba(8,8,10,0.46)";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  tintPhoto(ctx, 0, 0, CARD_W, CARD_H);

  const aspect = img.naturalWidth / img.naturalHeight;
  const bandH = Math.min(790, Math.round(CARD_W / aspect));
  const top = Math.round((CARD_H - bandH) * Math.min(0.44, Math.max(0.24, focusY)));
  drawPhoto(ctx, img, 0, top, CARD_W, bandH, 0, 0.5);
  ctx.fillStyle = alpha(ON_PHOTO, 0.22);
  ctx.fillRect(0, top, CARD_W, 1);
  ctx.fillRect(0, top + bandH - 1, CARD_W, 1);
}

function bottomScrim(ctx: Ctx, from: number, strength = 0.97): void {
  const grad = ctx.createLinearGradient(0, from, 0, CARD_H);
  grad.addColorStop(0, `rgba(${P.scrim},0)`);
  grad.addColorStop(0.42, `rgba(${P.scrim},${strength * 0.6})`);
  grad.addColorStop(0.75, `rgba(${P.scrim},${strength * 0.92})`);
  grad.addColorStop(1, `rgba(${P.scrim},${strength})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, from, CARD_W, CARD_H - from);
}

function bandFade(ctx: Ctx, from: number, height: number, to = P.paper): void {
  const grad = ctx.createLinearGradient(0, from, 0, from + height);
  grad.addColorStop(0, hexWith(to, "00"));
  grad.addColorStop(1, to);
  ctx.fillStyle = grad;
  ctx.fillRect(0, from, CARD_W, height);
}

function topScrim(ctx: Ctx, height = 300): void {
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, `rgba(${P.scrim},0.82)`);
  grad.addColorStop(1, `rgba(${P.scrim},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CARD_W, height);
}

function photoShadow(ctx: Ctx, on: boolean): void {
  if (!on) {
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    return;
  }
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 3;
}

/* ------------------------------------------------------------- 공통 표식 */

function brandDot(ctx: Ctx, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 7, 0, Math.PI * 2);
  ctx.fill();
}

function brandTop(ctx: Ctx, color = ON_PHOTO): void {
  brandDot(ctx, M + 8, 92, photoAccent());
  setFont(ctx, 800, 27);
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(brandName(), M + 28, 93);
  ctx.textBaseline = "top";
}

/** 분야 라벨 — 작은 사각 점 + 자간 넓은 라벨. 테마 색으로 잡지 지면처럼. */
function categoryMark(ctx: Ctx, issue: Issue, y: number, color: string, size = 24): void {
  const meta = CATEGORY_META[issue.category];
  ctx.fillStyle = meta.color;
  ctx.fillRect(M, y + 2, 10, size - 4);
  setFont(ctx, 800, size);
  setTracking(ctx, 2.4);
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(meta.label, M + 22, y);
  setTracking(ctx, 0);
}

/** 온도·화제성 — 알약 대신 숫자와 작은 화살표로. */
function heatMark(ctx: Ctx, issue: Issue, y: number, color: string): void {
  const score = issue.temp ?? issue.buzz ?? 0;
  const label = issue.temp !== null ? `논란 ${score}°` : `화제 ${score}`;
  setFont(ctx, 900, 26);
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillStyle = color;
  ctx.fillText(label, CARD_W - M, y);
  const width = ctx.measureText(label).width;
  ctx.fillStyle = alpha(photoAccent(), 0.5);
  ctx.fillRect(CARD_W - M - width, y + 34, width, 2);
  ctx.textAlign = "left";
}

function footer(ctx: Ctx, index: number, mode: "photo" | "paper", note?: string): void {
  const ink = mode === "photo" ? ON_PHOTO_FAINT : alpha(P.fg, 0.5);
  setFont(ctx, 700, 22);
  ctx.fillStyle = ink;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  setTracking(ctx, 0.6);
  ctx.fillText(note ? `${brandName()} · ${note}` : brandName(), M, CARD_H - 58);
  setTracking(ctx, 0);
  ctx.textAlign = "right";
  ctx.fillText(`${index + 1} / ${SLIDE_COUNT}`, CARD_W - M, CARD_H - 58);
  ctx.textAlign = "left";
}

function sourceLine(ctx: Ctx, issue: Issue, plate: Plate | null, y: number, color: string): void {
  const credit = plate?.stock ? " · 자료사진" : "";
  setFont(ctx, 700, 25);
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`${issue.source} · ${timeAgo(issue.publishedAt)}${credit}`, M, y);
  ctx.textAlign = "left";
}

function swipe(ctx: Ctx, text: string, y: number, color: string): void {
  setFont(ctx, 800, 25);
  ctx.fillStyle = color;
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText(text, CARD_W - M, y);
  ctx.textAlign = "left";
}

function stepLabel(ctx: Ctx, text: string, y: number, color: string): void {
  setFont(ctx, 800, 23);
  setTracking(ctx, 2.6);
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(text, M, y);
  setTracking(ctx, 0);
}

/* ------------------------------------------------------------------ covers */

/** 사진 띠(표지 아래지면·내지)·스트립처럼 일부 영역만 사진으로 채우는 판. */
function drawBand(ctx: Ctx, plate: Plate | null, x: number, y: number, w: number, h: number, focusY = 0.42): void {
  fillRect(ctx, x, y, w, h, P.paper);
  if (!plate) {
    const glow = ctx.createLinearGradient(x, y, x + w, y + h);
    glow.addColorStop(0, hexWith(P.accent, P.id === "modern" || P.id === "pastel" ? "40" : "22"));
    glow.addColorStop(1, hexWith(P.solid, "00"));
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, w, h);
    return;
  }
  drawPhoto(ctx, plate.img, x, y, w, h, 0, focusY);
  tintPhoto(ctx, x, y, w, h);
}

function coverBase(ctx: Ctx, plate: Plate | null, focusY: number): number {
  const inset = frameInset();
  fillRect(ctx, 0, 0, CARD_W, CARD_H, P.paper);
  if (inset > 0) {
    drawBand(ctx, plate, inset, inset, CARD_W - inset * 2, CARD_H - inset * 2, focusY);
  } else {
    drawFullPlate(ctx, plate, focusY);
  }
  return inset;
}

/** ① 포토 헤드라인 — 사진 전체 + 아래에서 올라오는 굵은 제목. */
function drawCoverOverlay(ctx: Ctx, issue: Issue, plate: Plate | null): void {
  coverBase(ctx, plate, 0.34);
  topScrim(ctx, 300);
  bottomScrim(ctx, 520, 0.99);

  brandTop(ctx);
  categoryMark(ctx, issue, 150, ON_PHOTO_DIM);
  heatMark(ctx, issue, 152, photoAccent());

  const sourceY = CARD_H - 106;
  const ruleY = CARD_H - 148;
  const kickerFit = fitRegion(ctx, issue.kicker, {
    w: CARD_W - M * 2,
    h: 106,
    max: 31,
    min: 23,
    weight: 700,
    lineFactor: 1.42,
    maxLines: 2,
  });
  const kickerTop = ruleY - 22 - kickerFit.height;
  const headBottom = kickerTop - 42;
  const headTop = 318;
  const headFit = fitRegion(ctx, issue.hook, {
    w: CARD_W - M * 2,
    h: Math.max(220, headBottom - headTop),
    max: 102,
    min: 56,
    weight: 900,
    lineFactor: 1.08,
    maxLines: 4,
  });
  const headY = headBottom - headFit.height;

  fillRect(ctx, M, ruleY, 118, 8, photoAccent());
  photoShadow(ctx, true);
  drawEmphasisLines(ctx, headFit.lines, M, headY, headFit.size, headFit.lineHeight, {
    color: ON_PHOTO,
    hot: photoAccent(),
  });
  photoShadow(ctx, false);

  setFont(ctx, 700, kickerFit.size);
  ctx.fillStyle = ON_PHOTO_DIM;
  drawLines(ctx, kickerFit.lines, M, kickerTop, kickerFit.lineHeight);

  sourceLine(ctx, issue, plate, sourceY, ON_PHOTO_FAINT);
  swipe(ctx, "밀어서 팩트 3줄 →", sourceY, photoAccent());
  footer(ctx, 0, "photo");
}

/** ② 한마디 — 기사에 실제로 있던 인용을 주인공으로. */
function drawCoverQuote(ctx: Ctx, issue: Issue, plate: Plate | null): void {
  coverBase(ctx, plate, 0.3);
  ctx.fillStyle = "rgba(8,8,10,0.46)";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  topScrim(ctx, 260);
  bottomScrim(ctx, 820, 0.94);

  brandTop(ctx);
  categoryMark(ctx, issue, 150, ON_PHOTO_DIM);
  heatMark(ctx, issue, 152, photoAccent());

  const quote = quoteOf(issue) || issue.kicker || issue.hook;
  const quoteFit = fitRegion(ctx, quote, {
    w: CARD_W - M * 2,
    h: 380,
    max: 92,
    min: 52,
    weight: 900,
    lineFactor: 1.22,
    maxLines: 4,
  });
  const sub = issue.hook !== quote ? issue.hook : issue.kicker;
  const subFit = fitRegion(ctx, sub, {
    w: CARD_W - M * 2,
    h: 108,
    max: 42,
    min: 28,
    weight: 700,
    lineFactor: 1.38,
    maxLines: 2,
  });

  // 인용·선·부제를 한 덩어리로 보고 지면 가운데에 놓습니다 — 위에만 몰리고 아래가 비지 않게.
  const blockH = 40 + quoteFit.height + 44 + 10 + 40 + subFit.height;
  const areaTop = 300;
  const areaBottom = CARD_H - 150;
  const top = areaTop + Math.max(0, (areaBottom - areaTop - blockH) / 2);

  fillRect(ctx, M, top, 62, 10, photoAccent());
  fillRect(ctx, M, top + 22, 62, 10, photoAccent());

  const quoteTop = top + 40;
  setFont(ctx, 900, quoteFit.size);
  ctx.fillStyle = ON_PHOTO;
  photoShadow(ctx, true);
  drawLines(ctx, quoteFit.lines, M, quoteTop, quoteFit.lineHeight);
  photoShadow(ctx, false);

  const ruleY = quoteTop + quoteFit.height + 40;
  fillRect(ctx, M, ruleY, 148, 8, photoAccent());

  setFont(ctx, 700, subFit.size);
  ctx.fillStyle = ON_PHOTO;
  photoShadow(ctx, true);
  drawLines(ctx, subFit.lines, M, ruleY + 40, subFit.lineHeight);
  photoShadow(ctx, false);

  const sourceY = CARD_H - 106;
  sourceLine(ctx, issue, plate, sourceY, ON_PHOTO_FAINT);
  swipe(ctx, "넘겨서 팩트 3줄 →", sourceY, photoAccent());
  footer(ctx, 0, "photo");
}

/** ③ 숫자 — 사진 띠 + 아래 지면에 기사 속 숫자 하나를 거대하게. 칸을 고정해 글자가 겹치지 않습니다. */
function drawCoverStat(ctx: Ctx, issue: Issue, plate: Plate | null): void {
  const bandH = 560;
  fillRect(ctx, 0, 0, CARD_W, CARD_H, P.paper);
  drawBand(ctx, plate, 0, 0, CARD_W, bandH, 0.32);
  topScrim(ctx, 280);
  bottomScrim(ctx, bandH - 260, 0.86);
  bandFade(ctx, bandH - 120, 120, P.paper);

  brandTop(ctx);
  categoryMark(ctx, issue, 150, ON_PHOTO_DIM);
  heatMark(ctx, issue, 152, photoAccent());

  // 사진 위에는 이 카드가 무엇을 보는지 한 줄만.
  stepLabel(ctx, "숫자로 보기", bandH - 78, ON_PHOTO_DIM);

  fillRect(ctx, 0, bandH, CARD_W, 6, P.accentText);

  const stat = headlineStat(issue);
  if (stat) {
    let valueSize = 206;
    setFont(ctx, 900, valueSize);
    while (valueSize > 110 && ctx.measureText(stat.value).width + 150 > CARD_W - M * 2) {
      valueSize -= 10;
      setFont(ctx, 900, valueSize);
    }
    const valueWidth = ctx.measureText(stat.value).width;
    const top = bandH + 84;
    ctx.fillStyle = P.accentText;
    ctx.textBaseline = "top";
    ctx.fillText(stat.value, M, top);
    setFont(ctx, 900, Math.round(valueSize * 0.36));
    ctx.fillText(stat.unit, M + valueWidth + 14, top + Math.round(valueSize * 0.5));
  } else {
    setFont(ctx, 900, 74);
    ctx.fillStyle = alpha(P.fg, 0.3);
    ctx.fillText("오늘의 숫자", M, bandH + 96);
  }

  // 제목은 숫자 아래 지면에 — 사진 위 헤드라인과 겹치지 않습니다.
  const headFit = fitRegion(ctx, issue.hook, {
    w: CARD_W - M * 2,
    h: 130,
    max: 52,
    min: 34,
    weight: 900,
    lineFactor: 1.18,
    maxLines: 2,
  });
  drawEmphasisLines(ctx, headFit.lines, M, 900, headFit.size, headFit.lineHeight, {
    color: P.fg,
    hot: P.accentText,
  });

  const context = issue.point || issue.kicker;
  const contextFit = fitRegion(ctx, context, {
    w: CARD_W - M * 2,
    h: 96,
    max: 34,
    min: 24,
    weight: 700,
    lineFactor: 1.38,
    maxLines: 2,
  });
  setFont(ctx, 700, contextFit.size);
  ctx.fillStyle = alpha(P.fg, 0.62);
  drawLines(ctx, contextFit.lines, M, 1052, contextFit.lineHeight);

  sourceLine(ctx, issue, plate, CARD_H - 106, alpha(P.fg, 0.5));
  swipe(ctx, "전체 팩트 →", CARD_H - 106, P.accentText);
  footer(ctx, 0, "paper");
}

/** ④ 포토 스트립 — 사진을 왼쪽에 세로로 세우고 오른쪽 지면에 활자를 쌓는 잡지 표지. */
function drawCoverStrip(ctx: Ctx, issue: Issue, plate: Plate | null): void {
  fillRect(ctx, 0, 0, CARD_W, CARD_H, P.paper);
  const stripW = 448;
  drawBand(ctx, plate, 0, 0, stripW, CARD_H, 0.36);
  // 사진 오른쪽 끝을 지면과 붙입니다.
  const edge = ctx.createLinearGradient(stripW - 90, 0, stripW, 0);
  edge.addColorStop(0, `rgba(${P.scrim},0)`);
  edge.addColorStop(1, hexWith(P.paper, "ee"));
  ctx.fillStyle = edge;
  ctx.fillRect(stripW - 90, 0, 90, CARD_H);
  fillRect(ctx, stripW - 1, 0, 2, CARD_H, P.accentText);

  brandTop(ctx, P.fg);
  categoryMark(ctx, issue, 150, alpha(P.fg, 0.6));
  setFont(ctx, 900, 26);
  ctx.fillStyle = photoAccent();
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  const heat = issue.temp !== null ? `논란 ${issue.temp}°` : `화제 ${issue.buzz}`;
  ctx.fillText(heat, CARD_W - M, 150);
  ctx.textAlign = "left";

  const colX = stripW + 46;
  const colW = CARD_W - colX - M;

  const kickerFit = fitRegion(ctx, issue.kicker, {
    w: colW,
    h: 130,
    max: 26,
    min: 20,
    weight: 700,
    lineFactor: 1.44,
    maxLines: 3,
  });
  setFont(ctx, 700, kickerFit.size);
  ctx.fillStyle = alpha(P.fg, 0.62);
  drawLines(ctx, kickerFit.lines, colX, 262, kickerFit.lineHeight);

  const headFit = fitRegion(ctx, issue.hook, {
    w: colW,
    h: 640,
    max: 74,
    min: 44,
    weight: 900,
    lineFactor: 1.16,
    maxLines: 8,
  });
  const headTop = 262 + kickerFit.height + 34;
  fillRect(ctx, colX, headTop - 22, 70, 6, P.accentText);
  drawEmphasisLines(ctx, headFit.lines, colX, headTop, headFit.size, headFit.lineHeight, {
    color: P.fg,
    hot: P.accentText,
  });

  const sourceY = CARD_H - 150;
  ctx.strokeStyle = alpha(P.fg, 0.2);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(colX, sourceY - 18);
  ctx.lineTo(CARD_W - M, sourceY - 18);
  ctx.stroke();
  const credit = plate?.stock ? " · 자료사진" : "";
  setFont(ctx, 700, 24);
  ctx.fillStyle = alpha(P.fg, 0.55);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`${issue.source} · ${timeAgo(issue.publishedAt)}${credit}`, colX, sourceY);
  footer(ctx, 0, "paper");
}

/** ⑤ 속보 — 붉은 톤 + 큰 활자. */
function drawCoverBreaking(ctx: Ctx, issue: Issue, plate: Plate | null): void {
  coverBase(ctx, plate, 0.36);
  topScrim(ctx, 240);
  bottomScrim(ctx, 500, 0.99);

  fillRect(ctx, 0, 0, CARD_W, 12, P.accent);
  setFont(ctx, 900, 26);
  setTracking(ctx, 1.6);
  const badge = "속보 · HOT";
  const badgeW = ctx.measureText(badge).width + 40;
  fillRect(ctx, M, 64, badgeW, 46, P.alt);
  ctx.fillStyle = P.onAlt;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(badge, M + 20, 88);
  setTracking(ctx, 0);
  ctx.textBaseline = "top";

  setFont(ctx, 800, 24);
  ctx.fillStyle = ON_PHOTO_DIM;
  ctx.fillText(brandName(), M + badgeW + 24, 76);
  heatMark(ctx, issue, 72, ON_PHOTO);
  categoryMark(ctx, issue, 150, ON_PHOTO_DIM);

  // 속보 판은 위에서 바로 제목이 나오도록 — 사진이 넓게 보이고, 첫 줄에서 눈이 멈춥니다.
  const kickerFit = fitRegion(ctx, issue.kicker, {
    w: CARD_W - M * 2,
    h: 100,
    max: 32,
    min: 24,
    weight: 700,
    lineFactor: 1.4,
    maxLines: 2,
  });
  setFont(ctx, 700, kickerFit.size);
  ctx.fillStyle = alpha(ON_PHOTO, 0.78);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  drawLines(ctx, kickerFit.lines, M, 206, kickerFit.lineHeight);

  const sourceY = CARD_H - 106;
  const headFit = fitRegion(ctx, issue.hook, {
    w: CARD_W - M * 2,
    h: 470,
    max: 110,
    min: 60,
    weight: 900,
    lineFactor: 1.08,
    maxLines: 4,
  });
  const headY = sourceY - 78 - headFit.height;
  photoShadow(ctx, true);
  drawEmphasisLines(ctx, headFit.lines, M, headY, headFit.size, headFit.lineHeight, {
    color: ON_PHOTO,
    hot: photoAccent(),
  });
  photoShadow(ctx, false);

  fillRect(ctx, M, sourceY - 54, 132, 8, P.accent);
  sourceLine(ctx, issue, plate, sourceY, ON_PHOTO_FAINT);
  swipe(ctx, "전체 팩트 →", sourceY, photoAccent());
  footer(ctx, 0, "photo");
}

function drawCover(ctx: Ctx, issue: Issue, plate: Plate | null, layout?: CardLayout): void {
  const picked = layout ?? layoutOf(issue);
  if (picked === "quote") drawCoverQuote(ctx, issue, plate);
  else if (picked === "stat") drawCoverStat(ctx, issue, plate);
  else if (picked === "split") drawCoverStrip(ctx, issue, plate);
  else if (picked === "breaking") drawCoverBreaking(ctx, issue, plate);
  else drawCoverOverlay(ctx, issue, plate);
}

/* ------------------------------------------------------------------ slide 2 */

/** ② 무슨 일인데 — 사진 띠 + 번호 붙은 팩트 3줄. */
function drawFacts(ctx: Ctx, issue: Issue, plate: Plate | null): void {
  const bandH = 604;
  fillRect(ctx, 0, 0, CARD_W, CARD_H, P.paper);
  drawBand(ctx, plate, 0, 0, CARD_W, bandH, 0.36);
  topScrim(ctx, 260);
  bottomScrim(ctx, bandH - 300, 0.94);
  bandFade(ctx, bandH - 130, 130, P.paper);

  brandTop(ctx);
  stepLabel(ctx, "01 · 무슨 일인데", 150, ON_PHOTO_DIM);

  const headFit = fitRegion(ctx, issue.hook, {
    w: CARD_W - M * 2,
    h: 190,
    max: 56,
    min: 38,
    weight: 900,
    lineFactor: 1.16,
    maxLines: 2,
  });
  photoShadow(ctx, true);
  drawEmphasisLines(ctx, headFit.lines, M, bandH - 96 - headFit.height, headFit.size, headFit.lineHeight, {
    color: ON_PHOTO,
    hot: photoAccent(),
  });
  photoShadow(ctx, false);

  const facts = issue.facts.slice(0, 3);
  const listTop = bandH + 36;
  const listBottom = CARD_H - 216;
  const rowH = (listBottom - listTop) / Math.max(1, facts.length);

  facts.forEach((fact, index) => {
    const rowTop = listTop + rowH * index;
    setFont(ctx, 900, 26);
    ctx.fillStyle = P.accentText;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(String(index + 1).padStart(2, "0"), M, rowTop + 8);

    const textX = M + 78;
    const maxWidth = CARD_W - textX - M;
    const fit = fitRegion(ctx, fact, {
      w: maxWidth,
      h: rowH - 34,
      max: 38,
      min: 27,
      weight: 700,
      lineFactor: 1.4,
      maxLines: 3,
    });
    drawEmphasisLines(ctx, fit.lines, textX, rowTop + 2, fit.size, fit.lineHeight, {
      color: alpha(P.fg, 0.94),
      hot: P.fg,
      weight: 700,
      marker: P.accent,
      markerInk: P.onAccent,
    });

    if (index < facts.length - 1) {
      ctx.strokeStyle = alpha(P.fg, 0.12);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(M, rowTop + rowH - 18);
      ctx.lineTo(CARD_W - M, rowTop + rowH - 18);
      ctx.stroke();
    }
  });

  const original = issue.title.length > 52 ? `${issue.title.slice(0, 51)}…` : issue.title;
  setFont(ctx, 600, 22);
  ctx.fillStyle = alpha(P.fg, 0.44);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`원문 · ${issue.source} · ${original}`, M, CARD_H - 196);

  footer(ctx, 1, "paper");
}

/* ------------------------------------------------------------------ slide 3 */

/** ③ 왜 지금 뜨나 — 사진 전체 위에 큰 인용, 아래 지면에 핵심 쟁점. */
function drawWhy(ctx: Ctx, issue: Issue, plate: Plate | null): void {
  fillRect(ctx, 0, 0, CARD_W, CARD_H, P.paper);
  drawFullPlate(ctx, plate, 0.3);
  ctx.fillStyle = "rgba(8,8,10,0.52)";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  topScrim(ctx, 300);

  brandTop(ctx);
  stepLabel(ctx, "02 · 왜 지금 뜨나", 150, ON_PHOTO_DIM);

  // 인용 부호는 활자가 아니라 그린 막대로 — 폰트마다 모양이 달라지지 않게.
  fillRect(ctx, M, 214, 66, 12, photoAccent());
  fillRect(ctx, M, 240, 66, 12, photoAccent());

  const body = issue.background || issue.kicker || issue.hook;
  const bodyFit = fitRegion(ctx, body, {
    w: CARD_W - M * 2,
    h: 350,
    max: 52,
    min: 32,
    weight: 700,
    lineFactor: 1.5,
    maxLines: 4,
  });
  setFont(ctx, 700, bodyFit.size);
  ctx.fillStyle = ON_PHOTO;
  photoShadow(ctx, true);
  drawLines(ctx, bodyFit.lines, M, 312, bodyFit.lineHeight);
  photoShadow(ctx, false);

  // 아래 지면 — 색 박스가 아니라 화면 끝까지 닿는 종이 띠.
  const paperTop = 946;
  fillRect(ctx, 0, paperTop, CARD_W, CARD_H - paperTop, P.paper);
  fillRect(ctx, 0, paperTop, CARD_W, 8, P.accentText);

  stepLabel(ctx, "핵심 쟁점", paperTop + 40, alpha(P.accentText, 0.9));

  const point = issue.point || issue.poll.question;
  const pointFit = fitRegion(ctx, point, {
    w: CARD_W - M * 2,
    h: 140,
    max: 56,
    min: 30,
    weight: 900,
    lineFactor: 1.24,
    maxLines: 2,
  });
  drawEmphasisLines(ctx, pointFit.lines, M, paperTop + 88, pointFit.size, pointFit.lineHeight, {
    color: P.fg,
    hot: P.accentText,
  });

  if (issue.sides?.labelA && issue.sides.labelB) {
    const chipY = paperTop + 246;
    setFont(ctx, 800, 22);
    setTracking(ctx, 1.4);
    ctx.fillStyle = alpha(P.fg, 0.55);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    const text = `A ${issue.sides.labelA}   ·   B ${issue.sides.labelB}`;
    ctx.fillText(text, M, chipY);
    setTracking(ctx, 0);
  } else {
    // 두 진영 문장이 없을 때는 투표 선택지를 미리 보여 줍니다 — 빈 지면 대신 다음 장으로 이어지게.
    const chipY = paperTop + 196;
    setFont(ctx, 800, 24);
    ctx.fillStyle = alpha(P.fg, 0.5);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(`A ${issue.poll.a}`, M, chipY);
    ctx.fillText(`B ${issue.poll.b}`, M, chipY + 40);
  }

  sourceLine(ctx, issue, plate, CARD_H - 104, alpha(P.fg, 0.45));
  footer(ctx, 2, "paper");
}

/* ------------------------------------------------------------------ slide 4 */

/** ④ 어디서 갈렸나 — 사진 띠 + 세로 괘선으로 가른 두 진영(색 블록 없이 활자만). */
function drawSides(ctx: Ctx, issue: Issue, plate: Plate | null): void {
  const bandH = 520;
  fillRect(ctx, 0, 0, CARD_W, CARD_H, P.paper);
  drawBand(ctx, plate, 0, 0, CARD_W, bandH, 0.34);
  topScrim(ctx, 260);
  bottomScrim(ctx, bandH - 260, 0.9);
  bandFade(ctx, bandH - 110, 110, P.paper);

  brandTop(ctx);
  stepLabel(ctx, "03 · 어디서 갈렸나", 150, ON_PHOTO_DIM);

  const sides = issue.sides;
  const claimA = sides?.a || issue.poll.a;
  const claimB = sides?.b || issue.poll.b;
  const sameWords = (a: string, b: string): boolean => {
    const x = a.replace(/\s+/g, "");
    const y = b.replace(/\s+/g, "");
    if (x.length < 10 || y.length < 10) return false;
    return x === y || x.includes(y) || y.includes(x) || x.slice(0, 16) === y.slice(0, 16);
  };
  let lead = issue.point || issue.poll.question;
  if (sameWords(lead, claimA) || sameWords(lead, claimB)) lead = issue.poll.question;
  if (sameWords(lead, claimA) || sameWords(lead, claimB)) lead = "";

  // 사진 위에 A · VS · B를 크게 — 아래 지면은 두 진영의 말만 남깁니다.
  const markY = bandH - 168;
  setFont(ctx, 900, 104);
  photoShadow(ctx, true);
  ctx.fillStyle = ON_PHOTO;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("A", M, markY);
  ctx.textAlign = "right";
  ctx.fillText("B", CARD_W - M, markY);
  setFont(ctx, 900, 34);
  ctx.fillStyle = photoAccent();
  ctx.textAlign = "center";
  ctx.fillText("VS", CARD_W / 2, markY + 44);
  photoShadow(ctx, false);
  ctx.textAlign = "left";

  const paperTop = bandH;
  fillRect(ctx, 0, paperTop, CARD_W, CARD_H - paperTop, P.paper);
  fillRect(ctx, 0, paperTop, CARD_W, 6, P.accentText);

  if (lead) {
    const leadFit = fitRegion(ctx, lead, {
      w: CARD_W - M * 2,
      h: 118,
      max: 44,
      min: 28,
      weight: 700,
      lineFactor: 1.34,
      maxLines: 2,
    });
    setFont(ctx, 700, leadFit.size);
    ctx.fillStyle = alpha(P.fg, 0.86);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    drawLines(ctx, leadFit.lines, M, paperTop + 40, leadFit.lineHeight);
  }

  const regionTop = paperTop + (lead ? 190 : 56);
  const regionBottom = CARD_H - 268;
  const colW = (CARD_W - M * 2 - 76) / 2;
  const leftX = M;
  const rightX = M + colW + 76;

  ctx.strokeStyle = alpha(P.fg, 0.14);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(CARD_W / 2, regionTop);
  ctx.lineTo(CARD_W / 2, regionBottom);
  ctx.stroke();

  const labelA = sides?.labelA || "";
  const labelB = sides?.labelB || "";

  const drawSide = (x: number, key: string, label: string, claim: string, color: string) => {
    const claimFit = fitRegion(ctx, claim, {
      w: colW,
      h: regionBottom - regionTop - 76,
      max: 52,
      min: 27,
      weight: 800,
      lineFactor: 1.4,
      maxLines: 6,
    });
    const blockH = 66 + claimFit.height;
    const top = regionTop + Math.max(0, (regionBottom - regionTop - blockH) / 2);

    setFont(ctx, 800, 22);
    setTracking(ctx, 2.2);
    ctx.fillStyle = alpha(color, 0.95);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(label ? `${key} · ${label}` : key, x, top);
    setTracking(ctx, 0);

    setFont(ctx, 800, claimFit.size);
    ctx.fillStyle = P.fg;
    drawLines(ctx, claimFit.lines, x, top + 66, claimFit.lineHeight);
  };

  drawSide(leftX, "A", labelA, claimA, P.accent);
  drawSide(rightX, "B", labelB, claimB, P.alt);

  // 마지막 줄 — 이 카드에서 바로 투표로 넘어가도록.
  const ctaTop = CARD_H - 196;
  fillRect(ctx, 0, ctaTop, CARD_W, 54, P.accent);
  setFont(ctx, 900, 34);
  ctx.fillStyle = P.onAccent;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("당신은 어느 쪽?", M, ctaTop + 8);
  setFont(ctx, 700, 23);
  ctx.fillStyle = alpha(P.onAccent, 0.72);
  ctx.textAlign = "right";
  ctx.fillText("넘겨서 5장에서 투표 →", CARD_W - M, ctaTop + 15);
  ctx.textAlign = "left";

  footer(ctx, 3, "paper");
}

/* ------------------------------------------------------------------ slide 5 */

/** ⑤ 당신의 선택 — 사진 위 질문, 아래 지면에 A/B와 댓글 유도. */
function drawVote(ctx: Ctx, issue: Issue, plate: Plate | null): void {
  const bandH = 706;
  fillRect(ctx, 0, 0, CARD_W, CARD_H, P.paper);
  drawBand(ctx, plate, 0, 0, CARD_W, bandH, 0.34);
  topScrim(ctx, 260);
  bottomScrim(ctx, bandH - 340, 0.96);
  bandFade(ctx, bandH - 110, 110, P.paper);

  brandTop(ctx);
  stepLabel(ctx, "04 · 당신의 선택", 150, ON_PHOTO_DIM);

  const question = issue.poll.question;
  const qFit = fitRegion(ctx, question, {
    w: CARD_W - M * 2,
    h: 300,
    max: 82,
    min: 44,
    weight: 900,
    lineFactor: 1.12,
    maxLines: 3,
  });
  photoShadow(ctx, true);
  drawEmphasisLines(ctx, qFit.lines, M, bandH - 72 - qFit.height, qFit.size, qFit.lineHeight, {
    color: ON_PHOTO,
    hot: photoAccent(),
  });
  photoShadow(ctx, false);

  fillRect(ctx, 0, bandH, CARD_W, 6, P.accentText);

  const options = [
    { key: "A", text: issue.poll.a, color: P.accent, ink: P.onAccent },
    { key: "B", text: issue.poll.b, color: P.alt, ink: P.onAlt },
  ];
  const rowH = 158;
  const areaTop = bandH + 44;
  const areaBottom = CARD_H - 206;
  let optionTop = areaTop + Math.max(0, (areaBottom - areaTop - rowH * 2) / 2);
  options.forEach((option, index) => {
    setFont(ctx, 900, 30);
    ctx.fillStyle = option.color;
    ctx.beginPath();
    ctx.arc(M + 30, optionTop + 44, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = option.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(option.key, M + 30, optionTop + 46);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    const fit = fitRegion(ctx, option.text, {
      w: CARD_W - M * 2 - 100,
      h: 118,
      max: 44,
      min: 28,
      weight: 800,
      lineFactor: 1.32,
      maxLines: 2,
    });
    setFont(ctx, 800, fit.size);
    ctx.fillStyle = P.fg;
    drawLines(ctx, fit.lines, M + 82, optionTop + 44 - fit.height / 2, fit.lineHeight);

    if (index === 0) {
      ctx.strokeStyle = alpha(P.fg, 0.12);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(M, optionTop + rowH - 14);
      ctx.lineTo(CARD_W - M, optionTop + rowH - 14);
      ctx.stroke();
    }
    optionTop += rowH;
  });

  setFont(ctx, 700, 24);
  ctx.fillStyle = alpha(P.fg, 0.5);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("고른 이유를 한 줄로 남기면 토론이 붙어요", M, CARD_H - 186);

  // 댓글 유도 — 화면 끝까지 닿는 강조 바.
  const ctaTop = CARD_H - 150;
  fillRect(ctx, 0, ctaTop, CARD_W, 54, P.accent);
  setFont(ctx, 900, 34);
  ctx.fillStyle = P.onAccent;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("댓글로 A 아니면 B", M, ctaTop + 8);
  setFont(ctx, 700, 23);
  ctx.fillStyle = alpha(P.onAccent, 0.74);
  ctx.textAlign = "right";
  ctx.fillText("이유도 한 줄 · 저장해 두고 다시 보기", CARD_W - M, ctaTop + 15);
  ctx.textAlign = "left";

  footer(ctx, 4, "paper", "원문 링크는 프로필에");
}

/* ------------------------------------------------------------------ export */

async function ensureFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load(`900 96px ${SANS}`, "가나다라마바사 1234%"),
      document.fonts.load(`800 48px ${SANS}`, "가나다라마바사 1234%"),
      document.fonts.load(`700 40px ${SANS}`, "가나다라마바사 1234%"),
      document.fonts.load(`600 32px ${SANS}`, "가나다라마바사 1234%"),
    ]);
    await document.fonts.ready;
  } catch {
    /* 폰트를 못 받아도 기본 글꼴로 그립니다 */
  }
}

/** 폰트는 한 번만 받아 오면 됩니다 — 카드 5장을 그릴 때마다 기다리지 않습니다. */
let fontsTask: Promise<void> | null = null;
function ensureFontsOnce(): Promise<void> {
  if (!fontsTask) fontsTask = ensureFonts();
  return fontsTask;
}

export interface SlideAsset {
  index: number;
  blob: Blob;
  url: string;
  /** 화면에 보이는 이미지와 내려받는 PNG가 같은 파일인지 대조하는 값. */
  hash: string;
  /** 화면 낭독기·검사용 슬라이드 전문. */
  text: string;
}

/** ①~⑤ 슬라이드에 실제로 들어간 문구 — 미리보기의 aria-label이자 검사 기준입니다. */
export function slideText(issue: Issue, index: number, handle?: string): string {
  const meta = CATEGORY_META[issue.category];
  const mark = handle ? ` ${handle}` : "";
  if (index === 0) {
    return `표지. ${meta.label}. ${issue.hook}. ${issue.kicker}. ${issue.source} · ${timeAgo(issue.publishedAt)}.${mark}`;
  }
  if (index === 1) {
    return `무슨 일인데. ${issue.facts.slice(0, 3).map((fact, i) => `${i + 1}. ${fact}`).join(" ")} 원문 ${issue.source}. ${issue.title}.${mark}`;
  }
  if (index === 2) {
    return `왜 지금 뜨나. ${issue.background || issue.kicker}. 핵심 쟁점. ${issue.point || issue.poll.question}.${mark}`;
  }
  if (index === 3) {
    const sides = issue.sides;
    return `A vs B. A ${sides?.labelA ?? ""} ${sides?.a ?? issue.poll.a}. B ${sides?.labelB ?? ""} ${sides?.b ?? issue.poll.b}.${mark}`;
  }
  return `당신의 선택. ${issue.poll.question} A ${issue.poll.a} / B ${issue.poll.b}. 댓글로 A 아니면 B, 이유도 한 줄.${mark}`;
}

async function digest(blob: Blob): Promise<string> {
  try {
    const buffer = await blob.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(hash))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "";
  }
}

export async function renderSlide(issue: Issue, index: number, options: RenderOptions = {}): Promise<HTMLCanvasElement> {
  await ensureFontsOnce();
  useOptions(options);
  PLATES = await resolvePlates(issue);

  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  if (index === 0) drawCover(ctx, issue, plateFor(0), options.layout);
  else if (index === 1) drawFacts(ctx, issue, plateFor(1));
  else if (index === 2) drawWhy(ctx, issue, plateFor(2));
  else if (index === 3) drawSides(ctx, issue, plateFor(1));
  else drawVote(ctx, issue, plateFor(0));

  return canvas;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("png failed"))), "image/png");
  });
}

export async function renderSlideAsset(
  issue: Issue,
  index: number,
  options: RenderOptions = {},
): Promise<SlideAsset> {
  const canvas = await renderSlide(issue, index, options);
  const blob = await toBlob(canvas);
  return {
    index,
    blob,
    url: URL.createObjectURL(blob),
    hash: await digest(blob),
    text: slideText(issue, index, options.handle?.trim() || undefined),
  };
}

/** 5장을 차례로 그립니다 — 사진은 한 번만 받아 오고, 메모리를 아끼려 순서대로 처리합니다. */
export async function renderAllSlides(
  issue: Issue,
  onSlide?: (asset: SlideAsset) => void,
  options: RenderOptions = {},
): Promise<SlideAsset[]> {
  const assets: SlideAsset[] = [];
  for (let index = 0; index < SLIDE_COUNT; index += 1) {
    const asset = await renderSlideAsset(issue, index, options);
    assets.push(asset);
    onSlide?.(asset);
  }
  return assets;
}

export function releaseSlideAssets(assets: SlideAsset[]): void {
  for (const asset of assets) URL.revokeObjectURL(asset.url);
}

function fileName(issue: Issue, index: number): string {
  const hook = issue.hook.replace(/[\\/:*?"<>|\s]+/g, "").slice(0, 18) || issue.id;
  return `이슈온도계_${hook}_${index + 1}.png`;
}

function triggerDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}

/** 지금 보고 있는 한 장을 PNG로 저장합니다 — 화면에 보이는 그 blob을 그대로 내려받습니다. */
export async function saveSlidePng(
  issue: Issue,
  index: number,
  asset?: SlideAsset,
  options: RenderOptions = {},
): Promise<void> {
  const ready = asset ?? (await renderSlideAsset(issue, index, options));
  triggerDownload(ready.blob, fileName(issue, index));
  if (!asset) setTimeout(() => URL.revokeObjectURL(ready.url), 5_000);
}

/** 5장을 한 번에 받을 수 있게 ZIP 한 파일로 저장합니다(폰에서 여러 번 저장이 막히는 문제 회피). */
export async function saveAllCards(issue: Issue, assets?: SlideAsset[], options: RenderOptions = {}): Promise<number> {
  const ready = assets && assets.length === SLIDE_COUNT ? assets : await renderAllSlides(issue, undefined, options);
  const entries = [];
  for (const asset of ready) {
    entries.push({ name: fileName(issue, asset.index), data: new Uint8Array(await asset.blob.arrayBuffer()) });
  }
  triggerDownload(buildZip(entries), `이슈온도계_${issue.id}_5장.zip`);
  return entries.length;
}
