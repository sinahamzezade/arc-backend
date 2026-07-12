import { Injectable, Optional } from '@nestjs/common';
import { ContentQueryService } from '../content-pool/content-query.service';
import type { LessonVersionBody } from '../content-pool/entities/lesson-version.entity';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import { LessonTemplate } from '../skill-graph/entities/lesson-template.entity';
import {
  isPlayOutline,
  type LessonContentBlock,
  type LessonContentPage,
  type LessonPlayOutline,
} from './lesson-play.types';
import { buildDefaultPlayOutline } from './play-outline.factory';

export type ResolvedPlayOutline = {
  outline: LessonPlayOutline;
  contentVersionId: string;
  contentSchemaVersion: number;
  source: 'play_content' | 'lesson_version' | 'template_outline' | 'default';
};

@Injectable()
export class LessonContentService {
  constructor(
    @Optional() private readonly contentQuery?: ContentQueryService,
  ) {}

  /**
   * Sync resolve (legacy / tests). Prefer resolveAuthoritative for play APIs.
   */
  resolveOutline(
    lesson: Lesson,
    template: LessonTemplate | null | undefined,
  ): LessonPlayOutline {
    if (isPlayOutline(lesson.playContent)) {
      return lesson.playContent;
    }
    if (template && isPlayOutline(template.contentOutline)) {
      return template.contentOutline as LessonPlayOutline;
    }
    return buildDefaultPlayOutline({
      title: lesson.title,
      missionName: lesson.missionName,
      lessonType: lesson.lessonType,
    });
  }

  /**
   * Prefer published LessonVersion body → play_content → template outline → default.
   * Pins contentVersionId to the version used (never newest draft).
   */
  async resolveAuthoritative(
    lesson: Lesson,
    template: LessonTemplate | null | undefined,
    pinnedVersionId?: string | null,
  ): Promise<ResolvedPlayOutline> {
    // 1) Explicit pin (attempt's snapshotted version) OR lesson instance pin
    const pin = pinnedVersionId ?? lesson.sourceVersionId;
    if (pin && this.contentQuery) {
      const version = await this.contentQuery.getLessonVersionById(pin);
      if (version) {
        const mapped = this.mapBodyToOutline(
          version.body,
          lesson,
          template,
          version.schemaVersion,
        );
        if (mapped) {
          return {
            outline: mapped,
            contentVersionId: version.id,
            contentSchemaVersion: version.schemaVersion,
            source: 'lesson_version',
          };
        }
      }
    }

    // 2) Personalization override on lesson row
    if (isPlayOutline(lesson.playContent)) {
      return {
        outline: lesson.playContent,
        contentVersionId:
          pinnedVersionId ??
          template?.publishedVersionId ??
          lesson.lessonTemplateId ??
          lesson.id,
        contentSchemaVersion: 1,
        source: 'play_content',
      };
    }

    // 3) Published content-pool version for template
    if (template?.id && this.contentQuery) {
      try {
        const playable = await this.contentQuery.getPlayableLessonVersion(
          template.id,
        );
        const mapped = this.mapBodyToOutline(
          playable.body,
          lesson,
          template,
          playable.version ?? 1,
        );
        if (mapped) {
          return {
            outline: mapped,
            contentVersionId:
              playable.lessonVersionId ??
              template.publishedVersionId ??
              template.id,
            contentSchemaVersion:
              typeof playable.body === 'object' &&
              playable.body &&
              'schemaVersion' in playable.body &&
              typeof (playable.body as { schemaVersion?: unknown })
                .schemaVersion === 'number'
                ? ((playable.body as { schemaVersion: number }).schemaVersion)
                : 1,
            source: playable.lessonVersionId
              ? 'lesson_version'
              : 'template_outline',
          };
        }
      } catch {
        /* fall through to outline */
      }
    }

    // 4) Template jsonb outline
    if (template && isPlayOutline(template.contentOutline)) {
      return {
        outline: template.contentOutline as LessonPlayOutline,
        contentVersionId:
          template.publishedVersionId ?? template.id ?? lesson.id,
        contentSchemaVersion: 1,
        source: 'template_outline',
      };
    }

    // 5) Default synth (last resort — content not ready ideally 422)
    const outline = buildDefaultPlayOutline({
      title: lesson.title,
      missionName: lesson.missionName,
      lessonType: lesson.lessonType,
    });
    return {
      outline,
      contentVersionId: lesson.id,
      contentSchemaVersion: 1,
      source: 'default',
    };
  }

  /** Public play payload — no correct keys / explanations. */
  toPublicPlayBody(outline: LessonPlayOutline) {
    return {
      objective: outline.objective,
      arloPrompt: outline.arloPrompt,
      suggestedArlo: outline.suggestedArlo ?? [],
      content: outline.content,
      practice: {
        id: outline.practice.id,
        prompt: outline.practice.prompt,
        hint: outline.practice.hint,
        options: outline.practice.options.map((o) => ({
          id: o.id,
          label: o.label,
        })),
      },
      quiz: outline.quiz.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        options: q.options.map((o) => ({ id: o.id, label: o.label })),
      })),
    };
  }

  /** Validate option/question IDs exist on this outline version. */
  hasValidAnswerIds(
    outline: LessonPlayOutline,
    input: {
      practiceOptionId?: string | null;
      quizAnswers?: Record<string, string>;
    },
  ): boolean {
    if (input.practiceOptionId) {
      const ok = outline.practice.options.some(
        (o) => o.id === input.practiceOptionId,
      );
      if (!ok) return false;
    }
    if (input.quizAnswers) {
      for (const [qid, oid] of Object.entries(input.quizAnswers)) {
        const q = outline.quiz.find((x) => x.id === qid);
        if (!q || !q.options.some((o) => o.id === oid)) return false;
      }
    }
    return true;
  }

  gemsForDifficulty(difficulty: string): number {
    switch ((difficulty || 'beginner').toLowerCase()) {
      case 'easy':
      case 'beginner':
        return 2;
      case 'medium':
      case 'intermediate':
        return 3;
      case 'hard':
      case 'advanced':
        return 5;
      case 'expert':
        return 8;
      default:
        return 2;
    }
  }

  private mapBodyToOutline(
    body: unknown,
    lesson: Lesson,
    template: LessonTemplate | null | undefined,
    schemaVersion: number,
  ): LessonPlayOutline | null {
    if (isPlayOutline(body)) return body;

    const fallback =
      template && isPlayOutline(template.contentOutline)
        ? (template.contentOutline as LessonPlayOutline)
        : null;

    // LessonVersionBody schema v2: sections + practiceIds/quizIds
    if (body && typeof body === 'object') {
      const b = body as Partial<LessonVersionBody> & Record<string, unknown>;
      if (Array.isArray(b.sections) && b.sections.length > 0) {
        const content: LessonContentPage[] = b.sections.map((s) => ({
          id: String(s.id),
          title: String(s.title),
          blocks: (s.blocks ?? [])
            .map((block) => this.normalizeBlock(block))
            .filter((x): x is LessonContentBlock => Boolean(x)),
        }));

        if (fallback) {
          return {
            ...fallback,
            objective:
              typeof b.objective === 'string' ? b.objective : fallback.objective,
            content: content.length ? content : fallback.content,
          };
        }

        if (content.length && content.some((c) => c.blocks.length)) {
          const base = buildDefaultPlayOutline({
            title: lesson.title,
            missionName: lesson.missionName,
            lessonType: lesson.lessonType,
          });
          return {
            ...base,
            objective:
              typeof b.objective === 'string' ? b.objective : base.objective,
            content,
          };
        }
      }
    }

    return fallback;
  }

  private normalizeBlock(block: Record<string, unknown>): LessonContentBlock | null {
    const type = String(block.type ?? '');
    if (type === 'text' && typeof block.body === 'string') {
      return { type: 'text', body: block.body };
    }
    if (
      type === 'callout' &&
      typeof block.title === 'string' &&
      typeof block.body === 'string'
    ) {
      return { type: 'callout', title: block.title, body: block.body };
    }
    if (
      type === 'code' &&
      typeof block.label === 'string' &&
      typeof block.code === 'string'
    ) {
      return { type: 'code', label: block.label, code: block.code };
    }
    return null;
  }
}
