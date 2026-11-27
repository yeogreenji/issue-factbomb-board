import { CalendarDays } from "lucide-react";

export interface DayOption {
  /** 한국 날짜 YYYY-MM-DD */
  date: string;
  /** 칩에 보이는 문구 — "오늘 (11/27)" */
  label: string;
  /** 그 날짜에 꺼낼 수 있는 카드 수(없으면 0) */
  count: number;
  active: boolean;
  /** 아직 카드가 없는 날짜 — 눌러도 빈 화면이 되지 않게 흐리게 둡니다. */
  empty?: boolean;
}

interface Props {
  days: DayOption[];
  /** 화면이 지금 보여 주는 날짜 문구 — "오늘 카드 5장" 처럼 아래에 적습니다. */
  activeLabel: string;
  activeCount: number;
  loading: boolean;
  onSelect: (date: string) => void;
}

/**
 * 날짜 줄 — 오늘·어제·그제 카드를 오가며 다시 올립니다.
 * 하루가 지나도 사라지지 않게 보관한 날짜만 보여 주고, 카드 수를 함께 적습니다.
 */
export function DayBar({ days, activeLabel, activeCount, loading, onSelect }: Props) {
  const showingPast = days.some((day) => day.active && day.date !== days[0]?.date);
  return (
    <section className="daybar" data-testid="day-bar" aria-label="날짜별 카드">
      <div className="daybar-head">
        <span className="daybar-title">
          <CalendarDays size={13} aria-hidden="true" /> 날짜별 보관
        </span>
        <span className="daybar-note" data-testid="day-bar-note">
          {loading ? "그날 카드를 꺼내는 중…" : `${activeLabel} 카드 ${activeCount}장`}
        </span>
      </div>

      <div className="daybar-chips">
        {days.map((day, index) => (
          <button
            key={day.date}
            type="button"
            data-on={day.active}
            data-empty={day.empty ? "true" : "false"}
            aria-pressed={day.active}
            title={day.empty ? `${day.label} — 보관된 카드가 없어요` : `${day.label} 카드 ${day.count}장`}
            onClick={() => onSelect(day.date)}
            data-testid={index === 0 ? "day-tab-today" : `day-tab-${index}`}
            data-date={day.date}
          >
            <span className="daybar-label">{day.label}</span>
            <span className="daybar-count">{day.count > 0 ? day.count : "—"}</span>
          </button>
        ))}
      </div>

      {showingPast && (
        <p className="daybar-hint">
          지난 날짜 카드도 그대로 꺼내 올릴 수 있어요. 저장함·발행 완료 표시와 고친 문구는 카드에 남아 있습니다.
        </p>
      )}
    </section>
  );
}
