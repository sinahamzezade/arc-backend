import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { Goal, GoalStatus } from '../goals/entities/goal.entity';
import {
  Profile,
  QuestionnaireStatus,
} from '../profiles/entities/profile.entity';
import { ReferralsService } from '../referrals/referrals.service';
import { RoadmapsService } from '../roadmaps/roadmaps.service';
import {
  QuestionnaireResponse,
  QuestionnaireResponseStatus,
} from './entities/questionnaire-response.entity';
import { QuestionnaireSchemaService } from './questionnaire-schema.service';
import { toQuestionnaireDto } from './questionnaire.serializer';
import {
  assertCompleteAnswers,
  normalizeDraftAnswers,
  withOther,
} from './questionnaire.validation';
import {
  asOptionalString,
  asSchedule,
  asString,
  asStringArray,
  emptyQuestionnaireAnswers,
  type QuestionnaireAnswers,
} from './types/answers';

/**
 * Question Engine service — schema/draft/submit + goals upsert.
 * Hands off to Roadmap Generator via enqueueGenerate(goalId) only.
 */
@Injectable()
export class QuestionnaireService {
  constructor(
    @InjectRepository(QuestionnaireResponse)
    private readonly responsesRepo: Repository<QuestionnaireResponse>,
    private readonly schemaService: QuestionnaireSchemaService,
    private readonly roadmapsService: RoadmapsService,
    private readonly dataSource: DataSource,
    @Optional()
    private readonly referrals?: ReferralsService,
  ) {}

  getSchema() {
    const schema = this.schemaService.getSchema();
    if (!schema.steps.length) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'Questionnaire schema is not available',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return schema;
  }

  async getForUser(userId: string) {
    const row = await this.responsesRepo.findOne({ where: { userId } });
    return toQuestionnaireDto(row);
  }

  async upsertDraft(userId: string, rawAnswers: unknown) {
    const schema = this.getSchema();
    const answers = normalizeDraftAnswers(rawAnswers, schema);
    const schemaVersion = schema.schemaVersion;

    return this.dataSource.transaction(async (manager) => {
      const responseRepo = manager.getRepository(QuestionnaireResponse);
      const profileRepo = manager.getRepository(Profile);

      let row = await responseRepo.findOne({ where: { userId } });

      if (row?.status === QuestionnaireResponseStatus.Submitted) {
        throw new AppException(
          AuthErrorCode.QUESTIONNAIRE_ALREADY_SUBMITTED,
          'Questionnaire already submitted — cannot update draft',
          HttpStatus.CONFLICT,
        );
      }

      if (!row) {
        row = responseRepo.create({
          userId,
          status: QuestionnaireResponseStatus.Draft,
          answers,
          schemaVersion,
          goalId: null,
          submittedAt: null,
        });
      } else {
        row.answers = answers;
        row.schemaVersion = schemaVersion;
        row.status = QuestionnaireResponseStatus.Draft;
      }

      const saved = await responseRepo.save(row);

      const profile = await profileRepo.findOne({ where: { userId } });
      if (!profile) {
        throw new AppException(
          AuthErrorCode.UNAUTHORIZED,
          'Profile not found',
          HttpStatus.NOT_FOUND,
        );
      }
      if (profile.questionnaireStatus === QuestionnaireStatus.NotStarted) {
        profile.questionnaireStatus = QuestionnaireStatus.InProgress;
        await profileRepo.save(profile);
      }

      return toQuestionnaireDto(saved);
    });
  }

  async submit(userId: string, rawAnswers: unknown) {
    const schema = this.getSchema();
    const answers = assertCompleteAnswers(rawAnswers, schema);
    const schemaVersion = schema.schemaVersion;

    const existing = await this.responsesRepo.findOne({ where: { userId } });
    if (
      existing?.status === QuestionnaireResponseStatus.Submitted &&
      existing.goalId
    ) {
      // Allow goal refresh when user re-submits (e.g. after unsupported role).
      const goal = await this.dataSource.transaction(async (manager) => {
        const updated = await this.upsertGoal(manager, userId, answers);
        existing.answers = answers;
        existing.schemaVersion = schemaVersion;
        existing.goalId = updated.id;
        await manager.getRepository(QuestionnaireResponse).save(existing);
        return updated;
      });
      const roadmap = await this.roadmapsService.enqueueGenerate(
        goal.id,
        userId,
      );
      return {
        questionnaire: toQuestionnaireDto(existing),
        goal: this.toGoalSummary(goal),
        roadmap,
      };
    }

    const { saved, goal } = await this.dataSource.transaction(
      async (manager) => {
        const responseRepo = manager.getRepository(QuestionnaireResponse);
        const profileRepo = manager.getRepository(Profile);

        let row = await responseRepo.findOne({ where: { userId } });
        if (!row) {
          row = responseRepo.create({
            userId,
            answers: emptyQuestionnaireAnswers(),
            schemaVersion,
            goalId: null,
            submittedAt: null,
            status: QuestionnaireResponseStatus.Draft,
          });
        }

        const goal = await this.upsertGoal(manager, userId, answers);

        row.answers = answers;
        row.status = QuestionnaireResponseStatus.Submitted;
        row.schemaVersion = schemaVersion;
        row.goalId = goal.id;
        row.submittedAt = new Date();
        const saved = await responseRepo.save(row);

        const profile = await profileRepo.findOne({ where: { userId } });
        if (!profile) {
          throw new AppException(
            AuthErrorCode.UNAUTHORIZED,
            'Profile not found',
            HttpStatus.NOT_FOUND,
          );
        }
        const now = new Date();
        profile.questionnaireStatus = QuestionnaireStatus.Completed;
        profile.questionnaireCompletedAt = now;
        profile.onboardingCompletedAt = profile.onboardingCompletedAt ?? now;
        await profileRepo.save(profile);

        return { saved, goal };
      },
    );

    const roadmap = await this.roadmapsService.enqueueGenerate(goal.id, userId);

    try {
      await this.referrals?.evaluateInvitee(userId);
    } catch {
      /* referral progress must not block questionnaire */
    }

    return {
      questionnaire: toQuestionnaireDto(saved),
      goal: this.toGoalSummary(goal),
      roadmap,
    };
  }

  private async upsertGoal(
    manager: EntityManager,
    userId: string,
    answers: QuestionnaireAnswers,
  ): Promise<Goal> {
    const goalsRepo = manager.getRepository(Goal);
    const existing = await goalsRepo.findOne({
      where: { userId, status: GoalStatus.Active },
      order: { updatedAt: 'DESC' },
    });

    const goal = asStringArray(answers, 'goal');
    const goalOther = asOptionalString(answers, 'goalOther');
    const schedule = asSchedule(answers, 'schedule');

    const payload: Partial<Goal> = {
      userId,
      targetRoles: [
        ...goal,
        ...(goalOther
          ? [
              goalOther
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '')
                .slice(0, 64) || goalOther,
            ]
          : []),
      ],
      motivation: withOther(
        asStringArray(answers, 'motivation'),
        asOptionalString(answers, 'motivationOther'),
      ),
      currentProfession: asString(answers, 'currentJob') || null,
      currentProfessionOther: asOptionalString(answers, 'currentJobOther') ?? null,
      skills: withOther(
        asStringArray(answers, 'skills'),
        asOptionalString(answers, 'skillsOther'),
      ),
      weeklyHours: asString(answers, 'studyHours') || null,
      availability: {
        days: schedule.days,
        times: schedule.times,
      },
      targetDeadline: asString(answers, 'deadline') || null,
      learningStyles: withOther(
        asStringArray(answers, 'learningStyle'),
        asOptionalString(answers, 'learningStyleOther'),
      ),
      confidence: asString(answers, 'confidence') || null,
      quitReasons: withOther(
        asStringArray(answers, 'quitReasons'),
        asOptionalString(answers, 'quitReasonsOther'),
      ),
      rawAnswers: answers as Record<string, unknown>,
      status: GoalStatus.Active,
    };

    if (existing) {
      Object.assign(existing, payload);
      return goalsRepo.save(existing);
    }

    return goalsRepo.save(goalsRepo.create(payload));
  }

  private toGoalSummary(goal: Goal) {
    return {
      id: goal.id,
      status: goal.status,
      targetRoles: goal.targetRoles,
      weeklyHours: goal.weeklyHours,
      targetDeadline: goal.targetDeadline,
    };
  }
}
