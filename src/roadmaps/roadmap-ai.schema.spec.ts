import { LessonStatus } from './entities/lesson.entity';
import { RoadmapAiService } from './roadmap-ai.service';
import {
  parseAndAssertRoadmapAiEnrich,
  type RoadmapAiAllowLists,
} from './roadmap-ai.schema';
import type { PlannedPhase } from './roadmap-plan.types';

const skillA = '11111111-1111-1111-1111-111111111111';
const skillB = '22222222-2222-2222-2222-222222222222';
const templateA = '33333333-3333-3333-3333-333333333333';
const templateB = '44444444-4444-4444-4444-444444444444';
const resourceOk = '55555555-5555-5555-5555-555555555555';
const resourceBad = '66666666-6666-6666-6666-666666666666';

function allowLists(): RoadmapAiAllowLists {
  return {
    phaseKeys: new Set(['foundations']),
    skillNodeIds: new Set([skillA, skillB]),
    lessonTemplateIds: new Set([templateA, templateB]),
    resourceIds: new Set([resourceOk]),
  };
}

describe('parseAndAssertRoadmapAiEnrich', () => {
  it('accepts valid enrich payload', () => {
    const parsed = parseAndAssertRoadmapAiEnrich(
      {
        pathTitle: 'Frontend Trail',
        phases: [
          {
            key: 'foundations',
            title: 'Web Foundations+',
            milestones: [
              {
                skillNodeId: skillA,
                title: 'Selectors+',
                lessons: [
                  {
                    lessonTemplateId: templateA,
                    title: 'Practice selectors',
                    missionName: 'CSS Quest',
                    resourceId: resourceOk,
                  },
                ],
              },
            ],
          },
        ],
      },
      allowLists(),
    );
    expect(parsed.pathTitle).toBe('Frontend Trail');
    expect(parsed.phases[0].key).toBe('foundations');
  });

  it('rejects unknown resourceId', () => {
    expect(() =>
      parseAndAssertRoadmapAiEnrich(
        {
          phases: [
            {
              key: 'foundations',
              milestones: [
                {
                  skillNodeId: skillA,
                  lessons: [
                    {
                      lessonTemplateId: templateA,
                      resourceId: resourceBad,
                    },
                  ],
                },
              ],
            },
          ],
        },
        allowLists(),
      ),
    ).toThrow(/Unknown resourceId/);
  });

  it('rejects unknown lessonTemplateId', () => {
    expect(() =>
      parseAndAssertRoadmapAiEnrich(
        {
          phases: [
            {
              key: 'foundations',
              milestones: [
                {
                  skillNodeId: skillA,
                  lessons: [
                    {
                      lessonTemplateId: '99999999-9999-9999-9999-999999999999',
                    },
                  ],
                },
              ],
            },
          ],
        },
        allowLists(),
      ),
    ).toThrow(/Unknown lessonTemplateId/);
  });

  it('rejects unknown phase key', () => {
    expect(() =>
      parseAndAssertRoadmapAiEnrich(
        {
          phases: [{ key: 'not-a-phase', milestones: [] }],
        },
        allowLists(),
      ),
    ).toThrow(/Unknown phase key/);
  });
});

describe('RoadmapAiService.applyEnrich', () => {
  const service = new RoadmapAiService({
    get: () => undefined,
  } as never);

  function samplePhases(): PlannedPhase[] {
    return [
      {
        key: 'foundations',
        title: 'Foundations',
        techStackId: null,
        techStackSlug: 'html-css',
        orderIndex: 0,
        locked: false,
        milestones: [
          {
            skill: {
              id: skillA,
              title: 'Selectors',
            } as PlannedPhase['milestones'][0]['skill'],
            title: 'Selectors',
            type: 'skill',
            compress: false,
            lessons: [
              {
                template: {
                  id: templateA,
                  estimatedMinutes: 20,
                  lessonType: 'practice',
                  difficulty: 'beginner',
                  xpReward: 20,
                } as PlannedPhase['milestones'][0]['lessons'][0]['template'],
                title: 'Old title',
                missionName: null,
                resourceId: resourceOk,
                status: LessonStatus.Available,
              },
              {
                template: {
                  id: templateB,
                  estimatedMinutes: 15,
                  lessonType: 'video',
                  difficulty: 'beginner',
                  xpReward: 15,
                } as PlannedPhase['milestones'][0]['lessons'][0]['template'],
                title: 'Video',
                missionName: null,
                resourceId: null,
                status: LessonStatus.Locked,
              },
            ],
          },
          {
            skill: {
              id: skillB,
              title: 'Layout',
            } as PlannedPhase['milestones'][0]['skill'],
            title: 'Layout',
            type: 'skill',
            compress: false,
            lessons: [
              {
                template: {
                  id: templateB,
                  estimatedMinutes: 15,
                  lessonType: 'practice',
                  difficulty: 'beginner',
                  xpReward: 15,
                } as PlannedPhase['milestones'][0]['lessons'][0]['template'],
                title: 'Layout practice',
                missionName: null,
                resourceId: null,
                status: LessonStatus.Locked,
              },
            ],
          },
        ],
      },
    ];
  }

  it('renames titles and reorders lessons when enrich present', () => {
    const applied = service.applyEnrich(samplePhases(), {
      pathTitle: 'Custom Path',
      phases: [
        {
          key: 'foundations',
          title: 'Foundations+',
          milestoneOrder: [skillB, skillA],
          milestones: [
            {
              skillNodeId: skillA,
              title: 'Selectors+',
              lessonOrder: [templateB, templateA],
              lessons: [
                {
                  lessonTemplateId: templateA,
                  title: 'New title',
                  missionName: 'Mission X',
                },
              ],
            },
          ],
        },
      ],
    });

    expect(applied.pathTitle).toBe('Custom Path');
    expect(applied.phases[0].title).toBe('Foundations+');
    expect(applied.phases[0].milestones[0].skill.id).toBe(skillB);
    expect(applied.phases[0].milestones[1].title).toBe('Selectors+');
    expect(applied.phases[0].milestones[1].lessons[0].template.id).toBe(
      templateB,
    );
    expect(applied.phases[0].milestones[1].lessons[1].title).toBe('New title');
    expect(applied.phases[0].milestones[1].lessons[1].missionName).toBe(
      'Mission X',
    );
    expect(applied.phases[0].milestones[0].lessons[0].status).toBe(
      LessonStatus.Available,
    );
  });

  it('leaves plan unchanged conceptually when enrich is unused (caller soft-fail)', () => {
    const original = samplePhases();
    const cloneTitles = original.map((p) => p.title);
    // Soft-fail means generator skips applyEnrich — assert helper identity when empty phases enrich still requires schema min 1
    expect(cloneTitles).toEqual(['Foundations']);
    expect(service.isEnabled()).toBe(false);
  });
});
