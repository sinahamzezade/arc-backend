import { DAY_FULL, DAY_LABELS } from './weeks.constants';
import {
  computeOnTrack,
  num,
  progressPercent,
  round1,
  sessionsLeft,
  targetWeek,
} from './weeks.math';
import { rangeLabel } from './weeks.time';
import {
  WeeklyPlan,
  WeeklyPlanStatus,
} from './entities/weekly-plan.entity';
import {
  WeeklyTask,
  WeeklyTaskStatus,
} from './entities/weekly-task.entity';

export type WeekCurrentDto = {
  weekLabel: string;
  rangeLabel: string;
  weekStart: string;
  targetWeek: number;
  sealed: boolean;
  sessionsLeft: number;
  estimateMinutes: number;
  replanHref: string;
  progress: {
    percent: number;
    hoursDone: number;
    hoursPlanned: number;
    sessionsDone: number;
    sessionsPlanned: number;
    onTrack: boolean;
    lockRewardXp: number;
    lockRewardGems: number;
  };
  streak: {
    weeks: number;
    days: { label: string; status: 'done' | 'empty' }[];
  };
  days: {
    label: string;
    full: string;
    status: 'done' | 'empty' | 'today';
    minutesPlanned: number;
    minutesDone: number;
  }[];
  tasks: {
    id: string;
    dayLabel: string;
    title: string;
    track: string;
    minutes: number;
    xp: number;
    status: WeeklyTaskStatus;
    href?: string;
  }[];
  arloNudge: string;
};

function taskLiveStatus(
  task: WeeklyTask,
  dayIndexNow: number,
): WeeklyTaskStatus {
  if (
    task.status === WeeklyTaskStatus.Done ||
    task.status === WeeklyTaskStatus.Skipped ||
    task.status === WeeklyTaskStatus.Missed
  ) {
    return task.status;
  }
  if (task.dayIndex === dayIndexNow) return WeeklyTaskStatus.Today;
  if (task.dayIndex < dayIndexNow) return WeeklyTaskStatus.Missed;
  return WeeklyTaskStatus.Upcoming;
}

export function toWeekCurrentDto(input: {
  plan: WeeklyPlan;
  tasks: WeeklyTask[];
  weeklyStreak: number;
  dayIndexNow: number;
  arloNudge?: string;
}): WeekCurrentDto {
  const { plan, tasks, weeklyStreak, dayIndexNow } = input;
  const hoursDone = num(plan.hoursDone);
  const hoursPlanned = num(plan.hoursPlanned);
  const sealed = plan.status === WeeklyPlanStatus.Sealed;
  const left = sessionsLeft(plan.sessionsPlanned, plan.sessionsDone);
  const onTrack = computeOnTrack({
    sealed,
    sessionsDone: plan.sessionsDone,
    sessionsPlanned: plan.sessionsPlanned,
    dayIndex: dayIndexNow,
  });

  const doneDays = new Set<number>();
  const minutesPlanned = Array.from({ length: 7 }, () => 0);
  const minutesDone = Array.from({ length: 7 }, () => 0);

  for (const task of tasks) {
    minutesPlanned[task.dayIndex] += task.minutes;
    if (task.status === WeeklyTaskStatus.Done) {
      doneDays.add(task.dayIndex);
      minutesDone[task.dayIndex] += task.minutes;
    }
  }

  const remaining = tasks.filter(
    (t) =>
      t.status !== WeeklyTaskStatus.Done &&
      t.status !== WeeklyTaskStatus.Skipped,
  );
  const estimateMinutes = remaining.reduce((sum, t) => sum + t.minutes, 0);

  const streakDays = DAY_LABELS.map((label, i) => ({
    label,
    status: (doneDays.has(i) ? 'done' : 'empty') as 'done' | 'empty',
  }));

  const days = DAY_LABELS.map((label, i) => {
    let status: 'done' | 'empty' | 'today' = doneDays.has(i)
      ? 'done'
      : 'empty';
    if (status === 'empty' && i === dayIndexNow) status = 'today';
    return {
      label,
      full: DAY_FULL[i],
      status,
      minutesPlanned: minutesPlanned[i],
      minutesDone: minutesDone[i],
    };
  });

  const sorted = [...tasks].sort(
    (a, b) => a.dayIndex - b.dayIndex || a.sortOrder - b.sortOrder,
  );

  const sealedWeek = sealed ? weeklyStreak : weeklyStreak;
  // Flame shows sealed count; target is next seal
  const nudge =
    input.arloNudge ??
    defaultNudge({
      sealed,
      weeks: weeklyStreak,
      sessionsLeft: left,
      onTrack,
    });

  return {
    weekLabel: 'Week commitment',
    rangeLabel: rangeLabel(plan.weekStart),
    weekStart: plan.weekStart,
    targetWeek: targetWeek(weeklyStreak, sealed),
    sealed,
    sessionsLeft: left,
    estimateMinutes,
    replanHref: '/week',
    progress: {
      percent: progressPercent(
        hoursDone,
        hoursPlanned,
        plan.sessionsDone,
        plan.sessionsPlanned,
      ),
      hoursDone: round1(hoursDone),
      hoursPlanned: round1(hoursPlanned),
      sessionsDone: plan.sessionsDone,
      sessionsPlanned: plan.sessionsPlanned,
      onTrack,
      lockRewardXp: plan.lockRewardXp,
      lockRewardGems: plan.lockRewardGems,
    },
    streak: {
      weeks: sealedWeek,
      days: streakDays,
    },
    days,
    tasks: sorted.map((t) => ({
      id: t.id,
      dayLabel: DAY_LABELS[t.dayIndex] ?? `D${t.dayIndex}`,
      title: t.title,
      track: t.track,
      minutes: t.minutes,
      xp: t.xpReward,
      status: taskLiveStatus(t, dayIndexNow),
      href: t.href ?? undefined,
    })),
    arloNudge: nudge,
  };
}

function defaultNudge(input: {
  sealed: boolean;
  weeks: number;
  sessionsLeft: number;
  onTrack: boolean;
}): string {
  if (input.sealed) {
    return `Week ${input.weeks} sealed. Rest or peek next week's plan — no guilt.`;
  }
  if (!input.onTrack) {
    return `You're a session behind — replan the rest of the week. ${input.sessionsLeft} left to seal week ${input.weeks + 1}.`;
  }
  if (input.sessionsLeft === 1) {
    return `One session left to lock week ${input.weeks + 1}. Sunday can flex.`;
  }
  return `${input.sessionsLeft} sessions left this week. Keep the flame going.`;
}
