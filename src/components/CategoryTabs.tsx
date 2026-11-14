import type { CategoryId } from '../types';
import { CATEGORIES } from '../lib/content';
import { cn } from './ui';

export type SortKey = 'temp' | 'recent';

export function CategoryTabs({
  active,
  counts,
  onChange,
  sort,
  onSortChange,
}: {
  active: CategoryId | 'all';
  counts: Record<string, number>;
  onChange: (category: CategoryId | 'all') => void;
  sort: SortKey;
  onSortChange: (sort: SortKey) => void;
}) {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const tabs: { id: CategoryId | 'all'; label: string; count: number }[] = [
    { id: 'all', label: '전체', count: total },
    ...CATEGORIES.map((category) => ({
      id: category.id,
      label: category.label,
      count: counts[category.id] ?? 0,
    })),
  ];

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1 hide-scroll">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-pressed={active === tab.id}
            className={cn(
              'no-tap inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-[12.5px] font-semibold transition',
              active === tab.id
                ? 'border-ink bg-ink text-paper'
                : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:bg-paper/70',
            )}
          >
            {tab.label}
            <span
              className={cn(
                'nums rounded-full px-1.5 text-[10px] font-bold',
                active === tab.id ? 'bg-white/15 text-paper/80' : 'bg-paper-deep text-muted',
              )}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface p-1">
        {(
          [
            { id: 'temp', label: '온도순' },
            { id: 'recent', label: '최신순' },
          ] as { id: SortKey; label: string }[]
        ).map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onSortChange(option.id)}
            aria-pressed={sort === option.id}
            className={cn(
              'rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition',
              sort === option.id ? 'bg-paper-deep text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
