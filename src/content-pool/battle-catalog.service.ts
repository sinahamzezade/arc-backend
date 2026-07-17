import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BATTLE_POOL_MIN_MULTIPLIER } from './content-pool.constants';
import { Skill } from './entities/skill.entity';
import { Unit } from './entities/unit.entity';
import {
  extractQuizQuestions,
  topicMatchesSkills,
} from './unit-battle-question.util';

/** Smallest battle (5Q) needs this many quiz-unit questions. */
const MIN_POOL_FOR_CATALOG = 5 * BATTLE_POOL_MIN_MULTIPLIER;

export type BattleCatalogTopic = {
  slug: string;
  name: string;
  skillNodeId: string;
  publishedCount: number;
};

export type BattleCatalogSubject = {
  slug: string;
  name: string;
  publishedCount: number;
  topics: BattleCatalogTopic[];
};

export type BattleCatalogSkill = {
  id: string;
  slug: string;
  title: string;
};

@Injectable()
export class BattleCatalogService {
  constructor(
    @InjectRepository(Unit)
    private readonly unitsRepo: Repository<Unit>,
    @InjectRepository(Skill)
    private readonly skillsRepo: Repository<Skill>,
  ) {}

  /**
   * Catalog chips — only subjects/topics with enough quiz-unit questions.
   */
  async listCatalog(): Promise<{ subjects: BattleCatalogSubject[] }> {
    const units = await this.unitsRepo.find({
      where: { isActive: true, lessonType: 'quiz' },
    });

    const skills = await this.skillsRepo.find({ where: { isActive: true } });
    const skillById = new Map(skills.map((s) => [s.id, s] as const));

    const bySubject = new Map<
      string,
      {
        total: number;
        topics: Map<
          string,
          { count: number; skillId: string; name: string }
        >;
      }
    >();

    for (const unit of units) {
      const subjectSlug = unit.stack?.trim().toLowerCase();
      if (!subjectSlug) continue;
      const qCount = extractQuizQuestions(unit.content ?? {}).length;
      if (qCount === 0) continue;

      let bucket = bySubject.get(subjectSlug);
      if (!bucket) {
        bucket = { total: 0, topics: new Map() };
        bySubject.set(subjectSlug, bucket);
      }
      bucket.total += qCount;

      const skillId =
        unit.skillsTaught?.[0] ?? `${subjectSlug}:general`;
      const skill = skillById.get(skillId);
      const topicSlug = skill
        ? this.localSkillSlug(skill.id)
        : this.localSkillSlug(skillId);
      const topicName = skill?.title ?? this.titleFromSlug(topicSlug);

      const existing = bucket.topics.get(topicSlug);
      if (existing) {
        existing.count += qCount;
      } else {
        bucket.topics.set(topicSlug, {
          count: qCount,
          skillId,
          name: topicName,
        });
      }
    }

    const subjects: BattleCatalogSubject[] = [...bySubject.entries()]
      .filter(([, data]) => data.total >= MIN_POOL_FOR_CATALOG)
      .map(([slug, data]) => {
        const topics: BattleCatalogTopic[] = [...data.topics.entries()]
          .filter(([, t]) => t.count >= MIN_POOL_FOR_CATALOG)
          .sort((a, b) => a[1].name.localeCompare(b[1].name))
          .map(([topicSlug, t]) => ({
            slug: topicSlug,
            name: t.name,
            skillNodeId: t.skillId,
            publishedCount: t.count,
          }));

        if (topics.length === 0 && data.total >= MIN_POOL_FOR_CATALOG) {
          topics.push({
            slug: '',
            name: 'All topics',
            skillNodeId: '',
            publishedCount: data.total,
          });
        }

        return {
          slug,
          name: this.titleFromSlug(slug),
          publishedCount: data.total,
          topics,
        };
      })
      .filter((s) => s.topics.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    return { subjects };
  }

  async resolveSubjectSlug(raw: string): Promise<string | null> {
    const hit = await this.resolveSubject(raw);
    return hit?.slug ?? null;
  }

  async resolveSubject(
    raw: string,
  ): Promise<{ slug: string; name: string } | null> {
    if (!raw?.trim()) return null;
    const needle = raw.trim().toLowerCase().replace(/\s+/g, '-');
    const display = raw.trim().toLowerCase();

    const stacks: Array<{ stack: string }> = await this.unitsRepo
      .createQueryBuilder('u')
      .select('DISTINCT u.stack', 'stack')
      .where('u.is_active = true')
      .andWhere('u.lesson_type = :lt', { lt: 'quiz' })
      .getRawMany();

    const hit = stacks.find((s) => {
      const slug = s.stack?.trim().toLowerCase();
      if (!slug) return false;
      return (
        slug === needle ||
        slug === display ||
        this.titleFromSlug(slug).toLowerCase() === display ||
        slug.includes(needle) ||
        needle.includes(slug)
      );
    });

    if (hit?.stack) {
      const slug = hit.stack.trim().toLowerCase();
      return { slug, name: this.titleFromSlug(slug) };
    }

    return null;
  }

  async resolveSkill(
    stackSlug: string,
    topicRaw?: string | null,
  ): Promise<BattleCatalogSkill | null> {
    const units = await this.unitsRepo.find({
      where: { isActive: true, lessonType: 'quiz', stack: stackSlug },
    });
    if (!units.length) return null;

    const skillIds = new Set<string>();
    for (const u of units) {
      for (const s of u.skillsTaught ?? []) skillIds.add(s);
    }
    if (skillIds.size === 0) return null;

    const skills = await this.skillsRepo.find({ where: { isActive: true } });
    const byId = new Map(skills.map((s) => [s.id, s] as const));

    const candidates: BattleCatalogSkill[] = [...skillIds].map((id) => {
      const skill = byId.get(id);
      const local = this.localSkillSlug(id);
      return {
        id,
        slug: local,
        title: skill?.title ?? this.titleFromSlug(local),
      };
    });

    if (!topicRaw?.trim()) return candidates[0] ?? null;
    const raw = topicRaw.trim().toLowerCase();
    const needle = raw.replace(/\s+/g, '-');

    const exact =
      candidates.find(
        (s) =>
          s.slug === needle ||
          s.title.toLowerCase() === raw ||
          s.title.toLowerCase().replace(/\s+/g, '-') === needle ||
          s.id.toLowerCase() === needle ||
          s.id.toLowerCase().endsWith(`:${needle}`),
      ) ?? null;
    if (exact) return exact;

    return (
      candidates.find(
        (s) =>
          s.title.toLowerCase().includes(raw) ||
          s.slug.includes(needle) ||
          raw.includes(s.slug) ||
          topicMatchesSkills([s.id], topicRaw),
      ) ?? null
    );
  }

  /**
   * Count quiz-unit questions teaching a skill id (0 = do not filter by it).
   */
  async publishedBattleCountForSkill(skillId: string): Promise<number> {
    if (!skillId?.trim()) return 0;
    const units = await this.unitsRepo
      .createQueryBuilder('u')
      .where('u.is_active = true')
      .andWhere('u.lesson_type = :lt', { lt: 'quiz' })
      .andWhere(':skill = ANY(u.skills_taught)', { skill: skillId })
      .getMany();

    return units.reduce(
      (sum, u) => sum + extractQuizQuestions(u.content ?? {}).length,
      0,
    );
  }

  private localSkillSlug(skillId: string): string {
    const s = skillId.trim().toLowerCase();
    return s.includes(':') ? s.split(':').slice(1).join(':') : s;
  }

  private titleFromSlug(slug: string): string {
    return slug
      .split('-')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
}
