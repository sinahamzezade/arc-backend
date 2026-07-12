import { sealHoursRatio } from './weeks.constants';
import type { HomeDayStatus, PulseDayStatus } from './weeks.constants';

export function progressPercent(
  hoursDone: number,
  hoursPlanned: number,
  sessionsDone: number,
  sessionsPlanned: number,
): number {
  if (hoursPlanned > 0) {
    return Math.min(100, Math.round((100 * hoursDone) / hoursPlanned));
  }
  if (sessionsPlanned > 0) {
    return Math.min(100, Math.round((100 * sessionsDone) / sessionsPlanned));
  }
  return 0;
}

export function computeOnTrack(input: {
  sealed: boolean;
  sessionsDone: number;
  sessionsPlanned: number;
  dayIndex: number; // Mon=0 … Sun=6
}): boolean {
  if (input.sealed) return true;
  if (input.sessionsPlanned <= 0) return true;
  const expected = Math.ceil(
    (input.sessionsPlanned * (input.dayIndex + 1)) / 7,
  );
  // Soft: allow one session behind
  return input.sessionsDone >= expected - 1;
}

export function meetsSealCriteria(input: {
  sessionsDone: number;
  sessionsPlanned: number;
  hoursDone: number;
  hoursPlanned: number;
  hoursRatio?: number;
}): boolean {
  if (
    input.sessionsPlanned > 0 &&
    input.sessionsDone >= input.sessionsPlanned
  ) {
    return true;
  }
  const ratio = input.hoursRatio ?? sealHoursRatio();
  if (input.hoursPlanned > 0 && input.hoursDone >= input.hoursPlanned * ratio) {
    return true;
  }
  return false;
}

export function buildDayStatuses(input: {
  dayIndexNow: number;
  doneDayIndices: Set<number>;
  forPulse?: boolean;
}): Array<{ label: string; status: HomeDayStatus | PulseDayStatus }> {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return labels.map((label, i) => {
    if (input.doneDayIndices.has(i)) {
      return { label, status: 'done' as const };
    }
    if (input.forPulse && i === input.dayIndexNow) {
      return { label, status: 'today' as const };
    }
    return { label, status: 'empty' as const };
  });
}

export function sessionsLeft(
  sessionsPlanned: number,
  sessionsDone: number,
): number {
  return Math.max(0, sessionsPlanned - sessionsDone);
}

export function targetWeek(weeks: number, sealed: boolean): number {
  return weeks + (sealed ? 0 : 1);
}

export function num(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
