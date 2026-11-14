import type { CategoryId } from '../types';
import { clamp } from './format';

export interface DraftResult {
  headline: string;
  kicker: string;
  summary: string[];
  insider: string;
  category: CategoryId;
  baseTemp: number;
  tags: string[];
  keywords: string[];
  notes: string[];
  sourceUrl?: string;
}

export interface DraftForm {
  headline: string;
  kicker: string;
  summary: string[];
  insider: string;
  category: CategoryId;
  baseTemp: number;
  tags: string;
}

const KEYWORDS: Record<CategoryId, string[]> = {
  tech: [
    'AI', '인공지능', '플랫폼', '앱', '구독', '결제', '클라우드', 'SaaS', '개발', '알고리즘',
    '데이터', '요금제', '업데이트', '서비스 장애', '반도체', '스타트업', '멤버십', '로그인',
  ],
  retail: [
    '팝업', '매장', '오픈런', '품절', '가격', '인상', '배송', '편의점', '리테일', '재고',
    '할인', '소비자', '브랜드', '커머스', '구매', '입점', '프로모션', '환불',
  ],
  culture: [
    '드라마', '영화', '웹툰', '웹소설', '아이돌', '컴백', '팬덤', 'OTT', '콘텐츠', '공연',
    '티저', '스포일러', '예능', '앨범', '제작사', '배우', '구독료', '플랫폼',
  ],
  work: [
    '채용', '인사', '직급', '연봉', '근무', '재택', '출근', '야근', '이직', '조직',
    '노조', '복지', '면접', '사내', '직원', '성과급', '평가', '퇴사',
  ],
};

const STRONG_TRIGGERS = [
  '품절', '논란', '철회', '반발', '유출', '담합', '사과', '폭로', '의혹', '파업',
  '소송', '리콜', '해킹', '장애', '갑질', '실망', '비난', '사고',
];
const MEDIUM_TRIGGERS = ['인상', '개편', '도입', '중단', '제한', '축소', '폐지', '변경', '경고', '비판', '불만', '갈등'];
const SOFT_TRIGGERS = ['발표', '공개', '출시', '확대', '협업', '캠페인', '성과', '선정', '수상'];

const INSIDER_TEMPLATES: Record<CategoryId, string[]> = {
  tech: [
    '이번 건은 기능보다 {kw}의 순서 문제로 읽힌다. 사용자는 변화 자체보다 “왜 지금, 왜 이 방식인지”를 먼저 묻는다. 공지에 그 답이 없으면 다음 주에는 커뮤니티가 답을 대신 써 준다.',
    '{kw}{neun} 스펙이 아니라 약속이다. 약속을 바꿀 때는 새 혜택보다 사라지는 것을 먼저 설명해야 한다. 순서가 뒤집히면 좋은 기능도 보상이 아니라 보복으로 읽힌다.',
    '지금 필요한 건 해명이 아니라 기준이다. {kw}{eul} 어떤 데이터로 결정했는지 공개하면 논쟁이 줄고, 숨기면 다음 분기 실적 발표에서 다시 나온다.',
  ],
  retail: [
    '현장에서 {kw}{neun} 운영의 문제인데, 공지에서는 의도의 문제처럼 쓰인다. 고객은 사과의 문장보다 다음 방문의 확답을 먼저 원한다.',
    '{kw}{eul} 브랜드 경험으로 부르려면 통제가 필요하다. 통제되지 않은 인기는 매출보다 빨리 브랜드를 태운다.',
    '이번 대응의 핵심은 속도가 아니라 순서다. {kw} 공지 → 보상 → 사과 순으로 가야 했는데, 지금은 사과가 마지막에 남았다.',
  ],
  culture: [
    '{kw} 논란은 사실 확인보다 해석의 싸움이다. 원본을 공개하면 논쟁은 줄고, 숨기면 빈칸이 최악으로 채워진다.',
    '팬덤은 {kw}{eul} 배신으로 읽는 순간 브랜드가 아니라 검열자로 기억한다. 설명보다 과정을 먼저 보여줘야 한다.',
    '이 카드는 한 번만 쓸 수 있다. {kw} 대응이 다음 작품에서 “또 그러겠지”가 되는 순간, 모든 해명이 마케팅으로 읽힌다.',
  ],
  work: [
    '{kw}{neun} 정책이 아니라 신뢰의 문제다. 직원은 공지의 결론보다 “우리가 어떤 기준으로 판단됐는지”를 기억한다.',
    '보상은 숫자, 커리어는 언어다. {kw}{i} 숫자만 건드리면 내부 만족은 올라가고 외부 가치는 그대로다.',
    '{kw}{eul} 장점으로 내세우려면 법 위에 무엇을 더했는지 보여줘야 한다. 최소 기준을 자랑하면 기준 자체가 의심받는다.',
  ],
};

/** Korean particle allomorphs, so a templated sentence never reads “결제을”. */
function hasBatchim(word: string): boolean {
  const code = word.charCodeAt(word.length - 1);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

function withParticles(template: string, keyword: string): string {
  const pair = (vowel: string, consonant: string) => (hasBatchim(keyword) ? consonant : vowel);
  return template
    .replace(/\{kw\}/g, keyword)
    .replace(/\{eul\}/g, pair('를', '을'))
    .replace(/\{neun\}/g, pair('는', '은'))
    .replace(/\{i\}/g, pair('가', '이'));
}

function hash(text: string): number {
  let value = 0;
  for (let i = 0; i < text.length; i += 1) value = (value * 31 + text.charCodeAt(i)) % 100000;
  return value;
}

function countHits(text: string, words: string[]): number {
  let total = 0;
  for (const word of words) {
    const matches = text.split(word).length - 1;
    total += matches;
  }
  return total;
}

function detectCategory(text: string): { category: CategoryId; keywordHits: string[] } {
  let best: CategoryId = 'tech';
  let bestScore = -1;
  for (const [id, words] of Object.entries(KEYWORDS) as [CategoryId, string[]][]) {
    const score = countHits(text, words);
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  const keywordHits = (KEYWORDS[best] as string[])
    .filter((word) => text.includes(word))
    .slice(0, 4);
  return { category: best, keywordHits };
}

function splitSentences(raw: string): string[] {
  const normalized = raw.replace(/\r/g, '').replace(/\n+/g, '\n').trim();
  const chunks = normalized
    .split(/\n|(?<=[.!?…])\s+|(?<=다\.)\s*/)
    .map((chunk) => chunk.replace(/^[-•*·\d.)\s]+/, '').trim())
    .filter((chunk) => chunk.length > 3);
  return chunks;
}

function trimHeadline(text: string): string {
  let headline = text.replace(/\s+/g, ' ').replace(/[.。]+$/, '').trim();
  if (headline.length > 62) {
    const comma = headline.indexOf(',');
    headline = comma > 12 ? headline.slice(0, comma) : `${headline.slice(0, 60).trim()}…`;
  }
  return headline;
}

function isHeadlineLike(line: string): boolean {
  return line.length <= 48 && !/[.。]$/.test(line) && !/^(지난|어제|오늘|관련|이번)/.test(line);
}

function estimateTemp(text: string, sentenceCount: number): number {
  let temp = 30;
  for (const trigger of STRONG_TRIGGERS) if (text.includes(trigger)) temp += 9;
  for (const trigger of MEDIUM_TRIGGERS) if (text.includes(trigger)) temp += 6;
  for (const trigger of SOFT_TRIGGERS) if (text.includes(trigger)) temp += 3;
  if (sentenceCount >= 5) temp += 2;
  if (/[!?]/.test(text)) temp += 2;
  return clamp(Math.round(temp), 28, 92);
}

/**
 * Turns a pasted memo into a structured briefing draft. Deterministic, offline,
 * and deliberately conservative: it only fills what the memo actually contains.
 */
export function structurize(raw: string): DraftResult {
  const urlMatch = raw.match(/https?:\/\/\S+/);
  const sourceUrl = urlMatch?.[0];
  const body = raw.replace(/https?:\/\/\S+/g, ' ').trim();
  const notes: string[] = [];
  if (sourceUrl && body.length < 40) {
    notes.push('URL 본문은 브라우저에서 직접 읽을 수 없습니다. 기사 요지를 함께 붙여넣으면 구조화합니다.');
  } else if (sourceUrl) {
    notes.push('URL은 출처로만 남기고, 붙여넣은 메모 본문을 구조화했습니다.');
  }

  const lines = body.split('\n').map((line) => line.trim()).filter(Boolean);
  const sentences = splitSentences(body);
  const { category, keywordHits } = detectCategory(body);

  let headline = '';
  let consumed = 0;
  if (lines[0] && isHeadlineLike(lines[0]) && lines.length > 1) {
    headline = trimHeadline(lines[0]);
    consumed = 1;
  } else if (sentences[0]) {
    headline = trimHeadline(sentences[0]);
    consumed = 1;
  }

  const rest = sentences.slice(consumed);
  const summary = rest.slice(0, 3).map((sentence) => sentence.replace(/\s+/g, ' ').slice(0, 120));
  if (summary.length < 3) {
    const pool = rest.slice(summary.length).join(' ').split(/,\s*/);
    for (const clause of pool) {
      if (summary.length >= 3) break;
      if (clause.trim().length > 8) summary.push(clause.trim().slice(0, 120));
    }
  }
  if (summary.length < 3) {
    notes.push(`3줄 요약 중 ${summary.length}줄만 채웠습니다. 남은 줄은 직접 채워 주세요.`);
  }
  if (body.length === 0) {
    notes.push('메모가 비어 있어 구조화할 내용이 없습니다.');
  }

  const keyword = keywordHits[0] ?? {
    tech: '이번 업데이트',
    retail: '이번 캠페인',
    culture: '이번 작품',
    work: '이번 제도',
  }[category];
  const templates = INSIDER_TEMPLATES[category];
  const insider = withParticles(templates[hash(body) % templates.length], keyword);

  const kicker =
    rest[0] && rest[0].length < 60
      ? rest[0].replace(/[.。]+$/, '')
      : keywordHits.length > 0
        ? keywordHits.join(' · ')
        : '현장 메모에서 정리한 초안';

  const tags = keywordHits.length > 0 ? keywordHits : [keyword];

  return {
    headline,
    kicker,
    summary,
    insider,
    category,
    baseTemp: estimateTemp(body, sentences.length),
    tags,
    keywords: keywordHits,
    notes,
    sourceUrl,
  };
}

export function draftToForm(draft: DraftResult): DraftForm {
  return {
    headline: draft.headline,
    kicker: draft.kicker,
    summary: [0, 1, 2].map((i) => draft.summary[i] ?? ''),
    insider: draft.insider,
    category: draft.category,
    baseTemp: draft.baseTemp,
    tags: draft.tags.join(', '),
  };
}

export function formToTags(value: string): string[] {
  return value
    .split(/[,#]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function emptyForm(): DraftForm {
  return {
    headline: '',
    kicker: '',
    summary: ['', '', ''],
    insider: '',
    category: 'tech',
    baseTemp: 55,
    tags: '',
  };
}
