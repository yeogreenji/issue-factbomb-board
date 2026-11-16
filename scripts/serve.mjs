#!/usr/bin/env node
/**
 * Vercel 없이 실제 서버리스 함수(api/board.ts · api/briefing.ts)를 그대로 실행하는 로컬 서버.
 *
 *   node scripts/serve.mjs --port 4185 --api=on --store=redis --ai=on
 *
 *   --api=off    /api/* 를 404로 돌려 GitHub Pages(정적 호스팅)를 흉내냅니다.
 *   --store=redis  가짜 Upstash REST 엔드포인트를 띄워 공용 DB 경로를 그대로 검증합니다.
 *   --store=memory 공용 DB 환경변수 없이 임시 저장소(체험 모드)로 동작합니다.
 *   --ai=on      가짜 OpenAI 엔드포인트를 띄워 실시간 AI 경로를 검증합니다(실제 키 불필요).
 *   --ai=gemini  가짜 Gemini 엔드포인트를 띄워 무료 Google 키(AQ.…) 경로를 검증합니다.
 *   --ai=off     AI 키 없이 501 no_key → 규칙 요약 폴백을 검증합니다.
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

/* --------------------------------------------------------- fake backends */

const kv = new Map();

/** Upstash REST 흉내: POST / → ["GET", key] | ["SET", key, value] */
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

const FAKE_AI_RESULT = {
  headline: '수수료 1.8%로 올린 결제사, “투자”라는데 계획은 비공개',
  oneLiner: '무료로 키운 이용자를 가맹점 계산대에서 청구하는 구조',
  kicker: '가맹점 수수료 1.2% → 1.8% 인상',
  summary: [
    '결제 플랫폼이 개인 간 송금은 무료로 두고 가맹점 결제 수수료를 1.2%에서 1.8%로 올렸다.',
    '소상공인 커뮤니티는 무료 송금으로 모은 이용자를 가맹점에 청구하는 구조라고 반발했다.',
    '회사는 결제망 고도화 투자라고만 밝혔고 구체적인 투자 계획은 공개하지 않았다.',
  ],
  insider: [
    '수수료 인상은 숫자 문제가 아니라 순서 문제다. 투자 계획을 먼저 공개했으면 같은 인상도 납득됐을 것이다.',
    '가맹점은 이미 대체 결제사를 계산대에 붙여 두고 있다. 이번 인상은 이탈 속도를 앞당기는 카드다.',
  ],
  debate: {
    pro: ['결제망 고도화 비용을 이용자에게 나눠 부담하는 구조는 업계 관행이다.', '개인 송금 무료를 유지하는 것도 비용이 드는 결정이다.'],
    con: ['무료로 키운 이용자를 가맹점에 청구하는 구조는 신뢰를 깎는다.', '투자 계획을 공개하지 않은 인상은 협상이 아니라 통보다.'],
  },
  category: 'tech',
  baseTemp: 68,
  tags: ['수수료', '결제', '소상공인'],
};

function handleFakeOpenAI(req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(
    JSON.stringify({
      id: 'chatcmpl-fake',
      object: 'chat.completion',
      model: 'gpt-4o-mini',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(FAKE_AI_RESULT) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 640, completion_tokens: 380, total_tokens: 1020 },
    }),
  );
}

/** 가짜 Gemini — 실제 API처럼 thought 파트 + JSON 텍스트 파트를 함께 돌려줍니다. */
let lastGeminiRequest = null;

function handleFakeGemini(req, res, body) {
  const model = req.url.split('/models/')[1]?.split(':')[0] ?? '';
  const raw = body || '';
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    /* 원문 유지 */
  }
  lastGeminiRequest = {
    model,
    headerKey: req.headers['x-goog-api-key'] ?? '',
    queryKey: (req.url.split('?key=')[1] ?? '').split('&')[0],
    body: parsed,
  };

  res.setHeader('Content-Type', 'application/json');
  if (model !== 'gemini-3.8-flash') {
    // 실제 2026-11 동작: 신규 사용자에게 구 모델은 404 no longer available
    res.statusCode = 404;
    res.end(
      JSON.stringify({
        error: {
          code: 404,
          message: `models/${model} is no longer available to new users. Please update your code to use a newer model.`,
          status: 'NOT_FOUND',
        },
      }),
    );
    return;
  }

  res.statusCode = 200;
  res.end(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              { text: 'JSON 객체를 만들어야 한다.', thought: true },
              { text: JSON.stringify(FAKE_AI_RESULT) },
            ],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: { promptTokenCount: 640, candidatesTokenCount: 380, totalTokenCount: 1020 },
      modelVersion: model,
    }),
  );
}

/* ------------------------------------------------------------- API wiring */

let handlers = { board: null, briefing: null };

async function loadHandlers() {
  await mkdir(TMP, { recursive: true });
  await build({
    entryPoints: [join(ROOT, 'api/board.ts'), join(ROOT, 'api/briefing.ts')],
    outdir: TMP,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    logLevel: 'silent',
  });
  const stamp = `?v=${Date.now()}`;
  handlers.board = (await import(pathToFileURL(join(TMP, 'board.js')).href + stamp)).default;
  handlers.briefing = (await import(pathToFileURL(join(TMP, 'briefing.js')).href + stamp)).default;
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;

  if (pathname.startsWith('/fake-redis')) {
    handleFakeRedis(req, res, await readBody(req));
    return;
  }
  if (pathname.startsWith('/fake-openai')) {
    handleFakeOpenAI(req, res);
    return;
  }
  if (pathname.startsWith('/fake-gemini')) {
    handleFakeGemini(req, res, await readBody(req));
    return;
  }
  if (pathname === '/__state') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ redis: Object.fromEntries(kv), api: API_ON, store: STORE, ai: AI, geminiRequest: lastGeminiRequest }));
    return;
  }

  if (pathname.startsWith('/api/')) {
    if (!API_ON) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><title>404</title><h1>Not Found</h1>');
      return;
    }
    const handler = pathname === '/api/board' ? handlers.board : pathname === '/api/briefing' ? handlers.briefing : null;
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

// 가짜 백엔드 주소는 핸들러를 불러오기 전에 환경변수로 심습니다(PRISM의 /api/analyze와 같은 방식).
if (API_ON) {
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

  if (AI === 'gemini') {
    // 무료 Google Gemini 키(AQ.…) 경로 — 실제 엔드포인트 대신 가짜 서버로 보냅니다.
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.GEMINI_MODEL;
    process.env.GEMINI_API_KEY = 'AQ.local-test-key';
    process.env.GEMINI_BASE_URL = `http://127.0.0.1:${PORT}/fake-gemini/v1beta`;
  } else if (AI === 'on') {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_BASE_URL;
    process.env.OPENAI_API_KEY = 'local-test-key';
    process.env.OPENAI_BASE_URL = `http://127.0.0.1:${PORT}/fake-openai/v1`;
  } else {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
  }

  await loadHandlers();
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`factbomb dev server → http://127.0.0.1:${PORT}/ (api=${API_ON ? 'on' : 'off'}, store=${STORE}, ai=${AI})`);
});
