import { SystemFlagKey } from '../system-flags/system-flag.keys';
import { LessonBodyPersonalizerService } from './lesson-body-personalizer.service';
import type { LlmService } from '../common/llm/llm.service';
import type { SystemFlagsService } from '../system-flags/system-flags.service';
import type { Repository } from 'typeorm';
import type { Lesson } from '../roadmaps/entities/lesson.entity';
import type { Roadmap } from '../roadmaps/entities/roadmap.entity';
import type { Goal } from '../goals/entities/goal.entity';
import type { LearnerProfileSnapshot } from '../questionnaire/entities/learner-profile-snapshot.entity';
import type { QuestionnaireResponse } from '../questionnaire/entities/questionnaire-response.entity';
import { ARC_PERSONALIZATION_KEY } from './lesson-body-personalizer.schema';
import type { ReadingPlayContent } from './lesson-play.types';

const SCAFFOLD: ReadingPlayContent = {
  objective: 'Learn X',
  sections: ['Scaffold section one.', 'Scaffold section two.'],
  keyTakeaways: ['Takeaway'],
};

function makeService(opts: {
  flagOn?: boolean;
  llmConfigured?: boolean;
  lesson?: Partial<Lesson> | null;
  llmRaw?: unknown | null;
}) {
  const lessonRow =
    opts.lesson === null
      ? null
      : ({
          id: 'lesson-1',
          title: 'Hooks',
          lessonType: 'reading',
          playContent: SCAFFOLD as unknown as Record<string, unknown>,
          objective: null,
          ...opts.lesson,
        } as Lesson);

  const llm = {
    isConfigured: () => opts.llmConfigured ?? true,
    getModel: async () => 'test-model',
    chatCompletion: async () => {
      if (opts.llmRaw === null) throw new Error('LLM down');
      return {
        model: 'test-model',
        choices: [
          {
            message: {
              content: JSON.stringify(
                opts.llmRaw ?? {
                  objective: 'Personalized',
                  sections: [
                    'Personalized section one.',
                    'Personalized section two.',
                  ],
                },
              ),
            },
          },
        ],
      };
    },
  } as unknown as LlmService;

  const systemFlags = {
    getBool: async (key: string) => {
      if (key === SystemFlagKey.LESSON_BODY_AI_ENABLED) {
        return opts.flagOn ?? true;
      }
      return false;
    },
  } as unknown as SystemFlagsService;

  let saved: Lesson | null = null;
  const lessonsRepo = {
    findOne: async () => lessonRow,
    save: async (row: Lesson) => {
      saved = row;
      return row;
    },
  } as unknown as Repository<Lesson>;

  const roadmapsRepo = {
    findOne: async () =>
      ({
        id: 'rm-1',
        userId: 'u1',
        goalId: 'g1',
        generationMeta: {},
      }) as Roadmap,
  } as unknown as Repository<Roadmap>;

  const goalsRepo = {
    findOne: async () =>
      ({
        id: 'g1',
        userId: 'u1',
        targetRoles: ['front-end'],
        skills: { values: ['html'] },
        learningStyles: { values: ['doing'] },
        currentProfession: 'Marketer',
        motivation: { values: ['career'] },
        rawAnswers: {},
      }) as Goal,
  } as unknown as Repository<Goal>;

  const responsesRepo = {
    findOne: async () =>
      ({ chatTranscript: [] }) as unknown as QuestionnaireResponse,
  } as unknown as Repository<QuestionnaireResponse>;

  const learnerProfilesRepo = {
    findOne: async () => null,
  } as unknown as Repository<LearnerProfileSnapshot>;

  const service = new LessonBodyPersonalizerService(
    llm,
    systemFlags,
    lessonsRepo,
    roadmapsRepo,
    goalsRepo,
    responsesRepo,
    learnerProfilesRepo,
  );

  return { service, getSaved: () => saved };
}

describe('LessonBodyPersonalizerService', () => {
  it('skips when flag off', async () => {
    const { service, getSaved } = makeService({ flagOn: false });
    const result = await service.personalizeLesson({
      lessonId: 'lesson-1',
      userId: 'u1',
      roadmapId: 'rm-1',
    });
    expect(result).toEqual({ ok: false, skipped: 'flag_or_llm_off' });
    expect(getSaved()).toBeNull();
  });

  it('soft-fails when LLM call fails', async () => {
    const llmOff = makeService({ llmConfigured: false });
    expect(await llmOff.service.isEnabled('u1')).toBe(false);

    const { service, getSaved } = makeService({
      llmConfigured: true,
      llmRaw: null,
    });
    const result = await service.personalizeLesson({
      lessonId: 'lesson-1',
      userId: 'u1',
      roadmapId: 'rm-1',
    });
    expect(result).toEqual({ ok: false, skipped: 'llm_soft_fail' });
    expect(getSaved()).toBeNull();
  });

  it('skips when already personalized', async () => {
    const personalized = {
      ...SCAFFOLD,
      [ARC_PERSONALIZATION_KEY]: { source: 'llm' },
    };
    const { service, getSaved } = makeService({
      lesson: {
        playContent: personalized as unknown as Record<string, unknown>,
      },
    });
    const result = await service.personalizeLesson({
      lessonId: 'lesson-1',
      userId: 'u1',
      roadmapId: 'rm-1',
    });
    expect(result).toEqual({ ok: false, skipped: 'already_personalized' });
    expect(getSaved()).toBeNull();
  });

  it('skips when playContent is not valid unit content', async () => {
    const { service, getSaved } = makeService({
      lesson: { playContent: { foo: 'bar' } },
    });
    const result = await service.personalizeLesson({
      lessonId: 'lesson-1',
      userId: 'u1',
      roadmapId: 'rm-1',
    });
    expect(result).toEqual({ ok: false, skipped: 'scaffold_not_ready' });
    expect(getSaved()).toBeNull();
  });

  it('writes personalized playContent and freezes keyTakeaways', async () => {
    const { service, getSaved } = makeService({});
    const result = await service.personalizeLesson({
      lessonId: 'lesson-1',
      userId: 'u1',
      roadmapId: 'rm-1',
    });
    expect(result.ok).toBe(true);
    const saved = getSaved();
    expect(saved).toBeTruthy();
    const play = saved!.playContent as unknown as ReadingPlayContent &
      Record<string, unknown>;
    expect(play.sections).toEqual([
      'Personalized section one.',
      'Personalized section two.',
    ]);
    expect(play.keyTakeaways).toEqual(['Takeaway']);
    expect(play.objective).toBe('Personalized');
    expect(play[ARC_PERSONALIZATION_KEY]).toMatchObject({ source: 'llm' });
    expect(saved!.objective).toBe('Personalized');
  });

  it('rejects section count drift as merge_invalid', async () => {
    const { service, getSaved } = makeService({
      llmRaw: { objective: 'P', sections: ['only one'] },
    });
    const result = await service.personalizeLesson({
      lessonId: 'lesson-1',
      userId: 'u1',
      roadmapId: 'rm-1',
    });
    expect(result).toEqual({ ok: false, skipped: 'merge_invalid' });
    expect(getSaved()).toBeNull();
  });
});
