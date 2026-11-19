import { useEffect, useState } from "react";
import type { Issue } from "../types";
import { renderSlideAsset, type SlideAsset } from "./cardImage";

/**
 * 카드뉴스 한 장을 실제 PNG로 그려 미리보기 이미지로 씁니다.
 * 홈의 "카드뉴스 5장" 칸에서 표지를 그대로 보여 주기 위한 훅 — 화면과 저장본이 같은 그림입니다.
 */
export function useSlidePreview(issue: Issue, index = 0, delayMs = 260): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: SlideAsset | null = null;
    setUrl(null);

    const timer = setTimeout(() => {
      void (async () => {
        const asset = await renderSlideAsset(issue, index);
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
      if (created) URL.revokeObjectURL(created.url);
    };
  }, [issue, index, delayMs]);

  return url;
}
