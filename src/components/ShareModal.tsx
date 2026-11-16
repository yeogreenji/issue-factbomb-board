import { useEffect, useState } from 'react';
import { Copy, Download, Link2, X } from 'lucide-react';
import type { Comment, Issue, ReactionCounts } from '../types';
import { downloadDataUrl, renderShareCard, type CardFormat } from '../lib/share-card';
import { tempBand } from '../lib/temp';
import { cn } from './ui';

export function ShareModal({
  issue,
  temp,
  votes,
  topComment,
  onClose,
  onToast,
}: {
  issue: Issue;
  temp: number;
  votes: ReactionCounts;
  topComment?: Comment;
  onClose: () => void;
  onToast: (message: string) => void;
}) {
  const [format, setFormat] = useState<CardFormat>('portrait');
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setDataUrl(null);
    renderShareCard({ issue, temp, votes, topComment, format })
      .then((url) => {
        if (!cancelled) {
          setDataUrl(url);
          setBusy(false);
        }
      })
      .catch(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [issue, temp, votes, topComment, format]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  const band = tempBand(temp);

  /** 공유 링크는 `?issue=` 파라미터라 정적 호스팅·Vercel 어디서나 그대로 열립니다. */
  const shareUrl = `${window.location.origin}${window.location.pathname}?issue=${issue.id}`;

  const shareText = [
    `${issue.headline}`,
    '',
    ...issue.summary.slice(0, 3).map((line, index) => `${index + 1}. ${line}`),
    '',
    `🌡️ 여론 온도 ${temp}° · ${band.emoji} ${band.label}`,
    issue.insider ? `💼 ${issue.insider}` : '',
    '',
    `이슈온도계에서 투표하기 → ${shareUrl}`,
  ]
    .filter((line) => line !== undefined)
    .join('\n');

  const copy = async (text: string, done: string, failed: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onToast(done);
    } catch {
      onToast(failed);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-night/70 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
        className="animate-pop flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl border border-line bg-paper shadow-float sm:rounded-3xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <p className="mono text-[9.5px] uppercase tracking-[0.16em] text-faint">Share card</p>
            <h2 id="share-title" className="serif mt-0.5 text-[18px] font-bold text-ink">
              SNS 공유 카드 만들기
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

        <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto sm:grid-cols-[1.15fr_1fr] sm:overflow-hidden">
          <div className="flex items-center justify-center bg-paper-deep/60 p-5">
            {dataUrl ? (
              <img
                src={dataUrl}
                alt={`${issue.headline} 공유 카드 미리보기`}
                className="max-h-[54vh] w-auto rounded-xl border border-line shadow-card sm:max-h-[64vh]"
              />
            ) : (
              <div className="flex aspect-[4/5] w-full max-w-[320px] animate-pulse items-center justify-center rounded-xl border border-line bg-surface text-[11px] text-faint">
                {busy ? '카드를 그리는 중…' : '카드를 만들지 못했습니다.'}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-5 p-5">
            <div>
              <p className="mono text-[9.5px] uppercase tracking-[0.16em] text-faint">미리보기 정보</p>
              <p className="serif mt-2 text-[15px] font-semibold leading-snug text-ink">{issue.headline}</p>
              <p className="mt-2 flex items-center gap-2 text-[11.5px] text-muted">
                <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold', band.bg, band.text)}>
                  {band.emoji} {band.label}
                </span>
                <span className="nums">{temp}° · {format === 'portrait' ? '1080×1350' : '1080×1080'}</span>
              </p>
              <p className="mt-3 text-[11px] leading-relaxed text-muted">
                {topComment
                  ? `대표 팩폭: “${topComment.text}”`
                  : '아직 팩폭이 없어 카드에 인용 문장이 빠집니다. 첫 팩폭을 남기면 카드에 들어갑니다.'}
              </p>
            </div>

            <div>
              <p className="mono mb-2 text-[9.5px] uppercase tracking-[0.16em] text-faint">비율</p>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    { id: 'portrait', label: '세로 4:5', hint: '피드·스토리' },
                    { id: 'square', label: '정사각 1:1', hint: '타임라인' },
                  ] as { id: CardFormat; label: string; hint: string }[]
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setFormat(option.id)}
                    aria-pressed={format === option.id}
                    className={cn(
                      'rounded-xl border px-3 py-2.5 text-left transition',
                      format === option.id
                        ? 'border-ink bg-ink text-paper'
                        : 'border-line bg-surface text-ink-2 hover:border-line-strong',
                    )}
                  >
                    <span className="block text-[12px] font-semibold">{option.label}</span>
                    <span className={cn('mt-0.5 block text-[10px]', format === option.id ? 'text-paper/50' : 'text-faint')}>
                      {option.hint}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mono mb-2 text-[9.5px] uppercase tracking-[0.16em] text-faint">공유 링크</p>
              <p className="truncate rounded-xl border border-line bg-surface px-3 py-2 text-[11px] text-ink-2" title={shareUrl}>
                {shareUrl.replace(/^https?:\/\//, '')}
              </p>
              <p className="mt-1.5 text-[10.5px] leading-relaxed text-faint">
                이 주소로 들어오면 이슈 상세가 바로 열리고, 받은 사람도 같은 온도계에 투표할 수 있습니다.
              </p>
            </div>

            <div>
              <p className="mono mb-2 text-[9.5px] uppercase tracking-[0.16em] text-faint">카드에 담기는 것</p>
              <ul className="space-y-1 text-[11px] leading-relaxed text-muted">
                <li>· 헤드라인과 카테고리, 발행일</li>
                <li>· 여론 온도 {temp}°와 3지선다 비율</li>
                <li>· 대표 팩폭 한 줄{topComment ? ` — ${topComment.author}` : ' (팩폭 등록 후)'}</li>
              </ul>
            </div>

            <div className="mt-auto flex flex-col gap-2">
              <button
                type="button"
                disabled={!dataUrl}
                onClick={() => {
                  if (!dataUrl) return;
                  downloadDataUrl(dataUrl, `factbomb-${issue.id}-${format}.png`);
                  onToast('공유 카드 PNG를 저장했습니다.');
                }}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-heat px-4 py-3 text-[13px] font-bold text-white transition hover:bg-heat-deep disabled:opacity-40"
              >
                <Download className="h-4 w-4" />
                PNG 다운로드
              </button>
              <button
                type="button"
                onClick={() => void copy(shareUrl, '이슈 링크를 복사했습니다.', '링크 복사가 차단되었습니다. 위 주소를 길게 눌러 복사해 주세요.')}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-[12.5px] font-semibold text-ink-2 transition hover:border-line-strong"
              >
                <Link2 className="h-4 w-4" />
                이슈 링크 복사
              </button>
              <button
                type="button"
                onClick={() => void copy(shareText, '요약과 링크를 텍스트로 복사했습니다.', '텍스트 복사가 차단되었습니다.')}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-[12.5px] font-semibold text-ink-2 transition hover:border-line-strong"
              >
                <Copy className="h-4 w-4" />
                요약 + 링크 텍스트 복사
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
