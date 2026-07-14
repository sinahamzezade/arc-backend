import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SkillNode } from '../skill-graph/entities/skill-node.entity';
import { TechStack } from '../skill-graph/entities/tech-stack.entity';

export type BattleCatalogTopic = {
  slug: string;
  name: string;
  skillNodeId: string;
};

export type BattleCatalogSubject = {
  slug: string;
  name: string;
  topics: BattleCatalogTopic[];
};

@Injectable()
export class BattleCatalogService {
  constructor(
    @InjectRepository(TechStack)
    private readonly stacksRepo: Repository<TechStack>,
    @InjectRepository(SkillNode)
    private readonly skillsRepo: Repository<SkillNode>,
  ) {}

  async listCatalog(): Promise<{ subjects: BattleCatalogSubject[] }> {
    const stacks = await this.stacksRepo.find({
      where: { isActive: true },
      order: { name: 'ASC' },
    });
    const skills = await this.skillsRepo.find({
      where: { isActive: true },
      order: { orderHint: 'ASC', title: 'ASC' },
    });

    const byStack = new Map<string, SkillNode[]>();
    for (const skill of skills) {
      const list = byStack.get(skill.techStackId) ?? [];
      list.push(skill);
      byStack.set(skill.techStackId, list);
    }

    const subjects: BattleCatalogSubject[] = stacks.map((stack) => ({
      slug: stack.slug,
      name: stack.name,
      topics: (byStack.get(stack.id) ?? []).map((skill) => ({
        slug: skill.slug,
        name: skill.title,
        skillNodeId: skill.id,
      })),
    }));

    return { subjects: subjects.filter((s) => s.topics.length > 0) };
  }

  async resolveSubjectSlug(raw: string): Promise<string | null> {
    if (!raw?.trim()) return null;
    const needle = raw.trim().toLowerCase().replace(/\s+/g, '-');
    const stacks = await this.stacksRepo.find({ where: { isActive: true } });
    const hit = stacks.find(
      (s) =>
        s.slug === needle ||
        s.name.toLowerCase() === raw.trim().toLowerCase() ||
        s.name.toLowerCase().replace(/\s+/g, '-') === needle ||
        s.name.toLowerCase().includes(raw.trim().toLowerCase()) ||
        s.slug.includes(needle),
    );
    return hit?.slug ?? null;
  }

  async resolveSubject(
    raw: string,
  ): Promise<{ slug: string; name: string } | null> {
    if (!raw?.trim()) return null;
    const needle = raw.trim().toLowerCase().replace(/\s+/g, '-');
    const stacks = await this.stacksRepo.find({ where: { isActive: true } });
    const hit = stacks.find(
      (s) =>
        s.slug === needle ||
        s.name.toLowerCase() === raw.trim().toLowerCase() ||
        s.name.toLowerCase().replace(/\s+/g, '-') === needle ||
        s.name.toLowerCase().includes(raw.trim().toLowerCase()) ||
        s.slug.includes(needle),
    );
    return hit ? { slug: hit.slug, name: hit.name } : null;
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
}
