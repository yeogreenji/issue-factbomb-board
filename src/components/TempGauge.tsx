import { Flame } from "lucide-react";
import { tempLabel } from "../lib/format";

interface Props {
  temp: number | null;
  size?: "sm" | "lg";
  showBand?: boolean;
}

/** 논란 온도 0~100° — 숫자와 게이지를 같이 보여 줍니다(측정 전이면 솔직하게 표시). */
export function TempGauge({ temp, size = "sm", showBand = false }: Props) {
  if (temp === null) {
    return (
      <span className={`temp temp-${size} is-unmeasured`}>
        <span className="temp-num">–</span>
        <span className="temp-unit">°</span>
        {showBand && <span className="temp-band">온도 미측정</span>}
      </span>
    );
  }
  return (
    <span
      className={`temp temp-${size}`}
      data-band={band(temp)}
      style={{ ["--pct" as string]: `${Math.min(100, Math.max(0, temp))}%` }}
      title={`논란 온도 ${temp}° · ${tempLabel(temp)}`}
    >
      <Flame className="temp-flame" size={size === "lg" ? 14 : 11} aria-hidden="true" />
      <span className="temp-num">{temp}</span>
      <span className="temp-unit">°</span>
      {showBand && <span className="temp-band">{tempLabel(temp)}</span>}
      <span className="temp-track" aria-hidden="true">
        <span className="temp-fill" />
        <span className="temp-marker" style={{ left: `${Math.min(100, Math.max(0, temp))}%` }} />
      </span>
    </span>
  );
}

function band(temp: number): "hot" | "warm" | "cool" {
  if (temp >= 70) return "hot";
  if (temp >= 45) return "warm";
  return "cool";
}
