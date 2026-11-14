import { useState } from 'react';
import { Heart, Send } from 'lucide-react';
import type { Comment } from '../types';
import { formatNumber, relativeTime } from '../lib/format';
import { cn } from './ui';

const MAX = 100;

export function CommentBattle({
  issueId,
  comments,
  liked,
  onLike,
  onSubmit,
  onLimit,
}: {
  issueId: string;
  comments: Comment[];
  liked: string[];
  onLike: (id: string) => void;
  onSubmit: (text: string) => boolean;
  onLimit: () => void;
}) {
  const [text, setText] = useState('');
  const [sort, setSort] = useState<'likes' | 'recent'>('likes');

  const sorted = [...comments].sort((a, b) =>
    sort === 'likes' ? b.likes - a.likes || b.createdAt - a.createdAt : b.createdAt - a.createdAt,
  );

  const submit = () => {
    if (text.trim().length === 0) {
      onLimit();
      return;
    }
    const ok = onSubmit(text);
    if (ok) setText('');
  };

  return (
    <section id={`battle-${issueId}`} className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mono text-[9.5px] uppercase tracking-[0.16em] text-faint">Fact bomb battle</p>
          <h3 className="serif mt-1 text-[19px] font-bold text-ink">🗯️ 한 줄 팩폭 배틀</h3>
          <p className="mt-1 text-[11.5px] text-muted">
            {formatNumber(comments.length)}개의 팩폭 · 100자 이내, 한 줄이면 충분합니다.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-line bg-paper/60 p-1">
          {(
            [
              { id: 'likes', label: '좋아요순' },
              { id: 'recent', label: '최신순' },
            ] as { id: 'likes' | 'recent'; label: string }[]
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setSort(option.id)}
             aria-pressed={sort === option.id}
              className={cn(
                'rounded-full px-2.5 py-1 text-[11px] font-semibold transition',
                sort === option.id ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor={`comment-${issueId}`} className="sr-only">
          한 줄 팩폭 남기기
        </label>
        <div className="flex items-end gap-2 rounded-xl border border-line bg-paper/40 p-2 focus-within:border-heat/40 focus-within:bg-surface">
          <textarea
            id={`comment-${issueId}`}
            rows={1}
            maxLength={MAX}
            value={text}
            onChange={(event) => setText(event.target.value.slice(0, MAX))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="예: 이건 마케팅이 아니라 실험이고, 피실험자는 손님이다."
            className="max-h-24 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-[13px] leading-relaxed text-ink outline-none placeholder:text-faint"
          />
          <div className="flex shrink-0 items-center gap-2 pb-1 pr-1">
            <span className={cn('nums text-[10px]', text.length > 80 ? 'text-heat' : 'text-faint')}>
              {text.length}/{MAX}
            </span>
            <button
              type="button"
              onClick={submit}
              className="inline-flex items-center gap-1 rounded-lg bg-ink px-3 py-2 text-[11.5px] font-bold text-paper transition hover:bg-heat disabled:opacity-40"
            >
              <Send className="h-3.5 w-3.5" />
              등록
            </button>
          </div>
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-line-strong bg-paper/40 px-4 py-8 text-center text-[12px] text-muted">
          아직 팩폭이 없습니다. 첫 한 줄을 남겨 보세요.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line/70">
          {sorted.map((comment) => {
            const isLiked = liked.includes(comment.id);
            const mine = comment.author === '나 · 익명';
            return (
              <li key={comment.id} className="flex gap-3 py-3.5">
                <span
                  className={cn(
                    'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                    mine ? 'bg-heat text-white' : 'bg-paper-deep text-ink-2',
                  )}
                  aria-hidden="true"
                >
                  {comment.author.replace(/\s/g, '').slice(0, 1)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className={cn('text-[11.5px] font-semibold', mine ? 'text-heat' : 'text-ink-2')}>
                      {comment.author}
                    </span>
                    <span className="text-[10px] text-faint">{relativeTime(comment.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-[13.5px] leading-[1.6] text-ink">{comment.text}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onLike(comment.id)}
                  aria-pressed={isLiked}
                  aria-label="이 팩폭에 좋아요"
                  className={cn(
                    'mt-1 inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-2 text-[10.5px] font-semibold transition',
                    isLiked
                      ? 'border-heat/30 bg-heat-soft text-heat'
                      : 'border-transparent text-faint hover:border-line hover:bg-paper-deep/60 hover:text-ink-2',
                  )}
                >
                  <Heart className={cn('h-3.5 w-3.5', isLiked && 'fill-current')} />
                  <span className="nums">{formatNumber(comment.likes)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
