import { Injectable } from '@nestjs/common';
import { Lesson } from '../roadmaps/entities/lesson.entity';
import { LessonTemplate } from '../skill-graph/entities/lesson-template.entity';
import {
  isPlayOutline,
  type LessonPlayOutline,
} from './lesson-play.types';
import { buildDefaultPlayOutline } from './play-outline.factory';

@Injectable()
export class LessonContentService {
  /**
   * Resolve full outline with grading keys.
   * Prefer lesson.playContent → template.contentOutline → default builder.
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
}
