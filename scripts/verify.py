#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""이슈온도계 실전형 개조 검증.

세 가지 배포 상황을 실제 서버리스 함수 코드로 그대로 띄워 확인합니다.

  A. 정적 호스팅(GitHub Pages 모양)  — API 없음 → 로컬 체험 모드 + 규칙 요약
  B. 공용 DB + AI 키                — 실시간 공용 DB + 실시간 AI (발행·투표·팩폭이 브라우저를 넘어 공유)
  C. 공용 DB + AI 키 없음            — 실시간 공용 DB + 규칙 요약 폴백

실행: npm run verify  (먼저 `npm run build` 는 스크립트가 직접 합니다)
"""
import os
import json
import re
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "docs" / "screenshots"
NODE_BIN = "/workspace/.tools/node-v22.12.0-linux-x64/bin"
LIBS = "/workspace/.libs/usr/lib/x86_64-linux-gnu"

ENV = os.environ.copy()
if Path(NODE_BIN).exists():
    ENV["PATH"] = f"{NODE_BIN}:{ENV.get('PATH', '')}"
if Path(LIBS).exists():
    ENV["LD_LIBRARY_PATH"] = f"{LIBS}:{ENV.get('LD_LIBRARY_PATH', '')}"
# 브라우저를 띄우는 것은 이 파이썬 프로세스이므로, 현재 환경에도 같은 라이브러리 경로를 심습니다.
os.environ["LD_LIBRARY_PATH"] = ENV["LD_LIBRARY_PATH"]

SHOTS.mkdir(parents=True, exist_ok=True)

checks: list[tuple[str, bool, str]] = []
console_errors: list[str] = []


def check(name: str, passed: bool, detail: str = "") -> None:
    checks.append((name, bool(passed), detail))
    mark = "PASS " if passed else "FAIL "
    print(mark + name + (f" — {detail}" if detail and not passed else ""))


def attach(page, tag: str) -> dict:
    """콘솔 오류 수집. 일부러 네트워크를 끊는 구간은 태그를 바꿔 따로 셉니다."""
    state = {"tag": tag}

    def on_console(msg):
        if msg.type in ("error", "warning"):
            console_errors.append((state["tag"], f"[{msg.type}] {msg.text}"))

    def on_pageerror(error):
        console_errors.append((state["tag"], f"[pageerror] {error}"))

    page.on("console", on_console)
    page.on("pageerror", on_pageerror)
    return state


def settle(page, ms: int = 450) -> None:
    page.wait_for_timeout(ms)
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(120)


def wait_port(port: int, timeout: float = 30.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return
        except OSError:
            time.sleep(0.25)
    raise RuntimeError(f"port {port} did not open")


def serves(dist: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["npx", "vite", "build", "--outDir", dist],
        cwd=ROOT,
        env=ENV,
        check=True,
        capture_output=True,
        text=True,
    )


def build() -> None:
    print("· build: npm run build")
    subprocess.run(["npm", "run", "build"], cwd=ROOT, env=ENV, check=True, capture_output=True, text=True)
    print("· build: 정적 호스팅 번들(dist-static)")
    static_env = {**ENV, "VITE_STATIC_ONLY": "1"}
    subprocess.run(
        ["npx", "vite", "build", "--outDir", "dist-static"],
        cwd=ROOT,
        env=static_env,
        check=True,
        capture_output=True,
        text=True,
    )


SERVERS: list[subprocess.Popen] = []


def free_port(port: int) -> None:
    """이전 실행이 남긴 서버가 포트를 잡고 있으면 정리합니다(작은 환경에서 메모리도 함께 회수)."""
    out = subprocess.run(["ss", "-lptnH", f"sport = :{port}"], capture_output=True, text=True).stdout
    for pid in set(re.findall(r"pid=(\d+)", out)):
        try:
            os.kill(int(pid), signal.SIGKILL)
        except OSError:
            pass
    if out.strip():
        time.sleep(0.6)


def start_server(port: int, *, dist: str, api: str, store: str, ai: str) -> str:
    free_port(port)
    log = ROOT / f".tmp/serve-{port}.log"
    log.parent.mkdir(exist_ok=True)
    handle = open(log, "w")
    proc = subprocess.Popen(
        [
            "node",
            "scripts/serve.mjs",
            "--port",
            str(port),
            f"--dist={dist}",
            f"--api={api}",
            f"--store={store}",
            f"--ai={ai}",
        ],
        cwd=ROOT,
        env=ENV,
        stdout=handle,
        stderr=subprocess.STDOUT,
    )
    SERVERS.append(proc)
    wait_port(port)
    return f"http://127.0.0.1:{port}/"


def stop_servers() -> None:
    for proc in SERVERS:
        proc.terminate()
    for proc in SERVERS:
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    SERVERS.clear()
    # 다음 시나리오가 같은 포트를 쓸 수 있게 잠깐 쉼니다(작은 환경의 프로세스·스레드 한도 안에서 돌리기 위해).
    time.sleep(0.8)


def temp_number(text: str) -> int:
    digits = re.sub(r"\D", "", text)
    return int(digits) if digits else 0


# ---------------------------------------------------------------- scenario A


def scenario_static(base: str, browser) -> None:
    print("\n=== A. 정적 호스팅 (API 없음) ===")
    ctx = browser.new_context(viewport={"width": 1440, "height": 1000}, locale="ko-KR", accept_downloads=True)
    ctx.grant_permissions(["clipboard-read", "clipboard-write"])
    page = ctx.new_page()
    attach(page, "A")
    api_requests: list[str] = []
    page.on("request", lambda r: api_requests.append(r.url) if "/api/" in r.url else None)
    page.goto(base, wait_until="networkidle")
    page.evaluate("localStorage.clear()")
    page.reload(wait_until="networkidle")
    settle(page, 800)

    check("A: 상태 배지 = 로컬 체험 모드", "로컬 체험 모드" in page.get_by_test_id("status-db").inner_text())
    check("A: AI 배지 = 규칙 요약", "규칙 요약" in page.get_by_test_id("status-ai").inner_text())
    check("A: 데모 이슈 12건", page.locator("main article").count() == 12)
    hero = page.locator("section[aria-label='오늘의 최고 온도 이슈']")
    check("A: 히어로 온도 94", temp_number(hero.locator(".nums.serif").first.inner_text()) == 94)
    page.screenshot(path=str(SHOTS / "01-desktop-hero.png"))

    hero.get_by_role("button", name=re.compile("불타는 중")).click()
    settle(page, 600)
    check(
        "A: 히어로 투표 선택",
        hero.get_by_role("button", name=re.compile("불타는 중")).get_attribute("aria-pressed") == "true",
    )
    stored = page.evaluate("JSON.parse(localStorage.getItem('factbomb.board.v2')).myVotes")
    check("A: 투표가 저장됨(v2 스냅샷)", stored.get("luna-beauty-seongsu-popup") == "hot")
    baseline = page.evaluate("JSON.parse(localStorage.getItem('factbomb.board.v2')).votes['luna-beauty-seongsu-popup']")
    check("A: 실제 참여표만 저장(데모 기준값 분리)", baseline == {"hot": 1, "watch": 0, "cool": 0}, str(baseline))
    page.screenshot(path=str(SHOTS / "02-desktop-vote.png"))

    page.locator("h2", has_text="이슈 피드").scroll_into_view_if_needed()
    settle(page, 500)
    page.screenshot(path=str(SHOTS / "03-desktop-feed.png"))
    page.screenshot(path=str(SHOTS / "03b-desktop-feed-full.png"), full_page=True)
    page.evaluate("window.scrollTo(0, 0)")
    settle(page, 300)

    page.get_by_role("button", name=re.compile("^IT·테크")).first.click()
    settle(page, 350)
    check("A: IT 카테고리 3건", page.locator("main article").count() == 3)
    page.get_by_role("button", name=re.compile("^전체")).first.click()
    settle(page, 300)

    page.locator("main article h3").first.click()
    page.wait_for_url(re.compile(r"#/issue/"))
    settle(page, 600)
    check("A: 상세 30초 요약", page.get_by_text("30초 요약").count() == 1)
    check("A: 상세 업계인 속마음", page.get_by_text("PR·업계인 속마음").count() == 1)

    box = page.get_by_label("한 줄 팩폭 남기기")
    box.click()
    box.fill("재고표를 먼저 공개했으면 줄도 이렇게 안 길었겠다.")
    page.get_by_role("button", name="등록").click()
    settle(page, 500)
    check("A: 내 팩폭이 '나 · 익명'으로 보임", page.get_by_text(re.compile("나 · 익명")).count() >= 1)
    check("A: 팩폭 27개(기존 26 + 내 1)", len(page.evaluate("JSON.parse(localStorage.getItem('factbomb.board.v2')).comments")) == 27)
    page.screenshot(path=str(SHOTS / "04-desktop-detail.png"))
    page.screenshot(path=str(SHOTS / "04b-desktop-detail-full.png"), full_page=True)
    first_like = page.get_by_role("button", name="이 팩폭에 좋아요").first
    first_like.click()
    settle(page, 300)
    check("A: 팩폭 좋아요 토글", first_like.get_attribute("aria-pressed") == "true")
    page.locator("h3", has_text="한 줄 팩폭 배틀").scroll_into_view_if_needed()
    settle(page, 300)
    page.screenshot(path=str(SHOTS / "05-desktop-comment.png"))


    # 공유 카드 + 링크
    page.get_by_role("button", name="이 온도로 공유 카드 만들기").click()
    page.wait_for_selector("img[alt*='공유 카드 미리보기']", timeout=15000)
    settle(page, 600)
    src = page.locator("img[alt*='공유 카드 미리보기']").get_attribute("src") or ""
    check("A: 공유 카드 PNG 렌더", src.startswith("data:image/png") and len(src) > 40000)
    link_text = page.locator("p[title^='http']").first.get_attribute("title") or ""
    check("A: 공유 링크가 ?issue= 형식", "?issue=" in link_text, link_text)
    page.get_by_role("button", name="이슈 링크 복사").click()
    settle(page, 400)
    clip = page.evaluate("navigator.clipboard.readText()")
    check("A: 링크 클립보드 복사", clip.strip() == link_text.strip(), clip)
    page.get_by_role("button", name=re.compile("요약 \\+ 링크 텍스트 복사")).click()
    settle(page, 400)
    clip_text = page.evaluate("navigator.clipboard.readText()")
    check("A: 요약+링크 텍스트 복사", "이슈온도계에서 투표하기" in clip_text and "1. " in clip_text)
    page.screenshot(path=str(SHOTS / "06-desktop-share.png"))
    page.get_by_role("button", name=re.compile("정사각")).click()
    settle(page, 900)
    check("A: 정사각 카드 전환", page.get_by_role("button", name=re.compile("정사각")).get_attribute("aria-pressed") == "true")
    page.screenshot(path=str(SHOTS / "07-desktop-share-square.png"))
    page.get_by_role("button", name="닫기").click()
    settle(page, 300)

    shared_id = page.url.split("#/issue/")[-1]

    # 랭킹 페이지 회귀
    page.get_by_role("button", name="팩폭 랭킹").first.click()
    page.wait_for_url(re.compile(r"#/ranking"))
    settle(page, 700)
    check("A: 랭킹 페이지 포디움", page.locator("article").count() >= 1)
    podium = page.locator("article").first.inner_text()
    check("A: 랭킹 1위 = 328 좋아요 팩폭", "구독료 내고" in podium and "328" in podium, podium[:60])
    check("A: 랭킹 목록 20건 이상", page.locator("ol li").count() >= 20)
    page.screenshot(path=str(SHOTS / "08-desktop-ranking.png"))
    page.get_by_role("button", name="뉴스룸으로").first.click()
    settle(page, 500)


    # 편집기: AI 버튼 → 규칙 요약 폴백
    page.get_by_role("button", name="에디터 스튜디오").first.click()
    page.wait_for_url(re.compile(r"#/editor"))
    settle(page, 500)
    page.get_by_role("button", name="예시 메모 넣기").click()
    page.get_by_role("button", name=re.compile("AI로 팩폭 초안 생성")).click()
    settle(page, 700)
    check("A: AI 없이도 초안 생성(규칙 요약 배지)", "규칙 요약" in page.get_by_test_id("draft-panel").inner_text())
    check("A: 헤드라인 채움", "페이퍼백" in page.locator("#headline").input_value())
    check(
        "A: 3줄 요약 채움",
        all(len(page.locator("textarea").nth(i).input_value()) > 5 for i in range(3)),
    )
    check("A: 폴백 사유 안내", "AI 키가 없어" in page.get_by_test_id("draft-panel").inner_text())
    check("A: 정적 빌드는 /api 요청을 보내지 않음", not api_requests, str(api_requests[:3]))
    page.screenshot(path=str(SHOTS / "09-desktop-editor.png"), full_page=True)

    page.get_by_role("button", name="지금 발행하기").click()
    page.wait_for_url(re.compile(r"#/issue/issue-"), timeout=10000)
    settle(page, 600)
    check("A: 발행 후 상세 열림", "페이퍼백" in page.locator("h1").first.inner_text())
    check("A: 방금 발행 배지", page.get_by_text("방금 발행").count() >= 1)

    page.screenshot(path=str(SHOTS / "10-desktop-published.png"))
    aside = page.locator("aside")
    before = temp_number(page.locator("aside .nums.serif").first.inner_text())
    aside.get_by_role("button", name=re.compile("불타는 중")).click()
    settle(page, 700)
    after = temp_number(page.locator("aside .nums.serif").first.inner_text())
    check("A: 새 이슈 첫 투표에 온도가 움직임", after != before, f"{before} → {after}")
    page.screenshot(path=str(SHOTS / "11-desktop-published-vote.png"))

    page.reload(wait_until="networkidle")
    settle(page, 600)
    check("A: 새로고침 후에도 발행 이슈 유지", "페이퍼백" in page.locator("h1").first.inner_text())

    # ?issue= 파라미터로 상세 열기
    open_page = ctx.new_page()
    attach(open_page, "A-share")
    open_page.goto(f"{base}?issue={shared_id}", wait_until="networkidle")
    settle(open_page, 700)
    check("A: 공유 링크(?issue=)로 상세 열림", open_page.get_by_text("30초 요약").count() == 1)
    open_page.close()

    # 모바일 390
    mctx = browser.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=1,
        locale="ko-KR",
        is_mobile=True,
        has_touch=True,
    )
    mp = mctx.new_page()
    attach(mp, "A-mobile")
    mp.goto(base, wait_until="networkidle")
    settle(mp, 700)
    check(
        "A: 모바일 390 가로 넘침 없음(피드)",
        mp.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
    )
    check(
        "A: 모바일 상태 배지 잘림 없음",
        mp.evaluate("document.querySelector('[data-testid=status-db]').getBoundingClientRect().right <= window.innerWidth + 1"),
    )
    mp.screenshot(path=str(SHOTS / "13-mobile-feed.png"), full_page=True)
    mp.locator("main article h3").first.click()
    settle(mp, 600)
    check(
        "A: 모바일 390 가로 넘침 없음(상세)",
        mp.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
    )
    mp.screenshot(path=str(SHOTS / "14-mobile-detail.png"))
    mp.get_by_role("button", name="에디터 스튜디오").last.click()
    settle(mp, 500)
    check(
        "A: 모바일 390 가로 넘침 없음(편집기)",
        mp.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
    )
    mp.screenshot(path=str(SHOTS / "16-mobile-editor.png"), full_page=True)
    mp.get_by_role("button", name="팩폭 랭킹").last.click()
    settle(mp, 500)
    mp.screenshot(path=str(SHOTS / "15-mobile-ranking.png"))
    mctx.close()

    # 태블릿 1024
    page.set_viewport_size({"width": 1024, "height": 820})
    page.get_by_role("button", name="뉴스룸").first.click()
    settle(page, 600)
    page.locator("h2", has_text="이슈 피드").scroll_into_view_if_needed()
    page.evaluate("window.scrollBy(0, -120)")
    settle(page, 400)
    check(
        "A: 태블릿 1024 가로 넘침 없음",
        page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
    )
    page.screenshot(path=str(SHOTS / "12-tablet-feed.png"))
    ctx.close()


# ---------------------------------------------------------------- scenario B


def scenario_shared(base: str, browser) -> None:
    print("\n=== B. 공용 DB + 실시간 AI ===")
    ctx = browser.new_context(viewport={"width": 1440, "height": 1000}, locale="ko-KR")
    page = ctx.new_page()
    console_state = attach(page, "B")
    page.goto(base, wait_until="networkidle")
    settle(page, 900)

    check("B: 상태 배지 = 실시간 공용 DB", "실시간 공용 DB" in page.get_by_test_id("status-db").inner_text())
    check("B: AI 배지 = 실시간 AI", "실시간 AI" in page.get_by_test_id("status-ai").inner_text())

    page.get_by_role("button", name="에디터 스튜디오").first.click()
    page.wait_for_url(re.compile(r"#/editor"))
    settle(page, 400)
    page.get_by_role("button", name="예시 메모 넣기").click()
    page.get_by_role("button", name=re.compile("AI로 팩폭 초안 생성")).click()
    page.wait_for_selector("[data-testid=draft-panel]", timeout=20000)
    settle(page, 500)

    panel = page.get_by_test_id("draft-panel").inner_text()
    check("B: AI 초안 배지", "실시간 AI" in panel)
    check("B: 한 줄 팩폭 반영", "무료로 키운 이용자" in page.locator("#kicker").input_value())
    check("B: 헤드라인 AI 결과", "수수료 1.8%" in page.locator("#headline").input_value())
    check("B: 3줄 요약 AI 결과", "1.8%에서 1.8%로" in "".join(page.locator("textarea").nth(i).input_value() for i in range(3)) or "가맹점" in page.locator("textarea").nth(1).input_value())
    check("B: 속마음 2건 노출", panel.count("업계인 속마음 2건") == 1)
    check("B: 찬반 포인트 노출", "찬성 쪽 논리" in panel and "반대 쪽 논리" in panel)
    page.screenshot(path=str(SHOTS / "17-desktop-editor-ai.png"), full_page=True)

    # 두 번째 속마음으로 교체
    insider_buttons = page.locator("[data-testid=draft-panel] button[aria-pressed]")
    check("B: 속마음 선택 버튼 2개", insider_buttons.count() == 2, str(insider_buttons.count()))
    if insider_buttons.count() == 2:
        insider_buttons.nth(1).click()
        settle(page, 300)
        check("B: 속마음 B 선택 반영", "이탈 속도" in page.locator("#insider").input_value())

    page.get_by_role("button", name="지금 발행하기").click()
    page.wait_for_url(re.compile(r"#/issue/issue-"), timeout=15000)
    settle(page, 700)
    headline = page.locator("h1").first.inner_text()
    issue_id = page.url.split("#/issue/")[-1]
    check("B: 발행 후 상세 열림", "수수료" in headline, headline)
    check("B: 찬반 포인트 카드 게시", page.get_by_test_id("debate-card").count() == 1)
    check("B: 두 번째 속마음 게시", page.get_by_text("같은 이슈, 다른 시각").count() == 1)
    check("B: 동기화 대기 없음", page.get_by_test_id("status-pending").count() == 0)
    page.screenshot(path=str(SHOTS / "18-desktop-shared-detail.png"), full_page=True)

    # 서버에 실제로 저장됐는지 (다른 브라우저에서 확인)
    ctx2 = browser.new_context(viewport={"width": 1280, "height": 900}, locale="ko-KR")
    page2 = ctx2.new_page()
    attach(page2, "B-other")
    page2.goto(f"{base}?issue={issue_id}", wait_until="networkidle")
    settle(page2, 900)
    check("B: 다른 브라우저에서 공유 링크로 열림", "수수료" in page2.locator("h1").first.inner_text())
    check("B: 다른 브라우저도 공용 DB 표시", "실시간 공용 DB" in page2.get_by_test_id("status-db").inner_text())

    page2.locator("aside").get_by_role("button", name=re.compile("불타는 중")).click()
    settle(page2, 800)
    check("B: 다른 브라우저 투표 반영", "내 선택" in page2.locator("aside").inner_text())
    box2 = page2.get_by_label("한 줄 팩폭 남기기")
    box2.fill("결제망 투자 계획부터 공개했으면 수수료도 이렇게까지 안 올랐다.")
    page2.get_by_role("button", name="등록").click()
    settle(page2, 900)

    # 원래 브라우저에서 새로고침 → 다른 사람의 표·팩폭이 보인다
    page.get_by_role("button", name="공용 보드 새로고침").click()
    settle(page, 1200)
    check("B: 공용 보드 새로고침 후 팩폭 보임", "결제망 투자 계획" in page.locator("body").inner_text())
    check("B: 남의 팩폭은 '나 ·'로 표시되지 않음", page.get_by_text(re.compile("나 · 익명")).count() == 0)
    page.screenshot(path=str(SHOTS / "19-desktop-synced.png"), full_page=True)

    # 데모 이슈의 기준값은 두 브라우저에서 동일하게 보인다
    page.get_by_role("button", name="뉴스룸").first.click()
    settle(page, 700)
    hero_a = temp_number(page.locator("section[aria-label='오늘의 최고 온도 이슈'] .nums.serif").first.inner_text())
    check("B: 데모 이슈 기준 온도 유지(94)", hero_a >= 90, str(hero_a))

    # ── 무중단 폴백: 서버가 잠깐 죽어도 발행은 기기에 남고, 연결되면 자동으로 다시 올라간다
    def block_posts(route):
        if route.request.method == "POST":
            route.abort()
        else:
            route.continue_()

    console_state["tag"] = "B-offline"  # 일부러 POST를 끊는 구간
    page.route("**/api/board", block_posts)
    page.get_by_role("button", name="에디터 스튜디오").first.click()
    settle(page, 350)
    page.get_by_role("button", name="예시 메모 넣기").click()
    page.get_by_role("button", name=re.compile("AI로 팩폭 초안 생성")).click()
    page.wait_for_selector("[data-testid=draft-panel]", timeout=15000)
    settle(page, 400)
    page.get_by_role("button", name="지금 발행하기").click()
    page.wait_for_url(re.compile(r"#/issue/issue-"), timeout=15000)
    settle(page, 800)
    pending_badge = page.get_by_test_id("status-pending")
    check("B: 서버 장애 시 '동기화 대기' 표시", pending_badge.count() == 1)
    check("B: 장애 안내 토스트", "서버에 닿지 않아" in page.get_by_role("status").inner_text())
    check("B: 장애 중에도 이슈는 화면에 있음", "수수료" in page.locator("h1").first.inner_text())
    offline_id = page.url.split("#/issue/")[-1]
    page.unroute("**/api/board", block_posts)
    console_state["tag"] = "B"
    page.wait_for_function("!document.querySelector('[data-testid=status-pending]')", timeout=30000)
    check("B: 연결되면 자동 재전송(대기 0)", page.get_by_test_id("status-pending").count() == 0)

    ctx3 = browser.new_context(viewport={"width": 1280, "height": 900}, locale="ko-KR")
    page3 = ctx3.new_page()
    attach(page3, "B-retry")
    page3.goto(f"{base}?issue={offline_id}", wait_until="networkidle")
    settle(page3, 900)
    check("B: 재전송된 이슈가 공용 보드에 존재", "수수료" in page3.locator("h1").first.inner_text())
    ctx3.close()
    ctx2.close()
    ctx.close()


# ---------------------------------------------------------------- scenario C


def scenario_no_key(base: str, browser) -> None:
    print("\n=== C. 공용 DB + AI 키 없음 ===")
    ctx = browser.new_context(viewport={"width": 1280, "height": 900}, locale="ko-KR")
    page = ctx.new_page()
    attach(page, "C")
    page.goto(base, wait_until="networkidle")
    settle(page, 800)

    check("C: 상태 배지 = 실시간 공용 DB", "실시간 공용 DB" in page.get_by_test_id("status-db").inner_text())
    check("C: AI 배지 = 규칙 요약", "규칙 요약" in page.get_by_test_id("status-ai").inner_text())

    page.get_by_role("button", name="에디터 스튜디오").first.click()
    settle(page, 400)
    page.get_by_role("button", name="예시 메모 넣기").click()
    page.get_by_role("button", name=re.compile("AI로 팩폭 초안 생성")).click()
    page.wait_for_selector("[data-testid=draft-panel]", timeout=15000)
    settle(page, 400)
    panel = page.get_by_test_id("draft-panel").inner_text()
    check("C: 규칙 요약으로 폴백", "규칙 요약" in panel and "실시간 AI ·" not in panel)
    check("C: 폴백 사유 표시", "AI 키" in panel or "키가 없" in panel, panel[:120])
    check("C: 폴백 결과 헤드라인", "페이퍼백" in page.locator("#headline").input_value())
    page.screenshot(path=str(SHOTS / "20-desktop-editor-fallback.png"), full_page=True)

    # 서버 함수 자체도 키가 없으면 501 no_key 로 정직하게 답한다(앱은 이 경로를 부르지 않고 규칙 요약으로 간다)
    resp = ctx.request.post(
        f"{base}api/briefing",
        data={"body": "가맹점 수수료를 1.2%에서 1.8%로 올린 결제사 이야기. 투자 계획은 공개하지 않았다."},
    )
    body = resp.json()
    check("C: /api/briefing 501 no_key", resp.status == 501 and body.get("error") == "no_key", f"{resp.status} {body}")
    board = ctx.request.get(f"{base}api/board?voterId=vtest000000")
    board_body = board.json()
    check(
        "C: /api/board 모드 = shared/redis",
        board.status == 200 and board_body.get("mode") == "shared" and board_body.get("store") == "redis",
        str(board_body)[:150],
    )
    ctx.close()


def scenario_gemini(base: str, browser) -> None:
    print("\n=== D. 무료 Gemini 키(AQ.…) 실시간 AI ===")
    ctx = browser.new_context(viewport={"width": 1440, "height": 1000}, locale="ko-KR")
    page = ctx.new_page()
    attach(page, "D")
    page.goto(base, wait_until="networkidle")
    settle(page, 900)

    check("D: 상태 배지 = 실시간 공용 DB", "실시간 공용 DB" in page.get_by_test_id("status-db").inner_text())
    check("D: AI 배지 = 실시간 AI", "실시간 AI" in page.get_by_test_id("status-ai").inner_text())

    health = ctx.request.get(f"{base}api/briefing").json()
    check("D: /api/briefing provider=gemini", health.get("provider") == "gemini" and health.get("ai") is True, str(health)[:160])
    check("D: /api/briefing 기본 모델 gemini-3.8-flash", health.get("model") == "gemini-3.8-flash", str(health)[:160])
    check("D: 키 값은 내려오지 않음", "AQ.local-test-key" not in str(health), str(health)[:160])

    page.get_by_role("button", name="에디터 스튜디오").first.click()
    page.wait_for_url(re.compile(r"#/editor"))
    settle(page, 400)
    page.get_by_role("button", name="예시 메모 넣기").click()
    page.get_by_role("button", name=re.compile("AI로 팩폭 초안 생성")).click()
    page.wait_for_selector("[data-testid=draft-panel]", timeout=20000)
    settle(page, 500)
    panel = page.get_by_test_id("draft-panel").inner_text()
    check("D: AI 초안 배지", "실시간 AI" in panel, panel[:120])
    check("D: 헤드라인 AI 결과", "수수료 1.8%" in page.locator("#headline").input_value())
    check("D: 한 줄 팩폭 AI 결과", "무료로 키운 이용자" in page.locator("#kicker").input_value())
    check("D: thought 파트 섞이지 않음", "JSON 객체를 만들어야" not in page.locator("#headline").input_value())
    page.screenshot(path=str(SHOTS / "21-desktop-editor-gemini.png"), full_page=True)

    # 서버가 실제로 Gemini 규격으로 보냈는지
    state = ctx.request.get(f"{base}__state").json()
    sent = state.get("geminiRequest") or {}
    check("D: 모델 경로 gemini-3.8-flash", sent.get("model") == "gemini-3.8-flash", str(sent.get("model")))
    check("D: x-goog-api-key 헤더로 키 전달", sent.get("headerKey") == "AQ.local-test-key", str(sent.get("headerKey")))
    check("D: ?key=로도 키 전달", sent.get("queryKey") == "AQ.local-test-key", str(sent.get("queryKey")))
    body = sent.get("body") or {}
    check(
        "D: systemInstruction 전달",
        "수석 에디터" in json.dumps(body.get("systemInstruction", {}), ensure_ascii=False),
    )
    check(
        "D: generationConfig = JSON 모드",
        (body.get("generationConfig") or {}).get("responseMimeType") == "application/json",
        json.dumps(body.get("generationConfig"), ensure_ascii=False)[:160],
    )
    check(
        "D: 온도 0.4",
        (body.get("generationConfig") or {}).get("temperature") == 0.4,
        json.dumps(body.get("generationConfig"), ensure_ascii=False)[:160],
    )
    prompt_text = json.dumps(body.get("contents", []), ensure_ascii=False)
    check("D: 본문이 프롬프트에 포함", "가맹점" in prompt_text, prompt_text[:160])
    ctx.close()


def main() -> int:
    build()
    # 서버는 시나리오 하나씩 띄우고 내립니다(좁은 환경에서 node 서버 4개 + chromium이 동시에 뜨면 스레드 한도에 걸립니다).
    plan = [
        ("A", dict(port=4185, dist="dist-static", api="off", store="memory", ai="off"), scenario_static),
        ("B", dict(port=4186, dist="dist", api="on", store="redis", ai="on"), scenario_shared),
        ("D", dict(port=4188, dist="dist", api="on", store="redis", ai="gemini"), scenario_gemini),
        ("C", dict(port=4187, dist="dist", api="on", store="redis", ai="off"), scenario_no_key),
    ]
    only = next((a.split("=", 1)[1] for a in sys.argv[1:] if a.startswith("--only=")), "")
    try:
        with sync_playwright() as p:
            for name, server_args, scenario in plan:
                if only and only.upper() != name:
                    continue
                base = start_server(server_args["port"], **{k: v for k, v in server_args.items() if k != "port"})
                browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"])
                try:
                    scenario(base, browser)
                finally:
                    browser.close()
                    stop_servers()
    finally:
        stop_servers()

    passed = sum(1 for _, ok, _ in checks if ok)
    # B-offline 구간은 일부러 POST를 abort시킨 실험이므로 그 구간의 ERR_FAILED만 제외합니다.
    real_errors = [
        (tag, text)
        for tag, text in console_errors
        if not (tag == "B-offline" and "net::ERR_FAILED" in text)
    ]
    print(f"\n{passed}/{len(checks)} checks passed")
    print(f"CONSOLE ERRORS: {len(real_errors)} (의도적으로 끊은 오프라인 구간 {len(console_errors) - len(real_errors)}건 제외)")
    for tag, text in real_errors:
        print(f"  [{tag}] {text}")
    return 0 if passed == len(checks) and not real_errors else 1


if __name__ == "__main__":
    sys.exit(main())
