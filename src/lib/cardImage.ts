/**
 * 카드뉴스 PNG 만들기 — 인스타그램 4:5(1080×1350) 규격 5장을 캔버스에 직접 그립니다.
 *
 * 화면 미리보기도 **이 캔버스로 그린 결과 그대로**를 보여 줍니다(별도 DOM 조판 없음).
 * 그래서 "보는 카드"와 "저장되는 PNG"가 100% 같은 파일입니다 — 저장은 렌더된 blob을 그대로 내려받습니다.
 *
 *  ① 표지   — 기사 사진 + 진한 그라데이션 + 훅 헤드라인 + 핫 배지 (인스타 썸네일)
 *  ② 무슨 일인데 — 사진 띠 + 번호 카드 3개, 숫자는 형광 하이라이트
 *  ③ 왜 지금 뜨나 — 사진 카드 + 인용 + 핵심 쟁점 박스
 *  ④ A vs B — 두 진영 대결 패널 + VS 배지
 *  ⑤ 당신의 선택 — 투표 질문 + A/B + 댓글 유도 엔딩 카드
 *
 * 색은 테마(lib/theme.ts)에서 역할별로 가져옵니다 — 에디토리얼 다크·모던 화이트·브레이킹 레드·트렌디 파스텔.
 * 크리에이터가 고친 문구(lib/copy.ts)와 워터마크 핸들이 그대로 PNG에 박힙니다.
 */

import { CATEGORY_META, type Issue } from "../types";
import { timeAgo } from "./format";
import { buildZip } from "./zip";
import { proxiedImage } from "./api";
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

const M = 76;
const SANS = '"Pretendard Variable", Pretendard, "SUIT Variable", SUIT, sans-serif';

type Ctx = CanvasRenderingContext2D;

/**
 * 지금 그리고 있는 테마와 워터마크.
 * 그리는 함수들은 전부 동기(await 없음)라, renderSlide가 시작 직전에 바꿔 두면
 * 한 장이 그려지는 동안 다른 테마로 바뀌지 않습니다.
 */
let P: CardPalette = CARD_THEMES[DEFAULT_THEME];
let HANDLE = "";

export interface RenderOptions {
  theme?: CardThemeId | string;
  /** 카드마다 박히는 워터마크(@my_channel). 비우면 서비스 이름. */
  handle?: string;
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

/** 진한 블록 위에서 강조색이 묻히면(모던 화이트처럼 검정 위 검정) 블록 글자색으로 대체합니다. */
function popOnSolid(): string {
  const a = P.accent.replace("#", "");
  const b = P.solid.replace("#", "");
  if (a.slice(0, 6).toLowerCase() === b.slice(0, 6).toLowerCase()) return P.onSolid;
  return isLight(P.accent) && isLight(P.solid) ? P.onSolid : P.accent;
}

/* ---------------------------------------------------------------- helpers */

function setFont(ctx: Ctx, weight: number, size: number, family = SANS): void {
  ctx.font = `${weight} ${size}px ${family}`;
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

function fillRound(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, color: string): void {
  ctx.fillStyle = color;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
}

function strokeRound(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, color: string, width = 2): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  roundRect(ctx, x, y, w, h, r);
  ctx.stroke();
}

/** 한글은 띄어쓰기 단위로, 한 단어가 폭을 넘으면 글자 단위로 잘라 줄바꿈합니다. */
function wrapText(ctx: Ctx, text: string, maxWidth: number, maxLines: number): string[] {
  const value = text.replace(/\s+/g, " ").trim();
  if (!value) return [];
  const lines: string[] = [];
  let line = "";

  const pushLine = () => {
    if (line) lines.push(line);
    line = "";
  };

  for (const word of value.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    pushLine();
    if (ctx.measureText(word).width <= maxWidth) {
      line = word;
      continue;
    }
    let chunk = "";
    for (const char of word) {
      if (ctx.measureText(chunk + char).width > maxWidth) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    line = chunk;
  }
  pushLine();

  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last.trim()}…`;
  return kept;
}

/** 폰트 크기를 줄여 가며 제목이 정해진 줄 수 안에 들어오게 맞춥니다. */
function fitHeading(
  ctx: Ctx,
  text: string,
  maxWidth: number,
  maxLines: number,
  start: number,
  min: number,
  weight = 900,
): { size: number; lines: string[] } {
  for (let size = start; size >= min; size -= 2) {
    setFont(ctx, weight, size);
    const lines = wrapText(ctx, text, maxWidth, maxLines);
    const fits = lines.length <= maxLines && lines.every((line) => ctx.measureText(line).width <= maxWidth);
    if (fits) return { size, lines };
  }
  setFont(ctx, weight, min);
  return { size: min, lines: wrapText(ctx, text, maxWidth, maxLines) };
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

/** "1년 새 12% 올랐다" → 숫자 덩어리만 hot으로 잘라 카드에서 형광펜처럼 강조합니다. */
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

interface RichLine {
  segs: Seg[];
  width: number;
}

/** 숫자 강조를 유지한 채 줄바꿈합니다(폰트는 미리 세팅돼 있어야 합니다). */
function layoutRich(ctx: Ctx, text: string, maxWidth: number, maxLines: number): RichLine[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: RichLine[] = [];
  let current: RichLine = { segs: [], width: 0 };

  const append = (segs: Seg[]) => {
    for (const seg of segs) {
      const last = current.segs[current.segs.length - 1];
      if (last && last.hot === seg.hot) {
        last.text += seg.text;
      } else {
        current.segs.push({ ...seg });
      }
      current.width += ctx.measureText(seg.text).width;
    }
  };

  const pushLine = () => {
    if (current.segs.length > 0) lines.push(current);
    current = { segs: [], width: 0 };
  };

  for (const word of words) {
    if (!word) continue;
    const segs = splitSegments(word);
    const wordWidth = segs.reduce((sum, seg) => sum + ctx.measureText(seg.text).width, 0);
    const spaceWidth = ctx.measureText(" ").width;
    if (current.width > 0 && current.width + spaceWidth + wordWidth > maxWidth) pushLine();
    if (current.width > 0) {
      append([{ text: " ", hot: false }]);
    }
    if (wordWidth <= maxWidth) {
      append(segs);
      continue;
    }
    // 한 단어가 한 줄보다 길면 글자 단위로 쪼갭니다.
    for (const seg of segs) {
      for (const char of seg.text) {
        const charWidth = ctx.measureText(char).width;
        if (current.width > 0 && current.width + charWidth > maxWidth) pushLine();
        append([{ text: char, hot: seg.hot }]);
      }
    }
  }
  pushLine();

  if (lines.length <= maxLines) return lines;
  return lines.slice(0, maxLines);
}

/** 형광펜(마커) 스타일 — 숫자만 강조색 블록으로 튀게 그립니다. */
function drawRichLines(
  ctx: Ctx,
  lines: RichLine[],
  x: number,
  y: number,
  size: number,
  lineHeight: number,
  options: { color: string; hot: "marker" | "color"; marker?: string; markerInk?: string } = {
    color: P.fg,
    hot: "marker",
  },
): number {
  let cursor = y;
  for (const line of lines) {
    let px = x;
    for (const seg of line.segs) {
      const width = ctx.measureText(seg.text).width;
      if (seg.hot && options.hot === "marker") {
        ctx.fillStyle = options.marker ?? P.accent;
        roundRect(ctx, px - 6, cursor + size * 0.06, width + 12, size * 0.98, 8);
        ctx.fill();
        ctx.fillStyle = options.markerInk ?? P.onAccent;
      } else if (seg.hot) {
        ctx.fillStyle = options.marker ?? P.accent;
      } else {
        ctx.fillStyle = options.color;
      }
      ctx.fillText(seg.text, px, cursor);
      px += width;
    }
    cursor += lineHeight;
  }
  return cursor;
}

/* ------------------------------------------------------------- 배경 그리기 */

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
  }
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const rect = coverRect(img, w, h, focusY);
  ctx.drawImage(img, x + rect.x, y + rect.y, rect.w, rect.h);
  ctx.restore();
}

/** 사진이 없을 때도 '포스터'처럼 보이게 — 카테고리 색 그라데이션 + 망점. */
function posterBase(ctx: Ctx, accent: string): void {
  const light = isLight(P.paper);
  ctx.fillStyle = P.paper;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const glow = ctx.createRadialGradient(CARD_W * 0.9, -60, 30, CARD_W * 0.9, -60, 900);
  glow.addColorStop(0, hexWith(accent, light ? "2e" : "cc"));
  glow.addColorStop(0.45, hexWith(accent, light ? "0f" : "33"));
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const warm = ctx.createRadialGradient(60, CARD_H + 60, 20, 60, CARD_H + 60, 720);
  warm.addColorStop(0, alpha(P.alt, light ? 0.1 : 0.4));
  warm.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // 망점 — 인쇄물 느낌의 결. 밝은 테마에서는 아주 옅게.
  ctx.fillStyle = P.grain;
  for (let row = 0; row < 26; row += 1) {
    for (let col = 0; col < 22; col += 1) {
      const cx = 34 + col * 48 + (row % 2) * 24;
      const cy = 26 + row * 52;
      const radius = 1.1 + ((row + col) % 3) * 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function bottomScrim(ctx: Ctx, from: number, strength = 0.96): void {
  const grad = ctx.createLinearGradient(0, from, 0, CARD_H);
  grad.addColorStop(0, `rgba(${P.scrim},0)`);
  grad.addColorStop(0.55, `rgba(${P.scrim},${strength * 0.82})`);
  grad.addColorStop(1, `rgba(${P.scrim},${strength})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, from, CARD_W, CARD_H - from);
}

function topScrim(ctx: Ctx, height = 300): void {
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, `rgba(${P.scrim},0.86)`);
  grad.addColorStop(1, `rgba(${P.scrim},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CARD_W, height);
}

/** 테마의 서명 — 브레이킹은 위쪽 색 띠, 파스텔은 안쪽 액자. */
function themeChrome(ctx: Ctx): void {
  if (P.strip) {
    ctx.fillStyle = P.accent;
    ctx.fillRect(0, 0, CARD_W, 14);
  }
  if (P.frame) {
    strokeRound(ctx, 22, 22, CARD_W - 44, CARD_H - 44, 34, alpha(P.fg, 0.16), 3);
  }
}

/* ------------------------------------------------------------- 공통 표식 */

type Surface = "paper" | "photo" | "accent";

function surfaceInk(mode: Surface): string {
  if (mode === "photo") return P.photoInk;
  if (mode === "accent") return P.onAccent;
  return P.fg;
}

function brandTop(ctx: Ctx, mode: Surface = "paper"): void {
  ctx.fillStyle = P.accentText;
  ctx.beginPath();
  ctx.arc(M + 9, 96, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = alpha(surfaceInk(mode), 0.92);
  setFont(ctx, 800, 28);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(brandName(), M + 30, 97);
  ctx.textBaseline = "top";

  if (P.rule) {
    ctx.strokeStyle = alpha(surfaceInk(mode), 0.28);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(M, 124);
    ctx.lineTo(CARD_W - M, 124);
    ctx.stroke();
  }
}

function hotBadge(ctx: Ctx, issue: Issue, right = CARD_W - M, top = 72): void {
  const score = issue.temp ?? issue.buzz ?? 0;
  const label = issue.temp !== null ? `논란 ${score}°` : `화제 ${score}`;
  setFont(ctx, 900, 28);
  const width = ctx.measureText(label).width + 64;
  fillRound(ctx, right - width, top, width, 52, 26, P.alt);
  // 온도계 표시 — 이모지 대신 직접 그립니다(기기·폰트마다 다르게 보이지 않도록).
  const markX = right - width + 24;
  const markTop = top + 16;
  ctx.strokeStyle = P.onAlt;
  ctx.fillStyle = P.onAlt;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(markX, markTop);
  ctx.lineTo(markX, markTop + 14);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(markX, markTop + 19, 4.6, 0, Math.PI * 2);
  ctx.fill();

  setFont(ctx, 900, 26);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(label, right - width + 48, top + 28);
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
}

function footer(ctx: Ctx, index: number, mode: Surface, note?: string): void {
  const color = alpha(surfaceInk(mode), 0.5);
  ctx.fillStyle = color;
  setFont(ctx, 700, 24);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(note ? `${brandName()} · ${note}` : brandName(), M, CARD_H - 64);
  ctx.textAlign = "right";
  ctx.fillText(`${index + 1} / ${SLIDE_COUNT}`, CARD_W - M, CARD_H - 64);
  ctx.textAlign = "left";
}

function categoryChip(ctx: Ctx, issue: Issue, accent: string, x: number, y: number): void {
  const label = CATEGORY_META[issue.category].label;
  setFont(ctx, 800, 27);
  const width = ctx.measureText(label).width + 76;
  strokeRound(ctx, x, y, width, 52, 26, P.accentText, 2);
  // 카테고리 색은 작은 점으로만 — 테마가 밝아도 라벨은 테마 글자색으로 읽힙니다.
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(x + 22, y + 27, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = P.accentText;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + 38, y + 28);
  ctx.textBaseline = "top";
}

/* ------------------------------------------------------------------ slide 1 */

function drawCover(ctx: Ctx, issue: Issue, accent: string, img: HTMLImageElement | null): void {
  posterBase(ctx, accent);
  if (img) {
    drawPhoto(ctx, img, 0, 0, CARD_W, CARD_H, 0, 0.34);
    // 사진 위에 카테고리 색을 살짝 얹어 카드마다 톤을 맞춥니다.
    ctx.fillStyle = hexWith(accent, isLight(P.paper) ? "12" : "1f");
    ctx.fillRect(0, 0, CARD_W, CARD_H);
  }
  topScrim(ctx, 340);
  // 사진 위 글자가 항상 읽히도록 아래쪽을 길게 깔아 줍니다.
  bottomScrim(ctx, 560, isLight(P.paper) ? 0.94 : 0.99);

  brandTop(ctx, "photo");
  hotBadge(ctx, issue);

  categoryChip(ctx, issue, accent, M, 160);

  // 훅 헤드라인 — 숫자는 강조색 글자로 튀게.
  const heading = fitHeading(ctx, issue.hook, CARD_W - M * 2, 4, 104, 62, 900);
  setFont(ctx, 900, heading.size);
  const lineHeight = heading.size * 1.09;
  const hookHeight = heading.lines.length * lineHeight;

  const kickerSize = 36;
  setFont(ctx, 700, kickerSize);
  const kickerLines = issue.kicker ? wrapText(ctx, issue.kicker, CARD_W - M * 2, 2) : [];
  const kickerHeight = kickerLines.length * kickerSize * 1.42;

  const footY = CARD_H - 172;
  const kickerTop = footY - 22 - kickerHeight;
  const hookTop = kickerTop - 26 - hookHeight;

  // 헤드라인 위 강조 룰
  ctx.fillStyle = P.accentText;
  ctx.fillRect(M, Math.max(300, hookTop - 42), 132, 9);

  setFont(ctx, 900, heading.size);
  const richLines = layoutRich(ctx, heading.lines.join(" "), CARD_W - M * 2, 4);
  // 사진 밝기에 상관없이 읽히도록 글자에 옅은 그림자를 깝니다.
  const shadow = P.photoInk === P.fg && isLight(P.paper) ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.55)";
  ctx.shadowColor = shadow;
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 3;
  drawRichLines(ctx, richLines, M, hookTop, heading.size, lineHeight, {
    color: P.photoInk,
    hot: "color",
    marker: P.accentText,
  });
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  if (kickerLines.length > 0) {
    setFont(ctx, 700, kickerSize);
    ctx.fillStyle = alpha(P.photoInk, 0.8);
    drawLines(ctx, kickerLines, M, kickerTop, kickerSize * 1.42);
  }

  // 아래 정보 줄
  ctx.strokeStyle = alpha(P.photoInk, 0.24);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(M, footY);
  ctx.lineTo(CARD_W - M, footY);
  ctx.stroke();

  setFont(ctx, 700, 27);
  ctx.fillStyle = alpha(P.photoInk, 0.72);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`${issue.source} · ${timeAgo(issue.publishedAt)}`, M, footY + 24);

  setFont(ctx, 800, 27);
  ctx.fillStyle = P.accentText;
  ctx.textAlign = "right";
  ctx.fillText("밀어서 5장 →", CARD_W - M, footY + 24);
  ctx.textAlign = "left";

  footer(ctx, 0, "photo");
  themeChrome(ctx);
}

/* ------------------------------------------------------------------ slide 2 */

function drawFacts(ctx: Ctx, issue: Issue, accent: string, img: HTMLImageElement | null): void {
  posterBase(ctx, accent);
  const bandH = 700;

  if (img) {
    drawPhoto(ctx, img, 0, 0, CARD_W, bandH, 0, 0.36);
    ctx.fillStyle = isLight(P.paper) ? "rgba(255,255,255,0.16)" : "rgba(8,8,10,0.26)";
    ctx.fillRect(0, 0, CARD_W, bandH);
  }
  topScrim(ctx, 260);
  // 사진 띠 아래를 본문 바탕과 이어 붙입니다.
  const fade = ctx.createLinearGradient(0, bandH - 240, 0, bandH);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(1, P.paper);
  ctx.fillStyle = fade;
  ctx.fillRect(0, bandH - 240, CARD_W, 240);

  brandTop(ctx, "photo");

  ctx.fillStyle = P.accentText;
  ctx.beginPath();
  ctx.arc(M + 8, bandH - 230, 8, 0, Math.PI * 2);
  ctx.fill();
  setFont(ctx, 900, 30);
  ctx.fillStyle = P.photoInk;
  ctx.fillText("01 · 무슨 일인데", M + 26, bandH - 250);

  const heading = fitHeading(ctx, issue.hook, CARD_W - M * 2, 2, 56, 40, 900);
  ctx.fillStyle = P.fg;
  setFont(ctx, 900, heading.size);
  const hookTop = bandH - 192;
  drawLines(ctx, heading.lines, M, hookTop, heading.size * 1.2);

  // 팩트 3줄 — 번호 카드 + 숫자 형광 하이라이트
  const facts = issue.facts.slice(0, 3);
  const listTop = bandH + 18;
  const listBottom = CARD_H - 264;
  const rowH = (listBottom - listTop) / Math.max(1, facts.length);

  facts.forEach((fact, index) => {
    const rowTop = listTop + rowH * index;
    const chip = 60;
    fillRound(ctx, M, rowTop + 8, chip, chip, 16, P.accent);
    ctx.fillStyle = P.onAccent;
    setFont(ctx, 900, 34);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), M + chip / 2, rowTop + 8 + chip / 2 + 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    const textX = M + chip + 32;
    const maxWidth = CARD_W - textX - M;
    const size = 40;
    setFont(ctx, 700, size);
    const lines = layoutRich(ctx, fact, maxWidth, 2);
    const blockH = lines.length * size * 1.42;
    const textTop = rowTop + Math.max(6, (rowH - 16 - blockH) / 2);
    drawRichLines(ctx, lines, textX, textTop, size, size * 1.42, {
      color: alpha(P.fg, 0.94),
      hot: "marker",
    });

    if (index < facts.length - 1) {
      ctx.strokeStyle = alpha(P.fg, 0.1);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(M, rowTop + rowH - 8);
      ctx.lineTo(CARD_W - M, rowTop + rowH - 8);
      ctx.stroke();
    }
  });

  const original = issue.title.length > 42 ? `${issue.title.slice(0, 41)}…` : issue.title;
  setFont(ctx, 600, 23);
  ctx.fillStyle = alpha(P.fg, 0.45);
  ctx.textAlign = "left";
  ctx.fillText(`원문 · ${issue.source} · ${original}`, M, CARD_H - 208);

  if (issue.tags.length > 0) {
    setFont(ctx, 800, 25);
    ctx.fillStyle = P.accentText;
    ctx.fillText(issue.tags.map((tag) => `#${tag}`).join("  "), M, CARD_H - 162);
  }

  footer(ctx, 1, "paper");
  themeChrome(ctx);
}

/* ------------------------------------------------------------------ slide 3 */

function drawWhy(ctx: Ctx, issue: Issue, accent: string, img: HTMLImageElement | null): void {
  posterBase(ctx, accent);
  bottomScrim(ctx, 300, 0.9);

  const photoW = CARD_W - M * 2;
  const photoH = 350;
  if (img) {
    drawPhoto(ctx, img, M, 66, photoW, photoH, 30, 0.32);
    ctx.fillStyle = "rgba(8,8,10,0.28)";
    roundRect(ctx, M, 66, photoW, photoH, 30);
    ctx.fill();
  } else {
    fillRound(ctx, M, 66, photoW, photoH, 30, P.panel);
  }
  // 사진 위 라벨
  const label = "02 · 왜 지금 뜨나";
  setFont(ctx, 900, 28);
  const labelW = ctx.measureText(label).width + 52;
  fillRound(ctx, M + 26, 96, labelW, 50, 25, "rgba(8,8,10,0.72)");
  ctx.fillStyle = P.accent;
  ctx.textBaseline = "middle";
  ctx.fillText(label, M + 52, 96 + 27);
  ctx.textBaseline = "top";

  // 인용 부호
  ctx.fillStyle = P.accentText;
  setFont(ctx, 900, 170);
  ctx.textAlign = "left";
  ctx.fillText("“", M - 4, 428);

  // 핵심 쟁점 박스 — 내용 길이에 맞춰 높이를 잡고 아래쪽에 고정합니다.
  const point = issue.point || issue.poll.question;
  const pointFit = fitHeading(ctx, point, CARD_W - M * 2 - 80, 3, 50, 34, 900);
  const pointH = pointFit.lines.length * pointFit.size * 1.3;
  const chipsH = issue.sides && issue.sides.labelA && issue.sides.labelB ? 46 : 0;
  const boxH = 30 + 30 + 16 + pointH + (chipsH ? 18 + chipsH : 0) + 34;
  const boxTop = CARD_H - 150 - boxH;

  // 배경 문장 — 인용 부호와 쟁점 박스 사이에 놓고 세로 가운데로 맞춥니다.
  const background = issue.background || issue.kicker;
  const body = fitHeading(ctx, background, CARD_W - M * 2 - 10, 4, 44, 32, 600);
  setFont(ctx, 600, body.size);
  const bodyHeight = body.lines.length * body.size * 1.62;
  const areaTop = 566;
  const areaBottom = boxTop - 40;
  const bodyTop = areaTop + Math.max(0, (areaBottom - areaTop - bodyHeight) / 2);
  ctx.fillStyle = alpha(P.fg, 0.88);
  drawLines(ctx, body.lines, M + 4, bodyTop, body.size * 1.62);

  fillRound(ctx, M, boxTop, CARD_W - M * 2, boxH, 30, P.panel);
  strokeRound(ctx, M, boxTop, CARD_W - M * 2, boxH, 30, P.accentText, 2);
  ctx.fillStyle = P.accentText;
  ctx.fillRect(M, boxTop + 26, 8, boxH - 52);

  ctx.fillStyle = P.accentText;
  setFont(ctx, 900, 26);
  ctx.fillText("핵심 쟁점", M + 36, boxTop + 30);

  setFont(ctx, 900, pointFit.size);
  ctx.fillStyle = P.fg;
  drawLines(ctx, pointFit.lines, M + 36, boxTop + 76, pointFit.size * 1.3);

  // A / B 라벨 미리보기
  if (chipsH > 0 && issue.sides) {
    const chipY = boxTop + boxH - 34 - chipsH;
    setFont(ctx, 800, 24);
    const textA = `A ${issue.sides.labelA}`;
    const textB = `B ${issue.sides.labelB}`;
    const widthA = ctx.measureText(textA).width + 40;
    const widthB = ctx.measureText(textB).width + 40;
    if (widthA + widthB + 14 < CARD_W - M * 2 - 72) {
      fillRound(ctx, M + 36, chipY, widthA, chipsH, 23, P.accent);
      fillRound(ctx, M + 50 + widthA, chipY, widthB, chipsH, 23, P.alt);
      ctx.fillStyle = P.onAccent;
      ctx.textBaseline = "middle";
      ctx.fillText(textA, M + 56, chipY + chipsH / 2 + 1);
      ctx.fillStyle = P.onAlt;
      ctx.fillText(textB, M + 70 + widthA, chipY + chipsH / 2 + 1);
      ctx.textBaseline = "top";
    }
  }

  footer(ctx, 2, "paper", `${issue.source} 보도 · ${timeAgo(issue.publishedAt)}`);
  themeChrome(ctx);
}

/* ------------------------------------------------------------------ slide 4 */

function drawSides(ctx: Ctx, issue: Issue, accent: string): void {
  posterBase(ctx, accent);
  bottomScrim(ctx, 500, 0.85);
  brandTop(ctx, "photo");

  ctx.fillStyle = P.accentText;
  ctx.beginPath();
  ctx.arc(M + 8, 178, 8, 0, Math.PI * 2);
  ctx.fill();
  setFont(ctx, 900, 30);
  ctx.fillStyle = P.fg;
  ctx.fillText("03 · 어디서 갈렸나", M + 26, 158);

  const sides = issue.sides;
  // 쟁점 한 줄이 A 진영 주장과 같은 말이면(데이터에 따라 흔함) 반복하지 않고 질문으로 대신합니다.
  const sameWords = (a: string, b: string): boolean => {
    const x = a.replace(/\s+/g, "");
    const y = b.replace(/\s+/g, "");
    if (x.length < 10 || y.length < 10) return false;
    return x === y || x.includes(y) || y.includes(x) || x.slice(0, 16) === y.slice(0, 16);
  };
  const claimA = sides?.a || issue.poll.a;
  const claimB = sides?.b || issue.poll.b;
  let lead = issue.point || issue.poll.question;
  if (sameWords(lead, claimA) || sameWords(lead, claimB)) lead = issue.poll.question;
  if (sameWords(lead, claimA) || sameWords(lead, claimB)) lead = "";

  let afterLead = 214;
  if (lead) {
    const leadFit = fitHeading(ctx, lead, CARD_W - M * 2, 2, 46, 34, 800);
    setFont(ctx, 800, leadFit.size);
    ctx.fillStyle = alpha(P.fg, 0.82);
    afterLead = drawLines(ctx, leadFit.lines, M, 214, leadFit.size * 1.32);
  }

  const panelTop = Math.min(afterLead + 34, 380);
  const panelH = Math.min(370, Math.floor((CARD_H - 300 - panelTop - 110) / 2));
  const panelW = CARD_W - M * 2;
  // AI 정리가 없으면 라벨이 "A"뿐이라 "A · A"처럼 겹치지 않게 비워 둡니다.
  const labelA = sides?.labelA || "";
  const labelB = sides?.labelB || "";
  const labelTextA = labelA ? `A · ${labelA}` : "A";
  const labelTextB = labelB ? `B · ${labelB}` : "B";

  // A 패널
  fillRound(ctx, M, panelTop, panelW, panelH, 32, P.accent);
  ctx.fillStyle = alpha(P.onAccent, 0.09);
  setFont(ctx, 900, 320);
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText("A", M + panelW - 30, panelTop + panelH - 300);
  ctx.textAlign = "left";
  ctx.fillStyle = alpha(P.onAccent, 0.6);
  setFont(ctx, 800, 26);
  ctx.fillText(labelTextA, M + 42, panelTop + 32);
  const aFit = fitHeading(ctx, claimA, panelW - 84, 3, 50, 32, 900);
  setFont(ctx, 900, aFit.size);
  ctx.fillStyle = P.onAccent;
  const aHeight = aFit.lines.length * aFit.size * 1.34;
  drawLines(ctx, aFit.lines, M + 42, panelTop + 92 + Math.max(0, (panelH - 130 - aHeight) / 2), aFit.size * 1.34);

  // VS 배지
  const vsY = panelTop + panelH + 22;
  ctx.fillStyle = P.solid;
  ctx.beginPath();
  ctx.arc(CARD_W / 2, vsY + 58, 58, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = P.accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(CARD_W / 2, vsY + 58, 58, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = P.onSolid;
  setFont(ctx, 900, 34);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("VS", CARD_W / 2, vsY + 60);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  // B 패널
  const panelBTop = vsY + 138;
  fillRound(ctx, M, panelBTop, panelW, panelH, 32, P.alt);
  ctx.fillStyle = alpha(P.onAlt, 0.1);
  setFont(ctx, 900, 320);
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText("B", M + panelW - 30, panelBTop + panelH - 300);
  ctx.textAlign = "left";
  ctx.fillStyle = alpha(P.onAlt, 0.6);
  setFont(ctx, 800, 26);
  ctx.fillText(labelTextB, M + 42, panelBTop + 32);
  const bFit = fitHeading(ctx, claimB, panelW - 84, 3, 50, 32, 900);
  setFont(ctx, 900, bFit.size);
  ctx.fillStyle = P.onAlt;
  const bHeight = bFit.lines.length * bFit.size * 1.34;
  drawLines(ctx, bFit.lines, M + 42, panelBTop + 92 + Math.max(0, (panelH - 130 - bHeight) / 2), bFit.size * 1.34);

  const call = "당신은 어느 쪽? 넘겨서 투표";
  const callW = 500;
  fillRound(ctx, CARD_W / 2 - callW / 2, CARD_H - 208, callW, 56, 28, P.panel);
  ctx.fillStyle = P.fg;
  setFont(ctx, 800, 26);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(call, CARD_W / 2, CARD_H - 180);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  footer(ctx, 3, "paper");
  themeChrome(ctx);
}

/* ------------------------------------------------------------------ slide 5 */

function drawVote(ctx: Ctx, issue: Issue, accent: string, img: HTMLImageElement | null): void {
  // 위: 기사 사진 + 질문 / 아래: 강조색 패널 + 선택지 + 댓글 유도
  const panelTop = 620;

  posterBase(ctx, accent);
  if (img) {
    drawPhoto(ctx, img, 0, 0, CARD_W, panelTop + 40, 0, 0.36);
  }
  topScrim(ctx, 300);
  const fade = ctx.createLinearGradient(0, panelTop - 260, 0, panelTop + 10);
  fade.addColorStop(0, `rgba(${P.scrim},0.05)`);
  fade.addColorStop(1, `rgba(${P.scrim},0.92)`);
  ctx.fillStyle = fade;
  ctx.fillRect(0, panelTop - 260, CARD_W, 270);

  // 사진 위 라벨
  ctx.fillStyle = P.accentText;
  ctx.beginPath();
  ctx.arc(M + 8, 110, 8, 0, Math.PI * 2);
  ctx.fill();
  setFont(ctx, 900, 30);
  ctx.fillStyle = P.photoInk;
  ctx.fillText("04 · 당신의 선택", M + 26, 90);

  const question = issue.poll.question;
  const qFit = fitHeading(ctx, question, CARD_W - M * 2, 3, 76, 46, 900);
  setFont(ctx, 900, qFit.size);
  const qTop = 158;
  ctx.shadowColor = isLight(P.paper) ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = P.photoInk;
  drawLines(ctx, qFit.lines, M, qTop, qFit.size * 1.1);
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // 아래 강조 패널
  const panel = ctx.createLinearGradient(0, panelTop, 0, CARD_H);
  panel.addColorStop(0, P.accent);
  panel.addColorStop(1, P.accentDeep);
  ctx.fillStyle = panel;
  roundRect(ctx, -40, panelTop, CARD_W + 80, CARD_H - panelTop + 80, 46);
  ctx.fill();

  // 패널 안 워터마크
  ctx.fillStyle = alpha(P.onAccent, 0.07);
  setFont(ctx, 900, 380);
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText("A/B", CARD_W - M + 30, CARD_H - 430);
  ctx.textAlign = "left";

  // 질문 아래 한 줄 맥락
  const context = issue.point && issue.point.trim() !== question.trim() ? issue.point : issue.kicker;
  if (context) {
    const contextFit = fitHeading(ctx, context, CARD_W - M * 2, 2, 36, 26, 700);
    setFont(ctx, 700, contextFit.size);
    ctx.fillStyle = alpha(P.onAccent, 0.7);
    drawLines(ctx, contextFit.lines, M, panelTop + 34, contextFit.size * 1.36);
  }

  const options = [
    { key: "A", text: issue.poll.a },
    { key: "B", text: issue.poll.b },
  ];
  let optionTop = panelTop + 120;
  for (const option of options) {
    const rowH = 112;
    fillRound(ctx, M, optionTop, CARD_W - M * 2, rowH, 22, "rgba(255,255,255,0.5)");
    strokeRound(ctx, M, optionTop, CARD_W - M * 2, rowH, 22, alpha(P.onAccent, 0.9), 3);
    fillRound(ctx, M + 20, optionTop + 21, 74, 74, 18, P.solid);
    ctx.fillStyle = P.onSolid;
    setFont(ctx, 900, 36);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(option.key, M + 57, optionTop + 60);
    ctx.textAlign = "left";

    setFont(ctx, 800, 42);
    ctx.fillStyle = P.onAccent;
    const textLines = wrapText(ctx, option.text, CARD_W - M * 2 - 150, 1);
    ctx.fillText(textLines[0] ?? "", M + 120, optionTop + 56);
    ctx.textBaseline = "top";
    optionTop += rowH + 14;
  }

  // 댓글 유도 엔딩 카드
  const ctaMinH = 196;
  const ctaTop = Math.min(optionTop + 22, CARD_H - 150 - ctaMinH);
  const ctaH = CARD_H - 150 - ctaTop;
  fillRound(ctx, M, ctaTop, CARD_W - M * 2, ctaH, 30, P.solid);

  // 말풍선
  ctx.fillStyle = P.alt;
  roundRect(ctx, M + 36, ctaTop + 34, 62, 52, 16);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(M + 54, ctaTop + 84);
  ctx.lineTo(M + 74, ctaTop + 104);
  ctx.lineTo(M + 84, ctaTop + 84);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = P.onAlt;
  setFont(ctx, 900, 26);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("···", M + 67, ctaTop + 60);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  ctx.fillStyle = popOnSolid();
  setFont(ctx, 900, 38);
  ctx.fillText("댓글로 A 아니면 B", M + 120, ctaTop + 38);
  setFont(ctx, 700, 26);
  ctx.fillStyle = alpha(P.onSolid, 0.7);
  ctx.fillText("이유도 한 줄 남기면 토론이 붙어요", M + 120, ctaTop + 96);

  setFont(ctx, 800, 27);
  ctx.fillStyle = alpha(P.onSolid, 0.55);
  ctx.fillText("저장해 두고 다시 보기 · 프로필 링크에서 바로 투표", M + 36, ctaTop + ctaH - 52);

  footer(ctx, 4, "accent", "원문 기사 링크는 프로필에");
  themeChrome(ctx);
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
 * ① 같은 출처 프록시(/api/img) → ② 원본 직접(CORS 허용 시) → ③ 없음(포스터 배경).
 * 프록시를 거치지 않으면 언론사 서버가 CORS 헤더를 안 줄 때 캔버스가 오염돼 PNG 저장이 막힙니다.
 * 어느 쪽도 실패하면 사진 없이 그래픽 카드로 그려 저장이 막히지 않습니다.
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
  const meta = CATEGORY_META[issue.category];
  const img = await loadIssueImage(issue.image);

  // 그리기는 전부 동기라, 여기서 테마를 정하면 이 한 장 안에서 바뀌지 않습니다.
  useOptions(options);

  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  if (index === 0) drawCover(ctx, issue, meta.color, img);
  else if (index === 1) drawFacts(ctx, issue, meta.color, img);
  else if (index === 2) drawWhy(ctx, issue, meta.color, img);
  else if (index === 3) drawSides(ctx, issue, meta.color);
  else drawVote(ctx, issue, meta.color, img);

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
