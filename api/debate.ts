/**
 * 이슈온도계 — 이슈마다 다른 '팽팽한 A/B' 문항 만들기
 *
 * AI가 만든 투표가 밋밋하거나(찬성/반대, 어떻게 보시나요) 다른 이슈와 겹치면,
 * 이 파일이 기사 제목·요약에서 갈등 지점을 읽어 그 이슈에만 통하는 양자택일을 만듭니다.
 * AI가 아예 없을 때(키 없음·호출 실패)도 카드마다 서로 다른 문항이 나가야 하므로,
 * 모든 카드에 대해 이 함수가 '후보 문항'을 하나씩 준비합니다.
 *
 * 원칙:
 * - 사실은 만들지 않습니다. 문항은 '어느 쪽에 서는가'를 묻는 의견 선택지입니다.
 * - 주제어는 기사 제목에서 그대로 뽑아 씁니다(따옴표 안 표현 → 키워드 → 제목 앞 구절 순).
 * - 같은 화면의 다른 카드와 선택지가 겹치면 다음 틀로 넘어가고, 그래도 겹치면
 *   주제어를 선택지 안에 넣어 확실히 다른 문항으로 만듭니다.
 */

export interface DebatePoll {
  question: string;
  a: string;
  b: string;
}

export interface DebateInput {
  title: string;
  summary?: string;
  body?: string;
  category?: string;
  /** 같은 화면에서 이미 쓰인 문항 — 겹치면 다른 틀로 다시 만듭니다. */
  avoid?: DebatePoll[];
}

/* ------------------------------------------------------------- 문장 다듬기 */

const PRESS_NOISE = /\[[^\]]{0,24}\]|\([^)]{0,40}\)|▶[^\n]{0,40}|ⓒ[^\n]{0,40}/g;

function tidy(value: string): string {
  return value
    .replace(PRESS_NOISE, " ")
    .replace(/[\u200b-\u200f\u202a-\u202e\ufeff]/g, "")
    .replace(/["'“”‘’«»]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const PARTICLES =
  /(으로서|으로써|에서는|에게서|이라고|라고는|이라도|이라서|으로는|에서도|에게는|보다는|처럼은|까지는|부터는|이라는|이라니|이라면|으로|에서|에게|부터|까지|보다|처럼|라고|라는|이라|은|는|이|가|을|를|의|에|와|과|도|만|로)$/;

function stripParticle(word: string): string {
  return word.replace(PARTICLES, "");
}

/* --------------------------------------------------------------- 주제어 뽑기 */

/** 제목에 자주 나오는 주제어 — 있으면 이 단어를 카드의 주제로 씁니다(긴 것부터). */
const TOPIC_HINTS = [
  "런치플레이션",
  "구독 서비스",
  "최저임금",
  "무수익여신",
  "깡통대출",
  "전세사기",
  "전셋값",
  "집값",
  "월세",
  "전세",
  "부동산",
  "청약",
  "재건축",
  "금리",
  "대출",
  "환율",
  "물가",
  "장바구니",
  "점심값",
  "점심",
  "커피값",
  "치킨값",
  "배달비",
  "구독료",
  "구독",
  "요금",
  "연봉",
  "성과급",
  "주 4일제",
  "주4일제",
  "재택근무",
  "야근",
  "회식",
  "채용",
  "공채",
  "구조조정",
  "정리해고",
  "파업",
  "노조",
  "인공지능",
  "챗GPT",
  "반도체",
  "플랫폼",
  "알고리즘",
  "개인정보",
  "해킹",
  "유출",
  "딥페이크",
  "드라마",
  "예능",
  "영화",
  "게임",
  "아이돌",
  "팬덤",
  "웹툰",
  "티켓팅",
  "공연",
  "넷플릭스",
  "시청률",
  "수능",
  "입시",
  "등록금",
  "청년",
  "지원금",
  "육아",
  "출산",
  "저출생",
  "한한령",
  "관세",
  "수출",
  "전기차",
  "배터리",
  "조선",
  "방산",
  "보습크림",
  "도시락",
  "편의점",
  "배달",
  "의료",
  "응급실",
  "간호사",
  "연금",
  "보험료",
  "세금",
];

function hintedTopic(text: string): string {
  // 띄어쓰기가 달라도(구독서비스 / 구독 서비스) 같은 말로 봅니다.
  // 여러 번 나오는 말을 먼저 고르고, 같으면 제목 앞쪽에 나온 말을 고릅니다.
  const compact = text.replace(/\s+/g, "");
  let best = "";
  let bestScore = -1;
  let bestAt = Number.MAX_SAFE_INTEGER;
  for (const hint of TOPIC_HINTS) {
    const key = hint.replace(/\s+/g, "");
    const at = compact.indexOf(key);
    if (at < 0) continue;
    const count = compact.split(key).length - 1;
    const score = hint.length + Math.min(6, (count - 1) * 3);
    if (score > bestScore || (score === bestScore && at < bestAt)) {
      best = hint;
      bestScore = score;
      bestAt = at;
    }
  }
  return best;
}

/** 따옴표 안 표현이 짧은 명사구면 그 말이 기사가 강조하는 대상입니다. */
function quotedTopic(title: string): string {
  for (const match of title.matchAll(/["']([^"']{2,16})["']/g)) {
    const value = tidy(match[1]);
    if (value.length < 2) continue;
    if (/[?？!]$/.test(value)) continue;
    if (/(보다|없이|만큼)/.test(value)) continue;
    if (/(대로|라고|한다|했다|된다|있다|없다|계속|전망|우려|반발|논란|부담|지연)$/.test(value)) continue;
    if (/\d/.test(value)) continue;
    return value;
  }
  return "";
}

const LEADING_NOISE =
  /^(가장|비싼|싼|국내|우리|이번|오늘|내일|단독|속보|종합|친절한|이|그|저|또|다시|모두|모든|새|새로운|제|현|전|美|中|日)$/;
const TRAILING_VERB =
  /(다|요|했다|한다|됐다|된다|인다|났다|올라|올랐|줄어|늘어|몰려|잇따라|계속|예고|발표|지급|공개|논란|반발|우려|전망|돌파|기록)$/;

/** 제목 앞부분에서 숫자가 나오기 전까지의 명사구 — "편의점 도시락 가격" 같은 단위. */
function headPhrase(title: string): string {
  const cleaned = tidy(title).split(/[,·…|:;—–]+/)[0] ?? "";
  const words = cleaned.split(" ").filter(Boolean);
  const kept: string[] = [];
  for (const word of words) {
    if (LEADING_NOISE.test(stripParticle(word))) continue;
    if (/^\d/.test(word) || /%/.test(word) || /[?？!]$/.test(word)) break;
    if (TRAILING_VERB.test(stripParticle(word))) break;
    if (kept.length >= 3) break;
    kept.push(word);
  }
  if (kept.length === 0) return "";
  kept[kept.length - 1] = stripParticle(kept[kept.length - 1]);
  return kept
    .join(" ")
    .replace(/\s+/g, " ")
    .replace(/[.…]+$/, "")
    .trim();
}

/** 카드에 반복해서 쓰이는 주제어. 길면 16자에서 끊습니다. */
export function topicOf(title: string, summary = ""): string {
  const quoted = quotedTopic(title);
  if (quoted) return quoted;

  const hinted = hintedTopic(title);
  if (hinted) return hinted;

  const head = headPhrase(title);
  if (head.length >= 2) return head.slice(0, 16);

  const fallback = headPhrase(summary);
  if (fallback.length >= 2) return fallback.slice(0, 16);
  return "이 이슈";
}

/* ------------------------------------------------------------ 갈등 유형 분류 */

type Group =
  | "price"
  | "cut"
  | "rule"
  | "labor"
  | "work"
  | "hiring"
  | "scandal"
  | "tech"
  | "policy"
  | "culture"
  | "safety"
  | "consumer"
  | "service"
  | "default";

const GROUP_RULES: { group: Group; weight: number; re: RegExp }[] = [
  { group: "price", weight: 3, re: /(인상|올랐|올라|오른|비싸|가격|값|요금|물가|인상폭|출고가|폭리|부담|지출|비용)/ },
  { group: "cut", weight: 3, re: /(인하|축소|폐지|중단|줄어|줄이|감축|철회|무료였|유료로|사라진)/ },
  { group: "rule", weight: 2, re: /(규제|금지|단속|과태료|처벌|허용|완화|법안|개정|의무화|제재|부정행위|방지|검사)/ },
  { group: "labor", weight: 3, re: /(파업|노조|해고|정리해고|임금|최저임금|근로|노동|사측|교섭|단협|결렬)/ },
  { group: "work", weight: 2, re: /(회식|야근|재택|출근|주 4일|주4일|워라밸|상사|팀장|갑질|번아웃|점심)/ },
  { group: "hiring", weight: 3, re: /(채용|공채|구인|구직|일자리|고용|감원|인력|면접|구조조정)/ },
  { group: "scandal", weight: 3, re: /(논란|의혹|사과|파문|반발|비판|고소|소송|특혜|횡령|배임|담합|과징금|갑질)/ },
  { group: "tech", weight: 2, re: /(AI|인공지능|챗GPT|알고리즘|플랫폼|앱|서비스|개인정보|해킹|유출|딥페이크|반도체|로봇|서버)/ },
  { group: "policy", weight: 2, re: /(정부|당국|국회|법원|장관|대통령|여당|야당|지원금|보조금|세금|예산|공공|대책)/ },
  { group: "culture", weight: 2, re: /(드라마|예능|영화|게임|아이돌|팬덤|웹툰|공연|티켓|넷플릭스|시청률|앨범|컴백|원작)/ },
  { group: "safety", weight: 3, re: /(사고|화재|붕괴|사망|부상|안전|결함|리콜|중상|실종)/ },
  { group: "consumer", weight: 2, re: /(만족도|비교|성능|가성비|소비자원|1위|품질|후기|리뷰|환불|구매|소비)/ },
  { group: "service", weight: 3, re: /(접속|지연|먹통|오류|장애|몰려|몰린|서버|다운)/ },
];

/** 기사에 갈등 신호가 거의 없을 때는 카테고리라도 맞는 틀을 씁니다. */
const GROUP_BY_CATEGORY: Record<string, Group> = {
  work: "work",
  mz: "consumer",
  money: "price",
  tech: "tech",
  culture: "culture",
};

function classify(text: string, category = ""): Group {
  const catGroup = GROUP_BY_CATEGORY[category];
  let best: Group = "default";
  let bestScore = 0;
  let catScore = 0;
  for (const rule of GROUP_RULES) {
    const hits = text.match(new RegExp(rule.re.source, "g"))?.length ?? 0;
    if (hits === 0) continue;
    const score = rule.weight + Math.min(2, hits - 1);
    if (rule.group === catGroup) catScore = score;
    if (score > bestScore) {
      best = rule.group;
      bestScore = score;
    }
  }
  // 점수가 같으면 AI가 붙인 카테고리 쪽 틀을 먼저 믿습니다.
  if (catGroup && catScore > 0 && catScore >= bestScore) best = catGroup;
  if (bestScore === 0) return catGroup ?? "default";
  return best;
}

/* ------------------------------------------------------------------- 틀 모음 */

interface Frame {
  q: string;
  a: string;
  b: string;
  /** 기사에 이 말이 있을 때만 쓰는 틀(예: '원작 비교'는 원작 기사에서만). */
  when?: RegExp;
}

const FRAMES: Record<Group, Frame[]> = {
  price: [
    { q: "{t} 또 올랐다, 이번엔?", a: "이건 폭리, 안 산다", b: "원가 탓, 이해한다" },
    { q: "{t} 값, 결국 누가 내나?", a: "소비자한테 다 떠넘겼다", b: "기업도 버티기 힘들다" },
    { q: "{t} 인상, 그냥 넘어갈까?", a: "넘어가면 또 오른다", b: "어차피 다 오른다" },
    { q: "{t}, 이 가격이면 살까?", a: "안 산다, 대체품 찾는다", b: "어쩔 수 없이 산다" },
    { q: "{t} 꼼수, 용납되나?", a: "용납 안 된다, 따진다", b: "시장 논리다" },
    { q: "{t} 오른 만큼, 값하나?", a: "값 못 한다", b: "돈값은 한다" },
    { q: "{t}, 이번엔 참을까?", a: "참다가 더 당한다", b: "한 번은 참는다" },
  ],
  cut: [
    { q: "{t} 사라진다, 괜찮나?", a: "돌려달라, 바로 반발", b: "어차피 정리될 일" },
    { q: "{t} 중단, 납득되나?", a: "말도 안 된다", b: "그럴 만한 사정 있다" },
    { q: "{t} 없어지면 손해인가?", a: "내 몫부터 챙긴다", b: "대체 수단 있으면 된다" },
    { q: "{t} 축소, 누구 탓?", a: "회사가 꼼수 부린다", b: "어쩔 수 없는 구조다" },
  ],
  rule: [
    { q: "{t}, 규제가 답일까?", a: "당장 막아야 한다", b: "과잉 규제다" },
    { q: "{t} 금지, 동의하나?", a: "아예 못 하게 해야", b: "선 넘는 규제다" },
    { q: "{t} 단속, 효과 있을까?", a: "솜방망이라 안 된다", b: "일단 시작이 낫다" },
    { q: "{t}, 감시가 답인가?", a: "감시 더 강화해야", b: "사생활 침해다" },
    { q: "{t} 허용, 괜찮나?", a: "풀어야 한다", b: "풀면 사고 난다" },
  ],
  labor: [
    { q: "{t}, 누구 편인가?", a: "노동자 편이다", b: "회사 사정도 있다" },
    { q: "{t}, 더는 못 참지 않나?", a: "맞다, 지금 행동", b: "버티면 해결된다" },
    { q: "{t} 남 일 같나?", a: "내 일이다, 바뀌어야", b: "우리 회사는 다르다" },
    { q: "{t}, 회사 말 믿나?", a: "못 믿는다", b: "들어볼 만하다" },
    { q: "{t} 끝나면 달라질까?", a: "달라진다, 기대", b: "찍소리로 끝난다" },
  ],
  work: [
    { q: "{t}, 없애야 할까?", a: "당장 없애야", b: "없으면 또 아쉽다" },
    { q: "{t}, 쿨하게 거절하나?", a: "거절한다, 내 시간", b: "한 번쯤은 간다", when: /(회식|술|모임|약속|부름|당직)/ },
    { q: "{t}, 우리도 되나?", a: "우리도 당장", b: "우리 회사는 글렀다", when: /(주 4일|주4일|재택|시범|도입|확대)/ },
    { q: "{t}, 아직도 통하나?", a: "이제 안 통한다", b: "여전히 필요하다" },
    { q: "{t}, 솔직히 좋나?", a: "좋다, 인정", b: "시간 낭비다" },
  ],
  hiring: [
    { q: "{t}, 지금 들어갈까?", a: "기회다, 지원한다", b: "불안하다, 관망한다" },
    { q: "{t} 절반, 어디까지 갈까?", a: "더 줄어들 것", b: "바닥 찍고 반등" },
    { q: "{t} 소식, 남 일 같나?", a: "내 일이다, 준비한다", b: "아직은 괜찮다" },
    { q: "{t}, 문 좁아진다?", a: "더 좁아진다", b: "곧 다시 열린다" },
  ],
  scandal: [
    { q: "{t}, 사과로 끝날 일인가?", a: "사과로 끝내면 안 돼", b: "해명은 들을 만해" },
    { q: "{t}, 이건 선 넘었다", a: "선 넘었다, 책임 물어야", b: "확대 해석이다" },
    { q: "{t} 논란, 누가 더 문제?", a: "당사자 잘못이 크다", b: "몰아가기가 심하다" },
    { q: "{t} 해명, 믿을 만한가?", a: "못 믿는다, 또 있을 일", b: "일단 들어보자" },
    { q: "{t}, 결국 덮이나?", a: "덮으면 더 커진다", b: "시간이 약이다" },
  ],
  tech: [
    { q: "{t}, 믿고 써도 되나?", a: "못 믿는다, 지금 지운다", b: "편하면 쓴다" },
    { q: "{t} 편리함, 그 값어치?", a: "대가가 너무 크다", b: "편하면 충분하다" },
    { q: "{t}, 사람 대신 맡길까?", a: "사람이 할 일이다", b: "빨라야 산다" },
    { q: "{t}, 이제 기본인가?", a: "이제 필수다", b: "과대포장이다" },
    { q: "{t}, 직접 써봤나?", a: "써봤다, 만족", b: "안 써봤다, 관심 없다" },
  ],
  policy: [
    { q: "{t}, 정부가 나설 일인가?", a: "당장 해야 한다", b: "시장에 맡겨라" },
    { q: "{t}, 효과 있을까?", a: "말뿐인 정책이다", b: "일단 지켜보자" },
    { q: "{t}, 지금이 적기인가?", a: "지금 해야 한다", b: "말만 앞선다" },
    { q: "{t} 예산, 아깝나?", a: "아깝다, 반대한다", b: "필요하면 낸다", when: /(세금|예산|지원금|보조금)/ },
    { q: "{t}, 누가 책임지나?", a: "정부 책임이다", b: "각자 알아서" },
  ],
  culture: [
    { q: "{t}, 이건 좀 아니지 않나?", a: "아니다, 바로 손절", b: "취향 차이, 봐줄 만", when: /(논란|의혹|사과|비판|반발|혹평|표절|실망)/ },
    { q: "{t}, 흥행할까?", a: "난리 날 것 같다", b: "생각보다 조용할 듯" },
    { q: "{t}, 원작보다 나은가?", a: "원작이 낫다", b: "각색이 낫다", when: /(원작|리메이크|각색|웹툰)/ },
    { q: "{t} 논란, 작품은 따로?", a: "작품은 작품대로", b: "사람부터 본다", when: /(논란|의혹|사과|비판|반발)/ },
    { q: "{t}, 볼 만한가?", a: "볼 만하다, 추천", b: "시간 아깝다" },
  ],
  safety: [
    { q: "{t}, 누구 책임인가?", a: "관리 책임이다", b: "불가항력이었다" },
    { q: "{t} 재발, 막을 수 있나?", a: "제도부터 바꿔야", b: "어디서나 생기는 일" },
    { q: "{t}, 이 정도면 처벌인가?", a: "처벌 약하다", b: "과하다" },
    { q: "{t} 소식, 남 일 같나?", a: "내 일이다, 무섭다", b: "멀게 느껴진다" },
  ],
  consumer: [
    { q: "{t}, 비싼 게 좋은 걸까?", a: "비싼 값 못 한다", b: "비싼 덴 이유 있다" },
    { q: "{t}, 광고 믿고 사나?", a: "안 믿는다, 직접 본다", b: "후기면 충분하다" },
    { q: "{t} 1위, 믿을 만한가?", a: "광고일 뿐, 안 믿는다", b: "직접 써보면 안다", when: /(1위|순위|만족도|비교|조사)/ },
    { q: "{t}, 지금 바꿀까?", a: "바꾼다, 바로 비교", b: "쓰던 게 낫다" },
    { q: "{t}, 값어치 있나?", a: "돈 아깝다", b: "값한다" },
  ],
  service: [
    { q: "{t}, 이래도 되나?", a: "준비 안 된 게 문제", b: "몰리면 어쩔 수 없다" },
    { q: "{t} 또 터졌다, 믿나?", a: "못 믿는다", b: "다음엔 낫겠지" },
    { q: "{t}, 보상해야 하나?", a: "당연히 보상", b: "과한 요구다" },
    { q: "{t} 때문에 손해, 누구 탓?", a: "서비스 책임", b: "이용자 부주의" },
  ],
  default: [
    { q: "{t}, 당신 생각은?", a: "이건 아니다, 반대", b: "이 정도는 이해한다" },
    { q: "{t}, 남 일 같나?", a: "내 일이다, 지금 따진다", b: "일단 지켜본다" },
    { q: "{t}, 이대로 괜찮나?", a: "아니다, 바뀌어야", b: "괜찮다, 과하다" },
    { q: "{t}, 어디까지 봐주나?", a: "더는 안 된다", b: "아직은 봐준다" },
    { q: "{t}, 결국 누가 이기나?", a: "한쪽으로 기운다", b: "팽팽하다" },
    { q: "{t}, 지금 나설 때인가?", a: "지금 나선다", b: "때를 기다린다" },
  ],
};

/** 틀을 다 돌아도 겹칠 때 — 주제어를 선택지 안에 넣어 확실히 다른 문항으로. */
function lastResort(topic: string, round: number): DebatePoll {
  const short = topic.length > 10 ? topic.slice(0, 10) : topic;
  const variants: DebatePoll[] = [
    { question: `${short}, 어디까지 믿나?`, a: `${short}부터 의심한다`, b: `${short}도 사정 있다` },
    { question: `${short}, 지금 손절인가?`, a: `${short}는 안 된다`, b: `${short}는 지켜본다` },
    { question: `${short}, 끝까지 가나?`, a: `${short}에 끝까지 건다`, b: `${short}는 접는다` },
  ];
  return variants[round % variants.length];
}

/* ------------------------------------------------------------ 품질·중복 판정 */

/** 어느 이슈에나 붙는 밋밋한 문구 — 이게 보이면 AI 문항을 버리고 새로 만듭니다. */
const BLAND_QUESTION = [
  /이\s*뉴스,?\s*내\s*일상에\s*영향/,
  /이\s*이슈,?\s*어떻게\s*봐요/,
  /어떻게\s*보(시나요|십니까|나요|세요)/,
  /어떻게\s*생각(하시나요|하십니까|해요|인가요)/,
  /찬성(하시나요|하십니까|인가요|합니다|이신가요)/,
  /반대(하시나요|하십니까|인가요|합니다|이신가요)/,
  /받아들일\s*만한가/,
  /무엇을\s*더\s*보(시나요|나요)/,
  /어느\s*쪽(이|을)\s*(더\s*)?(좋|낫|선호)/,
  /영향이\s*있(나요|을까요)/,
  /어떻게\s*할까요/,
];

const BLAND_CHOICE = [
  /^찬성$/,
  /^반대$/,
  /^그렇다$/,
  /^아니다$/,
  /^이해된다$/,
  /^이해 안 .{0,6}$/,
  /^좋다$/,
  /^싫다$/,
  /^필요하다$/,
  /^불필요하다$/,
  /^늘어날 것$/,
  /^줄 것$/,
  /^이미 체감 중$/,
  /^아직 남 일$/,
];

const STOP_TOKENS = new Set([
  "그리고",
  "하지만",
  "그런데",
  "이번",
  "오늘",
  "지금",
  "관련",
  "대한",
  "위한",
  "라며",
  "라고",
  "한다",
  "했다",
  "된다",
  "있다",
  "없다",
  "것이다",
  "사람",
  "정도",
]);

function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.split(/[^가-힣A-Za-z0-9]+/)) {
    const word = stripParticle(raw);
    if (word.length < 2 || STOP_TOKENS.has(word) || /^\d+$/.test(word)) continue;
    out.add(word);
  }
  return out;
}

/** 기사와 무관한 문항(아무 이슈에나 붙는 질문)인지 봅니다. */
export function isBlandPoll(poll: DebatePoll | null | undefined, title = ""): boolean {
  if (!poll) return true;
  const question = tidy(poll.question);
  const a = tidy(poll.a);
  const b = tidy(poll.b);
  if (question.length < 8 || a.length < 2 || b.length < 2) return true;
  if (question === a || question === b || a === b) return true;
  if (BLAND_QUESTION.some((re) => re.test(question))) return true;
  if (BLAND_CHOICE.some((re) => re.test(a)) || BLAND_CHOICE.some((re) => re.test(b))) return true;
  if (a.length < 4 && b.length < 4) return true;
  if (title) {
    const compactTitle = title.replace(/\s+/g, "");
    const shared = tokens(`${question} ${a} ${b}`);
    const subject = tokens(title);
    let overlap = 0;
    for (const word of shared) {
      if (subject.has(word) || compactTitle.includes(word)) overlap += 1;
    }
    if (overlap === 0) return true;
  }
  return false;
}

/** 같은 선택지를 두 카드에 쓰지 않기 위한 비교용 서명. */
export function pollSignature(poll: DebatePoll): string {
  const norm = (value: string) => tidy(value).replace(/[\s.,!?~·'"()]/g, "");
  return [norm(poll.question), norm(poll.a), norm(poll.b)].join("|");
}

function sameChoices(x: DebatePoll, y: DebatePoll): boolean {
  const norm = (value: string) => tidy(value).replace(/[\s.,!?~·'"()]/g, "");
  return norm(x.a) === norm(y.a) && norm(x.b) === norm(y.b);
}

function tooSimilarQuestion(x: DebatePoll, y: DebatePoll): boolean {
  const norm = (value: string) => tidy(value).replace(/[^가-힣a-zA-Z0-9]/g, "");
  const left = norm(x.question);
  const right = norm(y.question);
  if (!left || !right) return false;
  if (left === right) return true;
  const grams = (value: string) => {
    const out = new Set<string>();
    for (let i = 0; i < value.length - 1; i += 1) out.add(value.slice(i, i + 2));
    return out;
  };
  const A = grams(left);
  const B = grams(right);
  let shared = 0;
  for (const gram of A) if (B.has(gram)) shared += 1;
  return shared / Math.min(A.size, B.size) > 0.82;
}

/* ------------------------------------------------------------------ 만들기 */

function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function fill(frame: Frame, topic: string): DebatePoll {
  return {
    question: frame.q.replace(/\{t\}/g, topic),
    a: frame.a.replace(/\{t\}/g, topic),
    b: frame.b.replace(/\{t\}/g, topic),
  };
}

function acceptable(poll: DebatePoll, avoid: DebatePoll[]): boolean {
  if (poll.question.length > 42 || poll.a.length > 26 || poll.b.length > 26) return false;
  if (isBlandPoll(poll)) return false;
  for (const used of avoid) {
    if (tooSimilarQuestion(poll, used) || sameChoices(poll, used)) return false;
  }
  return true;
}

/**
 * 이슈 하나에 쓸 A/B 문항을 만듭니다.
 * avoid에 같은 화면의 다른 문항을 넣으면 겹치지 않는 틀을 골라 줍니다.
 */
export function buildPoll(input: DebateInput): DebatePoll {
  const topic = topicOf(input.title, input.summary ?? "");
  const text = tidy(`${input.title} ${input.summary ?? ""} ${(input.body ?? "").slice(0, 400)}`);
  const group = classify(text, input.category);
  const own = FRAMES[group].filter((frame) => !frame.when || frame.when.test(text));
  const frames = own.length > 0 ? own : FRAMES[group];
  // 자기 갈등 유형의 틀을 먼저 다 쓰고, 그래도 안 되면 범용 틀로 넘어갑니다.
  const ordered = group === "default" ? frames : [...frames, ...FRAMES.default];
  const avoid = input.avoid ?? [];
  const start = hash(input.title) % frames.length;

  for (let step = 0; step < ordered.length; step += 1) {
    const poll = fill(ordered[(start + step) % ordered.length], topic);
    if (acceptable(poll, avoid)) return poll;
  }

  for (let round = 0; round < 6; round += 1) {
    const poll = lastResort(topic, round);
    if (acceptable(poll, avoid)) return poll;
  }

  const veryLast = lastResort(topic, avoid.length);
  return { ...veryLast, question: `${veryLast.question} (${avoid.length + 1})`.slice(0, 42) };
}

/**
 * 카드 묶음 전체의 투표 문항을 서로 다르게 맞춥니다.
 * AI가 만든 문항이 밋밋하거나 앞 카드와 겹치면 새로 만든 문항으로 바꿉니다.
 */
export function ensureDistinctPolls<
  T extends { title: string; summary?: string; body?: string; category?: string; poll: DebatePoll },
>(cards: T[]): { card: T; changed: boolean; from: DebatePoll }[] {
  const used: DebatePoll[] = [];
  return cards.map((card) => {
    const from = card.poll;
    const duplicated = used.some((poll) => sameChoices(poll, from) || tooSimilarQuestion(poll, from));
    let chosen = from;
    if (isBlandPoll(from, card.title) || duplicated) {
      chosen = buildPoll({
        title: card.title,
        summary: card.summary,
        body: card.body,
        category: card.category,
        avoid: used,
      });
      card.poll = chosen;
    }
    used.push(card.poll);
    return { card, changed: chosen !== from, from };
  });
}
