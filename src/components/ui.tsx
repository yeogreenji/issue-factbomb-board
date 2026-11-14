import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { Category as CategoryType, CategoryId } from '../types';
import { CATEGORY_MAP } from '../lib/content';
import { splitEmphasis } from '../lib/format';
import { tempBand } from '../lib/temp';

export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}

export function RichText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {splitEmphasis(text).map((part, index) =>
        part.strong ? (
          <strong key={index} className="font-semibold text-ink">
            {part.text}
          </strong>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </span>
  );
}

export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'mono inline-flex items-center gap-2 text-[10.5px] font-medium uppercase tracking-[0.18em] text-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function CategoryChip({
  category,
  size = 'sm',
  className,
}: {
  category: CategoryId;
  size?: 'sm' | 'xs';
  className?: string;
}) {
  const meta: CategoryType = CATEGORY_MAP[category];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full font-semibold',
        size === 'sm' ? 'px-2.5 py-1 text-[11.5px]' : 'px-2 py-0.5 text-[10.5px]',
        meta.soft,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
      {meta.label}
    </span>
  );
}

export function TempStamp({
  temp,
  size = 'md',
  className,
}: {
  temp: number;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const band = tempBand(temp);
  return (
    <div className={cn('flex flex-col items-end', className)}>
      <div className="flex items-start leading-none">
        <span
          className={cn(
            'nums font-bold tracking-[-0.06em]',
            size === 'lg' ? 'text-[52px]' : 'text-[34px]',
            band.text,
          )}
        >
          {temp}
        </span>
        <span className={cn('mt-1 font-semibold', size === 'lg' ? 'text-xl' : 'text-sm', band.text)}>°</span>
      </div>
      <span className={cn('mono mt-1 text-[9.5px] uppercase tracking-[0.14em]', band.text)}>{band.label}</span>
    </div>
  );
}

export function BandPill({ temp, tone = 'light' }: { temp: number; tone?: 'light' | 'dark' }) {
  const band = tempBand(temp);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold',
        tone === 'light' ? cn(band.bg, band.text) : 'bg-white/10 text-white/85 ring-1 ring-white/15',
      )}
    >
      <span aria-hidden="true">{band.emoji}</span>
      {band.label}
    </span>
  );
}

export function SectionHead({
  eyebrow,
  title,
  action,
  className,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-end justify-between gap-4', className)}>
      <div>
        {eyebrow ? <Eyebrow className="mb-1.5">{eyebrow}</Eyebrow> : null}
        <h2 className="serif text-[22px] font-bold text-ink">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function GhostLink({
  children,
  onClick,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group inline-flex items-center gap-1 text-[12.5px] font-semibold text-ink-2 transition hover:text-heat',
        className,
      )}
    >
      {children}
      <ArrowUpRight className="h-3.5 w-3.5 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
    </button>
  );
}

export function StatBlock({
  label,
  value,
  suffix,
  hint,
}: {
  label: string;
  value: string;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="mono text-[9.5px] uppercase tracking-[0.16em] text-faint">{label}</span>
      <span className="flex items-baseline gap-1">
        <span className="nums text-[24px] font-bold tracking-tight text-ink">{value}</span>
        {suffix ? <span className="text-[12px] font-medium text-muted">{suffix}</span> : null}
      </span>
      {hint ? <span className="text-[11px] text-faint">{hint}</span> : null}
    </div>
  );
}
