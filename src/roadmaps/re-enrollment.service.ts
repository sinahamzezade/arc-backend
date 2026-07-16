import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import {
  HttpStatus,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { DataSource, In, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { UnitsCatalogService } from '../content-pool/units-catalog.service';
import { OutboxService } from '../gamification/outbox.service';
import { OUTBOX_ROADMAP_REENROLLMENT_STARTED } from '../gamification/reward-constants';
import { Goal, GoalStatus } from '../goals/entities/goal.entity';
import {
  LearnerProfileSnapshot,
  LearnerProfileStatus,
} from '../questionnaire/entities/learner-profile-snapshot.entity';
import { SkillGraphService } from '../skill-graph/skill-graph.service';
import {
  PostCompletionStatus,
  Roadmap,
} from './entities/roadmap.entity';
import {
  ReEnrollmentJob,
  ReEnrollmentJobStatus,
  ReEnrollmentTrigger,
} from './entities/re-enrollment-job.entity';
import { RoadmapCacheService } from './roadmap-cache.service';
import { RoadmapGeneratorService } from './roadmap-generator.service';
import { RoadmapPersistenceService } from './roadmap-persistence.service';
import { RoadmapPipelineService } from './roadmap-pipeline.service';
import { RoadmapSnapshotService } from './roadmap-snapshot.service';

export const RE_ENROLLMENT_QUEUE = 'roadmap_re_enrollment';

export type ReEnrollmentJobData = {
  dbJobId: string;
};

@Injectable()
export class ReEnrollmentService {
  private readonly logger = new Logger(ReEnrollmentService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ReEnrollmentJob)
    private readonly jobsRepo: Repository<ReEnrollmentJob>,
    @InjectRepository(Roadmap)
    private readonly roadmapsRepo: Repository<Roadmap>,
    @InjectRepository(Goal)
    private readonly goalsRepo: Repository<Goal>,
    @InjectRepository(LearnerProfileSnapshot)
    private readonly profilesRepo: Repository<LearnerProfileSnapshot>,
    private readonly generator: RoadmapGeneratorService,
    private readonly pipeline: RoadmapPipelineService,
    private readonly snapshot: RoadmapSnapshotService,
    private readonly persistence: RoadmapPersistenceService,
    private readonly skillGraph: SkillGraphService,
    private readonly unitsCatalog: UnitsCatalogService,
    private readonly outbox: OutboxService,
    private readonly roadmapCache: RoadmapCacheService,
    @Optional()
    @InjectQueue(RE_ENROLLMENT_QUEUE)
    private readonly queue: Queue<ReEnrollmentJobData> | null,
  ) {}

  async enqueue(dbJobId: string): Promise<void> {
    if (this.queue) {
      await this.queue.add(
        'reenroll',
        { dbJobId },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 50,
          jobId: dbJobId,
        },
      );
      return;
    }
    this.logger.debug(`In-process reenrollment job=${dbJobId}`);
    setImmediate(() => {
      void this.processDbJob(dbJobId).catch(() => undefined);
    });
  }

  async chooseNext(
    userId: string,
    roadmapId: string,
    choice: ReEnrollmentTrigger,
  ): Promise<{ redirect?: string; jobId?: string }> {
    const roadmap = await this.roadmapsRepo.findOne({
      where: { id: roadmapId, userId },
    });
    if (!roadmap?.finishedAt) {
      throw new AppException(
        AuthErrorCode.ROADMAP_NOT_COMPLETE,
        'Roadmap is not complete',
        HttpStatus.BAD_REQUEST,
      );
    }

    const existing = await this.jobsRepo.findOne({
      where: {
        userId,
        previousRoadmapId: roadmapId,
        status: In([
          ReEnrollmentJobStatus.Queued,
          ReEnrollmentJobStatus.Processing,
          ReEnrollmentJobStatus.Ready,
        ]),
      },
      order: { createdAt: 'DESC' },
    });
    if (existing) {
      throw new AppException(
        AuthErrorCode.ROADMAP_ALREADY_REENROLLED,
        'A re-enrollment job already exists for this roadmap',
        HttpStatus.CONFLICT,
      );
    }

    if (choice === ReEnrollmentTrigger.NewGoal) {
      roadmap.postCompletionStatus = PostCompletionStatus.Reenrolled;
      await this.roadmapsRepo.save(roadmap);
      await this.emitStarted(userId, roadmapId, choice, null);
      return { redirect: '/questionnaire?mode=fast_track' };
    }

    if (choice === ReEnrollmentTrigger.SameGoalAdvanced) {
      const advancedSlug = `${roadmap.primaryRoleSlug}-advanced`;
      const recipe = await this.skillGraph.findRecipeByRole(advancedSlug);
      if (!recipe) {
        throw new AppException(
          AuthErrorCode.ADVANCED_RECIPE_NOT_FOUND,
          `No advanced recipe for ${roadmap.primaryRoleSlug}`,
          HttpStatus.NOT_FOUND,
        );
      }
    }

    if (choice === ReEnrollmentTrigger.TopUp) {
      const gaps = await this.collectTopUpSkillIds(roadmap);
      if (!gaps.length) {
        throw new AppException(
          AuthErrorCode.TOPUP_GAP_EMPTY,
          'All skills are already mastered — nothing to top up',
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const job = await this.jobsRepo.save(
      this.jobsRepo.create({
        userId,
        previousRoadmapId: roadmapId,
        trigger: choice,
        status: ReEnrollmentJobStatus.Queued,
        attempts: 0,
      }),
    );

    roadmap.postCompletionStatus =
      choice === ReEnrollmentTrigger.TopUp
        ? PostCompletionStatus.TopUp
        : PostCompletionStatus.Advanced;
    await this.roadmapsRepo.save(roadmap);

    await this.emitStarted(userId, roadmapId, choice, job.id);
    await this.enqueue(job.id);
    return { jobId: job.id };
  }

  async getJob(userId: string, jobId: string) {
    const job = await this.jobsRepo.findOne({ where: { id: jobId, userId } });
    if (!job) {
      throw new AppException(
        AuthErrorCode.ROADMAP_NOT_FOUND,
        'Re-enrollment job not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      id: job.id,
      status: job.status,
      trigger: job.trigger,
      previousRoadmapId: job.previousRoadmapId,
      newRoadmapId: job.newRoadmapId,
      errorCode: job.errorCode,
      errorMessage: job.errorMessage,
    };
  }

  async processDbJob(jobId: string): Promise<void> {
    const job = await this.jobsRepo.findOne({ where: { id: jobId } });
    if (!job) return;
    if (
      job.status === ReEnrollmentJobStatus.Ready ||
      job.status === ReEnrollmentJobStatus.Processing
    ) {
      return;
    }

    job.status = ReEnrollmentJobStatus.Processing;
    job.attempts += 1;
    await this.jobsRepo.save(job);

    try {
      const previous = await this.roadmapsRepo.findOne({
        where: { id: job.previousRoadmapId },
      });
      if (!previous) {
        throw new AppException(
          AuthErrorCode.ROADMAP_NOT_FOUND,
          'Previous roadmap missing',
          HttpStatus.NOT_FOUND,
        );
      }

      const goal = await this.goalsRepo.findOne({
        where: { id: previous.goalId },
      });
      if (!goal) {
        throw new AppException(
          AuthErrorCode.GOAL_NOT_FOUND,
          'Goal not found',
          HttpStatus.NOT_FOUND,
        );
      }

      const profileSnapshot = await this.profilesRepo.findOne({
        where: [
          { userId: job.userId, status: LearnerProfileStatus.Provisional },
          { userId: job.userId, status: LearnerProfileStatus.Verified },
        ],
        order: { version: 'DESC' },
        relations: { skillEstimates: true },
      });
      const profile = this.snapshot.toProfile(goal, [], profileSnapshot);
      const revision = this.snapshot.goalRevision(goal);
      const seed = this.snapshot.seedFor(
        job.userId,
        `${revision}:reenroll:${job.trigger}`,
      );

      let newRoadmap: Roadmap;
      if (job.trigger === ReEnrollmentTrigger.SameGoalAdvanced) {
        const recipeSlug = `${previous.primaryRoleSlug}-advanced`;
        const planResult = await this.pipeline.plan({
          goal,
          profile,
          seed,
          recipeRoleSlug: recipeSlug,
        });
        newRoadmap = await this.persistence.persistPlan(goal, planResult.plan, {
          schemaVersion: 2,
          mode: 'reenrollment_advanced',
          previousRoadmapId: previous.id,
        });
      } else if (job.trigger === ReEnrollmentTrigger.TopUp) {
        const gapIds = await this.collectTopUpSkillIds(previous);
        if (!gapIds.length) {
          throw new AppException(
            AuthErrorCode.TOPUP_GAP_EMPTY,
            'All skills are already mastered',
            HttpStatus.BAD_REQUEST,
          );
        }
        const planResult = await this.pipeline.plan({
          goal,
          profile,
          seed,
          explicitRequiredSkillIds: gapIds,
          narrationTitleOverride: 'Skills Top-Up',
        });
        newRoadmap = await this.persistence.persistPlan(goal, planResult.plan, {
          schemaVersion: 2,
          mode: 'reenrollment_top_up',
          previousRoadmapId: previous.id,
        });
      } else {
        newRoadmap = await this.generator.assemble(
          goal.id,
          job.userId,
          profileSnapshot?.id,
        );
      }

      await this.persistence.swapActiveRoadmap(previous.id, newRoadmap.id);

      previous.postCompletionStatus = PostCompletionStatus.Reenrolled;
      await this.roadmapsRepo.save(previous);

      if (goal.status !== GoalStatus.Active) {
        goal.status = GoalStatus.Active;
        await this.goalsRepo.save(goal);
      }

      job.status = ReEnrollmentJobStatus.Ready;
      job.newRoadmapId = newRoadmap.id;
      job.errorCode = null;
      job.errorMessage = null;
      await this.jobsRepo.save(job);
      await this.roadmapCache.invalidateUser(job.userId);
      this.logger.log(
        `Re-enrollment ready job=${jobId} newRoadmap=${newRoadmap.id}`,
      );
    } catch (err) {
      const code =
        err instanceof AppException
          ? err.code
          : AuthErrorCode.REENROLLMENT_JOB_FAILED;
      const message =
        err instanceof Error ? err.message : 'Re-enrollment failed';
      job.status = ReEnrollmentJobStatus.Failed;
      job.errorCode = code;
      job.errorMessage = message;
      await this.jobsRepo.save(job);
      this.logger.warn(`Re-enrollment failed job=${jobId}: ${message}`);
      throw err;
    }
  }

  /** Map completion skillSummary gaps → catalog skill ids. */
  private async collectTopUpSkillIds(roadmap: Roadmap): Promise<string[]> {
    const gaps =
      roadmap.completionSummary?.skillSummary?.filter(
        (s) => s.status !== 'mastered',
      ) ?? [];
    if (!gaps.length) return [];

    const skills = await this.unitsCatalog.listActiveSkills();
    const byId = new Map(skills.map((s) => [s.id.toLowerCase(), s.id]));
    const byCoarse = new Map<string, string>();
    for (const s of skills) {
      const coarse = (
        s.id.includes(':') ? s.id.split(':')[0] : s.id
      ).toLowerCase();
      if (!byCoarse.has(coarse)) byCoarse.set(coarse, s.id);
    }

    const ids: string[] = [];
    for (const g of gaps) {
      const slug = g.skillSlug.toLowerCase();
      const id =
        byId.get(slug) ??
        byCoarse.get(slug.includes(':') ? slug.split(':')[0] : slug);
      if (id) ids.push(id);
    }
    return [...new Set(ids)];
  }

  private async emitStarted(
    userId: string,
    previousRoadmapId: string,
    trigger: ReEnrollmentTrigger,
    jobId: string | null,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await this.outbox.enqueue(manager, {
        type: OUTBOX_ROADMAP_REENROLLMENT_STARTED,
        aggregateId: previousRoadmapId,
        payload: {
          event: OUTBOX_ROADMAP_REENROLLMENT_STARTED,
          userId,
          previousRoadmapId,
          trigger,
          jobId,
        },
      });
    });
  }
}

@Processor(RE_ENROLLMENT_QUEUE)
export class ReEnrollmentBullProcessor extends WorkerHost {
  constructor(private readonly reenrollment: ReEnrollmentService) {
    super();
  }

  async process(job: Job<ReEnrollmentJobData>): Promise<void> {
    await this.reenrollment.processDbJob(job.data.dbJobId);
  }
}
