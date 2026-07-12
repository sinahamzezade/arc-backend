import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LessonTemplate } from '../skill-graph/entities/lesson-template.entity';
import { ContentAnalyticsService } from './content-analytics.service';
import { QuestionTemplate } from './entities/question-template.entity';

export type LessonQualitySample = {
  lessonTemplateId: string;
  completed: boolean;
  durationMs: number;
  estimatedMinutes: number;
  quizPassed?: boolean;
  hintUsed?: boolean;
  rating?: number;
};

export type BattleDiscriminationSample = {
  questionTemplateId: string;
  correct: boolean;
  responseMs: number;
};

/**
 * Aggregates quality signals and flags content for human review (no auto-retire).
 */
@Injectable()
export class ContentQualityService {
  constructor(
    private readonly analytics: ContentAnalyticsService,
    @InjectRepository(LessonTemplate)
    private readonly lessonsRepo: Repository<LessonTemplate>,
    @InjectRepository(QuestionTemplate)
    private readonly questionsRepo: Repository<QuestionTemplate>,
  ) {}

  async recordLessonSample(sample: LessonQualitySample): Promise<void> {
    const template = await this.lessonsRepo.findOne({
      where: { id: sample.lessonTemplateId },
    });
    if (!template) return;

    const flags = new Set(template.contentSafetyFlags ?? []);
    const estimatedMs = Math.max(1, sample.estimatedMinutes * 60_000);
    const ratio = sample.durationMs / estimatedMs;

    if (sample.completed && ratio > 2.5) {
      flags.add('slow_completion');
    }
    if (sample.hintUsed) {
      flags.add('high_hint_use');
    }
    if (sample.quizPassed === false) {
      flags.add('low_quiz_pass');
    }
    if (sample.rating != null && sample.rating <= 2) {
      flags.add('low_rating');
    }

    const shouldFlag =
      flags.has('low_quiz_pass') ||
      flags.has('low_rating') ||
      (flags.has('slow_completion') && flags.has('high_hint_use'));

    if (shouldFlag && !flags.has('flag_for_review')) {
      flags.add('flag_for_review');
      this.analytics.emit('content_quality_flagged', {
        entityType: 'lesson_template',
        entityId: template.id,
        flags: [...flags],
      });
    }

    template.contentSafetyFlags = [...flags];
    const quality = Number(template.qualityScore ?? 0.7);
    let next = quality;
    if (sample.quizPassed === false) next -= 0.02;
    if (sample.quizPassed === true) next += 0.01;
    if (sample.rating != null) {
      next = next * 0.9 + (sample.rating / 5) * 0.1;
    }
    template.qualityScore = String(
      Math.max(0.1, Math.min(1, Number(next.toFixed(2)))),
    );
    await this.lessonsRepo.save(template);
  }

  async recordBattleSample(sample: BattleDiscriminationSample): Promise<void> {
    const template = await this.questionsRepo.findOne({
      where: { id: sample.questionTemplateId },
    });
    if (!template) return;

    const prior = Number(template.discrimination ?? 0.5);
    // Simple running estimate toward 0–1 discrimination proxy.
    const hit = sample.correct ? 1 : 0;
    const next = prior * 0.95 + hit * 0.05;
    template.discrimination = String(Number(next.toFixed(3)));

    const quality = Number(template.qualityScore ?? 0.7);
    template.qualityScore = String(
      Math.max(
        0.1,
        Math.min(1, Number((quality * 0.98 + next * 0.02).toFixed(2))),
      ),
    );

    if (next < 0.15 || next > 0.95) {
      // Extremely easy/hard — flag, do not retire.
      this.analytics.emit('content_quality_flagged', {
        entityType: 'question_template',
        entityId: template.id,
        discrimination: next,
      });
    }

    await this.questionsRepo.save(template);
  }
}
