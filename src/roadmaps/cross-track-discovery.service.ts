import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  OUTBOX_CROSS_TRACK_COMPLETED,
  OUTBOX_CROSS_TRACK_SURFACED,
} from '../gamification/reward-constants';
import { OutboxService } from '../gamification/outbox.service';
import { Unit } from '../content-pool/entities/unit.entity';
import { RoleRecipe } from '../skill-graph/entities/role-recipe.entity';
import { Roadmap } from '../roadmaps/entities/roadmap.entity';

/**
 * Optional cross-track discovery nudges (doc 10 §10).
 * At most one optional unit per week from complementary skill tags,
 * only when weekly budget has slack — never displaces required content.
 */
@Injectable()
export class CrossTrackDiscoveryService {
  private readonly logger = new Logger(CrossTrackDiscoveryService.name);

  constructor(
    @InjectRepository(RoleRecipe)
    private readonly recipesRepo: Repository<RoleRecipe>,
    @InjectRepository(Unit)
    private readonly unitsRepo: Repository<Unit>,
    @InjectRepository(Roadmap)
    private readonly roadmapsRepo: Repository<Roadmap>,
    private readonly outbox: OutboxService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * After checkpoint/phase completion — surface at most one optional
   * cross-track unit if complementary tags + budget slack allow.
   */
  async maybeSurface(input: {
    userId: string;
    roadmapId: string;
    remainingBudgetMinutes: number;
    justCompletedUnitRole?: string | null;
  }): Promise<{
    surfaced: boolean;
    unitId?: string;
    title?: string;
    estimatedMinutes?: number;
    reason?: string;
  }> {
    const role = input.justCompletedUnitRole?.toLowerCase() ?? '';
    if (role !== 'checkpoint' && role !== 'proof') {
      return { surfaced: false, reason: 'not_checkpoint' };
    }

    const weekStart = this.weekStartDate();
    const existing = await this.dataSource.query(
      `SELECT id FROM cross_track_nudges
       WHERE user_id = $1 AND week_start = $2
       LIMIT 1`,
      [input.userId, weekStart],
    );
    if (existing?.length) {
      return { surfaced: false, reason: 'already_surfaced_this_week' };
    }

    const roadmap = await this.roadmapsRepo.findOne({
      where: { id: input.roadmapId },
    });
    if (!roadmap?.primaryRoleSlug) {
      return { surfaced: false, reason: 'no_primary_role' };
    }

    const recipe = await this.recipesRepo.findOne({
      where: { targetRoleSlug: roadmap.primaryRoleSlug, isActive: true },
    });
    const tags = recipe?.complementarySkillTags ?? [];
    if (!tags.length) {
      return { surfaced: false, reason: 'no_complementary_tags' };
    }

    // Pick a foundation unit from a different domain matching a complementary tag.
    const candidates = await this.unitsRepo
      .createQueryBuilder('u')
      .where('u.is_active = true')
      .andWhere('u.unit_role = :role', { role: 'foundation' })
      .andWhere('u.domain != :domain', {
        domain: roadmap.primaryRoleSlug.split('-')[0] || 'frontend',
      })
      .andWhere(
        `(u.skills_taught && :tags OR u.profile_skill_slug = ANY(:tags))`,
        { tags },
      )
      .orderBy('u.estimated_minutes', 'ASC')
      .take(10)
      .getMany();

    // Fallback: match complementary tag prefix against skills_taught
    let pick =
      candidates.find((u) =>
        (u.skillsTaught ?? []).some((s) =>
          tags.some(
            (t) =>
              s === t ||
              s.startsWith(t.split(':')[0] + ':') ||
              t.includes(s),
          ),
        ),
      ) ?? candidates[0];

    if (!pick) {
      // Broader fallback: any foundation unit whose skill overlaps tag stem
      const stems = tags.map((t) => t.split(':')[0]).filter(Boolean);
      if (stems.length) {
        pick =
          (
            await this.unitsRepo
              .createQueryBuilder('u')
              .where('u.is_active = true')
              .andWhere('u.unit_role = :role', { role: 'foundation' })
              .andWhere(
                `EXISTS (
                  SELECT 1 FROM unnest(u.skills_taught) AS skill
                  WHERE split_part(skill, ':', 1) = ANY(:stems)
                )`,
                { stems },
              )
              .orderBy('u.estimated_minutes', 'ASC')
              .take(1)
              .getMany()
          )[0] ?? undefined;
      }
    }

    if (!pick) {
      return { surfaced: false, reason: 'no_candidate' };
    }

    if (pick.estimatedMinutes > input.remainingBudgetMinutes) {
      return { surfaced: false, reason: 'CROSS_TRACK_BUDGET_EXCEEDED' };
    }

    await this.dataSource.query(
      `INSERT INTO cross_track_nudges (user_id, roadmap_id, unit_id, week_start)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, week_start) DO NOTHING`,
      [input.userId, input.roadmapId, pick.id, weekStart],
    );

    await this.dataSource.transaction(async (manager) => {
      await this.outbox.enqueue(manager, {
        type: OUTBOX_CROSS_TRACK_SURFACED,
        aggregateId: input.roadmapId,
        payload: {
          userId: input.userId,
          roadmapId: input.roadmapId,
          unitId: pick.id,
          estimatedMinutes: pick.estimatedMinutes,
          weekStart,
        },
      });
    });

    this.logger.log(
      `Cross-track nudge surfaced unit=${pick.id} for user=${input.userId}`,
    );

    return {
      surfaced: true,
      unitId: pick.id,
      title: pick.title,
      estimatedMinutes: pick.estimatedMinutes,
    };
  }

  async getActiveNudge(userId: string): Promise<{
    unitId: string;
    title: string;
    estimatedMinutes: number;
    optional: true;
  } | null> {
    const weekStart = this.weekStartDate();
    const rows: Array<{ unit_id: string; completed_at: Date | null }> =
      await this.dataSource.query(
        `SELECT unit_id, completed_at FROM cross_track_nudges
         WHERE user_id = $1 AND week_start = $2
         LIMIT 1`,
        [userId, weekStart],
      );
    if (!rows?.length || rows[0].completed_at) return null;

    const unit = await this.unitsRepo.findOne({
      where: { id: rows[0].unit_id },
    });
    if (!unit) return null;

    return {
      unitId: unit.id,
      title: unit.title,
      estimatedMinutes: unit.estimatedMinutes,
      optional: true,
    };
  }

  async markCompleted(userId: string, unitId: string): Promise<void> {
    const weekStart = this.weekStartDate();
    await this.dataSource.query(
      `UPDATE cross_track_nudges
       SET completed_at = now()
       WHERE user_id = $1 AND week_start = $2 AND unit_id = $3`,
      [userId, weekStart, unitId],
    );
    await this.dataSource.transaction(async (manager) => {
      await this.outbox.enqueue(manager, {
        type: OUTBOX_CROSS_TRACK_COMPLETED,
        aggregateId: unitId,
        payload: { userId, unitId, weekStart },
      });
    });
  }

  private weekStartDate(): string {
    const now = new Date();
    const day = now.getUTCDay();
    const diff = (day + 6) % 7; // Monday start
    const monday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diff),
    );
    return monday.toISOString().slice(0, 10);
  }
}
