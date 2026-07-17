import type { Unit } from '../content-pool/entities/unit.entity';
import { parseUnitsOrchestratorDraft } from './roadmap-units-orchestrator.schema';
import { validateAndRepairOrchestratorDraft } from './roadmap-units-orchestrator.validate';
import { RoadmapUnitsOrchestratorService } from './roadmap-units-orchestrator.service';

function fakeUnit(partial: {
  id: string;
  minutes?: number;
  skills: string[];
  role?: string;
  prereqs?: string[];
  lessonType?: string;
}): Unit {
  return {
    id: partial.id,
    title: partial.id,
    estimatedMinutes: partial.minutes ?? 20,
    skillsTaught: partial.skills,
    unitRole: partial.role ?? 'foundation',
    prerequisites: partial.prereqs ?? [],
    lessonType: partial.lessonType ?? 'reading',
    level: 1,
    xp: 10,
    stack: 'test',
    provider: 'arc',
    url: null,
    formats: ['reading'],
    servesStage: [1, 2],
  } as Unit;
}

describe('parseUnitsOrchestratorDraft', () => {
  it('maps compact indices to unit ids', () => {
    const byIndex = new Map([
      [0, 'u-a'],
      [1, 'u-b'],
      [2, 'u-c'],
    ]);
    const allow = new Set(['u-a', 'u-b', 'u-c']);
    const draft = parseUnitsOrchestratorDraft(
      {
        title: 'Path',
        desc: 'd',
        why: 'w',
        phases: [
          { k: 'a', t: 'A', units: [0, 1] },
          { k: 'b', t: 'B', units: [2] },
        ],
      },
      byIndex,
      allow,
    );
    expect(draft.phases[0]!.unitIds).toEqual(['u-a', 'u-b']);
    expect(draft.phases[1]!.unitIds).toEqual(['u-c']);
  });

  it('drops invented ids', () => {
    const byIndex = new Map([[0, 'u-a']]);
    const allow = new Set(['u-a']);
    const draft = parseUnitsOrchestratorDraft(
      {
        title: 'Path',
        phases: [{ k: 'a', t: 'A', units: [0, 'invented-id', 99] }],
      },
      byIndex,
      allow,
    );
    expect(draft.phases[0]!.unitIds).toEqual(['u-a']);
  });
});

describe('validateAndRepairOrchestratorDraft', () => {
  const units = [
    fakeUnit({ id: 'html-1', skills: ['html'], minutes: 15 }),
    fakeUnit({ id: 'css-1', skills: ['css'], minutes: 20, prereqs: ['html'] }),
    fakeUnit({
      id: 'css-check',
      skills: ['css'],
      minutes: 10,
      role: 'checkpoint',
    }),
    fakeUnit({ id: 'js-1', skills: ['js'], minutes: 30 }),
    fakeUnit({ id: 'opt-1', skills: ['opt'], minutes: 40 }),
  ];
  const allowList = new Map(units.map((u) => [u.id, u]));
  const skillPlans = new Map([
    ['html', { action: 'foundation' as const, entryStage: 1 }],
    ['css', { action: 'checkpoint' as const, entryStage: 2 }],
    ['js', { action: 'foundation' as const, entryStage: 1 }],
    ['opt', { action: 'foundation' as const, entryStage: 1 }],
  ]);

  const base = {
    allowList,
    requiredGap: new Set(['html', 'css', 'js']),
    optionalGap: new Set(['opt']),
    orderedGapSkillIds: ['html', 'css', 'js', 'opt'],
    skillPlans,
    budgetMinutes: 200,
    skillTitleById: new Map([
      ['html', 'HTML'],
      ['css', 'CSS'],
      ['js', 'JS'],
      ['opt', 'Optional'],
    ]),
  };

  it('drops invented unit ids', () => {
    const result = validateAndRepairOrchestratorDraft({
      ...base,
      draft: {
        title: 'T',
        description: '',
        why: '',
        phases: [
          {
            key: 'a',
            title: 'A',
            unitIds: ['html-1', 'fake-unit', 'css-1', 'js-1'],
          },
        ],
      },
    });
    expect(result.unitIds).not.toContain('fake-unit');
    expect(result.repaired).toBe(true);
    expect(result.repairReasons.some((r) => r.startsWith('dropped_unknown'))).toBe(
      true,
    );
  });

  it('inserts a unit when a required skill is missing', () => {
    const result = validateAndRepairOrchestratorDraft({
      ...base,
      draft: {
        title: 'T',
        description: '',
        why: '',
        phases: [
          { key: 'a', title: 'A', unitIds: ['html-1', 'css-1'] }, // missing js
        ],
      },
    });
    expect(result.unitIds).toContain('js-1');
    expect(result.repaired).toBe(true);
    expect(
      result.repairReasons.some((r) => r.startsWith('inserted_required:js')),
    ).toBe(true);
  });

  it('reorders so prereq skill is covered before dependent unit', () => {
    const result = validateAndRepairOrchestratorDraft({
      ...base,
      draft: {
        title: 'T',
        description: '',
        why: '',
        phases: [
          {
            key: 'a',
            title: 'A',
            unitIds: ['css-1', 'html-1', 'js-1'],
          },
        ],
      },
    });
    const htmlIdx = result.unitIds.indexOf('html-1');
    const cssIdx = result.unitIds.indexOf('css-1');
    expect(htmlIdx).toBeGreaterThanOrEqual(0);
    expect(cssIdx).toBeGreaterThan(htmlIdx);
    expect(result.repaired).toBe(true);
  });

  it('trims optional units over budget', () => {
    const result = validateAndRepairOrchestratorDraft({
      ...base,
      budgetMinutes: 70, // html+css+js = 65, opt=40 would overflow
      draft: {
        title: 'T',
        description: '',
        why: '',
        phases: [
          {
            key: 'a',
            title: 'A',
            unitIds: ['html-1', 'css-1', 'js-1', 'opt-1'],
          },
        ],
      },
    });
    expect(result.unitIds).not.toContain('opt-1');
    expect(result.unitIds).toEqual(
      expect.arrayContaining(['html-1', 'js-1']),
    );
    // css covered by either css-1 or sole checkpoint css-check
    expect(
      result.unitIds.some((id) => id === 'css-1' || id === 'css-check'),
    ).toBe(true);
  });

  it('protects sole checkpoint for required skill', () => {
    const result = validateAndRepairOrchestratorDraft({
      ...base,
      draft: {
        title: 'T',
        description: '',
        why: '',
        phases: [
          {
            key: 'a',
            title: 'A',
            unitIds: ['html-1', 'css-1', 'js-1'], // css-check is sole checkpoint
          },
        ],
      },
    });
    expect(result.unitIds).toContain('css-check');
  });
});

describe('RoadmapUnitsOrchestratorService fallback', () => {
  it('returns null when LLM is not configured', async () => {
    const llm = {
      isConfigured: () => false,
      getModel: jest.fn(),
      chatCompletion: jest.fn(),
    };
    const svc = new RoadmapUnitsOrchestratorService(llm as never);
    const unit = fakeUnit({ id: 'u1', skills: ['a'] });
    const result = await svc.orchestrate({
      userId: 'user-1',
      learner: {
        roles: [],
        known: [],
        required: ['a'],
        optional: [],
        styles: [],
        hours: 5,
        weeks: 4,
        budget: 200,
        seed: 1,
        goal: 'Test',
        skillPlans: [{ skill: 'a', action: 'foundation', entry: 1 }],
      },
      allowList: [unit],
      requiredGap: new Set(['a']),
      optionalGap: new Set(),
      orderedGapSkillIds: ['a'],
      skillPlans: new Map([
        ['a', { action: 'foundation', entryStage: 1 }],
      ]),
      skillTitleById: new Map([['a', 'A']]),
      budgetMinutes: 200,
      recipeTitle: 'Test',
      roleSlug: 'test',
    });
    expect(result).toBeNull();
    expect(llm.chatCompletion).not.toHaveBeenCalled();
  });
});
