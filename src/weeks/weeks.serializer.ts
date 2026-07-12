import { DAY_FULL, DAY_LABELS } from './weeks.constants';
import {
  computeOnTrack,
  computeProgressStatus,
  num,
  progressPercent,
  round1,
  sessionsLeft,
  targetWeek,
  type ProgressStatus,
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

export type MissionState =
  | 'start'
  | 'resume'
  | 'almost_done'
  | 'recovery'
  | 'rest_day';

export type WeekCurrentDto = {
  status: WeeklyPlanStatus | 'building';
  weekLabel: string;
  rangeLabel: string;
  weekStart: string;
  windowStartAt: string | null;
  windowEndAt: string | null;
  targetWeek: number;
  sealed: boolean;
  sessionsLeft: number;
  estimateMinutes: number;
  replanHref: string;
  weeklyStreak: number;
  todayMission: {
    taskId: string;
    lessonId: string | null;
    title: string;
    state: MissionState;
    estimatedMinutes: number;
    href: string;
  } | null;
  progress: {
    status: ProgressStatus;
    percent: number;
    hoursDone: number;
    hoursPlanned: number;
    verifiedMinutesDone: number;
    minutesPlanned: number;
    sessionsDone: number;
    sessionsPlanned: number;
    sessionsLeft: number;
    remainingMinutes: number;
    onTrack: boolean;
    lockRewardXp: number;
    lockRewardGems: number;
  };
  sealRewardPreview: { xp: number; gems: number };
  streak: {
    weeks: number;
    days: { label: string; status: 'done' | 'empty' }[];
  };
  days: {
    label: string;
    full: string;
    dayIndex: number;
    status: 'done' | 'empty' | 'today' | 'completed' | 'current' | 'inactive';
    minutesPlanned: number;
    minutesDone: number;
  }[];
  tasks: {
    id: string;
    dayLabel: string;
    dayIndex: number;
    title: string;
    track: string;
    minutes: number;
    xp: number;
    status: WeeklyTaskStatus;
    href?: string;
    lessonId?: string | null;
  }[];
  arloNudge: string;
};

function taskLiveStatus(
  task: WeeklyTask,
  dayIndexNow: number,
  eligibleFromDayIndex = 0,
): WeeklyTaskStatus {
  if (
    task.status === WeeklyTaskStatus.Done ||
    task.status === WeeklyTaskStatus.Skipped ||
    task.status === WeeklyTaskStatus.Missed
  ) {
    return task.status;
  }
  // Pre-join days never count as missed
  if (task.dayIndex < eligibleFromDayIndex) {
    return WeeklyTaskStatus.Skipped;
  }
  if (task.status === WeeklyTaskStatus.Moved) {
    if (task.dayIndex === dayIndexNow) return WeeklyTaskStatus.Today;
    return WeeklyTaskStatus.Upcoming;
  }
  if (task.dayIndex === dayIndexNow) return WeeklyTaskStatus.Today;
  if (task.dayIndex < dayIndexNow) return WeeklyTaskStatus.Missed;
  return WeeklyTaskStatus.Upcoming;
}

function pickTodayMission(
  tasks: WeeklyTask[],
  dayIndexNow: number,
  sealed: boolean,
  eligibleFromDayIndex = 0,
): WeekCurrentDto['todayMission'] {
  if (sealed) return null;
  const live = tasks.map((t) => ({
    task: t,
    status: taskLiveStatus(t, dayIndexNow, eligibleFromDayIndex),
  }));

  const pick =
    live.find((x) => x.status === WeeklyTaskStatus.Today) ??
    live.find(
      (x) =>
        x.status === WeeklyTaskStatus.Missed &&
        x.task.status !== WeeklyTaskStatus.Skipped,
    ) ??
    live.find((x) => x.status === WeeklyTaskStatus.Upcoming) ??
    null;

  if (!pick) {
    return {
      taskId: '',
      lessonId: null,
      title: 'Rest day',
      state: 'rest_day',
      estimatedMinutes: 0,
      href: '/week',
    };
  }

  const openCount = live.filter(
    (x) =>
      x.status !== WeeklyTaskStatus.Done &&
      x.status !== WeeklyTaskStatus.Skipped,
  ).length;

  let state: MissionState = 'start';
  if (pick.status === WeeklyTaskStatus.Missed) state = 'recovery';
  else if (openCount === 1) state = 'almost_done';
  else if (pick.task.dayIndex === dayIndexNow) state = 'resume';

  const href =
    pick.task.href ??
    (pick.task.lessonId ? `/learn/${pick.task.lessonId}` : '/path');

  return {
    taskId: pick.task.id,
    lessonId: pick.task.lessonId,
    title: pick.task.title,
    state,
    estimatedMinutes: pick.task.minutes,
    href,
  };
}

export function toWeekCurrentDto(input: {
  plan: WeeklyPlan;
  tasks: WeeklyTask[];
  weeklyStreak: number;
  dayIndexNow: number;
  /** First day index that counts (join day in this week). */
  eligibleFromDayIndex?: number;
  arloNudge?: string;
}): WeekCurrentDto {
  const { plan, tasks, weeklyStreak, dayIndexNow } = input;
  const eligibleFrom = Math.min(
    6,
    Math.max(0, input.eligibleFromDayIndex ?? 0),
  );
  const hoursDone = num(plan.hoursDone);
  const hoursPlanned = num(plan.hoursPlanned);
  const minutesPlanned =
    plan.minutesPlanned || Math.round(hoursPlanned * 60);
  const verifiedMinutes =
    plan.verifiedMinutesDone || Math.round(hoursDone * 60);
  const sealed = plan.status === WeeklyPlanStatus.Sealed;
  const left = sessionsLeft(plan.sessionsPlanned, plan.sessionsDone);
  const progressStatus = computeProgressStatus({
    sealed,
    sessionsDone: plan.sessionsDone,
    sessionsPlanned: plan.sessionsPlanned,
    dayIndex: dayIndexNow,
    eligibleFromDayIndex: eligibleFrom,
    verifiedMinutesDone: verifiedMinutes,
    minutesPlanned,
  });
  const onTrack = computeOnTrack({
    sealed,
    sessionsDone: plan.sessionsDone,
    sessionsPlanned: plan.sessionsPlanned,
    dayIndex: dayIndexNow,
    eligibleFromDayIndex: eligibleFrom,
  });

  const doneDays = new Set<number>();
  const minutesPlannedByDay = Array.from({ length: 7 }, () => 0);
  const minutesDoneByDay = Array.from({ length: 7 }, () => 0);

  for (const task of tasks) {
    // Don't show planned minutes on pre-join days
    if (task.dayIndex >= eligibleFrom) {
      minutesPlannedByDay[task.dayIndex] += task.minutes;
    }
    if (task.status === WeeklyTaskStatus.Done) {
      doneDays.add(task.dayIndex);
      minutesDoneByDay[task.dayIndex] +=
        task.verifiedMinutes || task.minutes;
    }
  }

  const remaining = tasks.filter((t) => {
    const live = taskLiveStatus(t, dayIndexNow, eligibleFrom);
    return (
      live !== WeeklyTaskStatus.Done && live !== WeeklyTaskStatus.Skipped
    );
  });
  const estimateMinutes = remaining.reduce((sum, t) => sum + t.minutes, 0);

  const streakDays = DAY_LABELS.map((label, i) => ({
    label,
    status: (doneDays.has(i) ? 'done' : 'empty') as 'done' | 'empty',
  }));

  const days = DAY_LABELS.map((label, i) => {
    if (i < eligibleFrom) {
      return {
        label,
        full: DAY_FULL[i],
        dayIndex: i,
        status: 'inactive' as WeekCurrentDto['days'][number]['status'],
        minutesPlanned: 0,
        minutesDone: minutesDoneByDay[i],
      };
    }
    let status: WeekCurrentDto['days'][number]['status'] = doneDays.has(i)
      ? 'completed'
      : 'empty';
    if (doneDays.has(i)) status = 'done';
    if (status === 'empty' && i === dayIndexNow) status = 'current';
    const uiStatus =
      status === 'completed'
        ? 'done'
        : status === 'current'
          ? 'today'
          : status;
    return {
      label,
      full: DAY_FULL[i],
      dayIndex: i,
      status: uiStatus as WeekCurrentDto['days'][number]['status'],
      minutesPlanned: minutesPlannedByDay[i],
      minutesDone: minutesDoneByDay[i],
    };
  });

  const nudge =
    input.arloNudge ??
    defaultNudge({
      sealed,
      weeks: weeklyStreak,
      sessionsLeft: left,
      onTrack,
      progressStatus,
    });

  const todayMission = pickTodayMission(
    tasks,
    dayIndexNow,
    sealed,
    eligibleFrom,
  );

  return {
    status: plan.status,
    weekLabel: 'Week commitment',
    rangeLabel: rangeLabel(plan.weekStart),
    weekStart: plan.weekStart,
    windowStartAt: plan.windowStartAt?.toISOString() ?? null,
    windowEndAt: plan.windowEndAt?.toISOString() ?? null,
    targetWeek: targetWeek(weeklyStreak, sealed),
    sealed,
    sessionsLeft: left,
    estimateMinutes,
    replanHref: '/week',
    weeklyStreak,
    todayMission,
    progress: {
      status: progressStatus,
      percent: progressPercent(
        hoursDone,
        hoursPlanned,
        plan.sessionsDone,
        plan.sessionsPlanned,
      ),
      hoursDone: round1(hoursDone),
      hoursPlanned: round1(hoursPlanned),
      verifiedMinutesDone: verifiedMinutes,
      minutesPlanned,
      sessionsDone: plan.sessionsDone,
      sessionsPlanned: plan.sessionsPlanned,
      sessionsLeft: left,
      remainingMinutes: estimateMinutes,
      onTrack,
      lockRewardXp: plan.lockRewardXp,
      lockRewardGems: plan.lockRewardGems,
    },
    sealRewardPreview: {
      xp: plan.lockRewardXp,
      gems: plan.lockRewardGems,
    },
    streak: {
      weeks: weeklyStreak,
      days: streakDays,
    },
    days,
    tasks: [...tasks]
      .filter((t) => t.dayIndex >= eligibleFrom)
      .sort((a, b) => a.dayIndex - b.dayIndex || a.sortOrder - b.sortOrder)
      .map((t) => ({
        id: t.id,
        dayLabel: DAY_LABELS[t.dayIndex] ?? `D${t.dayIndex}`,
        dayIndex: t.dayIndex,
        title: t.title,
        track: t.track,
        minutes: t.minutes,
        xp: t.xpReward,
        status: taskLiveStatus(t, dayIndexNow, eligibleFrom),
        href:
          t.href ?? (t.lessonId ? `/learn/${t.lessonId}` : undefined),
        lessonId: t.lessonId,
      })),
    arloNudge: nudge,
  };
}

export function buildingWeekDto(input: {
  weekStart: string;
  weeklyStreak: number;
}): WeekCurrentDto {
  return {
    status: 'building',
    weekLabel: 'Building your week',
    rangeLabel: rangeLabel(input.weekStart),
    weekStart: input.weekStart,
    windowStartAt: null,
    windowEndAt: null,
    targetWeek: input.weeklyStreak + 1,
    sealed: false,
    sessionsLeft: 0,
    estimateMinutes: 0,
    replanHref: '/week',
    weeklyStreak: input.weeklyStreak,
    todayMission: null,
    progress: {
      status: 'on_track',
      percent: 0,
      hoursDone: 0,
      hoursPlanned: 0,
      verifiedMinutesDone: 0,
      minutesPlanned: 0,
      sessionsDone: 0,
      sessionsPlanned: 0,
      sessionsLeft: 0,
      remainingMinutes: 0,
      onTrack: true,
      lockRewardXp: 0,
      lockRewardGems: 0,
    },
    sealRewardPreview: { xp: 0, gems: 0 },
    streak: {
      weeks: input.weeklyStreak,
      days: DAY_LABELS.map((label) => ({ label, status: 'empty' as const })),
    },
    days: DAY_LABELS.map((label, i) => ({
      label,
      full: DAY_FULL[i],
      dayIndex: i,
      status: 'empty' as const,
      minutesPlanned: 0,
      minutesDone: 0,
    })),
    tasks: [],
    arloNudge: 'Roadmap still cooking — your week plan lands when Path is ready.',
  };
}

function defaultNudge(input: {
  sealed: boolean;
  weeks: number;
  sessionsLeft: number;
  onTrack: boolean;
  progressStatus: ProgressStatus;
}): string {
  if (input.sealed) {
    return `Week ${input.weeks} sealed. Rest or peek next week's plan — no guilt.`;
  }
  if (input.progressStatus === 'at_risk') {
    return `At risk — replan now. ${input.sessionsLeft} sessions left to seal week ${input.weeks + 1}.`;
  }
  if (!input.onTrack) {
    return `You're a session behind — replan the rest of the week. ${input.sessionsLeft} left to seal week ${input.weeks + 1}.`;
  }
  if (input.sessionsLeft === 1) {
    return `One session left to lock week ${input.weeks + 1}. Sunday can flex.`;
  }
  return `${input.sessionsLeft} sessions left this week. Keep the flame going.`;
}
