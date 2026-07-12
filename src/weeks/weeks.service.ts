import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { GamificationService } from '../gamification/gamification.service';
import {
  OUTBOX_SCHEDULE_REPLANNED,
  SEAL_REWARD_RULE_KEY,
} from '../gamification/reward-constants';
import { OutboxService } from '../gamification/outbox.service';
import { GoalsService } from '../goals/goals.service';
import {
  NotificationChannel,
  NotificationType,
} from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { Profile } from '../profiles/entities/profile.entity';
import { ProfilesService } from '../profiles/profiles.service';
import { RoadmapsService } from '../roadmaps/roadmaps.service';
import { ReplanWeekDto } from './dto/replan-week.dto';
import {
  MoveWeeklyTaskDto,
  SkipWeeklyTaskDto,
  UpdateWeeklyTaskDto,
} from './dto/update-weekly-task.dto';
import {
  WeeklyPlanEvent,
  WeeklyPlanEventType,
} from './entities/weekly-plan-event.entity';
import {
  WeeklyPlan,
  WeeklyPlanStatus,
} from './entities/weekly-plan.entity';
import {
  WeeklyTask,
  WeeklyTaskStatus,
} from './entities/weekly-task.entity';
import { replanMaxPerWeek, streakResetOnMiss } from './weeks.constants';
import { meetsSealCriteria, num, round1 } from './weeks.math';
import { WeeksPlannerService } from './weeks.planner.service';
import {
  buildingWeekDto,
  toWeekCurrentDto,
  type WeekCurrentDto,
} from './weeks.serializer';
import {
  dayIndexNow,
  eligibleFromDayIndex,
  learningWeekWindow,
  resolveTz,
  weekStartMonday,
} from './weeks.time';

@Injectable()
export class WeeksService {
  constructor(
    @InjectRepository(WeeklyPlan)
    private readonly plansRepo: Repository<WeeklyPlan>,
    @InjectRepository(WeeklyTask)
    private readonly tasksRepo: Repository<WeeklyTask>,
    @InjectRepository(WeeklyPlanEvent)
    private readonly eventsRepo: Repository<WeeklyPlanEvent>,
    private readonly planner: WeeksPlannerService,
    private readonly profiles: ProfilesService,
    private readonly goals: GoalsService,
    private readonly roadmaps: RoadmapsService,
    private readonly notifications: NotificationsService,
    private readonly gamification: GamificationService,
    private readonly outbox: OutboxService,
    private readonly dataSource: DataSource,
  ) {}

  async getCurrent(userId: string): Promise<WeekCurrentDto> {
    const profile = await this.requireProfile(userId);
    const tz = resolveTz(profile.timezone);
    const now = new Date();
    const weekStart = weekStartMonday(now, tz);
    const todayIndex = dayIndexNow(now, tz);
    const joinedAt =
      profile.onboardingCompletedAt ??
      profile.questionnaireCompletedAt ??
      profile.createdAt;
    const eligibleFrom = eligibleFromDayIndex({
      weekStart,
      timeZone: tz,
      joinedAt,
    });

    await this.closePreviousWeekIfNeeded(userId, weekStart);

    let plan = await this.plansRepo.findOne({
      where: { userId, weekStart },
    });

    if (!plan) {
      try {
        plan = await this.ensurePlan(
          userId,
          weekStart,
          profile.weeklyStreak,
          tz,
          eligibleFrom,
        );
      } catch (err) {
        if (
          err instanceof AppException &&
          err.code === AuthErrorCode.ROADMAP_NOT_READY
        ) {
          return buildingWeekDto({
            weekStart,
            weeklyStreak: profile.weeklyStreak,
          });
        }
        throw err;
      }
    }

    let tasks = await this.tasksRepo.find({
      where: { weeklyPlanId: plan.id },
      order: { dayIndex: 'ASC', sortOrder: 'ASC' },
    });

    // Heal legacy plans that scheduled pre-join days as missable
    tasks = await this.scrubPreJoinTasks(plan, tasks, eligibleFrom, todayIndex);

    return toWeekCurrentDto({
      plan,
      tasks,
      weeklyStreak: profile.weeklyStreak,
      dayIndexNow: todayIndex,
      eligibleFromDayIndex: eligibleFrom,
    });
  }

  async getByWeekStart(
    userId: string,
    weekStart: string,
  ): Promise<WeekCurrentDto> {
    const profile = await this.requireProfile(userId);
    const tz = resolveTz(profile.timezone);
    const plan = await this.plansRepo.findOne({
      where: { userId, weekStart },
    });
    if (!plan) {
      throw new AppException(
        AuthErrorCode.WEEK_PLAN_NOT_FOUND,
        'Week plan not found',
        HttpStatus.NOT_FOUND,
      );
    }
    const tasks = await this.tasksRepo.find({
      where: { weeklyPlanId: plan.id },
      order: { dayIndex: 'ASC', sortOrder: 'ASC' },
    });
    const todayIndex =
      weekStart === weekStartMonday(new Date(), tz)
        ? dayIndexNow(new Date(), tz)
        : 6;
    const joinedAt =
      profile.onboardingCompletedAt ??
      profile.questionnaireCompletedAt ??
      profile.createdAt;
    const eligibleFrom = eligibleFromDayIndex({
      weekStart,
      timeZone: tz,
      joinedAt,
    });
    return toWeekCurrentDto({
      plan,
      tasks,
      weeklyStreak: profile.weeklyStreak,
      dayIndexNow: todayIndex,
      eligibleFromDayIndex: eligibleFrom,
    });
  }

  async replan(userId: string, dto: ReplanWeekDto): Promise<WeekCurrentDto> {
    const profile = await this.requireProfile(userId);
    const tz = resolveTz(profile.timezone);
    const now = new Date();
    const weekStart = weekStartMonday(now, tz);
    const todayIndex = dayIndexNow(now, tz);

    const plan = await this.plansRepo.findOne({
      where: { userId, weekStart },
    });
    if (!plan) {
      throw new AppException(
        AuthErrorCode.WEEK_PLAN_NOT_FOUND,
        'No weekly plan for current week',
        HttpStatus.NOT_FOUND,
      );
    }
    if (plan.status === WeeklyPlanStatus.Sealed) {
      throw new AppException(
        AuthErrorCode.WEEK_PLAN_ALREADY_SEALED,
        'Week already sealed',
        HttpStatus.CONFLICT,
      );
    }
    if (plan.replanCount >= replanMaxPerWeek()) {
      throw new AppException(
        AuthErrorCode.WEEK_REPLAN_NOT_ALLOWED,
        'Replan limit reached for this week',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const tasks = await this.tasksRepo.find({
      where: { weeklyPlanId: plan.id },
    });
    const goal = await this.goals.findActiveByUserId(userId);
    const roadmap = await this.roadmaps.findReadyWithLessons(userId);

    const mode = this.mapReplanMode(dto.mode);
    const result = await this.planner.replan({
      plan,
      tasks,
      mode,
      reduceHours: Boolean(dto.reduceHours) || mode === 'reduce',
      goal,
      roadmap,
      dayIndexNow: todayIndex,
    });

    result.plan.planVersion += 1;
    result.plan.scheduleVersion += 1;
    await this.plansRepo.save(result.plan);

    await this.recordEvent({
      userId,
      planId: result.plan.id,
      type: WeeklyPlanEventType.Replanned,
      payload: { mode, reason: dto.reason ?? dto.mode ?? 'user_request' },
    });

    await this.dataSource.transaction(async (manager) => {
      await this.outbox.enqueue(manager, {
        type: OUTBOX_SCHEDULE_REPLANNED,
        aggregateId: result.plan.id,
        payload: {
          userId,
          weeklyPlanId: result.plan.id,
          weekStart,
          scheduleVersion: result.plan.scheduleVersion,
          planVersion: result.plan.planVersion,
          mode,
        },
      });
    });

    await this.notifications.create({
      userId,
      type: NotificationType.ReplanSuggestion,
      title: 'Week replanned',
      body: 'Arlo reshuffled your remaining sessions. Open Plan to review.',
      actionUrl: '/week',
      channels: [NotificationChannel.InApp],
    });

    void this.gamification.processPendingOutbox().catch(() => undefined);

    const freshProfile = await this.profiles.findByUserId(userId);
    const joinedAt =
      freshProfile?.onboardingCompletedAt ??
      freshProfile?.questionnaireCompletedAt ??
      freshProfile?.createdAt ??
      profile.onboardingCompletedAt ??
      profile.questionnaireCompletedAt ??
      profile.createdAt;
    const eligibleFrom = eligibleFromDayIndex({
      weekStart,
      timeZone: tz,
      joinedAt,
    });
    return toWeekCurrentDto({
      plan: result.plan,
      tasks: result.tasks,
      weeklyStreak: freshProfile?.weeklyStreak ?? profile.weeklyStreak,
      dayIndexNow: todayIndex,
      eligibleFromDayIndex: eligibleFrom,
    });
  }

  async updateTask(
    userId: string,
    taskId: string,
    dto: UpdateWeeklyTaskDto,
  ): Promise<WeekCurrentDto> {
    if ((dto as { status?: string }).status === 'done') {
      throw new AppException(
        AuthErrorCode.WEEK_CLIENT_DONE_FORBIDDEN,
        'Client cannot mark task done — complete the lesson instead',
        HttpStatus.FORBIDDEN,
      );
    }
    if (dto.dayIndex !== undefined) {
      return this.moveTask(userId, taskId, { dayIndex: dto.dayIndex });
    }
    if (dto.status === 'skipped') {
      return this.skipTask(userId, taskId, {});
    }
    if (dto.status) {
      const { plan, task } = await this.requireCurrentTask(userId, taskId);
      task.status = dto.status as WeeklyTaskStatus;
      await this.tasksRepo.save(task);
      void plan;
      return this.getCurrent(userId);
    }
    return this.getCurrent(userId);
  }

  async moveTask(
    userId: string,
    taskId: string,
    dto: MoveWeeklyTaskDto,
  ): Promise<WeekCurrentDto> {
    const { plan, task } = await this.requireCurrentTask(userId, taskId);
    if (task.status === WeeklyTaskStatus.Done) {
      throw new AppException(
        AuthErrorCode.WEEK_TASK_ALREADY_COMPLETED,
        'Completed tasks cannot move',
        HttpStatus.CONFLICT,
      );
    }
    const from = task.dayIndex;
    task.dayIndex = dto.dayIndex;
    task.status = WeeklyTaskStatus.Moved;
    await this.tasksRepo.save(task);
    await this.recordEvent({
      userId,
      planId: plan.id,
      type: WeeklyPlanEventType.TaskMoved,
      taskId: task.id,
      payload: { from, to: dto.dayIndex },
    });
    return this.getCurrent(userId);
  }

  async skipTask(
    userId: string,
    taskId: string,
    dto: SkipWeeklyTaskDto,
  ): Promise<WeekCurrentDto> {
    const { plan, task } = await this.requireCurrentTask(userId, taskId);
    if (task.status === WeeklyTaskStatus.Done) {
      throw new AppException(
        AuthErrorCode.WEEK_TASK_ALREADY_COMPLETED,
        'Completed tasks cannot be skipped',
        HttpStatus.CONFLICT,
      );
    }
    task.status = WeeklyTaskStatus.Skipped;
    await this.tasksRepo.save(task);
    // Shrink planned sessions so seal remains reachable
    plan.sessionsPlanned = Math.max(
      plan.sessionsDone,
      plan.sessionsPlanned - 1,
    );
    await this.plansRepo.save(plan);
    await this.recordEvent({
      userId,
      planId: plan.id,
      type: WeeklyPlanEventType.TaskSkipped,
      taskId: task.id,
      payload: { reason: dto.reason ?? 'user_skip' },
    });
    await this.trySeal(userId, plan);
    return this.getCurrent(userId);
  }

  async markLessonDoneInTx(
    manager: EntityManager,
    userId: string,
    lessonId: string,
    minutes: number,
    completionSourceId?: string,
  ): Promise<{ weeklyTaskId: string | null; weeklyPlanId: string | null }> {
    const profile = await manager.getRepository(Profile).findOne({
      where: { userId },
    });
    if (!profile) return { weeklyTaskId: null, weeklyPlanId: null };

    const tz = resolveTz(profile.timezone);
    const now = new Date();
    const weekStart = weekStartMonday(now, tz);

    const plan = await manager.getRepository(WeeklyPlan).findOne({
      where: { userId, weekStart },
    });
    if (!plan || plan.status === WeeklyPlanStatus.Sealed) {
      return { weeklyTaskId: null, weeklyPlanId: plan?.id ?? null };
    }

    const tasks = await manager.getRepository(WeeklyTask).find({
      where: { weeklyPlanId: plan.id },
    });
    const linked = tasks.find(
      (t) =>
        t.lessonId === lessonId && t.status !== WeeklyTaskStatus.Done,
    );
    if (!linked) {
      return { weeklyTaskId: null, weeklyPlanId: plan.id };
    }

    // Idempotent: same completion source cannot double-count
    if (
      completionSourceId &&
      linked.completionSourceId === completionSourceId
    ) {
      return { weeklyTaskId: linked.id, weeklyPlanId: plan.id };
    }

    linked.status = WeeklyTaskStatus.Done;
    linked.completedAt = now;
    linked.verifiedMinutes = minutes || linked.minutes;
    linked.completionSourceType = 'lesson';
    linked.completionSourceId = completionSourceId ?? null;
    await manager.getRepository(WeeklyTask).save(linked);
    plan.sessionsDone += 1;
    plan.hoursDone = String(
      round1(num(plan.hoursDone) + (minutes || linked.minutes) / 60),
    );
    plan.verifiedMinutesDone += minutes || linked.minutes;
    await manager.getRepository(WeeklyPlan).save(plan);

    await manager.getRepository(WeeklyPlanEvent).save(
      manager.getRepository(WeeklyPlanEvent).create({
        userId,
        weeklyPlanId: plan.id,
        type: WeeklyPlanEventType.TaskCompleted,
        taskId: linked.id,
        payload: {
          lessonId,
          minutes: minutes || linked.minutes,
          completionSourceId: completionSourceId ?? null,
        },
      }),
    );

    return { weeklyTaskId: linked.id, weeklyPlanId: plan.id };
  }

  async onLessonCompleted(
    userId: string,
    lessonId: string,
    minutes: number,
    completionSourceId?: string,
  ): Promise<WeekCurrentDto | null> {
    const profile = await this.profiles.findByUserId(userId);
    if (!profile) return null;

    const tz = resolveTz(profile.timezone);
    const now = new Date();
    const weekStart = weekStartMonday(now, tz);

    let plan = await this.plansRepo.findOne({
      where: { userId, weekStart },
    });
    if (!plan) {
      try {
        const eligibleFrom = eligibleFromDayIndex({
          weekStart,
          timeZone: tz,
          joinedAt:
            profile.onboardingCompletedAt ??
            profile.questionnaireCompletedAt ??
            profile.createdAt,
        });
        plan = await this.ensurePlan(
          userId,
          weekStart,
          profile.weeklyStreak,
          tz,
          eligibleFrom,
        );
      } catch {
        return null;
      }
    }
    if (plan.status === WeeklyPlanStatus.Sealed) {
      return this.getCurrent(userId);
    }

    const tasks = await this.tasksRepo.find({
      where: { weeklyPlanId: plan.id },
    });
    const linked = tasks.find(
      (t) =>
        t.lessonId === lessonId && t.status !== WeeklyTaskStatus.Done,
    );

    if (linked) {
      if (
        completionSourceId &&
        linked.completionSourceId === completionSourceId
      ) {
        await this.trySeal(userId, plan);
        return this.getCurrent(userId);
      }
      linked.status = WeeklyTaskStatus.Done;
      linked.completedAt = now;
      linked.verifiedMinutes = minutes || linked.minutes;
      linked.completionSourceType = 'lesson';
      linked.completionSourceId = completionSourceId ?? null;
      await this.tasksRepo.save(linked);
      plan.sessionsDone += 1;
      plan.hoursDone = String(
        round1(num(plan.hoursDone) + (minutes || linked.minutes) / 60),
      );
      plan.verifiedMinutesDone += minutes || linked.minutes;
      await this.plansRepo.save(plan);
      await this.recordEvent({
        userId,
        planId: plan.id,
        type: WeeklyPlanEventType.TaskCompleted,
        taskId: linked.id,
        payload: { lessonId, minutes },
      });
    }

    await this.trySeal(userId, plan);
    return this.getCurrent(userId);
  }

  private mapReplanMode(
    mode?: string,
  ): 'catch_up' | 'reduce' | 'rebuild' {
    if (!mode) return 'catch_up';
    if (mode === 'reduce' || mode === 'reduce_workload') return 'reduce';
    if (mode === 'rebuild' || mode === 'increase_pace') return 'rebuild';
    return 'catch_up';
  }

  private async requireCurrentTask(userId: string, taskId: string) {
    const profile = await this.requireProfile(userId);
    const tz = resolveTz(profile.timezone);
    const weekStart = weekStartMonday(new Date(), tz);
    const plan = await this.plansRepo.findOne({
      where: { userId, weekStart },
    });
    if (!plan) {
      throw new AppException(
        AuthErrorCode.WEEK_PLAN_NOT_FOUND,
        'No weekly plan for current week',
        HttpStatus.NOT_FOUND,
      );
    }
    if (plan.status === WeeklyPlanStatus.Sealed) {
      throw new AppException(
        AuthErrorCode.WEEK_PLAN_ALREADY_SEALED,
        'Week already sealed',
        HttpStatus.CONFLICT,
      );
    }
    const task = await this.tasksRepo.findOne({
      where: { id: taskId, weeklyPlanId: plan.id },
    });
    if (!task) {
      throw new AppException(
        AuthErrorCode.WEEK_TASK_NOT_FOUND,
        'Task not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return { plan, task, profile, tz };
  }

  private async ensurePlan(
    userId: string,
    weekStart: string,
    weeklyStreak: number,
    tz: string,
    eligibleFrom = 0,
  ): Promise<WeeklyPlan> {
    const roadmap = await this.roadmaps.findReadyWithLessons(userId);
    if (!roadmap) {
      throw new AppException(
        AuthErrorCode.ROADMAP_NOT_READY,
        'Roadmap not ready — cannot build weekly plan',
        HttpStatus.CONFLICT,
      );
    }
    const goal = await this.goals.findActiveByUserId(userId);
    const { windowStartAt, windowEndAt } = learningWeekWindow(weekStart, tz);
    const plan = await this.planner.createPlan({
      userId,
      weekStart,
      weekIndex: weeklyStreak + 1,
      goal,
      roadmap,
      timezoneSnapshot: tz,
      windowStartAt,
      windowEndAt,
      eligibleFromDayIndex: eligibleFrom,
    });
    await this.recordEvent({
      userId,
      planId: plan.id,
      type: WeeklyPlanEventType.Generated,
      payload: {
        weekStart,
        scheduleVersion: plan.scheduleVersion,
        eligibleFromDayIndex: eligibleFrom,
      },
    });
    return plan;
  }

  /**
   * Legacy plans may have tasks on days before the user joined.
   * Skip unfinished ones and pack remaining onto eligible days.
   */
  private async scrubPreJoinTasks(
    plan: WeeklyPlan,
    tasks: WeeklyTask[],
    eligibleFrom: number,
    dayIndexNow: number,
  ): Promise<WeeklyTask[]> {
    if (eligibleFrom <= 0 || plan.status === WeeklyPlanStatus.Sealed) {
      return tasks;
    }

    const preJoin = tasks.filter(
      (t) =>
        t.dayIndex < eligibleFrom &&
        t.status !== WeeklyTaskStatus.Done &&
        t.status !== WeeklyTaskStatus.Skipped,
    );
    if (!preJoin.length) return tasks;

    const remainingDays = Array.from(
      { length: 7 - Math.max(eligibleFrom, dayIndexNow) },
      (_, i) => Math.max(eligibleFrom, dayIndexNow) + i,
    );
    const slots =
      remainingDays.length > 0
        ? remainingDays
        : [Math.min(6, Math.max(eligibleFrom, dayIndexNow))];

    preJoin.forEach((task, i) => {
      task.dayIndex = slots[i % slots.length] ?? 6;
      task.status = WeeklyTaskStatus.Upcoming;
    });
    await this.tasksRepo.save(preJoin);

    // Also clear false Missed on pre-join if already persisted
    const falseMissed = tasks.filter(
      (t) =>
        t.dayIndex < eligibleFrom && t.status === WeeklyTaskStatus.Missed,
    );
    for (const t of falseMissed) {
      t.status = WeeklyTaskStatus.Skipped;
    }
    if (falseMissed.length) await this.tasksRepo.save(falseMissed);

    return this.tasksRepo.find({
      where: { weeklyPlanId: plan.id },
      order: { dayIndex: 'ASC', sortOrder: 'ASC' },
    });
  }

  private async trySeal(userId: string, plan: WeeklyPlan): Promise<void> {
    if (plan.status === WeeklyPlanStatus.Sealed) return;

    const ok = meetsSealCriteria({
      sessionsDone: plan.sessionsDone,
      sessionsPlanned: plan.sessionsPlanned,
      hoursDone: num(plan.hoursDone),
      hoursPlanned: num(plan.hoursPlanned),
    });
    if (!ok) return;

    let didSeal = false;
    let sealedPlan = plan;

    await this.dataSource.transaction(async (manager) => {
      const locked = await manager.findOne(WeeklyPlan, {
        where: { id: plan.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked || locked.status === WeeklyPlanStatus.Sealed) return;

      const stillOk = meetsSealCriteria({
        sessionsDone: locked.sessionsDone,
        sessionsPlanned: locked.sessionsPlanned,
        hoursDone: num(locked.hoursDone),
        hoursPlanned: num(locked.hoursPlanned),
      });
      if (!stillOk) return;

      locked.status = WeeklyPlanStatus.Sealed;
      locked.sealedAt = new Date();
      await manager.save(locked);

      await this.gamification.sealWeek(manager, {
        userId,
        planId: locked.id,
        weekStart: locked.weekStart,
        xp: locked.lockRewardXp,
        gems: locked.lockRewardGems,
        weekIndex: locked.weekIndex,
      });

      await manager.getRepository(WeeklyPlanEvent).save(
        manager.getRepository(WeeklyPlanEvent).create({
          userId,
          weeklyPlanId: locked.id,
          type: WeeklyPlanEventType.Sealed,
          taskId: null,
          payload: {
            xp: locked.lockRewardXp,
            gems: locked.lockRewardGems,
            sealRewardRuleKey: SEAL_REWARD_RULE_KEY,
          },
        }),
      );

      didSeal = true;
      sealedPlan = locked;
      Object.assign(plan, locked);
    });

    if (didSeal) {
      await this.notifications.create({
        userId,
        type: NotificationType.WeeklyRecap,
        title: 'Week sealed',
        body: `You locked the week — +${sealedPlan.lockRewardXp} XP and +${sealedPlan.lockRewardGems} gems.`,
        actionUrl: '/week',
        channels: [NotificationChannel.InApp],
      });
      void this.gamification.processPendingOutbox().catch(() => undefined);
    }
  }

  private async closePreviousWeekIfNeeded(
    userId: string,
    currentWeekStart: string,
  ): Promise<void> {
    const previous = await this.plansRepo
      .createQueryBuilder('p')
      .where('p.user_id = :userId', { userId })
      .andWhere('p.week_start < :current', { current: currentWeekStart })
      .andWhere('p.status = :active', { active: WeeklyPlanStatus.Active })
      .orderBy('p.week_start', 'DESC')
      .getOne();

    if (!previous) return;

    previous.status = WeeklyPlanStatus.Missed;
    await this.plansRepo.save(previous);

    await this.recordEvent({
      userId,
      planId: previous.id,
      type: WeeklyPlanEventType.Missed,
      payload: { weekStart: previous.weekStart },
    });

    // Archive older sealed/missed plans beyond the previous one
    await this.plansRepo
      .createQueryBuilder()
      .update(WeeklyPlan)
      .set({ status: WeeklyPlanStatus.Archived })
      .where('user_id = :userId', { userId })
      .andWhere('week_start < :prev', { prev: previous.weekStart })
      .andWhere('status IN (:...statuses)', {
        statuses: [WeeklyPlanStatus.Sealed, WeeklyPlanStatus.Missed],
      })
      .execute();

    if (streakResetOnMiss()) {
      await this.profiles.resetWeeklyStreak(userId);
    }

    await this.notifications.create({
      userId,
      type: NotificationType.MissedWeekRecovery,
      title: 'Missed week — no guilt',
      body: 'Last week did not seal. Replan this week and keep going.',
      actionUrl: '/week',
      channels: [NotificationChannel.InApp],
    });
  }

  private async recordEvent(input: {
    userId: string;
    planId: string;
    type: WeeklyPlanEventType;
    taskId?: string | null;
    payload?: Record<string, unknown>;
  }) {
    await this.eventsRepo.save(
      this.eventsRepo.create({
        userId: input.userId,
        weeklyPlanId: input.planId,
        type: input.type,
        taskId: input.taskId ?? null,
        payload: input.payload ?? {},
      }),
    );
  }

  private async requireProfile(userId: string) {
    const profile = await this.profiles.findByUserId(userId);
    if (!profile) {
      throw new AppException(
        AuthErrorCode.UNAUTHORIZED,
        'Profile not found',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return profile;
  }
}
