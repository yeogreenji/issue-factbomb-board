import { Cloud, Cpu, KeyRound, RefreshCw, WifiOff } from 'lucide-react';
import type { AiHealth, BoardMode, StoreKind } from '../lib/api';
import type { BoardStatus } from '../hooks/useBoard';
import { cn } from './ui';

const STORE_LABEL: Record<StoreKind, string> = {
  redis: 'Upstash Redis',
  supabase: 'Supabase',
  memory: '임시 저장소',
};

/**
 * 상단 연결 상태 스트립.
 * 지금 데이터가 어디에 저장되는지, AI가 실제로 붙어 있는지 숨기지 않고 그대로 보여 줍니다.
 */
export function ConnectionStrip({
  status,
  mode,
  store,
  syncEnabled,
  pending,
  notice,
  ai,
  onOpenKey,
  onRefresh,
}: {
  status: BoardStatus;
  mode: BoardMode;
  store: StoreKind | null;
  syncEnabled: boolean;
  pending: number;
  notice: string | null;
  ai: AiHealth & { personalKey: boolean; ready: boolean };
  onOpenKey: () => void;
  onRefresh: () => void;
}) {
  const connecting = status === 'connecting';
  const shared = mode === 'shared' && syncEnabled;

  const dbText = connecting ? '연결 확인 중' : shared ? '실시간 공용 DB' : '로컬 체험 모드';
  const aiText = connecting ? 'AI 확인 중' : ai.ready ? '실시간 AI' : '규칙 요약';

  const dbHint = connecting
    ? '서버에 연결이 되는지 확인하고 있습니다.'
    : shared
      ? `${STORE_LABEL[store ?? 'memory']}에 저장됩니다. 다른 사람이 남긴 투표·팩폭이 함께 보입니다.`
      : syncEnabled
        ? '서버는 연결됐지만 공용 DB 환경변수가 없어 임시 저장소에 저장됩니다(재시작 시 초기화).'
        : '정적 호스팅 모드입니다. 발행·투표·팩폭이 이 브라우저에만 저장됩니다.';

  const aiHint = ai.ready
    ? ai.serverKey
      ? `서버 키(${ai.provider === 'gemini' ? 'Google Gemini' : ai.provider === 'openai' ? 'OpenAI' : 'AI'})로 ${ai.model}을(를) 사용합니다.`
      : '이 브라우저에 저장한 개인 키로 AI를 호출합니다.'
    : 'AI 키가 없어 규칙 요약으로 초안을 만듭니다. 모든 기능은 그대로 동작합니다.';

  return (
    <div className="border-b border-line/70 bg-paper-deep/45">
      <div className="mx-auto flex h-9 w-full max-w-[1240px] items-center gap-1.5 overflow-hidden px-4 sm:gap-2 sm:px-6">
        <span
          title={dbHint}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-[3px] text-[10px] font-semibold',
            shared
              ? 'border-work/25 bg-work-soft text-work'
              : connecting
                ? 'border-line bg-surface text-muted'
                : 'border-line-strong bg-surface text-muted',
          )}
          data-testid="status-db"
        >
          {shared ? <Cloud className="h-3 w-3" aria-hidden="true" /> : <WifiOff className="h-3 w-3" aria-hidden="true" />}
          {dbText}
        </span>

        <button
          type="button"
          onClick={onOpenKey}
          title={aiHint}
          className={cn(
            'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-[3px] text-[10px] font-semibold transition',
            ai.ready
              ? 'border-heat/30 bg-heat-soft text-heat hover:border-heat/50'
              : 'border-line bg-surface text-muted hover:border-line-strong hover:text-ink-2',
          )}
          data-testid="status-ai"
        >
          <Cpu className="h-3 w-3" aria-hidden="true" />
          {aiText}
          {ai.ready && !ai.serverKey ? <KeyRound className="h-2.5 w-2.5" aria-hidden="true" /> : null}
        </button>

        {pending > 0 && syncEnabled ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-gold/30 bg-gold-soft px-2 py-[3px] text-[10px] font-semibold text-gold"
            data-testid="status-pending"
            title="공용 보드에 아직 못 올린 작업입니다. 연결되면 자동으로 다시 올립니다."
          >
            동기화 대기 {pending}
          </span>
        ) : null}

        <span className="ml-auto hidden min-w-0 truncate text-[10px] leading-none text-faint md:block">
          {notice ?? (shared ? dbHint : ai.ready ? aiHint : dbHint)}
        </span>

        <button
          type="button"
          onClick={onRefresh}
          aria-label="공용 보드 새로고침"
          className="ml-auto shrink-0 rounded-full p-1 text-faint transition hover:bg-surface hover:text-ink md:ml-0"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
