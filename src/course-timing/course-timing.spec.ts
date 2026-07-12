import { FeasibilityState, feasibilityFromRatio } from './timing.constants';
import { CapacityService } from './capacity.service';
import { PaceEngineService } from './pace-engine.service';
import { PaceState } from './timing.constants';

describe('feasibilityFromRatio', () => {
  it('maps bands', () => {
    expect(feasibilityFromRatio(0.5)).toBe(FeasibilityState.Comfortable);
    expect(feasibilityFromRatio(0.9)).toBe(FeasibilityState.Feasible);
    expect(feasibilityFromRatio(1.1)).toBe(FeasibilityState.Compressed);
    expect(feasibilityFromRatio(1.5)).toBe(FeasibilityState.Unrealistic);
  });
});

describe('CapacityService', () => {
  const svc = new CapacityService();

  it('applies 0.85 safety and decodes tokens', () => {
    const r = svc.compute({
      weeklyHoursToken: '5-8',
      deadlineToken: '3-6',
      requiredContentMinutes: 2000,
    });
    expect(r.hoursPerWeek).toBe(6.5);
    expect(r.targetWeeks).toBe(16);
    expect(r.usableWeeklyMinutes).toBe(Math.round(6.5 * 60 * 0.85));
    expect(r.feasibilityState).toBeDefined();
  });
});

describe('PaceEngineService', () => {
  const svc = new PaceEngineService();

  it('uses planned pace for new users', () => {
    const r = svc.compute({
      plannedMinutesPerWeek: 300,
      remainingMinutes: 3000,
      currentWeekCompleted: 50,
      previousWeekCompleted: 40,
      olderBaseline: 300,
      activeDays: 2,
      targetCompletionDate: '2026-12-01',
    });
    expect(r.effectiveMinutesPerWeek).toBe(300);
    expect(r.paceState).toBe(PaceState.OnTrack);
  });

  it('EWMA after enough active days', () => {
    const r = svc.compute({
      plannedMinutesPerWeek: 300,
      remainingMinutes: 3000,
      currentWeekCompleted: 400,
      previousWeekCompleted: 350,
      olderBaseline: 300,
      activeDays: 10,
      targetCompletionDate: '2026-12-01',
    });
    expect(r.effectiveMinutesPerWeek).toBe(
      Math.round(0.5 * 400 + 0.3 * 350 + 0.2 * 300),
    );
    expect(r.paceState).toBe(PaceState.Ahead);
  });
});
