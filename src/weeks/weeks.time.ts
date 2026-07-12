import { DAY_LABELS, tzFallback } from './weeks.constants';

/** Resolve IANA timezone or fallback. */
export function resolveTz(timezone: string | null | undefined): string {
  const tz = timezone?.trim() || tzFallback();
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return tzFallback();
  }
}

export type ZonedParts = {
  y: number;
  m: number;
  d: number;
  hour: number;
  minute: number;
  weekday: number; // Mon=0 … Sun=6
};

/**
 * Local calendar + clock parts in timezone.
 */
export function localParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '';
  const y = Number(get('year'));
  const m = Number(get('month'));
  const d = Number(get('day'));
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const wd = get('weekday');
  const weekdayMap: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  return { y, m, d, hour, minute, weekday: weekdayMap[wd] ?? 0 };
}

/** @deprecated use localParts */
export function localYmd(
  date: Date,
  timeZone: string,
): { y: number; m: number; d: number; weekday: number } {
  const p = localParts(date, timeZone);
  return { y: p.y, m: p.m, d: p.d, weekday: p.weekday };
}

export function toDateString(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Convert local wall time in `timeZone` to a UTC Date (iterative offset fix).
 */
export function zonedTimeToUtc(
  y: number,
  m: number,
  d: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  let utc = Date.UTC(y, m - 1, d, hour, minute, 0, 0);
  for (let i = 0; i < 4; i++) {
    const parts = localParts(new Date(utc), timeZone);
    const asUtc = Date.UTC(
      parts.y,
      parts.m - 1,
      parts.d,
      parts.hour,
      parts.minute,
      0,
      0,
    );
    const target = Date.UTC(y, m - 1, d, hour, minute, 0, 0);
    utc += target - asUtc;
  }
  return new Date(utc);
}

/** Calendar Monday of the week containing `date` in user TZ. */
export function calendarWeekStartMonday(
  date: Date,
  timeZone: string,
): string {
  const { y, m, d, weekday } = localParts(date, timeZone);
  const utcNoon = Date.UTC(y, m - 1, d, 12, 0, 0);
  const monday = new Date(utcNoon - weekday * 86_400_000);
  return toDateString(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
  );
}

/**
 * Learning-week Monday label (doc §2):
 * Mon 03:00 local → next Mon 02:59:59.999.
 * Before Mon 03:00 still belongs to previous learning week.
 */
export function weekStartMonday(date: Date, timeZone: string): string {
  const p = localParts(date, timeZone);
  let probe = date;
  if (p.weekday === 0 && p.hour < 3) {
    probe = new Date(date.getTime() - 4 * 3600_000);
  }
  return calendarWeekStartMonday(probe, timeZone);
}

export function learningWeekWindow(
  weekStart: string,
  timeZone: string,
): { windowStartAt: Date; windowEndAt: Date } {
  const [ys, ms, ds] = weekStart.split('-').map(Number);
  const windowStartAt = zonedTimeToUtc(ys, ms, ds, 3, 0, timeZone);
  const nextMon = new Date(Date.UTC(ys, ms - 1, ds + 7, 12));
  const ny = nextMon.getUTCFullYear();
  const nm = nextMon.getUTCMonth() + 1;
  const nd = nextMon.getUTCDate();
  // next Monday 02:59:59.999
  const windowEndAt = new Date(
    zonedTimeToUtc(ny, nm, nd, 3, 0, timeZone).getTime() - 1,
  );
  return { windowStartAt, windowEndAt };
}

export function dayIndexNow(date: Date, timeZone: string): number {
  // Day index relative to learning week Monday label
  const weekStart = weekStartMonday(date, timeZone);
  const [ys, ms, ds] = weekStart.split('-').map(Number);
  const p = localParts(date, timeZone);
  const startUtc = Date.UTC(ys, ms - 1, ds, 12);
  const todayUtc = Date.UTC(p.y, p.m - 1, p.d, 12);
  const diff = Math.round((todayUtc - startUtc) / 86_400_000);
  return Math.min(6, Math.max(0, diff));
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
  if (!days?.length) return [0, 1, 2, 3, 4];
  const map: Record<string, number> = {};
  DAY_LABELS.forEach((label, i) => {
    map[label.toLowerCase()] = i;
    map[label] = i;
  });
  const indices = days
    .map((d) => map[d] ?? map[d.trim()] ?? map[d.toLowerCase()])
    .filter((n): n is number => typeof n === 'number');
  return indices.length
    ? [...new Set(indices)].sort((a, b) => a - b)
    : [0, 1, 2, 3, 4];
}
