import {
  dayIndexNow,
  eligibleFromDayIndex,
  weekStartMonday,
} from './weeks.time';

describe('eligibleFromDayIndex', () => {
  const tz = 'UTC';

  it('returns 0 when join was in a prior week', () => {
    // A Monday
    const weekStart = '2026-07-06';
    const joinedPrior = new Date('2026-06-30T12:00:00.000Z');
    expect(
      eligibleFromDayIndex({
        weekStart,
        timeZone: tz,
        joinedAt: joinedPrior,
      }),
    ).toBe(0);
  });

  it('returns join weekday index when joined mid-week', () => {
    // Learning week Mon 2026-07-06; join Wednesday
    const joined = new Date('2026-07-08T12:00:00.000Z');
    const weekStart = weekStartMonday(joined, tz);
    expect(weekStart).toBe('2026-07-06');
    expect(dayIndexNow(joined, tz)).toBe(2);
    expect(
      eligibleFromDayIndex({
        weekStart,
        timeZone: tz,
        joinedAt: joined,
      }),
    ).toBe(2);
  });

  it('returns 0 when joinedAt missing', () => {
    expect(
      eligibleFromDayIndex({
        weekStart: '2026-07-06',
        timeZone: tz,
        joinedAt: null,
      }),
    ).toBe(0);
  });
});
