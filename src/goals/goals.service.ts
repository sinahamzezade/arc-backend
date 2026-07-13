import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Goal,
  GoalStatus,
} from './entities/goal.entity';
import type {
  QuestionnaireAnswers,
} from '../questionnaire/types/answers';
import {
  asOptionalString,
  asSchedule,
  asString,
  asStringArray,
} from '../questionnaire/types/answers';
import { withOther } from '../questionnaire/questionnaire.validation';

@Injectable()
export class GoalsService {
  constructor(
    @InjectRepository(Goal)
    private readonly goalsRepo: Repository<Goal>,
  ) {}

  findActiveByUserId(userId: string): Promise<Goal | null> {
    return this.goalsRepo.findOne({
      where: { userId, status: GoalStatus.Active },
      order: { updatedAt: 'DESC' },
    });
  }

  findById(id: string): Promise<Goal | null> {
    return this.goalsRepo.findOne({ where: { id } });
  }

  async upsertActiveFromAnswers(
    userId: string,
    answers: QuestionnaireAnswers,
  ): Promise<Goal> {
    const existing = await this.findActiveByUserId(userId);
    const schedule = asSchedule(answers, 'schedule');
    const payload: Partial<Goal> = {
      userId,
      targetRoles: asStringArray(answers, 'goal'),
      motivation: withOther(
        asStringArray(answers, 'motivation'),
        asOptionalString(answers, 'motivationOther'),
      ),
      currentProfession: asString(answers, 'currentJob') || null,
      currentProfessionOther:
        asOptionalString(answers, 'currentJobOther') ?? null,
      skills: withOther(
        asStringArray(answers, 'skills'),
        asOptionalString(answers, 'skillsOther'),
      ),
      weeklyHours: asString(answers, 'studyHours') || null,
      availability: {
        days: schedule.days,
        times: schedule.times,
      },
      targetDeadline: asString(answers, 'deadline') || null,
      learningStyles: withOther(
        asStringArray(answers, 'learningStyle'),
        asOptionalString(answers, 'learningStyleOther'),
      ),
      confidence: asString(answers, 'confidence') || null,
      quitReasons: withOther(
        asStringArray(answers, 'quitReasons'),
        asOptionalString(answers, 'quitReasonsOther'),
      ),
      rawAnswers: answers as Record<string, unknown>,
      status: GoalStatus.Active,
    };

    if (existing) {
      Object.assign(existing, payload);
      return this.goalsRepo.save(existing);
    }

    return this.goalsRepo.save(this.goalsRepo.create(payload));
  }
}
