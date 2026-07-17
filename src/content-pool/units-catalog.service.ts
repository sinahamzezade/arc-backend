import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { Repository } from 'typeorm';
import { JsonCacheService } from '../common/cache/json-cache.service';
import { CareerRole } from './entities/career-role.entity';
import { Skill } from './entities/skill.entity';
import { Unit } from './entities/unit.entity';
import { RoleRecipe } from '../skill-graph/entities/role-recipe.entity';
import {
  assertPrereqsResolved,
  topologicalSortSkills,
  UnitsGraphError,
} from './units-graph.util';
import {
  isUnitsJsonDocument,
  UNIT_ROLES,
  type UnitsJsonDocument,
  type UnitsJsonSkill,
  type UnitsJsonUnit,
} from './units-json.types';

@Injectable()
export class UnitsCatalogService implements OnModuleInit {
  private readonly logger = new Logger(UnitsCatalogService.name);
  /** Called after any catalog mutation (import/upsert/activate/remove). */
  private readonly changeListeners: Array<() => Promise<void> | void> = [];

  private readonly catalogTtlSec = 600;

  constructor(
    @InjectRepository(Skill)
    private readonly skillsRepo: Repository<Skill>,
    @InjectRepository(Unit)
    private readonly unitsRepo: Repository<Unit>,
    @InjectRepository(RoleRecipe)
    private readonly recipesRepo: Repository<RoleRecipe>,
    @InjectRepository(CareerRole)
    private readonly careersRepo: Repository<CareerRole>,
    private readonly jsonCache: JsonCacheService,
  ) {}

  async onModuleInit() {
    await this.ensureSeeded();
  }

  /** Subscribe to catalog mutations (e.g. schema cache reload on new domains). */
  onCatalogChanged(listener: () => Promise<void> | void): void {
    this.changeListeners.push(listener);
  }

  private async notifyCatalogChanged(): Promise<void> {
    await this.jsonCache.delByPrefix('catalog:');
    for (const listener of this.changeListeners) {
      try {
        await listener();
      } catch (err) {
        this.logger.warn(
          `Catalog change listener failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  async ensureSeeded(): Promise<void> {
    const unitCount = await this.unitsRepo.count();
    if (unitCount > 0) {
      this.logger.log(`Units pool already seeded (${unitCount} units)`);
      await this.ensureDomainRecipes();
      return;
    }
    const docs = this.loadSeedDocuments();
    for (const doc of docs) {
      await this.importDocument(doc, { deactivateMissing: false });
    }
    await this.ensureDomainRecipes();
  }

  /** Idempotent upsert of a units JSON document (admin import or seed). */
  async importDocument(
    doc: UnitsJsonDocument,
    opts: { deactivateMissing?: boolean } = {},
  ): Promise<{ skills: number; units: number }> {
    this.validateDocument(doc);

    for (const s of doc.skills_index) {
      await this.skillsRepo.save(this.mapSkill(s));
    }
    for (const u of doc.units) {
      await this.unitsRepo.save(this.mapUnit(u));
    }

    if (opts.deactivateMissing) {
      const skillIds = new Set(doc.skills_index.map((s) => s.id));
      const unitIds = new Set(doc.units.map((u) => u.id));
      const allSkills = await this.skillsRepo.find();
      const allUnits = await this.unitsRepo.find();
      for (const s of allSkills) {
        if (!skillIds.has(s.id) && s.isActive) {
          s.isActive = false;
          await this.skillsRepo.save(s);
        }
      }
      for (const u of allUnits) {
        if (!unitIds.has(u.id) && u.isActive) {
          u.isActive = false;
          await this.unitsRepo.save(u);
        }
      }
    }

    this.logger.log(
      `Imported units package: ${doc.skills_index.length} skills, ${doc.units.length} units`,
    );
    await this.ensureDomainRecipes();
    await this.notifyCatalogChanged();
    return { skills: doc.skills_index.length, units: doc.units.length };
  }

  validateDocument(doc: UnitsJsonDocument): void {
    if (!doc.skills_index?.length) {
      throw new UnitsGraphError(
        'CONTENT_PREREQ_UNRESOLVED',
        'skills_index must not be empty',
      );
    }
    const skills = doc.skills_index.map((s) => ({
      id: s.id,
      title: s.title,
      prerequisites: s.prerequisites ?? [],
      level: s.level ?? 1,
    }));
    assertPrereqsResolved(skills);
    topologicalSortSkills(skills);

    const skillIds = new Set(skills.map((s) => s.id));
    for (const u of doc.units) {
      for (const sk of u.skills_taught ?? []) {
        if (!skillIds.has(sk)) {
          throw new UnitsGraphError(
            'CONTENT_PREREQ_UNRESOLVED',
            `Unit "${u.id}" skills_taught "${sk}" not in skills_index`,
          );
        }
      }
      for (const p of u.prerequisites ?? []) {
        if (!skillIds.has(p)) {
          throw new UnitsGraphError(
            'CONTENT_PREREQ_UNRESOLVED',
            `Unit "${u.id}" prerequisite "${p}" not in skills_index`,
          );
        }
      }
      if (
        u.unit_role !== undefined &&
        !(UNIT_ROLES as readonly string[]).includes(u.unit_role)
      ) {
        throw new UnitsGraphError(
          'CONTENT_PREREQ_UNRESOLVED',
          `Unit "${u.id}" unit_role "${u.unit_role}" must be one of ${UNIT_ROLES.join('|')}`,
        );
      }
      if (
        u.serves_stage !== undefined &&
        (!Array.isArray(u.serves_stage) ||
          u.serves_stage.some((s) => !Number.isInteger(s) || s < 1))
      ) {
        throw new UnitsGraphError(
          'CONTENT_PREREQ_UNRESOLVED',
          `Unit "${u.id}" serves_stage must be an array of positive integers`,
        );
      }
    }
  }

  async exportDocument(): Promise<UnitsJsonDocument> {
    const skills = await this.skillsRepo.find({
      where: { isActive: true },
      order: { level: 'ASC', id: 'ASC' },
    });
    const units = await this.unitsRepo.find({
      where: { isActive: true },
      order: { level: 'ASC', id: 'ASC' },
    });
    return {
      skills_index: skills.map((s) => ({
        id: s.id,
        title: s.title,
        prerequisites: s.prerequisites ?? [],
        level: s.level,
      })),
      units: units.map((u) => ({
        id: u.id,
        title: u.title,
        skills_taught: u.skillsTaught ?? [],
        prerequisites: u.prerequisites ?? [],
        level: u.level,
        estimated_minutes: u.estimatedMinutes,
        formats: u.formats ?? [],
        lesson_type: u.lessonType,
        domain: u.domain,
        stack: u.stack,
        provider: u.provider,
        url: u.url,
        xp: u.xp,
        content: u.content ?? {},
        serves_stage: u.servesStage ?? [],
        unit_role: u.unitRole,
        profile_skill_slug: u.profileSkillSlug,
        source_template_id: u.sourceTemplateId,
        source_version_id: u.sourceVersionId,
      })),
    };
  }

  async listActiveSkills(): Promise<Skill[]> {
    const key = 'catalog:skills:active';
    const cached = await this.jsonCache.getJson<Skill[]>(key);
    if (cached) return cached;

    const skills = await this.skillsRepo.find({
      where: { isActive: true },
      order: { level: 'ASC', id: 'ASC' },
    });
    await this.jsonCache.setJson(key, skills, this.catalogTtlSec);
    return skills;
  }

  async listActiveUnits(
    filter?: {
      stack?: string;
      domain?: string;
    },
    opts?: { includeContent?: boolean },
  ): Promise<Unit[]> {
    const where: Record<string, unknown> = { isActive: true };
    if (filter?.stack) where.stack = filter.stack;
    if (filter?.domain) where.domain = filter.domain;
    const includeContent = opts?.includeContent !== false;
    if (includeContent) {
      return this.unitsRepo.find({
        where,
        order: { level: 'ASC', id: 'ASC' },
      });
    }

    // v2: includes skillsTaught/prerequisites/formats (v1 omitted them → empty roadmaps).
    const key = `catalog:units:active:v2:${filter?.stack ?? '*'}:${filter?.domain ?? '*'}`;
    const cached = await this.jsonCache.getJson<Unit[]>(key);
    if (cached) return cached;

    const units = await this.unitsRepo
      .createQueryBuilder('unit')
      .where('unit.is_active = true')
      .andWhere(filter?.stack ? 'unit.stack = :stack' : '1=1', {
        stack: filter?.stack,
      })
      .andWhere(filter?.domain ? 'unit.domain = :domain' : '1=1', {
        domain: filter?.domain,
      })
      .select([
        'unit.id',
        'unit.stack',
        'unit.domain',
        'unit.level',
        'unit.title',
        'unit.lessonType',
        'unit.estimatedMinutes',
        'unit.xp',
        'unit.url',
        // Required for roadmap matching (omit → unitCandidates=0).
        'unit.skillsTaught',
        'unit.prerequisites',
        'unit.formats',
        'unit.servesStage',
        'unit.unitRole',
        'unit.profileSkillSlug',
        'unit.sourceTemplateId',
        'unit.sourceVersionId',
        'unit.isActive',
      ])
      .orderBy('unit.level', 'ASC')
      .addOrderBy('unit.id', 'ASC')
      .getMany();
    await this.jsonCache.setJson(key, units, this.catalogTtlSec);
    return units;
  }

  async findUnit(id: string): Promise<Unit | null> {
    return this.unitsRepo.findOne({ where: { id, isActive: true } });
  }

  async findSkill(id: string): Promise<Skill | null> {
    return this.skillsRepo.findOne({ where: { id, isActive: true } });
  }

  /** Admin lookup — includes deactivated rows. */
  async getUnitById(id: string): Promise<Unit | null> {
    return this.unitsRepo.findOne({ where: { id } });
  }

  /** Admin lookup — includes deactivated rows. */
  async getSkillById(id: string): Promise<Skill | null> {
    return this.skillsRepo.findOne({ where: { id } });
  }

  async setUnitActive(id: string, active: boolean): Promise<void> {
    await this.unitsRepo.update({ id }, { isActive: active });
    await this.notifyCatalogChanged();
  }

  async setSkillActive(id: string, active: boolean): Promise<void> {
    await this.skillsRepo.update({ id }, { isActive: active });
    await this.notifyCatalogChanged();
  }

  /** Units teaching a given skill (admin cross-nav). */
  async listUnitsForSkill(skillId: string): Promise<Unit[]> {
    return this.unitsRepo
      .createQueryBuilder('u')
      .where(':skillId = ANY(u.skills_taught)', { skillId })
      .orderBy('u.id', 'ASC')
      .getMany();
  }

  async upsertUnit(input: UnitsJsonUnit): Promise<Unit> {
    this.validateDocument({
      skills_index: (await this.listActiveSkills()).map((s) => ({
        id: s.id,
        title: s.title,
        prerequisites: s.prerequisites,
        level: s.level,
      })),
      units: [input],
    });
    const saved = await this.unitsRepo.save(this.mapUnit(input));
    await this.notifyCatalogChanged();
    return saved;
  }

  async upsertSkill(input: UnitsJsonSkill): Promise<Skill> {
    const existing = await this.listActiveSkills();
    const merged = [
      ...existing
        .filter((s) => s.id !== input.id)
        .map((s) => ({
          id: s.id,
          title: s.title,
          prerequisites: s.prerequisites,
          level: s.level,
        })),
      input,
    ];
    this.validateDocument({ skills_index: merged, units: [] });
    return this.skillsRepo.save(this.mapSkill(input));
  }

  async deactivateUnit(id: string): Promise<void> {
    await this.unitsRepo.update({ id }, { isActive: false });
    await this.notifyCatalogChanged();
  }

  async removeUnit(id: string): Promise<boolean> {
    const result = await this.unitsRepo.delete({ id });
    if (result.affected) {
      await this.ensureDomainRecipes();
      await this.notifyCatalogChanged();
      return true;
    }
    return false;
  }

  /** Bulk variant of removeUnit — one recipe/listener refresh for the whole batch. */
  async removeUnits(ids: string[]): Promise<number> {
    const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (!unique.length) return 0;
    const result = await this.unitsRepo.delete(unique);
    const removed = result.affected ?? 0;
    if (removed > 0) {
      await this.ensureDomainRecipes();
      await this.notifyCatalogChanged();
    }
    return removed;
  }

  async deactivateSkill(id: string): Promise<void> {
    await this.skillsRepo.update({ id }, { isActive: false });
    await this.notifyCatalogChanged();
  }

  private mapSkill(s: UnitsJsonSkill): Skill {
    return this.skillsRepo.create({
      id: s.id,
      title: s.title,
      prerequisites: s.prerequisites ?? [],
      level: s.level ?? 1,
      isActive: true,
    });
  }

  private mapUnit(u: UnitsJsonUnit): Unit {
    return this.unitsRepo.create({
      id: u.id,
      title: u.title,
      skillsTaught: u.skills_taught ?? [],
      prerequisites: u.prerequisites ?? [],
      level: u.level ?? 1,
      estimatedMinutes: u.estimated_minutes ?? 20,
      formats: u.formats ?? [],
      lessonType: u.lesson_type,
      domain: u.domain ?? 'frontend',
      stack: u.stack,
      provider: u.provider ?? null,
      url: u.url ?? null,
      xp: u.xp ?? 20,
      content: u.content ?? {},
      servesStage: u.serves_stage ?? [u.level ?? 1],
      unitRole: u.unit_role ?? 'foundation',
      profileSkillSlug:
        u.profile_skill_slug ??
        (u.skills_taught?.[0]?.includes(':')
          ? u.skills_taught[0].split(':')[0]
          : null),
      sourceTemplateId: u.source_template_id ?? null,
      sourceVersionId: u.source_version_id ?? null,
      simulationAssetKey: u.simulation_asset_key ?? null,
      actionVocabulary: u.action_vocabulary ?? [],
      isActive: true,
    });
  }

  private loadSeedDocuments(): UnitsJsonDocument[] {
    const dirs = [
      join(process.cwd(), 'course'),
      join(__dirname, '../../../course'),
    ];
    const docs: UnitsJsonDocument[] = [];
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('-units.json') && file !== 'frontend-units.json') {
          continue;
        }
        if (!file.endsWith('.json')) continue;
        const raw = JSON.parse(readFileSync(join(dir, file), 'utf8'));
        if (!isUnitsJsonDocument(raw)) {
          this.logger.warn(`Skipping invalid units file ${file}`);
          continue;
        }
        docs.push(raw);
      }
      if (docs.length > 0) break;
    }
    if (docs.length === 0) {
      this.logger.warn('No *-units.json seed files found under course/');
    }
    return docs;
  }

  /** Distinct domains across active units — drives the intake goal chips. */
  async listActiveDomains(): Promise<Array<{ value: string; label: string }>> {
    const rows: Array<{ domain: string }> = await this.unitsRepo
      .createQueryBuilder('u')
      .select('DISTINCT u.domain', 'domain')
      .where('u.is_active = true')
      .orderBy('domain', 'ASC')
      .getRawMany();
    return rows
      .map((r) => r.domain)
      .filter(Boolean)
      .map((d) => ({ value: d, label: domainTitle(d) }));
  }

  /**
   * One CareerRole + RoleRecipe per active unit domain (slug = domain),
   * so a goal answered with a domain chip resolves to a recipe covering
   * exactly the skills that domain's units teach.
   */
  private async ensureDomainRecipes(): Promise<void> {
    const domains = await this.listActiveDomains();
    if (!domains.length) return;

    const units = await this.listActiveUnits();
    const skillsByDomain = new Map<string, Set<string>>();
    for (const u of units) {
      const set = skillsByDomain.get(u.domain) ?? new Set<string>();
      for (const s of u.skillsTaught ?? []) set.add(s);
      skillsByDomain.set(u.domain, set);
    }

    for (const { value: domain, label } of domains) {
      let career = await this.careersRepo.findOne({
        where: { slug: domain },
      });
      if (!career) {
        career = await this.careersRepo.save(
          this.careersRepo.create({
            slug: domain,
            title: label,
            description: `Learn ${label} with hands-on units from the content pool.`,
            category: 'engineering',
            isActive: true,
          }),
        );
      }

      const required = [...(skillsByDomain.get(domain) ?? [])].sort();
      const existing = await this.recipesRepo.findOne({
        where: { targetRoleSlug: domain },
      });
      if (existing) {
        existing.requiredSkillIds = required;
        existing.optionalSkillIds = [];
        existing.stackPlan = { phases: [] };
        existing.requiredSkillNodeIds = [];
        existing.optionalSkillNodeIds = [];
        existing.isActive = true;
        existing.careerRoleId = career.id;
        const narrativeTitles = PHASE_NARRATIVE_TITLES[domain];
        if (narrativeTitles?.length) {
          existing.phaseNarrativeTitles = narrativeTitles;
        }
        const complementary = COMPLEMENTARY_SKILL_TAGS[domain];
        if (complementary?.length) {
          existing.complementarySkillTags = complementary;
        }
        await this.recipesRepo.save(existing);
        continue;
      }

      const narrativeTitles = PHASE_NARRATIVE_TITLES[domain] ?? [];
      const complementary = COMPLEMENTARY_SKILL_TAGS[domain] ?? [];

      await this.recipesRepo.save(
        this.recipesRepo.create({
          careerRoleId: career.id,
          targetRoleSlug: domain,
          title: label,
          summary: `${label} track built from the units content pool.`,
          version: 1,
          defaultTimelineWeeks: 12,
          stackPlan: { phases: [] },
          requiredSkillIds: required,
          optionalSkillIds: [],
          requiredSkillNodeIds: [],
          optionalSkillNodeIds: [],
          minimumAssessmentRules: { requireDiagnosticForSkip: false },
          promptHints: {},
          phaseNarrativeTitles: narrativeTitles,
          complementarySkillTags: complementary,
          isActive: true,
        }),
      );
    }

    // Retire recipes for domains that no longer have active units.
    const domainSlugs = new Set(domains.map((d) => d.value));
    const recipes = await this.recipesRepo.find({ where: { isActive: true } });
    for (const r of recipes) {
      if (!domainSlugs.has(r.targetRoleSlug)) {
        r.isActive = false;
        await this.recipesRepo.save(r);
      }
    }
  }
}

/** Domain slug → ordered narrative phase titles (engagement layer §9.2). */
const PHASE_NARRATIVE_TITLES: Record<string, string[]> = {
  frontend: [
    'Layout Apprentice',
    'Component Builder',
    'Interface Engineer',
    'Performance Tuner',
    'Production-Ready Engineer',
  ],
  'frontend-developer': [
    'Layout Apprentice',
    'Component Builder',
    'Interface Engineer',
    'Performance Tuner',
    'Production-Ready Engineer',
  ],
  'digital-marketing': [
    'Content Rookie',
    'Channel Operator',
    'Campaign Strategist',
    'Growth Analyst',
    'Marketing Lead',
  ],
  'digital-marketing-specialist': [
    'Content Rookie',
    'Channel Operator',
    'Campaign Strategist',
    'Growth Analyst',
    'Marketing Lead',
  ],
};

/** Cross-track complementary skill tags (engagement §10). */
const COMPLEMENTARY_SKILL_TAGS: Record<string, string[]> = {
  frontend: ['digital-marketing:landing-page-basics'],
  'frontend-developer': ['digital-marketing:landing-page-basics'],
  'digital-marketing': ['data-analytics:funnel-metrics', 'frontend:landing-page-basics'],
  'digital-marketing-specialist': [
    'data-analytics:funnel-metrics',
    'frontend:landing-page-basics',
  ],
};

/** 'frontend' → 'Frontend', 'data-science' → 'Data Science'. */
export function domainTitle(domain: string): string {
  return domain
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
