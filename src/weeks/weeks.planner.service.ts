import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { Goal } from '../goals/entities/goal.entity';
import {
  Lesson,
  LessonStatus,
} from '../roadmaps/entities/lesson.entity';
import type { Roadmap } from '../roadmaps/entities/roadmap.entity';
import { decodeWeeklyHours } from '../roadmaps/token-decoders';
import {
  lockRewardGemsDefault,
  lockRewardXpDefault,
} from './weeks.constants';
import { num, round1 } from './weeks.math';
import { availabilityDayIndices } from './weeks.time';
import {
  WeeklyPlan,
  WeeklyPlanStatus,
} from './entities/weekly-plan.entity';
import {
  WeeklyTask,
  WeeklyTaskStatus,
} from './entities/weekly-task.entity';

export type FlatLesson = {
  id: string;
  title: string;
  track: string;
  minutes: number;
  xpReward: number;
  status: LessonStatus;
};

@Injectable()
export class WeeksPlannerService {
  constructor(
    @InjectRepository(WeeklyPlan)
    private readonly plansRepo: Repository<WeeklyPlan>,
    @InjectRepository(WeeklyTask)
    private readonly tasksRepo: Repository<WeeklyTask>,
  ) {}

  flattenIncompleteLessons(roadmap: Roadmap): FlatLesson[] {
    const phases = [...(roadmap.phases ?? [])].sort(
      (a, b) => a.orderIndex - b.orderIndex,
    );
    const out: FlatLesson[] = [];
    for (const phase of phases) {
      const milestones = [...(phase.milestones ?? [])].sort(
        (a, b) => a.orderIndex - b.orderIndex,
      );
      for (const milestone of milestones) {
        const lessons = [...(milestone.lessons ?? [])].sort(
          (a, b) => a.orderIndex - b.orderIndex,
        );
        for (const lesson of lessons) {
          if (lesson.status === LessonStatus.Completed) continue;
          out.push({
            id: lesson.id,
            title: lesson.title,
            track: phase.title || milestone.title || 'Path',
            minutes: lesson.estimatedMinutes || 20,
            xpReward: lesson.xpReward || 20,
            status: lesson.status,
          });
        }
      }
    }
    return out;
  }

  hoursFromGoal(goal: Goal | null, roadmap: Roadmap | null): number {
    if (roadmap?.weeklyHoursTarget) {
      const n = num(roadmap.weeklyHoursTarget);
      if (n > 0) return n;
    }
    return decodeWeeklyHours(goal?.weeklyHours);
  }

  async createPlan(input: {
    userId: string;
    weekStart: string;
    weekIndex: number;
    goal: Goal | null;
    roadmap: Roadmap;
    timezoneSnapshot?: string;
    windowStartAt?: Date;
    windowEndAt?: Date;
    /** Skip availability days before this index (mid-week join). */
    eligibleFromDayIndex?: number;
  }): Promise<WeeklyPlan> {
    const hoursPlanned = this.hoursFromGoal(input.goal, input.roadmap);
    const from = Math.min(6, Math.max(0, input.eligibleFromDayIndex ?? 0));
    let daySlots = availabilityDayIndices(input.goal?.availability?.days).filter(
      (d) => d >= from,
    );
    if (daySlots.length === 0) {
      daySlots = Array.from({ length: 7 - from }, (_, i) => from + i);
    }
    const sessionsPlanned = Math.max(
      1,
      Math.min(daySlots.length || 4, Math.max(2, Math.round(hoursPlanned / 1.5))),
    );

    const lessons = this.flattenIncompleteLessons(input.roadmap).slice(
      0,
      sessionsPlanned,
    );

    const sessionCount = Math.max(1, lessons.length || sessionsPlanned);
    // Prorate minutes when week started mid-week
    const scopeRatio = (7 - from) / 7;
    const minutesPlanned = Math.max(
      15,
      Math.round(hoursPlanned * 60 * scopeRatio),
    );
    const hoursForPlan = round1(minutesPlanned / 60);

    const plan = await this.plansRepo.save(
      this.plansRepo.create({
        userId: input.userId,
        roadmapId: input.roadmap.id,
        weekStart: input.weekStart,
        weekIndex: input.weekIndex,
        planVersion: 1,
        scheduleVersion: 1,
        timezoneSnapshot: input.timezoneSnapshot ?? null,
        windowStartAt: input.windowStartAt ?? null,
        windowEndAt: input.windowEndAt ?? null,
        sessionsPlanned: sessionCount,
        sessionsDone: 0,
        hoursPlanned: String(hoursForPlan),
        hoursDone: '0',
        minutesPlanned,
        verifiedMinutesDone: 0,
        lockRewardXp: lockRewardXpDefault(),
        lockRewardGems: lockRewardGemsDefault(),
        sealRewardRuleKey: 'week-seal-v1',
        sealRuleSnapshot: {
          sessionsOrHoursRatio: 0.8,
          version: 'week-seal-v1',
          eligibleFromDayIndex: from,
        },
        status: WeeklyPlanStatus.Active,
        sealedAt: null,
        replanCount: 0,
      }),
    );

    const tasks = this.buildTasks({
      planId: plan.id,
      lessons:
        lessons.length > 0
          ? lessons
          : [
              {
                id: null as unknown as string,
                title: 'Study session',
                track: input.roadmap.title || 'Path',
                minutes: Math.round(minutesPlanned / sessionCount),
                xpReward: 20,
                status: LessonStatus.Available,
              },
            ],
      daySlots,
      sessionCount,
    });

    await this.tasksRepo.save(tasks);
    plan.tasks = tasks;
    return plan;
  }

  buildTasks(input: {
    planId: string;
    lessons: Array<{
      id: string | null;
      title: string;
      track: string;
      minutes: number;
      xpReward: number;
    }>;
    daySlots: number[];
    sessionCount: number;
  }): WeeklyTask[] {
    const slots =
      input.daySlots.length > 0 ? input.daySlots : [0, 1, 2, 3, 4];
    const tasks: WeeklyTask[] = [];
    const count = Math.min(input.sessionCount, input.lessons.length || input.sessionCount);

    for (let i = 0; i < count; i++) {
      const lesson = input.lessons[i];
      if (!lesson) break;
      const dayIndex = slots[i % slots.length];
      tasks.push(
        this.tasksRepo.create({
          weeklyPlanId: input.planId,
          lessonId: lesson.id || null,
          dayIndex,
          title: lesson.title,
          track: lesson.track,
          minutes: lesson.minutes || 25,
          xpReward: lesson.xpReward || 20,
          status: WeeklyTaskStatus.Upcoming,
          completedAt: null,
          sortOrder: i,
          href: lesson.id ? `/learn/${lesson.id}` : null,
        }),
      );
    }
    return tasks;
  }

  async replan(input: {
    plan: WeeklyPlan;
    tasks: WeeklyTask[];
    mode: 'catch_up' | 'reduce' | 'rebuild';
    reduceHours: boolean;
    goal: Goal | null;
    roadmap: Roadmap | null;
    dayIndexNow: number;
  }): Promise<{ plan: WeeklyPlan; tasks: WeeklyTask[] }> {
    const { plan, mode } = input;
    let tasks = [...input.tasks];

    if (mode === 'reduce' || input.reduceHours) {
      plan.sessionsPlanned = Math.max(
        plan.sessionsDone,
        Math.max(1, plan.sessionsPlanned - 1),
      );
      const hours = Math.max(
        num(plan.hoursDone),
        round1(num(plan.hoursPlanned) * 0.75),
      );
      plan.hoursPlanned = String(Math.max(hours, 1));
    }

    if (mode === 'rebuild' && input.roadmap) {
      const remaining = Math.max(
        0,
        plan.sessionsPlanned - plan.sessionsDone,
      );
      const incomplete = this.flattenIncompleteLessons(input.roadmap).filter(
        (l) => !tasks.some((t) => t.lessonId === l.id && t.status === WeeklyTaskStatus.Done),
      );
      const open = tasks.filter((t) => t.status !== WeeklyTaskStatus.Done);
      if (open.length) {
        await this.tasksRepo.remove(open);
      }
      const daySlots = availabilityDayIndices(
        input.goal?.availability?.days,
      ).filter((d) => d >= input.dayIndexNow);
      const slots =
        daySlots.length > 0
          ? daySlots
          : Array.from({ length: 7 - input.dayIndexNow }, (_, i) =>
              input.dayIndexNow + i,
            );

      const fresh = this.buildTasks({
        planId: plan.id,
        lessons: incomplete.slice(0, remaining || 1),
        daySlots: slots,
        sessionCount: remaining || 1,
      });
      const saved = await this.tasksRepo.save(fresh);
      tasks = [
        ...tasks.filter((t) => t.status === WeeklyTaskStatus.Done),
        ...saved,
      ];
    } else {
      // catch_up (default): pack unfinished into remaining days
      const unfinished = tasks.filter(
        (t) =>
          t.status !== WeeklyTaskStatus.Done &&
          t.status !== WeeklyTaskStatus.Skipped,
      );
      const remainingDays = Array.from(
        { length: 7 - input.dayIndexNow },
        (_, i) => input.dayIndexNow + i,
      );
      unfinished.forEach((task, i) => {
        task.dayIndex = remainingDays[i % remainingDays.length] ?? 6;
        if (task.dayIndex < input.dayIndexNow) {
          task.status = WeeklyTaskStatus.Missed;
        } else {
          task.status = WeeklyTaskStatus.Upcoming;
        }
      });
      await this.tasksRepo.save(unfinished);
      tasks = [
        ...tasks.filter((t) => t.status === WeeklyTaskStatus.Done),
        ...unfinished,
      ];
    }

    plan.replanCount += 1;
    if (plan.status === WeeklyPlanStatus.Active) {
      plan.status = WeeklyPlanStatus.Replanned;
      // Keep treating as active for progress; status flag shows replan happened
      plan.status = WeeklyPlanStatus.Active;
    }
    const savedPlan = await this.plansRepo.save(plan);
    return { plan: savedPlan, tasks };
  }
}
