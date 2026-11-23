import { useMemo, useState } from "react";
import { ArrowUpRight, Check, Minus, Sparkles, X } from "lucide-react";
import {
  FEATURE_MATRIX,
  PLANS,
  TRIAL_DAYS,
  annualSaving,
  planLabel,
  priceLabel,
  type BillingCycle,
  type PlanDef,
  type PlanId,
} from "../lib/plan";
import { usePlan } from "../lib/prefs";

interface Props {
  open: boolean;
  onClose: () => void;
  onActivateTrial: () => void;
  onEndTrial: () => void;
}

function Tone({ value }: { value: string | boolean }) {
  if (value === true) {
    return (
      <span className="cmp-yes" aria-label="포함">
        <Check size={13} strokeWidth={3} />
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="cmp-no" aria-label="미포함">
        <Minus size={12} />
      </span>
    );
  }
  return <span className="cmp-text">{value}</span>;
}

function PlanCard({
  def,
  cycle,
  current,
  trial,
  onActivateTrial,
  onEndTrial,
  onTeamNote,
}: {
  def: PlanDef;
  cycle: BillingCycle;
  current: PlanId;
  trial: boolean;
  onActivateTrial: () => void;
  onEndTrial: () => void;
  onTeamNote: () => void;
}) {
  const isCurrent = current === def.id;
  const saving = annualSaving(def);
  const onTrial = isCurrent && def.id !== "free" && trial;

  return (
    <section
      className="plan-card"
      data-plan={def.id}
      data-highlight={def.highlight ? "true" : "false"}
      data-current={isCurrent ? "true" : "false"}
      data-testid={`plan-card-${def.id}`}
    >
      <header className="plan-head">
        <div className="plan-name">
          <h3>{def.name}</h3>
          <span className="plan-ko">{def.ko}</span>
        </div>
        {def.highlight && <span className="plan-flag">추천</span>}
        {isCurrent && <span className="plan-now">{onTrial ? "체험 중" : "현재 플랜"}</span>}
      </header>

      <p className="plan-tagline">{def.tagline}</p>

      <p className="plan-price" data-testid={`price-${def.id}`}>
        {priceLabel(def, cycle)}
        {cycle === "annual" && saving > 0 && <span className="plan-saving">{saving.toLocaleString("ko-KR")}원 절약</span>}
      </p>
      {def.price.monthly !== null && def.price.monthly > 0 && (
        <p className="plan-price-note">
          {cycle === "monthly" ? "매월 결제 · 부가세 포함" : "1년 한 번 결제 · 2개월 무료"}
        </p>
      )}
      {def.price.monthly === 0 && <p className="plan-price-note">카드 없이 바로 시작</p>}

      <ul className="plan-list">
        {def.includes.map((item) => (
          <li key={item}>
            <Check size={13} strokeWidth={2.6} />
            {item}
          </li>
        ))}
        {def.excludes?.map((item) => (
          <li key={item} className="is-off">
            <Minus size={12} />
            {item}
          </li>
        ))}
      </ul>

      {def.id === "free" && (
        <div className="plan-cta-stack">
          <button
            type="button"
            className="plan-cta is-ghost"
            onClick={onEndTrial}
            disabled={current === "free"}
            data-testid="plan-free-cta"
          >
            {current === "free" ? "지금 쓰는 중" : "Free로 돌아가기"}
          </button>
          <p className="plan-cta-note">카드 없이, 오늘 바로</p>
        </div>
      )}
      {def.id === "pro" && (
        <div className="plan-cta-stack">
          <button
            type="button"
            className="plan-cta is-solid"
            onClick={onActivateTrial}
            disabled={onTrial}
            data-testid="plan-pro-cta"
          >
            {onTrial ? "체험 사용 중" : `${TRIAL_DAYS}일 무료 체험 켜기`}
            {!onTrial && <Sparkles size={14} />}
          </button>
          <p className="plan-cta-note">결제 연동 전 데모 — 카드 정보 없이 열립니다</p>
        </div>
      )}
      {def.id === "team" && (
        <div className="plan-cta-stack">
          <button type="button" className="plan-cta is-line" onClick={onTeamNote} data-testid="plan-team-cta">
            팀 스튜디오 문의
            <ArrowUpRight size={14} />
          </button>
          <p className="plan-cta-note">결제 연동 단계에서 함께 열립니다</p>
        </div>
      )}
    </section>
  );
}

/** 요금제 — 가격표·기능 비교·Pro 무료 체험을 한 화면에서. */
export function PricingSheet({ open, onClose, onActivateTrial, onEndTrial }: Props) {
  const prefs = usePlan();
  const [cycle, setCycle] = useState<BillingCycle>(prefs.billing);
  const [teamNote, setTeamNote] = useState(false);

  const active = useMemo(() => planLabel(prefs.plan, prefs.trial), [prefs.plan, prefs.trial]);

  if (!open) return null;

  return (
    <div className="sheet-backdrop pricing-backdrop" onClick={onClose} role="presentation" data-testid="pricing-sheet">
      <div
        className="pricing"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="요금제"
      >
        <header className="pricing-head">
          <div className="pricing-head-text">
            <span className="eyebrow">PLANS &amp; BILLING</span>
            <h2>요금제</h2>
            <p>
              지금은 <b>{active}</b>입니다. Creator Pro를 {TRIAL_DAYS}일 무료 체험으로 열어 5장 ZIP·@핸들·테마 4종을
              먼저 써 볼 수 있어요. 결제는 다음 단계에서 연결됩니다.
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="요금제 닫기" data-testid="close-pricing">
            <X size={18} />
          </button>
        </header>

        <div className="pricing-scroll">
          <div className="billing-toggle" role="group" aria-label="결제 주기">
            <button
              type="button"
              data-on={cycle === "monthly"}
              aria-pressed={cycle === "monthly"}
              onClick={() => setCycle("monthly")}
              data-testid="billing-monthly"
            >
              월 결제
            </button>
            <button
              type="button"
              data-on={cycle === "annual"}
              aria-pressed={cycle === "annual"}
              onClick={() => setCycle("annual")}
              data-testid="billing-annual"
            >
              연 결제
              <span className="billing-save">2개월 무료</span>
            </button>
          </div>

          <div className="plan-grid">
            {PLANS.map((def) => (
              <PlanCard
                key={def.id}
                def={def}
                cycle={cycle}
                current={prefs.plan}
                trial={prefs.trial}
                onActivateTrial={() => {
                  onActivateTrial();
                  setTeamNote(false);
                }}
                onEndTrial={onEndTrial}
                onTeamNote={() => setTeamNote(true)}
              />
            ))}
          </div>

          {teamNote && (
            <p className="pricing-note" role="status" data-testid="team-note">
              팀 스튜디오는 결제 연동과 함께 열립니다. 그전까지는 Creator Pro 무료 체험으로 브랜드 킷을 확인해 보세요.
            </p>
          )}

          <section className="cmp" aria-label="플랜별 기능 비교">
            <div className="cmp-head">
              <h3>기능 비교</h3>
              <span className="cmp-hint">Free → Pro에서 열리는 것</span>
            </div>
            <div className="cmp-scroll">
              <table className="cmp-table" data-testid="feature-table">
                <thead>
                  <tr>
                    <th scope="col">기능</th>
                    {PLANS.map((def) => (
                      <th key={def.id} scope="col" data-on={def.highlight ? "true" : "false"}>
                        {def.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FEATURE_MATRIX.map((row) => (
                    <tr key={row.key}>
                      <th scope="row">
                        {row.label}
                        {row.note && <span>{row.note}</span>}
                      </th>
                      <td>
                        <Tone value={row.value.free} />
                      </td>
                      <td data-on="true">
                        <Tone value={row.value.pro} />
                      </td>
                      <td>
                        <Tone value={row.value.team} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="pricing-fine">
            가격은 부가세 포함 · 언제든 해지 · 카드에 박히는 PNG는 저장한 그대로 남습니다. 결제 연동 전이라 지금은 무료
            체험만 열리며, 체험을 끄면 Free로 돌아갑니다.
          </p>
        </div>
      </div>
    </div>
  );
}
