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
import { SystemFlagKey } from '../system-flags/system-flag.keys';
import { SystemFlagsService } from '../system-flags/system-flags.service';
import {
  LearnerProfileSnapshot,
  LearnerProfileStatus,
} from './entities/learner-profile-snapshot.entity';
import { LearnerSkillEstimate } from './entities/learner-skill-estimate.entity';
import {
  QuestionnaireResponse,
  QuestionnaireResponseStatus,
} from './entities/questionnaire-response.entity';
import {
  LearnerProfilingService,
  type DerivedLearnerProfile,
} from './learner-profiling.service';
import { QuestionnaireSchemaService } from './questionnaire-schema.service';
import { toQuestionnaireDto } from './questionnaire.serializer';
import {
  assertCompleteAnswers,
  listMissingFields,
  normalizeDraftAnswers,
  withOther,
} from './questionnaire.validation';
import {
  asOptionalString,
  asSchedule,
  asSkillEvidence,
  asString,
  asStringArray,
  asTrackSelection,
  emptyQuestionnaireAnswers,
  type QuestionnaireAnswers,
} from './types/answers';

export type IntakeMode = 'form' | 'chat';

/**
 * Question Engine service — schema/draft/submit + learner profile + goals.
 */
@Injectable()
export class QuestionnaireService {
  constructor(
    @InjectRepository(QuestionnaireResponse)
    private readonly responsesRepo: Repository<QuestionnaireResponse>,
    @InjectRepository(Profile)
    private readonly profilesRepo: Repository<Profile>,
    @InjectRepository(LearnerProfileSnapshot)
    private readonly profilesSnapshotsRepo: Repository<LearnerProfileSnapshot>,
    private readonly schemaService: QuestionnaireSchemaService,
    private readonly profiling: LearnerProfilingService,
    private readonly roadmapsService: RoadmapsService,
    private readonly dataSource: DataSource,
    private readonly systemFlags: SystemFlagsService,
    @Optional()
    private readonly referrals?: ReferralsService,
  ) {}

  async chatEnabled(userId?: string | null): Promise<boolean> {
    return this.systemFlags.getBool(
      SystemFlagKey.INTAKE_CHAT_ENABLED,
      true,
      userId,
    );
  }

  async defaultIntakeMode(userId?: string | null): Promise<IntakeMode> {
    const raw = (
      await this.systemFlags.getString(
        SystemFlagKey.INTAKE_DEFAULT_MODE,
        'form',
        userId,
      )
    )
      .trim()
      .toLowerCase();
    return raw === 'chat' ? 'chat' : 'form';
  }

  async getIntakeConfig(userId: string) {
    const chatEnabled = await this.chatEnabled(userId);
    const defaultMode = await this.defaultIntakeMode(userId);
    const profile = await this.profilesRepo.findOne({ where: { userId } });
    const userMode =
      profile?.intakeMode === 'form' || profile?.intakeMode === 'chat'
        ? profile.intakeMode
        : null;
    const effectiveMode: IntakeMode = !chatEnabled ? 'form' : defaultMode;
    return {
      chatEnabled,
      defaultMode,
      userMode,
      effectiveMode,
    };
  }

  async setIntakeMode(userId: string, mode: IntakeMode) {
    if (mode === 'chat' && !(await this.chatEnabled(userId))) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'Conversational intake is disabled',
        HttpStatus.BAD_REQUEST,
      );
    }
    const profile = await this.profilesRepo.findOne({ where: { userId } });
    if (!profile) {
      throw new AppException(
        AuthErrorCode.UNAUTHORIZED,
        'Profile not found',
        HttpStatus.NOT_FOUND,
      );
    }
    profile.intakeMode = mode;
    await this.profilesRepo.save(profile);
    return this.getIntakeConfig(userId);
  }

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
    const learnerProfile = await this.getActiveProfile(userId);
    return {
      ...toQuestionnaireDto(row),
      learnerProfile: learnerProfile
        ? this.profiling.toPublicSummary(learnerProfile)
        : null,
    };
  }

  async getActiveProfile(userId: string) {
    return this.profilesSnapshotsRepo.findOne({
      where: [
        { userId, status: LearnerProfileStatus.Provisional },
        { userId, status: LearnerProfileStatus.Verified },
      ],
      order: { version: 'DESC' },
      relations: { skillEstimates: true },
    });
  }

  async getProfile(userId: string) {
    const profile = await this.getActiveProfile(userId);
    if (!profile) {
      throw new AppException(
        AuthErrorCode.PROFILE_NOT_FOUND,
        'No learner profile yet — complete the questionnaire',
        HttpStatus.NOT_FOUND,
      );
    }
    return this.profiling.toPublicSummary(profile);
  }

  async profilePreview(userId: string, rawAnswers: unknown) {
    void userId;
    const schema = this.getSchema();
    const answers = normalizeDraftAnswers(rawAnswers, schema);
    const missing = listMissingFields(answers, schema);
    // Soft preview: need at least track + self stage
    const track = asTrackSelection(answers, 'goal');
    if (!track.primary) {
      throw new AppException(
        AuthErrorCode.PROFILE_PREVIEW_INCOMPLETE,
        'Select a primary track to preview your profile',
        HttpStatus.BAD_REQUEST,
      );
    }
    const derived = this.profiling.derive(answers);
    return {
      preview: this.profiling.toPreview(derived),
      incompleteFields: missing,
      schemaVersion: schema.schemaVersion,
    };
  }

  async upsertDraft(userId: string, rawAnswers: unknown) {
    const schema = this.getSchema();
    const answers = normalizeDraftAnswers(rawAnswers, schema);
    const schemaVersion = schema.schemaVersion;

    return this.dataSource.transaction(async (manager) => {
      const responseRepo = manager.getRepository(QuestionnaireResponse);
      const profileRepo = manager.getRepository(Profile);

      let row = await responseRepo.findOne({ where: { userId } });

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
        if (row.status !== QuestionnaireResponseStatus.Submitted) {
          row.status = QuestionnaireResponseStatus.Draft;
        }
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

  async submit(
    userId: string,
    rawAnswers: unknown,
    opts: { schemaVersion?: number } = {},
  ) {
    const schema = this.getSchema();
    if (
      opts.schemaVersion != null &&
      opts.schemaVersion !== schema.schemaVersion
    ) {
      throw new AppException(
        AuthErrorCode.QUESTIONNAIRE_SCHEMA_STALE,
        `Questionnaire schema changed (client ${opts.schemaVersion}, server ${schema.schemaVersion}). Refresh and retry.`,
        HttpStatus.CONFLICT,
      );
    }

    const answers = assertCompleteAnswers(rawAnswers, schema);
    const schemaVersion = schema.schemaVersion;
    const derived = this.profiling.derive(answers);

    if (!derived.primaryTrackSlug) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'Primary track is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (
      derived.targetStage < derived.provisionalStage &&
      derived.feasibility.state === 'unrealistic'
    ) {
      // Soft: allow but flag; client can show TARGET_BELOW / deadline UI
    }

    const existing = await this.responsesRepo.findOne({ where: { userId } });

    const { saved, goal, learnerProfile } = await this.dataSource.transaction(
      async (manager) => {
        const responseRepo = manager.getRepository(QuestionnaireResponse);
        const profileRepo = manager.getRepository(Profile);

        let row =
          existing ??
          responseRepo.create({
            userId,
            answers: emptyQuestionnaireAnswers(),
            schemaVersion,
            goalId: null,
            submittedAt: null,
            status: QuestionnaireResponseStatus.Draft,
          });

        const goal = await this.upsertGoal(manager, userId, answers, derived);

        row.answers = answers;
        row.status = QuestionnaireResponseStatus.Submitted;
        row.schemaVersion = schemaVersion;
        row.goalId = goal.id;
        row.submittedAt = new Date();
        const saved = await responseRepo.save(row);

        const learnerProfile = await this.persistProfileVersion(
          manager,
          userId,
          saved.id,
          goal.id,
          answers,
          derived,
        );

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
        profile.questionnaireCompletedAt =
          profile.questionnaireCompletedAt ?? now;
        profile.onboardingCompletedAt = profile.onboardingCompletedAt ?? now;
        await profileRepo.save(profile);

        return { saved, goal, learnerProfile };
      },
    );

    const roadmap = await this.roadmapsService.enqueueGenerate(
      goal.id,
      userId,
      learnerProfile.id,
    );

    try {
      await this.referrals?.evaluateInvitee(userId);
    } catch {
      /* referral progress must not block questionnaire */
    }

    return {
      questionnaire: toQuestionnaireDto(saved),
      goal: this.toGoalSummary(goal),
      learnerProfile: this.profiling.toPublicSummary(learnerProfile),
      placement: {
        required: learnerProfile.diagnosticRequired,
        reasonCodes: learnerProfile.diagnosticReasonCodes,
      },
      feasibility: derived.feasibility,
      roadmap,
    };
  }

  async reassess(userId: string) {
    const current = await this.getActiveProfile(userId);
    if (!current) {
      throw new AppException(
        AuthErrorCode.PROFILE_NOT_FOUND,
        'No learner profile to reassess',
        HttpStatus.NOT_FOUND,
      );
    }
    // Mark placement required on a new revision cloning current estimates.
    return this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(LearnerProfileSnapshot)
        .update(
          { userId, status: LearnerProfileStatus.Provisional },
          { status: LearnerProfileStatus.Superseded },
        );
      await manager
        .getRepository(LearnerProfileSnapshot)
        .update(
          { userId, status: LearnerProfileStatus.Verified },
          { status: LearnerProfileStatus.Superseded },
        );

      const nextVersion = current.version + 1;
      const clone = manager.create(LearnerProfileSnapshot, {
        ...current,
        id: undefined as unknown as string,
        version: nextVersion,
        status: LearnerProfileStatus.Provisional,
        diagnosticRequired: true,
        diagnosticReasonCodes: [
          ...new Set([
            ...(current.diagnosticReasonCodes ?? []),
            'REASSESS_REQUESTED',
          ]),
        ],
        createdAt: undefined as unknown as Date,
        skillEstimates: undefined,
      });
      const saved = await manager
        .getRepository(LearnerProfileSnapshot)
        .save(clone);

      for (const est of current.skillEstimates ?? []) {
        await manager.getRepository(LearnerSkillEstimate).save(
          manager.create(LearnerSkillEstimate, {
            profileId: saved.id,
            skillSlug: est.skillSlug,
            selfExposureLevel: est.selfExposureLevel,
            provisionalStage: est.provisionalStage,
            verifiedStage: est.verifiedStage,
            confidence: est.confidence,
            evidenceSource: est.evidenceSource,
            evidenceMeta: est.evidenceMeta ?? {},
          }),
        );
      }

      const full = await manager.getRepository(LearnerProfileSnapshot).findOne({
        where: { id: saved.id },
        relations: { skillEstimates: true },
      });
      return this.profiling.toPublicSummary(full!);
    });
  }

  private async persistProfileVersion(
    manager: EntityManager,
    userId: string,
    questionnaireResponseId: string | null,
    goalId: string,
    answers: QuestionnaireAnswers,
    derived: DerivedLearnerProfile,
  ): Promise<LearnerProfileSnapshot> {
    const repo = manager.getRepository(LearnerProfileSnapshot);
    const latest = await repo.findOne({
      where: { userId },
      order: { version: 'DESC' },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    await repo.update(
      { userId, status: LearnerProfileStatus.Provisional },
      { status: LearnerProfileStatus.Superseded },
    );
    await repo.update(
      { userId, status: LearnerProfileStatus.Verified },
      { status: LearnerProfileStatus.Superseded },
    );

    const snapshot = await repo.save(
      repo.create({
        userId,
        questionnaireResponseId,
        goalId,
        version: nextVersion,
        status: LearnerProfileStatus.Provisional,
        primaryTrackSlug: derived.primaryTrackSlug,
        secondaryTrackSlugs: derived.secondaryTrackSlugs,
        selfReportedStage: derived.selfReportedStage,
        provisionalStage: derived.provisionalStage,
        verifiedStage: null,
        stageScore: derived.stageScore,
        stageConfidence: derived.stageConfidence,
        targetStage: derived.targetStage,
        stageGap: derived.stageGap,
        weeklyDeclaredMinutes: derived.weeklyDeclaredMinutes,
        weeklyEffectiveMinutes: derived.weeklyEffectiveMinutes,
        preferredSessionMinutes: derived.preferredSessionMinutes,
        preferredDays: derived.preferredDays,
        preferredTimeWindows: derived.preferredTimeWindows,
        timezone: derived.timezone,
        paceClass: derived.paceClass,
        motivationTags: derived.motivationTags,
        learningStyleWeights: derived.learningStyleWeights,
        blockerTags: derived.blockerTags,
        diagnosticRequired: derived.diagnosticRequired,
        diagnosticReasonCodes: derived.diagnosticReasonCodes,
        profilingModelVersion: derived.profilingModelVersion,
        normalizedInput: {
          ...derived.normalizedInput,
          rawAnswers: answers,
        },
      }),
    );

    const estimateRepo = manager.getRepository(LearnerSkillEstimate);
    for (const est of derived.skillEstimates) {
      await estimateRepo.save(
        estimateRepo.create({
          profileId: snapshot.id,
          skillSlug: est.skillSlug,
          selfExposureLevel: est.selfExposureLevel,
          provisionalStage: est.provisionalStage,
          verifiedStage: null,
          confidence: est.confidence,
          evidenceSource: est.evidenceSource,
          evidenceMeta: {},
        }),
      );
    }

    return (
      (await repo.findOne({
        where: { id: snapshot.id },
        relations: { skillEstimates: true },
      })) ?? snapshot
    );
  }

  private async upsertGoal(
    manager: EntityManager,
    userId: string,
    answers: QuestionnaireAnswers,
    derived: DerivedLearnerProfile,
  ): Promise<Goal> {
    const goalsRepo = manager.getRepository(Goal);
    const existing = await goalsRepo.findOne({
      where: { userId, status: GoalStatus.Active },
      order: { updatedAt: 'DESC' },
    });

    const track = asTrackSelection(answers, 'goal');
    const targetRoles = [
      derived.primaryTrackSlug || track.primary,
      ...derived.secondaryTrackSlugs,
    ].filter(Boolean);

    if (!targetRoles.length) {
      throw new AppException(
        AuthErrorCode.VALIDATION_ERROR,
        'goal is required',
        HttpStatus.BAD_REQUEST,
      );
    }

    const schedule = asSchedule(answers, 'schedule');
    const skillSlugs = asSkillEvidence(answers, 'skills').map(
      (s) => s.skillSlug,
    );

    const payload: Partial<Goal> = {
      userId,
      targetRoles,
      motivation: withOther(
        asStringArray(answers, 'motivation'),
        asOptionalString(answers, 'motivationOther'),
      ),
      currentProfession:
        asString(answers, 'currentContext') ||
        asString(answers, 'currentJob') ||
        null,
      currentProfessionOther:
        asOptionalString(answers, 'currentContextOther') ??
        asOptionalString(answers, 'currentJobOther') ??
        null,
      skills: withOther(skillSlugs),
      weeklyHours: asString(answers, 'studyHours') || null,
      availability: {
        days: schedule.days,
        times: schedule.times,
      },
      targetDeadline: asString(answers, 'deadline') || null,
      learningStyles: withOther(asStringArray(answers, 'learningStyle')),
      confidence: asString(answers, 'confidence') || null,
      quitReasons: withOther(
        asStringArray(answers, 'barriers').length
          ? asStringArray(answers, 'barriers')
          : asStringArray(answers, 'quitReasons'),
        asOptionalString(answers, 'barriersOther') ??
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
