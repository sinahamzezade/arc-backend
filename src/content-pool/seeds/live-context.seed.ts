import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LiveContextSnippet } from '../entities/live-context-snippet.entity';

const SEED_SNIPPETS: Array<{
  trackTag: string;
  headline: string;
  body: string;
  sourceUrl: string;
  relatedSkillTags: string[];
}> = [
  {
    trackTag: 'frontend',
    headline: 'Native :has() support landed in Chrome',
    body:
      'Chrome shipped native :has() this month — it replaces many brittle JS parent-selector hacks for responsive layout tweaks.',
    sourceUrl: 'https://developer.chrome.com/docs/css-ui/has-pseudo-class',
    relatedSkillTags: ['frontend:css'],
  },
  {
    trackTag: 'digital-marketing',
    headline: 'Major ad platform shifted attribution windows',
    body:
      'A leading ad platform tightened its attribution window this week — reported CTR and CPA may look different even when spend is flat.',
    sourceUrl: 'https://example.com/attribution-update',
    relatedSkillTags: ['digital-marketing:campaign-analytics'],
  },
  {
    trackTag: 'data-analytics',
    headline: 'Pandas default copy-on-write behavior changed',
    body:
      'The latest pandas release changed default copy-on-write semantics — notebooks that relied on implicit copies may need explicit .copy() calls.',
    sourceUrl: 'https://pandas.pydata.org/docs/user_guide/copy_on_write.html',
    relatedSkillTags: ['data-analytics:python'],
  },
];

@Injectable()
export class LiveContextSeedService implements OnModuleInit {
  private readonly logger = new Logger(LiveContextSeedService.name);

  constructor(
    @InjectRepository(LiveContextSnippet)
    private readonly snippetsRepo: Repository<LiveContextSnippet>,
  ) {}

  async onModuleInit() {
    try {
      await this.seedIfEmpty();
    } catch (err) {
      this.logger.warn(
        `Live context seed skipped: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async seedIfEmpty(): Promise<number> {
    const count = await this.snippetsRepo.count();
    if (count > 0) return 0;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    for (const row of SEED_SNIPPETS) {
      await this.snippetsRepo.save(
        this.snippetsRepo.create({
          trackTag: row.trackTag,
          headline: row.headline,
          body: row.body,
          sourceUrl: row.sourceUrl,
          publishedAt: now,
          expiresAt,
          relatedSkillTags: row.relatedSkillTags,
          isActive: true,
        }),
      );
    }

    this.logger.log(`Seeded ${SEED_SNIPPETS.length} live_context snippets`);
    return SEED_SNIPPETS.length;
  }
}
