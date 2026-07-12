import { Injectable } from '@nestjs/common';
import type { LearningCommitment } from './entities/learning-commitment.entity';
import {
  ACTIVE_WINDOW_WEEKS,
  MAX_DEEP_WORK_MINUTES,
  MIN_SESSION_MINUTES,
  PREFERRED_SESSION_MAX,
  ScheduleSlotSource,
  TIME_WINDOW_START,
} from './timing.constants';
import {
  availabilityDayIndices,
  localParts,
  resolveTz,
  toDateString,
  zonedTimeToUtc,
} from '../weeks/weeks.time';
import { DAY_LABELS } from '../weeks/weeks.constants';

export type LessonCandidate = {
  id: string;
  title: string;
  minutes: number;
  splitAllowed?: boolean;
};

export type BuiltSlot = {
  localDate: string;
  startLocalTime: string;
  endLocalTime: string;
  startsAtUtc: Date;
  endsAtUtc: Date;
  plannedMinutes: number;
  lessonId: string | null;
  title: string | null;
  source: ScheduleSlotSource;
};

@Injectable()
export class ScheduleBuilderService {
  buildActiveWindow(input: {
    commitment: LearningCommitment;
    lessons: LessonCandidate[];
    fromDate?: Date;
    weeks?: number;
    source?: ScheduleSlotSource;
  }): {
    windowStart: string;
    windowEnd: string;
    slots: BuiltSlot[];
  } {
    const tz = resolveTz(input.commitment.timezone);
    const now = input.fromDate ?? new Date();
    const parts = localParts(now, tz);
    const windowStart = toDateString(parts.y, parts.m, parts.d);
    const weeks = input.weeks ?? ACTIVE_WINDOW_WEEKS;
    const dayCount = weeks * 7;
    const endProbe = new Date(
      Date.UTC(parts.y, parts.m - 1, parts.d + dayCount - 1, 12),
    );
    const endParts = localParts(endProbe, tz);
    const windowEnd = toDateString(endParts.y, endParts.m, endParts.d);

    const dayIndices = availabilityDayIndices(input.commitment.availableDays);
    const timeWindows =
      input.commitment.timeWindows?.length > 0
        ? input.commitment.timeWindows
        : ['evening'];
    const preferredStart = TIME_WINDOW_START[timeWindows[0]] ?? TIME_WINDOW_START.evening;

    const dailyBudget = Math.max(
      MIN_SESSION_MINUTES,
      Math.round(input.commitment.targetMinutesPerWeek / Math.max(1, dayIndices.length)),
    );

    const queue = this.expandLessons(input.lessons);
    const slots: BuiltSlot[] = [];
    let lessonPtr = 0;

    for (let offset = 0; offset < dayCount; offset++) {
      const dayUtc = new Date(
        Date.UTC(parts.y, parts.m - 1, parts.d + offset, 12),
      );
      const dp = localParts(dayUtc, tz);
      const weekday = dp.weekday;
      if (!dayIndices.includes(weekday)) continue;

      let remainingBudget = Math.min(dailyBudget, MAX_DEEP_WORK_MINUTES);
      let cursorHour = preferredStart.hour;
      let cursorMinute = preferredStart.minute;

      while (remainingBudget >= MIN_SESSION_MINUTES && lessonPtr < queue.length) {
        const piece = queue[lessonPtr];
        const chunk = Math.min(
          piece.minutes,
          remainingBudget,
          PREFERRED_SESSION_MAX,
          MAX_DEEP_WORK_MINUTES,
        );
        if (chunk < MIN_SESSION_MINUTES) break;

        const startLocal = `${pad(cursorHour)}:${pad(cursorMinute)}`;
        const endMinTotal = cursorHour * 60 + cursorMinute + chunk;
        const endHour = Math.floor(endMinTotal / 60) % 24;
        const endMinute = endMinTotal % 60;
        const endLocal = `${pad(endHour)}:${pad(endMinute)}`;
        const localDate = toDateString(dp.y, dp.m, dp.d);
        const startsAtUtc = zonedTimeToUtc(
          dp.y,
          dp.m,
          dp.d,
          cursorHour,
          cursorMinute,
          tz,
        );
        const endsAtUtc = zonedTimeToUtc(
          dp.y,
          dp.m,
          dp.d,
          endHour,
          endMinute,
          tz,
        );

        slots.push({
          localDate,
          startLocalTime: startLocal,
          endLocalTime: endLocal,
          startsAtUtc,
          endsAtUtc,
          plannedMinutes: chunk,
          lessonId: piece.id,
          title: piece.title,
          source: input.source ?? ScheduleSlotSource.Questionnaire,
        });

        piece.minutes -= chunk;
        remainingBudget -= chunk;
        cursorMinute += chunk;
        cursorHour += Math.floor(cursorMinute / 60);
        cursorMinute %= 60;
        if (piece.minutes < MIN_SESSION_MINUTES) {
          lessonPtr += 1;
        }
      }
    }

    return { windowStart, windowEnd, slots };
  }

  private expandLessons(lessons: LessonCandidate[]): LessonCandidate[] {
    const out: LessonCandidate[] = [];
    for (const lesson of lessons) {
      const minutes = Math.max(MIN_SESSION_MINUTES, lesson.minutes || 25);
      if (minutes <= MAX_DEEP_WORK_MINUTES || !lesson.splitAllowed) {
        out.push({ ...lesson, minutes: Math.min(minutes, MAX_DEEP_WORK_MINUTES) });
        continue;
      }
      let left = minutes;
      while (left >= MIN_SESSION_MINUTES) {
        const chunk = Math.min(PREFERRED_SESSION_MAX, left);
        out.push({ ...lesson, minutes: chunk });
        left -= chunk;
      }
    }
    return out;
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days, 12));
  return toDateString(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

export function dayLabelFromIndex(i: number): string {
  return DAY_LABELS[i] ?? 'Mon';
}
