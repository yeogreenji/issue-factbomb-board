/**
 * 이슈온도계 — 기사 사진 프록시.
 *
 * GET /api/img?u=<원본 이미지 주소>
 *
 * 카드뉴스 표지는 기사 사진을 캔버스에 직접 그립니다. 언론사 이미지 서버가 CORS 헤더를 주지 않으면
 * 캔버스가 오염(tainted)돼 PNG 저장이 막히기 때문에, 같은 출처에서 사진을 받아 오는 얇은 통로를 둡니다.
 *
 * 안전장치
 * - http(s)만, 사설망·메타데이터 호스트는 차단(공용 safeUrl)
 * - 언론사 19곳이 실제로 쓰는 이미지 도메인만 허용(공개 프록시 악용 방지)
 * - image/* 형식만, 4MB·8초 상한
 */

import {
  ENV,
  safeUrl,
  clean,
  queryValue,
  type VercelRequest,
  type VercelResponse,
} from "./_shared.js";

export const config = { maxDuration: 20 };

const MAX_BYTES = 4_000_000;
const TIMEOUT_MS = 8_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * api/trending.ts 가 수집하는 언론사와, 그 기사 사진이 실제로 올라가 있는 국내 CDN.
 * 여기에 없는 호스트는 열어 주지 않습니다 — 남의 사이트를 대신 긁어 주는 프록시가 되지 않도록.
 * (사진은 카드 캔버스에 그려야 해서, 언론사가 CORS 헤더를 주지 않으면 이 통로가 유일합니다.)
 */
const ALLOWED_SUFFIX = [
  "yna.co.kr",
  "donga.com",
  "chosun.com",
  "khan.co.kr",
  "ohmynews.com",
  "sbs.co.kr",
  "bloter.net",
  "etnews.com",
  "mk.co.kr",
  "nocutnews.co.kr",
  "mt.co.kr",
  "hani.co.kr",
  "newsis.com",
  "topstarnews.net",
  "joongang.co.kr",
  "hankyung.com",
  "news1.kr",
  "spotvnews.co.kr",
  "xportsnews.com",
  // 포털·방송사·연예 매체 CDN — 피드가 이 주소로 사진을 넘겨 줍니다.
  "pstatic.net",
  "daumcdn.net",
  "nateimg.co.kr",
  "kbs.co.kr",
  "imbc.com",
  "seoul.co.kr",
  "heraldcorp.com",
  "hankookilbo.com",
  "kmib.co.kr",
  "segye.com",
  "munhwa.com",
  "dt.co.kr",
  "edaily.co.kr",
  "ajunews.com",
  "asiae.co.kr",
  "osen.co.kr",
  "sportsseoul.com",
  "mydaily.co.kr",
  "newsen.com",
  "tvreport.co.kr",
  "sportsworldi.com",
  "ilyo.co.kr",
  "mediatoday.co.kr",
  "sportalkorea.com",
];

/** 검증 하네스(127.0.0.1 가짜 언론사)에서만 켜집니다. */
const ALLOW_LOCAL = ENV.ISSUE_ALLOW_LOCAL_FETCH === "1";

function hostAllowed(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (ALLOW_LOCAL && (host === "127.0.0.1" || host === "localhost")) return true;
  return ALLOWED_SUFFIX.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function fail(res: VercelResponse, status: number, message: string): void {
  res.status(status).json({ ok: false, error: "image_unavailable", message });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, error: "method_not_allowed", message: "GET만 지원합니다." });
    return;
  }

  const raw = clean(queryValue(req, "u"), 900).replace(/&amp;/g, "&");
  const url = raw ? safeUrl(raw) : null;
  if (!url || !hostAllowed(url)) {
    fail(res, 400, "이 주소의 사진은 가져올 수 없습니다.");
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        Referer: `${url.protocol}//${url.host}/`,
      },
    });
    if (!upstream.ok) {
      fail(res, 502, `사진 서버가 ${upstream.status} 응답을 보냈습니다.`);
      return;
    }
    // 사진 서버가 다른 곳으로 넘겼다면 그 주소도 공개 주소여야 합니다(사설망 SSRF 차단).
    if (upstream.url && !safeUrl(upstream.url)) {
      fail(res, 400, "사진 주소가 허용되지 않는 곳으로 넘어갔습니다.");
      return;
    }
    const type = (upstream.headers.get("content-type") || "").toLowerCase();
    if (!type.startsWith("image/")) {
      fail(res, 415, "사진이 아닌 응답입니다.");
      return;
    }
    const declared = Number(upstream.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) {
      fail(res, 413, "사진 용량이 너무 큽니다.");
      return;
    }
    const buffer = new Uint8Array(await upstream.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) {
      fail(res, 413, "사진 용량이 너무 큽니다.");
      return;
    }

    res.setHeader("Content-Type", type.split(";")[0]);
    res.setHeader("Content-Length", String(buffer.byteLength));
    // 사진은 자주 바뀌지 않습니다 — 브라우저·CDN이 하루 동안 재사용합니다.
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    (res as unknown as { end(chunk: Uint8Array): void }).end(buffer);
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    fail(res, aborted ? 504 : 502, aborted ? "사진 응답이 제한 시간을 넘겼습니다." : "사진 서버에 연결하지 못했습니다.");
  } finally {
    clearTimeout(timer);
  }
}
