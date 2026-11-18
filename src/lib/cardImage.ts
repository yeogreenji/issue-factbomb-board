/**
 * 카드뉴스 PNG 만들기 — 인스타그램 4:5(1080×1350) 규격으로 5장을 캔버스에 직접 그립니다.
 * 화면(DOM)과 같은 문구·같은 순서를 쓰지만, 저장용 이미지는 글자 크기와 여백을 따로 잡아
 * 폰 화면 캡처가 아니라 '카드뉴스 원본'으로 바로 올릴 수 있게 만듭니다.
 */

import { CATEGORY_META, type Issue } from "../types";
import { timeAgo } from "./format";
import { buildZip } from "./zip";

export const CARD_W = 1080;
export const CARD_H = 1350;
export const SLIDE_COUNT = 5;

const M = 84;
const INK = "#14100c";
const PAPER = "#f5f0e6";
const SANS = '"Pretendard Variable", Pretendard, "Noto Sans KR", -apple-system, sans-serif';
const SERIF = '"Noto Serif KR", "Nanum Myeongjo", serif';

type Ctx = CanvasRenderingContext2D;

/* ---------------------------------------------------------------- helpers */

function setFont(ctx: Ctx, weight: number, size: number, family = SANS): void {
  ctx.font = `${weight} ${size}px ${family}`;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** 한글은 띄어쓰기 단위로, 한 단어가 폭을 넘으면 글자 단위로 잘라 줄바꿈합니다. */
function wrapText(ctx: Ctx, text: string, maxWidth: number, maxLines: number): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const lines: string[] = [];
  let line = "";

  const pushLine = () => {
    if (line) lines.push(line);
    line = "";
  };

  for (const word of clean.split(" ")) {
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
  family = SERIF,
  weight = 900,
): { size: number; lines: string[] } {
  for (let size = start; size >= min; size -= 4) {
    setFont(ctx, weight, size, family);
    const lines = wrapText(ctx, text, maxWidth, maxLines);
    const fits = lines.length <= maxLines && lines.every((line) => ctx.measureText(line).width <= maxWidth);
    if (fits) return { size, lines };
  }
  setFont(ctx, weight, min, family);
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

function paperBackground(ctx: Ctx): void {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = "rgba(23, 19, 15, 0.05)";
  for (let y = 0; y < CARD_H; y += 8) {
    for (let x = (y / 8) % 2 === 0 ? 0 : 4; x < CARD_W; x += 8) ctx.fillRect(x, y, 1, 1);
  }
}

function inkBackground(ctx: Ctx, accent: string): void {
  const gradient = ctx.createLinearGradient(0, 0, CARD_W, CARD_H);
  gradient.addColorStop(0, "#221a12");
  gradient.addColorStop(0.55, INK);
  gradient.addColorStop(1, "#1b1310");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const glow = ctx.createRadialGradient(CARD_W - 90, 150, 20, CARD_W - 90, 150, 700);
  glow.addColorStop(0, `${accent}66`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
}

function brand(ctx: Ctx, index: number, onDark: boolean): void {
  const color = onDark ? "rgba(255,253,248,0.62)" : "rgba(23,19,15,0.42)";
  ctx.fillStyle = color;
  setFont(ctx, 700, 26, SANS);
  ctx.textAlign = "left";
  ctx.fillText("이슈온도계", M, CARD_H - 74);
  ctx.textAlign = "right";
  setFont(ctx, 600, 26, SANS);
  ctx.fillText(`${index + 1} / ${SLIDE_COUNT}`, CARD_W - M, CARD_H - 74);
  ctx.textAlign = "left";
}

function eyebrow(ctx: Ctx, text: string, accent: string, y: number): void {
  ctx.fillStyle = accent;
  roundRect(ctx, M, y - 6, 10, 44, 5);
  ctx.fill();
  ctx.fillStyle = accent;
  setFont(ctx, 800, 32, SANS);
  ctx.textBaseline = "top";
  ctx.fillText(text, M + 26, y - 2);
}

function footerSource(ctx: Ctx, issue: Issue, y: number): void {
  ctx.fillStyle = "rgba(23,19,15,0.5)";
  setFont(ctx, 500, 24, SANS);
  const original = issue.title.length > 46 ? `${issue.title.slice(0, 45)}…` : issue.title;
  ctx.fillText(`원문 · ${issue.source} · ${original}`, M, y);
}

/* ------------------------------------------------------------------ slides */

function drawCover(ctx: Ctx, issue: Issue, accent: string, soft: string): void {
  inkBackground(ctx, accent);

  ctx.fillStyle = "rgba(255,255,255,0.05)";
  setFont(ctx, 900, 420, SERIF);
  ctx.fillText("01", CARD_W - 430, CARD_H - 260);

  const categoryLabel = CATEGORY_META[issue.category].label;
  setFont(ctx, 800, 30, SANS);
  const chipW = ctx.measureText(categoryLabel).width;
  ctx.fillStyle = accent;
  roundRect(ctx, M, 96, Math.max(150, chipW + 60), 62, 31);
  ctx.fill();
  ctx.fillStyle = "#fffdf8";
  ctx.textBaseline = "middle";
  ctx.fillText(categoryLabel, M + 30, 128);
  ctx.textBaseline = "top";

  if (issue.temp !== null) {
    ctx.textAlign = "right";
    ctx.fillStyle = "#ff8a5c";
    setFont(ctx, 900, 62, SERIF);
    ctx.fillText(`${issue.temp}°`, CARD_W - M, 98);
    ctx.fillStyle = "rgba(255,253,248,0.55)";
    setFont(ctx, 600, 26, SANS);
    ctx.fillText("지금 온도", CARD_W - M, 168);
    ctx.textAlign = "left";
  }

  const heading = fitHeading(ctx, issue.hook, CARD_W - M * 2, 4, 104, 62);
  setFont(ctx, 900, heading.size, SERIF);
  ctx.fillStyle = "#fffdf8";
  const lineHeight = heading.size * 1.18;
  const blockHeight = heading.lines.length * lineHeight;
  const top = 520 - blockHeight / 2;
  drawLines(ctx, heading.lines, M, top, lineHeight);

  ctx.fillStyle = accent;
  ctx.fillRect(M, top - 54, 96, 10);

  if (issue.kicker) {
    setFont(ctx, 500, 38, SANS);
    ctx.fillStyle = "rgba(255,253,248,0.78)";
    const kicker = wrapText(ctx, issue.kicker, CARD_W - M * 2, 2);
    drawLines(ctx, kicker, M, top + blockHeight + 34, 54);
  }

  ctx.fillStyle = "rgba(255,253,248,0.5)";
  setFont(ctx, 600, 28, SANS);
  ctx.fillText(`${issue.source} · ${timeAgo(issue.publishedAt)}`, M, CARD_H - 190);

  ctx.fillStyle = soft;
  roundRect(ctx, M, CARD_H - 150, 300, 4, 2);
  ctx.fill();

  brand(ctx, 0, true);
}

function drawFacts(ctx: Ctx, issue: Issue, accent: string, soft: string): void {
  paperBackground(ctx);

  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, CARD_W, 12);

  eyebrow(ctx, "01 · 무슨 일인데", accent, 104);

  const facts = issue.facts.slice(0, 3);
  const startY = 250;
  const gap = 56;
  let cursor = startY;

  facts.forEach((fact, index) => {
    setFont(ctx, 900, 64, SERIF);
    const numberW = 96;
    ctx.fillStyle = soft;
    roundRect(ctx, M, cursor, numberW, numberW, 26);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.textAlign = "center";
    ctx.fillText(String(index + 1), M + numberW / 2, cursor + 16);
    ctx.textAlign = "left";

    const textX = M + numberW + 34;
    const maxWidth = CARD_W - textX - M;
    const fitted = fitHeading(ctx, fact, maxWidth, 3, 49, 34, SANS, 700);
    ctx.fillStyle = "#1c1712";
    const y = cursor + 8;
    const used = drawLines(ctx, fitted.lines, textX, y, fitted.size * 1.44);
    cursor = Math.max(cursor + numberW, used) + gap;
  });

  ctx.fillStyle = "rgba(23,19,15,0.08)";
  ctx.fillRect(M, CARD_H - 300, CARD_W - M * 2, 2);
  footerSource(ctx, issue, CARD_H - 260);
  if (issue.tags.length > 0) {
    setFont(ctx, 600, 26, SANS);
    ctx.fillStyle = accent;
    ctx.fillText(issue.tags.map((tag) => `#${tag}`).join("  "), M, CARD_H - 210);
  }
  brand(ctx, 1, false);
}

function drawIssue(ctx: Ctx, issue: Issue, accent: string, soft: string): void {
  paperBackground(ctx);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, CARD_W, 12);

  eyebrow(ctx, "02 · 왜 지금 뜨나", accent, 104);

  const background = issue.background || issue.kicker;
  const fitted = fitHeading(ctx, background, CARD_W - M * 2, 6, 46, 34, SANS, 600);
  ctx.fillStyle = "#241d16";
  const bodyHeight = fitted.lines.length * fitted.size * 1.62;
  const boxHeight = 300;
  const startY = Math.max(196, (CARD_H - bodyHeight - 70 - boxHeight) / 2 - 20);
  const afterBody = drawLines(ctx, fitted.lines, M, startY, fitted.size * 1.62);

  const boxTop = Math.min(CARD_H - 420, afterBody + 64);
  ctx.fillStyle = soft;
  roundRect(ctx, M, boxTop, CARD_W - M * 2, boxHeight, 34);
  ctx.fill();

  ctx.fillStyle = accent;
  setFont(ctx, 800, 28, SANS);
  ctx.fillText("핵심 쟁점", M + 40, boxTop + 40);

  const point = issue.point || issue.poll.question;
  const pointFit = fitHeading(ctx, point, CARD_W - M * 2 - 80, 3, 48, 34, SERIF, 800);
  ctx.fillStyle = "#1c1712";
  drawLines(ctx, pointFit.lines, M + 40, boxTop + 96, pointFit.size * 1.32);

  ctx.fillStyle = "rgba(23,19,15,0.45)";
  setFont(ctx, 500, 26, SANS);
  ctx.fillText(`${issue.source} 보도 · ${timeAgo(issue.publishedAt)}`, M, CARD_H - 150);
  brand(ctx, 2, false);
}

function drawSides(ctx: Ctx, issue: Issue, accent: string, soft: string): void {
  paperBackground(ctx);
  const sides = issue.sides;

  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, CARD_W, 12);
  eyebrow(ctx, "03 · A vs B", accent, 104);

  const top = 220;
  const panelH = 420;

  ctx.fillStyle = soft;
  roundRect(ctx, M, top, CARD_W - M * 2, panelH, 34);
  ctx.fill();
  ctx.fillStyle = accent;
  setFont(ctx, 800, 30, SANS);
  ctx.fillText(`A · ${sides?.labelA ?? "한쪽은"}`, M + 40, top + 34);

  const aFit = fitHeading(ctx, sides?.a ?? "이 카드는 아직 양쪽 입장 정리가 없어요", CARD_W - M * 2 - 80, 4, 46, 32, SANS, 700);
  ctx.fillStyle = "#1c1712";
  drawLines(ctx, aFit.lines, M + 40, top + 100, aFit.size * 1.4);

  const vsY = top + panelH + 34;
  ctx.fillStyle = INK;
  roundRect(ctx, CARD_W / 2 - 54, vsY, 108, 76, 26);
  ctx.fill();
  ctx.fillStyle = "#fffdf8";
  setFont(ctx, 900, 40, SERIF);
  ctx.textAlign = "center";
  ctx.fillText("VS", CARD_W / 2, vsY + 16);
  ctx.textAlign = "left";

  const bottomTop = vsY + 110;
  ctx.fillStyle = INK;
  roundRect(ctx, M, bottomTop, CARD_W - M * 2, panelH, 34);
  ctx.fill();
  ctx.fillStyle = "#ff9a6d";
  setFont(ctx, 800, 30, SANS);
  ctx.fillText(`B · ${sides?.labelB ?? "다른 쪽은"}`, M + 40, bottomTop + 34);

  const bFit = fitHeading(ctx, sides?.b ?? "원문에서 확인해 주세요", CARD_W - M * 2 - 80, 4, 46, 32, SANS, 700);
  ctx.fillStyle = "#fffdf8";
  drawLines(ctx, bFit.lines, M + 40, bottomTop + 100, bFit.size * 1.4);

  brand(ctx, 3, false);
}

function drawQuestion(ctx: Ctx, issue: Issue, accent: string): void {
  inkBackground(ctx, accent);

  ctx.fillStyle = accent;
  setFont(ctx, 800, 30, SANS);
  ctx.fillText("04 · 당신은?", M, 110);

  const heading = fitHeading(ctx, issue.point || issue.poll.question, CARD_W - M * 2, 3, 76, 44);
  ctx.fillStyle = "#fffdf8";
  drawLines(ctx, heading.lines, M, 210, heading.size * 1.2);

  ctx.fillStyle = accent;
  ctx.fillRect(M, 210 + heading.lines.length * heading.size * 1.2 + 30, 96, 10);

  const questionY = 720;
  const qFit = fitHeading(ctx, issue.poll.question, CARD_W - M * 2, 3, 54, 36, SANS, 700);
  ctx.fillStyle = "rgba(255,253,248,0.86)";
  drawLines(ctx, qFit.lines, M, questionY, qFit.size * 1.4);

  const optionY = questionY + qFit.lines.length * qFit.size * 1.4 + 40;
  ([
    { key: "A", text: issue.poll.a },
    { key: "B", text: issue.poll.b },
  ] as const).forEach((option, index) => {
    const y = optionY + index * 128;
    ctx.strokeStyle = "rgba(255,253,248,0.28)";
    ctx.lineWidth = 2;
    roundRect(ctx, M, y, CARD_W - M * 2, 104, 26);
    ctx.stroke();
    ctx.fillStyle = accent;
    roundRect(ctx, M + 18, y + 20, 64, 64, 20);
    ctx.fill();
    ctx.fillStyle = "#fffdf8";
    setFont(ctx, 900, 34, SANS);
    ctx.textAlign = "center";
    ctx.fillText(option.key, M + 50, y + 32);
    ctx.textAlign = "left";
    setFont(ctx, 600, 36, SANS);
    ctx.fillStyle = "#fffdf8";
    const lines = wrapText(ctx, option.text, CARD_W - M * 2 - 130, 1);
    ctx.fillText(lines[0] ?? "", M + 104, y + 32);
  });

  ctx.fillStyle = "rgba(255,253,248,0.6)";
  setFont(ctx, 600, 28, SANS);
  ctx.fillText("댓글로 A 아니면 B, 이유도 한 줄 남겨 주세요", M, CARD_H - 250);
  ctx.fillStyle = "rgba(255,253,248,0.45)";
  setFont(ctx, 500, 24, SANS);
  ctx.fillText(`${issue.source} · ${issue.title.slice(0, 40)}${issue.title.length > 40 ? "…" : ""}`, M, CARD_H - 190);

  brand(ctx, 4, true);
}

/* ------------------------------------------------------------------ export */

async function ensureFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load(`900 96px ${SERIF}`),
      document.fonts.load(`700 40px ${SANS}`),
      document.fonts.load(`500 32px ${SANS}`),
    ]);
    await document.fonts.ready;
  } catch {
    /* 폰트를 못 받아도 기본 글꼴로 그립니다 */
  }
}

export async function renderSlide(issue: Issue, index: number): Promise<HTMLCanvasElement> {
  await ensureFonts();
  const meta = CATEGORY_META[issue.category];
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  if (index === 0) drawCover(ctx, issue, meta.color, meta.soft);
  else if (index === 1) drawFacts(ctx, issue, meta.color, meta.soft);
  else if (index === 2) drawIssue(ctx, issue, meta.color, meta.soft);
  else if (index === 3) drawSides(ctx, issue, meta.color, meta.soft);
  else drawQuestion(ctx, issue, meta.color);

  return canvas;
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("png failed"))), "image/png");
  });
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

/** 지금 보고 있는 한 장을 PNG로 저장합니다. */
export async function saveSlidePng(issue: Issue, index: number): Promise<void> {
  const canvas = await renderSlide(issue, index);
  triggerDownload(await toBlob(canvas), fileName(issue, index));
}

/** 5장을 한 번에 받을 수 있게 ZIP 한 파일로 저장합니다(폰에서 여러 번 저장이 막히는 문제 회피). */
export async function saveAllCards(issue: Issue): Promise<number> {
  const entries = [];
  for (let index = 0; index < SLIDE_COUNT; index += 1) {
    const canvas = await renderSlide(issue, index);
    const blob = await toBlob(canvas);
    entries.push({ name: fileName(issue, index), data: new Uint8Array(await blob.arrayBuffer()) });
  }
  triggerDownload(buildZip(entries), `이슈온도계_${issue.id}_5장.zip`);
  return entries.length;
}
