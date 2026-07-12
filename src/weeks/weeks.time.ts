import { DAY_LABELS, tzFallback } from './weeks.constants';

/** Resolve IANA timezone or fallback. */
export function resolveTz(timezone: string | null | undefined): string {
  const tz = timezone?.trim() || tzFallback();
  try {
    // Validate
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return tzFallback();
  }
}

/**
 * Local calendar Y-M-D parts in timezone.
 */
export function localYmd(
  date: Date,
  timeZone: string,
): { y: number; m: number; d: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const y = Number(get('year'));
  const m = Number(get('month'));
  const d = Number(get('day'));
  const wd = get('weekday'); // Sun, Mon, …
  const weekdayMap: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return { y, m, d, weekday: weekdayMap[wd] ?? 0 };
}

export function toDateString(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Monday of the week containing `date` in user TZ, as YYYY-MM-DD. */
export function weekStartMonday(date: Date, timeZone: string): string {
  const { y, m, d, weekday } = localYmd(date, timeZone);
  // Build UTC noon for local calendar day then subtract weekday days
  const utcNoon = Date.UTC(y, m - 1, d, 12, 0, 0);
  const monday = new Date(utcNoon - weekday * 86_400_000);
  return toDateString(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
  );
}

export function dayIndexNow(date: Date, timeZone: string): number {
  return localYmd(date, timeZone).weekday;
}

export function rangeLabel(weekStart: string): string {
  const [ys, ms, ds] = weekStart.split('-').map(Number);
  const start = new Date(Date.UTC(ys, ms - 1, ds, 12));
  const end = new Date(start.getTime() + 6 * 86_400_000);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

export function dayLabel(dayIndex: number): string {
  return DAY_LABELS[dayIndex] ?? `D${dayIndex}`;
}

/** Map questionnaire day labels (Mon…) → dayIndex. */
export function availabilityDayIndices(days: string[] | undefined): number[] {
  if (!days?.length) return [0, 1, 2, 3, 4]; // default weekdays
  const map: Record<string, number> = {};
  DAY_LABELS.forEach((label, i) => {
    map[label.toLowerCase()] = i;
    map[label] = i;
  });
  const indices = days
    .map((d) => map[d] ?? map[d.trim()] ?? map[d.toLowerCase()])
    .filter((n): n is number => typeof n === 'number');
  return indices.length ? [...new Set(indices)].sort((a, b) => a - b) : [0, 1, 2, 3, 4];
}
