import { useEffect } from "react";

interface Props {
  message: string | null;
  onDone: () => void;
}

/** 한 줄 안내 — 복사됨/실패처럼 짧게 알려 주고 사라집니다. */
export function Toast({ message, onDone }: Props) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDone, 2600);
    return () => window.clearTimeout(timer);
  }, [message, onDone]);

  if (!message) return null;
  return (
    <div className="toast" role="status" data-testid="toast">
      {message}
    </div>
  );
}
