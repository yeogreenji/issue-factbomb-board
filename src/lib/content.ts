import type { Category, CategoryId, Comment, Issue, Reaction, ReactionCounts } from '../types';

export const CATEGORIES: Category[] = [
  {
    id: 'tech',
    label: 'IT·테크',
    short: '테크',
    text: 'text-tech',
    soft: 'bg-tech-soft text-tech',
    dot: 'bg-tech',
  },
  {
    id: 'retail',
    label: '유통·소비재',
    short: '유통',
    text: 'text-retail',
    soft: 'bg-retail-soft text-retail',
    dot: 'bg-retail',
  },
  {
    id: 'culture',
    label: '엔터·콘텐츠',
    short: '엔터',
    text: 'text-culture',
    soft: 'bg-culture-soft text-culture',
    dot: 'bg-culture',
  },
  {
    id: 'work',
    label: '직장인·커리어',
    short: '커리어',
    text: 'text-work',
    soft: 'bg-work-soft text-work',
    dot: 'bg-work',
  },
];

export const CATEGORY_MAP: Record<CategoryId, Category> = CATEGORIES.reduce(
  (acc, c) => ({ ...acc, [c.id]: c }),
  {} as Record<CategoryId, Category>,
);

export interface ReactionMeta {
  id: Reaction;
  emoji: string;
  label: string;
  hint: string;
  bar: string;
  chip: string;
}

export const REACTIONS: ReactionMeta[] = [
  {
    id: 'hot',
    emoji: '🔥',
    label: '불타는 중',
    hint: '이건 사과 타이밍',
    bar: 'bg-gradient-to-r from-heat to-ember',
    chip: 'text-heat',
  },
  {
    id: 'watch',
    emoji: '🤔',
    label: '지켜보는 중',
    hint: '아직 판단 보류',
    bar: 'bg-gradient-to-r from-gold to-[#d8ab55]',
    chip: 'text-gold',
  },
  {
    id: 'cool',
    emoji: '❄️',
    label: '훈훈·냉각',
    hint: '생각보다 괜찮음',
    bar: 'bg-gradient-to-r from-cool to-[#5aa7bd]',
    chip: 'text-cool',
  },
];

const NOW = Date.now();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const SEED_ISSUES: Issue[] = [
  {
    id: 'luna-beauty-seongsu-popup',
    category: 'retail',
    headline: '루나뷰티 성수 팝업, 재고 200개에 줄 3,000명 “오픈런이 사고가 됐다”',
    kicker: '5일 팝업 첫날, 오전 6시 대기 줄이 3,000명까지 늘었다',
    summary: [
      '루나뷰티가 성수동에서 연 5일 팝업의 첫날 준비 수량이 200개로 알려지며, 오전 6시부터 대기 줄이 3,000명까지 늘었다.',
      '오후 1시 품절 공지 뒤 현장에서는 예약 번호가 없는 방문객과 직원 간 실랑이가 벌어졌고, 일부는 “헛걸음 보상”을 요구했다.',
      '브랜드는 사과문 대신 “재고 확대 재오픈” 공지를 올렸고, 초청 고객에게만 별도 구매 링크를 보냈다.',
    ],
    insider:
      '오픈런은 브랜드가 **연출하는 것**이지 당하는 게 아니다. 줄 3,000명은 성공 지표가 아니라 운영 실패 지표다 — 수요를 알면서 200개만 푼 건 마케팅이 아니라 도박이다. 지금 필요한 건 감성적인 사과문이 아니라 “다음 방문객이 몇 시에 오면 산다”는 확답이다. 순서를 바꾸면 사과가 두 번째가 된다.',
    baseTemp: 94,
    source: '리테일워치',
    publishedAt: NOW - 2 * HOUR - 12 * MIN,
    tags: ['오픈런', '팝업', '품절'],
    editorPick: true,
  },
  {
    id: 'orbital-pay-membership',
    category: 'tech',
    headline: '오비탈페이, 멤버십 개편 하루 만에 “광고 15초 보면 캐시백” 꺼냈다',
    kicker: '월 4,900원 혜택 반토막 → 광고로 메우는 구조',
    summary: [
      '오비탈페이가 멤버십 3종을 2종으로 통합하고, 기존 플러스 요금제의 무료 배달·영화 할인 혜택을 절반 수준으로 줄였다.',
      '대신 “광고 15초 시청 시 300원 캐시백”을 신설했다. 하루 최대 3회, 월 2만 7,000원까지 받을 수 있다.',
      '공지 하루 만에 공식 커뮤니티에는 “구독료 내고 광고를 보라는 거냐”는 항의 글이 2,100건 올라왔고, 회사는 “다음 주 상세 안내”로 답을 미뤘다.',
    ],
    insider:
      '이번 개편의 진짜 목적은 캐시백이 아니라 **해지율 측정**이다. 혜택을 줄여도 남는 사람의 비율을 보고 싶은 것. 문제는 순서다 — 대안을 먼저 주고 혜택을 줄였어야 “업그레이드”로 읽히는데, 이번엔 축소 공지 사흘 뒤에야 대안이 나왔다. PR이 제품 일정에 끌려간 전형적인 사례.',
    baseTemp: 81,
    source: '테크브리프',
    publishedAt: NOW - 4 * HOUR - 20 * MIN,
    tags: ['멤버십 개편', '구독 경제', '해지율'],
    editorPick: true,
  },
  {
    id: 'half-market-dawn-delivery',
    category: 'retail',
    headline: '하프마켓, 새벽배송 3년 만에 중단…“새벽은 우리 것” 광고는 아직 걸려 있다',
    kicker: '공지 6시간 동안 메인 배너 그대로 노출',
    summary: [
      '하프마켓이 다음 달부터 새벽배송을 중단하고 오전 7시 배송으로 전환한다. 적자 누적이 이유라고 밝혔다.',
      '문제는 홈페이지 메인에 “새벽은 우리 것” 캠페인이 그대로 남아 있었다는 점. 공지 후 6시간 동안 배너는 내려가지 않았다.',
      '구독 멤버십 이용자에게는 위약금 없이 해지가 가능하다고 안내했다.',
    ],
    insider:
      '브랜드 슬로건은 계약서다. “새벽은 우리 것”이라고 3년 외운 회사가 새벽을 버리면 남는 건 슬로건이 아니라 **조롱거리**다. 이럴 때일수록 배너 교체는 공지보다 빨라야 한다. 6시간은 짧아 보이지만, 캡처는 6초면 된다.',
    baseTemp: 83,
    source: '리테일워치',
    publishedAt: NOW - 7 * HOUR - 5 * MIN,
    tags: ['새벽배송', '슬로건', '구독 해지'],
  },
  {
    id: 'convenience-lunchbox-price',
    category: 'retail',
    headline: '편의점 3사 도시락 동시 인상…“원가 때문”이라는데 원가표는 없었다',
    kicker: '같은 날, 같은 폭 500원. 공정위는 “현황 파악 중”',
    summary: [
      '편의점 3사가 이번 주 나란히 도시락 12종 가격을 500원 올렸다. 인상 폭과 시점이 사실상 같다.',
      '각 사는 “쌀·육류 원가 상승”을 이유로 들었지만, 인상분의 원가 반영 비율은 공개하지 않았다.',
      '커뮤니티에서는 “동시에 같은 폭”이라는 점을 두고 담합 의혹 글이 확산했고, 공정위는 “현황 파악 중”이라고 밝혔다.',
    ],
    insider:
      '원가 상승은 사실일 수 있다. 문제는 **설명의 순서**다. “왜 하필 셋이 같은 날, 같은 폭인가”에 답하지 않으면 원가표를 아무리 내도 의심은 걷히지 않는다. 이 상황에서 가장 비싼 실수는 “업계 관행”이라는 말이다.',
    baseTemp: 84,
    source: '리테일워치',
    publishedAt: NOW - 9 * HOUR,
    tags: ['가격 인상', '원가', '담합 의혹'],
  },
  {
    id: 'nova-works-4day-week',
    category: 'tech',
    headline: '노바웍스, 주 4일제 전면 실험…“급여는 그대로, 회의는 절반”',
    kicker: '전 직원 480명, 6개월 시범 운영',
    summary: [
      '노바웍스가 내년 1월부터 전 직원 480명을 대상으로 주 4일제를 6개월간 시범 운영한다. 급여와 연차는 유지된다.',
      '핵심은 근무일 축소가 아니라 회의 축소다. 상시 회의를 30분 단위로 제한하고, 보고서는 “한 장·세 문단”으로 통일했다.',
      '사내 반응은 엇갈린다. 개발 직군은 “집중 시간이 생겼다”는 쪽, 영업·CS 직군은 “고객 대응 공백”을 걱정하는 쪽이다.',
    ],
    insider:
      '주 4일제 보도에서 대부분 놓치는 건 **직군별 형평성**이다. 개발·기획은 성과가 산출물로 남지만, 고객 대응 직군은 시간이 곧 성과다. 이 실험이 성공하려면 “같은 4일”이 아니라 “같은 성과 기준”을 먼저 설계해야 한다. 홍보는 이미 이겼고, 인사는 아직 안 끝났다.',
    baseTemp: 62,
    source: '워크데일리',
    publishedAt: NOW - 11 * HOUR - 30 * MIN,
    tags: ['주 4일제', '조직문화', '생산성'],
    editorPick: true,
  },
  {
    id: 'lumen-ai-watermark',
    category: 'tech',
    headline: '루멘AI, 무료 플랜에 워터마크 넣자 유료 전환율 3배…“조용한 압박” 논쟁',
    kicker: '무료 한도 30회 → 12회, 투자자 설명회서 공개',
    summary: [
      '루멘AI가 무료 사용자의 생성물에 “Made with Lumen” 워터마크를 넣은 뒤 유료 전환율이 3.2배로 뛰었다고 투자자 설명회에서 밝혔다.',
      '무료 사용 한도도 하루 30회에서 12회로 줄였다. 회사는 “남용 방지”라고 설명했다.',
      '사용자 커뮤니티에서는 “품질이 아니라 수치로 밀어내는 방식”이라는 비판과 “서비스 값은 값”이라는 반론이 맞섰다.',
    ],
    insider:
      '전환율 3배는 성과가 아니라 **가격 인상의 다른 이름**일 수 있다. 지표가 좋아 보이는 이유는 이탈한 사용자를 분모에서 빼기 때문이다. 투자자 설명회에서 이 숫자만 강조하면, 다음 라운드에서 “무료 사용자 유지율”을 반드시 맞는다. 그때 이 3배가 자산인지 부채인지 갈린다.',
    baseTemp: 72,
    source: '테크브리프',
    publishedAt: NOW - 14 * HOUR - 10 * MIN,
    tags: ['프리미엄 전환', '워터마크', '지표'],
  },
  {
    id: 'glass-garden-finale-leak',
    category: 'culture',
    headline: '드라마 ‘유리정원’ 결말 유출…제작사가 먼저 스포일러를 뿌린 이유',
    kicker: '삭제 요청 대신 감독·작가 해설 영상 12분',
    summary: [
      'OTT 오리지널 ‘유리정원’ 최종화가 공개 전날 유출됐다. 제작사는 삭제 요청 대신 “공식 결말 해설” 영상을 먼저 올렸다.',
      '영상에는 감독과 작가가 결말의 의도를 12분간 설명했고, 공개 2시간 만에 조회수 40만을 넘겼다.',
      '제작사는 “유출본과 무관하게 정식 화를 봐 달라”고 했지만, 일부 시청자는 “결말을 먼저 알려준 셈”이라며 아쉬움을 표했다.',
    ],
    insider:
      '이건 꽤 영리한 수다. 유출은 막을 수 없으니 **해석의 권한**을 먼저 가져온 것. 스포일러는 정보가 아니라 맥락이라서, 맥락을 먼저 깔면 “아는 사람”이 아니라 “이해한 사람”이 된다. 다만 이 카드는 한 번만 쓸 수 있다. 다음 작품에선 “또 그러겠지”가 된다.',
    baseTemp: 68,
    source: '컬처로그',
    publishedAt: NOW - 13 * HOUR - 40 * MIN,
    tags: ['스포일러', 'OTT', '위기 대응'],
  },
  {
    id: 'pageon-binge-cap',
    category: 'culture',
    headline: '웹툰 ‘페이지온’, 정주행 결제 상한 도입…작가들 “독자를 우리 편에서 떼어낸다”',
    kicker: '하루 3만 원 상한, 정산 주기는 격주로 단축',
    summary: [
      '페이지온이 하루 정주행 결제 상한을 3만 원으로 제한하고, 초과분은 다음 날로 이월하는 정책을 예고했다.',
      '회사는 “과소비 방지와 건전한 이용”을 이유로 들었다. 작가 정산 주기는 월 1회에서 격주로 앞당긴다.',
      '작가 협의체는 “상한은 매출 상한”이라며 반대 성명을 냈고, 독자 게시판에는 “이월되면 결국 다 본다”는 냉소가 올라왔다.',
    ],
    insider:
      '정산 주기 단축은 진짜 카드다. 작가가 가장 아픈 지점은 매출이 아니라 **현금 흐름**이니까. 그런데 이걸 상한제와 같이 발표하면 좋은 카드가 의심받는다. 호의와 규제는 같은 봉투에 넣으면 둘 다 반값이 된다.',
    baseTemp: 64,
    source: '컬처로그',
    publishedAt: NOW - 16 * HOUR - 5 * MIN,
    tags: ['정산', '플랫폼 정책', '작가'],
  },
  {
    id: 'second-moon-ai-teaser',
    category: 'culture',
    headline: '아이돌 컴백 티저에 AI 얼굴 논란…소속사 “일부 보정” 해명이 더 키웠다',
    kicker: '팬덤은 원본 비하인드 영상을 요구, 광고주 한 곳은 게시물 내려',
    summary: [
      '그룹 ‘세컨드문’ 컴백 티저 이미지가 생성형 AI로 만든 것으로 알려지며 논란이 일었다. 배경과 손, 조명에서 AI 특유의 흔적이 보인다는 지적이었다.',
      '소속사는 “배경 합성에만 활용했고 인물은 실사”라고 해명했지만, 원본 촬영본은 공개하지 않았다.',
      '팬덤은 “해명 대신 비하인드 영상”을 요구하며 관련 해시태그를 트렌드에 올렸고, 광고주 한 곳은 게시물을 내렸다.',
    ],
    insider:
      'AI 사용 자체는 문제가 아니다. 문제는 **증명 책임을 팬에게 떠넘긴 것**. “실사입니다” 한 줄로 끝낼 일을 “일부 보정”이라는 애매한 말로 늘렸다. 이 업계에서 신뢰는 스펙이 아니라 과정으로 사는데, 과정을 안 보여주면 팬은 빈칸을 최악으로 채운다.',
    baseTemp: 77,
    source: '컬처로그',
    publishedAt: NOW - 18 * HOUR - 25 * MIN,
    tags: ['AI 이미지', '팬덤', '해명'],
  },
  {
    id: 'quiet-promotion',
    category: 'work',
    headline: '대기업 인사팀, ‘조용한 승진’ 도입…직급은 그대로, 연봉만 오른다',
    kicker: '눈치 경쟁 대신 보상에 집중, 내년부터 적용',
    summary: [
      '한 대기업이 직급 체계를 유지하면서 처우만 올리는 “조용한 승진” 제도를 내년부터 적용한다.',
      '직급 공백으로 생기는 눈치 경쟁을 줄이고, 실제 보상에 집중하겠다는 취지다.',
      '사내 반응은 “연봉은 좋지만 명함이 그대로면 이직 시 불리하다”는 우려가 다수였다.',
    ],
    insider:
      '보상은 숫자, 커리어는 언어다. 연봉만 올리고 직급을 그대로 두면 **내부 만족은 올라가고 외부 가치는 그대로**다. 이 제도를 성공시키려면 사내 공식 이력서에 “역할 등급”을 만들어 외부에 제시할 수 있어야 한다. 아니면 회사가 좋은 사람을 조용히 가두는 구조가 된다.',
    baseTemp: 65,
    source: '워크데일리',
    publishedAt: NOW - 20 * HOUR - 15 * MIN,
    tags: ['직급', '보상', '이직'],
  },
  {
    id: 'return-to-office-u-turn',
    category: 'work',
    headline: '재택 폐지 공지 하루 만에 철회…사내 게시판엔 400개 댓글이 남았다',
    kicker: '“생산성 저하” 문장이 가장 많이 인용됐다',
    summary: [
      '한 금융사가 “내년부터 전면 출근”을 공지했다가 26시간 만에 철회하고 “직군별 협의”로 방향을 바꿨다.',
      '공지에는 “생산성 저하”라는 표현이 있었고, 이 문장이 사내 게시판에서 가장 많이 인용됐다.',
      '회사는 “소통 부족을 인정한다”고 했지만, 직원들은 “철회가 아니라 보류”라며 후속 일정 공개를 요구했다.',
    ],
    insider:
      '철회는 결정을 되돌린 게 아니라 **신뢰를 되돌릴 수 없게 만든 것**이다. “생산성 저하”라는 한 문장이 남긴 상처는 정책보다 오래간다. 이 상황의 다음 카드는 재택 여부가 아니라 “우리가 무엇을 기준으로 판단했는지” 데이터를 공개하는 일이다.',
    baseTemp: 85,
    source: '워크데일리',
    publishedAt: NOW - 22 * HOUR - 30 * MIN,
    tags: ['재택근무', '공지', '신뢰'],
    editorPick: true,
  },
  {
    id: '52-hours-as-benefit',
    category: 'work',
    headline: '채용 공고에 “주 52시간 준수”를 복지로…지원자 “이게 장점이냐”',
    kicker: '야근 수당 문구는 없었다',
    summary: [
      '한 스타트업이 채용 공고 복지 항목 첫 줄에 “주 52시간 근무 준수”를 올렸다가 온라인에서 화제가 됐다.',
      '회사는 “야근이 없는 문화를 강조하려는 의도”라고 설명했지만, 공고에는 야근 수당 관련 문구가 없었다.',
      '지원자 커뮤니티에서는 “법을 지키는 게 복지면 최저임금도 복지”라는 반응이 나왔다.',
    ],
    insider:
      '복지란 **법 위에 더 얹는 것**이다. 법을 지킨 걸 자랑하려면 최소한 “왜 우리는 안 넘겼는지”를 보여줘야 한다. 좋은 공고는 “52시간 준수”가 아니라 “이번 분기 초과근무 0시간, 대체휴가 사용률 92%”처럼 숫자로 말한다. 이 한 줄로 회사는 아낄 것 없이 브랜드를 잃었다.',
    baseTemp: 71,
    source: '워크데일리',
    publishedAt: NOW - 1 * DAY - 2 * HOUR,
    tags: ['채용 공고', '복지', '야근'],
  },
];

export const SEED_COMMENTS: Comment[] = [
  // 루나뷰티
  {
    id: 'c-luna-1',
    issueId: 'luna-beauty-seongsu-popup',
    author: '성수동 골목대장',
    text: '재고 200개에 줄 3,000명이면 마케팅이 아니라 실험이다. 피실험자는 손님이고.',
    likes: 297,
    createdAt: NOW - 1 * HOUR - 20 * MIN,
  },
  {
    id: 'c-luna-2',
    issueId: 'luna-beauty-seongsu-popup',
    author: '오픈런 포기러',
    text: '사과문보다 “몇 시에 오면 살 수 있다”는 표 한 장이 더 위로가 된다.',
    likes: 184,
    createdAt: NOW - 1 * HOUR - 44 * MIN,
  },
  {
    id: 'c-luna-3',
    issueId: 'luna-beauty-seongsu-popup',
    author: '뷰티 MD 6년차',
    text: '초청 고객 링크 따로 보낸 건 잘한 선택. 다만 그 사실을 공지에 안 쓴 게 아쉽다.',
    likes: 96,
    createdAt: NOW - 58 * MIN,
  },
  // 오비탈페이
  {
    id: 'c-orbital-1',
    issueId: 'orbital-pay-membership',
    author: '해지버튼 장인',
    text: '구독료 내고 광고 보는 건, 헬스장 가서 트레이너가 유튜브 보는 거랑 같다.',
    likes: 328,
    createdAt: NOW - 3 * HOUR - 10 * MIN,
  },
  {
    id: 'c-orbital-2',
    issueId: 'orbital-pay-membership',
    author: '구독경제 생존자',
    text: '혜택 줄이는 건 알겠는데, 왜 항상 공지가 먼저고 대안이 나중이냐.',
    likes: 211,
    createdAt: NOW - 3 * HOUR - 52 * MIN,
  },
  {
    id: 'c-orbital-3',
    issueId: 'orbital-pay-membership',
    author: 'PR 7년차 익명',
    text: '이번 개편은 캐시백이 아니라 해지율 A/B 테스트다. 커뮤니티가 정확히 읽었다.',
    likes: 143,
    createdAt: NOW - 2 * HOUR - 30 * MIN,
  },
  // 하프마켓
  {
    id: 'c-half-1',
    issueId: 'half-market-dawn-delivery',
    author: '새벽 5시 러너',
    text: '새벽은 우리 것이라더니, 새벽만 남기고 다 버렸네.',
    likes: 231,
    createdAt: NOW - 5 * HOUR,
  },
  {
    id: 'c-half-2',
    issueId: 'half-market-dawn-delivery',
    author: '커머스 MD',
    text: '배너 교체는 공지보다 빨라야 한다. 캡처는 6초면 되니까.',
    likes: 128,
    createdAt: NOW - 4 * HOUR - 20 * MIN,
  },
  // 편의점
  {
    id: 'c-cvs-1',
    issueId: 'convenience-lunchbox-price',
    author: '도시락값 계산기',
    text: '셋이 같은 날 같은 폭이면 원가가 아니라 회의실이 의심된다.',
    likes: 196,
    createdAt: NOW - 8 * HOUR,
  },
  {
    id: 'c-cvs-2',
    issueId: 'convenience-lunchbox-price',
    author: '편의점 도시락 애호가',
    text: '500원 올릴 거면 김치 양은 왜 줄였냐. 그건 원가표에 없더라.',
    likes: 152,
    createdAt: NOW - 7 * HOUR - 10 * MIN,
  },
  // 노바웍스
  {
    id: 'c-nova-1',
    issueId: 'nova-works-4day-week',
    author: '야근없는회사 희망자',
    text: '주 4일제보다 회의 30분 제한이 더 부럽다. 그게 진짜 복지다.',
    likes: 205,
    createdAt: NOW - 9 * HOUR - 30 * MIN,
  },
  {
    id: 'c-nova-2',
    issueId: 'nova-works-4day-week',
    author: 'CS 5년차',
    text: '고객 대응 직군은 시간이 성과라서, 4일로 줄이면 하루가 12시간이 된다.',
    likes: 167,
    createdAt: NOW - 8 * HOUR - 40 * MIN,
  },
  // 루멘AI
  {
    id: 'c-lumen-1',
    issueId: 'lumen-ai-watermark',
    author: '무료플랜 생존자',
    text: '전환율 3배는 좋은데, 이탈률은 왜 안 알려주냐.',
    likes: 158,
    createdAt: NOW - 12 * HOUR,
  },
  {
    id: 'c-lumen-2',
    issueId: 'lumen-ai-watermark',
    author: 'AI PM',
    text: '워터마크는 기능이 아니라 가격표다. 그렇게 말하면 아무도 안 화난다.',
    likes: 121,
    createdAt: NOW - 11 * HOUR - 15 * MIN,
  },
  // 유리정원
  {
    id: 'c-glass-1',
    issueId: 'glass-garden-finale-leak',
    author: '정주행 3회차',
    text: '유출은 막을 수 없으니 해석을 먼저 가져온 것. 이건 PR이 아니라 편집이다.',
    likes: 174,
    createdAt: NOW - 11 * HOUR,
  },
  {
    id: 'c-glass-2',
    issueId: 'glass-garden-finale-leak',
    author: '드라마 덕후',
    text: '해설 영상 좋았는데, 결말 스포일러는 영상 첫 3초에 있었다.',
    likes: 109,
    createdAt: NOW - 10 * HOUR - 25 * MIN,
  },
  // 페이지온
  {
    id: 'c-pageon-1',
    issueId: 'pageon-binge-cap',
    author: '웹툰 정주행 3천화',
    text: '이월되면 결국 다 본다. 상한이 아니라 할부를 만든 거다.',
    likes: 163,
    createdAt: NOW - 14 * HOUR,
  },
  {
    id: 'c-pageon-2',
    issueId: 'pageon-binge-cap',
    author: '작가 지망생',
    text: '정산 격주 전환은 진짜 좋은 소식. 왜 상한제랑 같이 냈을까.',
    likes: 138,
    createdAt: NOW - 13 * HOUR - 30 * MIN,
  },
  // 세컨드문
  {
    id: 'c-moon-1',
    issueId: 'second-moon-ai-teaser',
    author: '팬덤 3년차',
    text: 'AI 보정은 괜찮다. 근데 “실사”라고 하지는 마라.',
    likes: 198,
    createdAt: NOW - 16 * HOUR,
  },
  {
    id: 'c-moon-2',
    issueId: 'second-moon-ai-teaser',
    author: '엔터 마케터',
    text: '원본 한 장만 올리면 끝날 일을 “일부”라는 단어로 3일째 끌고 있다.',
    likes: 145,
    createdAt: NOW - 15 * HOUR - 20 * MIN,
  },
  // 조용한 승진
  {
    id: 'c-quiet-1',
    issueId: 'quiet-promotion',
    author: '인사팀 옆자리',
    text: '연봉은 오르는데 명함은 그대로면, 이직할 때 경력이 3년 멈춘 것처럼 보인다.',
    likes: 149,
    createdAt: NOW - 19 * HOUR,
  },
  {
    id: 'c-quiet-2',
    issueId: 'quiet-promotion',
    author: '대리 7년차',
    text: '조용한 승진의 반대말은 조용한 퇴사다.',
    likes: 186,
    createdAt: NOW - 18 * HOUR - 10 * MIN,
  },
  // 재택 철회
  {
    id: 'c-rto-1',
    issueId: 'return-to-office-u-turn',
    author: '재택 3년차',
    text: '철회는 결정을 되돌리지만, “생산성 저하”라는 말은 되돌리지 못한다.',
    likes: 254,
    createdAt: NOW - 20 * HOUR,
  },
  {
    id: 'c-rto-2',
    issueId: 'return-to-office-u-turn',
    author: '금융권 노조원',
    text: '철회가 아니라 보류다. 다음 분기에 또 나온다.',
    likes: 141,
    createdAt: NOW - 19 * HOUR - 30 * MIN,
  },
  // 52시간
  {
    id: 'c-52-1',
    issueId: '52-hours-as-benefit',
    author: '취준 2년차',
    text: '법 지키는 걸 복지라 부르면, 숨 쉬는 것도 복지다.',
    likes: 271,
    createdAt: NOW - 22 * HOUR,
  },
  {
    id: 'c-52-2',
    issueId: '52-hours-as-benefit',
    author: '스타트업 인사',
    text: '좋은 공고는 “52시간 준수”가 아니라 초과근무 0시간을 숫자로 쓴다.',
    likes: 132,
    createdAt: NOW - 21 * HOUR - 10 * MIN,
  },
];


/** Seed vote tallies — the room has already been voting since morning. */
export const SEED_VOTES: Record<string, ReactionCounts> = {
  'luna-beauty-seongsu-popup': { hot: 2550, watch: 300, cool: 60 },
  'orbital-pay-membership': { hot: 1284, watch: 412, cool: 187 },
  'half-market-dawn-delivery': { hot: 980, watch: 320, cool: 105 },
  'convenience-lunchbox-price': { hot: 1520, watch: 480, cool: 140 },
  'nova-works-4day-week': { hot: 420, watch: 500, cool: 260 },
  'lumen-ai-watermark': { hot: 402, watch: 331, cool: 88 },
  'glass-garden-finale-leak': { hot: 560, watch: 480, cool: 220 },
  'pageon-binge-cap': { hot: 480, watch: 470, cool: 250 },
  'second-moon-ai-teaser': { hot: 890, watch: 300, cool: 210 },
  'quiet-promotion': { hot: 380, watch: 470, cool: 170 },
  'return-to-office-u-turn': { hot: 1310, watch: 460, cool: 88 },
  '52-hours-as-benefit': { hot: 620, watch: 380, cool: 200 },
};
