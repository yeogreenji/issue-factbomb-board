import type { Issue, Reaction, ReactionCounts } from '../types';

export const EMPTY_VOTES: ReactionCounts = { hot: 0, watch: 0, cool: 0 };

/** Prior weight of the editorial temperature, in pseudo-votes. */
const PRIOR = 8;

/** Vote share → heat, where 🔥 counts 100, 🤔 55, ❄️ 12. */
export function heatOf(votes: ReactionCounts): number {
  const total = totalVotes(votes);
  if (total === 0) return 0;
  return (votes.hot * 100 + votes.watch * 55 + votes.cool * 12) / total;
}

/**
 * 여론 온도 = the room's heat, with the editor's starting temperature kept as a
 * small prior so a single early vote nudges the needle instead of yanking it.
 */
export function computeTemp(issue: Issue, votes: ReactionCounts): number {
  const total = totalVotes(votes);
  const raw = (issue.baseTemp * PRIOR + votes.hot * 100 + votes.watch * 55 + votes.cool * 12) / (PRIOR + total);
  return Math.max(3, Math.min(99, Math.round(raw)));
}

export function totalVotes(votes: ReactionCounts): number {
  return votes.hot + votes.watch + votes.cool;
}

export interface TempBand {
  id: 'blazing' | 'hot' | 'watch' | 'mild' | 'cool';
  label: string;
  emoji: string;
  /** short editorial reading of the band */
  note: string;
  text: string;
  bg: string;
  border: string;
  bar: string;
}

const BANDS: TempBand[] = [
  {
    id: 'blazing',
    label: '과열',
    emoji: '🔥',
    note: '사과 타이밍',
    text: 'text-heat',
    bg: 'bg-heat-soft',
    border: 'border-heat/25',
    bar: 'from-[#a82b0d] via-[#e0451f] to-[#ff8a4c]',
  },
  {
    id: 'hot',
    label: '가열',
    emoji: '🌶️',
    note: '확산 중',
    text: 'text-[#b4531d]',
    bg: 'bg-[#fbeadb]',
    border: 'border-[#b4531d]/20',
    bar: 'from-[#d0661f] via-[#f08b3c] to-[#ffc178]',
  },
  {
    id: 'watch',
    label: '지켜보는 중',
    emoji: '🤔',
    note: '판단 보류',
    text: 'text-gold',
    bg: 'bg-gold-soft',
    border: 'border-gold/25',
    bar: 'from-[#a8822c] via-[#c9a24a] to-[#e6c98c]',
  },
  {
    id: 'mild',
    label: '미지근',
    emoji: '🌤️',
    note: '관심 밖',
    text: 'text-[#5c7f6a]',
    bg: 'bg-[#eef2ec]',
    border: 'border-[#5c7f6a]/20',
    bar: 'from-[#7d9c86] via-[#a7bfae] to-[#cfdfd2]',
  },
  {
    id: 'cool',
    label: '냉각',
    emoji: '❄️',
    note: '잊혀가는 중',
    text: 'text-cool',
    bg: 'bg-cool-soft',
    border: 'border-cool/20',
    bar: 'from-[#1f5f77] via-[#3d8ba6] to-[#8fc4d4]',
  },
];

export function tempBand(temp: number): TempBand {
  if (temp >= 85) return BANDS[0];
  if (temp >= 70) return BANDS[1];
  if (temp >= 50) return BANDS[2];
  if (temp >= 30) return BANDS[3];
  return BANDS[4];
}

export interface Share {
  reaction: Reaction;
  pct: number;
  count: number;
}

/** Percentages that always add up to 100 (largest remainder). */
export function voteShares(votes: ReactionCounts): Share[] {
  const total = totalVotes(votes);
  const keys: Reaction[] = ['hot', 'watch', 'cool'];
  if (total === 0) return keys.map((reaction) => ({ reaction, pct: 0, count: 0 }));
  const exact = keys.map((k) => ({ reaction: k, count: votes[k], raw: (votes[k] / total) * 100 }));
  const floors = exact.map((e) => ({ ...e, pct: Math.floor(e.raw) }));
  let remainder = 100 - floors.reduce((sum, e) => sum + e.pct, 0);
  const order = [...floors].sort((a, b) => b.raw - Math.floor(b.raw) - (a.raw - Math.floor(a.raw)));
  for (const item of order) {
    if (remainder <= 0) break;
    item.pct += 1;
    remainder -= 1;
  }
  return floors.map(({ reaction, pct, count }) => ({ reaction, pct, count }));
}

export function topReaction(votes: ReactionCounts): Share | null {
  const shares = voteShares(votes);
  if (totalVotes(votes) === 0) return null;
  return [...shares].sort((a, b) => b.count - a.count)[0];
}
