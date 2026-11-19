#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""카드뉴스 1~5장을 실제로 그려 PNG로 떨어뜨려 눈으로 검사하는 도구(개발용)."""
import os
import sys
import json
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / ".tmp" / "preview"
NODE_BIN = "/workspace/.tools/node-v22.12.0-linux-x64/bin"
LIBS = "/workspace/.libs/usr/lib/x86_64-linux-gnu"

ENV = os.environ.copy()
if Path(NODE_BIN).exists():
    ENV["PATH"] = f"{NODE_BIN}:{ENV.get('PATH', '')}"
if Path(LIBS).exists():
    ENV["LD_LIBRARY_PATH"] = f"{LIBS}:{ENV.get('LD_LIBRARY_PATH', '')}"

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4185
BASE = f"http://127.0.0.1:{PORT}/"
# all | 0,1,2 …  (그릴 장 번호, 기본 전부)
ONLY = sys.argv[2] if len(sys.argv) > 2 else "all"


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--in-process-gpu"])
        ctx = browser.new_context(viewport={"width": 390, "height": 900}, device_scale_factor=2, is_mobile=True, has_touch=True,
                                  accept_downloads=True)
        page = ctx.new_page()
        errors = []
        page.on("console", lambda m: errors.append(f"[{m.type}] {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))
        page.goto(BASE, wait_until="networkidle")
        page.wait_for_selector('[data-testid="feed-card"]', timeout=25000)
        page.wait_for_timeout(1200)
        page.screenshot(path=str(OUT / "00-feed.png"), full_page=True)
        page.locator('[data-testid="hero-card"] button').click()
        page.wait_for_selector('[data-testid="viewer"]', timeout=10000)
        page.wait_for_selector('[data-testid="slide-img-5"]', timeout=40000)
        page.wait_for_timeout(600)

        wanted = range(5) if ONLY == "all" else [int(x) for x in ONLY.split(",")]
        for i in range(5):
            page.locator(f'[data-testid="progress-{i + 1}"]').click()
            page.wait_for_timeout(700)
            page.screenshot(path=str(OUT / f"view-{i + 1}.png"))
            if i in wanted:
                with page.expect_download(timeout=30000) as info:
                    page.locator('[data-testid="save-png"]').click()
                info.value.save_as(str(OUT / f"card-{i + 1}.png"))

        meta = page.evaluate(
            """() => Array.from(document.querySelectorAll('[data-testid^="slide-img-"]')).map(img => ({
                src: img.getAttribute('data-hash'), w: img.naturalWidth, h: img.naturalHeight,
                label: img.closest('section').getAttribute('aria-label') }))"""
        )
        print(json.dumps(meta, ensure_ascii=False, indent=1)[:2000])
        print("console:", [e for e in errors][:6])
        browser.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
