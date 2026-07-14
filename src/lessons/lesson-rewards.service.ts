import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Profile } from '../profiles/entities/profile.entity';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import { LessonProgress } from '../roadmaps/entities/lesson-progress.entity';
import {
  AssistanceLevel,
  actionKindFromLessonType,
  type LessonActionKind,
} from '../gamification/reward-calculator.constants';
import { RewardCalculatorService } from '../gamification/reward-calculator.service';
import type { LessonPlayOutline } from './lesson-play.types';

export type ComputedReward = {
  xp: number;
  gems: number;
  coins: number;
  badgeId?: string;
  badgeLabel?: string;
  arloLine: string;
  firstTime: boolean;
  calcMetadata?: Record<string, unknown>;
};

@Injectable()
export class LessonRewardsService {
  constructor(private readonly calculator: RewardCalculatorService) {}

  computeReward(input: {
    lesson: Lesson;
    outline: LessonPlayOutline;
    quizCorrect: number;
    quizTotal: number;
    alreadyCompleted: boolean;
    isFirstLessonEver: boolean;
    pathPercentile?: number;
    assistance?: AssistanceLevel;
    attemptKind?: 'first' | 'review_7d' | 'review_later' | 'after_solution';
    weeklyOnTrack?: boolean;
    actionKind?: LessonActionKind;
    conceptsMastered?: number;
    conceptsTotal?: number;
    remediationRoundsUsed?: number;
    hasShakyConcepts?: boolean;
  }): ComputedReward {
    const { lesson, outline, quizCorrect, quizTotal, alreadyCompleted } =
      input;

    if (alreadyCompleted) {
      return {
        xp: 0,
        gems: 0,
        coins: 0,
        arloLine:
          outline.reward?.arloLine ??
          `“${lesson.title}” stays on the map — no double loot.`,
        firstTime: false,
      };
    }

    const rewardClass =
      lesson.rewardClassSnapshot ??
      lesson.lessonTemplate?.rewardClass ??
      outline.rewardPresentation?.rewardClass ??
      undefined;

    const actionKind =
      input.actionKind ??
      actionKindFromLessonType(lesson.lessonType, rewardClass);

    let assistance = input.assistance ?? 'none';
    // Remediation counts as assistance (like hints) — §16.5
    if ((input.remediationRoundsUsed ?? 0) > 0 && assistance === 'none') {
      assistance = 'hint';
    }

    const calc = this.calculator.compute({
      actionKind,
      modality: lesson.lessonType,
      title: lesson.title,
      track: lesson.missionName ?? undefined,
      rewardClass,
      estimatedMinutes: lesson.estimatedMinutes,
      difficulty: lesson.difficulty,
      pathPercentile: input.pathPercentile,
      quizCorrect,
      quizTotal,
      assistance,
      attemptKind: input.attemptKind ?? 'first',
      weeklyOnTrack: input.weeklyOnTrack,
      isFirstLessonEver: input.isFirstLessonEver,
      conceptsMastered: input.conceptsMastered,
      conceptsTotal: input.conceptsTotal,
      remediationRoundsUsed: input.remediationRoundsUsed,
      hasShakyConcepts: input.hasShakyConcepts,
    });

    let badgeId = outline.reward?.badgeId ?? undefined;
    let badgeLabel = outline.reward?.badgeLabel ?? undefined;
    if (input.isFirstLessonEver) {
      badgeId = 'first-step';
      badgeLabel = 'First Step';
    } else if (badgeId === 'first-step') {
      badgeId = undefined;
      badgeLabel = undefined;
    }

    // Shaky concepts withhold perfect-run / mastery badges (not first-step)
    if (input.hasShakyConcepts && badgeId && badgeId !== 'first-step') {
      badgeId = undefined;
      badgeLabel = undefined;
    }

    return {
      xp: calc.xp,
      gems: calc.gems,
      coins: calc.coins,
      badgeId: badgeId ?? undefined,
      badgeLabel: badgeLabel ?? undefined,
      arloLine:
        outline.reward?.arloLine ??
        outline.rewardPresentation?.arloLine ??
        `Nice — “${lesson.title}” is on the map now.`,
      firstTime: calc.firstTime,
      calcMetadata: calc.metadata,
    };
  }

  previewReward(input: {
    lesson: Lesson;
    outline: LessonPlayOutline;
    isFirstLessonEver: boolean;
    pathPercentile?: number;
  }) {
    return this.computeReward({
      ...input,
      quizCorrect: input.outline.quiz.length,
      quizTotal: input.outline.quiz.length,
      alreadyCompleted: false,
    });
  }

  mapAssistance(assistanceUsed?: Record<string, unknown> | null): AssistanceLevel {
    if (!assistanceUsed) return 'none';
    if (Number(assistanceUsed.solutionCount ?? 0) > 0) return 'solution';
    if (Number(assistanceUsed.removeOptionsCount ?? 0) > 0) {
      return 'remove_options';
    }
    if (Number(assistanceUsed.premiumHintCount ?? 0) > 0) {
      return 'premium_hint';
    }
    if (Number(assistanceUsed.hintCount ?? 0) > 0) return 'hint';
    return 'none';
  }

  async applyReward(
    manager: EntityManager,
    userId: string,
    progress: LessonProgress,
    reward: ComputedReward,
  ): Promise<{
    totalXp: number;
    gems: number;
    coins: number;
    badgeId?: string;
    badgeLabel?: string;
  }> {
    const profileRepo = manager.getRepository(Profile);
    const profile = await profileRepo.findOne({ where: { userId } });
    if (!profile) {
      return {
        totalXp: 0,
        gems: 0,
        coins: 0,
      };
    }

    if (reward.firstTime && (reward.xp > 0 || reward.gems > 0 || reward.coins > 0)) {
      profile.totalXp += reward.xp;
      profile.gems += reward.gems;
      profile.coins += reward.coins;
      await profileRepo.save(profile);

      progress.xpAwarded = reward.xp;
      progress.gemsAwarded = reward.gems;
      progress.coinsAwarded = reward.coins;
    }

    let unlockedBadgeId: string | undefined;
    let unlockedBadgeLabel: string | undefined;

    // Persisted unlocks owned by BadgesModule outbox consumer.
    if (reward.badgeId && reward.badgeLabel) {
      unlockedBadgeId = reward.badgeId;
      unlockedBadgeLabel = reward.badgeLabel;
    }

    return {
      totalXp: profile.totalXp,
      gems: profile.gems,
      coins: profile.coins,
      badgeId: unlockedBadgeId,
      badgeLabel: unlockedBadgeLabel,
    };
  }
}
