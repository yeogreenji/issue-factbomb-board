import { useEffect, useRef } from "react";

interface Props {
  message: string | null;
  onDone: () => void;
  /** 모달·시트가 열려 있으면 위쪽에 띄웁니다 — 아래에 두면 저장 버튼을 가립니다. */
  aboveDialog?: boolean;
}

/**
 * 한 줄 안내 — 복사됨/실패처럼 짧게 알려 주고 사라집니다.
 * 버튼 위에 뜨더라도 누르는 것을 막지 않도록 pointer-events는 CSS에서 끕니다.
 */
export function Toast({ message, onDone, aboveDialog = false }: Props) {
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  /* 부모가 다시 그려져도 시간이 처음부터 돌지 않게 message만 봅니다. */
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => doneRef.current(), 2600);
    return () => window.clearTimeout(timer);
  }, [message]);

  if (!message) return null;
  return (
    <div
      className="toast"
      role="status"
      aria-live="polite"
      data-modal={aboveDialog ? "true" : "false"}
      data-testid="toast"
    >
      {message}
    </div>
  );
}
