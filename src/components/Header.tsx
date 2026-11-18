import { Flame, Plus, RefreshCw } from "lucide-react";
import { clockLabel, todayLabel } from "../lib/format";

interface Props {
  generatedAt: number | null;
  issueCount: number;
  feedOk: number;
  feedTotal: number;
  aiOn: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenStudio: () => void;
}

/** 상단 바 — 지금 무엇을 보고 있는지(수집 시각·건수·AI 상태)를 숨기지 않고 적습니다. */
export function Header({
  generatedAt,
  issueCount,
  feedOk,
  feedTotal,
  aiOn,
  refreshing,
  onRefresh,
  onOpenStudio,
}: Props) {
  const at = generatedAt ? clockLabel(new Date(generatedAt)) : clockLabel();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Flame size={19} strokeWidth={2.6} />
          </span>
          <div className="brand-text">
            <h1>
              이슈온도계<span className="brand-dot">.</span>
            </h1>
            <p>오늘의 뉴스를 인스타 카드뉴스로</p>
          </div>
        </div>

        <div className="top-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={onRefresh}
            aria-label="새로고침"
            disabled={refreshing}
            data-testid="refresh"
          >
            <RefreshCw size={18} className={refreshing ? "spin" : undefined} />
          </button>
          <button type="button" className="cta" onClick={onOpenStudio} data-testid="open-studio">
            <Plus size={16} />
            <span>뉴스로 만들기</span>
          </button>
        </div>
      </div>

      <div className="live-strip">
        <span className="live-dot" aria-hidden="true" />
        <span className="live-now">LIVE</span>
        <span className="live-item">
          {todayLabel()} · {at} 기준
        </span>
        <span className="sep" aria-hidden="true" />
        <span className="live-item">{issueCount > 0 ? `이슈 ${issueCount}건` : "수집 중"}</span>
        <span className="sep" aria-hidden="true" />
        <span className={`live-item ${aiOn ? "live-ok" : "live-warn"}`}>{aiOn ? "AI 요약" : "헤드라인만"}</span>
        {feedTotal > 0 && (
          <>
            <span className="sep" aria-hidden="true" />
            <span className="live-item live-dim">
              언론사 {feedOk}/{feedTotal}
            </span>
          </>
        )}
      </div>
    </header>
  );
}
