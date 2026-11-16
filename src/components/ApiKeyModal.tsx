import { useEffect, useState } from 'react';
import { KeyRound, ShieldCheck, X } from 'lucide-react';
import type { AiHealth } from '../lib/api';

/**
 * AI 키 설정. 서버 환경변수에 키가 있으면 그 키가 우선이고,
 * 없을 때만 이 브라우저에 저장한 개인 키를 초안 생성 요청에 실어 보냅니다.
 */
export function ApiKeyModal({
  ai,
  onSave,
  onClose,
}: {
  ai: AiHealth & { personalKey: boolean; ready: boolean };
  onSave: (key: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const serverLabel = ai.provider === 'gemini' ? 'Gemini' : ai.provider === 'openai' ? 'OpenAI' : 'AI';

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-night/70 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-key-title"
        className="animate-pop w-full max-w-md overflow-hidden rounded-t-3xl border border-line bg-paper shadow-float sm:rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <p className="mono text-[9.5px] uppercase tracking-[0.16em] text-faint">AI briefing</p>
            <h2 id="ai-key-title" className="serif mt-0.5 flex items-center gap-1.5 text-[17px] font-bold text-ink">
              <KeyRound className="h-4 w-4 text-heat" />
              실시간 AI 설정
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded-full p-2 text-muted transition hover:bg-paper-deep hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div className="rounded-xl border border-line bg-surface px-3.5 py-3 text-[11.5px] leading-relaxed text-ink-2">
            <p className="flex items-center justify-between gap-2">
              <span className="font-semibold">서버 상태</span>
              <span className={ai.serverKey ? 'text-work' : 'text-muted'}>
                {ai.serverKey ? `연결됨 · ${serverLabel} ${ai.model}` : '서버 키 없음'}
              </span>
            </p>
            <p className="flex items-center justify-between gap-2">
              <span className="font-semibold">이 브라우저 키</span>
              <span className={ai.personalKey ? 'text-heat' : 'text-muted'}>{ai.personalKey ? '저장됨' : '없음'}</span>
            </p>
          </div>

          <p className="text-[11.5px] leading-relaxed text-muted">
            서버에{' '}
            <code className="mono rounded bg-paper-deep px-1 py-0.5 text-[10.5px]">GEMINI_API_KEY</code> 또는{' '}
            <code className="mono rounded bg-paper-deep px-1 py-0.5 text-[10.5px]">OPENAI_API_KEY</code> 가 없을 때만
            쓰입니다. 키가 없어도 모든 기능이 동작하고, 초안은 <strong className="font-semibold text-ink-2">규칙 요약</strong>으로
            만들어집니다.
          </p>

          <div>
            <label htmlFor="ai-key" className="text-[11.5px] font-semibold text-ink-2">
              Gemini 또는 OpenAI API 키
            </label>
            <input
              id="ai-key"
              type="password"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="AQ.… (Gemini) 또는 sk-… (OpenAI)"
              autoComplete="off"
              spellCheck={false}
              className="mt-1.5 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-[12.5px] text-ink outline-none transition placeholder:text-faint focus:border-ink/30"
            />
          </div>

          <p className="flex items-start gap-1.5 rounded-xl bg-paper-deep/60 px-3 py-2 text-[10.5px] leading-relaxed text-muted">
            <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-work" aria-hidden="true" />
            이 브라우저(localStorage)에만 저장되고, 초안 생성 요청 본문에만 실려 사이트의 <code className="mono">/api/briefing</code>{' '}
            프록시를 거쳐 Gemini(<code className="mono">AQ.…</code>) 또는 OpenAI(<code className="mono">sk-…</code>)로
            전달됩니다. 주소·서버 로그·화면에는 남기지 않습니다.
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onSave(value);
                onClose();
              }}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-heat px-4 py-2.5 text-[12.5px] font-bold text-white transition hover:bg-heat-deep"
            >
              저장
            </button>
            <button
              type="button"
              onClick={() => {
                setValue('');
                onSave('');
                onClose();
              }}
              className="rounded-xl border border-line px-3.5 py-2.5 text-[12px] font-semibold text-muted transition hover:border-line-strong hover:text-ink"
            >
              키 지우기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
