import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { QuestDefinition } from './entities/quest-definition.entity';
import {
  QuestCadence,
  QuestConditionType,
  QuestDefinitionStatus,
  type QuestConditionJson,
} from './quest.constants';

export type LeagueQuestProgressContext = {
  breakdown: Record<string, number>;
  activeDays: number;
};

export type LeagueQuestProgressDto = {
  id: string;
  code: string;
  title: string;
  detail: string;
  progress: number;
  goal: number;
  xpReward: number;
  done: boolean;
};

@Injectable()
export class QuestsService {
  constructor(
    @InjectRepository(QuestDefinition)
    private readonly defsRepo: Repository<QuestDefinition>,
  ) {}

  listActiveLeagueQuests() {
    return this.defsRepo.find({
      where: {
        status: QuestDefinitionStatus.Active,
        cadence: In([QuestCadence.Weekly, QuestCadence.Seasonal]),
      },
      order: { sortOrder: 'ASC', code: 'ASC' },
    });
  }

  async progressForLeague(
    ctx: LeagueQuestProgressContext,
  ): Promise<LeagueQuestProgressDto[]> {
    const rows = await this.listActiveLeagueQuests();
    return rows.map((row) => this.toProgressDto(row, ctx));
  }

  toProgressDto(
    row: QuestDefinition,
    ctx: LeagueQuestProgressContext,
  ): LeagueQuestProgressDto {
    const evaluated = this.evaluate(row.conditionType, row.conditionJson, ctx);
    const xpReward =
      row.rewardJson?.leagueXp ??
      row.rewardJson?.xp ??
      0;
    return {
      id: row.id,
      code: row.code,
      title: row.name,
      detail: row.detail || row.description,
      progress: evaluated.progress,
      goal: evaluated.goal,
      xpReward,
      done: evaluated.done,
    };
  }

  private evaluate(
    type: QuestConditionType,
    json: QuestConditionJson,
    ctx: LeagueQuestProgressContext,
  ): { progress: number; goal: number; done: boolean } {
    switch (type) {
      case QuestConditionType.Counter: {
        const target = Math.max(1, Math.floor(json.target ?? 1));
        const current = this.counterValue(json.counterKey ?? '', ctx);
        const progress = Math.min(target, current);
        return { progress, goal: target, done: current >= target };
      }
      case QuestConditionType.LeagueXp: {
        const minXp = Math.max(1, Math.floor(json.minXp ?? 1));
        const xp = this.xpForSource(json.xpSource ?? 'any', ctx.breakdown);
        const unitXp =
          typeof json.unitXp === 'number' && json.unitXp > 0
            ? Math.floor(json.unitXp)
            : null;
        if (unitXp) {
          const goal = Math.max(1, Math.ceil(minXp / unitXp));
          const progress = Math.min(goal, Math.floor(xp / unitXp));
          return { progress, goal, done: xp >= minXp };
        }
        const progress = Math.min(minXp, xp);
        return { progress, goal: minXp, done: xp >= minXp };
      }
      case QuestConditionType.ActiveDays: {
        const minDays = Math.max(1, Math.floor(json.minDays ?? 1));
        const current = Math.max(0, Math.floor(ctx.activeDays));
        const progress = Math.min(minDays, current);
        return { progress, goal: minDays, done: current >= minDays };
      }
      case QuestConditionType.EventOnce: {
        // Event ledger not wired for league progress yet.
        return { progress: 0, goal: 1, done: false };
      }
      default:
        return { progress: 0, goal: 1, done: false };
    }
  }

  private xpForSource(
    source: string,
    breakdown: Record<string, number>,
  ): number {
    if (source === 'any') {
      return Object.values(breakdown).reduce(
        (sum, n) => sum + (Number.isFinite(n) ? n : 0),
        0,
      );
    }
    return Number.isFinite(breakdown[source]) ? breakdown[source]! : 0;
  }

  /**
   * League-context counters — approximate from season XP until a real
   * counter store is wired for quests.
   */
  private counterValue(
    key: string,
    ctx: LeagueQuestProgressContext,
  ): number {
    switch (key) {
      case 'lessons_completed':
        return Math.floor((ctx.breakdown.lesson ?? 0) / 20);
      case 'battle_wins':
        return (ctx.breakdown.battle ?? 0) > 0 ? 1 : 0;
      default:
        return 0;
    }
  }
}
