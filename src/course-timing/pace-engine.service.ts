import { Injectable } from '@nestjs/common';
import {
  MIN_ACTIVE_DAYS_FOR_EWMA,
  MIN_SAFE_WEEKLY_MINUTES,
  PaceState,
} from './timing.constants';

export type PaceInput = {
  plannedMinutesPerWeek: number;
  remainingMinutes: number;
  currentWeekCompleted: number;
  previousWeekCompleted: number;
  olderBaseline: number;
  activeDays: number;
  targetCompletionDate: string | null;
};

export type PaceResult = {
  effectiveMinutesPerWeek: number;
  estimatedWeeksRemaining: number;
  estimatedCompletionDate: string | null;
  paceState: PaceState;
};

@Injectable()
export class PaceEngineService {
  compute(input: PaceInput, fromDate = new Date()): PaceResult {
    const planned = Math.max(MIN_SAFE_WEEKLY_MINUTES, input.plannedMinutesPerWeek);
    let effective: number;
    if (input.activeDays < MIN_ACTIVE_DAYS_FOR_EWMA) {
      effective = planned;
    } else {
      effective = Math.round(
        0.5 * input.currentWeekCompleted +
          0.3 * input.previousWeekCompleted +
          0.2 * (input.olderBaseline || planned),
      );
    }
    effective = Math.max(MIN_SAFE_WEEKLY_MINUTES, effective);

    const remaining = Math.max(0, input.remainingMinutes);
    const estimatedWeeksRemaining = remaining / effective;
    const boundary = nextMondayUtc(fromDate);
    const eta = new Date(boundary);
    eta.setUTCDate(eta.getUTCDate() + Math.ceil(estimatedWeeksRemaining * 7));
    const estimatedCompletionDate = eta.toISOString().slice(0, 10);

    const paceState = this.resolvePaceState({
      effective,
      planned,
      estimatedCompletionDate,
      targetCompletionDate: input.targetCompletionDate,
      remaining,
    });

    return {
      effectiveMinutesPerWeek: effective,
      estimatedWeeksRemaining: Number(estimatedWeeksRemaining.toFixed(2)),
      estimatedCompletionDate,
      paceState,
    };
  }

  private resolvePaceState(input: {
    effective: number;
    planned: number;
    estimatedCompletionDate: string | null;
    targetCompletionDate: string | null;
    remaining: number;
  }): PaceState {
    if (input.remaining <= 0) return PaceState.Ahead;
    const ratio = input.effective / Math.max(1, input.planned);
    if (ratio >= 1.15) return PaceState.Ahead;
    if (ratio >= 0.9) return PaceState.OnTrack;
    if (ratio >= 0.7) return PaceState.SlightlyBehind;

    if (input.targetCompletionDate && input.estimatedCompletionDate) {
      if (input.estimatedCompletionDate > input.targetCompletionDate) {
        return PaceState.AtRisk;
      }
    }
    return PaceState.AtRisk;
  }
}

function nextMondayUtc(from: Date): Date {
  const d = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 12),
  );
  const day = d.getUTCDay(); // Sun=0
  const daysUntilMon = day === 1 ? 0 : (8 - day) % 7;
  d.setUTCDate(d.getUTCDate() + daysUntilMon);
  return d;
}
