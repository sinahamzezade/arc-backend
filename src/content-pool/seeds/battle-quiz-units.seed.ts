import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BATTLE_POOL_MIN_MULTIPLIER } from '../content-pool.constants';
import { Skill } from '../entities/skill.entity';
import { Unit } from '../entities/unit.entity';
import { BANKS, SUBJECTS, TOPICS } from './battle-quiz-banks';

/** Max battle length × pool multiplier — each topic needs this many questions. */
export const BATTLE_QUIZ_QUESTIONS_PER_TOPIC = 20 * BATTLE_POOL_MIN_MULTIPLIER;

const LEVELS = [1, 2, 3, 4] as const;

function topicSlug(topic: string) {
  return topic.toLowerCase().replace(/\s+/g, '-');
}

function titleFromSlug(slug: string) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function buildMcq(
  subject: (typeof SUBJECTS)[number],
  index: number,
  topic: string,
): {
  q: string;
  type: 'mcq';
  options: string[];
  answer: number;
  explain: string;
} {
  const bank = BANKS[subject];
  const base = bank[index % bank.length]!;
  const variant = Math.floor(index / bank.length);
  const stem =
    variant === 0 ? base.stem : `${base.stem} (variant ${variant + 1})`;

  const labels = [base.correct, ...base.wrong];
  const correctSlot = index % 4;
  const ordered = [...labels];
  const [correctLabel] = ordered.splice(0, 1);
  ordered.splice(correctSlot, 0, correctLabel!);

  return {
    q: `[${topic}] ${stem}`,
    type: 'mcq',
    options: ordered,
    answer: correctSlot,
    explain: `Correct: ${correctLabel}`,
  };
}

/**
 * Seeds quiz units used as the battle question pool.
 * Idempotent upsert by unit id — skips units that already exist with questions.
 */
@Injectable()
export class BattleQuizUnitsSeedService implements OnModuleInit {
  private readonly logger = new Logger(BattleQuizUnitsSeedService.name);

  constructor(
    @InjectRepository(Unit)
    private readonly unitsRepo: Repository<Unit>,
    @InjectRepository(Skill)
    private readonly skillsRepo: Repository<Skill>,
  ) {}

  async onModuleInit() {
    if (process.env.BATTLE_QUESTION_SEED === 'false') return;
    try {
      await this.ensurePool();
    } catch (err) {
      this.logger.warn(
        `Battle quiz-unit seed skipped: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async ensurePool(): Promise<number> {
    let created = 0;
    const perLevel = Math.ceil(BATTLE_QUIZ_QUESTIONS_PER_TOPIC / LEVELS.length);

    for (const subject of SUBJECTS) {
      for (const topic of TOPICS[subject]) {
        const tSlug = topicSlug(topic);
        const skillId = `${subject}:${tSlug}`;

        const existingSkill = await this.skillsRepo.findOne({
          where: { id: skillId },
        });
        if (!existingSkill) {
          await this.skillsRepo.save(
            this.skillsRepo.create({
              id: skillId,
              title: topic,
              prerequisites: [],
              level: 1,
              isActive: true,
            }),
          );
        }

        let globalIndex = 0;
        for (const level of LEVELS) {
          const unitId = `battle-quiz-${subject}-${tSlug}-l${level}`;
          const existing = await this.unitsRepo.findOne({
            where: { id: unitId },
          });
          if (existing) {
            const qCount = Array.isArray(
              (existing.content as { questions?: unknown[] })?.questions,
            )
              ? (existing.content as { questions: unknown[] }).questions.length
              : 0;
            if (qCount >= perLevel) {
              globalIndex += perLevel;
              continue;
            }
          }

          const questions: Array<{
            q: string;
            type: 'mcq';
            options: string[];
            answer: number;
            explain: string;
          }> = [];
          for (let i = 0; i < perLevel; i++) {
            questions.push(buildMcq(subject, globalIndex + i, topic));
          }
          globalIndex += perLevel;

          const row = this.unitsRepo.create({
            id: unitId,
            title: `${titleFromSlug(subject)} — ${topic} (L${level})`,
            skillsTaught: [skillId],
            prerequisites: [],
            level,
            estimatedMinutes: 15,
            formats: ['quiz'],
            lessonType: 'quiz',
            domain: subject === 'frontend' ? 'frontend' : 'data',
            stack: subject,
            provider: 'arc-battle-seed',
            url: null,
            xp: 25,
            content: {
              objective: `Battle pool quiz for ${topic}`,
              passScore: Math.ceil(perLevel / 2),
              questions,
            },
            servesStage: [level],
            unitRole: 'checkpoint',
            profileSkillSlug: subject,
            sourceTemplateId: null,
            sourceVersionId: null,
            simulationAssetKey: null,
            actionVocabulary: [],
            isActive: true,
          });

          await this.unitsRepo.save(row);
          created += 1;
        }
      }
    }

    if (created) {
      this.logger.log(
        `Seeded ${created} battle quiz units (${SUBJECTS.length} subjects × topics × ${LEVELS.length} levels)`,
      );
    }
    return created;
  }
}
