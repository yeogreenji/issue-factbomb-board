import { useCallback, useRef, useState } from "react";
import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";

/** 손끝이 움직이기 시작한 뒤 가로/세로 중 어느 쪽 제스처인지 판별하는 최소 거리(px) */
const AXIS_LOCK = 6;
/** 이만큼은 끌어야 손을 뗐을 때 다음 장으로 넘어간다(px). 화면 폭의 16%와 비교해 더 큰 쪽 */
const MIN_TRAVEL = 48;
/** 짧게 튕겼을 때(px/ms)도 한 장 넘어간다 */
const MIN_FLICK = 0.4;
/** 가장자리에서 더 끌 때의 저항(0.3 = 30%만 따라옴) */
const EDGE_RESISTANCE = 0.3;
/** 드래그 직후 따라오는 click을 무시하는 시간(ms) */
const CLICK_GUARD_MS = 260;
/** 이만큼(px) 넘게 움직였을 때만 뒤따르는 클릭을 막습니다(탭의 손떨림은 살림) */
const CLICK_GUARD_DISTANCE = 10;

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastAt: number;
  dx: number;
  vx: number;
  axis: "x" | "y" | null;
}

interface Handlers {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onClickCapture: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onDragStart: (event: ReactDragEvent<HTMLDivElement>) => void;
}

export interface SwipeDeck {
  index: number;
  /** 손가락/마우스를 받는 바깥 프레임 */
  wrapRef: RefObject<HTMLDivElement | null>;
  /** 좌우로 밀리는 카드 줄 — style.transform을 직접 만집니다 */
  trackRef: RefObject<HTMLDivElement | null>;
  go: (delta: number) => void;
  jump: (target: number) => void;
  handlers: Handlers;
}

const clampIndex = (value: number, length: number) => Math.min(length - 1, Math.max(0, value));

/**
 * 카드뉴스를 '버튼을 눌렀을 때만 점프'가 아니라 손끝·마우스를 실시간으로 따라 밀리게 하는 훅.
 * - pointerdown/move/up으로 translate3d를 매 프레임 직접 갱신(리렌더 없이 60fps 추종)
 * - 손을 떼면 이동 거리/속도로 다음·이전 장을 정하고 CSS transition으로 스냅
 * - 세로 스크롤(touch-action: pan-y)과 충돌하지 않도록 첫 6px에서 축을 잠급니다
 */
export function useSwipeDeck(length: number, initial = 0): SwipeDeck {
  const [index, setIndex] = useState(initial);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const guardUntil = useRef(0);

  const paint = useCallback((slide: number, offset: number, live: boolean) => {
    const track = trackRef.current;
    if (!track) return;
    track.style.transition = live ? "none" : "";
    track.style.transform =
      offset === 0
        ? `translate3d(${-slide * 100}%, 0, 0)`
        : `translate3d(calc(${-slide * 100}% + ${offset}px), 0, 0)`;
  }, []);

  const jump = useCallback(
    (target: number) => {
      setIndex(clampIndex(target, length));
    },
    [length],
  );

  const go = useCallback(
    (delta: number) => {
      setIndex((current) => clampIndex(current + delta, length));
    },
    [length],
  );

  const settle = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      wrapRef.current?.classList.remove("is-dragging");

      if (drag.axis !== "x" || cancelled) {
        paint(index, 0, false);
        return;
      }

      const width = wrapRef.current?.clientWidth || 1;
      const travel = Math.abs(drag.dx) > Math.max(MIN_TRAVEL, width * 0.16);
      const flick = Math.abs(drag.vx) > MIN_FLICK && Math.abs(drag.dx) > 14 ? Math.sign(drag.vx) : 0;
      const step = drag.dx < 0 ? 1 : -1;
      const next = travel || flick ? clampIndex(index + (travel ? step : -flick), length) : index;

      paint(next, 0, false);
      if (next !== index) setIndex(next);
      guardUntil.current = performance.now() + CLICK_GUARD_MS;
    },
    [index, length, paint],
  );

  const handlers: Handlers = {
    onPointerDown: (event) => {
      if (!event.isPrimary) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      // 글자를 고르거나 커서를 놓는 입력칸에서만 드래그를 시작하지 않습니다.
      // 버튼·링크도 끌기는 되지만, 끌지 않고 그냥 누르면 원래대로 클릭이 동작합니다(포인터 캡처는 임계값을 넘긴 뒤에만).
      if (target?.closest("input, textarea, select")) return;
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastAt: event.timeStamp,
        dx: 0,
        vx: 0,
        axis: null,
      };
    },
    onPointerMove: (event) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;

      if (!drag.axis) {
        if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
        drag.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        if (drag.axis === "y") return; // 세로는 카드 안 스크롤에 맡깁니다
        // 가로로 끌기 시작한 뒤에만 포인터를 붙잡습니다.
        // (누르기만 할 때 붙잡으면 버튼 클릭이 엉뚱한 곳으로 갈 수 있습니다)
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* 캡처가 막히는 브라우저는 그냥 진행 */
        }
        wrapRef.current?.classList.add("is-dragging");
      }
      if (drag.axis !== "x") return;

      const elapsed = event.timeStamp - drag.lastAt;
      if (elapsed > 0) drag.vx = (event.clientX - drag.lastX) / elapsed;
      drag.lastX = event.clientX;
      drag.lastAt = event.timeStamp;
      drag.dx = dx;

      const atEdge = (index === 0 && dx > 0) || (index === length - 1 && dx < 0);
      paint(index, atEdge ? dx * EDGE_RESISTANCE : dx, true);
      // 살짝 흔들린 탭은 살리고, 실제로 끌었다고 볼 만큼 움직였을 때만 뒤따르는 클릭을 막습니다
      if (Math.abs(dx) > CLICK_GUARD_DISTANCE) guardUntil.current = performance.now() + CLICK_GUARD_MS;
    },
    onPointerUp: (event) => settle(event, false),
    onPointerCancel: (event) => settle(event, true),
    onClickCapture: (event) => {
      if (performance.now() < guardUntil.current) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    onDragStart: (event) => event.preventDefault(),
  };

  return { index, wrapRef, trackRef, go, jump, handlers };
}
