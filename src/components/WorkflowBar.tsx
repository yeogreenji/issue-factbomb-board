import { Search, X } from "lucide-react";
import { CATEGORY_META, CATEGORY_ORDER, type Category } from "../types";

export type FeedStatus = "all" | "saved" | "todo" | "done";

interface Props {
  query: string;
  category: Category | "all";
  status: FeedStatus;
  total: number;
  shown: number;
  savedCount: number;
  doneCount: number;
  /** 오늘 올린 카드 수 / 하루 목표(3~4장) */
  published: number;
  goal: number;
  onQuery: (value: string) => void;
  onCategory: (value: Category | "all") => void;
  onStatus: (value: FeedStatus) => void;
  onReset: () => void;
}

/**
 * 크리에이터 작업 줄 — 오늘 모인 카드에서 검색·카테고리·발행 상태로 골라 냅니다.
 * 하루 3~4장을 올리는 사람이 "무엇을 이미 올렸고 무엇이 남았는지"를 한 줄에서 봅니다.
 */
export function WorkflowBar({
  query,
  category,
  status,
  total,
  shown,
  savedCount,
  doneCount,
  published,
  goal,
  onQuery,
  onCategory,
  onStatus,
  onReset,
}: Props) {
  const filtering = query.trim() !== "" || category !== "all" || status !== "all";
  const progress = Math.min(100, Math.round((published / Math.max(1, goal)) * 100));

  return (
    <section className="work" data-testid="workflow-bar" aria-label="카드 작업 줄">
      <div className="work-search">
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="제목·키워드·출처로 찾기"
          aria-label="이슈 검색"
          data-testid="search-input"
        />
        {query && (
          <button type="button" className="work-clear" onClick={() => onQuery("")} aria-label="검색어 지우기">
            <X size={13} />
          </button>
        )}
      </div>

      <div className="work-chips">
        <button
          type="button"
          data-on={category === "all"}
          aria-pressed={category === "all"}
          onClick={() => onCategory("all")}
          data-testid="filter-category-all"
        >
          전체 {total}
        </button>
        {CATEGORY_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            data-on={category === key}
            aria-pressed={category === key}
            onClick={() => onCategory(key)}
            data-testid={`filter-category-${key}`}
          >
            {CATEGORY_META[key].label}
          </button>
        ))}
      </div>

      <div className="work-chips is-status">
        {(
          [
            { key: "all", label: "모두" },
            { key: "saved", label: `저장함 ${savedCount}` },
            { key: "todo", label: "발행 전" },
            { key: "done", label: `발행 완료 ${doneCount}` },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            data-on={status === item.key}
            aria-pressed={status === item.key}
            onClick={() => onStatus(item.key)}
            data-testid={`filter-status-${item.key}`}
          >
            {item.label}
          </button>
        ))}
        {filtering && (
          <button type="button" className="work-reset" onClick={onReset} data-testid="filter-reset">
            조건 지우기
          </button>
        )}
      </div>

      <div className="work-goal">
        <span className="work-goal-label">
          오늘 발행 <b>{published}</b>/{goal}
        </span>
        <span className="work-goal-track" aria-hidden="true">
          <span className="work-goal-fill" style={{ width: `${progress}%` }} />
        </span>
        <span className="work-shown" data-testid="filter-count">
          {filtering ? `${shown}건 보는 중` : `${total}건`}
        </span>
      </div>
    </section>
  );
}
