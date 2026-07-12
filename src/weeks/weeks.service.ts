import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
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
import { UpdateWeeklyTaskDto } from './dto/update-weekly-task.dto';
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
import { toWeekCurrentDto, type WeekCurrentDto } from './weeks.serializer';
import {
  dayIndexNow,
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
    private readonly planner: WeeksPlannerService,
    private readonly profiles: ProfilesService,
    private readonly goals: GoalsService,
    private readonly roadmaps: RoadmapsService,
    private readonly notifications: NotificationsService,
    private readonly dataSource: DataSource,
  ) {}

  async getCurrent(userId: string): Promise<WeekCurrentDto> {
    const profile = await this.profiles.findByUserId(userId);
    if (!profile) {
      throw new AppException(
        AuthErrorCode.UNAUTHORIZED,
        'Profile not found',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const tz = resolveTz(profile.timezone);
    const now = new Date();
    const weekStart = weekStartMonday(now, tz);
    const todayIndex = dayIndexNow(now, tz);

    await this.closePreviousWeekIfNeeded(userId, weekStart);

    let plan = await this.plansRepo.findOne({
      where: { userId, weekStart },
    });

    if (!plan) {
      plan = await this.ensurePlan(userId, weekStart, profile.weeklyStreak);
    }

    const tasks = await this.tasksRepo.find({
      where: { weeklyPlanId: plan.id },
      order: { dayIndex: 'ASC', sortOrder: 'ASC' },
    });

    return toWeekCurrentDto({
      plan,
      tasks,
      weeklyStreak: profile.weeklyStreak,
      dayIndexNow: todayIndex,
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
        AuthErrorCode.WEEK_NOT_FOUND,
        'No weekly plan for current week',
        HttpStatus.NOT_FOUND,
      );
    }
    if (plan.status === WeeklyPlanStatus.Sealed) {
      throw new AppException(
        AuthErrorCode.WEEK_ALREADY_SEALED,
        'Week already sealed',
        HttpStatus.CONFLICT,
      );
    }
    if (plan.replanCount >= replanMaxPerWeek()) {
      throw new AppException(
        AuthErrorCode.REPLAN_LIMIT,
        'Replan limit reached for this week',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const tasks = await this.tasksRepo.find({
      where: { weeklyPlanId: plan.id },
    });
    const goal = await this.goals.findActiveByUserId(userId);
    const roadmap = await this.roadmaps.findReadyWithLessons(userId);

    const result = await this.planner.replan({
      plan,
      tasks,
      mode: dto.mode ?? 'catch_up',
      reduceHours: Boolean(dto.reduceHours),
      goal,
      roadmap,
      dayIndexNow: todayIndex,
    });

    await this.notifications.create({
      userId,
      type: NotificationType.ReplanSuggestion,
      title: 'Week replanned',
      body: 'Arlo reshuffled your remaining sessions. Open Plan to review.',
      actionUrl: '/week',
      channels: [NotificationChannel.InApp],
    });

    const freshProfile = await this.profiles.findByUserId(userId);
    return toWeekCurrentDto({
      plan: result.plan,
      tasks: result.tasks,
      weeklyStreak: freshProfile?.weeklyStreak ?? profile.weeklyStreak,
      dayIndexNow: todayIndex,
    });
  }

  async updateTask(
    userId: string,
    taskId: string,
    dto: UpdateWeeklyTaskDto,
  ): Promise<WeekCurrentDto> {
    const profile = await this.requireProfile(userId);
    const tz = resolveTz(profile.timezone);
    const now = new Date();
    const weekStart = weekStartMonday(now, tz);

    const plan = await this.plansRepo.findOne({
      where: { userId, weekStart },
    });
    if (!plan) {
      throw new AppException(
        AuthErrorCode.WEEK_NOT_FOUND,
        'No weekly plan for current week',
        HttpStatus.NOT_FOUND,
      );
    }
    if (plan.status === WeeklyPlanStatus.Sealed) {
      throw new AppException(
        AuthErrorCode.WEEK_ALREADY_SEALED,
        'Week already sealed',
        HttpStatus.CONFLICT,
      );
    }

    const task = await this.tasksRepo.findOne({
      where: { id: taskId, weeklyPlanId: plan.id },
    });
    if (!task) {
      throw new AppException(
        AuthErrorCode.TASK_NOT_FOUND,
        'Task not found',
        HttpStatus.NOT_FOUND,
      );
    }

    const wasDone = task.status === WeeklyTaskStatus.Done;

    if (dto.dayIndex !== undefined) task.dayIndex = dto.dayIndex;
    if (dto.status !== undefined) {
      task.status = dto.status;
      if (dto.status === WeeklyTaskStatus.Done && !wasDone) {
        task.completedAt = now;
        plan.sessionsDone += 1;
        plan.hoursDone = String(
          round1(num(plan.hoursDone) + task.minutes / 60),
        );
      }
      if (wasDone && dto.status !== WeeklyTaskStatus.Done) {
        task.completedAt = null;
        plan.sessionsDone = Math.max(0, plan.sessionsDone - 1);
        plan.hoursDone = String(
          Math.max(0, round1(num(plan.hoursDone) - task.minutes / 60)),
        );
      }
    }

    await this.tasksRepo.save(task);
    await this.plansRepo.save(plan);
    await this.trySeal(userId, plan);

    return this.getCurrent(userId);
  }

  /**
   * Hook from LessonsService.complete — marks linked weekly task done, may seal.
   * Soft-fails (returns null) when no plan / roadmap yet.
   */
  async onLessonCompleted(
    userId: string,
    lessonId: string,
    minutes: number,
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
        plan = await this.ensurePlan(userId, weekStart, profile.weeklyStreak);
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
      linked.status = WeeklyTaskStatus.Done;
      linked.completedAt = now;
      await this.tasksRepo.save(linked);
      plan.sessionsDone += 1;
      plan.hoursDone = String(
        round1(num(plan.hoursDone) + (minutes || linked.minutes) / 60),
      );
      await this.plansRepo.save(plan);
    }

    await this.trySeal(userId, plan);
    return this.getCurrent(userId);
  }

  private async ensurePlan(
    userId: string,
    weekStart: string,
    weeklyStreak: number,
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
    return this.planner.createPlan({
      userId,
      weekStart,
      weekIndex: weeklyStreak + 1,
      goal,
      roadmap,
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

      const profile = await manager.findOne(Profile, {
        where: { userId },
      });
      if (profile) {
        profile.weeklyStreak += 1;
        profile.totalXp += locked.lockRewardXp;
        profile.gems += locked.lockRewardGems;
        await manager.save(profile);
      }
      didSeal = true;
      Object.assign(plan, locked);
    });

    if (didSeal) {
      await this.notifications.create({
        userId,
        type: NotificationType.WeeklyRecap,
        title: 'Week sealed',
        body: `You locked the week — +${plan.lockRewardXp} XP and +${plan.lockRewardGems} gems.`,
        actionUrl: '/week',
        channels: [NotificationChannel.InApp],
      });
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
