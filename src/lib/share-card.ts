import type { CategoryId, Comment, Issue, ReactionCounts } from '../types';
import { CATEGORY_MAP } from './content';
import { formatNumber, splitEmphasis, todayLabel } from './format';
import { tempBand, totalVotes, voteShares } from './temp';

export type CardFormat = 'portrait' | 'square';

export interface ShareCardInput {
  issue: Issue;
  temp: number;
  votes: ReactionCounts;
  topComment?: Comment;
  format: CardFormat;
}

const CATEGORY_HEX: Record<CategoryId, string> = {
  tech: '#3b57c4',
  retail: '#a65a1c',
  culture: '#b03a6a',
  work: '#2b7a63',
};

const INK = '#17130f';
const MUTED = '#837769';
const PAPER = '#f6f1e8';
const LINE = '#ded1ba';
const HEAT = '#e0451f';

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  const pushLine = (line: string) => {
    if (line.trim().length > 0) lines.push(line.trim());
  };

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) pushLine(current);
    if (ctx.measureText(word).width <= maxWidth) {
      current = word;
      continue;
    }
    // a single long token (Korean without spaces) — break on characters
    let chunk = '';
    for (const char of word) {
      if (ctx.measureText(chunk + char).width > maxWidth && chunk) {
        pushLine(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    current = chunk;
    if (lines.length >= maxLines) break;
  }
  if (current) pushLine(current);

  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1];
    while (ctx.measureText(`${last}…`).width > maxWidth && last.length > 1) {
      last = last.slice(0, -1);
    }
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}

/** Strips **bold** markers — the card carries one weight per block. */
function plain(text: string): string {
  return splitEmphasis(text)
    .map((part) => part.text)
    .join('');
}

export async function renderShareCard(input: ShareCardInput): Promise<string> {
  const { issue, temp, votes, topComment, format } = input;
  const width = 1080;
  const height = format === 'square' ? 1080 : 1350;
  const padding = 84;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas를 만들 수 없습니다.');

  try {
    await Promise.all([
      document.fonts.load('700 72px "Noto Serif KR"'),
      document.fonts.load('600 32px "Pretendard Variable"'),
      document.fonts.load('400 30px "Pretendard Variable"'),
    ]);
  } catch {
    /* fonts fall back to system faces */
  }

  const band = tempBand(temp);
  const category = CATEGORY_MAP[issue.category];
  const shares = voteShares(votes);

  // backdrop
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#faf6ee');
  bg.addColorStop(0.55, PAPER);
  bg.addColorStop(1, '#efe4d2');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // warm corner wash
  const glow = ctx.createRadialGradient(width - 60, 40, 40, width - 60, 40, 640);
  glow.addColorStop(0, 'rgba(224, 69, 31, 0.22)');
  glow.addColorStop(1, 'rgba(224, 69, 31, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // frame
  ctx.strokeStyle = 'rgba(23, 19, 15, 0.10)';
  ctx.lineWidth = 2;
  roundedRect(ctx, 28, 28, width - 56, height - 56, 26);
  ctx.stroke();

  // brand row
  ctx.fillStyle = INK;
  roundedRect(ctx, padding, 76, 34, 46, 17);
  ctx.fill();
  ctx.fillStyle = PAPER;
  roundedRect(ctx, padding + 12, 88, 10, 26, 5);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(padding + 17, 108, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = HEAT;
  ctx.beginPath();
  ctx.arc(padding + 17, 108, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.arc(padding + 17, 108, 4.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = INK;
  ctx.font = '700 34px "Pretendard Variable", "Noto Sans KR", sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('이슈온도계', padding + 50, 112);

  ctx.fillStyle = MUTED;
  ctx.font = '500 20px "Pretendard Variable", "Noto Sans KR", sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillText('FACTBOMB BOARD', padding + 202, 110);
  ctx.letterSpacing = '0px';

  ctx.textAlign = 'right';
  ctx.fillStyle = MUTED;
  ctx.font = '500 22px "Pretendard Variable", "Noto Sans KR", sans-serif';
  ctx.fillText(todayLabel(), width - padding, 108);
  ctx.textAlign = 'left';

  // category pill
  let y = 198;
  ctx.font = '600 24px "Pretendard Variable", "Noto Sans KR", sans-serif';
  const catLabel = `${category.label}`;
  const pillWidth = ctx.measureText(catLabel).width + 46;
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  roundedRect(ctx, padding, y - 32, pillWidth, 50, 25);
  ctx.fill();
  ctx.fillStyle = CATEGORY_HEX[issue.category];
  ctx.beginPath();
  ctx.arc(padding + 22, y - 7, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillText(catLabel, padding + 38, y + 1);

  // hot chip
  const hotLabel = `${band.emoji} ${band.label}`;
  ctx.font = '700 24px "Pretendard Variable", "Noto Sans KR", sans-serif';
  const hotWidth = ctx.measureText(hotLabel).width + 44;
  ctx.fillStyle = 'rgba(224,69,31,0.10)';
  roundedRect(ctx, padding + pillWidth + 12, y - 32, hotWidth, 50, 25);
  ctx.fill();
  ctx.fillStyle = HEAT;
  ctx.fillText(hotLabel, padding + pillWidth + 34, y + 1);

  // headline
  const L =
    format === 'square'
      ? {
          headFont: 54,
          headLH: 74,
          headOffset: 94,
          tempFont: 130,
          tempAsc: 106,
          degFont: 50,
          degAsc: 82,
          labelTop: 34,
          labelMid: 72,
          labelBottom: 106,
          meterOffset: 146,
          voteOffset: 62,
          quoteFont: 30,
          quoteLH: 42,
          cardGap: 58,
          cardDesired: 176,
          quoteMax: 2,
        }
      : {
          headFont: 70,
          headLH: 96,
          headOffset: 108,
          tempFont: 168,
          tempAsc: 138,
          degFont: 62,
          degAsc: 100,
          labelTop: 40,
          labelMid: 88,
          labelBottom: 128,
          meterOffset: 196,
          voteOffset: 78,
          quoteFont: 34,
          quoteLH: 48,
          cardGap: 76,
          cardDesired: 232,
          quoteMax: 3,
        };

  ctx.fillStyle = INK;
  ctx.font = `700 ${L.headFont}px "Noto Serif KR", "Noto Serif CJK KR", serif`;
  const headlineLines = wrapText(ctx, issue.headline, width - padding * 2, 3);
  let headlineY = y + L.headOffset;
  for (const line of headlineLines) {
    ctx.fillText(line, padding, headlineY);
    headlineY += L.headLH;
  }
  const headlineBottom = headlineY - L.headLH + 26;

  // kicker
  ctx.fillStyle = MUTED;
  ctx.font = '500 26px "Pretendard Variable", "Noto Sans KR", sans-serif';
  const kickerLines = wrapText(ctx, issue.kicker, width - padding * 2, 2);
  let kickerY = headlineBottom + (format === 'square' ? 36 : 44);
  for (const line of kickerLines) {
    ctx.fillText(line, padding, kickerY);
    kickerY += 34;
  }

  // temperature block
  const tempTop = kickerY + 8;
  ctx.fillStyle = HEAT;
  ctx.font = `900 ${L.tempFont}px "Pretendard Variable", "Noto Sans KR", sans-serif`;
  ctx.fillText(String(temp), padding - 4, tempTop + L.tempAsc);
  const tempWidth = ctx.measureText(String(temp)).width;
  ctx.font = `700 ${L.degFont}px "Pretendard Variable", "Noto Sans KR", sans-serif`;
  ctx.fillText('°', padding + tempWidth + 4, tempTop + L.degAsc);

  const labelX = padding + tempWidth + (format === 'square' ? 50 : 62);
  ctx.fillStyle = MUTED;
  ctx.font = '600 22px "Pretendard Variable", "Noto Sans KR", sans-serif';
  ctx.letterSpacing = '2px';
  ctx.fillText('여론 온도', labelX, tempTop + L.labelTop);
  ctx.letterSpacing = '0px';
  ctx.fillStyle = INK;
  ctx.font = '700 34px "Pretendard Variable", "Noto Sans KR", sans-serif';
  ctx.fillText(band.note, labelX, tempTop + L.labelMid);
  ctx.fillStyle = MUTED;
  ctx.font = '500 24px "Pretendard Variable", "Noto Sans KR", sans-serif';
  ctx.fillText(
    `투표 ${formatNumber(totalVotes(votes))}명 · 🔥 ${shares[0].pct}%`,
    labelX,
    tempTop + L.labelBottom,
  );

  // horizontal meter
  const meterW = width - padding * 2;
  const meterY = tempTop + L.meterOffset;
  ctx.fillStyle = 'rgba(23,19,15,0.08)';
  roundedRect(ctx, padding, meterY, meterW, 16, 8);
  ctx.fill();
  const fillGradient = ctx.createLinearGradient(padding, 0, padding + meterW, 0);
  fillGradient.addColorStop(0, '#3d8ba6');
  fillGradient.addColorStop(0.45, '#c9a24a');
  fillGradient.addColorStop(0.75, '#e0451f');
  fillGradient.addColorStop(1, '#a82b0d');
  ctx.save();
  roundedRect(ctx, padding, meterY, meterW, 16, 8);
  ctx.clip();
  ctx.fillStyle = fillGradient;
  ctx.fillRect(padding, meterY, (meterW * temp) / 100, 16);
  ctx.restore();

  // marker
  const markerX = padding + (meterW * temp) / 100;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.moveTo(markerX, meterY - 12);
  ctx.lineTo(markerX - 10, meterY - 26);
  ctx.lineTo(markerX + 10, meterY - 26);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = MUTED;
  ctx.font = '500 18px "Pretendard Variable", "Noto Sans KR", sans-serif';
  ctx.fillText('0°', padding, meterY + 44);
  ctx.textAlign = 'right';
  ctx.fillText('100°', padding + meterW, meterY + 44);
  ctx.textAlign = 'left';

  // vote distribution
  const voteY = meterY + L.voteOffset;
  const gap = 10;
  const segW = (meterW - gap * 2) / 3;
  const colors = ['#e0451f', '#c9a24a', '#3d8ba6'];
  shares.forEach((share, index) => {
    const x = padding + index * (segW + gap);
    ctx.fillStyle = colors[index];
    roundedRect(ctx, x, voteY, segW, 8, 4);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.font = '700 24px "Pretendard Variable", "Noto Sans KR", sans-serif';
    ctx.fillText(`${share.pct}%`, x, voteY + 44);
    ctx.fillStyle = MUTED;
    ctx.font = '500 20px "Pretendard Variable", "Noto Sans KR", sans-serif';
    ctx.fillText(['🔥 불타는 중', '🤔 지켜보는 중', '❄️ 훈훈·냉각'][index], x + 62, voteY + 43);
  });

  // comment card — only if it truly fits above the footer
  const footerY = height - 50;
  const cardGapTop = voteY + L.cardGap;
  const available = footerY - cardGapTop - 26;
  const cardH = Math.min(L.cardDesired, available);
  const cardTop = cardGapTop + Math.max(0, (available - cardH) / 2);
  if (topComment && cardH >= 118) {
    ctx.fillStyle = 'rgba(255,253,249,0.86)';
    roundedRect(ctx, padding, cardTop, meterW, cardH, 24);
    ctx.fill();
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 2;
    ctx.stroke();

    const compact = cardH < 190;
    const quoteFont = compact ? 26 : L.quoteFont;
    const quoteLH = compact ? 36 : L.quoteLH;

    ctx.fillStyle = HEAT;
    ctx.font = `700 ${compact ? 52 : 64}px "Noto Serif KR", serif`;
    ctx.fillText('“', padding + 26, cardTop + (compact ? 58 : 66));

    ctx.fillStyle = INK;
    ctx.font = `600 ${quoteFont}px "Noto Serif KR", "Noto Serif CJK KR", serif`;
    const quoteLines = wrapText(
      ctx,
      plain(topComment.text),
      meterW - 120,
      compact ? 2 : L.quoteMax,
    );
    let quoteY = cardTop + (compact ? 40 : 44) + quoteFont;
    for (const line of quoteLines) {
      ctx.fillText(line, padding + 74, quoteY);
      quoteY += quoteLH;
    }

    ctx.fillStyle = MUTED;
    ctx.font = '500 21px "Pretendard Variable", "Noto Sans KR", sans-serif';
    ctx.fillText(
      `${topComment.author} · 좋아요 ${formatNumber(topComment.likes)}`,
      padding + 74,
      cardTop + cardH - 24,
    );

    ctx.textAlign = 'right';
    ctx.fillStyle = '#c9a24a';
    ctx.font = '600 20px "Pretendard Variable", "Noto Sans KR", sans-serif';
    ctx.fillText('🏆 주간 베스트 팩폭', padding + meterW - 26, cardTop + cardH - 24);
    ctx.textAlign = 'left';
  }

  // footer
  ctx.fillStyle = 'rgba(23,19,15,0.45)';
  ctx.font = '500 21px "Pretendard Variable", "Noto Sans KR", sans-serif';
  ctx.fillText('오늘의 이슈를 30초에 — 3줄 요약 · 업계인 속마음 · 여론 온도계', padding, height - 50);
  ctx.textAlign = 'right';
  ctx.fillText('issue-factbomb.board', width - padding, height - 50);
  ctx.textAlign = 'left';

  return canvas.toDataURL('image/png');
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}
