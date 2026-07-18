import type { Goal } from '../goals/entities/goal.entity';
import type { PlannedPhase } from './roadmap-plan.types';

export const ROADMAP_GENERATOR_PROMPT_VERSION = 'roadmap_generator_v1';

export function buildRoadmapAiSystemPrompt(): string {
  return [
    'You are Arlo roadmap_generator_v1, a roadmap NARRATOR.',
    'The lesson SELECTION and ORDER are already decided by the app and are correct.',
    'Your job is only to name, group, and describe them — never to change them.',
    '',
    'INPUT (user message): an ORDERED array of units the learner will study, in final study order,',
    'each with an id, title, skill, unitRole, and minutes; plus learner context',
    '(primaryTrack, learningStyleWeights, blockerTags).',
    '',
    'Return ONLY valid JSON matching the schema described in the user message.',
    '',
    'You MAY:',
    '- Write phase titles, mission names, and description/"why" copy.',
    '- Group the ordered units into 3–6 CONTIGUOUS phases (slices of the array, in order).',
    '- Pick resourceIds ONLY from the ids provided on each unit.',
    '- Prefer mission names that fit the learningStyle tags already on the units.',
    '',
    'You MUST NOT:',
    '- Add, remove, or REORDER any unit, milestone, or phase — not even within a phase.',
    '- Move a unit from the slice it falls in; phases are contiguous and cover every unit once.',
    '- Invent lessons, skills, phases, URLs, or resourceIds not in the snapshot.',
    '- Claim guaranteed jobs, certificates, or job-ready outcomes.',
    '',
    'If blockerTags indicate "no clear path", the title/description must lead with the FULL',
    'visible journey end-to-end, so the learner sees where the path goes before phase 1.',
    '',
    'Output contract (validated in code — violations are rejected):',
    '- Every input unit id appears exactly once across all phases, in the original order.',
    '- Phases are contiguous, 3–6 total, each with a human, outcome-based title (never "Phase 1").',
    '- "why" is one sentence on the progression, naming the learner\'s goal.',
    '- Keep language encouraging and concise. JSON only, no markdown.',
  ].join('\n');
}

export function buildRoadmapAiUserPrompt(input: {
  goal: Goal;
  recipeTitle: string;
  phases: PlannedPhase[];
  allowedResourceIds: string[];
}): string {
  const snapshot = {
    goal: {
      targetRoles: input.goal.targetRoles,
      skills: input.goal.skills,
      weeklyHours: input.goal.weeklyHours,
      targetDeadline: input.goal.targetDeadline,
      learningStyles: input.goal.learningStyles,
      confidence: input.goal.confidence,
      quitReasons: input.goal.quitReasons,
      motivation: input.goal.motivation,
    },
    recipeTitle: input.recipeTitle,
    allowedResourceIds: input.allowedResourceIds,
    phases: input.phases.map((phase) => ({
      key: phase.key,
      title: phase.title,
      techStackSlug: phase.techStackSlug,
      milestones: phase.milestones.map((m) => ({
        skillNodeId: m.skill.id,
        title: m.title,
        compress: m.compress,
        lessons: m.lessons.map((l) => ({
          lessonTemplateId: l.template.id,
          title: l.title,
          missionName: l.missionName,
          lessonType: l.template.lessonType,
          learningStyleTags: l.template.learningStyleTags,
          estimatedMinutes: l.template.estimatedMinutes,
          resourceId: l.resourceId,
        })),
      })),
    })),
  };

  return [
    'Enrich this deterministic learning path.',
    'JSON schema to return:',
    JSON.stringify(
      {
        pathTitle: 'string optional',
        phases: [
          {
            key: 'phase key from snapshot',
            title: 'optional rename',
            milestoneOrder: ['optional skillNodeId order'],
            milestones: [
              {
                skillNodeId: 'uuid',
                title: 'optional',
                lessonOrder: ['optional lessonTemplateId order'],
                lessons: [
                  {
                    lessonTemplateId: 'uuid',
                    title: 'optional',
                    missionName: 'optional string or null',
                    resourceId: 'optional uuid from allowedResourceIds or null',
                  },
                ],
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
    'Snapshot:',
    JSON.stringify(snapshot),
  ].join('\n\n');
}
