import {
  budgetMinutes,
  confidenceMeets,
  decodeTimelineWeeks,
  decodeWeeklyHours,
} from './token-decoders';

describe('token-decoders', () => {
  it('decodes studyHours midpoints', () => {
    expect(decodeWeeklyHours('5-8')).toBe(6.5);
    expect(decodeWeeklyHours('lt-3')).toBe(2);
  });

  it('decodes deadline weeks', () => {
    expect(decodeTimelineWeeks('6-12', 24)).toBe(24);
    expect(decodeTimelineWeeks('none', 24)).toBe(24);
    expect(decodeTimelineWeeks('1-3', 24)).toBe(8);
  });

  it('compares confidence ranks', () => {
    expect(confidenceMeets('somewhat', 'somewhat')).toBe(true);
    expect(confidenceMeets('starting', 'somewhat')).toBe(false);
    expect(confidenceMeets('confident', 'somewhat')).toBe(true);
  });

  it('computes budget minutes', () => {
    expect(budgetMinutes(6.5, 24)).toBe(Math.round(6.5 * 24 * 60 * 0.85));
    expect(budgetMinutes(6.5, 24, 1)).toBe(Math.round(6.5 * 24 * 60));
  });
});
