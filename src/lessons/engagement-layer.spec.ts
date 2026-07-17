import { createHash } from 'crypto';
import { LessonStatus } from '../roadmaps/entities/lesson.entity';
import { projectRoadmapMap } from '../roadmaps/roadmap-map.projection';
import { RewardCalculatorService } from '../gamification/reward-calculator.service';
import { CoachPersonalityService } from './coach-personality.service';
import { LessonContentService } from './lesson-content.service';
import {
  ACTIVE_LESSON_TYPES,
  collectSecretKeyHits,
  isUnitPlayContent,
  stripPlaySecrets,
  type ActiveFormatPlayContent,
} from './lesson-play.types';

describe('Engagement layer acceptance (§15)', () => {
  const frontendScenario: ActiveFormatPlayContent = {
    objective: 'Pick the flex fix',
    blocks: [
      {
        type: 'scenario_decision',
        id: 'sd1',
        setup: 'Layout breaks on mobile',
        options: [
          { id: 'flex', label: 'Flex' },
          { id: 'float', label: 'Float' },
        ],
        correctOptionId: 'flex',
        outcomes: { flex: 'Good', float: 'Bad' },
      },
      {
        type: 'drag_order',
        id: 'do1',
        items: [
          { id: 'a', label: 'A' },
          { id: 'b', label: 'B' },
        ],
        correctOrderHash: createHash('sha256').update('a|b').digest('hex'),
        correctOrder: ['a', 'b'],
      },
    ],
  };

  const marketingScenario: ActiveFormatPlayContent = {
    objective: 'CTR drop decision',
    blocks: [
      {
        type: 'scenario_decision',
        id: 'sd_mkt',
        setup: 'CTR dropped 30%',
        options: [
          { id: 'ab', label: 'A/B test' },
          { id: 'pause', label: 'Pause' },
        ],
        correctOptionId: 'ab',
        outcomes: { ab: 'Isolate creative', pause: 'Stops learning' },
      },
      {
        type: 'sandbox_simulation',
        id: 'ss1',
        simulationAssetKey: 'campaign-dash-v1',
        actions: ['increase_budget', 'pause', 'reallocate'],
        correctActions: ['reallocate'],
        outcomeCopy: 'Reallocate to winning ad set',
      },
    ],
  };

  function makeContent(): LessonContentService {
    return new LessonContentService(
      { save: jest.fn() } as never,
      { getUnitById: jest.fn() } as never,
      { resolveFresh: jest.fn().mockResolvedValue(null) } as never,
    );
  }

  it('domain-agnostic: secret-strips active blocks for frontend + marketing tracks', () => {
    for (const content of [frontendScenario, marketingScenario]) {
      expect(isUnitPlayContent(content)).toBe(true);
      const publicBody = stripPlaySecrets(content) as ActiveFormatPlayContent;
      expect(collectSecretKeyHits(publicBody)).toEqual([]);
      const scenario = publicBody.blocks.find(
        (b) => b.type === 'scenario_decision',
      ) as Record<string, unknown> | undefined;
      expect(scenario?.correctOptionId).toBeUndefined();
      expect(scenario?.outcomes).toBeUndefined();
    }
  });

  it('grades scenario / drag / sandbox across two tracks', () => {
    const svc = makeContent();

    const fe = svc.gradeScenario(frontendScenario, 'sd1', 'flex', false);
    expect(fe.correct).toBe(true);
    expect(fe.xpEligible).toBe(true);

    const drag = svc.gradeDragOrder(frontendScenario, 'do1', ['a', 'b'], false);
    expect(drag.correct).toBe(true);

    const mkt = svc.gradeScenario(marketingScenario, 'sd_mkt', 'pause', false);
    expect(mkt.correct).toBe(false);

    const sand = svc.gradeSandboxSimulation(
      marketingScenario,
      'ss1',
      ['reallocate'],
      {
        alreadyResolved: false,
        unitActionVocabulary: ['increase_budget', 'pause', 'reallocate'],
        unitSimulationAssetKey: 'campaign-dash-v1',
      },
    );
    expect(sand.correct).toBe(true);

    expect(() =>
      svc.gradeSandboxSimulation(marketingScenario, 'ss1', ['hack'], {
        alreadyResolved: false,
        unitActionVocabulary: ['increase_budget', 'pause', 'reallocate'],
      }),
    ).toThrow(/Action not in unit vocabulary/);
  });

  it('rejects re-resolve of scenario block', () => {
    const svc = makeContent();
    expect(() =>
      svc.gradeScenario(frontendScenario, 'sd1', 'flex', true),
    ).toThrow(/already resolved/i);
  });

  it('sandbox snapshot mismatch → SANDBOX_SIMULATION_SNAPSHOT_STALE', () => {
    const svc = makeContent();
    expect(() =>
      svc.gradeSandboxSimulation(marketingScenario, 'ss1', ['reallocate'], {
        alreadyResolved: false,
        unitSimulationAssetKey: 'stale-key',
      }),
    ).toThrow(/snapshot/i);
  });

  it('ACTIVE_LESSON_TYPES are domain-neutral', () => {
    expect([...ACTIVE_LESSON_TYPES]).toEqual([
      'scenario',
      'visual_hotspot',
      'debate',
      'sandbox_simulation',
    ]);
  });

  it('visual path projection is pure layout (no reorder)', () => {
    const roadmap = {
      id: 'rm1',
      primaryRoleSlug: 'frontend',
      phases: [
        {
          id: 'p1',
          title: 'Phase 1',
          narrativeTitle: 'Layout Apprentice',
          orderIndex: 0,
          milestones: [
            {
              orderIndex: 0,
              lessons: [
                {
                  id: 'l1',
                  unitId: 'u1',
                  lessonType: 'reading',
                  status: LessonStatus.Completed,
                  orderIndex: 0,
                  entryAction: null,
                },
                {
                  id: 'l2',
                  unitId: 'u2',
                  lessonType: 'scenario',
                  status: LessonStatus.Available,
                  orderIndex: 1,
                  entryAction: null,
                },
              ],
            },
          ],
        },
      ],
    };
    const map = projectRoadmapMap(roadmap as never);
    expect(map.phases[0].narrativeTitle).toBe('Layout Apprentice');
    expect(map.phases[0].nodes.map((n) => n.unitId)).toEqual(['u1', 'u2']);
    expect(map.phases[0].nodes[0].state).toBe('completed');
    expect(map.phases[0].nodes[1].state).toBe('unlocked');
    expect(map.branchPoints).toEqual([]);
  });

  it('coach tone selected by deterministic code', () => {
    const svc = new CoachPersonalityService(
      null as never,
      null as never,
      null as never,
      null as never,
    );
    expect(svc.selectTone({ inactiveDays: 6 })).toBe('welcome_back');
    expect(svc.selectTone({ dailyStreak: 7 })).toBe('playful');
    expect(svc.selectTone({ justFailed: true })).toBe('encouraging');
    expect(svc.selectTone({ rapportScore: 50, recentCompletion: true })).toBe(
      'playful',
    );
    expect(svc.selectTone({})).toBe('steady');
  });

  it('variable reward roll is proof-gated and idempotent by grant key', () => {
    const calc = new RewardCalculatorService();
    const reading = calc.compute({
      actionKind: 'reading',
      modality: 'reading',
      quizCorrect: 0,
      quizTotal: 0,
      attemptKind: 'first',
      grantKey: 'k1',
    });
    expect(
      reading.metadata.variableRoll == null ||
        Boolean(reading.metadata.rollSkipped),
    ).toBe(true);

    const a = calc.compute({
      actionKind: 'quiz',
      modality: 'quiz',
      quizCorrect: 4,
      quizTotal: 5,
      attemptKind: 'first',
      grantKey: 'proof-key-1',
    });
    const b = calc.compute({
      actionKind: 'quiz',
      modality: 'quiz',
      quizCorrect: 4,
      quizTotal: 5,
      attemptKind: 'first',
      grantKey: 'proof-key-1',
    });
    expect(a.metadata.variableRoll).toEqual(b.metadata.variableRoll);

    const scenario = calc.compute({
      actionKind: 'coding',
      modality: 'scenario',
      quizCorrect: 1,
      quizTotal: 1,
      attemptKind: 'first',
      grantKey: 'scenario-key',
    });
    expect(scenario.metadata.variableRoll).toBeTruthy();
  });
});
