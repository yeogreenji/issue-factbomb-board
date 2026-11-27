#!/usr/bin/env node
/**
 * Vercel 없이 실제 서버리스 함수(api/trending.ts · api/briefing.ts · api/poll.ts)를 그대로 실행하는 로컬 서버.
 *
 *   node scripts/serve.mjs --port 4185 --api=on --store=redis --ai=gemini --feeds=on
 *
 *   --api=off     /api/* 를 404로 돌려 GitHub Pages(정적 호스팅)를 흉내냅니다.
 *   --store=redis 가짜 Upstash REST 엔드포인트를 띄워 공용 집계 경로를 그대로 검증합니다.
 *   --feeds=on    가짜 언론사 RSS 13곳을 띄웁니다(실제 언론사에 요청하지 않음). off 면 연결 실패 상황.
 *   --ai=gemini   가짜 Gemini — 후보 기사 제목에 맞는 카드 JSON을 돌려줍니다(실제 키 불필요).
 *   --ai=demo     위와 같되, 문서용 스크린샷에 쓰는 정돈된 카드 문구를 씁니다.
 *   --ai=off      AI 키 없이 501/헤드라인 카드 경로를 검증합니다.
 */
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

const argv = process.argv.slice(2);
const args = new Map();
for (let i = 0; i < argv.length; i += 1) {
  const token = argv[i];
  if (!token.startsWith('--')) continue;
  const body = token.slice(2);
  if (body.includes('=')) {
    const [key, ...rest] = body.split('=');
    args.set(key, rest.join('='));
  } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
    args.set(body, argv[i + 1]);
    i += 1;
  } else {
    args.set(body, 'on');
  }
}

const DIST = join(ROOT, args.get('dist') ?? 'dist');
const TMP = join(ROOT, '.tmp');
const PORT = Number(args.get('port') ?? process.env.PORT ?? 4185);
const API_ON = (args.get('api') ?? 'on') !== 'off';
const STORE = args.get('store') ?? 'memory';
const AI = args.get('ai') ?? 'off';
const FEEDS = args.get('feeds') ?? 'on';
/** --allow-local=off 면 기사 읽기의 사설망 차단을 실제 배포와 똑같이 켭니다. */
const ALLOW_LOCAL = (args.get('allow-local') ?? 'on') !== 'off';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/* ------------------------------------------------------- fixture news */

/**
 * 검증용 가짜 기사 — 실존 인물·회사·사건과 무관한 테스트 픽스처입니다.
 * 실제 배포에서는 api/trending.ts 가 실제 언론사 RSS를 읽습니다.
 */
const FIXTURES = [
  {
    slug: 'yna-news',
    title: '직장인 10명 중 6명 "점심값 1만5천원 넘으면 부담"',
    summary:
      '직장인 1천명을 대상으로 한 설문에서 58%가 점심 예산을 1만5천원 이하로 잡았다고 답했다. 1년 전 같은 조사보다 평균 예산이 2천원 늘었다.',
    category: 'work',
    card: {
      hook: '점심값 1만5천원, 이제 월급에서 빠지는 고정비',
      kicker: '직장인 58%가 "1만5천원 넘으면 부담"',
      facts: [
        '직장인 1천명 중 58%가 점심 예산을 1만5천원 이하로 잡았어요.',
        '1년 전 같은 조사보다 평균 점심 예산이 2천원 늘었어요.',
      , '응답자의 64%는 점심값이 더 오르면 메뉴를 바꾸겠다고 답했어요.'],
      sides: {
        a: '물가가 오른 만큼 식당도 어쩔 수 없다는 쪽',
        b: '월급은 그대로인데 점심값만 오르는 건 이해하기 어렵다는 쪽',
      },
      poll: { question: '점심값 1만5천원, 순순히 낼 수 있나?', a: '이제 점심도 사치다', b: '그 정도는 낸다' },
      temp: 74,
      tags: ['점심값', '물가', '직장인'],
    },
  },
  {
    slug: 'yna-news',
    title: 'MZ세대 "회식보다 점심"…저녁 회식 참석률 3년 새 18%p↓',
    summary:
      '20~30대 직장인의 저녁 회식 참석률이 3년 전보다 18%포인트 떨어졌다. 같은 기간 점심 약속은 6%포인트 늘었다.',
    category: 'work',
    card: {
      hook: '저녁 회식은 사라지고 점심 약속이 남았다',
      kicker: '20~30대 저녁 회식 참석률 3년 새 18%p↓',
      facts: [
        '20~30대 직장인의 저녁 회식 참석률이 3년 전보다 18%포인트 줄었어요.',
        '같은 기간 점심 약속은 6%포인트 늘었어요.',
      , '점심을 고른 이유 1위는 "저녁 시간을 지키고 싶어서"였어요.'],
      sides: {
        a: '일과 저녁을 분리하려는 자연스러운 변화라는 쪽',
        b: '팀 문화가 끊긴다는 우려도 함께 나오는 쪽',
      },
      poll: { question: '저녁 회식, 이제 끝내도 되나?', a: '없애자, 내 시간', b: '가끔은 필요하다' },
      temp: 61,
      tags: ['회식', 'MZ', '직장문화'],
    },
  },
  {
    slug: 'yna-economy',
    title: '편의점 도시락 가격 1년 새 12% 올라…"런치플레이션 계속"',
    summary:
      '주요 편의점 도시락 가격이 1년 사이 평균 12% 올랐다. 지난해 같은 기간 상승률(6%)의 두 배다.',
    category: 'money',
    card: {
      hook: '도시락도 1년 새 12% 올랐다',
      kicker: '지난해 상승률의 두 배',
      facts: [
        '주요 편의점 도시락 가격이 1년 사이 평균 12% 올랐어요.',
        '지난해 같은 기간 상승률 6%의 두 배예요.',
      , '같은 기간 편의점 김밥 가격 상승률은 4%에 그쳤어요.'],
      sides: {
        a: '원재료·인건비가 올라 가격을 올릴 수밖에 없다는 쪽',
        b: '가장 싼 한 끼가 사라지는 건 다르게 봐야 한다는 쪽',
      },
      poll: { question: '도시락 12% 인상, 그냥 넘어갈까?', a: '안 산다, 다른 데 간다', b: '원가 탓, 이해한다' },
      temp: 68,
      tags: ['도시락', '편의점', '물가'],
    },
  },
  {
    slug: 'yna-economy',
    title: '2030 구독 서비스 지출 월 4만2천원…"안 쓰는 구독 2개"',
    summary:
      '20~30대가 구독 서비스에 쓰는 돈은 월 평균 4만2천원으로 집계됐다. 응답자의 47%가 "거의 쓰지 않는 구독이 2개 이상 있다"고 답했다.',
    category: 'money',
    card: {
      hook: '한 달 구독료 4만2천원, 그중 두 개는 안 쓴다',
      kicker: '2030 응답자 47%가 "안 쓰는 구독 2개 이상"',
      facts: [
        '20~30대 구독 서비스 지출은 월 평균 4만2천원이에요.',
        '응답자 47%가 거의 쓰지 않는 구독이 2개 이상 있다고 답했어요.',
      , '해지하지 않는 이유 1위는 "언제 쓸지 몰라서"였어요.'],
      sides: {
        a: '필요할 때만 결제하는 방식이 합리적이라는 쪽',
        b: '해지 버튼이 숨어 있는 구조가 문제라는 쪽',
      },
      poll: { question: '안 쓰는 구독 2개, 바로 해지?', a: '당장 해지한다', b: '귀찮아서 그냥 둔다' },
      temp: 52,
      tags: ['구독', '소비', '2030'],
    },
  },
  {
    slug: 'yna-industry',
    title: '국내 AI 스타트업, 신규 채용 절반으로 줄여',
    summary:
      '국내 AI 스타트업 30곳의 올해 신규 채용 규모가 지난해의 절반 수준으로 줄었다. 투자 위축과 개발 비용 증가가 겹친 결과로 분석된다.',
    category: 'tech',
    card: {
      hook: 'AI 붐인데 AI 회사 채용은 반으로 줄었다',
      kicker: '국내 AI 스타트업 30곳 신규 채용 지난해 절반',
      facts: [
        '국내 AI 스타트업 30곳의 올해 신규 채용이 지난해의 절반 수준으로 줄었어요.',
        '투자 위축과 개발 비용 증가가 겹친 결과로 분석됐어요.',
      , '같은 기간 경력직 채용 공고는 12% 늘었어요.'],
      sides: {
        a: '모델 개발은 줄고 도입·운영 인력으로 옮겨가는 과정이라는 쪽',
        b: 'AI boom과 채용 감소가 같이 가는 건 이상하다는 쪽',
      },
      poll: { question: 'AI 스타트업 채용 절반, 들어갈까?', a: '기회다, 지원한다', b: '불안하다, 관망한다' },
      temp: 66,
      tags: ['AI', '채용', '스타트업'],
    },
  },
  {
    slug: 'yna-culture',
    title: '웹툰 원작 드라마 첫 방송 시청률 동시간 1위',
    summary: '웹툰을 원작으로 한 드라마가 첫 방송에서 동시간대 시청률 1위를 기록했다. 원작 독자와 신규 시청자가 함께 몰린 결과로 풀이된다.',
    category: 'culture',
    card: {
      hook: '웹툰 원작 드라마, 첫 방송에 동시간 1위',
      kicker: '원작 독자 + 신규 시청자 동시 유입',
      facts: ['웹툰 원작 드라마가 첫 방송에서 동시간대 시청률 1위를 기록했어요.', '원작 독자와 신규 시청자가 함께 본 결과로 풀이돼요.', '첫 방송 직후 원작 웹툰 조회수가 3배로 늘었어요.'],
      sides: {
        a: '원작 팬덤이 이미 검증된 이야기를 밀어준다는 쪽',
        b: '원작과 다른 각색에 대한 불만도 함께 나온다는 쪽',
      },
      poll: { question: '웹툰 원작 드라마, 원작만 못한가?', a: '원작이 낫다', b: '각색이 낫다' },
      temp: 48,
      tags: ['드라마', '웹툰', '시청률'],
    },
  },
  {
    slug: 'yna-society',
    title: '청년 지원금 신청 첫날 3만명 몰려…"서버 지연"',
    summary: '청년 대상 지원금 신청이 시작된 첫날 3만명이 몰리며 접속 지연이 이어졌다. 담당 기관은 서버를 늘려 오후부터 정상화했다고 밝혔다.',
    category: 'society',
    card: {
      hook: '지원금 신청 첫날 3만명, 서버가 먼저 지쳤다',
      kicker: '오후부터 정상화',
      facts: ['지원금 신청 첫날 3만명이 몰려 접속이 지연됐어요.', '담당 기관은 서버를 늘려 오후부터 정상화했다고 밝혔어요.', '접속자는 오전 9시에 가장 많이 몰렸어요.'],
      sides: {
        a: '첫날 몰림은 예상 가능한 일, 빠른 복구로 충분하다는 쪽',
        b: '신청 기간이 짧은데 첫날부터 막히면 곤란하다는 쪽',
      },
      poll: { question: '신청 첫날 서버 먹통, 누구 탓?', a: '준비 안 한 게 문제', b: '몰리면 어쩔 수 없다' },
      temp: 57,
      tags: ['지원금', '청년', '서버'],
    },
  },
  {
    slug: 'bloter',
    title: '구독형 AI 서비스, 요금 인상 잇따라…사용자 반발',
    summary: '구독형 AI 서비스 여러 곳이 이달 들어 요금을 올렸다. 사용자들은 기능 변화 없이 가격만 올랐다며 반발하고 있다.',
    category: 'tech',
    card: {
      hook: 'AI 구독료 줄줄이 인상, 기능은 그대로',
      kicker: '이달 들어 여러 서비스가 가격 인상',
      facts: ['구독형 AI 서비스 여러 곳이 이달 들어 요금을 올렸어요.', '사용자들은 기능 변화 없이 가격만 올랐다고 반발하고 있어요.', '인상 폭은 서비스별로 10~20% 수준이에요.'],
      sides: {
        a: '모델 운영 비용이 계속 오르니 가격 인상은 불가피하다는 쪽',
        b: '가격을 올리려면 무엇이 좋아졌는지 먼저 보여 줘야 한다는 쪽',
      },
      poll: { question: 'AI 구독료 인상, 계속 낼 건가?', a: '이번엔 해지한다', b: '기능만 좋으면 낸다' },
      temp: 71,
      tags: ['AI', '구독료', '가격'],
    },
  },
  {
    slug: 'mk',
    title: '주 4일제 시범 사업 참여 기업 두 배로 늘어',
    summary: '주 4일제 시범 사업에 참여하는 기업이 지난해보다 두 배로 늘었다. 참여 기업들은 생산성이 유지되거나 오히려 올랐다고 답했다.',
    category: 'work',
    card: {
      hook: '주 4일제 참여 기업, 1년 만에 두 배',
      kicker: '참여 기업 "생산성 유지되거나 올랐다"',
      facts: ['주 4일제 시범 사업 참여 기업이 지난해보다 두 배로 늘었어요.', '참여 기업들은 생산성이 유지되거나 오히려 올랐다고 답했어요.', '시범 사업에는 30인 미만 기업이 절반 넘게 참여했어요.'],
      sides: {
        a: '업종에 따라 이미 통하는 방식이라는 쪽',
        b: '모든 업종에 적용하기엔 무리라는 쪽',
      },
      poll: { question: '주 4일제, 우리 회사도 되나?', a: '우리도 당장', b: '우리 회사는 글렀다' },
      temp: 63,
      tags: ['주4일제', '근로시간', '생산성'],
    },
  },
  {
    slug: 'yna-ent',
    title: '아이돌 그룹 루멘, 데뷔 10년 만에 첫 월드투어…티켓 3분 만에 매진',
    summary:
      '그룹 루멘이 데뷔 10주년을 맞아 첫 월드투어를 연다. 서울 공연 티켓 2만4천석이 오픈 3분 만에 매진됐고, 소속사는 추가 회차를 검토 중이라고 밝혔다.',
    category: 'entertainment',
    card: {
      hook: '데뷔 10년 만의 월드투어, 티켓 3분 만에 매진',
      kicker: '서울 2만4천석 오픈 3분 만에 동나',
      facts: [
        '루멘의 첫 월드투어 서울 공연 티켓 2만4천석이 3분 만에 매진됐어요.',
        '소속사는 팬 요청이 이어지자 추가 회차를 검토 중이라고 밝혔어요.',
        '데뷔 10주년 기념 투어로, 5개국 11개 도시를 돕니다.',
      ],
      background:
        '루멘은 지난해 정규 3집으로 활동을 쉬었어요. 올해 초 팬미팅에서 신곡을 먼저 공개하며 컴백 신호를 보냈고, 투어 발표와 함께 예약이 몰렸어요.',
      point: '10년 차 그룹의 첫 월드투어 — 팬덤이 증명한 것',
      sides: {
        labelA: '팬덤',
        labelB: '일반 관객',
        a: '10년 기다린 팬이 먼저 잡아야 한다는 쪽',
        b: '추가 회차 없이 매크로만 이긴다면 문제라는 쪽',
      },
      poll: { question: '3분 매진, 팬덤 힘인가 티켓팅 문제인가?', a: '팬덤이 대단한 것', b: '구조가 문제다' },
      temp: 78,
      tags: ['루멘', '월드투어', '티켓팅'],
    },
  },
  {
    slug: 'topstar',
    title: "드라마 '겨울의 문' 최고 시청률 18.7%…OST가 역주행",
    summary:
      "드라마 '겨울의 문'이 8회에서 자체 최고 시청률 18.7%를 기록했다. 방송 직후 삽입곡이 음원 차트 40위에서 3위로 뛰어올랐다.",
    category: 'entertainment',
    card: {
      hook: '시청률 18.7% 찍자 OST가 40위→3위로 역주행',
      kicker: '8회 방송 직후 음원 차트가 뒤집혔다',
      facts: [
        "'겨울의 문' 8회 시청률이 18.7%로 자체 최고를 기록했어요.",
        '방송 직후 삽입곡이 음원 차트 40위에서 3위로 올랐어요.',
        '제작진은 "원래 3회에 깔려던 곡"이라며 당황했다고 전했어요.',
      ],
      background:
        '이 드라마는 첫 방송 6.2%로 출발해 매주 시청률을 끌어올렸어요. 7회 엔딩에서 주인공이 떠나는 장면이 화제가 되며 반등했어요.',
      point: '장면 하나가 곡을 다시 차트로 끌어올렸다',
      sides: {
        labelA: '드라마 팬',
        labelB: '원곡 팬',
        a: '장면과 곡이 맞아떨어져서 다시 들었다는 쪽',
        b: '드라마 효과로만 뜬 곡은 오래 못 간다는 쪽',
      },
      poll: { question: 'OST 역주행, 실력인가 드라마 효과인가?', a: '곡이 좋아서다', b: '드라마 빨이다' },
      temp: 66,
      tags: ['겨울의문', 'OST', '시청률'],
    },
  },
  {
    slug: 'sbs-society',
    title: '첫눈에 출근길 지하철 지연…한파에 전력 사용량 역대 최고',
    summary:
      '수도권에 첫눈이 내린 출근 시간대 지하철 2·4호선이 20분 넘게 지연됐다. 같은 날 오전 전력 사용량은 11월 기준 역대 최고치를 기록했다.',
    category: 'society',
    card: {
      hook: '첫눈 출근길, 지하철 20분 지연에 전력은 최고치',
      kicker: '2·4호선 지연, 오전 전력 사용량 11월 최대',
      facts: [
        '첫눈이 내린 출근 시간대 2·4호선 운행이 20분 넘게 지연됐어요.',
        '같은 날 오전 전력 사용량이 11월 기준 역대 최고를 기록했어요.',
        '기상청은 이번 주 영하권 추위가 이어진다고 예보했어요.',
      ],
      background:
        '지난주까지 평년보다 따뜻한 날씨가 이어졌어요. 갑자기 기온이 떨어지며 난방 수요와 도로 결빙이 한꺼번에 몰렸어요.',
      point: '첫눈 하루에 출근·난방이 동시에 흔들렸다',
      sides: {
        labelA: '출근길 시민',
        labelB: '운영 기관',
        a: '예보가 있었는데 대비가 없었다는 쪽',
        b: '첫눈에 몰린 수요는 어쩔 수 없다는 쪽',
      },
      poll: { question: '첫눈 출근길 먹통, 누구 책임인가?', a: '대비 부족이다', b: '어쩔 수 없었다' },
      temp: 61,
      tags: ['첫눈', '지하철지연', '한파'],
    },
  },
  {
    slug: 'yna-society',
    title: '아파트 단지 내 반려견 목줄 규정 두고 주민 갈등',
    summary:
      '한 아파트 단지가 엘리베이터 안 반려견 목줄 착용을 의무화하는 관리 규정을 새로 걸었다. 찬성 62%, 반대 38%로 주민 투표가 갈렸다.',
    category: 'society',
    card: {
      hook: '엘리베이터 목줄 의무, 주민 62% 찬성 38% 반대',
      kicker: '관리 규정 신설에 입주민 투표까지 열렸다',
      facts: [
        '한 아파트 단지가 엘리베이터 내 반려견 목줄 착용을 의무화했어요.',
        '주민 투표 결과 찬성 62%, 반대 38%로 갈렸어요.',
        '반대 주민은 "반려견이 무서워하는 경우도 있다"고 말했어요.',
      ],
      background:
        '앞서 같은 단지에서 반려견이 사람에게 달려드는 일이 두 번 있었어요. 관리사무소가 규정을 만들었지만 강제성 논란이 이어졌어요.',
      point: '안전과 반려인의 자유 사이 — 어디까지 규정할 수 있나',
      sides: {
        labelA: '찬성 주민',
        labelB: '반려인',
        a: '공용 공간에서는 모두가 편해야 한다는 쪽',
        b: '목줄은 이미 법으로 정해져 있고, 추가 규정은 과하다는 쪽',
      },
      poll: { question: '엘리베이터 목줄 의무, 과한가?', a: '당연한 규정이다', b: '반려인만 불편하다' },
      temp: 57,
      tags: ['반려견', '아파트', '주민갈등'],
    },
  },
  {
    slug: 'sbs-life',
    title: "11월 전시 관람객 40% 늘어…'전시 데이트'가 겨울 유행",
    summary:
      '11월 들어 주요 미술관 관람객이 지난해 같은 기간보다 40% 늘었다. 20~30대 관람객 비중이 절반을 넘었고, 야간 개장 티켓은 조기 매진됐다.',
    category: 'culture',
    card: {
      hook: '11월 미술관 관람객 40% 증가, 절반이 2030',
      kicker: '야간 개장 티켓은 오픈 당일 매진',
      facts: [
        '11월 주요 미술관 관람객이 지난해보다 40% 늘었어요.',
        '20~30대 관람객 비중이 처음으로 절반을 넘었어요.',
        '야간 개장 티켓은 예매 시작 당일 매진됐어요.',
      ],
      background:
        'SNS에서 조명 좋은 전시장 사진이 퍼지며 주말 데이트 코스로 자리 잡았어요. 미술관들은 야간 개장과 굿즈를 늘리고 있어요.',
      point: '전시가 데이트 코스가 되면서 관람 방식도 바뀐다',
      sides: {
        labelA: '전시 관람객',
        labelB: '미술 관계자',
        a: '사진 찍으러 와도 작품을 보게 된다는 쪽',
        b: '작품보다 사진이 목적이면 전시가 아니라는 쪽',
      },
      poll: { question: '전시 데이트, 문화생활인가 사진 찍기인가?', a: '문화생활 맞다', b: '사진 찍기다' },
      temp: 44,
      tags: ['전시', '미술관', '데이트'],
    },
  },
];

function rssFor(slug) {
  let items = FIXTURES.filter((fixture) => fixture.slug === slug);
  // 검증용 피드 13곳을 모두 살아 있게 하려고, 픽스처가 없는 슬러그는 다른 픽스처를 돌려 씁니다.
  // (같은 제목은 api/trending.ts 에서 중복 제거되므로 카드가 겹치지 않습니다)
  if (items.length === 0) {
    let h = 0;
    for (let i = 0; i < slug.length; i += 1) h = (h * 31 + slug.charCodeAt(i)) % 997;
    items = [FIXTURES[h % FIXTURES.length], FIXTURES[(h + 3) % FIXTURES.length], FIXTURES[(h + 5) % FIXTURES.length]];
  }
  const now = Date.now();
  const body = items
    .map((fixture, index) => {
      const date = new Date(now - (index + 1) * 42 * 60 * 1000).toUTCString();
      const link = `http://127.0.0.1:${PORT}/fake-article/${encodeURIComponent(fixture.title)}?feed=${encodeURIComponent(slug)}`;
      const image = `http://127.0.0.1:${PORT}/fake-img/${slug}-${index}.svg`;
      return `<item><title><![CDATA[${fixture.title}]]></title><link>${link}</link><pubDate>${date}</pubDate><description><![CDATA[${fixture.summary}]]></description><media:content url="${image}" type="image/svg+xml" /></item>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>테스트 뉴스 ${slug}</title><language>ko</language>${body}</channel></rss>`;
}

function svgImage(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 360;
  const h2 = (h + 42) % 360;
  const label = ['CULTURE', 'SOCIETY', 'STAGE', 'CITY', 'PEOPLE', 'NIGHT'][h % 6];
  let dots = '';
  for (let y = 20; y < 420; y += 16) {
    for (let x = 14; x < 640; x += 16) {
      dots += `<circle cx="${x}" cy="${y}" r="1.1" fill="rgba(255,255,255,0.10)"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="1200" viewBox="0 0 960 1200">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${h}, 52%, 44%)"/>
      <stop offset="55%" stop-color="hsl(${h2}, 58%, 26%)"/>
      <stop offset="100%" stop-color="hsl(${(h + 200) % 360}, 40%, 12%)"/>
    </linearGradient>
    <radialGradient id="glow" cx="72%" cy="18%" r="70%">
      <stop offset="0%" stop-color="rgba(255,255,255,0.42)"/>
      <stop offset="100%" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
  </defs>
  <rect width="960" height="1200" fill="url(#g)"/>
  <rect width="960" height="1200" fill="url(#glow)"/>
  <path d="M0 880 L960 620 L960 1200 L0 1200 Z" fill="rgba(8,8,10,0.34)"/>
  <circle cx="${180 + (h % 240)}" cy="300" r="150" fill="rgba(255,255,255,0.10)"/>
  <circle cx="${640 - (h % 160)}" cy="760" r="210" fill="rgba(255,255,255,0.07)"/>
  ${dots}
  <text x="56" y="1090" fill="rgba(255,255,255,0.30)" font-family="Arial, sans-serif" font-size="92" font-weight="900" letter-spacing="6">${label}</text>
</svg>`;
}

function articlePage(title) {
  const fixture = FIXTURES.find((item) => item.title === title) ?? FIXTURES[0];
  const paragraphs = [
    fixture.summary,
    ...(fixture.card.facts ?? []),
    fixture.card.background ?? fixture.card.kicker,
  ]
    .map((text) => `<p>${text}</p>`)
    .join('');
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>${fixture.title} | 테스트일보</title>
<meta property="og:title" content="${fixture.title}">
<meta property="og:description" content="${fixture.summary}">
<meta property="og:image" content="http://127.0.0.1:${PORT}/fake-img/article.svg">
</head><body><article><h1>${fixture.title}</h1>${paragraphs}</article></body></html>`;
}

/* ---------------------------------------------------------- fake redis */

const kv = new Map();

function handleFakeRedis(req, res, body) {
  let command = null;
  try {
    command = JSON.parse(body || '[]');
  } catch {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'bad command' }));
    return;
  }
  const [name, key, value] = command;
  if (name === 'GET') {
    res.statusCode = 200;
    res.end(JSON.stringify({ result: kv.has(key) ? kv.get(key) : null }));
    return;
  }
  if (name === 'SET') {
    kv.set(key, value);
    res.statusCode = 200;
    res.end(JSON.stringify({ result: 'OK' }));
    return;
  }
  res.statusCode = 400;
  res.end(JSON.stringify({ error: `unsupported ${name}` }));
}

/* ----------------------------------------------------------- fake AI */

let lastGeminiRequest = null;

/** 카드뉴스 5장에 필요한 추가 필드(배경·쟁점·양쪽 라벨·세 번째 팩트) — 검증용 고정 문구입니다. */
const CARD_EXTRA = {
  '점심값 1만5천원, 이제 월급에서 빠지는 고정비': {
    fact3: '조사는 직장인 1천명을 대상으로 했어요.',
    background: '점심 한 끼 가격이 오르면서 직장인들의 하루 지출 구조가 바뀌고 있어요. 같은 조사에서 외식 대신 도시락·편의점을 고르는 비율도 늘었어요.',
    point: '식당도 오를 수밖에 없다 vs 월급은 그대로인데 점심값만 오른다',
    labelA: '식당 쪽',
    labelB: '직장인 쪽',
  },
  '저녁 회식은 사라지고 점심 약속이 남았다': {
    fact3: '회식 대신 점심으로 사람을 만나는 흐름이 이어지고 있어요.',
    background: '저녁 회식이 줄고 점심 약속이 늘어난 흐름은 3년째 이어지고 있어요. 회식 대신 점심으로 사람을 만나려는 분위기가 자리 잡는 모습이에요.',
    point: '일과 저녁을 분리하려는 변화 vs 팀 문화가 끊긴다는 우려',
    labelA: 'MZ 쪽',
    labelB: '조직문화 쪽',
  },
  '도시락도 1년 새 12% 올랐다': {
    fact3: '주요 편의점 도시락 가격을 조사한 결과예요.',
    background: '원재료와 인건비 상승이 이어지면서 편의점 도시락 가격도 함께 올랐어요. 가장 싼 한 끼로 불리던 도시락이 흔들리는 상황이에요.',
    point: '원가 때문에 어쩔 수 없다 vs 싼 한 끼는 지켜야 한다',
    labelA: '유통업계',
    labelB: '소비자',
  },
  '한 달 구독료 4만2천원, 그중 두 개는 안 쓴다': {
    fact3: '조사는 20~30대 구독 이용자를 대상으로 했어요.',
    background: '구독 경제가 자리 잡으면서 2030의 고정 지출에서 구독료가 차지하는 비중이 커졌어요. 해지 버튼을 찾기 어렵다는 지적도 함께 나와요.',
    point: '필요할 때만 결제하면 합리적 vs 해지가 어려운 구조가 문제',
    labelA: '구독 이용자',
    labelB: '소비자단체',
  },
  'AI 붐인데 AI 회사 채용은 반으로 줄었다': {
    fact3: '국내 AI 스타트업 30곳을 대상으로 조사했어요.',
    background: 'AI 투자 열기는 이어지지만 개발 인력 채용은 줄어드는 흐름이 뚜렷해요. 모델 개발보다 도입·운영 쪽으로 인력이 옮겨가는 과정이라는 분석도 있어요.',
    point: 'AI 붐이면 채용도 늘어야 한다 vs 이제는 운영 인력이 필요하다',
    labelA: '업계',
    labelB: '구직자',
  },
  '웹툰 원작 드라마, 첫 방송에 동시 1위': {
    fact3: '첫 방송 직후 화제성 지표도 함께 올랐어요.',
    background: '웹툰·웹소설 원작 드라마가 편성에서 차지하는 비중이 계속 커지고 있어요. 원작 팬덤이 첫 방송부터 화제를 만드는 구도가 반복되고 있어요.',
    point: '원작 팬덤이 힘이다 vs 원작과 다른 각색은 실망',
    labelA: '원작 팬',
    labelB: '드라마 시청자',
  },
  '지원금 신청 첫날 3만명, 서버가 먼저 지쳤다': {
    fact3: '신청 기간은 이번 주까지예요.',
    background: '청년 대상 지원 사업이 본격 시작되면서 첫날부터 신청이 몰렸어요. 신청 기간이 짧아 첫날 접속이 몰리는 일이 해마다 반복되고 있어요.',
    point: '첫날 몰림은 어쩔 수 없다 vs 미리 준비했어야 한다',
    labelA: '운영기관',
    labelB: '신청자',
  },
  'AI 구독료 줄줄이 인상, 기능은 그대로': {
    fact3: '인상 폭은 서비스마다 달라요.',
    background: 'AI 서비스 운영 비용이 커지면서 이달 들어 여러 곳이 요금을 올렸어요. 사용자들은 기능 변화 없이 가격만 올랐다며 반발하고 있어요.',
    point: '운영 비용이 오르니 불가피하다 vs 무엇이 좋아졌는지 먼저 보여 줘라',
    labelA: '서비스 운영사',
    labelB: '구독자',
  },
  '주 4일제 참여 기업, 1년 만에 두 배': {
    fact3: '시범 사업 결과는 내년 상반기 공개될 예정이에요.',
    background: '주 4일제 시범 사업 결과가 쌓이면서 참여 기업이 늘고 있어요. 생산성이 유지되거나 올랐다는 응답이 이어지면서 논의가 확산되는 모습이에요.',
    point: '업종 따라 이미 통한다 vs 모든 업종에 적용하긴 무리',
    labelA: '참여 기업',
    labelB: '회의적인 쪽',
  },
};

function cardFromFixture(fixture, mode) {
  const card = fixture.card;
  const extra = CARD_EXTRA[card.hook] ?? {};
  const facts = [...card.facts];
  if (extra.fact3) facts.push(extra.fact3);
  if (facts.length < 3) {
    const candidates = fixture.summary.split(/(?<=[.!?])\s+/);
    for (const sentence of candidates) {
      if (facts.length >= 3) break;
      if (!facts.some((fact) => fact.slice(0, 12) === sentence.slice(0, 12))) facts.push(sentence);
    }
  }
  return {
    hook: card.hook,
    kicker: mode === 'demo' ? card.kicker : `${fixture.category} · 테스트 카드`,
    facts: facts.slice(0, 3),
    background: extra.background ?? fixture.summary,
    point: extra.point ?? card.sides.a,
    sides: { labelA: extra.labelA ?? '한쪽은', labelB: extra.labelB ?? '다른 쪽은', ...card.sides },
    poll: card.poll,
    temp: card.temp,
    category: fixture.category,
    tags: card.tags,
    // 실제 AI처럼 캡션용 문장도 함께 돌려줍니다(데모 모드) — 캡션 보강 경로를 그대로 검증합니다.
    caption:
      mode === 'demo'
        ? {
            lead: extra.background ?? fixture.summary,
            sideA: card.sides.a,
            sideB: card.sides.b,
            ask: '여러분은 어느 쪽이 더 문제라고 보세요? 댓글로 알려 주세요.',
          }
        : undefined,
  };
}

function parseCandidates(prompt) {
  const blocks = [];
  const lines = prompt.split('\n');
  let current = null;
  for (const line of lines) {
    const head = line.match(/^\[(\d+)\]\s+(.+)$/);
    if (head) {
      current = { pick: Number(head[1]), title: head[2].trim(), body: '' };
      blocks.push(current);
      continue;
    }
    if (current && line.startsWith('- 내용: ')) current.body = line.slice(6);
  }
  return blocks;
}

function buildTrendingResult(prompt, mode) {
  const candidates = parseCandidates(prompt);
  const issues = [];
  // 실제 AI처럼 장르를 골고루 — 같은 카테고리는 한 장씩만.
  const seen = new Set();
  const picked = [];
  for (const candidate of candidates) {
    const fixture = FIXTURES.find((item) => item.title === candidate.title);
    const category = fixture?.category ?? candidate.category ?? 'society';
    if (seen.has(category)) continue;
    seen.add(category);
    picked.push(candidate);
    if (picked.length >= 6) break;
  }
  const fallback = candidates.filter((c) => !picked.includes(c)).slice(0, 6 - picked.length);
  for (const candidate of [...picked, ...fallback]) {
    const fixture = FIXTURES.find((item) => item.title === candidate.title);
    if (fixture) {
      issues.push({ pick: candidate.pick, ...cardFromFixture(fixture, mode) });
      continue;
    }
    // 픽스처에 없는 실제 기사 → 제목·요약만으로 최소 카드
    const body = candidate.body.replace(/\s+/g, ' ').trim();
    const firstSentence = body.split(/(?<=[.!?])\s/)[0] || candidate.title;
    const secondSentence = body.split(/(?<=[.!?])\s/)[1] ?? candidate.title.slice(0, 70);
    issues.push({
      pick: candidate.pick,
      category: 'society',
      hook: candidate.title.slice(0, 38),
      kicker: firstSentence.slice(0, 44),
      facts: [firstSentence.slice(0, 70), secondSentence.slice(0, 70), candidate.title.slice(0, 70)],
      background: `${firstSentence.slice(0, 80)} ${secondSentence.slice(0, 80)}`,
      point: '이 뉴스, 내 일상에 영향 있나요?',
      sides: { labelA: '이해된다', labelB: '아니다', a: '이해된다는 쪽', b: '아니다 싶은 쪽' },
      poll: { question: '이 이슈, 지금 남 일인가?', a: '내 일이다, 지금 따진다', b: '일단 지켜본다' },
      temp: 55,
      tags: [],
    });
  }
  return { issues };
}

function buildBriefingResult(prompt, mode) {
  const titleLine = prompt.split('\n').find((line) => line.startsWith('[기사 제목] '));
  const title = titleLine ? titleLine.replace('[기사 제목] ', '').trim() : '';
  const fixture = FIXTURES.find((item) => item.title === title);
  if (fixture) return cardFromFixture(fixture, mode);
  return {
    category: 'society',
    hook: (title || '기사 제목 없음').slice(0, 38),
    kicker: '본문에서 확인한 내용',
    facts: ['본문 첫 문장을 그대로 옮겼어요.', '두 번째 문장도 원문 기준이에요.', '세 번째 문장까지 원문에서 확인했어요.'],
    background: '본문에서 확인한 배경을 두 문장으로 정리했어요.',
    point: '이 이슈, 어디까지 받아들일 수 있을까요?',
    sides: { labelA: '이해된다', labelB: '아니다', a: '이해된다는 쪽', b: '아니다 싶은 쪽' },
    poll: { question: '이 이슈, 어디까지 봐주나?', a: '더는 안 된다', b: '아직은 봐준다' },
    temp: 58,
    tags: [],
  };
}

function handleFakeGemini(req, res, body) {
  const model = req.url.split('/models/')[1]?.split(':')[0] ?? '';
  let parsed = null;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    parsed = null;
  }
  const prompt = parsed?.contents?.[0]?.parts?.[0]?.text ?? '';
  lastGeminiRequest = {
    model,
    headerKey: req.headers['x-goog-api-key'] ?? '',
    queryKey: (req.url.split('?key=')[1] ?? '').split('&')[0],
    prompt: prompt.slice(0, 6000),
    promptChars: prompt.length,
  };

  res.setHeader('Content-Type', 'application/json');
  if (!/^gemini-3/.test(model)) {
    res.statusCode = 404;
    res.end(
      JSON.stringify({
        error: { code: 404, message: `models/${model} is not found`, status: 'NOT_FOUND' },
      }),
    );
    return;
  }

  const mode = AI === 'demo' ? 'demo' : 'plain';
  const result = prompt.includes('[후보 기사]') || /^\[\d+\]\s/m.test(prompt)
    ? buildTrendingResult(prompt, mode)
    : buildBriefingResult(prompt, mode);

  res.statusCode = 200;
  res.end(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: 'JSON을 만든다.', thought: true }, { text: JSON.stringify(result) }],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 420, totalTokenCount: 1320 },
      modelVersion: model,
    }),
  );
}

/* ---------------------------------------------------------- API wiring */

const handlers = { trending: null, briefing: null, poll: null, img: null };

async function loadHandlers() {
  await mkdir(TMP, { recursive: true });
  await build({
    entryPoints: [
      join(ROOT, 'api/trending.ts'),
      join(ROOT, 'api/briefing.ts'),
      join(ROOT, 'api/poll.ts'),
      join(ROOT, 'api/img.ts'),
    ],
    outdir: TMP,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
  });
  const stamp = `?v=${Date.now()}`;
  handlers.trending = (await import(pathToFileURL(join(TMP, 'trending.js')).href + stamp)).default;
  handlers.briefing = (await import(pathToFileURL(join(TMP, 'briefing.js')).href + stamp)).default;
  handlers.poll = (await import(pathToFileURL(join(TMP, 'poll.js')).href + stamp)).default;
  handlers.img = (await import(pathToFileURL(join(TMP, 'img.js')).href + stamp)).default;
}

function createResponse(nodeRes) {
  return {
    status(code) {
      nodeRes.statusCode = code;
      return this;
    },
    json(payload) {
      nodeRes.setHeader('Content-Type', 'application/json; charset=utf-8');
      nodeRes.end(JSON.stringify(payload));
    },
    setHeader(name, value) {
      nodeRes.setHeader(name, value);
    },
    end(chunk) {
      nodeRes.end(chunk);
    },
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function serveStatic(req, res, pathname) {
  const safe = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const target = join(DIST, safe === '/' ? 'index.html' : safe);
  try {
    const info = await stat(target);
    if (info.isFile()) {
      const data = await readFile(target);
      res.statusCode = 200;
      res.setHeader('Content-Type', MIME[extname(target)] ?? 'application/octet-stream');
      res.end(data);
      return;
    }
  } catch {
    /* 아래 SPA 폴백 */
  }
  const html = await readFile(join(DIST, 'index.html'));
  res.statusCode = 200;
  res.setHeader('Content-Type', MIME['.html']);
  res.end(html);
}

function start() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
    const pathname = url.pathname;

    if (pathname.startsWith('/fake-redis')) {
      handleFakeRedis(req, res, await readBody(req));
      return;
    }
    if (pathname.startsWith('/fake-gemini')) {
      handleFakeGemini(req, res, await readBody(req));
      return;
    }
    if (FEEDS === 'on' && pathname.startsWith('/fake-rss/')) {
      const slug = pathname.replace('/fake-rss/', '').replace(/\.xml$/, '');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/rss+xml; charset=utf-8');
      res.end(rssFor(slug));
      return;
    }
    if (FEEDS === 'on' && pathname.startsWith('/fake-img/')) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end(svgImage(pathname));
      return;
    }
    if (FEEDS === 'on' && pathname.startsWith('/fake-article/')) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(articlePage(decodeURIComponent(pathname.replace('/fake-article/', ''))));
      return;
    }
    if (pathname === '/__state') {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          api: API_ON,
          store: STORE,
          ai: AI,
          feeds: FEEDS,
          redis: Object.fromEntries(kv),
          gemini: lastGeminiRequest,
        }),
      );
      return;
    }

    if (pathname.startsWith('/api/')) {
      if (!API_ON) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<!doctype html><title>404</title><h1>Not Found</h1>');
        return;
      }
      const name = pathname.replace('/api/', '');
      const handler = Object.prototype.hasOwnProperty.call(handlers, name) ? handlers[name] : null;
      if (!handler) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: 'not_found' }));
        return;
      }
      const raw = await readBody(req);
      let body;
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
      }
      const vreq = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        query: Object.fromEntries(url.searchParams.entries()),
        body,
      };
      try {
        await handler(vreq, createResponse(res));
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: 'handler_crash', message: String(error) }));
      }
      return;
    }

    await serveStatic(req, res, pathname);
  });

  server.listen(PORT, '127.0.0.1', async () => {
    console.log(
      `issue-thermometer dev server → http://127.0.0.1:${PORT}/ (api=${API_ON ? 'on' : 'off'}, store=${STORE}, ai=${AI}, feeds=${FEEDS})`,
    );
  });

  return server;
}

// 가짜 백엔드 주소는 핸들러를 불러오기 전에 환경변수로 심습니다.
if (API_ON) {
  if (FEEDS === 'on') process.env.ISSUE_FEED_BASE = `http://127.0.0.1:${PORT}/fake-rss`;
  else if (FEEDS === 'real') delete process.env.ISSUE_FEED_BASE;
  else process.env.ISSUE_FEED_BASE = `http://127.0.0.1:${PORT + 500}/fake-rss`;
  if (ALLOW_LOCAL) process.env.ISSUE_ALLOW_LOCAL_FETCH = '1';
  else delete process.env.ISSUE_ALLOW_LOCAL_FETCH;

  if (STORE === 'redis') {
    process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${PORT}/fake-redis`;
    process.env.UPSTASH_REDIS_REST_TOKEN = 'local-test-token';
  } else {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  }
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_ANON_KEY;

  if (AI === 'gemini' || AI === 'demo') {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.GEMINI_MODEL;
    process.env.GEMINI_API_KEY = 'AQ.local-test-key';
    process.env.GEMINI_BASE_URL = `http://127.0.0.1:${PORT}/fake-gemini/v1beta`;
  } else {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  }

  await loadHandlers();
}

start();
