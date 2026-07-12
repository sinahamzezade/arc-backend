import {
  LeagueRegionalBucket,
} from './entities/league.enums';
import { REGIONAL_TIMEZONES, SEASON_START_HOUR } from './leagues.constants';

const HOUR_MS = 60 * 60 * 1000;

/**
 * Map IANA timezone → regional bucket. Unknown → Americas fallback.
 */
export function regionalBucketForTimezone(
  timezone: string | null | undefined,
): LeagueRegionalBucket {
  const tz = (timezone ?? 'UTC').toLowerCase();

  if (
    tz.startsWith('europe/') ||
    tz === 'utc' ||
    tz === 'gmt' ||
    tz.startsWith('atlantic/')
  ) {
    return LeagueRegionalBucket.Europe;
  }
  if (
    tz.startsWith('america/') ||
    tz.startsWith('us/') ||
    tz.startsWith('canada/') ||
    tz.startsWith('brazil/') ||
    tz.startsWith('pacific/honolulu')
  ) {
    return LeagueRegionalBucket.Americas;
  }
  if (
    tz.startsWith('asia/tokyo') ||
    tz.startsWith('asia/seoul') ||
    tz.startsWith('asia/shanghai') ||
    tz.startsWith('asia/hong_kong') ||
    tz.startsWith('asia/singapore') ||
    tz.startsWith('asia/jakarta') ||
    tz.startsWith('asia/manila') ||
    tz.startsWith('asia/bangkok') ||
    tz.startsWith('asia/kolkata') ||
    tz.startsWith('asia/calcutta') ||
    tz.startsWith('australia/') ||
    tz.startsWith('pacific/auckland') ||
    tz.startsWith('pacific/fiji')
  ) {
    return LeagueRegionalBucket.Apac;
  }
  if (
    tz.startsWith('africa/') ||
    tz.startsWith('asia/dubai') ||
    tz.startsWith('asia/riyadh') ||
    tz.startsWith('asia/tehran') ||
    tz.startsWith('asia/baghdad') ||
    tz.startsWith('asia/jerusalem') ||
    tz.startsWith('asia/kuwait') ||
    tz.startsWith('asia/qatar') ||
    tz.startsWith('asia/muscat') ||
    tz.startsWith('asia/amman') ||
    tz.startsWith('asia/beirut')
  ) {
    return LeagueRegionalBucket.MiddleEastAfrica;
  }

  return LeagueRegionalBucket.Americas;
}

export function timezoneForBucket(bucket: LeagueRegionalBucket): string {
  return REGIONAL_TIMEZONES[bucket];
}

/**
 * Season: Monday 04:00 → next Monday 03:59:59.999 in cohort timezone.
 * Returns UTC Date bounds.
 *
 * Uses Intl offset sampling — good enough without luxon/date-fns-tz.
 */
export function seasonBoundsForTimezone(
  now: Date,
  timezone: string,
): { startsAt: Date; endsAt: Date } {
  const localParts = getZonedParts(now, timezone);
  const mondayOfWeek = mondayDate(localParts);

  // Season start = Monday 04:00 local
  let startLocal = { ...mondayOfWeek, hour: SEASON_START_HOUR, minute: 0, second: 0, ms: 0 };

  // If before Monday 04:00 this week, use previous Monday.
  const nowMinutes = localParts.hour * 60 + localParts.minute;
  const startMinutes = SEASON_START_HOUR * 60;
  if (
    localParts.weekday === 1 &&
    nowMinutes < startMinutes
  ) {
    const prev = addDays(mondayOfWeek, -7);
    startLocal = { ...prev, hour: SEASON_START_HOUR, minute: 0, second: 0, ms: 0 };
  }

  const startsAt = zonedLocalToUtc(startLocal, timezone);
  const nextMonday = addDays(startLocal, 7);
  // ends next Monday 03:59:59.999 = next start - 1ms
  const nextStart = zonedLocalToUtc(
    { ...nextMonday, hour: SEASON_START_HOUR, minute: 0, second: 0, ms: 0 },
    timezone,
  );
  const endsAt = new Date(nextStart.getTime() - 1);

  return { startsAt, endsAt };
}

type LocalParts = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
  weekday: number; // 1=Mon … 7=Sun (ISO)
};

function getZonedParts(date: Date, timezone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(date).map((p) => [p.type, p.value]),
  );
  const weekdayMap: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    ms: 0,
    weekday: weekdayMap[parts.weekday] ?? 1,
  };
}

function mondayDate(parts: LocalParts): LocalParts {
  const offset = parts.weekday - 1;
  return addDays(parts, -offset);
}

function addDays(parts: LocalParts, days: number): LocalParts {
  // Use UTC noon anchor to avoid DST edge when adding calendar days.
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day + days, 12);
  const d = new Date(utc);
  const weekday = ((d.getUTCDay() + 6) % 7) + 1; // Mon=1
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    ms: parts.ms,
    weekday,
  };
}

/**
 * Convert zoned local wall time → UTC via offset probe.
 */
function zonedLocalToUtc(
  local: Omit<LocalParts, 'weekday'> & { weekday?: number },
  timezone: string,
): Date {
  const guess = new Date(
    Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
      local.ms,
    ),
  );
  // Iterate twice to correct for offset.
  for (let i = 0; i < 3; i++) {
    const asLocal = getZonedParts(guess, timezone);
    const desiredMs =
      Date.UTC(
        local.year,
        local.month - 1,
        local.day,
        local.hour,
        local.minute,
        local.second,
        local.ms,
      );
    const actualMs =
      Date.UTC(
        asLocal.year,
        asLocal.month - 1,
        asLocal.day,
        asLocal.hour,
        asLocal.minute,
        asLocal.second,
        asLocal.ms,
      );
    const delta = desiredMs - actualMs;
    if (delta === 0) break;
    guess.setTime(guess.getTime() + delta);
  }
  return guess;
}

/** Local YYYY-MM-DD for active-day tracking */
export function localDayKey(date: Date, timezone: string): string {
  const p = getZonedParts(date, timezone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function isWithinSeason(
  occurredAt: Date,
  startsAt: Date,
  endsAt: Date,
  now: Date,
  graceMs: number,
): boolean {
  if (occurredAt < startsAt || occurredAt > endsAt) return false;
  if (now.getTime() > endsAt.getTime() + graceMs) return false;
  return true;
}

/** Unused helper kept for clarity of season length */
export function seasonLengthMs(startsAt: Date, endsAt: Date): number {
  return endsAt.getTime() - startsAt.getTime() + 1;
}

export { HOUR_MS };
