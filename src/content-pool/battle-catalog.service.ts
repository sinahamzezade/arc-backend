import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SkillNode } from '../skill-graph/entities/skill-node.entity';
import { TechStack } from '../skill-graph/entities/tech-stack.entity';
import {
  BATTLE_POOL_MIN_MULTIPLIER,
  ContentPublicationStatus,
} from './content-pool.constants';
import { QuestionTemplate } from './entities/question-template.entity';

/** Smallest battle (5Q) needs this many published versions. */
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

type PoolRow = {
  techStackSlug: string;
  slug: string;
  skillNodeId: string | null;
  publishedVersionId: string | null;
};

@Injectable()
export class BattleCatalogService {
  constructor(
    @InjectRepository(TechStack)
    private readonly stacksRepo: Repository<TechStack>,
    @InjectRepository(SkillNode)
    private readonly skillsRepo: Repository<SkillNode>,
    @InjectRepository(QuestionTemplate)
    private readonly questionsRepo: Repository<QuestionTemplate>,
  ) {}

  /**
   * Catalog chips — only subjects/topics with enough published battle versions.
   * Driven by content pool (not empty skill-graph stacks).
   */
  async listCatalog(): Promise<{ subjects: BattleCatalogSubject[] }> {
    const rows = await this.questionsRepo
      .createQueryBuilder('q')
      .select('q.techStackSlug', 'techStackSlug')
      .addSelect('q.slug', 'slug')
      .addSelect('q.skillNodeId', 'skillNodeId')
      .addSelect('q.publishedVersionId', 'publishedVersionId')
      .where('q.is_active = true')
      .andWhere('q.status = :status', {
        status: ContentPublicationStatus.Published,
      })
      .andWhere(`:ctx = ANY(q.allowed_contexts)`, { ctx: 'battle' })
      .andWhere('q.published_version_id IS NOT NULL')
      .andWhere('q.tech_stack_slug IS NOT NULL')
      .getRawMany<PoolRow>();

    const stacks = await this.stacksRepo.find({
      where: { isActive: true },
      order: { name: 'ASC' },
    });
    const stackNameBySlug = new Map(
      stacks.map((s) => [s.slug, s.name] as const),
    );
    const skills = await this.skillsRepo.find({ where: { isActive: true } });
    const skillById = new Map(skills.map((s) => [s.id, s] as const));

    const bySubject = new Map<
      string,
      {
        total: number;
        topics: Map<
          string,
          { count: number; skillNodeId: string | null; name: string }
        >;
      }
    >();

    for (const row of rows) {
      const subjectSlug = row.techStackSlug?.trim().toLowerCase();
      if (!subjectSlug || !row.publishedVersionId) continue;

      let bucket = bySubject.get(subjectSlug);
      if (!bucket) {
        bucket = { total: 0, topics: new Map() };
        bySubject.set(subjectSlug, bucket);
      }
      bucket.total += 1;

      const parsed = this.topicFromTemplate(subjectSlug, row, skillById);
      if (!parsed) continue;

      const existing = bucket.topics.get(parsed.slug);
      if (existing) {
        existing.count += 1;
        if (!existing.skillNodeId && parsed.skillNodeId) {
          existing.skillNodeId = parsed.skillNodeId;
        }
      } else {
        bucket.topics.set(parsed.slug, {
          count: 1,
          skillNodeId: parsed.skillNodeId,
          name: parsed.name,
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
            skillNodeId: t.skillNodeId ?? '',
            publishedCount: t.count,
          }));

        // Subject-wide chip when no topic meets floor but subject pool does.
        if (
          topics.length === 0 &&
          data.total >= MIN_POOL_FOR_CATALOG
        ) {
          topics.push({
            slug: '',
            name: 'All topics',
            skillNodeId: '',
            publishedCount: data.total,
          });
        }

        return {
          slug,
          name: stackNameBySlug.get(slug) ?? this.titleFromSlug(slug),
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

    const stacks = await this.stacksRepo.find({ where: { isActive: true } });
    const stackHit = stacks.find(
      (s) =>
        s.slug === needle ||
        s.name.toLowerCase() === display ||
        s.name.toLowerCase().replace(/\s+/g, '-') === needle ||
        s.name.toLowerCase().includes(display) ||
        s.slug.includes(needle),
    );
    if (stackHit) return { slug: stackHit.slug, name: stackHit.name };

    // Content-pool-only subjects (seeded battle banks) not in skill graph.
    const poolSlug = await this.questionsRepo
      .createQueryBuilder('q')
      .select('q.tech_stack_slug', 'slug')
      .where('q.is_active = true')
      .andWhere('q.status = :status', {
        status: ContentPublicationStatus.Published,
      })
      .andWhere(`:ctx = ANY(q.allowed_contexts)`, { ctx: 'battle' })
      .andWhere('q.tech_stack_slug IS NOT NULL')
      .andWhere(
        `(q.tech_stack_slug = :needle OR LOWER(REPLACE(q.tech_stack_slug, '-', ' ')) = :display)`,
        { needle, display },
      )
      .limit(1)
      .getRawOne<{ slug: string }>();

    if (poolSlug?.slug) {
      return {
        slug: poolSlug.slug,
        name: this.titleFromSlug(poolSlug.slug),
      };
    }

    return null;
  }

  async resolveSkill(
    stackSlug: string,
    topicRaw?: string | null,
  ): Promise<SkillNode | null> {
    const stack = await this.stacksRepo.findOne({
      where: { slug: stackSlug, isActive: true },
    });
    if (!stack) return null;
    const skills = await this.skillsRepo.find({
      where: { techStackId: stack.id, isActive: true },
      order: { orderHint: 'ASC' },
    });
    if (!topicRaw?.trim()) return skills[0] ?? null;
    const raw = topicRaw.trim().toLowerCase();
    const needle = raw.replace(/\s+/g, '-');
    const exact =
      skills.find(
        (s) =>
          s.slug === needle ||
          s.title.toLowerCase() === raw ||
          s.title.toLowerCase().replace(/\s+/g, '-') === needle,
      ) ?? null;
    if (exact) return exact;
    return (
      skills.find(
        (s) =>
          s.title.toLowerCase().includes(raw) ||
          s.slug.includes(needle) ||
          raw.includes(s.slug),
      ) ?? null
    );
  }

  /**
   * Count published battle versions for a skill node (0 = do not filter by it).
   */
  async publishedBattleCountForSkill(skillNodeId: string): Promise<number> {
    return this.questionsRepo
      .createQueryBuilder('q')
      .where('q.is_active = true')
      .andWhere('q.status = :status', {
        status: ContentPublicationStatus.Published,
      })
      .andWhere(`:ctx = ANY(q.allowed_contexts)`, { ctx: 'battle' })
      .andWhere('q.published_version_id IS NOT NULL')
      .andWhere('q.skill_node_id = :skillNodeId', { skillNodeId })
      .getCount();
  }

  private topicFromTemplate(
    subjectSlug: string,
    row: PoolRow,
    skillById: Map<string, SkillNode>,
  ): { slug: string; name: string; skillNodeId: string | null } | null {
    if (row.skillNodeId) {
      const skill = skillById.get(row.skillNodeId);
      if (skill) {
        return {
          slug: skill.slug,
          name: skill.title,
          skillNodeId: skill.id,
        };
      }
    }
    const slug = row.slug?.toLowerCase() ?? '';
    // Seed pattern: battle-{subject}-{topic}-{nnn}
    const prefix = `battle-${subjectSlug}-`;
    if (!slug.startsWith(prefix)) return null;
    const rest = slug.slice(prefix.length).replace(/-\d+$/, '');
    if (!rest) return null;
    return {
      slug: rest,
      name: this.titleFromSlug(rest),
      skillNodeId: row.skillNodeId,
    };
  }

  private titleFromSlug(slug: string): string {
    return slug
      .split('-')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
}
