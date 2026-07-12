import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Goal,
  GoalStatus,
} from './entities/goal.entity';
import type { QuestionnaireAnswers } from '../questionnaire/types/answers';
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
    const payload: Partial<Goal> = {
      userId,
      targetRoles: answers.goal,
      motivation: withOther(answers.motivation, answers.motivationOther),
      currentProfession: answers.currentJob || null,
      currentProfessionOther: answers.currentJobOther ?? null,
      skills: withOther(answers.skills, answers.skillsOther),
      weeklyHours: answers.studyHours || null,
      availability: {
        days: answers.schedule.days,
        times: answers.schedule.times,
      },
      targetDeadline: answers.deadline || null,
      learningStyles: withOther(
        answers.learningStyle,
        answers.learningStyleOther,
      ),
      confidence: answers.confidence || null,
      quitReasons: withOther(answers.quitReasons, answers.quitReasonsOther),
      rawAnswers: answers as unknown as Record<string, unknown>,
      status: GoalStatus.Active,
    };

    if (existing) {
      Object.assign(existing, payload);
      return this.goalsRepo.save(existing);
    }

    return this.goalsRepo.save(this.goalsRepo.create(payload));
  }
}
