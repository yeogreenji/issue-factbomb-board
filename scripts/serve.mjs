#!/usr/bin/env node
/**
 * Vercel 없이 실제 서버리스 함수(api/trending.ts · api/briefing.ts · api/poll.ts)를 그대로 실행하는 로컬 서버.
 *
 *   node scripts/serve.mjs --port 4185 --api=on --store=redis --ai=gemini --feeds=on
 *
 *   --api=off     /api/* 를 404로 돌려 GitHub Pages(정적 호스팅)를 흉내냅니다.
 *   --store=redis 가짜 Upstash REST 엔드포인트를 띄워 공용 집계 경로를 그대로 검증합니다.
 *   --feeds=on    가짜 언론사 RSS 7곳을 띄웁니다(실제 언론사에 요청하지 않음). off 면 연결 실패 상황.
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
      ],
      sides: {
        a: '물가가 오른 만큼 식당도 어쩔 수 없다는 쪽',
        b: '월급은 그대로인데 점심값만 오르는 건 이해하기 어렵다는 쪽',
      },
      poll: { question: '점심값 1만5천원, 받아들일 만한가요?', a: '이 정도면 이해한다', b: '아직은 너무 비싸다' },
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
      ],
      sides: {
        a: '일과 저녁을 분리하려는 자연스러운 변화라는 쪽',
        b: '팀 문화가 끊긴다는 우려도 함께 나오는 쪽',
      },
      poll: { question: '저녁 회식, 있어야 한다 vs 없어도 된다', a: '없어도 된다', b: '가끔은 필요하다' },
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
      ],
      sides: {
        a: '원재료·인건비가 올라 가격을 올릴 수밖에 없다는 쪽',
        b: '가장 싼 한 끼가 사라지는 건 다르게 봐야 한다는 쪽',
      },
      poll: { question: '도시락 12% 인상, 이해되나요?', a: '원가 때문에 어쩔 수 없다', b: '싼 한 끼는 지켜야 한다' },
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
      ],
      sides: {
        a: '필요할 때만 결제하는 방식이 합리적이라는 쪽',
        b: '해지 버튼이 숨어 있는 구조가 문제라는 쪽',
      },
      poll: { question: '안 쓰는 구독, 바로 해지하시나요?', a: '그때그때 정리한다', b: '귀찮아서 그냥 둔다' },
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
      ],
      sides: {
        a: '모델 개발은 줄고 도입·운영 인력으로 옮겨가는 과정이라는 쪽',
        b: 'AI boom과 채용 감소가 같이 가는 건 이상하다는 쪽',
      },
      poll: { question: 'AI 시대, 개발자 채용은 늘까요?', a: '늘어날 것', b: '당분간 줄 것' },
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
      facts: ['웹툰 원작 드라마가 첫 방송에서 동시간대 시청률 1위를 기록했어요.', '원작 독자와 신규 시청자가 함께 본 결과로 풀이돼요.'],
      sides: {
        a: '원작 팬덤이 이미 검증된 이야기를 밀어준다는 쪽',
        b: '원작과 다른 각색에 대한 불만도 함께 나온다는 쪽',
      },
      poll: { question: '웹툰 원작 드라마, 원작대로 vs 새로 각색', a: '원작 그대로', b: '새로 각색해도 좋다' },
      temp: 48,
      tags: ['드라마', '웹툰', '시청률'],
    },
  },
  {
    slug: 'yna-politics',
    title: '청년 지원금 신청 첫날 3만명 몰려…"서버 지연"',
    summary: '청년 대상 지원금 신청이 시작된 첫날 3만명이 몰리며 접속 지연이 이어졌다. 담당 기관은 서버를 늘려 오후부터 정상화했다고 밝혔다.',
    category: 'mz',
    card: {
      hook: '지원금 신청 첫날 3만명, 서버가 먼저 지쳤다',
      kicker: '오후부터 정상화',
      facts: ['지원금 신청 첫날 3만명이 몰려 접속이 지연됐어요.', '담당 기관은 서버를 늘려 오후부터 정상화했다고 밝혔어요.'],
      sides: {
        a: '첫날 몰림은 예상 가능한 일, 빠른 복구로 충분하다는 쪽',
        b: '신청 기간이 짧은데 첫날부터 막히면 곤란하다는 쪽',
      },
      poll: { question: '공공 신청 서비스, 첫날 몰림은 불가피한가요?', a: '어쩔 수 없는 일', b: '미리 준비했어야 한다' },
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
      facts: ['구독형 AI 서비스 여러 곳이 이달 들어 요금을 올렸어요.', '사용자들은 기능 변화 없이 가격만 올랐다고 반발하고 있어요.'],
      sides: {
        a: '모델 운영 비용이 계속 오르니 가격 인상은 불가피하다는 쪽',
        b: '가격을 올리려면 무엇이 좋아졌는지 먼저 보여 줘야 한다는 쪽',
      },
      poll: { question: 'AI 구독료 인상, 계속 쓸 건가요?', a: '그래도 쓴다', b: '이번엔 해지한다' },
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
      facts: ['주 4일제 시범 사업 참여 기업이 지난해보다 두 배로 늘었어요.', '참여 기업들은 생산성이 유지되거나 오히려 올랐다고 답했어요.'],
      sides: {
        a: '업종에 따라 이미 통하는 방식이라는 쪽',
        b: '모든 업종에 적용하기엔 무리라는 쪽',
      },
      poll: { question: '주 4일제, 우리 회사에도 가능할까요?', a: '가능하다', b: '현실적으로 어렵다' },
      temp: 63,
      tags: ['주4일제', '근로시간', '생산성'],
    },
  },
];

function rssFor(slug) {
  const items = FIXTURES.filter((fixture) => fixture.slug === slug);
  const now = Date.now();
  const body = items
    .map((fixture, index) => {
      const date = new Date(now - (index + 1) * 42 * 60 * 1000).toUTCString();
      const link = `http://127.0.0.1:${PORT}/fake-article/${encodeURIComponent(fixture.title)}`;
      const image = `http://127.0.0.1:${PORT}/fake-img/${slug}-${index}.svg`;
      return `<item><title><![CDATA[${fixture.title}]]></title><link>${link}</link><pubDate>${date}</pubDate><description><![CDATA[${fixture.summary}]]></description><media:content url="${image}" type="image/svg+xml" /></item>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>테스트 뉴스 ${slug}</title><language>ko</language>${body}</channel></rss>`;
}

function svgImage(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="hsl(${h}, 46%, 42%)"/><stop offset="100%" stop-color="hsl(${(h + 48) % 360}, 52%, 22%)"/>
  </linearGradient></defs>
  <rect width="640" height="420" fill="url(#g)"/>
  <circle cx="${120 + (h % 200)}" cy="130" r="90" fill="rgba(255,255,255,0.10)"/>
  <circle cx="${420 - (h % 140)}" cy="300" r="130" fill="rgba(255,255,255,0.07)"/>
</svg>`;
}

function articlePage(title) {
  const fixture = FIXTURES.find((item) => item.title === title) ?? FIXTURES[0];
  const paragraphs = [
    fixture.summary,
    `${fixture.card.kicker}. 이번 조사는 관련 업계와 이용자 의견을 함께 담았다.`,
    fixture.card.facts[0],
    fixture.card.facts[1],
    fixture.card.sides.a,
    fixture.card.sides.b,
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

function cardFromFixture(fixture, mode) {
  const card = fixture.card;
  return {
    hook: card.hook,
    kicker: mode === 'demo' ? card.kicker : `${fixture.category} · 테스트 카드`,
    facts: card.facts,
    sides: card.sides,
    poll: card.poll,
    temp: card.temp,
    category: fixture.category,
    tags: card.tags,
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
  for (const candidate of candidates.slice(0, 4)) {
    const fixture = FIXTURES.find((item) => item.title === candidate.title);
    if (fixture) {
      issues.push({ pick: candidate.pick, ...cardFromFixture(fixture, mode) });
      continue;
    }
    // 픽스처에 없는 실제 기사 → 제목·요약만으로 최소 카드
    const body = candidate.body.replace(/\s+/g, ' ').trim();
    const firstSentence = body.split(/(?<=[.!?])\s/)[0] || candidate.title;
    issues.push({
      pick: candidate.pick,
      category: 'mz',
      hook: candidate.title.slice(0, 38),
      kicker: firstSentence.slice(0, 44),
      facts: [firstSentence.slice(0, 70), body.split(/(?<=[.!?])\s/)[1]?.slice(0, 70) ?? candidate.title.slice(0, 70)],
      sides: { a: '이해된다는 쪽', b: '아니다 싶은 쪽' },
      poll: { question: '이 뉴스, 내 일상에 영향 있나요?', a: '이미 체감 중', b: '아직 남 일' },
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
    category: 'mz',
    hook: (title || '기사 제목 없음').slice(0, 38),
    kicker: '본문에서 확인한 내용',
    facts: ['본문 첫 문장을 그대로 옮겼어요.', '두 번째 문장도 원문 기준이에요.'],
    sides: { a: '이해된다는 쪽', b: '아니다 싶은 쪽' },
    poll: { question: '이 이슈, 어떻게 봐요?', a: '이해된다', b: '아니다' },
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

const handlers = { trending: null, briefing: null, poll: null };

async function loadHandlers() {
  await mkdir(TMP, { recursive: true });
  await build({
    entryPoints: [join(ROOT, 'api/trending.ts'), join(ROOT, 'api/briefing.ts'), join(ROOT, 'api/poll.ts')],
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
