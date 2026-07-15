import { CONTENT_SAFETY_FACTOR } from '../content-pool/content-pool.constants';
import type { Unit } from '../content-pool/entities/unit.entity';
import {
  prerequisiteClosure,
  topologicalSortSkills,
} from '../content-pool/units-graph.util';
import { assertNarratorPhasesValid } from './roadmap-narrator.schema';
import { RoadmapPipelineService } from './roadmap-pipeline.service';

describe('roadmap pipeline primitives', () => {
  it('budget uses safety factor', () => {
    const hours = 5;
    const weeks = 12;
    expect(hours * weeks * 60 * CONTENT_SAFETY_FACTOR).toBe(3060);
  });

  it('gap closure includes prerequisites', () => {
    const skills = [
      { id: 'html-css:html-intro', title: 'HTML', prerequisites: [], level: 1 },
      {
        id: 'html-css:css-intro',
        title: 'CSS',
        prerequisites: ['html-css:html-intro'],
        level: 1,
      },
      {
        id: 'html-css:css-flexbox',
        title: 'Flex',
        prerequisites: ['html-css:css-intro'],
        level: 1,
      },
    ];
    const byId = new Map(skills.map((s) => [s.id, s]));
    const closed = prerequisiteClosure(['html-css:css-flexbox'], byId);
    expect(closed.has('html-css:html-intro')).toBe(true);
    const ordered = topologicalSortSkills(skills)
      .filter((s) => closed.has(s.id))
      .map((s) => s.id);
    expect(ordered).toEqual([
      'html-css:html-intro',
      'html-css:css-intro',
      'html-css:css-flexbox',
    ]);
  });

  it('narrator validator accepts contiguous slices', () => {
    expect(() =>
      assertNarratorPhasesValid(
        {
          title: 'Path',
          description: 'd',
          why: 'w',
          phases: [
            { key: 'a', title: 'Foundations', lessonIndices: [0, 1] },
            { key: 'b', title: 'CSS', lessonIndices: [2, 3, 4] },
            { key: 'c', title: 'JS', lessonIndices: [5] },
          ],
        },
        6,
      ),
    ).not.toThrow();
  });

  it('narrator validator rejects gaps', () => {
    expect(() =>
      assertNarratorPhasesValid(
        {
          title: 'Path',
          description: 'd',
          why: 'w',
          phases: [
            { key: 'a', title: 'A', lessonIndices: [0, 1] },
            { key: 'b', title: 'B', lessonIndices: [3, 4] },
            { key: 'c', title: 'C', lessonIndices: [2] },
          ],
        },
        5,
      ),
    ).toThrow();
  });

  it('keeps the full beginner teaching path across staged units', () => {
    const service = new RoadmapPipelineService(
      null as never,
      null as never,
      null as never,
    );
    const pick = (
      service as unknown as {
        preferStageRoleUnits: (
          units: Unit[],
          plan: { action: string; entryStage: number },
        ) => Unit[];
      }
    ).preferStageRoleUnits.bind(service);

    const units = [
      unit('email-reading', 'reading', 'foundation', [1, 2]),
      unit('email-practice', 'practice', 'proof', [2, 3, 4]),
      unit('email-quiz', 'quiz', 'checkpoint', [3, 4, 5]),
    ];

    expect(
      pick(units, { action: 'foundation', entryStage: 1 }).map((u) => u.id),
    ).toEqual(['email-reading', 'email-practice', 'email-quiz']);
    expect(
      pick(units, { action: 'checkpoint', entryStage: 4 }).map((u) => u.id),
    ).toEqual(['email-quiz']);
  });

  it('keeps proof and checkpoint units despite reading-only style', () => {
    const service = new RoadmapPipelineService(
      null as never,
      null as never,
      null as never,
    );
    const keep = (
      service as unknown as {
        keepStyleMatchesWithEvidence: (units: Unit[], styles: string[]) => Unit[];
      }
    ).keepStyleMatchesWithEvidence.bind(service);

    const units = [
      unit('email-reading', 'reading', 'foundation', [1, 2]),
      unit('email-practice', 'practice', 'proof', [2, 3, 4]),
      unit('email-quiz', 'quiz', 'checkpoint', [3, 4, 5]),
    ];

    expect(keep(units, ['reading']).map((u) => u.id)).toEqual([
      'email-reading',
      'email-practice',
      'email-quiz',
    ]);
  });
});

function unit(
  id: string,
  lessonType: string,
  unitRole: string,
  servesStage: number[],
): Unit {
  return {
    id,
    lessonType,
    unitRole,
    servesStage,
    formats: [lessonType],
    skillsTaught: ['digital-marketing:email-marketing'],
    prerequisites: [],
    estimatedMinutes: 20,
  } as unknown as Unit;
}
