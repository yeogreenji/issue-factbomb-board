import { Flame, Palette, Plus, RefreshCw } from "lucide-react";
import { clockLabel, todayLabel } from "../lib/format";
import { useActiveBrand, usePlan } from "../lib/prefs";
import { paletteOf } from "../lib/theme";
import { planLabel } from "../lib/plan";

interface Props {
  generatedAt: number | null;
  issueCount: number;
  feedOk: number;
  feedTotal: number;
  aiOn: boolean;
  refreshing: boolean;
  publishedCount: number;
  dailyGoal: number;
  onRefresh: () => void;
  onOpenStudio: () => void;
  onOpenBrand: () => void;
  onOpenPricing: () => void;
}

/** 상단 바 — 지금 무엇을 보고 있는지(수집 시각·건수·AI 상태)를 숨기지 않고 적습니다. */
export function Header({
  generatedAt,
  issueCount,
  feedOk,
  feedTotal,
  aiOn,
  refreshing,
  publishedCount,
  dailyGoal,
  onRefresh,
  onOpenStudio,
  onOpenBrand,
  onOpenPricing,
}: Props) {
  const at = generatedAt ? clockLabel(new Date(generatedAt)) : clockLabel();
  const brand = useActiveBrand();
  const plan = usePlan();
  const palette = paletteOf(brand.theme);
  const planName = planLabel(plan.plan, plan.trial);
  const shortPlan = plan.plan === "free" ? "Free" : plan.plan === "team" ? "Team" : "Pro";

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Flame size={17} strokeWidth={2.2} />
          </span>
          <div className="brand-text">
            <h1>
              이슈온도계<span className="brand-dot">.</span>
            </h1>
            <p>{brand.handle ? `크리에이터 ${brand.handle}` : "오늘의 뉴스를 인스타 카드뉴스로"}</p>
          </div>
        </div>

        <div className="top-actions">
          <button
            type="button"
            className="brand-chip"
            onClick={onOpenBrand}
            aria-label={`카드 테마·워터마크 설정 — 지금 ${palette.label}`}
            title={`카드 테마: ${palette.label}`}
            data-testid="open-brand"
          >
            <Palette size={14} />
            <span className="brand-chip-dots" aria-hidden="true">
              {palette.swatch.map((color) => (
                <span key={color} style={{ background: color }} />
              ))}
            </span>
            <span className="brand-chip-label">{palette.label}</span>
          </button>

          <button
            type="button"
            className="plan-chip"
            data-plan={plan.plan}
            onClick={onOpenPricing}
            aria-label={`요금제 — 지금 ${planName}`}
            title={`요금제: ${planName}`}
            data-testid="open-pricing"
          >
            <span className="plan-chip-dot" aria-hidden="true" />
            <span className="plan-chip-label">{shortPlan}</span>
            {plan.trial && <span className="plan-chip-trial">체험</span>}
          </button>

          <span className="publish-pill" data-testid="publish-pill" title="오늘 발행 완료 / 하루 목표">
            <b>{publishedCount}</b>/{dailyGoal} 발행
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={onRefresh}
            aria-label="새로고침"
            disabled={refreshing}
            data-testid="refresh"
          >
            <RefreshCw size={17} className={refreshing ? "spin" : undefined} />
          </button>
          <button type="button" className="cta" onClick={onOpenStudio} data-testid="open-studio">
            <Plus size={15} />
            <span className="cta-label">뉴스로 만들기</span>
            <span className="cta-label-short">만들기</span>
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
