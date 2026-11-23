import { FileImage, LayoutGrid } from "lucide-react";
import type { Issue } from "../types";
import { useSlidePreview } from "../lib/useSlidePreview";
import type { CardThemeId } from "../lib/theme";

interface LiveProps {
  issue: Issue;
  slide: number;
  theme: CardThemeId;
  handle: string;
  busy?: boolean;
}

/**
 * 카드 스튜디오 옆에 붙는 실시간 4:5 미리보기.
 * 편집 중인 문구·테마·워터마크로 실제 PNG와 같은 캔버스를 그려 보여 줍니다(저장 전에도).
 */
export function LiveCardPreview({ issue, slide, theme, handle }: LiveProps) {
  const url = useSlidePreview(issue, slide, { theme, handle }, 200);

  return (
    <figure className="live-card" data-testid="live-card" data-slide={slide + 1}>
      <div className="live-card-frame" data-theme={theme}>
        {url ? (
          <img src={url} alt="" width={1080} height={1350} draggable={false} data-testid="live-card-img" />
        ) : (
          <span className="live-card-skeleton" aria-hidden="true">
            <FileImage size={20} />
            <span>미리보기 그리는 중</span>
          </span>
        )}
        <span className="live-card-badge" aria-hidden="true">
          {slide + 1}/{5}
        </span>
      </div>
      <figcaption className="live-card-cap">
        <span className="live-cap-dot" aria-hidden="true" />
        LIVE 4:5 · 1080×1350
      </figcaption>
    </figure>
  );
}

function GridCell({ issue, theme, handle, delay }: { issue: Issue; theme: CardThemeId; handle: string; delay: number }) {
  const url = useSlidePreview(issue, 0, { theme, handle }, delay);
  return (
    <span className="grid-cell" data-ready={url ? "true" : "false"}>
      {url ? <img src={url} alt="" draggable={false} /> : null}
    </span>
  );
}

interface GridProps {
  cover: Issue;
  recent: Issue[];
  theme: CardThemeId;
  handle: string;
  /** 프로필에 적을 핸들(@...) — 없으면 서비스 이름. */
  profileHandle?: string;
}

/**
 * 인스타 3×3 피드 미리보기 — 방금 만든 표지가 최근 카드들 사이에서 어떻게 보이는지.
 * 9칸 모두 실제로 그린 표지라, 테마를 바꾸면 그리드도 같이 바뀝니다.
 */
export function FeedGridPreview({ cover, recent, theme, handle, profileHandle }: GridProps) {
  const others = recent.filter((issue) => issue.id !== cover.id).slice(0, 8);
  const name = profileHandle || "이슈온도계";

  return (
    <section className="feed-grid" data-testid="feed-grid-preview" aria-label="인스타 3×3 피드 미리보기">
      <header className="feed-grid-head">
        <LayoutGrid size={13} />
        <b>인스타 피드 미리보기</b>
        <span className="feed-grid-count">게시물 {others.length + 1}</span>
      </header>

      <div className="feed-grid-profile">
        <span className="feed-grid-avatar" aria-hidden="true">
          {name.replace(/^@/, "").slice(0, 1) || "이"}
        </span>
        <span className="feed-grid-id">{name}</span>
      </div>

      <div className="feed-grid-cells" role="list">
        <span className="grid-cell is-new" data-ready="true" role="listitem" aria-label="방금 만든 표지">
          <CoverThumb issue={cover} theme={theme} handle={handle} />
        </span>
        {others.map((issue, index) => (
          <span role="listitem" key={issue.id}>
            <GridCell issue={issue} theme={theme} handle={handle} delay={300 + index * 70} />
          </span>
        ))}
      </div>
      <p className="feed-grid-note">방금 만든 표지가 맨 앞. 최근 카드와 나란히 놓았을 때의 톤입니다.</p>
    </section>
  );
}

/** 그리드 첫 칸 — 편집 중인 표지를 그대로 크게 한 번 더 그립니다. */
function CoverThumb({ issue, theme, handle }: { issue: Issue; theme: CardThemeId; handle: string }) {
  const url = useSlidePreview(issue, 0, { theme, handle }, 200);
  return url ? <img src={url} alt="" draggable={false} data-testid="grid-cover-img" /> : null;
}
