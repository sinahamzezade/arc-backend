import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job, Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { LlmService } from '../common/llm/llm.service';
import { SkillGraphService } from '../skill-graph/skill-graph.service';
import { Roadmap } from './entities/roadmap.entity';
import type { RoadmapNextAction } from './entities/roadmap-completion-event.entity';
import { parseRoadmapCompletionCoachResponse } from './roadmap-completion-coach.schema';
import { RoadmapCompletionService } from './roadmap-completion.service';

export const ROADMAP_COMPLETION_COACH_QUEUE = 'roadmap_completion_coach';

export type RoadmapCompletionCoachJobData = {
  roadmapId: string;
  userId: string;
};

const MAX_ATTEMPTS = 3;

@Injectable()
export class RoadmapCompletionCoachProcessor {
  private readonly logger = new Logger(RoadmapCompletionCoachProcessor.name);

  constructor(
    @InjectRepository(Roadmap)
    private readonly roadmapsRepo: Repository<Roadmap>,
    private readonly llm: LlmService,
    private readonly skillGraph: SkillGraphService,
    @Inject(forwardRef(() => RoadmapCompletionService))
    private readonly completion: RoadmapCompletionService,
    @Optional()
    @InjectQueue(ROADMAP_COMPLETION_COACH_QUEUE)
    private readonly queue: Queue<RoadmapCompletionCoachJobData> | null,
  ) {}

  async enqueue(roadmapId: string, userId: string): Promise<void> {
    if (this.queue) {
      await this.queue.add(
        'assess',
        { roadmapId, userId },
        {
          attempts: MAX_ATTEMPTS,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 50,
          jobId: `coach-${roadmapId}`,
        },
      );
      return;
    }
    this.logger.debug(`In-process coach assess roadmap=${roadmapId}`);
    setImmediate(() => {
      void this.processJob({ roadmapId, userId }, 1);
    });
  }

  async processJob(
    data: RoadmapCompletionCoachJobData,
    attempt = 1,
  ): Promise<void> {
    const { roadmapId, userId } = data;
    try {
      const result = await this.runCoach(roadmapId, userId);
      await this.completion.applyCoachResult(roadmapId, result);
    } catch (err) {
      this.logger.warn(
        `Coach assess failed roadmap=${roadmapId} attempt=${attempt}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      if (attempt >= MAX_ATTEMPTS) {
        await this.completion.applyCoachResult(roadmapId, {
          recommendation: 'new_goal',
          rationale:
            'We could not finish a personalized recommendation. Exploring a new goal is a safe next step.',
        });
        return;
      }
      if (!this.queue) {
        await this.processJob(data, attempt + 1);
      } else {
        throw err;
      }
    }
  }

  private async runCoach(
    roadmapId: string,
    userId: string,
  ): Promise<{ recommendation: RoadmapNextAction; rationale: string }> {
    const roadmap = await this.roadmapsRepo.findOne({
      where: { id: roadmapId, userId },
    });
    if (!roadmap?.completionSummary) {
      return {
        recommendation: 'new_goal',
        rationale: 'Completion summary missing — defaulting to a new goal.',
      };
    }

    const availableAdvancedRecipes: string[] = [];
    for (const slug of this.completion.listAdvancedRecipeSlugs(
      roadmap.primaryRoleSlug,
    )) {
      const recipe = await this.skillGraph.findRecipeByRole(slug);
      if (recipe) availableAdvancedRecipes.push(slug);
    }

    const summary = roadmap.completionSummary;
    const payload = {
      role: 'roadmap_completion_coach_v1',
      completedRole: roadmap.primaryRoleSlug,
      targetStage: summary.skillSummary[0]?.target ?? 4,
      skillSummary: summary.skillSummary,
      completionWeeks: summary.completionTimeWeeks,
      availableAdvancedRecipes,
      blockerTags: [] as string[],
    };

    const model = await this.llm.getModel('roadmap_completion_coach');
    const completion = await this.llm.chatCompletion({
      purpose: 'roadmap_completion_coach',
      userId,
      request: {
        model,
        temperature: 0.3,
        max_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              'You are the Arlo roadmap completion coach.',
              'Return JSON only: { "recommendation": "new_goal"|"same_goal_advanced"|"top_up", "rationale": "<one sentence>" }.',
              'Never invent careers, skills, or recipes.',
              'You may only recommend same_goal_advanced when availableAdvancedRecipes is non-empty.',
              'Never claim the learner is job-ready, employable, or cite salary.',
            ].join(' '),
          },
          {
            role: 'user',
            content: JSON.stringify(payload),
          },
        ],
      },
    });

    const rawText = completion.choices[0]?.message?.content ?? '{}';
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      throw new Error('Coach LLM returned non-JSON');
    }

    const validated = parseRoadmapCompletionCoachResponse(parsed);

    let recommendation = validated.recommendation;
    if (
      recommendation === 'same_goal_advanced' &&
      availableAdvancedRecipes.length === 0
    ) {
      recommendation =
        summary.skillsPartial + summary.skillsShaky > 0
          ? 'top_up'
          : 'new_goal';
    }

    return {
      recommendation,
      rationale: validated.rationale,
    };
  }
}

@Processor(ROADMAP_COMPLETION_COACH_QUEUE)
export class RoadmapCompletionCoachBullProcessor extends WorkerHost {
  private readonly logger = new Logger(
    RoadmapCompletionCoachBullProcessor.name,
  );

  constructor(private readonly processor: RoadmapCompletionCoachProcessor) {
    super();
  }

  async process(job: Job<RoadmapCompletionCoachJobData>): Promise<void> {
    this.logger.debug(
      `Coach bull job roadmap=${job.data.roadmapId} attempt=${job.attemptsMade + 1}`,
    );
    await this.processor.processJob(job.data, job.attemptsMade + 1);
  }
}
