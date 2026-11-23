/**
 * 크리에이터 설정을 브라우저에 남깁니다 — 계정도 서버도 없이 이 기기에서만.
 *
 *  · 브랜드   : 카드 테마 + 워터마크 @핸들
 *  · 워크플로 : 저장함(북마크) · 발행 완료 체크
 *  · 문구     : 카드별로 고친 헤드라인·본문·팩트·A/B
 *  · 캡션     : 인스타 캡션 직접 고친 문장
 *
 * 서버로는 아무것도 보내지 않고, 개인정보도 담지 않습니다.
 * 값이 깨져 있으면(직접 고쳤거나 예전 버전) 조용히 기본값으로 되돌립니다.
 */

import { useSyncExternalStore } from "react";
import { CARD_THEMES, DEFAULT_THEME, type CardThemeId } from "./theme";
import { entitlements, type BillingCycle, type PlanId } from "./plan";
import type { CardCopyEdits } from "../types";

type Listener = () => void;

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

class LocalStore<T> {
  private value: T;
  private listeners = new Set<Listener>();
  private ready = false;

  constructor(
    private key: string,
    private fallback: T,
    private clean: (value: unknown) => T | null,
  ) {
    this.value = fallback;
  }

  private load(): void {
    if (this.ready) return;
    this.ready = true;
    const raw = readJson(this.key);
    const cleaned = raw === null ? null : this.clean(raw);
    if (cleaned !== null) this.value = cleaned;
  }

  get = (): T => {
    this.load();
    return this.value;
  };

  set = (next: T | ((prev: T) => T)): void => {
    this.load();
    const value = typeof next === "function" ? (next as (prev: T) => T)(this.value) : next;
    this.value = value;
    try {
      localStorage.setItem(this.key, JSON.stringify(value));
    } catch {
      /* 저장 공간이 없으면 이번 방문에만 적용됩니다 */
    }
    for (const listener of this.listeners) listener();
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1 && typeof window !== "undefined") {
      window.addEventListener("storage", this.onStorage);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && typeof window !== "undefined") {
        window.removeEventListener("storage", this.onStorage);
      }
    };
  };

  private onStorage = (event: StorageEvent): void => {
    if (event.key !== this.key) return;
    const cleaned = event.newValue === null ? null : this.clean(safeParse(event.newValue));
    this.value = cleaned ?? this.fallback;
    this.ready = true;
    for (const listener of this.listeners) listener();
  };

  useValue = (): T => useSyncExternalStore(this.subscribe, this.get, this.get);
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ 브랜드 */

export interface BrandPrefs {
  theme: CardThemeId;
  /** 카드마다 박히는 워터마크. 비우면 서비스 이름(이슈온도계)이 들어갑니다. */
  handle: string;
}

const HANDLE_MAX = 24;

/** "@my_channel" 처럼 다듬습니다 — 공백·특수문자는 지우고 골뱅이 하나만 남깁니다. */
export function normalizeHandle(input: string): string {
  const body = input
    .trim()
    .replace(/^@+/, "")
    .replace(/[^\w가-힣ㄱ-ㅎㅏ-ㅣ.:-]/g, "")
    .slice(0, HANDLE_MAX);
  return body ? `@${body}` : "";
}

const brandStore = new LocalStore<BrandPrefs>(
  "issue-thermo.brand.v1",
  { theme: DEFAULT_THEME, handle: "" },
  (value) => {
    if (!value || typeof value !== "object") return null;
    const raw = value as Partial<BrandPrefs>;
    const theme = typeof raw.theme === "string" && raw.theme in CARD_THEMES ? (raw.theme as CardThemeId) : DEFAULT_THEME;
    const handle = typeof raw.handle === "string" ? normalizeHandle(raw.handle) : "";
    return { theme, handle };
  },
);

export function useBrand(): BrandPrefs {
  return brandStore.useValue();
}

/** 화면·카드에 실제로 쓰이는 브랜드 — 플랜이 잠근 값은 기본값으로 걷어 냅니다. */
export function useActiveBrand(): BrandPrefs {
  const brand = brandStore.useValue();
  const plan = planStore.useValue();
  return effectiveBrand(brand, plan.plan);
}

export function setBrand(patch: Partial<BrandPrefs>): void {
  brandStore.set((prev) => ({ ...prev, ...patch }));
}

/**
 * 플랜이 잠그는 값을 걷어 낸 브랜드 설정.
 * Free로 내려가면 저장해 둔 @핸들·테마는 그대로 두되 카드에는 기본값으로 그립니다.
 */
export function effectiveBrand(
  brand: BrandPrefs,
  plan: PlanId,
): BrandPrefs {
  const can = entitlements(plan);
  return {
    handle: can.customHandle ? brand.handle : "",
    theme: can.allThemes ? brand.theme : DEFAULT_THEME,
  };
}

/* ------------------------------------------------------------------ 플랜 */

export interface PlanPrefs {
  plan: PlanId;
  /** 결제 연동 전 데모 체험으로 열었는지 — 화면에 '체험'으로 적습니다. */
  trial: boolean;
  billing: BillingCycle;
}

const PLAN_DEFAULT: PlanPrefs = { plan: "free", trial: false, billing: "monthly" };

const planStore = new LocalStore<PlanPrefs>("issue-thermo.plan.v1", PLAN_DEFAULT, (value) => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<PlanPrefs>;
  const plan: PlanId = raw.plan === "pro" || raw.plan === "team" ? raw.plan : "free";
  const billing: BillingCycle = raw.billing === "annual" ? "annual" : "monthly";
  return { plan, billing, trial: plan !== "free" ? Boolean(raw.trial) : false };
});

export function usePlan(): PlanPrefs {
  return planStore.useValue();
}

export function setPlan(patch: Partial<PlanPrefs>): void {
  planStore.set((prev) => {
    const next = { ...prev, ...patch };
    return { ...next, trial: next.plan === "free" ? false : next.trial };
  });
}

/** Creator Pro 무료 체험 — 결제 없이 Pro 기능을 열어 봅니다. */
export function activateProTrial(): void {
  planStore.set((prev) => ({ ...prev, plan: "pro", trial: true }));
}

/** 체험을 끄고 Free로 돌아갑니다(카드에 박히던 @핸들은 다시 기본값). */
export function endTrial(): void {
  planStore.set((prev) => ({ ...prev, plan: "free", trial: false }));
}

/* --------------------------------------------------------------- 워크플로 */

export interface Workflow {
  /** 저장함 — 최근에 저장한 것이 앞 */
  saved: string[];
  /** 발행 완료 체크 — 최근에 체크한 것이 앞 */
  published: string[];
}

const WORKFLOW_MAX = 300;

const workflowStore = new LocalStore<Workflow>(
  "issue-thermo.workflow.v1",
  { saved: [], published: [] },
  (value) => {
    if (!value || typeof value !== "object") return null;
    const raw = value as Partial<Workflow>;
    const ids = (input: unknown): string[] =>
      Array.isArray(input)
        ? [...new Set(input.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length < 80))].slice(
            0,
            WORKFLOW_MAX,
          )
        : [];
    return { saved: ids(raw.saved), published: ids(raw.published) };
  },
);

export function useWorkflow(): Workflow {
  return workflowStore.useValue();
}

export function toggleList(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [id, ...list];
}

export function toggleSaved(id: string): void {
  workflowStore.set((prev) => ({ ...prev, saved: toggleList(prev.saved, id) }));
}

export function togglePublished(id: string): void {
  workflowStore.set((prev) => ({ ...prev, published: toggleList(prev.published, id) }));
}

/* ------------------------------------------------------------ 카드 문구 */

const copyStore = new LocalStore<Record<string, CardCopyEdits>>(
  "issue-thermo.copy.v1",
  {},
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const out: Record<string, CardCopyEdits> = {};
    for (const [id, edits] of Object.entries(value as Record<string, unknown>)) {
      if (!id || !edits || typeof edits !== "object") continue;
      const raw = edits as Record<string, unknown>;
      const text = (input: unknown, max = 220): string | undefined =>
        typeof input === "string" ? input.slice(0, max) : undefined;
      const next: CardCopyEdits = {};
      for (const key of ["hook", "kicker", "background", "point", "labelA", "labelB", "sideA", "sideB", "question", "optionA", "optionB"] as const) {
        const entry = text(raw[key]);
        if (entry !== undefined) next[key] = entry;
      }
      if (Array.isArray(raw.facts)) {
        next.facts = raw.facts.slice(0, 3).map((fact) => (typeof fact === "string" ? fact.slice(0, 220) : ""));
      }
      if (Object.keys(next).length > 0) out[id] = next;
    }
    return out;
  },
);

export function useCopies(): Record<string, CardCopyEdits> {
  return copyStore.useValue();
}

export function saveCopy(id: string, edits: CardCopyEdits): void {
  copyStore.set((prev) => ({ ...prev, [id]: edits }));
}

export function clearCopy(id: string): void {
  copyStore.set((prev) => {
    const next = { ...prev };
    delete next[id];
    return next;
  });
}

/* ----------------------------------------------------------------- 캡션 */

const captionStore = new LocalStore<Record<string, string>>(
  "issue-thermo.caption.v1",
  {},
  (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const out: Record<string, string> = {};
    for (const [id, text] of Object.entries(value as Record<string, unknown>)) {
      if (id && typeof text === "string" && text.trim()) out[id] = text.slice(0, 2200);
    }
    return out;
  },
);

export function useCaptions(): Record<string, string> {
  return captionStore.useValue();
}

export function saveCaption(id: string, text: string): void {
  captionStore.set((prev) => ({ ...prev, [id]: text.slice(0, 2200) }));
}

export function clearCaption(id: string): void {
  captionStore.set((prev) => {
    const next = { ...prev };
    delete next[id];
    return next;
  });
}
