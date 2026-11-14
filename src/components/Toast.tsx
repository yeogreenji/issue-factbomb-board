import { useEffect } from 'react';
import { Check } from 'lucide-react';

export function Toast({
  message,
  onDone,
}: {
  message: string | null;
  onDone: () => void;
}) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDone, 3600);
    return () => window.clearTimeout(timer);
  }, [message, onDone]);

  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="animate-pop pointer-events-none fixed inset-x-0 bottom-6 z-[80] flex justify-center px-4"
    >
      <div className="pointer-events-auto flex max-w-[92vw] items-center gap-2.5 rounded-full bg-ink px-4 py-2.5 text-[12.5px] font-medium text-paper shadow-[0_20px_50px_-20px_rgba(23,19,15,0.8)]">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-heat text-white">
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
        <span className="leading-snug">{message}</span>
      </div>
    </div>
  );
}
