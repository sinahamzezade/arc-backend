import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { Goal } from '../goals/entities/goal.entity';
import { LessonStatus } from './entities/lesson.entity';
import {
  buildRoadmapAiSystemPrompt,
  buildRoadmapAiUserPrompt,
  ROADMAP_GENERATOR_PROMPT_VERSION,
} from './roadmap-ai.prompt';
import {
  parseAndAssertRoadmapAiEnrich,
  type RoadmapAiAllowLists,
  type RoadmapAiEnrich,
} from './roadmap-ai.schema';
import type { PlannedLesson, PlannedPhase } from './roadmap-plan.types';

export type RoadmapAiEnrichResult = {
  enrich: RoadmapAiEnrich;
  model: string;
  promptVersion: string;
};

export type RoadmapAiSkipResult = {
  enrich: null;
  reason: string;
};

@Injectable()
export class RoadmapAiService {
  private readonly logger = new Logger(RoadmapAiService.name);

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return Boolean(this.config.get<string>('OPENAI_API_KEY')?.trim());
  }

  getModel(): string {
    return (
      this.config.get<string>('OPENAI_ROADMAP_MODEL')?.trim() || 'gpt-4o-mini'
    );
  }

  getPromptVersion(): string {
    return (
      this.config.get<string>('ROADMAP_GENERATOR_PROMPT_VERSION')?.trim() ||
      ROADMAP_GENERATOR_PROMPT_VERSION
    );
  }

  async enrich(input: {
    goal: Goal;
    recipeTitle: string;
    phases: PlannedPhase[];
    allowedResourceIds: string[];
  }): Promise<RoadmapAiEnrichResult | RoadmapAiSkipResult> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    if (!apiKey) {
      return { enrich: null, reason: 'OPENAI_API_KEY unset' };
    }

    const allow = this.buildAllowLists(input.phases, input.allowedResourceIds);
    const model = this.getModel();
    const promptVersion = this.getPromptVersion();

    try {
      const client = new OpenAI({ apiKey });
      const completion = await client.chat.completions.create({
        model,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildRoadmapAiSystemPrompt() },
          {
            role: 'user',
            content: buildRoadmapAiUserPrompt(input),
          },
        ],
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        this.logger.warn('OpenAI returned empty content — soft-fail');
        return { enrich: null, reason: 'empty_response' };
      }

      const raw: unknown = JSON.parse(content);
      const enrich = parseAndAssertRoadmapAiEnrich(raw, allow);
      return { enrich, model, promptVersion };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`OpenAI enrich soft-fail: ${message}`);
      return { enrich: null, reason: message };
    }
  }

  /** Apply validated enrich onto a cloned plan (mutates copy). */
  applyEnrich(
    phases: PlannedPhase[],
    enrich: RoadmapAiEnrich,
  ): { pathTitle?: string; phases: PlannedPhase[] } {
    const nextPhases = phases.map((p) => ({
      ...p,
      milestones: p.milestones.map((m) => ({
        ...m,
        lessons: m.lessons.map((l) => ({ ...l })),
      })),
    }));

    const phaseByKey = new Map(nextPhases.map((p) => [p.key, p]));

    for (const pe of enrich.phases) {
      const phase = phaseByKey.get(pe.key);
      if (!phase) continue;
      if (pe.title) phase.title = pe.title;

      if (pe.milestoneOrder?.length) {
        const bySkill = new Map(phase.milestones.map((m) => [m.skill.id, m]));
        const ordered: PlannedPhase['milestones'] = [];
        for (const id of pe.milestoneOrder) {
          const m = bySkill.get(id);
          if (m) {
            ordered.push(m);
            bySkill.delete(id);
          }
        }
        for (const m of bySkill.values()) ordered.push(m);
        phase.milestones = ordered;
      }

      for (const me of pe.milestones ?? []) {
        const milestone = phase.milestones.find(
          (m) => m.skill.id === me.skillNodeId,
        );
        if (!milestone) continue;
        if (me.title) milestone.title = me.title;

        if (me.lessonOrder?.length) {
          const byTemplate = new Map(
            milestone.lessons.map((l) => [l.template.id, l]),
          );
          const orderedLessons: PlannedLesson[] = [];
          for (const id of me.lessonOrder) {
            const lesson = byTemplate.get(id);
            if (lesson) {
              orderedLessons.push(lesson);
              byTemplate.delete(id);
            }
          }
          for (const lesson of byTemplate.values()) orderedLessons.push(lesson);
          milestone.lessons = orderedLessons;
        }

        for (const le of me.lessons ?? []) {
          const lesson = milestone.lessons.find(
            (l) => l.template.id === le.lessonTemplateId,
          );
          if (!lesson) continue;
          if (le.title) lesson.title = le.title;
          if (le.missionName !== undefined) {
            lesson.missionName = le.missionName;
          }
          if (le.resourceId !== undefined) {
            lesson.resourceId = le.resourceId;
          }
        }
      }
    }

    // Re-apply unlock: first phase unlocked, first lesson available
    return {
      pathTitle: enrich.pathTitle,
      phases: nextPhases.map((p, i) => ({
        ...p,
        orderIndex: i,
        locked: i > 0,
        milestones: p.milestones.map((m, mi) => ({
          ...m,
          lessons: m.lessons.map((l, li) => ({
            ...l,
            status:
              i === 0 && mi === 0 && li === 0
                ? LessonStatus.Available
                : LessonStatus.Locked,
          })),
        })),
      })),
    };
  }

  private buildAllowLists(
    phases: PlannedPhase[],
    allowedResourceIds: string[],
  ): RoadmapAiAllowLists {
    const phaseKeys = new Set<string>();
    const skillNodeIds = new Set<string>();
    const lessonTemplateIds = new Set<string>();
    for (const phase of phases) {
      phaseKeys.add(phase.key);
      for (const m of phase.milestones) {
        skillNodeIds.add(m.skill.id);
        for (const l of m.lessons) {
          lessonTemplateIds.add(l.template.id);
        }
      }
    }
    return {
      phaseKeys,
      skillNodeIds,
      lessonTemplateIds,
      resourceIds: new Set(allowedResourceIds),
    };
  }
}
