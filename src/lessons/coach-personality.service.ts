import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { OUTBOX_COACH_TONE_SELECTED } from '../gamification/reward-constants';
import { OutboxService } from '../gamification/outbox.service';
import { StreakState } from '../gamification/entities/streak-state.entity';
import {
  CoachRelationshipState,
  CoachTone,
} from './entities/coach-relationship-state.entity';

const STREAK_MILESTONES = new Set([7, 30, 100]);
const RAPPORT_PLAYFUL_THRESHOLD = 40;
const INACTIVE_DAYS_WELCOME_BACK = 5;

export type CoachToneContext = {
  inactiveDays?: number;
  dailyStreak?: number;
  justFailed?: boolean;
  recentCompletion?: boolean;
  rapportScore?: number;
};

@Injectable()
export class CoachPersonalityService {
  constructor(
    @InjectRepository(CoachRelationshipState)
    private readonly stateRepo: Repository<CoachRelationshipState>,
    @InjectRepository(StreakState)
    private readonly streakRepo: Repository<StreakState>,
    private readonly outbox: OutboxService,
    private readonly dataSource: DataSource,
  ) {}

  async getOrCreate(userId: string): Promise<CoachRelationshipState> {
    let state = await this.stateRepo.findOne({ where: { userId } });
    if (state) return state;

    state = this.stateRepo.create({
      userId,
      rapportScore: 0,
      lastTone: 'steady',
      runningJokes: [],
      lastActiveAt: null,
    });
    return this.stateRepo.save(state);
  }

  async buildToneContext(userId: string): Promise<CoachToneContext> {
    const [state, streak] = await Promise.all([
      this.getOrCreate(userId),
      this.streakRepo.findOne({ where: { userId } }),
    ]);

    let inactiveDays = 0;
    if (state.lastActiveAt) {
      inactiveDays = Math.floor(
        (Date.now() - state.lastActiveAt.getTime()) / (24 * 60 * 60 * 1000),
      );
    }

    return {
      inactiveDays,
      dailyStreak: streak?.dailyStreak ?? 0,
      rapportScore: state.rapportScore,
    };
  }

  selectTone(ctx: CoachToneContext): CoachTone {
    if ((ctx.inactiveDays ?? 0) > INACTIVE_DAYS_WELCOME_BACK) {
      return 'welcome_back';
    }
    if (
      ctx.dailyStreak != null &&
      STREAK_MILESTONES.has(ctx.dailyStreak)
    ) {
      return 'playful';
    }
    if (
      (ctx.rapportScore ?? 0) >= RAPPORT_PLAYFUL_THRESHOLD &&
      ctx.recentCompletion
    ) {
      return 'playful';
    }
    if (ctx.justFailed) {
      return 'encouraging';
    }
    return 'steady';
  }

  tonePromptLine(tone: CoachTone): string {
    switch (tone) {
      case 'welcome_back':
        return 'Tone: warm welcome-back — acknowledge their return without guilt.';
      case 'playful':
        return 'Tone: playful and celebratory — light humor, momentum-focused.';
      case 'encouraging':
        return 'Tone: encouraging — normalize struggle, suggest a smaller next step.';
      default:
        return 'Tone: steady and supportive — clear, calm coaching.';
    }
  }

  async selectAndPersistTone(
    userId: string,
    ctx: CoachToneContext,
    manager?: EntityManager,
  ): Promise<CoachTone> {
    const tone = this.selectTone(ctx);
    const repo = manager
      ? manager.getRepository(CoachRelationshipState)
      : this.stateRepo;

    let state = await repo.findOne({ where: { userId } });
    if (!state) {
      state = repo.create({
        userId,
        rapportScore: 0,
        lastTone: tone,
        runningJokes: [],
        lastActiveAt: new Date(),
      });
    } else {
      state.lastTone = tone;
      state.lastActiveAt = new Date();
    }
    await repo.save(state);

    const emitOutbox = async (em: EntityManager) => {
      await this.outbox.enqueue(em, {
        type: OUTBOX_COACH_TONE_SELECTED,
        aggregateId: userId,
        payload: { userId, tone, rapportScore: state.rapportScore },
      });
    };

    if (manager) {
      await emitOutbox(manager);
    } else {
      await this.dataSource.transaction(emitOutbox);
    }

    return tone;
  }

  async updateRapport(
    userId: string,
    event: 'completion' | 'failure' | 'streak',
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager
      ? manager.getRepository(CoachRelationshipState)
      : this.stateRepo;
    const state = await this.getOrCreate(userId);

    switch (event) {
      case 'completion':
        state.rapportScore = Math.min(100, state.rapportScore + 2);
        break;
      case 'failure':
        state.rapportScore = Math.max(0, state.rapportScore - 1);
        break;
      case 'streak':
        state.rapportScore = Math.min(100, state.rapportScore + 1);
        break;
    }
    state.lastActiveAt = new Date();
    await repo.save(state);
  }
}
