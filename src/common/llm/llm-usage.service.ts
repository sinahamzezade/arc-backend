import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type OpenAI from 'openai';
import { Repository } from 'typeorm';
import { LlmUsageEvent } from './entities/llm-usage-event.entity';
import { LLM_PURPOSE_LABELS, type LlmPurpose } from './llm.types';

export type LlmUsagePurposeRow = {
  purpose: LlmPurpose;
  label: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type LlmUsageRecentRow = {
  purpose: LlmPurpose;
  label: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  createdAt: string;
};

export type LlmUsageTotals = {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type LlmUsageReport = {
  hasUsage: boolean;
  hasRecent: boolean;
  totals: LlmUsageTotals;
  byPurpose: LlmUsagePurposeRow[];
  recent: LlmUsageRecentRow[];
};

export type LlmUsageTopUserRow = {
  userId: string;
  email: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type LlmGlobalUsageReport = {
  hasUsage: boolean;
  totals: LlmUsageTotals;
  byPurpose: LlmUsagePurposeRow[];
  topUsers: LlmUsageTopUserRow[];
};

@Injectable()
export class LlmUsageService {
  private readonly logger = new Logger(LlmUsageService.name);

  constructor(
    @InjectRepository(LlmUsageEvent)
    private readonly repo: Repository<LlmUsageEvent>,
  ) {}

  async recordFromCompletion(input: {
    userId?: string | null;
    purpose: LlmPurpose;
    requestedModel: string;
    completion: OpenAI.Chat.ChatCompletion;
  }): Promise<void> {
    try {
      const usage = input.completion.usage;
      const promptTokens = usage?.prompt_tokens ?? 0;
      const completionTokens = usage?.completion_tokens ?? 0;
      const totalTokens =
        usage?.total_tokens ?? promptTokens + completionTokens;
      const model =
        typeof input.completion.model === 'string' && input.completion.model
          ? input.completion.model
          : input.requestedModel;

      await this.repo.save(
        this.repo.create({
          userId: input.userId ?? null,
          purpose: input.purpose,
          model,
          promptTokens,
          completionTokens,
          totalTokens,
          metadata: {
            id: input.completion.id ?? null,
            finishReason: input.completion.choices[0]?.finish_reason ?? null,
          },
        }),
      );
    } catch (err) {
      this.logger.warn(
        `LLM usage record failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async reportForUser(userId: string): Promise<LlmUsageReport> {
    const byPurpose = await this.aggregateByPurpose({ userId });
    const totals = this.sumTotals(byPurpose);

    const recentRows = await this.repo.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 25,
    });

    const recent: LlmUsageRecentRow[] = recentRows.map((e) => ({
      purpose: e.purpose,
      label: LLM_PURPOSE_LABELS[e.purpose] ?? e.purpose,
      model: e.model,
      promptTokens: e.promptTokens,
      completionTokens: e.completionTokens,
      totalTokens: e.totalTokens,
      createdAt: e.createdAt.toISOString().slice(0, 19).replace('T', ' '),
    }));

    return {
      hasUsage: totals.calls > 0,
      hasRecent: recent.length > 0,
      totals,
      byPurpose,
      recent,
    };
  }

  async reportGlobal(topLimit = 5): Promise<LlmGlobalUsageReport> {
    const [byPurpose, topUsers] = await Promise.all([
      this.aggregateByPurpose(),
      this.topUsers(topLimit),
    ]);
    const totals = this.sumTotals(byPurpose);
    return {
      hasUsage: totals.calls > 0,
      totals,
      byPurpose,
      topUsers,
    };
  }

  private async aggregateByPurpose(filter?: {
    userId: string;
  }): Promise<LlmUsagePurposeRow[]> {
    const qb = this.repo
      .createQueryBuilder('e')
      .select('e.purpose', 'purpose')
      .addSelect('COUNT(*)', 'calls')
      .addSelect('COALESCE(SUM(e.prompt_tokens), 0)', 'promptTokens')
      .addSelect('COALESCE(SUM(e.completion_tokens), 0)', 'completionTokens')
      .addSelect('COALESCE(SUM(e.total_tokens), 0)', 'totalTokens')
      .groupBy('e.purpose')
      .orderBy('COALESCE(SUM(e.total_tokens), 0)', 'DESC');

    if (filter?.userId) {
      qb.where('e.user_id = :userId', { userId: filter.userId });
    }

    const agg = await qb.getRawMany<{
      purpose: LlmPurpose;
      calls: string;
      promptTokens: string;
      completionTokens: string;
      totalTokens: string;
    }>();

    return agg.map((row) => ({
      purpose: row.purpose,
      label: LLM_PURPOSE_LABELS[row.purpose] ?? row.purpose,
      calls: Number(row.calls) || 0,
      promptTokens: Number(row.promptTokens) || 0,
      completionTokens: Number(row.completionTokens) || 0,
      totalTokens: Number(row.totalTokens) || 0,
    }));
  }

  private async topUsers(limit: number): Promise<LlmUsageTopUserRow[]> {
    const rows = await this.repo
      .createQueryBuilder('e')
      .innerJoin('e.user', 'u')
      .select('e.user_id', 'userId')
      .addSelect('u.email', 'email')
      .addSelect('COUNT(*)', 'calls')
      .addSelect('COALESCE(SUM(e.prompt_tokens), 0)', 'promptTokens')
      .addSelect('COALESCE(SUM(e.completion_tokens), 0)', 'completionTokens')
      .addSelect('COALESCE(SUM(e.total_tokens), 0)', 'totalTokens')
      .where('e.user_id IS NOT NULL')
      .groupBy('e.user_id')
      .addGroupBy('u.email')
      .orderBy('COALESCE(SUM(e.total_tokens), 0)', 'DESC')
      .addOrderBy('COUNT(*)', 'DESC')
      .limit(limit)
      .getRawMany<{
        userId: string;
        email: string;
        calls: string;
        promptTokens: string;
        completionTokens: string;
        totalTokens: string;
      }>();

    return rows.map((row) => ({
      userId: row.userId,
      email: row.email,
      calls: Number(row.calls) || 0,
      promptTokens: Number(row.promptTokens) || 0,
      completionTokens: Number(row.completionTokens) || 0,
      totalTokens: Number(row.totalTokens) || 0,
    }));
  }

  private sumTotals(byPurpose: LlmUsagePurposeRow[]): LlmUsageTotals {
    return byPurpose.reduce(
      (acc, row) => {
        acc.calls += row.calls;
        acc.promptTokens += row.promptTokens;
        acc.completionTokens += row.completionTokens;
        acc.totalTokens += row.totalTokens;
        return acc;
      },
      { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    );
  }
}
