#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""이슈온도계 v5 검증 — 실제 뉴스 수집 → 이슈별 A/B → 인스타 카드뉴스 5장(PNG/ZIP/캡션) → 투표·토론을 실제 브라우저로 확인합니다.

시나리오
  A. 모바일 390 — 피드(카드마다 다른 A/B 노출) → 카드뉴스 5장 → PNG/ZIP 저장 → 캡션 복사 → 투표·토론 댓글·공감
  B. 두 번째 브라우저 — 같은 공용 저장소에서 투표·댓글이 함께 쌓이는지
  C. 뉴스로 만들기 — 기사 링크를 넣으면 본문을 읽어 카드가 생기는지(+ 한 줄 입력, 링크 거부)
  D. AI 키 없음 — 실제 헤드라인만으로 카드 5장이 뜨고 "AI 없이" 표시가 정직한지,
     AI가 없어도 카드마다 A/B 문항이 다른지
  E. 정적 배포 — 서버가 없을 때 안내가 뜨고 /api 요청을 보내지 않는지
  F. 데스크톱 1280 — 2단(카드 | 토론) 레이아웃·가로 넘침
  G. 크리에이터 작업대 — 검색·카테고리·저장함·발행 체크·캡션 해시태그 12~15개·
     문구 편집(카드·PNG에 반영)·테마 4종·워터마크·원문 되돌리기

실행: npm run verify   (필요하면 스크립트가 직접 빌드합니다)
"""
import hashlib
import io
import json
import os
import re
import signal
import socket
import struct
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "docs" / "screenshots"
NODE_BIN = "/workspace/.tools/node-v22.12.0-linux-x64/bin"
LIBS = "/workspace/.libs/usr/lib/x86_64-linux-gnu"

ENV = os.environ.copy()
if Path(NODE_BIN).exists():
    ENV["PATH"] = f"{NODE_BIN}:{ENV.get('PATH', '')}"
if Path(LIBS).exists():
    ENV["LD_LIBRARY_PATH"] = f"{LIBS}:{ENV.get('LD_LIBRARY_PATH', '')}"
os.environ["LD_LIBRARY_PATH"] = ENV.get("LD_LIBRARY_PATH", "")

checks: list[tuple[str, bool, str]] = []
console_errors: list[tuple[str, str]] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    checks.append((name, bool(passed), detail))
    print(("PASS " if passed else "FAIL ") + name + (f" — {detail}" if detail and not passed else ""))


def attach(page, tag: str):
    def on_console(msg):
        if msg.type in ("error", "warning"):
            console_errors.append((tag, f"[{msg.type}] {msg.text}"))

    def on_pageerror(error):
        console_errors.append((tag, f"[pageerror] {error}"))

    page.on("console", on_console)
    page.on("pageerror", on_pageerror)
    return page


def settle(page, ms: int = 250) -> None:
    page.wait_for_timeout(ms)


def seed_plan(ctx, plan: str = "pro") -> None:
    """브라우저를 열기 전에 요금제를 심습니다 — Pro 기능(5장 ZIP·@핸들·4테마·캡션)을 쓰는 흐름."""
    ctx.add_init_script(
        script=(
            "try { localStorage.setItem('issue-thermo.plan.v1', JSON.stringify({"
            f"plan: '{plan}', trial: {'true' if plan != 'free' else 'false'}, billing: 'monthly'"
            "})); } catch (e) {}"
        )
    )


def free_port(port: int) -> None:
    out = subprocess.run(["ss", "-lptnH", f"sport = :{port}"], capture_output=True, text=True).stdout
    for pid in set(re.findall(r"pid=(\d+)", out)):
        try:
            os.kill(int(pid), signal.SIGKILL)
        except OSError:
            pass
    if out.strip():
        time.sleep(0.6)


def wait_port(port: int, timeout: float = 40.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket() as sock:
            sock.settimeout(0.4)
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.25)
    raise RuntimeError(f"서버가 {port} 포트에서 뜨지 않았습니다")


def start_server(
    port: int,
    *,
    dist: str = "dist",
    api: str = "on",
    store: str = "memory",
    ai: str = "off",
    feeds: str = "on",
    allow_local: str = "on",
):
    free_port(port)
    log_path = ROOT / ".tmp" / f"serve-{port}.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log = open(log_path, "w")
    proc = subprocess.Popen(
        [
            "node",
            "scripts/serve.mjs",
            f"--port={port}",
            f"--dist={dist}",
            f"--api={api}",
            f"--store={store}",
            f"--ai={ai}",
            f"--feeds={feeds}",
            f"--allow-local={allow_local}",
        ],
        cwd=ROOT,
        env=ENV,
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    wait_port(port)
    return proc, log


def stop_server(proc) -> None:
    try:
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=8)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def api_json(port: int, path: str, payload: dict | None = None) -> tuple[int, dict]:
    import urllib.error
    import urllib.request

    url = f"http://127.0.0.1:{port}{path}"
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
    try:
        with urllib.request.urlopen(request, timeout=90) as response:
            return response.status, json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        try:
            return error.code, json.loads(error.read().decode())
        except Exception:
            return error.code, {}


def no_overflow(page) -> bool:
    return page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")


def open_viewer(page):
    page.locator('[data-testid="hero-card"] button').click()
    page.wait_for_selector('[data-testid="viewer"]', timeout=8000)
    settle(page, 450)


def goto_slide(page, n: int) -> None:
    for _ in range(n):
        page.locator('[data-testid="next"]').click()
        settle(page, 450)


def go_next(page) -> None:
    current = page.locator(".cn-count").inner_text().strip()
    page.locator('[data-testid="next"]').click()
    settle(page, 480)
    after = page.locator(".cn-count").inner_text().strip()
    check(f"A: 카드 넘김 {current} → {after}", current != after, f"{current} -> {after}")


def png_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    return struct.unpack(">II", data[16:24])


# 밋밋한 고정 문구 — 이게 보이면 실패로 봅니다(예전 버전이 쓰던 문장들)
BLAND_POLL = re.compile(
    r"(이 뉴스, 내 일상에|이 이슈, 어떻게 봐요|어떻게 보시나요|어떻게 생각하|찬성하시나요|반대하시나요|"
    r"이미 체감 중|아직 남 일|받아들일 만한가|영향 있나요)"
)


def poll_problems(issues: list[dict]) -> list[str]:
    """카드별 A/B가 서로 다르고, 그 기사에 붙은 문장인지 확인합니다."""
    problems: list[str] = []
    questions = [issue.get("poll", {}).get("question", "") for issue in issues]
    pairs = [(issue.get("poll", {}).get("a", ""), issue.get("poll", {}).get("b", "")) for issue in issues]
    if len(set(questions)) != len(questions):
        problems.append(f"중복 질문: {questions}")
    if len(set(pairs)) != len(pairs):
        problems.append(f"중복 선택지: {pairs}")
    for issue in issues:
        poll = issue.get("poll") or {}
        question = poll.get("question", "")
        a, b = poll.get("a", ""), poll.get("b", "")
        if not (6 <= len(question) <= 44):
            problems.append(f"질문 길이: {question}")
        if not (2 <= len(a) <= 30 and 2 <= len(b) <= 30):
            problems.append(f"선택지 길이: {a}/{b}")
        if a == b:
            problems.append(f"같은 선택지: {a}")
        if BLAND_POLL.search(question):
            problems.append(f"고정 문구: {question}")
        # 기사 제목의 낱말이 문항에 하나도 안 들어가면 '아무 기사에나 붙는 질문'입니다.
        compact = issue.get("title", "").replace(" ", "")
        words = [word for word in re.split(r"[^가-힣A-Za-z0-9]+", " ".join([question, a, b])) if len(word) >= 2]
        if not any(word in compact for word in words):
            problems.append(f"기사와 무관: {question} / {issue.get('title', '')[:30]}")
    return problems


def save_download(page, selector: str, target: Path) -> bool:
    try:
        with page.expect_download(timeout=30000) as info:
            page.locator(selector).click()
        download = info.value
        download.save_as(str(target))
        return True
    except Exception as error:  # noqa: BLE001
        check(f"A: 다운로드 실패({selector})", False, str(error)[:120])
        return False


# ------------------------------------------------------------------ scenario A

def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def wait_slides(page, timeout: int = 60000) -> None:
    """카드 5장은 캔버스로 그려서 화면에 올립니다 — 다 그려질 때까지 기다립니다."""
    page.wait_for_selector('[data-testid="slide-img-5"]', timeout=timeout)
    page.wait_for_timeout(400)


def slide_labels(page) -> list[str]:
    return [
        page.locator(f'[data-testid="slide-{i + 1}"]').get_attribute("aria-label") or ""
        for i in range(5)
    ]


def slide_hashes(page) -> list[str]:
    return [
        page.locator(f'[data-testid="slide-img-{i + 1}"]').get_attribute("data-hash") or ""
        for i in range(5)
    ]


def slide_sizes(page) -> list[dict]:
    return page.evaluate(
        """() => Array.from(document.querySelectorAll('[data-testid^="slide-img-"]')).map(img => ({
            w: img.naturalWidth, h: img.naturalHeight, loaded: img.complete }))"""
    )


def top_region_pixels(page, slide: int = 1) -> dict:
    """카드 위쪽(사진이 깔리는 자리)에 실제 사진이 그려졌는지 픽셀 색으로 확인합니다."""
    return page.evaluate(
        """(n) => {
            const img = document.querySelector(`[data-testid="slide-img-${n}"]`);
            const c = document.createElement('canvas');
            c.width = 80; c.height = 40;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0, 80, 40);
            const d = ctx.getImageData(0, 0, 80, 40).data;
            const colors = new Set();
            let sum = 0;
            for (let i = 0; i < d.length; i += 4) {
                colors.add((d[i] >> 3) + ',' + (d[i + 1] >> 3) + ',' + (d[i + 2] >> 3));
                sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
            }
            return { colors: colors.size, avg: sum / (d.length / 4) };
        }""",
        slide,
    )


def issue_from_api(base: str, issue_id: str) -> dict:
    port = re.search(r":(\d+)", base).group(1)
    status, payload = api_json(int(port), f"/api/trending?issue={issue_id}")
    return payload.get("issue") or {}


def scenario_mobile(base: str, browser):
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True,
        accept_downloads=True,
        permissions=["clipboard-read", "clipboard-write"],
    )
    seed_plan(ctx, "pro")
    page = attach(ctx.new_page(), "A")
    page.goto(base, wait_until="networkidle")
    page.wait_for_selector('[data-testid="feed-card"]', timeout=20000)
    settle(page, 500)

    cards = page.locator('[data-testid="feed-card"]').count()
    check("A: 오늘의 카드뉴스 3건 이상", cards >= 3, f"{cards}건")
    check("A: 1위 히어로 카드", page.locator('[data-testid="hero-card"]').count() == 1)
    check("A: 추천(오늘 올릴) 카드 표시", page.locator('[data-recommended="true"]').count() >= 3, f"{page.locator('[data-recommended=\'true\']').count()}건")
    check("A: 화제성 숫자 노출", page.locator(".card-buzz").count() >= 3)

    hook = page.locator('[data-testid="hero-card"] .hero-hook').inner_text().strip()
    check("A: 히어로 한 줄 훅 표시", len(hook) >= 8, hook)
    check("A: 출처·시간 표시", bool(re.search(r"분 전|시간 전|방금", page.locator('[data-testid="hero-card"]').inner_text())))

    # 목록에서도 이슈마다 다른 A/B가 보여야 합니다.
    teasers = page.locator('[data-testid="feed-card"] .teaser-q')
    teaser_texts = [teasers.nth(i).inner_text().strip() for i in range(teasers.count())]
    check("A: 목록에서 A/B 문항이 바로 보임", len(teaser_texts) >= 3 and all(len(t) >= 8 for t in teaser_texts), str(teaser_texts)[:120])
    check("A: 카드마다 투표 문항이 다름", len(set(teaser_texts)) == len(teaser_texts), str(teaser_texts)[:160])

    strip = page.locator(".live-strip").inner_text()
    check("A: 수집 시각·건수·AI 상태 노출", "기준" in strip and "이슈" in strip and "AI" in strip, strip)
    check("A: 언론사 수집 현황 노출", "언론사" in strip, strip)

    body_font = page.evaluate("getComputedStyle(document.body).fontFamily")
    hook_font = page.evaluate("getComputedStyle(document.querySelector('.hero-hook')).fontFamily")
    size = page.evaluate("parseFloat(getComputedStyle(document.querySelector('.hero-hook')).fontSize)")
    check("A: 본문 Pretendard/SUIT 고딕", "Pretendard" in body_font or "SUIT" in body_font, body_font)
    check("A: 헤드라인 세리프(매거진)", "serif" in hook_font.lower(), hook_font)
    check("A: 임팩트 헤드라인(26px 이상)", size >= 26, str(size))

    check("A: 모바일 390 가로 넘침 없음(피드)", no_overflow(page))
    page.screenshot(path=str(SHOTS / "01-mobile-feed.png"), full_page=True)

    # 홈의 '카드뉴스 5장' 1번 칸 = 실제로 그린 인스타 썸네일
    cover_tile = page.locator('[data-testid="preview-cover"] img')
    page.wait_for_selector('[data-testid="preview-cover"] img', timeout=25000)
    tile = page.evaluate(
        """() => { const img = document.querySelector('[data-testid="preview-cover"] img');
            return { w: img.naturalWidth, h: img.naturalHeight }; }"""
    )
    check("A: 홈 카드뉴스 칸 1번에 표지 썸네일(1080×1350)", tile.get("w") == 1080 and tile.get("h") == 1350, str(tile))

    open_viewer(page)
    issue_id = page.locator('[data-testid="hero-card"]').get_attribute("data-issue-id") or ""
    issue = issue_from_api(base, issue_id)

    check("A: 카드뉴스 뷰어 열림", page.locator('[data-testid="viewer"]').count() == 1)
    check("A: 진행 막대 5칸", page.locator(".cn-seg").count() == 5)
    wait_slides(page)

    sizes = slide_sizes(page)
    check("A: 5장 모두 렌더", len(sizes) == 5 and all(s["loaded"] for s in sizes), str(sizes))
    check("A: 카드 규격 1080×1350", all(s["w"] == 1080 and s["h"] == 1350 for s in sizes), str(sizes))

    labels = slide_labels(page)
    check("A: 표지 문구 = 이 카드의 훅", hook in labels[0], labels[0][:80])
    facts = issue.get("facts") or []
    check(
        "A: ② 무슨 일인데 — 팩트 3줄",
        len(facts) == 3 and all(fact[:24] in labels[1] for fact in facts),
        labels[1][:120],
    )
    check("A: ② 원제(원문 제목) 표시", (issue.get("title") or "")[:20] in labels[1], labels[1][:120])
    check("A: ③ 왜 지금 뜨나 — 배경", (issue.get("background") or "")[:20] in labels[2], labels[2][:90])
    check("A: ③ 핵심 쟁점", "핵심 쟁점" in labels[2] and (issue.get("point") or "")[:10] in labels[2], labels[2][:120])
    sides = issue.get("sides") or {}
    check(
        "A: ④ A vs B 두 진영",
        (sides.get("a") or "")[:16] in labels[3] and (sides.get("b") or "")[:16] in labels[3],
        labels[3][:140],
    )
    check("A: ⑤ 투표 질문·선택지", issue.get("poll", {}).get("question", "")[:12] in labels[4], labels[4][:120])
    check("A: ⑤ 댓글 유도", "댓글" in labels[4])

    hashes = slide_hashes(page)
    check("A: 5장이 서로 다른 카드", len(set(hashes)) == 5 and all(hashes), str(hashes)[:80])

    # 표지 위쪽에 실제 사진이 그려졌는지 (밋밋한 배경이면 색이 거의 없음)
    if issue.get("image"):
        top = top_region_pixels(page, 1)
        check("A: 표지에 기사 사진이 실제로 그려짐", top["colors"] >= 26, str(top))
    else:
        check("A: 사진이 없어도 표지가 그래픽으로 채워짐", top_region_pixels(page, 1)["colors"] >= 8)

    page.screenshot(path=str(SHOTS / "03-mobile-cover.png"))
    for i in range(1, 5):
        page.locator(f'[data-testid="progress-{i + 1}"]').click()
        settle(page, 420)
        page.screenshot(path=str(SHOTS / f"0{3 + i}-mobile-slide{i + 1}.png"))

    # 5번 카드에서 PNG 저장 — 화면에 보이는 그 파일이어야 합니다.
    page.locator('[data-testid="progress-5"]').click()
    settle(page, 400)
    png_path = ROOT / ".tmp" / "card-slide5.png"
    shown_hash = hashes[4]
    if save_download(page, '[data-testid="save-png"]', png_path):
        data = png_path.read_bytes()
        check("A: 현재 장 PNG 저장", data[:8] == b"\x89PNG\r\n\x1a\n", data[:8].hex())
        check("A: PNG 규격 1080×1350(4:5)", png_size(png_path) == (1080, 1350), str(png_size(png_path)))
        check("A: PNG 파일 크기 충분", len(data) > 20_000, f"{len(data)} bytes")
        check("A: 저장된 PNG = 화면에 보이는 카드(해시 일치)", sha256_of(png_path) == shown_hash, f"{sha256_of(png_path)[:12]} != {shown_hash[:12]}")

    # 5장 ZIP — 화면의 5장과 같은 파일이어야 합니다.
    zip_path = ROOT / ".tmp" / "card-5.zip"
    if save_download(page, '[data-testid="save-all"]', zip_path):
        zdata = zip_path.read_bytes()
        check("A: 5장 ZIP 저장", zdata[:2] == b"PK", zdata[:4].hex())
        with zipfile.ZipFile(io.BytesIO(zdata)) as archive:
            names = archive.namelist()
            check("A: ZIP에 5장", len(names) == 5, str(names))
            payloads = [archive.read(name) for name in names]
            check("A: ZIP 속 PNG 모두 1080×1350", all(png_size_from_bytes(p) == (1080, 1350) for p in payloads), "ok")
            zip_hashes = {hashlib.sha256(p).hexdigest() for p in payloads}
            check("A: ZIP 속 5장 = 화면의 5장(해시 일치)", zip_hashes == set(hashes), f"{len(zip_hashes)}장 대조")
            (SHOTS / "13-card-export-cover.png").write_bytes(payloads[0])
            (SHOTS / "14-card-export-facts.png").write_bytes(payloads[1])
            (SHOTS / "15-card-export-sides.png").write_bytes(payloads[3])
            (SHOTS / "18-card-export-vote.png").write_bytes(payloads[4])

    # 인스타 캡션
    page.locator('[data-testid="open-caption"]').click()
    page.wait_for_selector('[data-testid="caption-panel"]', timeout=5000)
    caption = page.locator('[data-testid="caption-text"]').input_value()
    check("A: 캡션에 훅 포함", hook in caption)
    check("A: 캡션에 해시태그", "#이슈온도계" in caption and caption.count("#") >= 5, caption[-120:])
    check("A: 캡션에 카드 링크", "#/i/" in caption)
    page.screenshot(path=str(SHOTS / "09-mobile-caption.png"))
    page.locator('[data-testid="copy-caption"]').click()
    settle(page, 500)
    clip = page.evaluate("navigator.clipboard.readText().catch(() => '')")
    check("A: 캡션 복사", hook in (clip or ""), str(clip)[:60])
    page.locator('[data-testid="open-caption"]').click()

    # 투표 · 토론
    check("A: 카드 아래 토론 영역", page.locator('[data-testid="discussion"]').count() == 1)
    check("A: 투표 전에는 % 숨김", page.locator('[data-testid="result-a"]').count() == 0)
    page.locator('[data-testid="vote-a"]').click()
    page.wait_for_selector('[data-testid="result-a"]', timeout=8000)
    settle(page, 700)
    pct_a = page.locator('[data-testid="result-a"]').inner_text()
    check("A: 한 번 누르면 % 반영", pct_a.strip().endswith("%") and int(pct_a.replace("%", "")) > 0, pct_a)
    check("A: 누적 참여 수 표시", "명 참여" in page.locator(".dlg-foot").inner_text())
    check("A: 내 선택 표시", page.locator('[data-testid="vote-a"]').get_attribute("aria-pressed") == "true")

    page.locator('[data-testid="comment-side-b"]').click()
    page.fill('[data-testid="comment-input"]', "이건 좀 심하다")
    page.locator('[data-testid="comment-submit"]').click()
    page.wait_for_selector('[data-testid="comment-list"]', timeout=8000)
    settle(page, 700)
    check("A: 토론 댓글 등록", "이건 좀 심하다" in page.locator('[data-testid="comment-list"]').inner_text())
    first_item = page.locator('[data-testid="comment-item"]').first
    check("A: 댓글에 진영 표시", first_item.get_attribute("data-side") == "b", first_item.get_attribute("data-side") or "")
    check("A: 댓글 수 표시", "1" in page.locator('[data-testid="comment-count"]').inner_text())

    like_btn = first_item.locator('[data-testid="comment-like"]')
    like_btn.click()
    settle(page, 600)
    check("A: 댓글 공감", "1" in like_btn.inner_text())

    page.locator('[data-testid="comment-filter-a"]').click()
    settle(page, 400)
    check("A: A 진영 필터 — 내 B 댓글 숨김", page.locator('[data-testid="comment-empty"]').count() == 1)
    page.locator('[data-testid="comment-filter-all"]').click()
    settle(page, 400)
    page.screenshot(path=str(SHOTS / "08-mobile-discussion.png"))

    page.locator('[data-testid="copy-link"]').click()
    settle(page, 600)
    check("A: 링크 복사 안내", page.locator('[data-testid="toast"]').count() == 1)
    clip_link = page.evaluate("navigator.clipboard.readText().catch(() => '')")
    check("A: 복사된 링크에 카드 주소", "#/i/" in (clip_link or ""), str(clip_link)[:80])

    share_url = page.evaluate("location.href")
    check("A: 주소에 카드 id", "#/i/" in share_url, share_url)

    page.reload(wait_until="networkidle")
    page.wait_for_selector('[data-testid="viewer"]', timeout=15000)
    wait_slides(page)
    check("A: 새로고침해도 같은 카드가 열림", hook in slide_labels(page)[0])
    check("A: 새로고침해도 내 표 유지", page.locator('[data-testid="vote-a"]').get_attribute("aria-pressed") == "true")
    page.wait_for_selector('[data-testid="comment-list"]', timeout=8000)
    check("A: 새로고침해도 내 댓글 유지", "이건 좀 심하다" in page.locator('[data-testid="comment-list"]').inner_text())

    share_ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True)
    share_page = attach(share_ctx.new_page(), "A-share")
    share_page.goto(share_url, wait_until="networkidle")
    share_page.wait_for_selector('[data-testid="viewer"]', timeout=15000)
    wait_slides(share_page)
    check("A: 공유 링크로 바로 카드 열림", hook in slide_labels(share_page)[0])
    share_page.wait_for_selector('[data-testid="comment-list"]', timeout=8000)
    check("A: 공유 링크에서도 토론 보임", "이건 좀 심하다" in share_page.locator('[data-testid="comment-list"]').inner_text())
    check("A: 모바일 390 가로 넘침 없음(공유)", no_overflow(share_page))

    share_ctx.close()
    ctx.close()
    return hook


def png_size_from_bytes(data: bytes) -> tuple[int, int]:
    return struct.unpack(">II", data[16:24])


# ---------------------------------------------------------------- scenario B (공용)

def scenario_shared(base: str, browser, hook: str):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
    page = attach(ctx.new_page(), "B")
    page.goto(base, wait_until="networkidle")
    page.wait_for_selector('[data-testid="feed-card"]', timeout=20000)
    settle(page, 500)
    open_viewer(page)

    wait_slides(page)
    check("B: 다른 브라우저에서도 같은 카드", hook in slide_labels(page)[0], slide_labels(page)[0][:60])
    total_text = page.locator(".dlg-foot").inner_text()
    check("B: 앞서 던진 표가 보임", "명 참여" in total_text, total_text)
    check("B: 앞서 쓴 댓글이 보임", "이건 좀 심하다" in page.locator('[data-testid="comment-list"]').inner_text())

    page.locator('[data-testid="vote-b"]').click()
    page.wait_for_selector('[data-testid="result-b"]', timeout=8000)
    settle(page, 900)
    pct_a = page.locator('[data-testid="result-a"]').inner_text()
    pct_b = page.locator('[data-testid="result-b"]').inner_text()
    check("B: 두 번째 표가 비율을 바꿈", pct_a.strip() == "50%" and pct_b.strip() == "50%", f"{pct_a}/{pct_b}")
    check("B: 참여 수 2명", "2명 참여" in page.locator(".dlg-foot").inner_text(), page.locator(".dlg-foot").inner_text())

    page.locator('[data-testid="comment-side-a"]').click()
    page.fill('[data-testid="comment-input"]', "반대 입장도 이해된다")
    page.locator('[data-testid="comment-submit"]').click()
    settle(page, 900)
    check("B: 두 번째 댓글 누적", "반대 입장도 이해된다" in page.locator('[data-testid="comment-list"]').inner_text())
    page.screenshot(path=str(SHOTS / "10-mobile-shared-comments.png"))
    ctx.close()


# --------------------------------------------------------------- scenario C (제작)

def scenario_briefing(base: str, browser, port: int):
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    page = attach(ctx.new_page(), "C")
    page.goto(base, wait_until="networkidle")
    page.wait_for_selector('[data-testid="feed-card"]', timeout=20000)
    settle(page, 400)

    page.locator('[data-testid="open-studio"]').click()
    page.wait_for_selector('[data-testid="studio-input"]')
    settle(page, 300)
    page.screenshot(path=str(SHOTS / "11-mobile-studio.png"))
    page.fill(
        '[data-testid="studio-input"]',
        f"http://127.0.0.1:{port}/fake-article/%EC%A3%BC%204%EC%9D%BC%EC%A0%9C%20%EC%8B%9C%EB%B2%94%20%EC%82%AC%EC%97%85%20%EC%B0%B8%EC%97%AC%20%EA%B8%B0%EC%97%85%20%EB%91%90%20%EB%B0%B0%EB%A1%9C%20%EB%8A%98%EC%96%B4",
    )
    page.locator('[data-testid="studio-submit"]').click()
    page.wait_for_selector('[data-testid="viewer"]', timeout=45000)
    settle(page, 800)
    wait_slides(page)
    created = slide_labels(page)[0]
    check("C: 기사 링크로 카드 생성", "주 4일제" in created, created)
    check("C: 만든 카드도 5장 구성", page.locator(".cn-seg").count() == 5 and len(slide_sizes(page)) == 5)
    created_poll = page.locator('[data-testid="poll-question"]').inner_text().strip()
    check("C: 만든 카드도 기사 맞춤 A/B", not BLAND_POLL.search(created_poll), created_poll)
    page.screenshot(path=str(SHOTS / "12-mobile-created.png"))
    page.locator('[data-testid="close-viewer"]').click()
    settle(page, 500)

    page.locator('[data-testid="open-studio"]').click()
    page.fill('[data-testid="studio-input"]', "요즘 편의점 도시락 가격이 왜 이렇게 올랐는지 궁금하다")
    page.locator('[data-testid="studio-submit"]').click()
    page.wait_for_selector('[data-testid="viewer"]', timeout=45000)
    settle(page, 600)
    # 카드 5장은 캔버스로 그려 순서대로 올라옵니다 — 다 그려질 때까지 기다립니다.
    page.wait_for_selector('[data-testid="slide-img-5"]', timeout=25000)
    check("C: 한 줄 이슈로도 카드 생성", page.locator('[data-testid="slide-img-5"]').count() == 1)
    page.locator('[data-testid="close-viewer"]').click()
    settle(page, 300)

    page.locator('[data-testid="open-studio"]').click()
    page.fill('[data-testid="studio-input"]', "짧")
    check("C: 너무 짧은 입력은 막힘", page.locator('[data-testid="studio-submit"]').is_disabled())
    page.locator('[data-testid="studio-input"]').press("Escape")
    page.locator(".sheet-head .icon-btn").click()
    settle(page, 300)

    status, payload = api_json(port, "/api/briefing", {"url": "https://news.google.com/rss/articles/abc"})
    check("C: 구글 뉴스 링크는 본문을 못 읽는다고 안내", status == 400 and payload.get("error") == "google_news_link", str(payload)[:120])

    status, payload = api_json(port, "/api/briefing", {"text": "짧"})
    check("C: 짧은 입력은 400", status == 400 and payload.get("error") == "too_short", str(payload)[:80])

    ctx.close()


def scenario_ssrf(port: int):
    status, payload = api_json(port, "/api/briefing", {"url": "http://169.254.169.254/latest/meta-data/"})
    check("C: 클라우드 메타데이터 주소 차단(SSRF)", status == 400 and payload.get("error") == "article_unreadable", f"{status} {str(payload)[:100]}")
    status, payload = api_json(port, "/api/briefing", {"url": f"http://127.0.0.1:{port}/fake-article/x"})
    check("C: 사설망(127.0.0.1) 주소 차단", status == 400, f"{status} {str(payload)[:100]}")
    status, payload = api_json(port, "/api/briefing", {"url": "file:///etc/passwd"})
    check("C: http(s) 아닌 주소 차단", status == 400, f"{status} {str(payload)[:80]}")


# ---------------------------------------------------------------- scenario D (키 없음)

def poll_engine_checks(port: int) -> None:
    """AI가 없을 때도 카드마다 다른 A/B가 나오는지 — 예전엔 5장이 모두 같은 문항이었습니다."""
    status, payload = api_json(port, "/api/trending")
    issues = payload.get("issues") or []
    check("D: AI 없이도 카드 4건 이상", status == 200 and len(issues) >= 4, f"{status} {len(issues)}건")
    problems = poll_problems(issues)
    check("D: AI 없이도 카드마다 다른 A/B", not problems, " | ".join(problems[:3]))
    check(
        "D: 고정 문구가 남지 않음",
        not any(BLAND_POLL.search((issue.get("poll") or {}).get("question", "")) for issue in issues),
        str([issue.get("poll", {}).get("question") for issue in issues])[:160],
    )


def scenario_headline_only(port: int, browser):
    base = f"http://127.0.0.1:{port}/"
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
    page = attach(ctx.new_page(), "D")
    page.goto(base, wait_until="networkidle")
    page.wait_for_selector('[data-testid="feed-card"]', timeout=20000)
    settle(page, 500)

    body = page.inner_text("body")
    check("D: AI 키 없어도 실제 헤드라인 카드가 뜸", page.locator('[data-testid="feed-card"]').count() >= 3)
    check("D: 'AI 없이 제목' 표시", "AI 없이 제목" in body or "헤드라인만" in body)
    check("D: 무엇이 꺼졌는지 안내", page.locator('[data-testid="notice"]').count() == 1, page.locator('[data-testid="notice"]').inner_text()[:80] if page.locator('[data-testid="notice"]').count() else "없음")
    check("D: 측정 안 된 온도는 '–'로 정직하게", page.locator(".temp.is-unmeasured").count() >= 1)
    check("D: 화제성 숫자는 제목 기반으로 계산", page.locator(".card-buzz").count() >= 3)
    page.screenshot(path=str(SHOTS / "16-mobile-headline-only.png"), full_page=True)

    open_viewer(page)
    wait_slides(page)
    labels = slide_labels(page)
    check("D: AI 없이도 5장 모두 렌더", len(slide_sizes(page)) == 5)
    check("D: 팩트 카드에 원문 안내", "원문" in labels[1], labels[1][:90])
    check("D: 팩트 3줄을 요약에서 채움", labels[1].count(".") >= 3, labels[1][:120])
    check("D: 입장 비교가 없어도 A/B 선택지로 카드 구성", "A" in labels[3] and "B" in labels[3], labels[3][:100])
    check("D: 투표 카드에 질문·선택지", "당신의 선택" in labels[4] and "A" in labels[4], labels[4][:90])
    page.locator('[data-testid="vote-a"]').click()
    page.wait_for_selector('[data-testid="result-a"]', timeout=8000)
    check("D: 키가 없어도 투표는 동작", page.locator('[data-testid="vote-a"]').get_attribute("aria-pressed") == "true")
    ctx.close()


# ---------------------------------------------------------------- scenario E (정적)

def scenario_static(port: int, browser):
    base = f"http://127.0.0.1:{port}/"
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
    page = attach(ctx.new_page(), "E")
    requests: list[str] = []
    page.on("request", lambda request: requests.append(request.url) if "/api/" in request.url else None)
    page.goto(base, wait_until="networkidle")
    settle(page, 800)
    check("E: 정적 배포 안내 표시", page.locator('[data-testid="static-notice"]').count() == 1)
    check("E: 정적 배포에서 /api 요청 없음", len(requests) == 0, str(requests[:3]))
    check("E: 안내에 실시간 주소", "issue-factbomb-board.vercel.app" in page.inner_text("body"))
    page.screenshot(path=str(SHOTS / "17-mobile-static.png"))
    ctx.close()


# ---------------------------------------------------------------- scenario F (데스크톱)

def scenario_desktop(base: str, browser):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, device_scale_factor=1)
    page = attach(ctx.new_page(), "F")
    page.goto(base, wait_until="networkidle")
    page.wait_for_selector('[data-testid="feed-card"]', timeout=20000)
    settle(page, 600)
    check("F: 데스크톱 가로 넘침 없음", no_overflow(page))
    cols = page.evaluate("getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length")
    check("F: 데스크톱 3열 카드 그리드", cols >= 3, f"{cols}열")
    page.screenshot(path=str(SHOTS / "02-desktop-feed.png"), full_page=True)

    open_viewer(page)
    card_box = page.locator(".cn-card").bounding_box()
    discuss_box = page.locator(".discuss").bounding_box()
    check("F: 카드뉴스 폰 비율 프레임", bool(card_box) and 380 <= card_box["width"] <= 470, str(card_box))
    check(
        "F: 카드 오른쪽에 토론 2단",
        bool(card_box) and bool(discuss_box) and discuss_box["x"] > card_box["x"] + card_box["width"] - 2,
        f"{card_box} / {discuss_box}",
    )
    page.screenshot(path=str(SHOTS / "02b-desktop-viewer.png"))
    page.locator('[data-testid="vote-b"]').click()
    page.wait_for_selector('[data-testid="result-b"]', timeout=8000)
    settle(page, 500)
    page.screenshot(path=str(SHOTS / "02c-desktop-vote.png"))

    # 편집실 2단(편집 | 실시간 미리보기)과 요금제 — 데스크톱 화면
    page.locator('[data-testid="open-editor"]').click()
    page.wait_for_selector('[data-testid="studio-sheet"]')
    settle(page, 1800)
    split = page.evaluate(
        """() => {
            const e = document.querySelector('.studio-editor').getBoundingClientRect();
            const p = document.querySelector('.studio-preview-rail').getBoundingClientRect();
            const f = document.querySelector('[data-testid="save-copy"]').getBoundingClientRect();
            const rail = document.querySelector('.studio-preview-rail').getBoundingClientRect();
            return { editorRight: Math.round(e.right), previewLeft: Math.round(p.left),
                     previewBottom: Math.round(p.bottom), footTop: Math.round(f.top),
                     railBottom: Math.round(rail.bottom) };
        }"""
    )
    check("F: 편집실과 미리보기가 좌우 2단", split["previewLeft"] >= split["editorRight"] - 2, str(split))
    check("F: 미리보기가 저장 줄을 덮지 않음", split["railBottom"] <= split["footTop"] + 2, str(split))
    page.screenshot(path=str(SHOTS / "24-desktop-studio.png"))
    page.locator('[data-testid="studio-sheet"] .sheet-head .icon-btn').click()
    settle(page, 400)
    page.locator('[data-testid="close-viewer"]').click()
    settle(page, 400)
    page.locator('[data-testid="open-pricing"]').click()
    page.wait_for_selector('[data-testid="pricing-sheet"]')
    settle(page, 700)
    check("F: 요금제 3열", page.evaluate("getComputedStyle(document.querySelector('.plan-grid')).gridTemplateColumns.split(' ').length") == 3)
    page.screenshot(path=str(SHOTS / "25-desktop-pricing.png"))
    ctx.close()




# ---------------------------------------------------- scenario G (크리에이터 작업대)

def wait_hash_change(page, slide: int, before: str, timeout: float = 20.0) -> str:
    """카드를 다시 그리면 슬라이드 해시가 바뀝니다 — 그때까지 기다립니다."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        value = page.locator(f'[data-testid="slide-img-{slide}"]').get_attribute("data-hash") or ""
        if value and value != before:
            return value
        time.sleep(0.25)
    return ""


def hashtag_count(text: str) -> int:
    # 링크(#/i/…)는 해시태그가 아닙니다.
    return len(re.findall(r"(?:^|\s)#[^\s#]+", text))


def scenario_creator(base: str, browser):
    """크리에이터가 실제로 쓰는 흐름 — 검색·저장함·발행 체크·문구 편집·테마·워터마크·캡션."""
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True,
        accept_downloads=True,
        permissions=["clipboard-read", "clipboard-write"],
    )
    seed_plan(ctx, "pro")
    page = attach(ctx.new_page(), "G")
    page.goto(base, wait_until="networkidle")
    page.wait_for_selector('[data-testid="feed-card"]', timeout=20000)
    settle(page, 600)

    total = page.locator('[data-testid="feed-card"]').count()
    check("G: 크리에이터 작업 줄(검색·카테고리·상태)", page.locator('[data-testid="workflow-bar"]').count() == 1)
    check("G: 하루 발행 목표 표시", "오늘 발행" in page.locator(".work-goal").inner_text(), page.locator(".work-goal").inner_text())
    check("G: 상단에 테마 칩", page.locator('[data-testid="open-brand"]').count() == 1)
    check("G: 상단 발행 카운터", "발행" in page.locator('[data-testid="publish-pill"]').inner_text())

    # 1) 검색
    first_hook = page.locator('[data-testid="feed-card"] .card-hook').first.inner_text().strip()
    needle = first_hook[:3]
    page.fill('[data-testid="search-input"]', needle)
    settle(page, 500)
    shown = page.locator('[data-testid="feed-card"]').count() + page.locator('[data-testid="hero-card"]').count()
    check("G: 검색으로 오늘 카드 좁히기", 1 <= shown <= total + 1, f"'{needle}' → {shown}건 / 전체 {total + 1}건")
    check("G: 검색 결과 건수 표시", "보는 중" in page.locator('[data-testid="filter-count"]').inner_text())
    page.fill('[data-testid="search-input"]', "")
    settle(page, 400)

    # 2) 카테고리 필터 — 지금 목록에 실제로 있는 카테고리로 좁혀 봅니다.
    CATEGORY_KEYS = {"직장·커리어": "work", "MZ·트렌드": "mz", "소비·경제": "money", "테크·AI": "tech", "문화·연예": "culture"}
    first_cat = page.evaluate(
        "() => document.querySelector('[data-testid=\"feed-card\"] .card-meta .chip').textContent.trim()"
    )
    if first_cat in CATEGORY_KEYS:
        page.locator(f'[data-testid="filter-category-{CATEGORY_KEYS[first_cat]}"]').click()
        settle(page, 450)
        labels = page.evaluate(
            """() => Array.from(document.querySelectorAll('[data-testid="feed-card"] .card-meta .chip:first-child, [data-testid="hero-card"] .chip-onDark')).map(e => e.textContent.trim())"""
        )
        check("G: 카테고리 필터가 목록에 적용됨", len(labels) >= 1 and all(label == first_cat for label in labels), f"{first_cat} → {labels}")
    else:
        check("G: 카테고리 필터가 목록에 적용됨", False, f"카테고리 칩을 찾지 못함: {first_cat}")
    page.locator('[data-testid="filter-category-all"]').click()
    settle(page, 400)

    # 3) 저장함
    card = page.locator('[data-testid="feed-card"]').first
    saved_id = card.get_attribute("data-issue-id") or ""
    card.locator('[data-testid="toggle-save"]').click()
    settle(page, 350)
    check("G: 저장함 표시", page.locator(f'[data-issue-id="{saved_id}"]').first.get_attribute("data-saved") == "true")
    page.locator('[data-testid="filter-status-saved"]').click()
    settle(page, 450)
    visible = page.locator('[data-testid="feed-card"], [data-testid="hero-card"]').count()
    check("G: 저장함 필터 = 저장한 카드만", visible == 1 and page.locator(f'[data-issue-id="{saved_id}"]').count() == 1, f"{visible}건")
    page.locator('[data-testid="filter-status-all"]').click()
    settle(page, 400)

    # 4) 발행 완료 체크
    page.locator(f'[data-issue-id="{saved_id}"] [data-testid="toggle-published"]').first.click()
    settle(page, 400)
    check("G: 발행 완료 표시", page.locator(f'[data-issue-id="{saved_id}"]').first.get_attribute("data-published") == "true")
    check("G: 오늘 발행 카운터 1", page.locator('[data-testid="publish-pill"]').inner_text().strip().startswith("1"), page.locator('[data-testid="publish-pill"]').inner_text())
    page.locator('[data-testid="filter-status-done"]').click()
    settle(page, 450)
    check("G: 발행 완료 필터", page.locator(f'[data-issue-id="{saved_id}"]').count() == 1)
    page.locator('[data-testid="filter-status-all"]').click()
    settle(page, 400)

    # 5) 새로고침 후에도 저장함·발행 체크 유지(LocalStorage)
    page.reload(wait_until="networkidle")
    page.wait_for_selector('[data-testid="feed-card"]', timeout=20000)
    settle(page, 700)
    check(
        "G: 새로고침해도 저장함·발행 체크 유지",
        page.locator(f'[data-issue-id="{saved_id}"]').first.get_attribute("data-saved") == "true"
        and page.locator(f'[data-issue-id="{saved_id}"]').first.get_attribute("data-published") == "true",
    )

    # 6) 카드뉴스 — 캡션 해시태그 12~15개
    open_viewer(page)
    wait_slides(page)
    page.locator('[data-testid="open-caption"]').click()
    page.wait_for_selector('[data-testid="caption-panel"]')
    settle(page, 300)
    caption = page.locator('[data-testid="caption-text"]').input_value()
    tags = hashtag_count(caption)
    check("G: 인스타 캡션 해시태그 12~15개", 12 <= tags <= 15, f"{tags}개")
    check("G: 캡션에 3줄 요약·토론 질문", "Q." in caption and "A." in caption and "B." in caption and caption.count("\n1.") >= 1, caption[:80])
    page.screenshot(path=str(SHOTS / "19-creator-caption.png"))

    # 7) 문구 편집 — 헤드라인을 바꾸면 카드가 다시 그려지고 PNG도 바뀝니다.
    page.locator('[data-testid="progress-1"]').click()
    settle(page, 400)
    before_hash = page.locator('[data-testid="slide-img-1"]').get_attribute("data-hash") or ""
    png_before = ROOT / ".tmp" / "g-before.png"
    save_download(page, '[data-testid="save-png"]', png_before)
    before_sha = sha256_of(png_before) if png_before.exists() else ""

    page.locator('[data-testid="open-editor"]').click()
    page.wait_for_selector('[data-testid="studio-sheet"]')
    settle(page, 350)
    check("G: 문구 편집실 열림", page.locator('[data-testid="theme-editorial"]').count() == 1)
    page.screenshot(path=str(SHOTS / "19b-creator-studio.png"))

    # 7-1) 방금 PNG 저장 토스트가 떠 있는 동안 편집실을 열었습니다 — 버튼을 가리면 안 됩니다.
    toast = page.evaluate(
        """() => {
            const r = (s) => { const el = document.querySelector(s); return el ? el.getBoundingClientRect() : null; };
            const hit = (a, b) => Boolean(a && b) && !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
            const t = r('[data-testid="toast"]');
            return {
                has: Boolean(t),
                top: t ? Math.round(t.top) : null,
                overlapsSave: hit(t, r('[data-testid="save-copy"]')),
                overlapsClose: hit(t, r('.studio-head .icon-btn')),
                overlapsFoot: hit(t, r('.studio-foot')),
                overlapsSheet: hit(t, r('[data-testid="studio-sheet"]')),
            };
        }"""
    )
    check("G: 편집실을 연 순간 토스트가 떠 있음(겹침 검사 대상)", toast["has"], str(toast))
    check("G: 토스트가 저장 버튼을 가리지 않음", not toast["overlapsSave"], str(toast))
    check("G: 토스트가 닫기 버튼을 가리지 않음", not toast["overlapsClose"], str(toast))
    check("G: 토스트가 편집실 하단 줄을 가리지 않음", not toast["overlapsFoot"], str(toast))

    # 7-2) 카드 5장 탭 — 라벨이 잘리지 않고 시트 안에 들어오는가
    tabs = page.evaluate(
        """() => {
            const sheet = document.querySelector('[data-testid="studio-sheet"]').getBoundingClientRect();
            return Array.from(document.querySelectorAll('.studio-tabs button')).map((b) => {
                const r = b.getBoundingClientRect();
                return {
                    label: b.textContent.trim(),
                    clipped: b.scrollWidth > b.clientWidth + 1,
                    inside: r.right <= sheet.right + 0.5 && r.left >= sheet.left - 0.5,
                };
            });
        }"""
    )
    check("G: 카드 5장 탭 = 5개", len(tabs) == 5, str(tabs))
    check("G: 탭 라벨이 잘리지 않음", all(not t["clipped"] for t in tabs), str(tabs))
    check("G: 탭이 시트 밖으로 넘치지 않음", all(t["inside"] for t in tabs), str(tabs))

    # 7-3) 편집실 옆 실시간 4:5 미리보기 + 인스타 3×3 피드
    live_before = ROOT / ".tmp" / "live-before.png"
    live_card = page.locator('[data-testid="live-card"]')
    check("G: 편집실 옆 실시간 미리보기", live_card.count() == 1)
    live_card.screenshot(path=str(live_before))
    ratio = page.evaluate(
        "() => { const r = document.querySelector('.live-card-frame').getBoundingClientRect(); return Math.round((r.width / r.height) * 1000) / 1000; }"
    )
    check("G: 미리보기 프레임 4:5", abs(ratio - 0.8) < 0.03, str(ratio))
    grid = page.evaluate(
        """() => {
            const root = document.querySelector('[data-testid="feed-grid-preview"]');
            if (!root) return null;
            const cells = Array.from(root.querySelectorAll('.grid-cell'));
            const imgs = cells.map((c) => c.querySelector('img')).filter(Boolean);
            return { cells: cells.length, imgs: imgs.length, loaded: imgs.filter((i) => i.naturalWidth === 1080).length };
        }"""
    )
    check("G: 인스타 3×3 피드 미리보기", bool(grid) and grid["cells"] >= 4, str(grid))
    check("G: 피드 칸에 실제 카드 표지가 그려짐", bool(grid) and grid["imgs"] >= 4 and grid["loaded"] >= 4, str(grid))
    page.screenshot(path=str(SHOTS / "20-creator-live-preview.png"))

    NEW_HOOK = "내가 고친 헤드라인, 이제 42%로 간다"
    page.fill('[data-testid="copy-hook-0"]', NEW_HOOK)
    page.wait_for_timeout(1200)
    live_after = ROOT / ".tmp" / "live-after.png"
    live_card.screenshot(path=str(live_after))
    check(
        "G: 문구를 고치면 편집실 미리보기가 바로 바뀜",
        live_after.exists() and live_before.exists() and sha256_of(live_after) != sha256_of(live_before),
    )
    page.fill('[data-testid="handle-input"]', "my_newsroom")
    page.locator('[data-testid="edit-tab-5"]').click()
    settle(page, 200)
    page.fill('[data-testid="copy-question-0"]', "이 소식, 어디까지 믿어?")
    # X로 닫아도 저장되도록 했습니다(닫으면 자동 반영).
    page.locator('[data-testid="studio-sheet"] .sheet-head .icon-btn').click()
    after_hash = wait_hash_change(page, 1, before_hash)
    check("G: 문구를 고치면 카드가 다시 그려짐", bool(after_hash), f"{before_hash[:8]} → {after_hash[:8]}")
    label1 = page.locator('[data-testid="slide-1"]').get_attribute("aria-label") or ""
    check("G: 고친 헤드라인이 카드에 박힘", NEW_HOOK in label1, label1[:80])
    check("G: 워터마크 핸들이 카드에 박힘", "@my_newsroom" in label1, label1[:80])
    check("G: 투표 질문도 고친 문구로", "이 소식, 어디까지 믿어?" in (page.locator('[data-testid="poll-question"]').inner_text()), page.locator('[data-testid="poll-question"]').inner_text())

    png_after = ROOT / ".tmp" / "g-after.png"
    save_download(page, '[data-testid="save-png"]', png_after)
    check("G: 고친 카드의 PNG가 원본과 다름", png_after.exists() and sha256_of(png_after) != before_sha)
    check("G: 고친 카드도 1080×1350", png_size(png_after) == (1080, 1350) if png_after.exists() else False)

    # 8) 테마 4종 — 표지 픽셀이 실제로 달라집니다.
    def cover_avg():
        return page.evaluate(
            """() => {
                const img = document.querySelector('[data-testid="slide-img-1"]');
                const c = document.createElement('canvas'); c.width = 40; c.height = 20;
                const x = c.getContext('2d'); x.drawImage(img, 0, 0, 40, 20);
                const d = x.getImageData(0, 0, 40, 20).data;
                let r = 0, g = 0, b = 0;
                for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
                const n = d.length / 4;
                return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
            }"""
        )

    seen = {}
    for theme, label in (("editorial", "에디토리얼 다크"), ("modern", "모던 화이트"), ("breaking", "브레이킹 레드"), ("pastel", "트렌디 파스텔")):
        prev_hash = page.locator('[data-testid="slide-img-1"]').get_attribute("data-hash") or ""
        page.locator('[data-testid="open-editor"]').click()
        page.wait_for_selector('[data-testid="studio-sheet"]')
        page.locator(f'[data-testid="theme-{theme}"]').click()
        page.locator('[data-testid="studio-sheet"] .sheet-head .icon-btn').click()
        wait_hash_change(page, 1, prev_hash)
        settle(page, 500)
        seen[theme] = cover_avg()
        check(f"G: 테마 {label} 적용", label in (page.locator(".cn-hint").inner_text()), page.locator(".cn-hint").inner_text()[:80])
    distinct = {tuple(value) for value in seen.values()}
    check("G: 테마마다 표지 색이 실제로 다름", len(distinct) == 4, str(seen))

    # 9) 원문으로 되돌리기
    prev_hash = page.locator('[data-testid="slide-img-1"]').get_attribute("data-hash") or ""
    page.locator('[data-testid="open-editor"]').click()
    page.wait_for_selector('[data-testid="studio-sheet"]')
    page.locator('[data-testid="reset-copy"]').click()
    page.locator('[data-testid="studio-sheet"] .sheet-head .icon-btn').click()
    wait_hash_change(page, 1, prev_hash)
    settle(page, 500)
    restored = page.locator('[data-testid="slide-1"]').get_attribute("aria-label") or ""
    check("G: 원문 문구로 되돌리기", NEW_HOOK not in restored and len(restored) > 20, restored[:70])
    check("G: 워터마크는 유지", "@my_newsroom" in restored, restored[:70])

    # 10) 모바일 가로 넘침 없음(작업 줄·편집실 포함)
    check("G: 모바일 390 가로 넘침 없음", no_overflow(page))
    page.locator('[data-testid="close-viewer"]').click()
    settle(page, 400)
    page.locator('[data-testid="open-brand"]').click()
    page.wait_for_selector('[data-testid="studio-sheet"]')
    settle(page, 300)
    check("G: 브랜드 설정(테마·워터마크) 시트", page.locator('[data-testid="handle-input"]').count() == 1)
    check("G: 편집실에서도 가로 넘침 없음", no_overflow(page))
    page.screenshot(path=str(SHOTS / "19c-creator-brand.png"))
    ctx.close()


# ------------------------------------------------------------ 요금제와 잠금

def scenario_plans(base: str, browser):
    """Free → 잠금 확인 → Creator Pro 무료 체험 → 열림 → Free로 복귀."""
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True,
        accept_downloads=True,
        permissions=["clipboard-read", "clipboard-write"],
    )
    page = attach(ctx.new_page(), "P")
    page.goto(base, wait_until="networkidle")
    page.wait_for_selector('[data-testid="feed-card"]', timeout=20000)
    settle(page, 600)

    chip = page.locator('[data-testid="open-pricing"]')
    check("P: 상단에 요금제 칩", chip.count() == 1)
    check("P: 처음엔 Free 플랜", "Free" in chip.inner_text(), chip.inner_text())

    open_viewer(page)
    wait_slides(page)
    check("P: Free에서는 5장 ZIP 잠금", page.locator('[data-testid="save-all"]').get_attribute("data-locked") == "true")
    check("P: 잠긴 버튼에 자물쇠·Pro 표시", page.locator('[data-testid="save-all"] .pro-dot').count() == 1)

    page.locator('[data-testid="open-caption"]').click()
    page.wait_for_selector('[data-testid="caption-lock"]', timeout=6000)
    free_caption = page.locator('[data-testid="caption-text"]').input_value()
    check(
        "P: Free 캡션은 기본본(태그 5개·3줄 요약 없음)",
        hashtag_count(free_caption) == 5 and "Q." not in free_caption,
        f"{hashtag_count(free_caption)}개",
    )
    page.screenshot(path=str(SHOTS / "23-caption-free.png"))
    page.locator('[data-testid="open-caption"]').click()

    page.locator('[data-testid="save-all"]').click()
    page.wait_for_selector('[data-testid="pricing-sheet"]', timeout=6000)
    settle(page, 500)
    check("P: 잠긴 기능을 누르면 요금제가 열림", page.locator('[data-testid="pricing-sheet"]').count() == 1)
    plans = page.locator('[data-testid="pricing-sheet"]').inner_text()
    check("P: 가격표에 Free·14,900·39,000", "Free" in plans and "14,900" in plans and "39,000" in plans)
    check("P: 기능 비교표", page.locator('[data-testid="feature-table"]').count() == 1)
    check("P: 무료 체험이 결제 전 데모임을 적음", "결제" in plans and "체험" in plans)
    page.screenshot(path=str(SHOTS / "21-pricing.png"))

    page.locator('[data-testid="billing-annual"]').click()
    settle(page, 400)
    annual = page.locator('[data-testid="pricing-sheet"]').inner_text()
    check("P: 연 결제(2개월 무료) 가격", "149,000" in annual and "390,000" in annual, annual[:140])
    page.locator('[data-testid="billing-monthly"]').click()
    settle(page, 300)

    page.locator('[data-testid="plan-pro-cta"]').click()
    settle(page, 700)
    check("P: Pro 무료 체험 켜짐", "Pro" in chip.inner_text() and "체험" in chip.inner_text(), chip.inner_text())
    page.locator('[data-testid="close-pricing"]').click()
    settle(page, 450)
    check("P: 체험 후 5장 ZIP 열림", page.locator('[data-testid="save-all"]').get_attribute("data-locked") == "false")

    zip_path = ROOT / ".tmp" / "plan-5.zip"
    if save_download(page, '[data-testid="save-all"]', zip_path):
        check("P: Pro에서 5장 ZIP 저장", zip_path.read_bytes()[:2] == b"PK")

    page.locator('[data-testid="open-caption"]').click()
    page.wait_for_selector('[data-testid="caption-text"]')
    settle(page, 300)
    pro_caption = page.locator('[data-testid="caption-text"]').input_value()
    tags = hashtag_count(pro_caption)
    check("P: Pro 캡션 해시태그 12~15개", 12 <= tags <= 15, f"{tags}개")
    check("P: Pro 캡션에 3줄 요약·A/B", "Q." in pro_caption and "A." in pro_caption and "B." in pro_caption)
    page.locator('[data-testid="open-caption"]').click()

    # 테마 4종·@핸들 — Pro에서는 잠금이 풀립니다.
    page.locator('[data-testid="open-editor"]').click()
    page.wait_for_selector('[data-testid="studio-sheet"]')
    settle(page, 500)
    check("P: Pro에서 테마 잠금 없음", page.locator('.theme-card[data-locked="true"]').count() == 0)
    check("P: Pro에서 핸들 입력 가능", page.locator('[data-testid="handle-input"]').is_editable())
    page.locator('[data-testid="theme-modern"]').click()
    settle(page, 600)
    check("P: Pro에서는 테마를 누르면 요금제가 아니라 테마가 바뀜", page.locator('[data-testid="pricing-sheet"]').count() == 0)
    check("P: 모던 화이트 선택됨", page.locator('[data-testid="theme-modern"]').get_attribute("data-on") == "true")
    page.locator('[data-testid="studio-sheet"] .sheet-head .icon-btn').click()
    settle(page, 450)
    page.locator('[data-testid="close-viewer"]').click()
    settle(page, 450)

    page.locator('[data-testid="open-pricing"]').click()
    page.wait_for_selector('[data-testid="pricing-sheet"]')
    settle(page, 300)
    page.locator('[data-testid="plan-free-cta"]').click()
    settle(page, 600)
    check("P: Free로 돌아가기", "Free" in chip.inner_text(), chip.inner_text())
    page.locator('[data-testid="close-pricing"]').click()
    settle(page, 400)

    open_viewer(page)
    settle(page, 1000)
    hint = page.locator(".cn-hint").inner_text()
    check("P: Free로 내려가면 카드도 기본 테마·워터마크", "에디토리얼" in hint, hint[:90])
    check("P: Free로 내려가면 5장 ZIP 다시 잠금", page.locator('[data-testid="save-all"]').get_attribute("data-locked") == "true")
    ctx.close()


# ---------------------------------------------------------------- API 단위 확인

def api_checks(port: int):
    status, payload = api_json(port, "/api/trending")
    issues = payload.get("issues") or []
    feeds = payload.get("feeds") or []
    check("API: /api/trending 200", status == 200 and payload.get("ok") is True)
    check("API: RSS 19곳 모두 수집", len(feeds) == 19 and all(f.get("ok") for f in feeds), f"{sum(1 for f in feeds if f.get('ok'))}/{len(feeds)}")
    check(
        "API: 연예·사회·이슈 피드 포함",
        any("연예" in f.get("name", "") for f in feeds) and any("사회" in f.get("name", "") for f in feeds),
        str([f.get("name") for f in feeds])[:160],
    )
    check("API: 카드 4건 이상", len(issues) >= 4, str(len(issues)))
    check(
        "API: 모든 카드에 원문 URL·출처·발행시각",
        all(issue.get("url", "").startswith("http") and issue.get("source") and issue.get("publishedAt") for issue in issues),
    )
    check(
        "API: 카드에 5장 구성 요소(훅·팩트3·배경·쟁점·양쪽입장·투표)",
        all(
            len(issue.get("hook", "")) > 4
            and len(issue.get("facts") or []) == 3
            and len(issue.get("background") or "") > 10
            and len(issue.get("point") or "") > 5
            and (issue.get("sides") or {}).get("a")
            and (issue.get("sides") or {}).get("b")
            and (issue.get("sides") or {}).get("labelA")
            and issue.get("poll", {}).get("question")
            for issue in issues
        ),
        str([(i.get("hook"), len(i.get("facts") or [])) for i in issues])[:180],
    )
    check("API: 카테고리 값이 정해진 5종", {issue["category"] for issue in issues} <= {"work", "mz", "money", "tech", "culture"})
    check("API: 온도 0~100", all(isinstance(issue.get("temp"), int) and 0 <= issue["temp"] <= 100 for issue in issues))
    check(
        "API: 카드마다 화제성 점수(0~99)",
        all(isinstance(issue.get("buzz"), int) and 0 <= issue["buzz"] <= 99 for issue in issues),
        str([issue.get("buzz") for issue in issues]),
    )
    check("API: 화제성 높은 카드가 위로", issues[0].get("buzz", 0) >= 55, str([i.get("buzz") for i in issues]))
    check("API: 지어낸 기사 없음(모두 테스트 피드 제목)", all("http://127.0.0.1" in issue["url"] for issue in issues))
    check("API: 본문에 HTML 태그가 남지 않음", all("<" not in fact for issue in issues for fact in issue.get("facts") or []))

    problems = poll_problems(issues)
    check("API: 카드마다 팽팽한 A/B (중복·고정 문구·기사 무관 없음)", not problems, " | ".join(problems[:3]))
    check(
        "API: 투표 문항에 기사 주제어가 들어감",
        all(any(word in issue["title"].replace(" ", "") for word in re.split(r"[^가-힣A-Za-z0-9]+", issue["poll"]["question"]) if len(word) >= 2) for issue in issues),
    )

    # 시나리오 A·B가 1위 카드에 표를 던졌으니, API 검사는 그 뒤 카드로 합니다.
    fid = issues[-1]["id"]
    status, payload = api_json(port, f"/api/trending?issue={fid}")
    check("API: 카드 하나 다시 꺼내기(공유 링크)", status == 200 and payload.get("issue", {}).get("id") == fid)
    status, payload = api_json(port, "/api/trending?issue=doesnotexist123")
    check("API: 없는 카드는 404", status == 404)

    status, payload = api_json(port, "/api/poll", {"action": "vote", "issueId": fid, "choice": "c", "voterId": "tester-abcdef"})
    check("API: 잘못된 선택은 400", status == 400 and payload.get("error") == "bad_choice", str(payload)[:100])

    status, payload = api_json(port, "/api/poll", {"action": "vote", "issueId": fid, "choice": "a", "voterId": "tester-abcdef"})
    check("API: 투표 저장", status == 200 and payload.get("poll", {}).get("counts", {}).get("a") == 1, str(payload)[:120])

    status, payload = api_json(
        port,
        "/api/poll",
        {"action": "comment", "issueId": fid, "side": "x", "text": "의견", "voterId": "tester-abcdef"},
    )
    check("API: 댓글 진영은 A/B만", status == 400 and payload.get("error") == "bad_side", str(payload)[:100])

    status, payload = api_json(
        port,
        "/api/poll",
        {"action": "comment", "issueId": fid, "side": "b", "text": "API에서 남긴 의견", "voterId": "tester-abcdef"},
    )
    comments = payload.get("poll", {}).get("comments", [])
    check("API: 댓글 저장", status == 200 and any(c.get("text") == "API에서 남긴 의견" for c in comments), str(payload)[:140])
    comment_id = next((c["id"] for c in comments if c.get("text") == "API에서 남긴 의견"), "")
    check("API: 댓글에 진영·익명 태그", all(c.get("side") in ("a", "b") and c.get("tag") for c in comments))
    check("API: 응답에 voterId 노출 없음", "voters" not in json.dumps(payload) and "tester-abcdef" not in json.dumps(payload))

    status, payload = api_json(port, "/api/poll", {"action": "like", "issueId": fid, "commentId": comment_id, "voterId": "tester-abcdef"})
    liked = next((c for c in payload.get("poll", {}).get("comments", []) if c["id"] == comment_id), {})
    check("API: 댓글 공감", status == 200 and liked.get("liked") is True and liked.get("likes") == 1, str(liked))
    status, payload = api_json(port, "/api/poll", {"action": "like", "issueId": fid, "commentId": comment_id, "voterId": "tester-abcdef"})
    unliked = next((c for c in payload.get("poll", {}).get("comments", []) if c["id"] == comment_id), {})
    check("API: 공감 취소", unliked.get("liked") is False and unliked.get("likes") == 0, str(unliked))

    status, payload = api_json(port, f"/api/poll?ids={fid}&voterId=tester-abcdef")
    poll = (payload.get("polls") or {}).get(fid, {})
    check("API: 내 표가 'my'로만 돌아옴", poll.get("my") == "a" and "voters" not in poll, str(poll)[:120])
    check("API: 댓글 목록 함께 조회", len(poll.get("comments") or []) >= 1)

    status, payload = api_json(port, "/api/board")
    check("API: 제거한 /api/board는 404", status == 404)

    # 카드뉴스 표지에 쓰는 기사 사진 통로
    image_issue = next((issue for issue in issues if issue.get("image")), None)
    if image_issue:
        proxied = f"http://127.0.0.1:{port}/api/img?u=" + urllib.parse.quote(image_issue["image"], safe="")
        try:
            with urllib.request.urlopen(proxied, timeout=30) as response:
                body_bytes = response.read()
                check(
                    "API: 기사 사진 프록시(캔버스용)",
                    response.status == 200 and response.headers.get("Content-Type", "").startswith("image/") and len(body_bytes) > 200,
                    f"{response.status} {len(body_bytes)}",
                )
        except Exception as error:  # noqa: BLE001
            check("API: 기사 사진 프록시(캔버스용)", False, str(error)[:100])

    status, payload = api_json(port, "/api/img?u=" + urllib.parse.quote("https://example.com/a.jpg", safe=""))
    check("API: 허용 목록 밖 이미지 주소 차단", status == 400, str(payload)[:80])
    status, payload = api_json(port, "/api/img?u=" + urllib.parse.quote("file:///etc/passwd", safe=""))
    check("API: http(s) 아닌 이미지 주소 차단", status == 400, str(payload)[:80])

    # AI가 JSON을 중간에 끊어 보내도 완성된 카드를 건지는지 (예전엔 0장이 되어 전부 헤드라인으로 내려갔음)
    salvage_script = (
        "import('file://" + str(ROOT / ".tmp" / "trending.js") + "').then((m) => {"
        "const cut = '{\"issues\":[{\"pick\":1,\"hook\":\"가짜 훅 하나\",\"facts\":[\"a\",\"b\"]},"
        "{\"pick\":2,\"hook\":\"가짜 훅 둘\",\"facts\":[\"c\",\"d\"]},{\"pick\":3,\"hook\":\"잘린 카드\"';"
        "const out = m.salvageIssues(cut); console.log(JSON.stringify(out)); });"
    )
    try:
        result = subprocess.run(
            ["node", "--input-type=module", "-e", salvage_script],
            cwd=ROOT,
            env=ENV,
            capture_output=True,
            text=True,
            timeout=30,
        )
        salvaged = json.loads(result.stdout.strip().splitlines()[-1]) if result.stdout.strip() else []
        check("API: 잘린 AI 응답에서도 완성된 카드 복구", len(salvaged) == 2, f"{len(salvaged)}장 / {result.stderr[:80]}")
    except Exception as error:  # noqa: BLE001
        check("API: 잘린 AI 응답에서도 완성된 카드 복구", False, str(error)[:100])

    state = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/__state", timeout=10))
    keys = list((state.get("redis") or {}).keys())
    card_keys = [key for key in keys if key.startswith("issue-thermo:issue:v3:")]
    check("API: 공유 카드를 카드별로 따로 보관(캐시가 바뀌어도 열림)", len(card_keys) >= 4, str(keys[:5]))
    check("API: 투표·댓글 집계 키 저장", any(key.startswith("issue-thermo:polls:") for key in keys), str(keys[:5]))


# ------------------------------------------------------------------- main

def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    # 이번 실행에서 다시 만들지 않은 예전 스크린샷은 마지막에 지웁니다.
    # (중간에 브라우저가 죽어도 이미 있던 스크린샷을 잃지 않도록 먼저 지우지 않습니다)
    started_at = time.time()

    if os.environ.get("VERIFY_SKIP_BUILD") == "1":
        print("== 빌드 생략 (VERIFY_SKIP_BUILD=1: 이미 만든 dist 사용) ==")
    else:
        print("== 빌드 ==")
        subprocess.run(["npm", "run", "build"], cwd=ROOT, env=ENV, check=True, stdout=subprocess.DEVNULL)
        subprocess.run(
            ["npx", "vite", "build", "--outDir", "dist-static"],
            cwd=ROOT,
            env={**ENV, "VITE_STATIC_ONLY": "1"},
            check=True,
            stdout=subprocess.DEVNULL,
        )

    port_a, port_d, port_e, port_s = 4191, 4192, 4193, 4194
    servers = []
    try:
        print("== 서버 기동 ==")
        servers.append(start_server(port_a, dist="dist", api="on", store="redis", ai="demo", feeds="on"))
        servers.append(start_server(port_d, dist="dist", api="on", store="memory", ai="off", feeds="on"))
        servers.append(start_server(port_e, dist="dist-static", api="off", store="memory", ai="off", feeds="on"))
        servers.append(start_server(port_s, dist="dist", api="on", store="memory", ai="off", feeds="on", allow_local="off"))

        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--in-process-gpu"])
            try:
                print("== A: 모바일 흐름 ==")
                hook = scenario_mobile(f"http://127.0.0.1:{port_a}/", browser)
                print("== B: 공용 투표·댓글 집계 ==")
                scenario_shared(f"http://127.0.0.1:{port_a}/", browser, hook)
            finally:
                browser.close()

            browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--in-process-gpu"])
            try:
                print("== C: 뉴스로 만들기 ==")
                scenario_briefing(f"http://127.0.0.1:{port_a}/", browser, port_a)
                print("== F: 데스크톱 ==")
                scenario_desktop(f"http://127.0.0.1:{port_a}/", browser)
                print("== G: 크리에이터 작업대 ==")
                scenario_creator(f"http://127.0.0.1:{port_a}/", browser)
                print("== P: 요금제·잠금 ==")
                scenario_plans(f"http://127.0.0.1:{port_a}/", browser)
            finally:
                browser.close()

            browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--in-process-gpu"])
            try:
                print("== D: AI 키 없음 ==")
                scenario_headline_only(port_d, browser)
                poll_engine_checks(port_d)
                print("== E: 정적 배포 ==")
                scenario_static(port_e, browser)
            finally:
                browser.close()

        print("== C: 사설망 차단(배포 설정) ==")
        scenario_ssrf(port_s)

        print("== API 단위 확인 ==")
        api_checks(port_a)
    finally:
        for proc, log in servers:
            stop_server(proc)
            log.close()

    for old in SHOTS.glob("*.png"):
        if re.match(r"^\d", old.name) and old.stat().st_mtime < started_at - 1:
            old.unlink()

    unique_errors = sorted({f"{tag} {text}" for tag, text in console_errors})
    check("콘솔 에러·경고 0", len(unique_errors) == 0, " | ".join(unique_errors[:4]))

    passed = sum(1 for _, ok, _ in checks if ok)
    total = len(checks)
    print(f"\n===== {passed}/{total} checks passed =====")
    if passed != total:
        print("\n실패 목록:")
        for name, ok, detail in checks:
            if not ok:
                print(f"  - {name} {detail}")
        return 1

    print("스크린샷:", ", ".join(sorted(path.name for path in SHOTS.glob("*.png"))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
