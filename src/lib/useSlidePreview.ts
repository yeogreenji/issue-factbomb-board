import { useEffect, useState } from "react";
import type { Issue } from "../types";
import { renderSlideAsset, type RenderOptions, type SlideAsset } from "./cardImage";

/**
 * 카드뉴스 한 장을 실제 PNG로 그려 미리보기 이미지로 씁니다.
 * 홈의 "카드뉴스 5장" 칸에서 표지를 그대로 보여 주기 위한 훅 — 화면과 저장본이 같은 그림입니다.
 * 테마·워터마크까지 반영되므로 크리에이터가 테마를 바꾸면 홈 썸네일도 함께 바뀝니다.
 */
export function useSlidePreview(issue: Issue, index = 0, options: RenderOptions = {}, delayMs = 260): string | null {
  const { theme, handle } = options;
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: SlideAsset | null = null;
    setUrl(null);

    const timer = setTimeout(() => {
      void (async () => {
        const asset = await renderSlideAsset(issue, index, { theme, handle });
        if (cancelled) {
          URL.revokeObjectURL(asset.url);
          return;
        }
        created = asset;
        setUrl(asset.url);
      })();
    }, delayMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      /* 화면이 아직 그 URL을 들고 있는 순간이 있어, 잠시 뒤에 정리합니다. */
      if (created) {
        const old = created;
        setTimeout(() => URL.revokeObjectURL(old.url), 3_000);
      }
    };
  }, [issue, index, theme, handle, delayMs]);

  return url;
}
