import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Profile, QuestionnaireStatus } from './entities/profile.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';

@Injectable()
export class ProfilesService {
  constructor(
    @InjectRepository(Profile)
    private readonly profilesRepo: Repository<Profile>,
  ) {}

  async createEmpty(userId: string): Promise<Profile> {
    const profile = this.profilesRepo.create({
      userId,
      language: 'en',
      totalXp: 0,
      coins: 0,
      gems: 0,
      weeklyStreak: 0,
      questionnaireStatus: QuestionnaireStatus.NotStarted,
      questionnaireCompletedAt: null,
      onboardingCompletedAt: null,
    });
    return this.profilesRepo.save(profile);
  }

  async markQuestionnaireInProgress(userId: string): Promise<Profile> {
    const profile = await this.requireProfile(userId);
    if (profile.questionnaireStatus === QuestionnaireStatus.NotStarted) {
      profile.questionnaireStatus = QuestionnaireStatus.InProgress;
      return this.profilesRepo.save(profile);
    }
    return profile;
  }

  async markQuestionnaireCompleted(userId: string): Promise<Profile> {
    const profile = await this.requireProfile(userId);
    const now = new Date();
    profile.questionnaireStatus = QuestionnaireStatus.Completed;
    profile.questionnaireCompletedAt = now;
    profile.onboardingCompletedAt = profile.onboardingCompletedAt ?? now;
    return this.profilesRepo.save(profile);
  }

  private async requireProfile(userId: string): Promise<Profile> {
    const profile = await this.findByUserId(userId);
    if (!profile) {
      throw new AppException(
        AuthErrorCode.UNAUTHORIZED,
        'Profile not found',
        HttpStatus.NOT_FOUND,
      );
    }
    return profile;
  }

  findByUserId(userId: string): Promise<Profile | null> {
    return this.profilesRepo.findOne({ where: { userId } });
  }

  /** Server-owned: grant lesson/seal XP + gems (+ optional coins). */
  async applyRewards(
    userId: string,
    input: { xp?: number; gems?: number; coins?: number; streakDelta?: number },
  ): Promise<Profile> {
    const profile = await this.requireProfile(userId);
    if (input.xp) profile.totalXp += Math.max(0, Math.floor(input.xp));
    if (input.gems) profile.gems += Math.max(0, Math.floor(input.gems));
    if (input.coins) profile.coins += Math.max(0, Math.floor(input.coins));
    if (input.streakDelta) {
      profile.weeklyStreak = Math.max(
        0,
        profile.weeklyStreak + Math.floor(input.streakDelta),
      );
    }
    return this.profilesRepo.save(profile);
  }

  /** Debit coins inside an open transaction. Throws if balance too low. */
  async debitCoins(
    manager: EntityManager,
    userId: string,
    amount: number,
  ): Promise<Profile> {
    const profile = await manager.getRepository(Profile).findOne({
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!profile) {
      throw new AppException(
        AuthErrorCode.UNAUTHORIZED,
        'Profile not found',
        HttpStatus.NOT_FOUND,
      );
    }
    const debit = Math.max(0, Math.floor(amount));
    if (profile.coins < debit) {
      throw new AppException(
        AuthErrorCode.BATTLE_INSUFFICIENT_COINS,
        'Insufficient coins',
        HttpStatus.BAD_REQUEST,
      );
    }
    profile.coins -= debit;
    return manager.getRepository(Profile).save(profile);
  }

  /** Credit coins inside an open transaction. */
  async creditCoins(
    manager: EntityManager,
    userId: string,
    amount: number,
  ): Promise<Profile> {
    const profile = await manager.getRepository(Profile).findOne({
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!profile) {
      throw new AppException(
        AuthErrorCode.UNAUTHORIZED,
        'Profile not found',
        HttpStatus.NOT_FOUND,
      );
    }
    profile.coins += Math.max(0, Math.floor(amount));
    return manager.getRepository(Profile).save(profile);
  }

  /** Apply XP/coins inside an open transaction (battle rewards). */
  async applyRewardsInTx(
    manager: EntityManager,
    userId: string,
    input: { xp?: number; coins?: number },
  ): Promise<Profile> {
    const profile = await manager.getRepository(Profile).findOne({
      where: { userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!profile) {
      throw new AppException(
        AuthErrorCode.UNAUTHORIZED,
        'Profile not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (input.xp) profile.totalXp += Math.max(0, Math.floor(input.xp));
    if (input.coins) profile.coins += Math.max(0, Math.floor(input.coins));
    return manager.getRepository(Profile).save(profile);
  }

  async resetWeeklyStreak(userId: string): Promise<Profile> {
    const profile = await this.requireProfile(userId);
    profile.weeklyStreak = 0;
    return this.profilesRepo.save(profile);
  }

  async updateForUser(userId: string, dto: UpdateProfileDto): Promise<Profile> {
    const profile = await this.findByUserId(userId);
    if (!profile) {
      throw new AppException(
        AuthErrorCode.UNAUTHORIZED,
        'Profile not found',
        HttpStatus.NOT_FOUND,
      );
    }

    if (dto.username !== undefined) {
      const normalized = dto.username.trim().toLowerCase();
      if (normalized) {
        const taken = await this.profilesRepo.findOne({
          where: { username: normalized },
        });
        if (taken && taken.userId !== userId) {
          throw new AppException(
            AuthErrorCode.USERNAME_TAKEN,
            'Username is already taken',
            HttpStatus.CONFLICT,
          );
        }
        profile.username = normalized;
      } else {
        profile.username = null;
      }
    }

    if (dto.displayName !== undefined) {
      profile.displayName = dto.displayName.trim() || null;
    }
    if (dto.timezone !== undefined) {
      profile.timezone = dto.timezone.trim() || null;
    }
    if (dto.language !== undefined) {
      profile.language = dto.language.trim() || 'en';
    }

    return this.profilesRepo.save(profile);
  }
}
