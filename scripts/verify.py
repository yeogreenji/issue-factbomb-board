"""End-to-end verification + screenshot pass for 이슈온도계 (FactBomb Board)."""
import os
import re
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("BOARD_URL", "http://127.0.0.1:4185/")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "screenshots")
SAMPLE = os.path.join(ROOT, "docs", "share-card-sample.png")
SCALE = float(os.environ.get("SHOT_SCALE", "1"))
os.makedirs(OUT, exist_ok=True)

errors = []
checks = []


def attach(page):
    page.on(
        "console",
        lambda m: errors.append(f"[console:{m.type}] {m.text}")
        if m.type in ("error", "warning")
        else None,
    )
    page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))


def check(name, cond):
    checks.append((name, bool(cond)))


def settle(page, ms=450):
    page.wait_for_timeout(ms)
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(150)


def settle_top(page, ms=500):
    """Wait for the smooth-scroll router to land at the top before capturing."""
    page.wait_for_timeout(ms)
    try:
        page.wait_for_function("window.scrollY === 0", timeout=3000)
    except Exception:
        pass
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(250)


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ---------- desktop ----------
    ctx = browser.new_context(
        viewport={"width": 1440, "height": 1000}, device_scale_factor=SCALE, locale="ko-KR", accept_downloads=True
    )
    page = ctx.new_page()
    attach(page)
    page.goto(BASE, wait_until="networkidle")
    page.evaluate("localStorage.clear()")
    page.reload(wait_until="networkidle")
    settle(page, 900)

    check("hero section rendered", page.locator("section[aria-label='오늘의 최고 온도 이슈']").count() == 1)
    check("feed has 12 seed issues", page.locator("main article").count() == 12)
    hero = page.locator("section[aria-label='오늘의 최고 온도 이슈']")
    hero_temp_before = int(re.sub(r"\D", "", hero.locator(".nums.serif").first.inner_text()))
    check("hero temperature is 94", hero_temp_before == 94)
    page.mouse.move(700, 500)
    settle(page, 300)
    page.screenshot(path=f"{OUT}/01-desktop-hero.png")

    # vote in hero
    hero.get_by_role("button", name=re.compile("불타는 중")).click()
    settle(page, 700)
    check(
        "hero vote selected",
        hero.get_by_role("button", name=re.compile("불타는 중")).get_attribute("aria-pressed") == "true",
    )
    check("hero vote marked 내 선택", "내 선택" in hero.inner_text())
    stored_votes = page.evaluate("JSON.parse(localStorage.getItem('factbomb.board.v1')).myVotes")
    check("vote persisted to storage", stored_votes.get("luna-beauty-seongsu-popup") == "hot")
    check("vote badge '내 선택' visible", hero.get_by_text("내 선택").count() == 1)
    page.screenshot(path=f"{OUT}/02-desktop-vote.png")

    # feed grid
    page.locator("h2", has_text="이슈 피드").scroll_into_view_if_needed()
    settle(page, 500)
    page.screenshot(path=f"{OUT}/03-desktop-feed.png")
    page.screenshot(path=f"{OUT}/03b-desktop-feed-full.png", full_page=True)

    # category filter
    page.get_by_role("button", name=re.compile("^IT·테크")).first.click()
    settle(page, 400)
    check("IT filter shows 3 issues", page.locator("main article").count() == 3)
    page.get_by_role("button", name=re.compile("^전체")).first.click()
    settle(page, 300)
    check("전체 filter restores 12", page.locator("main article").count() == 12)

    # sort by recent
    order_before = [page.locator("main article h3").nth(i).inner_text() for i in range(3)]
    page.get_by_role("button", name="최신순").click()
    settle(page, 400)
    order_after = [page.locator("main article h3").nth(i).inner_text() for i in range(3)]
    check("recent sort reorders feed", order_before != order_after)
    check("recent sort starts with the newest issue", "루나뷰티" in order_after[0])
    check("recent sort second is 4h-old issue", "오비탈페이" in order_after[1])
    page.get_by_role("button", name="온도순").click()
    settle(page, 300)

    # open the hero issue detail through its card link
    page.locator("main article h3").first.click()
    page.wait_for_url(re.compile(r"#/issue/"))
    settle(page, 700)
    check("detail headline visible", page.locator("h1").first.is_visible())
    check("detail has 30초 요약", page.get_by_text("30초 요약").count() == 1)
    check("detail has insider take", page.get_by_text("PR·업계인 속마음").count() == 1)
    page.screenshot(path=f"{OUT}/04-desktop-detail.png")
    page.screenshot(path=f"{OUT}/04b-desktop-detail-full.png", full_page=True)

    # comment battle
    box = page.get_by_label("한 줄 팩폭 남기기")
    box.click()
    box.fill("재고표를 먼저 공개했으면 줄도 이렇게 안 길었겠다.")
    check("comment counter tracks length", page.get_by_text(re.compile(r"^28/100$")).count() == 1)
    page.get_by_role("button", name="등록").click()
    settle(page, 600)
    check("my comment posted", page.get_by_text("나 · 익명").count() >= 1)
    check("comment persisted", len(page.evaluate("JSON.parse(localStorage.getItem('factbomb.board.v1')).comments")) == 27)
    page.get_by_role("button", name="최신순").click()
    settle(page, 300)
    page.locator("#battle-luna-beauty-seongsu-popup").scroll_into_view_if_needed()
    settle(page, 400)
    like_btn = page.get_by_role("button", name="이 팩폭에 좋아요").first
    like_btn.click()
    settle(page, 300)
    check("like toggled on", like_btn.get_attribute("aria-pressed") == "true")
    page.screenshot(path=f"{OUT}/05-desktop-comment.png")

    # share card
    page.get_by_role("button", name="이 온도로 공유 카드 만들기").click()
    page.wait_for_selector("img[alt*='공유 카드 미리보기']", timeout=15000)
    settle(page, 700)
    src = page.locator("img[alt*='공유 카드 미리보기']").get_attribute("src") or ""
    check("share card rendered as PNG data url", src.startswith("data:image/png") and len(src) > 40000)
    page.screenshot(path=f"{OUT}/06-desktop-share.png")
    page.get_by_role("button", name=re.compile("정사각")).click()
    settle(page, 900)
    check("square format selected", page.get_by_role("button", name=re.compile("정사각")).get_attribute("aria-pressed") == "true")
    page.screenshot(path=f"{OUT}/07-desktop-share-square.png")
    with page.expect_download() as dl_info:
        page.get_by_role("button", name="PNG 다운로드").click()
    download = dl_info.value
    download.save_as(SAMPLE)
    check("share card downloads", os.path.getsize(SAMPLE) > 20000)
    page.get_by_role("button", name="닫기").click()
    settle(page, 400)

    # ranking
    page.get_by_role("button", name="팩폭 랭킹").first.click()
    page.wait_for_url(re.compile(r"#/ranking"))
    settle_top(page, 700)
    check("ranking shows 27 fact bombs", page.get_by_text("팩폭").first.is_visible() and page.locator("ol li").count() >= 23)
    podium_text = page.locator("article").first.inner_text()
    check("ranking top-1 is the 328-like take", "구독료 내고" in podium_text and "328" in podium_text)
    page.wait_for_timeout(3800)
    page.screenshot(path=f"{OUT}/08-desktop-ranking.png")

    # editor: structurize + publish
    page.get_by_role("button", name="에디터 스튜디오").first.click()
    page.wait_for_url(re.compile(r"#/editor"))
    settle_top(page, 600)
    page.get_by_role("button", name="예시 메모 넣기").click()
    page.get_by_role("button", name="초안 구조화").click()
    settle(page, 700)
    check("structurize fills headline", "페이퍼백" in page.locator("#headline").input_value())
    check("structurize fills 3 summary lines", all(len(page.locator("textarea").nth(i).input_value()) > 5 for i in range(3)))
    check("structurize drafts insider take", "수수료" in page.locator("#insider").input_value() or "결제" in page.locator("#insider").input_value())
    check("structurize picks category", page.get_by_role("button", name="IT·테크").get_attribute("aria-pressed") == "true")
    check("structurize estimates temperature", page.get_by_text("39°", exact=False).count() >= 1)
    page.mouse.move(700, 300)
    settle(page, 400)
    page.screenshot(path=f"{OUT}/09-desktop-editor.png")

    page.get_by_role("button", name="지금 발행하기").click()
    page.wait_for_url(re.compile(r"#/issue/issue-"))
    settle(page, 700)
    check("published issue page opens", "페이퍼백" in page.locator("h1").first.inner_text())
    check("published badge shown", page.get_by_text("방금 발행").count() >= 1)
    check("published issue has no votes yet", "아직 투표가 없습니다" in page.locator("body").inner_text())
    page.wait_for_timeout(3800)
    page.screenshot(path=f"{OUT}/10-desktop-published.png")

    # new issue voting moves the temperature (low-volume issue)
    aside = page.locator("aside")
    temp_before_new = int(re.sub(r"\D", "", page.locator("aside .nums.serif").first.inner_text()))
    page.locator("aside").get_by_role("button", name=re.compile("불타는 중")).click()
    settle(page, 900)
    temp_after_new = int(re.sub(r"\D", "", page.locator("aside .nums.serif").first.inner_text()))
    check("fresh issue temperature reacts to a vote", temp_after_new > temp_before_new)
    page.screenshot(path=f"{OUT}/11-desktop-published-vote.png")

    # persistence across reload
    page.reload(wait_until="networkidle")
    settle(page, 700)
    check("published issue survives reload", "페이퍼백" in page.locator("h1").first.inner_text())

    # new issue appears first in the feed when sorted by recency
    page.get_by_role("button", name="뉴스룸").first.click()
    settle(page, 500)
    page.get_by_role("button", name="최신순").click()
    settle(page, 400)
    check("feed has 13 issues after publish", page.locator("main article").count() == 13)
    check("new issue tops the recent feed", "페이퍼백" in page.locator("main article h3").first.inner_text())

    # reset demo data
    page.on("dialog", lambda d: d.accept())
    page.get_by_role("button", name="데모 데이터 초기화").click()
    settle(page, 700)
    check("reset restores 12 issues", page.locator("main article").count() == 12)

    # tablet — start from the top with the toast cleared
    page.wait_for_timeout(3800)
    page.evaluate("window.scrollTo(0, 0)")
    page.set_viewport_size({"width": 1024, "height": 820})
    settle(page, 500)
    page.locator("h2", has_text="이슈 피드").scroll_into_view_if_needed()
    page.evaluate("window.scrollBy(0, -120)")
    settle(page, 500)
    page.screenshot(path=f"{OUT}/12-tablet-feed.png")
    page.set_viewport_size({"width": 1440, "height": 1000})

    # ---------- mobile ----------
    mctx = browser.new_context(
        viewport={"width": 390, "height": 844},
        device_scale_factor=SCALE,
        locale="ko-KR",
        is_mobile=True,
        has_touch=True,
        accept_downloads=True,
    )
    mp = mctx.new_page()
    attach(mp)
    mp.goto(BASE, wait_until="networkidle")
    settle(mp, 800)
    check(
        "mobile: no horizontal overflow",
        mp.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
    )
    mp.screenshot(path=f"{OUT}/13-mobile-feed.png")
    mp.screenshot(path=f"{OUT}/13b-mobile-feed-full.png", full_page=True)
    mp.locator("main article h3").first.click()
    settle(mp, 600)
    check(
        "mobile detail: no horizontal overflow",
        mp.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
    )
    mp.screenshot(path=f"{OUT}/14-mobile-detail.png")
    mp.get_by_role("button", name="뉴스룸").last.click()
    settle(mp, 400)
    mp.get_by_role("button", name="팩폭 랭킹").last.click()
    settle_top(mp)
    mp.screenshot(path=f"{OUT}/15-mobile-ranking.png")
    mp.get_by_role("button", name="에디터 스튜디오").last.click()
    settle_top(mp)
    mp.screenshot(path=f"{OUT}/16-mobile-editor.png")
    mp.get_by_role("button", name="예시 메모 넣기").click()
    mp.get_by_role("button", name="초안 구조화").click()
    settle(mp, 600)
    check("mobile structurize works", "페이퍼백" in mp.locator("#headline").input_value())

    browser.close()

print("\nCHECKS")
passed = 0
for name, ok in checks:
    print(("PASS " if ok else "FAIL ") + name)
    passed += 1 if ok else 0
print(f"\n{passed}/{len(checks)} checks passed")
print("CONSOLE ERRORS:", len(errors))
for e in errors:
    print(e)
