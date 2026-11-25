/**
 * 이슈온도계 — AI가 없을 때도 카드마다 '그 기사에만 있는' 문장을 만드는 편집 도구.
 *
 * 왜 필요한가
 *  - 예전 헤드라인 카드는 모든 카드가 `제목 / "출처 · 헤드라인" / 요약 3줄` 이라
 *    카드 5장이 전부 같은 틀처럼 보였습니다.
 *  - 여기서는 기사 본문에서 숫자·주체·인용이 있는 문장을 골라
 *    훅 · 리드 · 팩트 3줄 · 배경 · 쟁점 · 두 진영 · 태그를 각각 다른 재료로 채웁니다.
 *
 * 원칙
 *  - 기사에 적힌 사실만 씁니다. 없는 수치·인물·기관을 만들지 않습니다.
 *  - 문장은 서로 겹치지 않게 고릅니다(같은 문장이 두 칸에 들어가면 실패).
 */

import { asSentence, cleanNewsText, factScore, splitSentences, stripBoilerplate } from "./_shared.js";

export type Genre = "entertainment" | "society" | "culture" | "tech" | "money" | "work";

export interface EditorialInput {
  title: string;
  summary?: string;
  body?: string;
  source: string;
  buzz?: number;
}

export interface EditorialSides {
  labelA: string;
  labelB: string;
  a: string;
  b: string;
}

export interface Editorial {
  hook: string;
  kicker: string;
  facts: string[];
  background: string;
  point: string;
  /** 기사에 실제로 있던 인용 한 줄 — 표지 '한마디' 판의 주인공. 없으면 빈 문자열. */
  quote: string;
  sides: EditorialSides | null;
  tags: string[];
  temp: number;
}

/* ------------------------------------------------------------ 문장 재료 */

const CONFLICT = /(논란|쟁점|비판|반발|우려|갈등|요구|반대|찬성|거부|항의|불만|지적|문제|위반|특혜|편법|꼼수|차별|과징금|소송|고소|집단민원)/;
const STANCE = /(주장|입장|밝혔|설명|해명|반박|요구|촉구|비판|반발|우려|강조|지적|말했|전했|전망|관측|분석)/;
const NUMBER = /\d/;
/** 어느 기사에나 붙는 문장 — 카드 문구로 쓰면 모든 카드가 같아집니다. */
const GENERIC = /^(이번 조사|관련 업계|업계 관계자|기자\s*=|사진\s*=|자료사진|제공\s*=|무단\s*전재|재배포|Copyright|ⓒ|▶|이 기사는|위 기사는)/;

/** 홍보·안내 문구 — 카드에 넣으면 기사 사실이 아니라 광고처럼 읽힙니다. */
const PROMO = /(만나보세요|만나 보세요|관람하세요|예매하세요|문의|홈페이지|누리집|프리미엄 콘텐츠|이끌어줄|당신의|여러분의|지금 바로|바로가기|클릭|신청하세요|확인하세요)/;
const PRESS_TAG = /^(?:\[[^\]]{1,14}\]\s*|【[^】]{1,14}】\s*|<[^>]{1,14}>\s*)/;

/** RSS 본문에 남은 HTML 엔티티 — 그대로 쓰면 카드에 &hellip; 같은 글자가 찍힙니다. */
const ENTITIES: Record<string, string> = {
  hellip: "…", quot: '"', amp: "&", lt: "<", gt: ">", nbsp: " ",
  lsquo: "'", rsquo: "'", ldquo: "'", rdquo: "'", middot: "·", copy: "©",
};

function decodeCommon(text: string): string {
  return text
    .replace(/&([a-z]+);/gi, (_match, name: string) => ENTITIES[name.toLowerCase()] ?? " ")
    // 사진 캡션의 통신사 이름이 문장 앞에 붙어 있으면 떼어 냅니다.
    .replace(/^(?:로이터연합뉴스|AP연합뉴스|AFP연합뉴스|연합뉴스|뉴시스|로이터|AP|AFP)\s*/i, "")
    .replace(/(?:로이터|AP|AFP)연합뉴스/g, " ");
}

/** 제목에서 기사 도구(단독·속보·종합)와 통신사 머리말을 걷어냅니다. */
export function cleanHeadline(title: string): string {
  let text = cleanNewsText(title, 220).replace(PRESS_TAG, "").trim();
  text = text.replace(/^\([^)]{2,24}\)\s*/, "").replace(/^[가-힣]{2,4}\s*(?:기자|특파원)\s*=\s*/, "");
  text = text.replace(/\s*\.{2,}\s*$/, "").replace(/\s*…\s*$/, "").trim();
  return text;
}

/** 제목을 카드 훅 길이(약 46자)로 — 단어 중간에서 자르지 않습니다. */
function shortHook(title: string, max = 46): string {
  const text = cleanHeadline(title);
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf(","), cut.lastIndexOf("·"));
  const head = (at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,·:;–—-]+$/, "");
  return `${head}…`;
}

/** 인용문이 있으면 그 말이 기사에서 가장 센 문장입니다(연예·사회 기사에 많음). */
function quotedLine(sentences: string[]): string {
  for (const sentence of sentences) {
    const match = sentence.match(/["“”'‘’]([^"“”'‘’]{6,58})["“”'‘’]/);
    if (!match) continue;
    const line = match[1].trim();
    // 보도체·안내문·조각난 명사("개과천선 서인영")는 카드의 주인공으로 쓰지 않습니다.
    if (/(밝혔다|전했다|말했다|설명했다|것으로|예정이다|요청했다)$/.test(line)) continue;
    if (line.length < 10 || !/\s/.test(line)) continue;
    if (!/(다|요|죠|네|까|지|라|자|야|어|아|해|함|음|임|게|데|걸)$/.test(line) && line.length < 16) continue;
    return line;
  }
  return "";
}

/** 보도체·절차 문장으로 시작하는 문장 — 표지 리드로 쓰면 카드가 기사 요약문처럼 읽힙니다. */
const PROCEDURAL_OPEN =
  /^(?:지난|이날|이번|당시|현재|오는|내년|올해|\d{1,2}일|\d{4}년|\d{1,2}월)\s*|^[가-힣]{2,10}(?:청|부|위|원|처|구청|경찰|검찰|법원|위원회)에\s*따르면/;

function isProcedural(sentence: string): boolean {
  return PROCEDURAL_OPEN.test(sentence.trim());
}

/** 보도체 문장에서 "25일 …에 따르면 이날" 같은 머리말을 덜어 냅니다 — 카드에 소식지 문장이 그대로 박히지 않게. */
export function stripProcedural(text: string): string {
  let out = text.trim();
  out = out.replace(/^\d{1,2}월\s*\d{1,2}일\s+/, "");
  out = out.replace(/^\d{1,2}일\s+/, "");
  out = out.replace(/^[가-힣]{2,10}(?:경찰청|검찰청|법원|위원회|청|부|처|구청)(?:에|가|는)?\s*따르면\s*/, "");
  out = out.replace(/^(?:이날|당시)\s+/, "");
  out = out.replace(/^(?:지난달|지난|올해|내년|오는)\s+/, "");
  return out.trim();
}

/** 조사·어미만 다른 같은 문장(“…기록했다” vs “…기록했어요”)을 같은 문장으로 봅니다. */
function sentenceKey(value: string): string {
  return value.replace(/[^가-힣a-zA-Z0-9]/g, "");
}

function similarSentence(a: string, b: string): boolean {
  const x = sentenceKey(a);
  const y = sentenceKey(b);
  if (x.length < 8 || y.length < 8) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const grams = (value: string) => {
    const set = new Set<string>();
    for (let i = 0; i < value.length - 1; i += 1) set.add(value.slice(i, i + 2));
    return set;
  };
  const A = grams(x);
  const B = grams(y);
  let shared = 0;
  for (const gram of A) if (B.has(gram)) shared += 1;
  return shared / Math.min(A.size, B.size) > 0.62;
}

function dedupe(sentences: string[]): string[] {
  const out: string[] = [];
  for (const sentence of sentences) {
    if (sentenceKey(sentence).length < 8) continue;
    if (out.some((kept) => similarSentence(kept, sentence))) continue;
    out.push(sentence);
  }
  return out;
}

/** 팩트 3줄 — 숫자·주체·행동이 들어간 문장을 서로 다른 재료로 고릅니다. */
function pickFacts(sentences: string[], title: string): string[] {
  const titleKey = title.replace(/[^가-힣a-zA-Z0-9]/g, "").slice(0, 18);
  const ranked = sentences
    .map((sentence, order) => {
      let score = factScore(sentence);
      if (NUMBER.test(sentence)) score += 2.5;
      if (STANCE.test(sentence)) score += 1.2;
      if (titleKey && sentence.replace(/[^가-힣a-zA-Z0-9]/g, "").includes(titleKey)) score -= 1.2;
      if (sentence.length > 120) score -= 2;
      return { sentence, order, score };
    })
    .sort((a, b) => b.score - a.score);

  const picked: { sentence: string; order: number }[] = [];
  for (const entry of ranked) {
    if (picked.length >= 3) break;
    if (picked.some((item) => similarSentence(item.sentence, entry.sentence))) continue;
    picked.push(entry);
  }
  picked.sort((a, b) => a.order - b.order);
  return picked.map((entry) => asSentence(entry.sentence, 92));
}

/** A/B 두 진영 — 기사 안에서 서로 다른 목소리를 낸 문장 두 개를 붙입니다. */
const ACTORS: { re: RegExp; label: string }[] = [
  { re: /(정부|당국|보건복지부|교육부|법무부|금융위|공정위|질병청|경찰청|소방청)/, label: "당국" },
  { re: /(회사|기업|업계|제조사|브랜드|계열사|본사)/, label: "회사" },
  { re: /(이용자|소비자|고객|구독자|사용자)/, label: "이용자" },
  { re: /(팬|팬덤|누리꾼|네티즌|시청자|관객)/, label: "팬들" },
  { re: /(노조|근로자|직원|노동자|아르바이트)/, label: "노동자" },
  { re: /(선수|구단|감독|코치|협회)/, label: "구단" },
  { re: /(배우|가수|아이돌|제작사|소속사|제작진|감독|작가|출연진)/, label: "제작진" },
  { re: /(전문가|교수|연구원|의료계|법조계|학계)/, label: "전문가" },
  { re: /(정치권|여당|야당|국회|의원|장관|대통령실)/, label: "정치권" },
  { re: /(학생|학부모|교사|학교|대학)/, label: "학교" },
];

function labelFor(text: string, fallback: string): string {
  let best = "";
  for (const actor of ACTORS) {
    if (actor.re.test(text)) {
      if (actor.label.length > best.length) best = actor.label;
    }
  }
  return best || fallback;
}

function pickSides(sentences: string[]): EditorialSides | null {
  const stance = sentences.filter((sentence) => STANCE.test(sentence) && sentence.length >= 24);
  if (stance.length < 2) return null;
  const [first, second] = stance;
  // 실제 주체 이름이 확인될 때만 두 진영을 만듭니다(없으면 A/B 투표가 그 자리를 맡습니다).
  const labelA = labelFor(first, "");
  const labelB = labelFor(second, "");
  if (!labelA || !labelB || labelA === labelB) return null;
  return {
    labelA,
    labelB,
    a: asSentence(first, 88).replace(/[.]$/, ""),
    b: asSentence(second, 88).replace(/[.]$/, ""),
  };
}

/** 제목·요약에서 카드 검색 태그 3개 — 기사마다 다른 낱말이 나옵니다. */
const TAG_STOP = new Set([
  "그리고", "하지만", "그런데", "이번", "오늘", "지금", "관련", "대한", "위한", "라며", "라고",
  "한다", "했다", "된다", "있다", "없다", "것이다", "사람", "정도", "기자", "뉴스", "단독", "속보",
  "종합", "우리", "이런", "저런", "그런", "모두", "모든", "다시", "계속", "이후", "때문", "예정",
]);

function pickTags(text: string): string[] {
  const counts = new Map<string, number>();
  for (const raw of text.split(/[^가-힣A-Za-z0-9]+/)) {
    const word = raw.replace(/(은|는|이|가|을|를|의|에|와|과|도|만|로|으로|에서|에게|부터|까지)$/, "");
    if (word.length < 2 || word.length > 12) continue;
    if (TAG_STOP.has(word) || /^\d+$/.test(word)) continue;
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 3)
    .map(([word]) => word);
}

/** 화제성 → 논란 온도(카드에 숫자로 보이는 값). */
function tempOf(buzz: number): number {
  return Math.max(18, Math.min(96, Math.round(28 + buzz * 0.62)));
}

/* ------------------------------------------------------------------ 만들기 */

/**
 * 기사 하나를 카드 문구로 정리합니다.
 * AI가 준 문장이 없을 때의 기본값이자, AI 문장이 비었을 때 빈칸을 채우는 재료입니다.
 */
export function composeEditorial(input: EditorialInput): Editorial {
  const summary = stripBoilerplate(cleanNewsText(decodeCommon(input.summary ?? ""), 900));
  const body = stripBoilerplate(cleanNewsText(decodeCommon(input.body ?? ""), 2_400));
  // 제목 낱말 — 본문에서 다른 기사·링크 목록을 걸러 내는 기준으로 씁니다.
  const titleWords = (cleanHeadline(input.title) || "")
    .split(/[^가-힣A-Za-z0-9]+/)
    .map((word) => word.replace(/(은|는|이|가|을|를|의|에|와|과|도|만|로|으로|에서|에게)$/, ""))
    .filter((word) => word.length >= 2);

  const summarySentences = splitSentences(summary, 6);
  const summaryWords = summarySentences
    .join(" ")
    .split(/[^가-힣A-Za-z0-9]+/)
    .map((word) => word.replace(/(은|는|이|가|을|를|의|에|와|과|도|만|로|으로|에서|에게)$/, ""))
    .filter((word) => word.length >= 2);
  const topicWords = [...new Set([...titleWords, ...summaryWords])];
  // 본문은 페이지에 함께 실린 다른 기사 제목·추천 목록이 섞이기 쉬워, 이 기사와 이어지는 문장만 씁니다.
  const bodySentences = splitSentences(body, 10).filter(
    (sentence) => topicWords.some((word) => sentence.includes(word)),
  );
  const sentences = dedupe([...summarySentences, ...bodySentences]).filter(
    (sentence) =>
      !GENERIC.test(sentence) &&
      !PROMO.test(sentence) &&
      !/^[?？!·,.;:\-—…"'”’▲▶■◆◇※]/.test(sentence) &&
      !/\|/.test(sentence) &&
      !/(발행일|입력\s*:|수정\s*:|등록\s*:|기자\s*:|무단전재|AI학습)/.test(sentence) &&
      sentence.length >= 22,
  );

  const title = cleanHeadline(input.title);
  const hook = shortHook(input.title);
  const facts = pickFacts(sentences, title);
  // 팩트는 3줄을 기본으로 — 모자라면 아직 쓰지 않은 문장으로 채웁니다(빈 카드보다 낫습니다).
  const pool = dedupe([...sentences]);
  while (facts.length < 3) {
    const at = pool.findIndex(
      (sentence) => sentence.length >= 20 && !facts.some((fact) => similarSentence(fact, sentence)),
    );
    if (at < 0) break;
    facts.push(asSentence(pool.splice(at, 1)[0], 92));
  }

  // 리드 = 훅 아래 한 줄. 팩트로 이미 쓴 문장은 피하고, 숫자나 인용이 있는 문장을 씁니다.
  const leadPool = sentences.filter((sentence) => !facts.some((fact) => similarSentence(fact, sentence)));
  // 보도체("25일 …에 따르면")로 시작하는 문장은 리드에서 뒤로 미룹니다.
  const naturalLead = leadPool.filter((sentence) => !isProcedural(sentence));
  const lead =
    naturalLead.find((sentence) => NUMBER.test(sentence) && sentence.length <= 90) ??
    naturalLead.find((sentence) => STANCE.test(sentence)) ??
    naturalLead[0] ??
    leadPool[0] ??
    "";
  const quote = quotedLine(sentences);
  // 리드는 훅과 다른 말이어야 합니다 — 같은 문장이 사진 위·아래에 두 번 나오면 지루해집니다.
  const leadChoices = [lead, quote, ...leadPool].filter(Boolean);
  let kicker = "";
  for (const candidate of leadChoices) {
    const cleaned = isProcedural(candidate) ? stripProcedural(candidate) : candidate;
    const line = asSentence(cleaned, 62).replace(/[.]$/, "");
    if (!line) continue;
    if (line.length < 18) continue;
    if (similarSentence(line, hook) || similarSentence(line, title)) continue;
    kicker = line;
    break;
  }

  // 배경 = 팩트·리드에 쓰지 않은 문장 2개.
  const rest = sentences.filter(
    (sentence) => !facts.some((fact) => fact.includes(sentence.slice(0, 14))) && sentence !== lead,
  );
  const background =
    rest.length > 0
      ? rest.slice(0, 2).map((sentence) => asSentence(sentence, 80)).join(" ")
      : asSentence(lead || title, 90);

  // 쟁점 = 갈등이 드러난 문장. 보도체("25일 …에 따르면") 문장은 쟁점이 아니므로 비워 두고,
  // 그 자리는 카드가 A/B 질문으로 채웁니다(소식지 문장이 카드에 박히는 것보다 낫습니다).
  const conflict = sentences.find(
    (sentence) => CONFLICT.test(sentence) && sentence.length >= 24 && !isProcedural(sentence),
  );
  const point = conflict ? asSentence(conflict, 72).replace(/[.]$/, "") : "";
  const sides = pickSides(sentences);

  return {
    hook,
    kicker,
    facts: facts.length > 0 ? facts : [asSentence(title, 90)],
    background,
    point,
    quote,
    sides,
    tags: pickTags(`${title} ${summary}`),
    temp: tempOf(input.buzz ?? 50),
  };
}
