#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""날짜별 보관 화면을 문서용 스크린샷으로 남깁니다 — '어제' 카드를 꺼낸 상태.

    python3 scripts/shots-days.py

로컬 하네스(가짜 RSS·데모 AI)를 띄워, 어제 보관본을 브라우저 저장소에 심고
어제 날짜 칩을 누른 화면을 docs/screenshots/25-day-yesterday.png 로 저장합니다.
"""
import datetime
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import verify  # noqa: E402  (하네스의 서버 기동·스크린샷 경로를 그대로 씁니다)

PORT = 4501


def main() -> int:
    verify.SHOTS.mkdir(parents=True, exist_ok=True)
    proc, log = verify.start_server(PORT, dist="dist", api="on", store="memory", ai="demo", feeds="on")
    try:
        kst = datetime.timezone(datetime.timedelta(hours=9))
        now = datetime.datetime.now(kst)
        today = now.strftime("%Y-%m-%d")
        yesterday = (now - datetime.timedelta(days=1)).strftime("%Y-%m-%d")
        _, doc = verify.api_json(PORT, "/api/trending")
        issues = doc.get("issues") or []

        with verify.sync_playwright() as p:
            browser = p.chromium.launch(args=verify.LAUNCH_ARGS)
            ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
            verify.seed_plan(ctx, "pro")
            page = ctx.new_page()
            page.goto(f"http://127.0.0.1:{PORT}/", wait_until="networkidle")
            page.wait_for_selector('[data-testid="day-bar"]', timeout=20000)
            page.evaluate(
                """([date, issues]) => {
                    const store = JSON.parse(localStorage.getItem('issue-thermo.days.v1') || '{}');
                    store[date] = { date, generatedAt: Date.now(), issues };
                    localStorage.setItem('issue-thermo.days.v1', JSON.stringify(store));
                }""",
                [yesterday, issues],
            )
            page.reload(wait_until="networkidle")
            page.wait_for_selector('[data-testid="day-tab-1"]', timeout=20000)
            page.locator('[data-testid="day-tab-1"]').click()
            page.wait_for_timeout(1200)
            page.screenshot(path=str(verify.SHOTS / "25-day-yesterday.png"))
            print("saved", verify.SHOTS / "25-day-yesterday.png")
            ctx.close()
            browser.close()
        print(json.dumps({"today": today, "yesterday": yesterday, "issues": len(issues)}, ensure_ascii=False))
    finally:
        verify.stop_server(proc)
        log.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
