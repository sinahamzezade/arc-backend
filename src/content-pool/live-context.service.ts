import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LiveContextSnippet } from './entities/live-context-snippet.entity';

export type LiveContextPublic = {
  id: string;
  trackTag: string;
  headline: string;
  body: string;
  sourceUrl: string | null;
  publishedAt: string;
};

@Injectable()
export class LiveContextService {
  constructor(
    @InjectRepository(LiveContextSnippet)
    private readonly snippetsRepo: Repository<LiveContextSnippet>,
  ) {}

  /**
   * Freshest non-expired active snippet for track_tag.
   * Returns null when none fresh (caller omits block — never fabricate).
   */
  async resolveFresh(
    trackTag: string,
    preferredSkillTags?: string[],
  ): Promise<LiveContextPublic | null> {
    const tag = trackTag?.trim();
    if (!tag) return null;

    const now = new Date();
    const qb = this.snippetsRepo
      .createQueryBuilder('s')
      .where('s.is_active = true')
      .andWhere('s.track_tag = :tag', { tag })
      .andWhere('s.expires_at > :now', { now })
      .orderBy('s.published_at', 'DESC')
      .take(20);

    const rows = await qb.getMany();
    if (!rows.length) return null;

    let picked = rows[0];
    if (preferredSkillTags?.length) {
      const pref = new Set(preferredSkillTags.map((t) => t.toLowerCase()));
      const match = rows.find((r) =>
        (r.relatedSkillTags ?? []).some((t) => pref.has(t.toLowerCase())),
      );
      if (match) picked = match;
    }

    return {
      id: picked.id,
      trackTag: picked.trackTag,
      headline: picked.headline,
      body: picked.body,
      sourceUrl: picked.sourceUrl,
      publishedAt: picked.publishedAt.toISOString(),
    };
  }

  async listAdmin(limit = 100): Promise<LiveContextSnippet[]> {
    return this.snippetsRepo.find({
      order: { publishedAt: 'DESC' },
      take: limit,
    });
  }

  async upsert(input: {
    id?: string;
    trackTag: string;
    headline: string;
    body: string;
    sourceUrl?: string | null;
    publishedAt: Date;
    expiresAt: Date;
    relatedSkillTags?: string[];
    isActive?: boolean;
  }): Promise<LiveContextSnippet> {
    let row: LiveContextSnippet | null = null;
    if (input.id) {
      row = await this.snippetsRepo.findOne({ where: { id: input.id } });
    }
    if (!row) {
      row = this.snippetsRepo.create();
    }
    row.trackTag = input.trackTag.trim();
    row.headline = input.headline.trim();
    row.body = input.body.trim();
    row.sourceUrl = input.sourceUrl ?? null;
    row.publishedAt = input.publishedAt;
    row.expiresAt = input.expiresAt;
    row.relatedSkillTags = input.relatedSkillTags ?? [];
    row.isActive = input.isActive ?? true;
    return this.snippetsRepo.save(row);
  }

  async softDeactivate(id: string): Promise<void> {
    await this.snippetsRepo.update({ id }, { isActive: false });
  }
}
