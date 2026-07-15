import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LlmService } from '../common/llm/llm.service';
import { Goal } from '../goals/entities/goal.entity';
import {
  LearnerProfileSnapshot,
  LearnerProfileStatus,
} from '../questionnaire/entities/learner-profile-snapshot.entity';
import { QuestionnaireResponse } from '../questionnaire/entities/questionnaire-response.entity';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import { Roadmap } from '../roadmaps/entities/roadmap.entity';
import { SystemFlagKey } from '../system-flags/system-flag.keys';
import { SystemFlagsService } from '../system-flags/system-flags.service';
import {
  buildLessonBodyPersonalizerSystemPrompt,
  buildLessonBodyPersonalizerUserPrompt,
  buildLessonBodyUserPacket,
  LESSON_BODY_PERSONALIZER_PROMPT_VERSION,
  type LessonBodySafeFields,
} from './lesson-body-personalizer.prompt';
import {
  extractSafeFields,
  isAlreadyPersonalized,
  mergeLessonBodyRewrite,
  parseLessonBodyRewrite,
} from './lesson-body-personalizer.schema';
import {
  isUnitPlayContent,
  normalizeUnitPlayContent,
  type UnitPlayContent,
} from './lesson-play.types';

export type PersonalizeResult =
  | { ok: true; model: string; skipped?: never }
  | { ok: false; skipped: string };

@Injectable()
export class LessonBodyPersonalizerService {
  private readonly logger = new Logger(LessonBodyPersonalizerService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly systemFlags: SystemFlagsService,
    @InjectRepository(Lesson)
    private readonly lessonsRepo: Repository<Lesson>,
    @InjectRepository(Roadmap)
    private readonly roadmapsRepo: Repository<Roadmap>,
    @InjectRepository(Goal)
    private readonly goalsRepo: Repository<Goal>,
    @InjectRepository(QuestionnaireResponse)
    private readonly responsesRepo: Repository<QuestionnaireResponse>,
    @InjectRepository(LearnerProfileSnapshot)
    private readonly learnerProfilesRepo: Repository<LearnerProfileSnapshot>,
  ) {}

  async isEnabled(userId?: string | null): Promise<boolean> {
    if (!this.llm.isConfigured()) return false;
    return this.systemFlags.getBool(
      SystemFlagKey.LESSON_BODY_AI_ENABLED,
      false,
      userId,
    );
  }

  getPromptVersion(): string {
    return LESSON_BODY_PERSONALIZER_PROMPT_VERSION;
  }

  async personalizeLesson(input: {
    lessonId: string;
    userId: string;
    roadmapId: string;
  }): Promise<PersonalizeResult> {
    if (!(await this.isEnabled(input.userId))) {
      return { ok: false, skipped: 'flag_or_llm_off' };
    }

    const lesson = await this.lessonsRepo.findOne({
      where: { id: input.lessonId },
    });
    if (!lesson) {
      return { ok: false, skipped: 'lesson_missing' };
    }
    if (isAlreadyPersonalized(lesson.playContent)) {
      return { ok: false, skipped: 'already_personalized' };
    }
    if (!isUnitPlayContent(lesson.playContent)) {
      return { ok: false, skipped: 'scaffold_not_ready' };
    }

    const scaffold = normalizeUnitPlayContent(
      lesson.playContent,
    ) as UnitPlayContent;
    const roadmap = await this.roadmapsRepo.findOne({
      where: { id: input.roadmapId, userId: input.userId },
    });
    if (!roadmap) {
      return { ok: false, skipped: 'goal_missing' };
    }
    const goal = await this.goalsRepo.findOne({
      where: { id: roadmap.goalId, userId: input.userId },
    });
    if (!goal) {
      return { ok: false, skipped: 'goal_missing' };
    }

    // Prefer the profile pinned at roadmap generation over the mutable Goal;
    // fall back to the latest active profile, then to Goal-only fields.
    const profile = await this.loadLearnerProfile(roadmap, input.userId);

    const transcript = await this.loadChatTranscript(input.userId);
    const user = buildLessonBodyUserPacket({
      targetRoles: goal.targetRoles ?? [],
      knownSkills: goal.skills?.values ?? [],
      learningStyles: goal.learningStyles?.values ?? [],
      currentProfession: goal.currentProfession,
      motivation: goal.motivation?.values ?? [],
      rawAnswers: (goal.rawAnswers as Record<string, unknown>) ?? {},
      chatTranscript: transcript,
      profile: profile
        ? {
            primaryTrackSlug: profile.primaryTrackSlug,
            provisionalStage: profile.provisionalStage,
            targetStage: profile.targetStage,
            learningStyleWeights: profile.learningStyleWeights ?? {},
            weeklyEffectiveMinutes: profile.weeklyEffectiveMinutes,
          }
        : null,
    });

    // Only rewrite-safe fields leave the server — never questions/answers,
    // acceptanceCriteria, keyTakeaways, starterHtml or URLs.
    const fields = extractSafeFields(scaffold);

    const draftResult = await this.callLlm({
      userId: input.userId,
      user,
      lessonTitle: lesson.title,
      lessonType: lesson.lessonType,
      fields,
    });
    if (!draftResult) {
      return { ok: false, skipped: 'llm_soft_fail' };
    }

    try {
      const draft = parseLessonBodyRewrite(draftResult.raw, fields);
      const merged = mergeLessonBodyRewrite(scaffold, draft, {
        source: 'llm',
        model: draftResult.model,
        promptVersion: this.getPromptVersion(),
        at: new Date().toISOString(),
      });
      lesson.playContent = merged as unknown as Record<string, unknown>;
      if (draft.objective) {
        lesson.objective = draft.objective;
      }
      await this.lessonsRepo.save(lesson);
      this.logger.log(
        `Personalized lesson ${lesson.id} model=${draftResult.model}`,
      );
      return { ok: true, model: draftResult.model };
    } catch (err) {
      this.logger.warn(
        `Lesson body merge soft-fail lesson=${lesson.id}: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return { ok: false, skipped: 'merge_invalid' };
    }
  }

  /**
   * Pinned profile from roadmap.generationMeta.learnerProfileId, falling back
   * to the user's latest active (provisional/verified) profile snapshot.
   */
  private async loadLearnerProfile(
    roadmap: Roadmap,
    userId: string,
  ): Promise<LearnerProfileSnapshot | null> {
    try {
      const pinnedId = (
        roadmap.generationMeta as { learnerProfileId?: unknown } | null
      )?.learnerProfileId;
      if (typeof pinnedId === 'string' && pinnedId) {
        const pinned = await this.learnerProfilesRepo.findOne({
          where: { id: pinnedId, userId },
        });
        if (pinned) return pinned;
      }
      return await this.learnerProfilesRepo.findOne({
        where: [
          { userId, status: LearnerProfileStatus.Provisional },
          { userId, status: LearnerProfileStatus.Verified },
        ],
        order: { version: 'DESC' },
      });
    } catch (err) {
      this.logger.warn(
        `Learner profile load failed: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  private async loadChatTranscript(
    userId: string,
  ): Promise<Array<{ role: string; content: string }>> {
    try {
      const row = await this.responsesRepo.findOne({ where: { userId } });
      return row?.chatTranscript ?? [];
    } catch (err) {
      this.logger.warn(
        `Chat transcript load failed: ${err instanceof Error ? err.message : err}`,
      );
      return [];
    }
  }

  private async callLlm(input: {
    userId: string;
    user: ReturnType<typeof buildLessonBodyUserPacket>;
    lessonTitle: string;
    lessonType: string;
    fields: LessonBodySafeFields;
  }): Promise<{ raw: unknown; model: string } | null> {
    if (!this.llm.isConfigured()) return null;

    const model = await this.llm.getModel('lesson_body');
    try {
      const completion = await this.llm.chatCompletion({
        purpose: 'lesson_body',
        userId: input.userId,
        request: {
          model,
          temperature: 0.55,
          max_tokens: 2500,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: buildLessonBodyPersonalizerSystemPrompt(),
            },
            {
              role: 'user',
              content: buildLessonBodyPersonalizerUserPrompt({
                user: input.user,
                lessonTitle: input.lessonTitle,
                lessonType: input.lessonType,
                fields: input.fields,
              }),
            },
          ],
        },
      });
      const content = completion.choices[0]?.message?.content;
      if (!content) return null;
      const usedModel =
        typeof completion.model === 'string' && completion.model
          ? completion.model
          : model;
      return { raw: JSON.parse(content), model: usedModel };
    } catch (err) {
      this.logger.warn(
        `Lesson body LLM soft-fail: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }
}
