import { PenLine } from 'lucide-react';
import type { NavKey } from './SiteHeader';

export function Footer({
  onNavigate,
  onReset,
  mode,
}: {
  onNavigate: (key: NavKey) => void;
  onReset: () => void;
  /** 지금 어디에 저장되는지 푸터에서도 숨기지 않습니다. */
  mode: 'shared' | 'local';
}) {
  return (
    <footer className="mt-16 border-t border-line bg-paper-deep/50">
      <div className="mx-auto grid w-full max-w-[1240px] gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2">
            <span className="serif text-[18px] font-bold text-ink">이슈온도계</span>
            <span className="mono rounded-full border border-line-strong px-2 py-0.5 text-[9px] uppercase tracking-[0.16em] text-muted">
              Factbomb Board
            </span>
          </div>
          <p className="mt-3 max-w-sm text-[12px] leading-[1.7] text-muted">
            오늘의 이슈를 30초에 읽는 브리핑 보드. 3줄 요약, 업계인 속마음, 여론 온도계, 그리고 한 줄 팩폭까지
            — PR·마케팅 실무자의 아침을 위해 만들었습니다.
          </p>
          <p className="mt-3 text-[11px] leading-relaxed text-faint">
            이 보드의 기업·브랜드·인물은 모두 가상입니다. 실제 회사나 사건과 무관하며, 예시 콘텐츠로만
            사용됩니다.
          </p>
        </div>

        <div>
          <p className="mono text-[9.5px] uppercase tracking-[0.16em] text-faint">둘러보기</p>
          <ul className="mt-3 space-y-2 text-[12px] text-ink-2">
            {(
              [
                { key: 'feed', label: '오늘의 이슈' },
                { key: 'ranking', label: '주간 팩폭 랭킹' },
                { key: 'editor', label: '에디터 스튜디오' },
              ] as { key: NavKey; label: string }[]
            ).map((item) => (
              <li key={item.key}>
                <button type="button" onClick={() => onNavigate(item.key)} className="transition hover:text-heat">
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="mono text-[9.5px] uppercase tracking-[0.16em] text-faint">이 보드에 대하여</p>
          <p className="mt-3 text-[11.5px] leading-[1.7] text-muted">
            {mode === 'shared'
              ? '투표·팩폭·발행한 이슈는 공용 보드에 저장되어 링크를 받은 사람도 함께 봅니다. 개인 식별 정보는 저장하지 않고, 이 브라우저에는 익명 참여자 id만 남습니다.'
              : '지금은 로컬 체험 모드입니다. 투표·팩폭·발행한 이슈가 이 브라우저에만 저장되고 서버로 나가지 않습니다.'}
          </p>
          <button
            type="button"
            onClick={onReset}
            className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-line-strong px-3 py-1.5 text-[11px] font-semibold text-ink-2 transition hover:border-heat/40 hover:text-heat"
          >
            <PenLine className="h-3 w-3" />
            데모 데이터 초기화
          </button>
        </div>
      </div>
      <div className="border-t border-line/70">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col items-start justify-between gap-2 px-4 py-4 text-[10.5px] text-faint sm:flex-row sm:items-center sm:px-6">
          <span className="mono">© 2026 이슈온도계 · editorial board demo</span>
          <span className="mono">온도는 투표로 움직입니다 · 0°–100°</span>
        </div>
      </div>
    </footer>
  );
}
