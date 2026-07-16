import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Goal, GoalStatus } from '../goals/entities/goal.entity';
import { User } from '../users/entities/user.entity';
import { UnitsCatalogService } from '../content-pool/units-catalog.service';

export type AdminGoalRow = {
  id: string;
  userId: string;
  userEmail: string;
  targetRoles: string[];
  rolesLabel: string;
  status: GoalStatus;
  weeklyHours: string | null;
  targetDeadline: string | null;
  confidence: string | null;
  updatedAt: string;
  createdAt: string;
};

@Injectable()
export class AdminGoalsService {
  constructor(
    @InjectRepository(Goal)
    private readonly goalsRepo: Repository<Goal>,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly unitsCatalog: UnitsCatalogService,
  ) {}

  async listDomains(): Promise<Array<{ value: string; label: string }>> {
    return this.unitsCatalog.listActiveDomains();
  }

  async list(opts?: {
    status?: GoalStatus | 'all';
    q?: string;
    limit?: number;
  }): Promise<AdminGoalRow[]> {
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 300);
    const qb = this.goalsRepo
      .createQueryBuilder('g')
      .orderBy('g.updatedAt', 'DESC')
      .take(limit);

    if (opts?.status && opts.status !== 'all') {
      qb.andWhere('g.status = :status', { status: opts.status });
    }

    const q = opts?.q?.trim();
    if (q) {
      const emailUsers = await this.usersRepo
        .createQueryBuilder('u')
        .select('u.id')
        .where('u.email ILIKE :q', { q: `%${q}%` })
        .take(50)
        .getMany();
      const emailIds = emailUsers.map((u) => u.id);
      if (emailIds.length) {
        qb.andWhere(
          `(g.id::text ILIKE :q OR g.user_id::text ILIKE :q OR g.user_id IN (:...emailIds) OR EXISTS (
            SELECT 1 FROM unnest(g.target_roles) AS r WHERE r ILIKE :q
          ))`,
          { q: `%${q}%`, emailIds },
        );
      } else {
        qb.andWhere(
          `(g.id::text ILIKE :q OR g.user_id::text ILIKE :q OR EXISTS (
            SELECT 1 FROM unnest(g.target_roles) AS r WHERE r ILIKE :q
          ))`,
          { q: `%${q}%` },
        );
      }
    }

    const rows = await qb.getMany();
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const users = userIds.length
      ? await this.usersRepo.find({ where: { id: In(userIds) } })
      : [];
    const emailById = new Map(users.map((u) => [u.id, u.email]));

    return rows.map((g) => this.toRow(g, emailById.get(g.userId) ?? '—'));
  }

  async get(id: string): Promise<AdminGoalRow | null> {
    const g = await this.goalsRepo.findOne({ where: { id } });
    if (!g) return null;
    const user = await this.usersRepo.findOne({ where: { id: g.userId } });
    return this.toRow(g, user?.email ?? '—');
  }

  async update(
    id: string,
    input: {
      targetRoles: string[];
      status: GoalStatus;
      weeklyHours: string | null;
      targetDeadline: string | null;
      confidence: string | null;
    },
  ): Promise<AdminGoalRow> {
    const g = await this.goalsRepo.findOne({ where: { id } });
    if (!g) throw new BadRequestException('Goal not found');

    const roles = [
      ...new Set(
        input.targetRoles
          .map((r) => r.trim().toLowerCase())
          .filter(Boolean),
      ),
    ];
    if (!roles.length) {
      throw new BadRequestException('target_roles must have at least one slug');
    }

    if (!Object.values(GoalStatus).includes(input.status)) {
      throw new BadRequestException('Invalid status');
    }

    g.targetRoles = roles;
    g.status = input.status;
    g.weeklyHours = input.weeklyHours?.trim() || null;
    g.targetDeadline = input.targetDeadline?.trim() || null;
    g.confidence = input.confidence?.trim() || null;
    await this.goalsRepo.save(g);

    const user = await this.usersRepo.findOne({ where: { id: g.userId } });
    return this.toRow(g, user?.email ?? '—');
  }

  private toRow(g: Goal, userEmail: string): AdminGoalRow {
    const roles = (g.targetRoles ?? []).filter(Boolean);
    return {
      id: g.id,
      userId: g.userId,
      userEmail,
      targetRoles: roles,
      rolesLabel: roles.join(', ') || '—',
      status: g.status,
      weeklyHours: g.weeklyHours,
      targetDeadline: g.targetDeadline,
      confidence: g.confidence,
      updatedAt: g.updatedAt.toISOString(),
      createdAt: g.createdAt.toISOString(),
    };
  }
}
