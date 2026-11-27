#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""라이브 화면에서 보강된 인스타 캡션이 실제로 뜨는지 확인하고 스크린샷을 남깁니다.

    python3 scripts/live-caption-shot.py

저장: downloads/issue-caption-desktop.png (데스크톱 1440), downloads/issue-caption-mobile.png (390)
"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from playwright.sync_api import sync_playwright  # noqa: E402

NODE_BIN = "/workspace/.tools/node-v22.12.0-linux-x64/bin"
LIBS = "/workspace/.libs/usr/lib/x86_64-linux-gnu"
os.environ["PATH"] = f"{NODE_BIN}:{os.environ.get('PATH', '')}"
if Path(LIBS).exists():
    os.environ["LD_LIBRARY_PATH"] = f"{LIBS}:{os.environ.get('LD_LIBRARY_PATH', '')}"

URL = "https://issue-factbomb-board.vercel.app/"
OUT = Path("/workspace/downloads")
ARGS = ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--in-process-gpu"]
# 화면에는 Creator Pro 체험 상태로 엽니다(앱의 ‘Pro 무료 체험’과 같은 값) — 보강된 캡션이 실제 사용 화면입니다.
SEED = (
    "try { localStorage.setItem('issue-thermo.plan.v1', JSON.stringify({"
    "plan: 'pro', trial: true, billing: 'monthly'"
    "})); } catch (e) {}"
)


def open_caption(page):
    page.wait_for_selector('[data-testid="hero-card"]', timeout=60000)
    page.wait_for_timeout(1200)
    page.locator('[data-testid="hero-card"] button').first.click()
    page.wait_for_selector('[data-testid="viewer"]', timeout=30000)
    page.wait_for_selector('[data-testid="slide-img-1"]', timeout=60000)
    page.locator('[data-testid="open-caption"]').click()
    page.wait_for_selector('[data-testid="caption-text"]', timeout=15000)
    page.wait_for_timeout(1500)
    return page.locator('[data-testid="caption-text"]').input_value()


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    report = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(args=ARGS)
        # 데스크톱
        ctx = browser.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=1)
        ctx.add_init_script(script=SEED)
        page = ctx.new_page()
        page.goto(URL, wait_until="networkidle", timeout=90000)
        caption = open_caption(page)
        page.screenshot(path=str(OUT / "issue-caption-desktop.png"))
        report["desktop"] = {"chars": len(caption), "tags": caption.count("#")}
        report["caption_first_lines"] = caption.split("\n")[:4]
        ctx.close()

        # 모바일
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        ctx.add_init_script(script=SEED)
        page = ctx.new_page()
        page.goto(URL, wait_until="networkidle", timeout=90000)
        page.wait_for_selector('[data-testid="day-bar"]', timeout=60000)
        page.wait_for_timeout(800)
        page.screenshot(path=str(OUT / "issue-daybar-mobile.png"))
        caption = open_caption(page)
        page.screenshot(path=str(OUT / "issue-caption-mobile.png"))
        report["mobile"] = {"chars": len(caption), "tags": caption.count("#")}
        ctx.close()
        browser.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
