/**
 * 카드뉴스 PNG 만들기 — 인스타그램 4:5(1080×1350) 규격으로 5장을 캔버스에 직접 그립니다.
 * 화면(DOM)과 같은 문구·같은 순서를 쓰되, 저장용 이미지는 '포스터'로 다시 조판합니다.
 *  ① 표지(검정) ② 팩트(아이보리) ③ 쟁점(검정) ④ A vs B(라임·주황) ⑤ 투표(라임)
 */

import { CATEGORY_META, type Issue } from "../types";
import { timeAgo } from "./format";
import { buildZip } from "./zip";

export const CARD_W = 1080;
export const CARD_H = 1350;
export const SLIDE_COUNT = 5;

const M = 82;
const BG = "#0b0b0c";
const CREAM = "#f2f0ea";
const WHITE = "#fffdf8";
const LIME = "#d9ff3d";
const ORANGE = "#ff6a3d";
const SANS = '"Pretendard Variable", Pretendard, "SUIT Variable", SUIT, sans-serif';

type Ctx = CanvasRenderingContext2D;

/* ---------------------------------------------------------------- helpers */

function setFont(ctx: Ctx, weight: number, size: number): void {
  ctx.font = `${weight} ${size}px ${SANS}`;
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
  for (let size = start; size >= min; size -= 4) {
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

function darkBackground(ctx: Ctx, accent: string): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const glow = ctx.createRadialGradient(CARD_W + 40, -40, 20, CARD_W + 40, -40, 780);
  glow.addColorStop(0, `${accent}aa`);
  glow.addColorStop(0.5, `${accent}33`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  const warm = ctx.createRadialGradient(-90, CARD_H + 80, 10, -90, CARD_H + 80, 620);
  warm.addColorStop(0, "rgba(255,106,61,0.34)");
  warm.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
}

function creamBackground(ctx: Ctx): void {
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
}

function limeBackground(ctx: Ctx): void {
  ctx.fillStyle = LIME;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
}

function brand(ctx: Ctx, index: number, onDark: boolean): void {
  const color = onDark ? "rgba(255,253,248,0.5)" : "rgba(11,11,12,0.45)";
  ctx.fillStyle = color;
  setFont(ctx, 800, 24);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("이슈온도계", M, CARD_H - 66);
  ctx.textAlign = "right";
  setFont(ctx, 600, 24);
  ctx.fillText(`${index + 1} / ${SLIDE_COUNT}`, CARD_W - M, CARD_H - 66);
  ctx.textAlign = "left";
}

function eyebrow(ctx: Ctx, text: string, color: string, dot: string, y: number): void {
  ctx.fillStyle = dot;
  ctx.beginPath();
  ctx.arc(M + 7, y + 13, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  setFont(ctx, 900, 30);
  ctx.textBaseline = "top";
  ctx.fillText(text, M + 28, y);
}

/** 오른쪽 위 온도 — 카드뉴스에서도 '지금 몇 도'인지 바로 보이게. */
function tempBadge(ctx: Ctx, issue: Issue, right = CARD_W - M, top = 84): void {
  if (issue.temp === null) return;
  ctx.textAlign = "right";
  ctx.fillStyle = "#ff8a5c";
  setFont(ctx, 900, 62);
  ctx.textBaseline = "top";
  ctx.fillText(`${issue.temp}°`, right, top);
  ctx.fillStyle = "rgba(255,253,248,0.45)";
  setFont(ctx, 700, 22);
  ctx.fillText("논란 온도", right, top + 68);
  ctx.textAlign = "left";
}

/* ------------------------------------------------------------------ slides */

function drawCover(ctx: Ctx, issue: Issue, accent: string): void {
  darkBackground(ctx, accent);

  ctx.fillStyle = "rgba(255,255,255,0.05)";
  setFont(ctx, 900, 220);
  ctx.textAlign = "right";
  ctx.fillText("01", CARD_W - M, CARD_H - 400);
  ctx.textAlign = "left";

  // 카테고리 칩
  const label = CATEGORY_META[issue.category].label;
  setFont(ctx, 800, 28);
  const chipW = ctx.measureText(label).width + 62;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  roundRect(ctx, M, 84, chipW, 58, 29);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.textBaseline = "middle";
  ctx.fillText(label, M + 31, 114);
  ctx.textBaseline = "top";

  tempBadge(ctx, issue);

  ctx.fillStyle = "rgba(255,253,248,0.42)";
  setFont(ctx, 800, 22);
  ctx.fillText("T O D A Y ' S   I S S U E", M, 250);

  const heading = fitHeading(ctx, issue.hook, CARD_W - M * 2, 5, 104, 58);
  ctx.fillStyle = WHITE;
  const lineHeight = heading.size * 1.12;
  const blockHeight = heading.lines.length * lineHeight;
  const top = Math.max(330, 690 - blockHeight / 2);
  drawLines(ctx, heading.lines, M, top, lineHeight);

  if (issue.kicker) {
    setFont(ctx, 600, 38);
    ctx.fillStyle = "rgba(255,253,248,0.7)";
    const kicker = wrapText(ctx, issue.kicker, CARD_W - M * 2, 2);
    drawLines(ctx, kicker, M, top + blockHeight + 34, 52);
  }

  ctx.strokeStyle = "rgba(255,253,248,0.22)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(M, CARD_H - 170);
  ctx.lineTo(CARD_W - M, CARD_H - 170);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,253,248,0.55)";
  setFont(ctx, 700, 26);
  ctx.fillText(`${issue.source} · ${timeAgo(issue.publishedAt)}`, M, CARD_H - 142);

  ctx.textAlign = "right";
  ctx.fillStyle = LIME;
  setFont(ctx, 800, 26);
  ctx.fillText("밀어서 보기 →", CARD_W - M, CARD_H - 142);
  ctx.textAlign = "left";

  brand(ctx, 0, true);
}

function drawFacts(ctx: Ctx, issue: Issue, accent: string): void {
  creamBackground(ctx);

  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, CARD_W, 10);

  eyebrow(ctx, "01 · 무슨 일인데", "#0b0b0c", "#0b0b0c", 96);

  const facts = issue.facts.slice(0, 3);
  const gap = 46;
  const box = 74;
  const textX = M + box + 30;
  const maxWidth = CARD_W - textX - M;
  const fittedFacts = facts.map((fact) => fitHeading(ctx, fact, maxWidth, 3, 46, 32, 700));
  const heights = fittedFacts.map((fitted) => Math.max(box, fitted.lines.length * fitted.size * 1.42));
  const totalHeight = heights.reduce((sum, height) => sum + height, 0) + gap * Math.max(0, facts.length - 1);
  let cursor = Math.max(232, (CARD_H - 320 - totalHeight) / 2 + 40);

  facts.forEach((_, index) => {
    setFont(ctx, 900, 44);
    ctx.fillStyle = "#0b0b0c";
    roundRect(ctx, M, cursor, box, box, 18);
    ctx.fill();
    ctx.fillStyle = CREAM;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), M + box / 2, cursor + box / 2 + 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    const fitted = fittedFacts[index];
    ctx.fillStyle = "#14120f";
    const used = drawLines(ctx, fitted.lines, textX, cursor + 6, fitted.size * 1.42);
    cursor = Math.max(cursor + box, used) + gap;
  });

  ctx.strokeStyle = "rgba(11,11,12,0.16)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(M, CARD_H - 300);
  ctx.lineTo(CARD_W - M, CARD_H - 300);
  ctx.stroke();

  const original = issue.title.length > 44 ? `${issue.title.slice(0, 43)}…` : issue.title;
  ctx.fillStyle = "rgba(11,11,12,0.5)";
  setFont(ctx, 600, 23);
  ctx.fillText(`원문 · ${issue.source} · ${original}`, M, CARD_H - 268);

  if (issue.tags.length > 0) {
    setFont(ctx, 800, 24);
    ctx.fillStyle = "#0b0b0c";
    ctx.fillText(issue.tags.map((tag) => `#${tag}`).join("  "), M, CARD_H - 218);
  }

  brand(ctx, 1, false);
}

function drawIssue(ctx: Ctx, issue: Issue, accent: string): void {
  darkBackground(ctx, accent);

  eyebrow(ctx, "02 · 왜 지금 뜨나", WHITE, LIME, 96);

  const background = issue.background || issue.kicker;
  const fitted = fitHeading(ctx, background, CARD_W - M * 2, 6, 44, 32, 600);
  ctx.fillStyle = "rgba(255,253,248,0.8)";
  const bodyHeight = fitted.lines.length * fitted.size * 1.6;
  const startY = Math.max(210, (CARD_H - bodyHeight - 380) / 2);
  const afterBody = drawLines(ctx, fitted.lines, M, startY, fitted.size * 1.6);

  const boxTop = Math.min(CARD_H - 400, afterBody + 54);
  const point = issue.point || issue.poll.question;
  const pointFit = fitHeading(ctx, point, CARD_W - M * 2 - 76, 3, 50, 34, 900);
  const boxH = Math.max(240, pointFit.lines.length * pointFit.size * 1.26 + 130);

  ctx.fillStyle = LIME;
  roundRect(ctx, M, boxTop, CARD_W - M * 2, boxH, 30);
  ctx.fill();

  ctx.fillStyle = "#0b0b0c";
  setFont(ctx, 900, 26);
  ctx.fillText("핵심 쟁점", M + 38, boxTop + 36);

  ctx.fillStyle = "#0b0b0c";
  drawLines(ctx, pointFit.lines, M + 38, boxTop + 84, pointFit.size * 1.26);

  ctx.fillStyle = "rgba(255,253,248,0.45)";
  setFont(ctx, 600, 24);
  ctx.fillText(`${issue.source} 보도 · ${timeAgo(issue.publishedAt)}`, M, CARD_H - 150);

  brand(ctx, 2, true);
}

function drawSides(ctx: Ctx, issue: Issue): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const sides = issue.sides;

  eyebrow(ctx, "03 · A vs B", WHITE, LIME, 96);

  const top = 200;
  const panelH = 420;
  const width = CARD_W - M * 2;

  ctx.fillStyle = LIME;
  roundRect(ctx, M, top, width, panelH, 30);
  ctx.fill();
  ctx.fillStyle = "rgba(11,11,12,0.65)";
  setFont(ctx, 700, 26);
  ctx.fillText(`A · ${sides?.labelA ?? "한쪽은"}`, M + 40, top + 34);

  const aFit = fitHeading(ctx, sides?.a ?? "이 카드는 아직 양쪽 입장 정리가 없어요", width - 80, 4, 46, 30, 800);
  const aHeight = aFit.lines.length * aFit.size * 1.36;
  ctx.fillStyle = "#0b0b0c";
  drawLines(ctx, aFit.lines, M + 40, top + 92 + Math.max(0, (panelH - 132 - aHeight) / 2), aFit.size * 1.36);

  const vsY = top + panelH + 26;
  ctx.fillStyle = BG;
  roundRect(ctx, CARD_W / 2 - 52, vsY, 104, 64, 32);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,253,248,0.3)";
  ctx.lineWidth = 1;
  roundRect(ctx, CARD_W / 2 - 52, vsY, 104, 64, 32);
  ctx.stroke();
  ctx.fillStyle = WHITE;
  setFont(ctx, 800, 28);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("VS", CARD_W / 2, vsY + 33);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  const bottomTop = vsY + 90;
  ctx.fillStyle = ORANGE;
  roundRect(ctx, M, bottomTop, width, panelH, 30);
  ctx.fill();
  ctx.fillStyle = "rgba(11,11,12,0.7)";
  setFont(ctx, 700, 26);
  ctx.fillText(`B · ${sides?.labelB ?? "다른 쪽은"}`, M + 40, bottomTop + 34);

  const bFit = fitHeading(ctx, sides?.b ?? "원문에서 확인해 주세요", width - 80, 4, 46, 30, 800);
  const bHeight = bFit.lines.length * bFit.size * 1.36;
  ctx.fillStyle = "#0b0b0c";
  drawLines(ctx, bFit.lines, M + 40, bottomTop + 92 + Math.max(0, (panelH - 132 - bHeight) / 2), bFit.size * 1.36);

  ctx.fillStyle = "rgba(255,253,248,0.45)";
  setFont(ctx, 600, 24);
  ctx.fillText("넘겨서 바로 투표하고 토론해 보세요 →", M, CARD_H - 160);

  brand(ctx, 3, true);
}

function drawQuestion(ctx: Ctx, issue: Issue): void {
  limeBackground(ctx);

  ctx.fillStyle = "#0b0b0c";
  ctx.beginPath();
  ctx.arc(M + 7, 110, 7, 0, Math.PI * 2);
  ctx.fill();
  setFont(ctx, 900, 30);
  ctx.fillText("04 · 당신은?", M + 28, 96);

  const heading = fitHeading(ctx, issue.point || issue.poll.question, CARD_W - M * 2, 3, 88, 52);
  ctx.fillStyle = "#0b0b0c";
  drawLines(ctx, heading.lines, M, 200, heading.size * 1.06);

  const qTop = 200 + heading.lines.length * heading.size * 1.06 + 44;
  const qFit = fitHeading(ctx, issue.poll.question, CARD_W - M * 2, 3, 46, 32, 700);
  ctx.fillStyle = "rgba(11,11,12,0.72)";
  drawLines(ctx, qFit.lines, M, qTop, qFit.size * 1.4);

  const optionTop = Math.max(
    qTop + qFit.lines.length * qFit.size * 1.4 + 48,
    CARD_H - 520,
  );
  (
    [
      { key: "A", text: issue.poll.a },
      { key: "B", text: issue.poll.b },
    ] as const
  ).forEach((option, index) => {
    const y = optionTop + index * 150;
    ctx.strokeStyle = "#0b0b0c";
    ctx.lineWidth = 3;
    roundRect(ctx, M, y, CARD_W - M * 2, 122, 20);
    ctx.stroke();
    ctx.fillStyle = "#0b0b0c";
    roundRect(ctx, M + 20, y + 23, 76, 76, 16);
    ctx.fill();
    ctx.fillStyle = LIME;
    setFont(ctx, 900, 38);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(option.key, M + 58, y + 63);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    const lines = wrapText(ctx, option.text, CARD_W - M * 2 - 140, 1);
    ctx.fillStyle = "#0b0b0c";
    setFont(ctx, 800, 40);
    ctx.fillText(lines[0] ?? "", M + 122, y + 38);
  });

  ctx.fillStyle = "rgba(11,11,12,0.6)";
  setFont(ctx, 700, 28);
  ctx.fillText("댓글로 A 아니면 B, 이유도 한 줄 남겨 주세요", M, CARD_H - 250);

  ctx.fillStyle = "rgba(11,11,12,0.45)";
  setFont(ctx, 600, 22);
  ctx.fillText(`${issue.source} · 원문은 카드 링크에서`, M, CARD_H - 200);

  brand(ctx, 4, false);
}

/* ------------------------------------------------------------------ export */

async function ensureFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all([
      document.fonts.load(`900 96px ${SANS}`),
      document.fonts.load(`800 48px ${SANS}`),
      document.fonts.load(`700 40px ${SANS}`),
      document.fonts.load(`600 32px ${SANS}`),
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

  if (index === 0) drawCover(ctx, issue, meta.color);
  else if (index === 1) drawFacts(ctx, issue, meta.color);
  else if (index === 2) drawIssue(ctx, issue, meta.color);
  else if (index === 3) drawSides(ctx, issue);
  else drawQuestion(ctx, issue);

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
