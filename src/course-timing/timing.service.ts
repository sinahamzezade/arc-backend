import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { ContentQueryService } from '../content-pool/content-query.service';
import { Goal } from '../goals/entities/goal.entity';
import { NotificationType } from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { Profile } from '../profiles/entities/profile.entity';
import { Lesson, LessonStatus } from '../roadmaps/entities/lesson.entity';
import { Roadmap } from '../roadmaps/entities/roadmap.entity';
import { resolveTz, zonedTimeToUtc } from '../weeks/weeks.time';
import { CapacityService } from './capacity.service';
import { CourseSchedule } from './entities/course-schedule.entity';
import { LearningCommitment } from './entities/learning-commitment.entity';
import { PaceSnapshot } from './entities/pace-snapshot.entity';
import { ScheduleChange } from './entities/schedule-change.entity';
import { ScheduleSlot } from './entities/schedule-slot.entity';
import { PaceEngineService } from './pace-engine.service';
import { ReminderPlannerService } from './reminder-planner.service';
import {
  addDaysToDateString,
  ScheduleBuilderService,
} from './schedule-builder.service';
import { TimingAnalyticsService } from './timing-analytics.service';
import {
  ACTIVE_WINDOW_WEEKS,
  CommitmentStatus,
  FeasibilityState,
  PaceState,
  REMINDER_LEAD_MINUTES_DEFAULT,
  ScheduleChangeActor,
  ScheduleSlotSource,
  ScheduleSlotStatus,
  TZ_CHANGE_COOLDOWN_DAYS,
  WINDOW_EXPAND_THRESHOLD,
} from './timing.constants';

@Injectable()
export class TimingService {
  private readonly logger = new Logger(TimingService.name);

  constructor(
    private readonly capacity: CapacityService,
    private readonly builder: ScheduleBuilderService,
    private readonly pace: PaceEngineService,
    private readonly reminders: ReminderPlannerService,
    private readonly analytics: TimingAnalyticsService,
    private readonly contentQuery: ContentQueryService,
    private readonly notifications: NotificationsService,
    @InjectRepository(LearningCommitment)
    private readonly commitmentsRepo: Repository<LearningCommitment>,
    @InjectRepository(CourseSchedule)
    private readonly schedulesRepo: Repository<CourseSchedule>,
    @InjectRepository(ScheduleSlot)
    private readonly slotsRepo: Repository<ScheduleSlot>,
    @InjectRepository(PaceSnapshot)
    private readonly paceRepo: Repository<PaceSnapshot>,
    @InjectRepository(ScheduleChange)
    private readonly changesRepo: Repository<ScheduleChange>,
    @InjectRepository(Goal)
    private readonly goalsRepo: Repository<Goal>,
    @InjectRepository(Roadmap)
    private readonly roadmapsRepo: Repository<Roadmap>,
    @InjectRepository(Lesson)
    private readonly lessonsRepo: Repository<Lesson>,
    @InjectRepository(Profile)
    private readonly profilesRepo: Repository<Profile>,
  ) {}

  /** Bootstrap after roadmap assemble. */
  async bootstrapFromRoadmap(
    roadmapId: string,
  ): Promise<CourseSchedule | null> {
    const roadmap = await this.roadmapsRepo.findOne({
      where: { id: roadmapId },
      relations: {
        phases: { milestones: { lessons: true } },
      },
    });
    if (!roadmap) return null;

    const goal = await this.goalsRepo.findOne({
      where: { id: roadmap.goalId },
    });
    if (!goal) return null;

    const commitment = await this.upsertCommitmentFromGoal(goal, roadmap);
    return this.generateSchedule({
      userId: roadmap.userId,
      commitment,
      roadmap,
      actor: ScheduleChangeActor.System,
      reason: 'initial_generation',
    });
  }

  async getCurrent(userId: string) {
    const schedule = await this.requireActiveSchedule(userId);
    const next = await this.slotsRepo.findOne({
      where: {
        scheduleId: schedule.id,
        status: ScheduleSlotStatus.Planned,
      },
      order: { startsAtUtc: 'ASC' },
    });

    return {
      scheduleId: schedule.id,
      scheduleVersion: schedule.scheduleVersion,
      plannedMinutesPerWeek: schedule.plannedMinutesPerWeek,
      effectiveMinutesPerWeek: schedule.effectiveMinutesPerWeek,
      pace: schedule.paceState,
      feasibility: schedule.feasibilityState,
      feasibilityRatio: Number(schedule.feasibilityRatio),
      requestedCompletionDate: schedule.targetCompletionDate,
      estimatedCompletionDate: schedule.estimatedCompletionDate,
      remainingMinutes: schedule.remainingMinutes,
      completedMinutes: schedule.completedMinutes,
      activeWindow: {
        start: schedule.activeWindowStart,
        end: schedule.activeWindowEnd,
      },
      nextSession: next
        ? {
            slotId: next.id,
            startsAt: next.startsAtUtc.toISOString(),
            endsAt: next.endsAtUtc.toISOString(),
            lessonId: next.lessonId,
            minutes: next.plannedMinutes,
            title: next.title,
          }
        : null,
    };
  }

  async getCalendar(userId: string, from?: string, to?: string) {
    const schedule = await this.requireActiveSchedule(userId);
    const fromDate = from ?? schedule.activeWindowStart;
    const toDate = to ?? schedule.activeWindowEnd;
    const slots = await this.slotsRepo.find({
      where: {
        scheduleId: schedule.id,
        localDate: Between(fromDate, toDate),
        status: In([
          ScheduleSlotStatus.Planned,
          ScheduleSlotStatus.Started,
          ScheduleSlotStatus.Completed,
          ScheduleSlotStatus.Missed,
          ScheduleSlotStatus.Moved,
        ]),
      },
      order: { startsAtUtc: 'ASC' },
    });
    return {
      scheduleId: schedule.id,
      scheduleVersion: schedule.scheduleVersion,
      from: fromDate,
      to: toDate,
      slots: slots.map((s) => ({
        slotId: s.id,
        localDate: s.localDate,
        startLocalTime: s.startLocalTime,
        endLocalTime: s.endLocalTime,
        startsAt: s.startsAtUtc.toISOString(),
        endsAt: s.endsAtUtc.toISOString(),
        minutes: s.plannedMinutes,
        lessonId: s.lessonId,
        title: s.title,
        status: s.status,
      })),
    };
  }

  async getFeasibility(userId: string) {
    const commitment = await this.commitmentsRepo.findOne({
      where: { userId, status: CommitmentStatus.Active },
      order: { updatedAt: 'DESC' },
    });
    if (!commitment) {
      throw new AppException(
        AuthErrorCode.TIMING_COMMITMENT_MISSING,
        'Learning commitment missing',
        HttpStatus.NOT_FOUND,
      );
    }
    const required = await this.sumRequiredMinutes(commitment.roadmapId);
    const cap = this.capacity.compute({
      weeklyHoursToken: commitment.weeklyHoursToken,
      deadlineToken: commitment.deadlineToken,
      requiredContentMinutes: required,
    });
    return {
      ...cap,
      commitmentId: commitment.id,
      roadmapId: commitment.roadmapId,
    };
  }

  async patchCommitment(
    userId: string,
    dto: {
      timezone?: string;
      weeklyHoursToken?: string;
      availableDays?: string[];
      timeWindows?: string[];
      deadlineToken?: string;
      reminderLeadMinutes?: number;
      quietHoursStart?: string;
      quietHoursEnd?: string;
      quietHoursEnabled?: boolean;
      replan?: boolean;
    },
  ) {
    const commitment = await this.commitmentsRepo.findOne({
      where: { userId, status: CommitmentStatus.Active },
      order: { updatedAt: 'DESC' },
    });
    if (!commitment) {
      throw new AppException(
        AuthErrorCode.TIMING_COMMITMENT_MISSING,
        'Learning commitment missing',
        HttpStatus.NOT_FOUND,
      );
    }

    if (dto.timezone !== undefined) {
      try {
        resolveTz(dto.timezone);
      } catch {
        throw new AppException(
          AuthErrorCode.TIMING_INVALID_TIMEZONE,
          'Invalid timezone',
        );
      }
      const tz = resolveTz(dto.timezone);
      if (tz !== commitment.timezone && commitment.timezoneChangedAt) {
        const days =
          (Date.now() - commitment.timezoneChangedAt.getTime()) / 86_400_000;
        if (days < TZ_CHANGE_COOLDOWN_DAYS) {
          throw new AppException(
            AuthErrorCode.TIMING_VERSION_CONFLICT,
            `Timezone change limited to once per ${TZ_CHANGE_COOLDOWN_DAYS} days`,
          );
        }
      }
      if (tz !== commitment.timezone) {
        commitment.timezone = tz;
        commitment.timezoneChangedAt = new Date();
      }
    }

    if (dto.weeklyHoursToken !== undefined) {
      commitment.weeklyHoursToken = dto.weeklyHoursToken;
      const hours = this.capacity.compute({
        weeklyHoursToken: dto.weeklyHoursToken,
        deadlineToken: commitment.deadlineToken,
        requiredContentMinutes: 0,
      }).hoursPerWeek;
      commitment.targetMinutesPerWeek = Math.round(hours * 60 * 0.85);
    }
    if (dto.availableDays) commitment.availableDays = dto.availableDays;
    if (dto.timeWindows) commitment.timeWindows = dto.timeWindows;
    if (dto.deadlineToken !== undefined) {
      commitment.deadlineToken = dto.deadlineToken;
    }
    if (dto.reminderLeadMinutes !== undefined) {
      commitment.reminderLeadMinutes = dto.reminderLeadMinutes;
    }
    if (dto.quietHoursStart) commitment.quietHoursStart = dto.quietHoursStart;
    if (dto.quietHoursEnd) commitment.quietHoursEnd = dto.quietHoursEnd;
    if (dto.quietHoursEnabled !== undefined) {
      commitment.quietHoursEnabled = dto.quietHoursEnabled;
    }
    commitment.version += 1;
    await this.commitmentsRepo.save(commitment);

    const shouldReplan =
      dto.replan !== false &&
      (dto.weeklyHoursToken !== undefined ||
        dto.availableDays !== undefined ||
        dto.timeWindows !== undefined ||
        dto.deadlineToken !== undefined ||
        dto.timezone !== undefined);

    if (shouldReplan && commitment.roadmapId) {
      return this.replan(userId, {
        reason: 'commitment_changed',
        actor: ScheduleChangeActor.User,
      });
    }

    return this.getCurrent(userId);
  }

  async replan(
    userId: string,
    opts: {
      reason: string;
      actor?: ScheduleChangeActor;
      expectedVersion?: number;
    },
  ) {
    const schedule = await this.requireActiveSchedule(userId);
    if (schedule.replanLock) {
      throw new AppException(
        AuthErrorCode.TIMING_REPLAN_IN_PROGRESS,
        'Replan already in progress',
        HttpStatus.CONFLICT,
      );
    }
    if (
      opts.expectedVersion != null &&
      opts.expectedVersion !== schedule.scheduleVersion
    ) {
      throw new AppException(
        AuthErrorCode.TIMING_VERSION_CONFLICT,
        'Schedule version conflict',
        HttpStatus.CONFLICT,
      );
    }

    schedule.replanLock = true;
    await this.schedulesRepo.save(schedule);

    try {
      const commitment = await this.commitmentsRepo.findOne({
        where: { id: schedule.commitmentId },
      });
      if (!commitment) {
        throw new AppException(
          AuthErrorCode.TIMING_COMMITMENT_MISSING,
          'Learning commitment missing',
        );
      }
      const roadmap = await this.roadmapsRepo.findOne({
        where: { id: schedule.roadmapId },
        relations: {
        phases: { milestones: { lessons: true } },
      },
      });
      if (!roadmap) {
        throw new AppException(
          AuthErrorCode.TIMING_NO_CONTENT_AVAILABLE,
          'Roadmap missing',
        );
      }

      await this.reminders.cancelForSchedule(
        schedule.id,
        userId,
        `replan:${opts.reason}`,
      );

      // Keep completed; cancel incomplete future.
      const open = await this.slotsRepo.find({
        where: {
          scheduleId: schedule.id,
          status: In([
            ScheduleSlotStatus.Planned,
            ScheduleSlotStatus.Started,
            ScheduleSlotStatus.Moved,
          ]),
        },
      });
      for (const s of open) {
        s.status = ScheduleSlotStatus.Cancelled;
      }
      if (open.length) await this.slotsRepo.save(open);

      const oldVersion = schedule.scheduleVersion;
      schedule.isActive = false;
      await this.schedulesRepo.save(schedule);

      const next = await this.generateSchedule({
        userId,
        commitment,
        roadmap,
        actor: opts.actor ?? ScheduleChangeActor.User,
        reason: opts.reason,
        priorSchedule: schedule,
        priorVersion: oldVersion,
      });

      await this.notifications.create({
        userId,
        type: NotificationType.ReplanSuggestion,
        title: 'Schedule updated',
        body: 'Your learning plan was adjusted to match your pace.',
        actionUrl: '/week',
        dedupeKey: `timing:replan:${next.id}:v${next.scheduleVersion}`,
        payload: { scheduleId: next.id, reason: opts.reason },
      });

      this.analytics.emit('schedule_replanned', {
        scheduleId: next.id,
        userId,
        reason: opts.reason,
        version: next.scheduleVersion,
      });

      return this.getCurrent(userId);
    } finally {
      const locked = await this.schedulesRepo.findOne({
        where: { id: schedule.id },
      });
      if (locked?.replanLock) {
        locked.replanLock = false;
        await this.schedulesRepo.save(locked);
      }
    }
  }

  async moveSlot(
    userId: string,
    slotId: string,
    body: { localDate: string; startLocalTime?: string },
  ) {
    const slot = await this.slotsRepo.findOne({
      where: { id: slotId, userId },
    });
    if (!slot) {
      throw new AppException(
        AuthErrorCode.TIMING_SLOT_NOT_FOUND,
        'Slot not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (slot.status === ScheduleSlotStatus.Completed) {
      throw new AppException(
        AuthErrorCode.TIMING_SLOT_ALREADY_COMPLETED,
        'Cannot move completed slot',
      );
    }

    const schedule = await this.schedulesRepo.findOne({
      where: { id: slot.scheduleId },
    });
    const commitment = schedule
      ? await this.commitmentsRepo.findOne({
          where: { id: schedule.commitmentId },
        })
      : null;
    const tz = resolveTz(commitment?.timezone);

    const [y, m, d] = body.localDate.split('-').map(Number);
    const time = body.startLocalTime ?? slot.startLocalTime;
    const [hh, mm] = time.split(':').map(Number);
    const startsAtUtc = zonedTimeToUtc(y, m, d, hh, mm, tz);
    const endsAtUtc = new Date(
      startsAtUtc.getTime() + slot.plannedMinutes * 60_000,
    );
    const endTotal = hh * 60 + mm + slot.plannedMinutes;
    const endLocal = `${String(Math.floor(endTotal / 60) % 24).padStart(2, '0')}:${String(endTotal % 60).padStart(2, '0')}`;

    slot.localDate = body.localDate;
    slot.startLocalTime = time;
    slot.endLocalTime = endLocal;
    slot.startsAtUtc = startsAtUtc;
    slot.endsAtUtc = endsAtUtc;
    slot.status = ScheduleSlotStatus.Moved;
    slot.source = ScheduleSlotSource.User;
    await this.slotsRepo.save(slot);

    if (schedule) {
      await this.reminders.cancelForSchedule(schedule.id, userId, 'slot_moved');
      const lead =
        commitment?.reminderLeadMinutes ?? REMINDER_LEAD_MINUTES_DEFAULT;
      await this.reminders.planForSchedule(schedule, [slot], lead);
      slot.status = ScheduleSlotStatus.Planned;
      await this.slotsRepo.save(slot);
    }

    return this.getCalendar(userId);
  }

  async skipSlot(userId: string, slotId: string, _reason?: string) {
    const slot = await this.slotsRepo.findOne({
      where: { id: slotId, userId },
    });
    if (!slot) {
      throw new AppException(
        AuthErrorCode.TIMING_SLOT_NOT_FOUND,
        'Slot not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (slot.status === ScheduleSlotStatus.Completed) {
      throw new AppException(
        AuthErrorCode.TIMING_SLOT_ALREADY_COMPLETED,
        'Cannot skip completed slot',
      );
    }
    slot.status = ScheduleSlotStatus.Cancelled;
    await this.slotsRepo.save(slot);

    const schedule = await this.schedulesRepo.findOne({
      where: { id: slot.scheduleId },
    });
    if (schedule) {
      await this.reminders.cancelForSchedule(
        schedule.id,
        userId,
        'slot_skipped',
      );
      const openMissed = await this.slotsRepo.count({
        where: {
          scheduleId: schedule.id,
          status: ScheduleSlotStatus.Missed,
        },
      });
      if (openMissed >= 2) {
        void this.replan(userId, {
          reason: 'missed_two_sessions',
          actor: ScheduleChangeActor.System,
        }).catch(() => undefined);
      }
    }
    return this.getCurrent(userId);
  }

  async onLessonCompleted(
    userId: string,
    lessonId: string,
    verifiedMinutes: number,
  ): Promise<void> {
    const schedule = await this.schedulesRepo.findOne({
      where: { userId, isActive: true },
      order: { scheduleVersion: 'DESC' },
    });
    if (!schedule) return;

    const slot = await this.slotsRepo.findOne({
      where: {
        scheduleId: schedule.id,
        lessonId,
        status: In([
          ScheduleSlotStatus.Planned,
          ScheduleSlotStatus.Started,
          ScheduleSlotStatus.Moved,
        ]),
      },
      order: { startsAtUtc: 'ASC' },
    });
    if (slot) {
      slot.status = ScheduleSlotStatus.Completed;
      await this.slotsRepo.save(slot);
      this.analytics.emit('slot_completed', {
        slotId: slot.id,
        lessonId,
        userId,
      });
    }

    const minutes = Math.max(0, verifiedMinutes);
    schedule.completedMinutes += minutes;
    schedule.remainingMinutes = Math.max(
      0,
      schedule.totalRequiredMinutes - schedule.completedMinutes,
    );
    await this.schedulesRepo.save(schedule);
    await this.recalculatePace(schedule, 'lesson_completion');

    await this.maybeExpandWindow(schedule);
  }

  async takeDailyPaceSnapshot(userId?: string): Promise<number> {
    const qb = this.schedulesRepo
      .createQueryBuilder('s')
      .where('s.is_active = true');
    if (userId) qb.andWhere('s.user_id = :userId', { userId });
    const schedules = await qb.getMany();
    let n = 0;
    for (const s of schedules) {
      await this.recalculatePace(s, 'daily_snapshot');
      n += 1;
    }
    return n;
  }

  async reconcileMissedSlots(): Promise<number> {
    const now = new Date();
    const stale = await this.slotsRepo
      .createQueryBuilder('s')
      .where('s.status = :status', { status: ScheduleSlotStatus.Planned })
      .andWhere('s.ends_at_utc < :cutoff', {
        cutoff: new Date(now.getTime() - 60 * 60_000),
      })
      .take(200)
      .getMany();
    for (const s of stale) {
      s.status = ScheduleSlotStatus.Missed;
      await this.slotsRepo.save(s);
      this.analytics.emit('slot_missed', { slotId: s.id, userId: s.userId });
    }
    return stale.length;
  }

  private async maybeExpandWindow(schedule: CourseSchedule): Promise<void> {
    const slots = await this.slotsRepo.find({
      where: { scheduleId: schedule.id },
    });
    const windowSlots = slots.filter(
      (s) =>
        s.localDate >= schedule.activeWindowStart &&
        s.localDate <= schedule.activeWindowEnd &&
        s.status !== ScheduleSlotStatus.Cancelled,
    );
    if (!windowSlots.length) return;
    const done = windowSlots.filter(
      (s) => s.status === ScheduleSlotStatus.Completed,
    ).length;
    if (done / windowSlots.length < WINDOW_EXPAND_THRESHOLD) return;

    try {
      await this.contentQuery.materializeRoadmapContent(schedule.roadmapId, {
        weeks: ACTIVE_WINDOW_WEEKS,
        fromWeek: Math.max(
          1,
          Math.ceil(
            (Date.parse(schedule.activeWindowEnd) -
              Date.parse(schedule.startDate)) /
              (7 * 86_400_000),
          ) + 1,
        ),
      });
    } catch (err) {
      this.logger.warn(
        `Materialize on expand failed: ${err instanceof Error ? err.message : err}`,
      );
    }

    const commitment = await this.commitmentsRepo.findOne({
      where: { id: schedule.commitmentId },
    });
    const roadmap = await this.roadmapsRepo.findOne({
      where: { id: schedule.roadmapId },
      relations: {
        phases: { milestones: { lessons: true } },
      },
    });
    if (!commitment || !roadmap) return;

    const lessons = this.incompleteLessons(roadmap).filter(
      (l) =>
        !slots.some(
          (s) =>
            s.lessonId === l.id && s.status !== ScheduleSlotStatus.Cancelled,
        ),
    );
    if (!lessons.length) return;

    const built = this.builder.buildActiveWindow({
      commitment,
      lessons,
      fromDate: new Date(schedule.activeWindowEnd),
      weeks: ACTIVE_WINDOW_WEEKS,
      source: ScheduleSlotSource.Replan,
    });
    schedule.activeWindowEnd = built.windowEnd;
    await this.schedulesRepo.save(schedule);

    const newSlots = await this.slotsRepo.save(
      built.slots.map((b) =>
        this.slotsRepo.create({
          scheduleId: schedule.id,
          userId: schedule.userId,
          localDate: b.localDate,
          startLocalTime: b.startLocalTime,
          endLocalTime: b.endLocalTime,
          startsAtUtc: b.startsAtUtc,
          endsAtUtc: b.endsAtUtc,
          plannedMinutes: b.plannedMinutes,
          lessonId: b.lessonId,
          title: b.title,
          status: ScheduleSlotStatus.Planned,
          source: b.source,
        }),
      ),
    );
    await this.reminders.planForSchedule(
      schedule,
      newSlots,
      commitment.reminderLeadMinutes,
    );
    this.analytics.emit('content_window_expanded', {
      scheduleId: schedule.id,
      userId: schedule.userId,
      newSlots: newSlots.length,
    });
  }

  private async recalculatePace(
    schedule: CourseSchedule,
    reason: string,
  ): Promise<void> {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const weekAgo = addDaysToDateString(today, -7);
    const twoWeeksAgo = addDaysToDateString(today, -14);

    const currentWeek = await this.sumCompletedMinutes(
      schedule.id,
      weekAgo,
      today,
    );
    const previousWeek = await this.sumCompletedMinutes(
      schedule.id,
      twoWeeksAgo,
      weekAgo,
    );
    const activeDays = await this.countActiveDays(schedule.id);

    const result = this.pace.compute({
      plannedMinutesPerWeek: schedule.plannedMinutesPerWeek,
      remainingMinutes: schedule.remainingMinutes,
      currentWeekCompleted: currentWeek,
      previousWeekCompleted: previousWeek,
      olderBaseline: schedule.plannedMinutesPerWeek,
      activeDays,
      targetCompletionDate: schedule.targetCompletionDate,
    });

    const prevPace = schedule.paceState;
    const prevEta = schedule.estimatedCompletionDate;
    schedule.effectiveMinutesPerWeek = result.effectiveMinutesPerWeek;
    schedule.estimatedCompletionDate = result.estimatedCompletionDate;
    schedule.paceState = result.paceState;
    await this.schedulesRepo.save(schedule);

    await this.paceRepo
      .save(
        this.paceRepo.create({
          scheduleId: schedule.id,
          userId: schedule.userId,
          snapshotDate: today,
          plannedMinutes: schedule.plannedMinutesPerWeek,
          completedMinutes: currentWeek,
          activeDays,
          completionVelocity: String(
            (currentWeek / Math.max(1, schedule.plannedMinutesPerWeek)).toFixed(
              3,
            ),
          ),
          estimateAccuracy: null,
          effectiveMinutesPerWeek: result.effectiveMinutesPerWeek,
          estimatedCompletionDate: result.estimatedCompletionDate,
          paceState: result.paceState,
          reason,
        }),
      )
      .catch(() => undefined);

    if (prevPace !== result.paceState) {
      this.analytics.emit('pace_state_changed', {
        scheduleId: schedule.id,
        from: prevPace,
        to: result.paceState,
        reason,
      });
      if (result.paceState === PaceState.AtRisk) {
        await this.notifications.create({
          userId: schedule.userId,
          type: NotificationType.PaceBehind,
          title: 'Pace at risk',
          body: 'Want an easier week? Replan keeps your progress.',
          actionUrl: '/week',
          dedupeKey: `timing:pace:${schedule.id}:${today}`,
        });
      } else if (result.paceState === PaceState.Ahead) {
        await this.notifications.create({
          userId: schedule.userId,
          type: NotificationType.PaceAhead,
          title: 'You are ahead',
          body: 'Nice momentum — estimated finish moved earlier.',
          actionUrl: '/week',
          dedupeKey: `timing:pace-ahead:${schedule.id}:${today.slice(0, 7)}`,
        });
      }
    }
    if (prevEta !== result.estimatedCompletionDate) {
      this.analytics.emit('estimated_completion_changed', {
        scheduleId: schedule.id,
        from: prevEta,
        to: result.estimatedCompletionDate,
      });
      if (
        schedule.targetCompletionDate &&
        result.estimatedCompletionDate &&
        result.estimatedCompletionDate > schedule.targetCompletionDate
      ) {
        await this.notifications.create({
          userId: schedule.userId,
          type: NotificationType.DeadlineRisk,
          title: 'Deadline risk',
          body: 'Current pace may miss your target date.',
          actionUrl: '/week',
          dedupeKey: `timing:deadline:${schedule.id}:${today}`,
        });
      }
    }
  }

  private async generateSchedule(input: {
    userId: string;
    commitment: LearningCommitment;
    roadmap: Roadmap;
    actor: ScheduleChangeActor;
    reason: string;
    priorSchedule?: CourseSchedule;
    priorVersion?: number;
  }): Promise<CourseSchedule> {
    const required = this.sumRequiredFromRoadmap(input.roadmap);
    const completedPrior = input.priorSchedule?.completedMinutes ?? 0;
    const remaining = Math.max(0, required - completedPrior);

    const cap = this.capacity.compute({
      weeklyHoursToken: input.commitment.weeklyHoursToken,
      deadlineToken: input.commitment.deadlineToken,
      recipeDefaultWeeks: input.roadmap.timelineWeeks,
      requiredContentMinutes: remaining || required,
    });

    if (cap.feasibilityState === FeasibilityState.Unrealistic) {
      this.logger.warn(
        `Unrealistic deadline for roadmap ${input.roadmap.id} ratio=${cap.feasibilityRatio}`,
      );
    }

    const lessons = this.incompleteLessons(input.roadmap);
    if (!lessons.length && remaining > 0) {
      throw new AppException(
        AuthErrorCode.TIMING_NO_CONTENT_AVAILABLE,
        'No lessons available to schedule',
      );
    }

    const built = this.builder.buildActiveWindow({
      commitment: input.commitment,
      lessons,
      weeks: ACTIVE_WINDOW_WEEKS,
      source:
        input.reason === 'initial_generation'
          ? ScheduleSlotSource.Questionnaire
          : ScheduleSlotSource.Replan,
    });

    const version = (input.priorVersion ?? 0) + 1;
    const paceResult = this.pace.compute({
      plannedMinutesPerWeek: cap.plannedMinutesPerWeek,
      remainingMinutes: remaining,
      currentWeekCompleted: 0,
      previousWeekCompleted: 0,
      olderBaseline: cap.plannedMinutesPerWeek,
      activeDays: 0,
      targetCompletionDate: cap.requestedCompletionDate,
    });

    const schedule = await this.schedulesRepo.save(
      this.schedulesRepo.create({
        userId: input.userId,
        roadmapId: input.roadmap.id,
        commitmentId: input.commitment.id,
        scheduleVersion: version,
        isActive: true,
        startDate: built.windowStart,
        targetCompletionDate: cap.requestedCompletionDate,
        estimatedCompletionDate: paceResult.estimatedCompletionDate,
        totalRequiredMinutes: required,
        completedMinutes: completedPrior,
        remainingMinutes: remaining,
        plannedMinutesPerWeek: cap.plannedMinutesPerWeek,
        effectiveMinutesPerWeek: paceResult.effectiveMinutesPerWeek,
        paceState: paceResult.paceState,
        feasibilityState: cap.feasibilityState,
        feasibilityRatio: String(cap.feasibilityRatio),
        activeWindowStart: built.windowStart,
        activeWindowEnd: built.windowEnd,
        replanLock: false,
        generatedAt: new Date(),
      }),
    );

    input.commitment.roadmapId = input.roadmap.id;
    input.commitment.requestedCompletionDate = cap.requestedCompletionDate;
    input.commitment.targetMinutesPerWeek = cap.plannedMinutesPerWeek;
    await this.commitmentsRepo.save(input.commitment);

    const slots = await this.slotsRepo.save(
      built.slots.map((b) =>
        this.slotsRepo.create({
          scheduleId: schedule.id,
          userId: input.userId,
          localDate: b.localDate,
          startLocalTime: b.startLocalTime,
          endLocalTime: b.endLocalTime,
          startsAtUtc: b.startsAtUtc,
          endsAtUtc: b.endsAtUtc,
          plannedMinutes: b.plannedMinutes,
          lessonId: b.lessonId,
          title: b.title,
          status: ScheduleSlotStatus.Planned,
          source: b.source,
        }),
      ),
    );

    await this.reminders.planForSchedule(
      schedule,
      slots,
      input.commitment.reminderLeadMinutes ?? REMINDER_LEAD_MINUTES_DEFAULT,
    );

    await this.changesRepo.save(
      this.changesRepo.create({
        scheduleId: schedule.id,
        userId: input.userId,
        oldVersion: input.priorVersion ?? 0,
        newVersion: version,
        actor: input.actor,
        reason: input.reason,
        changedFields: {
          feasibility: cap.feasibilityState,
          slots: slots.length,
        },
      }),
    );

    this.analytics.emit('schedule_generated', {
      scheduleId: schedule.id,
      userId: input.userId,
      version,
      slots: slots.length,
      feasibility: cap.feasibilityState,
    });

    return schedule;
  }

  private async upsertCommitmentFromGoal(
    goal: Goal,
    roadmap: Roadmap,
  ): Promise<LearningCommitment> {
    const profile = await this.profilesRepo.findOne({
      where: { userId: goal.userId },
    });
    const tz = resolveTz(profile?.timezone);
    const cap = this.capacity.compute({
      weeklyHoursToken: goal.weeklyHours,
      deadlineToken: goal.targetDeadline,
      recipeDefaultWeeks: roadmap.timelineWeeks,
      requiredContentMinutes: 0,
    });

    let commitment = await this.commitmentsRepo.findOne({
      where: { userId: goal.userId, goalId: goal.id },
    });
    if (!commitment) {
      commitment = this.commitmentsRepo.create({
        userId: goal.userId,
        goalId: goal.id,
        roadmapId: roadmap.id,
        timezone: tz,
        weeklyHoursToken: goal.weeklyHours,
        targetMinutesPerWeek: cap.plannedMinutesPerWeek,
        availableDays: goal.availability?.days ?? [],
        timeWindows: goal.availability?.times ?? [],
        deadlineToken: goal.targetDeadline,
        requestedCompletionDate: cap.requestedCompletionDate,
        reminderLeadMinutes: REMINDER_LEAD_MINUTES_DEFAULT,
        status: CommitmentStatus.Active,
        version: 1,
      });
    } else {
      commitment.roadmapId = roadmap.id;
      commitment.timezone = tz;
      commitment.weeklyHoursToken = goal.weeklyHours;
      commitment.targetMinutesPerWeek = cap.plannedMinutesPerWeek;
      commitment.availableDays = goal.availability?.days ?? [];
      commitment.timeWindows = goal.availability?.times ?? [];
      commitment.deadlineToken = goal.targetDeadline;
      commitment.requestedCompletionDate = cap.requestedCompletionDate;
      commitment.status = CommitmentStatus.Active;
      commitment.version += 1;
    }
    return this.commitmentsRepo.save(commitment);
  }

  private async requireActiveSchedule(userId: string): Promise<CourseSchedule> {
    const schedule = await this.schedulesRepo.findOne({
      where: { userId, isActive: true },
      order: { scheduleVersion: 'DESC' },
    });
    if (!schedule) {
      throw new AppException(
        AuthErrorCode.TIMING_SCHEDULE_NOT_FOUND,
        'No active course schedule',
        HttpStatus.NOT_FOUND,
      );
    }
    return schedule;
  }

  private incompleteLessons(roadmap: Roadmap) {
    const out: { id: string; title: string; minutes: number }[] = [];
    const phases = [...(roadmap.phases ?? [])].sort(
      (a, b) => a.orderIndex - b.orderIndex,
    );
    for (const phase of phases) {
      for (const ms of [...(phase.milestones ?? [])].sort(
        (a, b) => a.orderIndex - b.orderIndex,
      )) {
        for (const lesson of [...(ms.lessons ?? [])].sort(
          (a, b) => a.orderIndex - b.orderIndex,
        )) {
          if (lesson.status === LessonStatus.Completed) continue;
          out.push({
            id: lesson.id,
            title: lesson.title,
            minutes: lesson.estimatedMinutes || 25,
          });
        }
      }
    }
    return out;
  }

  private sumRequiredFromRoadmap(roadmap: Roadmap): number {
    let total = 0;
    for (const phase of roadmap.phases ?? []) {
      for (const ms of phase.milestones ?? []) {
        for (const lesson of ms.lessons ?? []) {
          total += lesson.estimatedMinutes || 25;
        }
      }
    }
    return total;
  }

  private async sumRequiredMinutes(roadmapId: string | null): Promise<number> {
    if (!roadmapId) return 0;
    const roadmap = await this.roadmapsRepo.findOne({
      where: { id: roadmapId },
      relations: {
        phases: { milestones: { lessons: true } },
      },
    });
    return roadmap ? this.sumRequiredFromRoadmap(roadmap) : 0;
  }

  private async sumCompletedMinutes(
    scheduleId: string,
    from: string,
    to: string,
  ): Promise<number> {
    const rows = await this.slotsRepo.find({
      where: {
        scheduleId,
        status: ScheduleSlotStatus.Completed,
        localDate: Between(from, to),
      },
    });
    return rows.reduce((a, s) => a + s.plannedMinutes, 0);
  }

  private async countActiveDays(scheduleId: string): Promise<number> {
    const rows = await this.slotsRepo
      .createQueryBuilder('s')
      .select('DISTINCT s.local_date', 'd')
      .where('s.schedule_id = :scheduleId', { scheduleId })
      .andWhere('s.status = :status', { status: ScheduleSlotStatus.Completed })
      .getRawMany<{ d: string }>();
    return rows.length;
  }
}
