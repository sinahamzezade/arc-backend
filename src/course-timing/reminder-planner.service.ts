import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { NotificationType } from '../notifications/entities/notification.entity';
import { NotificationsService } from '../notifications/notifications.service';
import {
  MISSED_AFTER_MINUTES,
  ReminderStatus,
  ScheduleSlotStatus,
} from './timing.constants';
import { CourseSchedule } from './entities/course-schedule.entity';
import { ReminderPlan } from './entities/reminder-plan.entity';
import { ScheduleSlot } from './entities/schedule-slot.entity';
import { TimingAnalyticsService } from './timing-analytics.service';

@Injectable()
export class ReminderPlannerService {
  private readonly logger = new Logger(ReminderPlannerService.name);

  constructor(
    @InjectRepository(ReminderPlan)
    private readonly remindersRepo: Repository<ReminderPlan>,
    @InjectRepository(ScheduleSlot)
    private readonly slotsRepo: Repository<ScheduleSlot>,
    private readonly notifications: NotificationsService,
    private readonly analytics: TimingAnalyticsService,
  ) {}

  async planForSchedule(
    schedule: CourseSchedule,
    slots: ScheduleSlot[],
    leadMinutes: number,
  ): Promise<void> {
    const plans: ReminderPlan[] = [];
    for (const slot of slots) {
      if (slot.status !== ScheduleSlotStatus.Planned) continue;
      const fireAt = new Date(slot.startsAtUtc.getTime() - leadMinutes * 60_000);
      if (fireAt.getTime() < Date.now() - 60_000) continue;

      const dedupeKey = `timing:${schedule.id}:v${schedule.scheduleVersion}:slot:${slot.id}:study_reminder`;
      plans.push(
        this.remindersRepo.create({
          userId: schedule.userId,
          scheduleId: schedule.id,
          slotId: slot.id,
          scheduleVersion: schedule.scheduleVersion,
          type: NotificationType.StudyReminder,
          fireAt,
          status: ReminderStatus.Pending,
          dedupeKey,
          payload: {
            slotId: slot.id,
            lessonId: slot.lessonId,
            title: slot.title,
            startsAt: slot.startsAtUtc.toISOString(),
            minutes: slot.plannedMinutes,
          },
        }),
      );

      const missedAt = new Date(
        slot.endsAtUtc.getTime() + MISSED_AFTER_MINUTES * 60_000,
      );
      plans.push(
        this.remindersRepo.create({
          userId: schedule.userId,
          scheduleId: schedule.id,
          slotId: slot.id,
          scheduleVersion: schedule.scheduleVersion,
          type: NotificationType.MissedSession,
          fireAt: missedAt,
          status: ReminderStatus.Pending,
          dedupeKey: `timing:${schedule.id}:v${schedule.scheduleVersion}:slot:${slot.id}:missed`,
          payload: {
            slotId: slot.id,
            lessonId: slot.lessonId,
          },
        }),
      );
    }

    if (!plans.length) return;

    for (const plan of plans) {
      try {
        await this.remindersRepo.save(plan);
      } catch {
        /* unique dedupe race */
      }
    }
  }

  async cancelForSchedule(
    scheduleId: string,
    userId: string,
    reason: string,
  ): Promise<number> {
    const pending = await this.remindersRepo.find({
      where: {
        scheduleId,
        userId,
        status: In([ReminderStatus.Pending, ReminderStatus.Scheduled]),
      },
    });
    if (!pending.length) return 0;

    for (const p of pending) {
      p.status = ReminderStatus.Cancelled;
    }
    await this.remindersRepo.save(pending);

    await this.notifications.cancelScheduledByDedupePrefix(
      userId,
      `sched:timing:${scheduleId}:`,
      reason,
    );
    return pending.length;
  }

  async dispatchDue(limit = 50): Promise<number> {
    const now = new Date();
    const due = await this.remindersRepo
      .createQueryBuilder('r')
      .where('r.status = :status', { status: ReminderStatus.Pending })
      .andWhere('r.fire_at <= :now', { now })
      .orderBy('r.fire_at', 'ASC')
      .take(limit)
      .getMany();

    let sent = 0;
    for (const plan of due) {
      try {
        if (plan.type === NotificationType.MissedSession && plan.slotId) {
          const slot = await this.slotsRepo.findOne({
            where: { id: plan.slotId },
          });
          if (
            !slot ||
            slot.status === ScheduleSlotStatus.Completed ||
            slot.status === ScheduleSlotStatus.Cancelled ||
            slot.status === ScheduleSlotStatus.Moved
          ) {
            plan.status = ReminderStatus.Cancelled;
            await this.remindersRepo.save(plan);
            continue;
          }
          if (slot.status === ScheduleSlotStatus.Planned) {
            slot.status = ScheduleSlotStatus.Missed;
            slot.reminderStatus = ReminderStatus.Sent;
            await this.slotsRepo.save(slot);
            this.analytics.emit('slot_missed', {
              slotId: slot.id,
              userId: slot.userId,
            });
          }
        }

        const title =
          plan.type === NotificationType.StudyReminder
            ? 'Study session coming up'
            : plan.type === NotificationType.MissedSession
              ? 'Missed study session'
              : 'Learning update';
        const body =
          typeof plan.payload.title === 'string'
            ? String(plan.payload.title)
            : 'Your next learning block is ready.';

        const lessonId =
          typeof plan.payload.lessonId === 'string'
            ? plan.payload.lessonId
            : null;

        await this.notifications.create({
          userId: plan.userId,
          type: plan.type,
          title,
          body,
          actionUrl: lessonId ? `/learn/${lessonId}` : '/week',
          dedupeKey: plan.dedupeKey,
          scheduledAt: plan.fireAt.getTime() > Date.now() + 5_000 ? plan.fireAt : null,
          payload: {
            ...plan.payload,
            scheduleId: plan.scheduleId,
            scheduleVersion: plan.scheduleVersion,
          },
        });

        plan.status = ReminderStatus.Sent;
        await this.remindersRepo.save(plan);
        this.analytics.emit('reminder_sent', {
          reminderId: plan.id,
          type: plan.type,
          userId: plan.userId,
        });
        sent += 1;
      } catch (err) {
        this.logger.warn(
          `Reminder ${plan.id} failed: ${err instanceof Error ? err.message : err}`,
        );
        plan.status = ReminderStatus.Failed;
        await this.remindersRepo.save(plan);
      }
    }
    return sent;
  }
}
