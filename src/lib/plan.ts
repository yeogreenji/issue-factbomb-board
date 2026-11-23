/**
 * 요금제 — 화면에 보이는 가격표와, 그 가격표가 실제로 잠그는 기능을 한 곳에서 정의합니다.
 *
 * 지금은 결제가 연결되기 전이라 'Creator Pro 무료 체험'만 실제로 열립니다.
 * 결제를 붙일 때는 plan 의 priceId 자리에 상품 ID만 채우면 되고,
 * 화면·잠금 판단은 그대로 씁니다.
 */

export type PlanId = "free" | "pro" | "team";
export type BillingCycle = "monthly" | "annual";

/** 잠금 판단에 쓰는 기능 이름 — 화면 문구와 1:1로 맞춰 둡니다. */
export type FeatureKey = "batchZip" | "customHandle" | "allThemes" | "aiCaption" | "teamSeats";

export interface PlanPrice {
  /** 원/월. 0이면 무료, null이면 문의. */
  monthly: number | null;
  /** 원/년. 2개월 무료 기준. */
  annual: number | null;
  /** 결제 연동 자리 — 지금은 비어 있습니다. */
  priceId: { monthly: string | null; annual: string | null };
}

export interface PlanDef {
  id: PlanId;
  name: string;
  ko: string;
  tagline: string;
  price: PlanPrice;
  includes: string[];
  /** 이 플랜에서 잠기는 것 — 가격표에 흐리게 적어 두면 업그레이드 이유가 보입니다. */
  excludes?: string[];
  cta: string;
  highlight?: boolean;
}

const PRO_MONTHLY = 14_900;
const TEAM_MONTHLY = 39_000;
/** 연 결제 = 12개월 값에서 2개월을 뺍니다(월 환산가를 함께 보여 줍니다). */
const ANNUAL_MONTHS = 10;

export const PLANS: PlanDef[] = [
  {
    id: "free",
    name: "Free",
    ko: "무료",
    tagline: "카드를 한 장씩, 감을 잡는 단계",
    price: { monthly: 0, annual: 0, priceId: { monthly: null, annual: null } },
    includes: [
      "오늘의 이슈로 카드 5장 생성",
      "카드 1장씩 PNG 저장",
      "기본 워터마크(이슈온도계)",
      "에디토리얼 테마 1종",
      "저장함·발행 관리",
    ],
    excludes: ["5장 ZIP 내려받기", "@내 핸들 워터마크", "매거진 테마 4종", "AI 캡션·해시태그"],
    cta: "지금 쓰는 중",
  },
  {
    id: "pro",
    name: "Creator Pro",
    ko: "크리에이터 프로",
    tagline: "매일 3~4장을 올리는 1인 크리에이터",
    price: {
      monthly: PRO_MONTHLY,
      annual: PRO_MONTHLY * ANNUAL_MONTHS,
      priceId: { monthly: null, annual: null },
    },
    includes: [
      "5장을 ZIP 한 번에 내려받기",
      "@내 핸들 워터마크",
      "매거진 테마 4종 전체",
      "AI 캡션·해시태그 12~15개",
      "워터마크 없는 원본 PNG",
    ],
    cta: "Pro 무료 체험 켜기",
    highlight: true,
  },
  {
    id: "team",
    name: "Team Studio",
    ko: "팀 스튜디오",
    tagline: "여럿이 한 브랜드 계정을 함께 운영",
    price: {
      monthly: TEAM_MONTHLY,
      annual: TEAM_MONTHLY * ANNUAL_MONTHS,
      priceId: { monthly: null, annual: null },
    },
    includes: [
      "Creator Pro 전부",
      "팀 멤버 5명",
      "브랜드 킷 공유(테마·핸들·문구)",
      "발행 전 승인 워크플로",
      "전담 지원",
    ],
    cta: "팀 스튜디오 문의",
  },
];

export const PLAN_BY_ID: Record<PlanId, PlanDef> = {
  free: PLANS[0],
  pro: PLANS[1],
  team: PLANS[2],
};

/** 기능 비교표 — 순서대로 그립니다. 값이 false면 그 플랜에서 잠깁니다. */
export const FEATURE_MATRIX: {
  key: string;
  label: string;
  note?: string;
  value: Record<PlanId, string | boolean>;
}[] = [
  { key: "cards", label: "카드 생성", note: "오늘의 이슈 5장", value: { free: "무제한", pro: "무제한", team: "무제한" } },
  { key: "batchZip", label: "5장 ZIP 내려받기", note: "폰에서 5장을 한 번에", value: { free: false, pro: true, team: true } },
  { key: "customHandle", label: "@내 핸들 워터마크", value: { free: false, pro: true, team: true } },
  { key: "allThemes", label: "매거진 테마", value: { free: "1종", pro: "4종 전체", team: "4종 + 팀 테마" } },
  { key: "aiCaption", label: "AI 캡션·해시태그", value: { free: "기본 문장", pro: "12~15개", team: "12~15개 + 톤 3종" } },
  { key: "grid", label: "인스타 3×3 피드 미리보기", value: { free: true, pro: true, team: true } },
  { key: "workflow", label: "저장함·발행 관리", value: { free: true, pro: true, team: true } },
  { key: "seats", label: "팀 멤버", value: { free: "1명", pro: "1명", team: "5명" } },
  { key: "brandkit", label: "브랜드 킷 공유", value: { free: false, pro: false, team: true } },
];

/** 플랜이 실제로 여는 기능 — 화면은 이 값만 보고 잠급니다. */
export function entitlements(plan: PlanId): Record<FeatureKey, boolean> {
  const pro = plan === "pro" || plan === "team";
  return {
    batchZip: pro,
    customHandle: pro,
    allThemes: pro,
    aiCaption: pro,
    teamSeats: plan === "team",
  };
}

export function planLabel(plan: PlanId, trial = false): string {
  const base = PLAN_BY_ID[plan].name;
  if (plan === "free") return `${base} 플랜`;
  return trial ? `${base} · 체험` : base;
}

/** 결제를 붙일 때 넘길 값 — 지금은 priceId가 비어 있어 결제 없이 체험만 열립니다. */
export function checkoutTarget(plan: Exclude<PlanId, "free">, cycle: BillingCycle) {
  const def = PLAN_BY_ID[plan];
  return { plan, cycle, priceId: def.price.priceId[cycle], amount: def.price[cycle] };
}

/** "월 14,900원" · "연 149,000원 (월 12,417원)" */
export function priceLabel(def: PlanDef, cycle: BillingCycle): string {
  const won = (value: number) => value.toLocaleString("ko-KR");
  if (def.price.monthly === null) return "문의";
  if (def.price.monthly === 0) return "0원";
  if (cycle === "monthly") return `월 ${won(def.price.monthly)}원`;
  const annual = def.price.annual ?? def.price.monthly * 12;
  const perMonth = Math.round(annual / 12);
  return `연 ${won(annual)}원 · 월 ${won(perMonth)}원`;
}

/** 연 결제로 바꾸면 아끼는 금액 — 토글 옆에 숫자로 보여 줍니다. */
export function annualSaving(def: PlanDef): number {
  if (!def.price.monthly || def.price.annual === null) return 0;
  return def.price.monthly * 12 - def.price.annual;
}

export const TRIAL_DAYS = 7;
