import { Injectable } from '@nestjs/common';
import {
  budgetMinutes,
  decodeTimelineWeeks,
  decodeWeeklyHours,
} from '../roadmaps/token-decoders';
import {
  CAPACITY_SAFETY_FACTOR,
  FeasibilityState,
  feasibilityFromRatio,
} from './timing.constants';

export type CapacityInput = {
  weeklyHoursToken: string | null | undefined;
  deadlineToken: string | null | undefined;
  recipeDefaultWeeks?: number;
  requiredContentMinutes: number;
  weeklyHoursOverride?: number | null;
};

export type CapacityResult = {
  hoursPerWeek: number;
  targetWeeks: number;
  usableWeeklyMinutes: number;
  deadlineCapacity: number;
  requiredContentMinutes: number;
  feasibilityRatio: number;
  feasibilityState: FeasibilityState;
  plannedMinutesPerWeek: number;
  requestedCompletionDate: string | null;
};

@Injectable()
export class CapacityService {
  compute(input: CapacityInput, fromDate = new Date()): CapacityResult {
    const hoursPerWeek =
      input.weeklyHoursOverride && input.weeklyHoursOverride > 0
        ? input.weeklyHoursOverride
        : decodeWeeklyHours(input.weeklyHoursToken);
    const targetWeeks = decodeTimelineWeeks(
      input.deadlineToken,
      input.recipeDefaultWeeks ?? 24,
    );
    const usableWeeklyMinutes = Math.round(
      hoursPerWeek * 60 * CAPACITY_SAFETY_FACTOR,
    );
    const deadlineCapacity = usableWeeklyMinutes * targetWeeks;
    const required = Math.max(0, input.requiredContentMinutes);
    const feasibilityRatio =
      deadlineCapacity > 0 ? required / deadlineCapacity : Infinity;
    const feasibilityState = feasibilityFromRatio(
      Number.isFinite(feasibilityRatio) ? feasibilityRatio : 99,
    );

    const start = new Date(fromDate);
    start.setUTCDate(start.getUTCDate() + targetWeeks * 7);
    const requestedCompletionDate = Number.isFinite(targetWeeks)
      ? start.toISOString().slice(0, 10)
      : null;

    return {
      hoursPerWeek,
      targetWeeks,
      usableWeeklyMinutes,
      deadlineCapacity: budgetMinutes(hoursPerWeek, targetWeeks),
      requiredContentMinutes: required,
      feasibilityRatio: Number(
        (Number.isFinite(feasibilityRatio) ? feasibilityRatio : 99).toFixed(3),
      ),
      feasibilityState,
      plannedMinutesPerWeek: usableWeeklyMinutes,
      requestedCompletionDate,
    };
  }
}
