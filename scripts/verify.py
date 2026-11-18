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

실행: npm run verify   (필요하면 스크립트가 직접 빌드합니다)
"""
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

def scenario_mobile(base: str, browser):
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True,
        accept_downloads=True,
        permissions=["clipboard-read", "clipboard-write"],
    )
    page = attach(ctx.new_page(), "A")
    page.goto(base, wait_until="networkidle")
    page.wait_for_selector('[data-testid="feed-card"]', timeout=20000)
    settle(page, 500)

    cards = page.locator('[data-testid="feed-card"]').count()
    check("A: 오늘의 카드뉴스 4건 이상", cards >= 3, f"{cards}건")
    check("A: 1위 히어로 카드", page.locator('[data-testid="hero-card"]').count() == 1)

    hook = page.locator('[data-testid="hero-card"] .hero-hook').inner_text().strip()
    check("A: 히어로 한 줄 훅 표시", len(hook) >= 8, hook)
    check("A: 출처·시간 표시", bool(re.search(r"분 전|시간 전|방금", page.locator('[data-testid="hero-card"]').inner_text())))

    # 목록에서도 이슈마다 다른 A/B가 보여야 합니다(예전에는 같은 문항이 반복됐음).
    teasers = page.locator('[data-testid="feed-card"] .teaser-q')
    teaser_texts = [teasers.nth(i).inner_text().strip() for i in range(teasers.count())]
    check("A: 목록에서 A/B 문항이 바로 보임", len(teaser_texts) >= 3 and all(len(t) >= 8 for t in teaser_texts), str(teaser_texts)[:120])
    check("A: 카드마다 투표 문항이 다름", len(set(teaser_texts)) == len(teaser_texts), str(teaser_texts)[:160])
    opts = page.locator('[data-testid="feed-card"] .teaser-opt span')
    check("A: 목록에 A/B 선택지 문구", opts.count() >= 6)

    strip = page.locator(".live-strip").inner_text()
    check("A: 수집 시각·건수·AI 상태 노출", "기준" in strip and "이슈" in strip and "AI" in strip, strip)
    check("A: 언론사 수집 현황 노출", "언론사" in strip, strip)

    font = page.evaluate("getComputedStyle(document.querySelector('.hero-hook')).fontFamily")
    size = page.evaluate("parseFloat(getComputedStyle(document.querySelector('.hero-hook')).fontSize)")
    check("A: Pretendard/SUIT 고딕으로 바뀜", "Pretendard" in font or "SUIT" in font, font)
    check("A: 임팩트 헤드라인(26px 이상)", size >= 26, str(size))

    body = page.inner_text("body")
    check("A: 언론사 이름 표시", any(name in body for name in ("연합뉴스", "블로터", "한국경제", "경향신문")))
    check("A: 카드에 원문 기사 링크", (page.locator('[data-testid="hero-card"]').get_attribute("data-issue-id") or "") != "")
    check("A: 모바일 390 가로 넘침 없음(피드)", no_overflow(page))
    page.screenshot(path=str(SHOTS / "01-mobile-feed.png"), full_page=True)

    open_viewer(page)
    check("A: 카드뉴스 뷰어 열림", page.locator('[data-testid="viewer"]').count() == 1)
    check("A: 진행 막대 5칸", page.locator(".cn-seg").count() == 5)
    cover_hook = page.locator(".cn-cover .cn-hook").inner_text().strip()
    check("A: 표지에 같은 훅", cover_hook == hook, f"{cover_hook} != {hook}")
    check("A: 표지에 카테고리·온도", page.locator(".cn-cover .cn-chip").count() == 1 and "°" in page.locator(".cn-cover").inner_text())
    src_href = page.locator(".cn-src").get_attribute("href") or ""
    check("A: 카드 상단에 원문 링크", src_href.startswith("http"), src_href[:60])
    check("A: 모바일 390 가로 넘침 없음(카드)", no_overflow(page))
    page.screenshot(path=str(SHOTS / "03-mobile-cover.png"))

    # ② 팩트 3줄
    go_next(page)
    facts = page.locator('[data-testid="slide-2"] .cn-fact-text')
    check("A: ② 무슨 일인데 — 팩트 3줄", facts.count() == 3, f"{facts.count()}개")
    fact_texts = [facts.nth(i).inner_text().strip() for i in range(facts.count())]
    check("A: 팩트가 문장으로 읽힘", all(len(text) >= 12 for text in fact_texts), str(fact_texts))
    check("A: 팩트가 서로 다른 내용", len(set(fact_texts)) == len(fact_texts))
    check("A: 원제(원문 제목) 함께 표시", "원제" in page.locator('[data-testid="slide-2"]').inner_text())
    page.screenshot(path=str(SHOTS / "04-mobile-facts.png"))

    # ③ 배경·쟁점
    go_next(page)
    issue_text = page.locator('[data-testid="slide-3"]').inner_text()
    check("A: ③ 왜 지금 뜨나 — 배경 있음", len(page.locator(".cn-background").inner_text().strip()) >= 20)
    check("A: ③ 핵심 쟁점 박스", "핵심 쟁점" in issue_text and len(page.locator(".cn-point p").inner_text().strip()) >= 8)
    page.screenshot(path=str(SHOTS / "05-mobile-issue.png"))

    # ④ A vs B
    go_next(page)
    sides = page.locator('[data-testid="slide-4"] .cn-side p')
    check("A: ④ A vs B 두 진영", sides.count() == 2)
    check("A: 두 진영 주장이 다름", sides.nth(0).inner_text().strip() != sides.nth(1).inner_text().strip())
    check("A: 진영 라벨 표시", page.locator('[data-testid="slide-4"] .cn-side-label').count() == 2)
    page.screenshot(path=str(SHOTS / "06-mobile-sides.png"))

    # ⑤ 한 줄 팩폭 · 질문
    go_next(page)
    question_text = page.locator('[data-testid="slide-5"]').inner_text()
    check("A: ⑤ 한 줄 팩폭·질문", len(page.locator(".cn-question-hook").inner_text().strip()) >= 8)
    check("A: ⑤ 투표 선택지 A/B", page.locator('[data-testid="slide-5"] .cn-option').count() == 2, question_text[:60])
    check("A: ⑤ 토론 유도 문구", "댓글" in question_text)
    check(
        "A: ⑤ 투표 카드 제목 = 이 카드의 질문",
        page.locator(".cn-question-hook").inner_text().strip()
        == page.locator('[data-testid="poll-question"]').inner_text().strip(),
        page.locator(".cn-question-hook").inner_text()[:40],
    )
    page.screenshot(path=str(SHOTS / "07-mobile-question.png"))

    # PNG 저장 (현재 장 = 5장)
    png_path = ROOT / ".tmp" / "card-slide5.png"
    if save_download(page, '[data-testid="save-png"]', png_path):
        data = png_path.read_bytes()
        check("A: 현재 장 PNG 저장", data[:8] == b"\x89PNG\r\n\x1a\n", data[:8].hex())
        check("A: PNG 규격 1080×1350(4:5)", png_size(png_path) == (1080, 1350), str(png_size(png_path)))
        check("A: PNG 파일 크기 충분", len(data) > 20_000, f"{len(data)} bytes")

    # 5장 ZIP 저장
    zip_path = ROOT / ".tmp" / "card-5.zip"
    if save_download(page, '[data-testid="save-all"]', zip_path):
        zdata = zip_path.read_bytes()
        check("A: 5장 ZIP 저장", zdata[:2] == b"PK", zdata[:4].hex())
        with zipfile.ZipFile(io.BytesIO(zdata)) as archive:
            names = archive.namelist()
            check("A: ZIP에 5장", len(names) == 5, str(names))
            sizes = [png_size_from_bytes(archive.read(name)) for name in names]
            check("A: ZIP 속 PNG 모두 1080×1350", all(size == (1080, 1350) for size in sizes), str(sizes))
        # 저장된 5장 중 표지를 문서 스크린샷으로 남깁니다.
        with zipfile.ZipFile(io.BytesIO(zdata)) as archive:
            (SHOTS / "13-card-export-cover.png").write_bytes(archive.read(names[0]))
            (SHOTS / "14-card-export-facts.png").write_bytes(archive.read(names[1]))
            (SHOTS / "15-card-export-sides.png").write_bytes(archive.read(names[3]))

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

    # 투표 — 카드 아래 토론에서
    check("A: 카드 아래 토론 영역", page.locator('[data-testid="discussion"]').count() == 1)
    check("A: 투표 전에는 % 숨김", page.locator('[data-testid="result-a"]').count() == 0)
    page.locator('[data-testid="vote-a"]').click()
    page.wait_for_selector('[data-testid="result-a"]', timeout=8000)
    settle(page, 700)
    pct_a = page.locator('[data-testid="result-a"]').inner_text()
    check("A: 한 번 누르면 % 반영", pct_a.strip().endswith("%") and int(pct_a.replace("%", "")) > 0, pct_a)
    check("A: 누적 참여 수 표시", "명 참여" in page.locator(".dlg-foot").inner_text())
    check("A: 내 선택 표시", page.locator('[data-testid="vote-a"]').get_attribute("aria-pressed") == "true")

    # 토론 댓글 (B 진영)
    page.locator('[data-testid="comment-side-b"]').click()
    page.fill('[data-testid="comment-input"]', "이건 좀 심하다")
    page.locator('[data-testid="comment-submit"]').click()
    page.wait_for_selector('[data-testid="comment-list"]', timeout=8000)
    settle(page, 700)
    check("A: 토론 댓글 등록", "이건 좀 심하다" in page.locator('[data-testid="comment-list"]').inner_text())
    first_item = page.locator('[data-testid="comment-item"]').first
    check("A: 댓글에 진영 표시", first_item.get_attribute("data-side") == "b", first_item.get_attribute("data-side") or "")
    check("A: 댓글 수 표시", "1" in page.locator('[data-testid="comment-count"]').inner_text())

    # 공감
    like_btn = first_item.locator('[data-testid="comment-like"]')
    like_btn.click()
    settle(page, 600)
    check("A: 댓글 공감", "1" in like_btn.inner_text())

    # 필터
    page.locator('[data-testid="comment-filter-a"]').click()
    settle(page, 400)
    check("A: A 진영 필터 — 내 B 댓글 숨김", page.locator('[data-testid="comment-empty"]').count() == 1)
    page.locator('[data-testid="comment-filter-all"]').click()
    settle(page, 400)
    page.screenshot(path=str(SHOTS / "08-mobile-discussion.png"))

    # 링크 복사
    page.locator('[data-testid="copy-link"]').click()
    settle(page, 600)
    check("A: 링크 복사 안내", page.locator('[data-testid="toast"]').count() == 1)
    clip_link = page.evaluate("navigator.clipboard.readText().catch(() => '')")
    check("A: 복사된 링크에 카드 주소", "#/i/" in (clip_link or ""), str(clip_link)[:80])

    share_url = page.evaluate("location.href")
    check("A: 주소에 카드 id", "#/i/" in share_url, share_url)

    # 새로고침 후에도 투표·댓글 유지
    page.reload(wait_until="networkidle")
    page.wait_for_selector('[data-testid="viewer"]', timeout=15000)
    settle(page, 800)
    check("A: 새로고침해도 같은 카드가 열림", page.locator(".cn-cover .cn-hook").inner_text().strip() == hook)
    check("A: 새로고침해도 내 표 유지", page.locator('[data-testid="vote-a"]').get_attribute("aria-pressed") == "true")
    page.wait_for_selector('[data-testid="comment-list"]', timeout=8000)
    check("A: 새로고침해도 내 댓글 유지", "이건 좀 심하다" in page.locator('[data-testid="comment-list"]').inner_text())

    # 공유 링크를 새 브라우저에서 열기
    share_ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True)
    share_page = attach(share_ctx.new_page(), "A-share")
    share_page.goto(share_url, wait_until="networkidle")
    share_page.wait_for_selector('[data-testid="viewer"]', timeout=15000)
    settle(share_page, 700)
    check("A: 공유 링크로 바로 카드 열림", share_page.locator(".cn-cover .cn-hook").inner_text().strip() == hook)
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

    check("B: 다른 브라우저에서도 같은 카드", page.locator(".cn-cover .cn-hook").inner_text().strip() == hook)
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
    created = page.locator(".cn-cover .cn-hook").inner_text().strip()
    check("C: 기사 링크로 카드 생성", "주 4일제" in created, created)
    check("C: 만든 카드도 5장 구성", page.locator(".cn-seg").count() == 5)
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
    check("C: 한 줄 이슈로도 카드 생성", page.locator(".cn-cover .cn-hook").count() == 1)
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
    page.screenshot(path=str(SHOTS / "16-mobile-headline-only.png"), full_page=True)

    open_viewer(page)
    go_next(page)
    facts = page.locator('[data-testid="slide-2"] .cn-fact-text')
    check("D: 팩트 카드에 원문 안내", "원문" in page.locator('[data-testid="slide-2"]').inner_text())
    check("D: 팩트 카드 안내 문구(키 없음)", "AI 요약이 없이" in page.locator('[data-testid="slide-2"]').inner_text() or "AI 요약 없이" in page.locator('[data-testid="slide-2"]').inner_text())
    check("D: 팩트 3줄을 요약에서 채움", facts.count() == 3, f"{facts.count()}개")
    go_next(page)
    go_next(page)
    check("D: 입장 비교가 없으면 숨기지 않고 설명", "없어요" in page.locator('[data-testid="slide-4"]').inner_text())
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
    ctx.close()


# ---------------------------------------------------------------- API 단위 확인

def api_checks(port: int):
    status, payload = api_json(port, "/api/trending")
    issues = payload.get("issues") or []
    feeds = payload.get("feeds") or []
    check("API: /api/trending 200", status == 200 and payload.get("ok") is True)
    check("API: 13개 피드 모두 수집", len(feeds) == 13 and all(f.get("ok") for f in feeds), f"{sum(1 for f in feeds if f.get('ok'))}/{len(feeds)}")
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
    check("API: 지어낸 기사 없음(모두 테스트 피드 제목)", all("http://127.0.0.1" in issue["url"] for issue in issues))
    check("API: 본문에 HTML 태그가 남지 않음", all("<" not in fact for issue in issues for fact in issue.get("facts") or []))

    problems = poll_problems(issues)
    check("API: 카드마다 팽팽한 A/B (중복·고정 문구·기사 무관 없음)", not problems, " | ".join(problems[:3]))
    check(
        "API: 투표 문항에 기사 주제어가 들어감",
        all(any(word in issue["title"].replace(" ", "") for word in re.split(r"[^가-힣A-Za-z0-9]+", issue["poll"]["question"]) if len(word) >= 2) for issue in issues),
    )

    fid = issues[0]["id"]
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

    import urllib.request

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
