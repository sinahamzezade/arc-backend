import type { Goal } from '../goals/entities/goal.entity';
import type { PlannedPhase } from './roadmap-plan.types';

export const ROADMAP_GENERATOR_PROMPT_VERSION = 'roadmap_generator_v1';

export function buildRoadmapAiSystemPrompt(): string {
  return [
    'You are Arc roadmap_generator_v1.',
    'Enrich a personalized learning path assembled from a curated Learning Document Pool.',
    'Return ONLY valid JSON matching the schema described in the user message.',
    'Hard rules:',
    '- Use only phase keys, skillNodeIds, lessonTemplateIds, and resourceIds from the provided snapshot.',
    '- Do not invent lessons, skills, phases, or URLs.',
    '- Do not claim guaranteed jobs, certificates, or job-ready outcomes.',
    '- Prefer mission names that fit learningStyle tags already on lessons.',
    '- You may rename titles/missionNames and reorder milestones/lessons within a phase using ids only.',
    '- Do not add or remove phases, milestones, or lessons.',
    '- Keep language encouraging and concise.',
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
