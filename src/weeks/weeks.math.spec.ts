import {
  computeOnTrack,
  meetsSealCriteria,
  progressPercent,
  sessionsLeft,
  targetWeek,
} from './weeks.math';

describe('weeks.math', () => {
  describe('meetsSealCriteria', () => {
    it('seals when sessions complete', () => {
      expect(
        meetsSealCriteria({
          sessionsDone: 4,
          sessionsPlanned: 4,
          hoursDone: 1,
          hoursPlanned: 8,
        }),
      ).toBe(true);
    });

    it('seals at 80% hours', () => {
      expect(
        meetsSealCriteria({
          sessionsDone: 2,
          sessionsPlanned: 4,
          hoursDone: 6.4,
          hoursPlanned: 8,
        }),
      ).toBe(true);
    });

    it('does not seal early', () => {
      expect(
        meetsSealCriteria({
          sessionsDone: 2,
          sessionsPlanned: 4,
          hoursDone: 3,
          hoursPlanned: 8,
        }),
      ).toBe(false);
    });
  });

  describe('computeOnTrack', () => {
    it('allows one session behind', () => {
      // Wed (dayIndex 2), 4 planned → expected floor(4*3/7)=1 → need >=0
      expect(
        computeOnTrack({
          sealed: false,
          sessionsDone: 0,
          sessionsPlanned: 4,
          dayIndex: 2,
        }),
      ).toBe(true);
    });

    it('flags behind when more than one short', () => {
      // Sat (dayIndex 5), 4 planned → expected floor(4*6/7)=3 → need >=2
      expect(
        computeOnTrack({
          sealed: false,
          sessionsDone: 0,
          sessionsPlanned: 4,
          dayIndex: 5,
        }),
      ).toBe(false);
    });

    it('true when sealed', () => {
      expect(
        computeOnTrack({
          sealed: true,
          sessionsDone: 0,
          sessionsPlanned: 4,
          dayIndex: 6,
        }),
      ).toBe(true);
    });
  });

  describe('helpers', () => {
    it('progressPercent prefers hours', () => {
      expect(progressPercent(5.5, 8, 3, 4)).toBe(69);
    });

    it('sessionsLeft + targetWeek', () => {
      expect(sessionsLeft(4, 3)).toBe(1);
      expect(targetWeek(7, false)).toBe(8);
      expect(targetWeek(8, true)).toBe(8);
    });
  });
});
