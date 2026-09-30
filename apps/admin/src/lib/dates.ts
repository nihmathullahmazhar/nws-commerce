// Calendar dates (YYYY-MM-DD) in the business's time zone, for report ranges.

const asDate = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDays(s: string, n: number): string {
  const d = asDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((asDate(to).getTime() - asDate(from).getTime()) / 86_400_000) + 1;
}

export type Preset = 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'this_month' | 'last_month' | 'this_year' | 'custom';

export const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' }, { value: '90d', label: 'Last 90 days' },
  { value: 'this_month', label: 'This month' }, { value: 'last_month', label: 'Last month' },
  { value: 'this_year', label: 'This year' }, { value: 'custom', label: 'Custom dates' },
];

export function presetRange(preset: Exclude<Preset, 'custom'>, today: string): [string, string] {
  const [y, m] = today.split('-').map(Number);
  switch (preset) {
    case 'today': return [today, today];
    case 'yesterday': return [addDays(today, -1), addDays(today, -1)];
    case '7d': return [addDays(today, -6), today];
    case '30d': return [addDays(today, -29), today];
    case '90d': return [addDays(today, -89), today];
    case 'this_month': return [`${today.slice(0, 7)}-01`, today];
    case 'last_month': {
      const first = iso(new Date(Date.UTC(y, m - 2, 1)));
      return [first, addDays(`${today.slice(0, 7)}-01`, -1)];
    }
    case 'this_year': return [`${y}-01-01`, today];
  }
}

/** A sensible grouping for a range length. */
export function autoInterval(from: string, to: string): 'day' | 'week' | 'month' {
  const n = daysBetween(from, to);
  return n <= 45 ? 'day' : n <= 200 ? 'week' : 'month';
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'UTC' });
const dayFmt = fmt({ day: 'numeric', month: 'short' });
const dayYearFmt = fmt({ day: 'numeric', month: 'short', year: 'numeric' });
const monthFmt = fmt({ month: 'short', year: 'numeric' });
const weekdayFmt = fmt({ weekday: 'short', day: 'numeric', month: 'short' });

export function bucketLabel(bucket: string, interval: 'day' | 'week' | 'month', long = false): string {
  const d = asDate(bucket);
  if (interval === 'month') return monthFmt.format(d);
  if (interval === 'week') return `${long ? 'Week of ' : ''}${dayFmt.format(d)}`;
  return long ? weekdayFmt.format(d) : dayFmt.format(d);
}

export function rangeLabel(from: string, to: string): string {
  return from === to ? dayYearFmt.format(asDate(from)) : `${dayYearFmt.format(asDate(from))} - ${dayYearFmt.format(asDate(to))}`;
}
