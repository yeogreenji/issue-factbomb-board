#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""카드뉴스 드래그 스와이프 검증 — 손끝·마우스를 따라 '실시간'으로 밀리는지 확인합니다.

  G1. 마우스로 끄는 동안 카드가 손을 실시간으로 따라오는가(중간 프레임 translateX)
  G2. 마우스 드래그로 1/4 → 2/4 → 3/4 이동, 오른쪽으로 되돌리기
  G3. 터치 스와이프(CDP Input.dispatchTouchEvent)로 1/4 → 2/4 → 3/4
  G4. 살짝만 끌면(임계값 미만) 제자리로 돌아오는가
  G5. < / > 버튼과 진행 막대·점 클릭이 여전히 부드럽게 동작하는가
  G6. 모바일 390 가로 넘침 0, 콘솔 에러 0

실행: node 22 + playwright. `python3 scripts/verify-drag.py`
"""
import os
import re
import signal
import socket
import subprocess
import sys
import time
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


def start_server(port: int):
    free_port(port)
    log_path = ROOT / ".tmp" / f"serve-drag-{port}.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log = open(log_path, "w")
    proc = subprocess.Popen(
        ["node", "scripts/serve.mjs", f"--port={port}", "--dist=dist", "--api=on", "--store=memory", "--ai=demo", "--feeds=on"],
        cwd=ROOT,
        env=ENV,
        stdout=log,
        stderr=subprocess.STDOUT,
    )
    wait_port(port)
    return proc, log


def attach(page, tag: str):
    def on_console(msg):
        if msg.type in ("error", "warning"):
            console_errors.append((tag, f"[{msg.type}] {msg.text}"))

    def on_pageerror(error):
        console_errors.append((tag, f"[pageerror] {error}"))

    page.on("console", on_console)
    page.on("pageerror", on_pageerror)
    return page


def translate_x(page) -> float:
    """`.slides` 줄의 현재 translateX(px)."""
    value = page.evaluate("getComputedStyle(document.querySelector('.slides')).transform")
    matrix = re.match(r"matrix\(([^)]+)\)", value)
    if matrix:
        return float(matrix.group(1).split(",")[4])
    matrix3d = re.match(r"matrix3d\(([^)]+)\)", value)
    if matrix3d:
        return float(matrix3d.group(1).split(",")[12])
    return 0.0


def counter(page) -> str:
    return page.locator(".viewer-count").inner_text().strip()


def no_overflow(page) -> bool:
    return page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")


def open_viewer(page, base: str) -> None:
    page.goto(base, wait_until="networkidle")
    page.wait_for_selector('[data-testid="feed-card"]', timeout=20000)
    page.wait_for_timeout(400)
    page.locator('[data-testid="hero-card"] button').click()
    page.wait_for_selector('[data-testid="viewer"]', timeout=8000)
    page.wait_for_timeout(500)


def drag_mouse(page, start, end, steps=14, hold_check=None):
    """마우스로 누른 뒤 조금씩 끌어 이동하고, 중간 프레임을 확인한 뒤 손을 뗍니다."""
    page.mouse.move(*start)
    page.mouse.down()
    xs = [start[0] + (end[0] - start[0]) * (i / steps) for i in range(1, steps + 1)]
    for i, x in enumerate(xs):
        page.mouse.move(x, end[1])
        page.wait_for_timeout(16)
        if hold_check and i == steps // 2:
            hold_check(x)
    page.mouse.up()
    page.wait_for_timeout(560)


def drag_touch(page, cdp, start, end, steps=12):
    page.wait_for_timeout(60)
    cdp.send(
        "Input.dispatchTouchEvent",
        {"type": "touchStart", "touchPoints": [{"x": start[0], "y": start[1], "id": 1, "radiusX": 6, "radiusY": 6, "force": 1}]},
    )
    for i in range(1, steps + 1):
        x = start[0] + (end[0] - start[0]) * (i / steps)
        cdp.send(
            "Input.dispatchTouchEvent",
            {"type": "touchMove", "touchPoints": [{"x": x, "y": end[1], "id": 1, "radiusX": 6, "radiusY": 6, "force": 1}]},
        )
        page.wait_for_timeout(16)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    page.wait_for_timeout(620)


def scenario_mouse(base: str, browser) -> None:
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = attach(ctx.new_page(), "G-mouse")
    open_viewer(page, base)
    box = page.locator('[data-testid="slides"]').bounding_box()
    width = box["width"]
    y = box["y"] + box["height"] * 0.45
    right = box["x"] + width * 0.82
    left = box["x"] + width * 0.22

    check("G: 시작은 1/4", counter(page) == "1 / 4", counter(page))

    mid: dict[str, float] = {}

    def hold(x):
        mid["tx"] = translate_x(page)
        mid["counter"] = counter(page)
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / "drag-mid.png"))

    # --- 오른쪽 → 왼쪽으로 끌기: 손을 떼기 전에 이미 따라와 있어야 한다
    drag_mouse(page, (right, y), (left, y), hold_check=hold)
    check("G1: 끄는 동안 카드가 실시간으로 따라옴(중간 translateX)", mid.get("tx", 0) < -40, f"tx={mid.get('tx')}")
    check("G1: 끄는 동안 진행 표시는 아직 1/4(점프 아님)", mid.get("counter") == "1 / 4", str(mid.get("counter")))
    check("G2: 손을 떼면 2/4로 스냅", counter(page) == "2 / 4", counter(page))
    check("G2: 2/4에서 translateX가 카드 한 장 폭", abs(translate_x(page) + width) < 2, f"tx={translate_x(page)} width={width}")

    # --- 한 번 더: 3/4
    drag_mouse(page, (right, y), (left, y))
    check("G2: 마우스 드래그 2/4 → 3/4", counter(page) == "3 / 4", counter(page))

    # --- 오른쪽으로 되돌리기
    drag_mouse(page, (left, y), (right, y))
    check("G2: 오른쪽으로 밀면 3/4 → 2/4", counter(page) == "2 / 4", counter(page))

    # --- 살짝만(임계값 미만) 끌면 제자리
    drag_mouse(page, (box["x"] + width * 0.6, y), (box["x"] + width * 0.52, y), steps=6)
    check("G4: 살짝 끌면 제자리(2/4 유지)", counter(page) == "2 / 4", counter(page))
    check("G4: 제자리로 돌아온 translateX", abs(translate_x(page) + width) < 2, f"tx={translate_x(page)}")

    # --- 첫 장에서 오른쪽으로 밀면 저항만 있고 넘어가지 않음
    page.locator('[data-testid="progress-1"]').click()
    page.wait_for_timeout(560)
    check("G5: 진행 막대 1번 클릭 → 1/4", counter(page) == "1 / 4", counter(page))
    drag_mouse(page, (left, y), (right, y))
    check("G4: 첫 장에서 오른쪽으로 밀어도 그대로", counter(page) == "1 / 4", counter(page))

    # --- 버튼·점 클릭도 여전히 동작
    page.locator('[data-testid="next"]').click()
    page.wait_for_timeout(520)
    check("G5: > 버튼 → 2/4", counter(page) == "2 / 4", counter(page))
    page.locator('[data-testid="prev"]').click()
    page.wait_for_timeout(520)
    check("G5: < 버튼 → 1/4", counter(page) == "1 / 4", counter(page))
    page.locator('[data-testid="progress-4"]').click()
    page.wait_for_timeout(560)
    check("G5: 진행 막대 4번 클릭 → 4/4", counter(page) == "4 / 4", counter(page))
    page.locator(".viewer-nav .dot-item").nth(1).click()
    page.wait_for_timeout(560)
    check("G5: 아래 점 클릭 → 2/4", counter(page) == "2 / 4", counter(page))

    # --- 투표 버튼 위에서 끌기 시작해도 카드가 넘어가고, 그 클릭은 취소됨
    page.locator('[data-testid="progress-4"]').click()
    page.wait_for_timeout(600)
    vote = page.locator('[data-testid="vote-a"]').bounding_box()
    vx, vy = vote["x"] + vote["width"] / 2, vote["y"] + vote["height"] / 2
    drag_mouse(page, (vx, vy), (vx + 190, vy))
    check("G7: 투표 버튼 위에서 끌어도 4/4 → 3/4", counter(page) == "3 / 4", counter(page))
    check("G7: 끌었을 뿐이면 투표는 안 됨", page.locator('[data-testid="vote-a"]').get_attribute("aria-pressed") != "true")
    page.locator('[data-testid="progress-4"]').click()
    page.wait_for_timeout(600)
    page.locator('[data-testid="vote-a"]').click()
    page.wait_for_timeout(900)
    check("G7: 그냥 누르면 투표는 정상 동작", page.locator('[data-testid="vote-a"]').get_attribute("aria-pressed") == "true")

    ctx.close()


def scenario_touch(base: str, browser) -> None:
    ctx = browser.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True,
    )
    page = attach(ctx.new_page(), "G-touch")
    open_viewer(page, base)
    cdp = ctx.new_cdp_session(page)
    box = page.locator('[data-testid="slides"]').bounding_box()
    width = box["width"]
    y = box["y"] + box["height"] * 0.45
    right = box["x"] + width * 0.78
    left = box["x"] + width * 0.28
    flick_from = box["x"] + width * 0.78
    flick_to = box["x"] + width * 0.6

    check("G: 터치 시작은 1/4", counter(page) == "1 / 4", counter(page))

    # 왼쪽으로 스와이프 → 2/4
    drag_touch(page, cdp, (right, y), (left, y))
    check("G3: 터치 스와이프 1/4 → 2/4", counter(page) == "2 / 4", counter(page))

    # 이어서 3/4
    drag_touch(page, cdp, (right, y), (left, y))
    check("G3: 터치 스와이프 2/4 → 3/4", counter(page) == "3 / 4", counter(page))

    # 짧게 튕기기(flick)도 한 장
    drag_touch(page, cdp, (flick_from, y), (flick_to, y), steps=3)
    check("G3: 짧게 튕겨도 3/4 → 4/4", counter(page) == "4 / 4", counter(page))

    # 오른쪽으로 되돌리기
    drag_touch(page, cdp, (left, y), (right, y))
    check("G3: 터치로 되돌리기 4/4 → 3/4", counter(page) == "3 / 4", counter(page))

    check("G6: 모바일 390 가로 넘침 없음", no_overflow(page))

    # 세로 스크롤은 스와이프로 오인하지 않음(2장에서 위아래로 끌기)
    page.locator('[data-testid="progress-2"]').click()
    page.wait_for_timeout(560)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": box["x"] + width * 0.5, "y": y + 60, "id": 1}]})
    for step in range(10):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": box["x"] + width * 0.5 + 3, "y": y + 48 - step * 12, "id": 1}]})
        page.wait_for_timeout(16)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    page.wait_for_timeout(500)
    check("G3: 세로로 끌면 카드가 넘어가지 않음", counter(page) == "2 / 4", counter(page))

    ctx.close()


def main() -> int:
    print("== 빌드 확인(npm run build) ==")
    subprocess.run(["npm", "run", "build"], cwd=ROOT, env=ENV, check=True, stdout=subprocess.DEVNULL)

    port = 4197
    proc, log = start_server(port)
    base = f"http://127.0.0.1:{port}/"
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"])
            try:
                print("== G: 마우스 드래그 ==")
                scenario_mouse(base, browser)
                print("== G: 터치 스와이프 ==")
                scenario_touch(base, browser)
            finally:
                browser.close()
    finally:
        try:
            proc.send_signal(signal.SIGTERM)
            proc.wait(timeout=8)
        except Exception:
            proc.kill()
        log.close()

    unique = sorted({f"{tag} {text}" for tag, text in console_errors})
    check("G6: 콘솔 에러·경고 0", len(unique) == 0, " | ".join(unique[:4]))

    passed = sum(1 for _, ok, _ in checks if ok)
    print(f"\n===== {passed}/{len(checks)} checks passed =====")
    if passed != len(checks):
        print("\n실패 목록:")
        for name, ok, detail in checks:
            if not ok:
                print(f"  - {name} {detail}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
