import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Profile } from '../profiles/entities/profile.entity';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import { LessonProgress } from '../roadmaps/entities/lesson-progress.entity';
import { UserBadge } from './entities/user-badge.entity';
import type { LessonPlayOutline } from './lesson-play.types';
import { LessonContentService } from './lesson-content.service';

export type ComputedReward = {
  xp: number;
  gems: number;
  coins: number;
  badgeId?: string;
  badgeLabel?: string;
  arloLine: string;
  firstTime: boolean;
};

@Injectable()
export class LessonRewardsService {
  constructor(private readonly content: LessonContentService) {}

  computeReward(input: {
    lesson: Lesson;
    outline: LessonPlayOutline;
    quizCorrect: number;
    quizTotal: number;
    alreadyCompleted: boolean;
    isFirstLessonEver: boolean;
  }): ComputedReward {
    const { lesson, outline, quizCorrect, quizTotal, alreadyCompleted } =
      input;
    const perfect = quizTotal > 0 && quizCorrect === quizTotal;

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

    const baseGems =
      outline.reward?.gems ??
      this.content.gemsForDifficulty(lesson.difficulty);
    const gems = baseGems + (perfect ? 2 : 0);
    const coins = outline.reward?.coins ?? 10;
    const xp = lesson.xpReward;

    let badgeId = outline.reward?.badgeId ?? undefined;
    let badgeLabel = outline.reward?.badgeLabel ?? undefined;
    if (input.isFirstLessonEver) {
      badgeId = 'first-step';
      badgeLabel = 'First Step';
    } else if (badgeId === 'first-step') {
      badgeId = undefined;
      badgeLabel = undefined;
    }

    return {
      xp,
      gems,
      coins,
      badgeId: badgeId ?? undefined,
      badgeLabel: badgeLabel ?? undefined,
      arloLine:
        outline.reward?.arloLine ??
        `Nice — “${lesson.title}” is on the map now.`,
      firstTime: true,
    };
  }

  previewReward(input: {
    lesson: Lesson;
    outline: LessonPlayOutline;
    isFirstLessonEver: boolean;
  }) {
    return this.computeReward({
      ...input,
      quizCorrect: input.outline.quiz.length,
      quizTotal: input.outline.quiz.length,
      alreadyCompleted: false,
    });
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

    if (reward.badgeId && reward.badgeLabel) {
      const badgeRepo = manager.getRepository(UserBadge);
      const existing = await badgeRepo.findOne({
        where: { userId, badgeId: reward.badgeId },
      });
      if (!existing) {
        await badgeRepo.save(
          badgeRepo.create({
            userId,
            badgeId: reward.badgeId,
            badgeLabel: reward.badgeLabel,
          }),
        );
        unlockedBadgeId = reward.badgeId;
        unlockedBadgeLabel = reward.badgeLabel;
      }
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
