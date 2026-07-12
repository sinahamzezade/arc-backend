import { Injectable, Logger } from '@nestjs/common';

/**
 * Structured content analytics — log sink now; swap for event bus later.
 */
@Injectable()
export class ContentAnalyticsService {
  private readonly logger = new Logger('ContentAnalytics');

  emit(
    event:
      | 'content_version_published'
      | 'content_selected_for_roadmap'
      | 'content_skipped_known_skill'
      | 'content_batch_materialized'
      | 'content_resource_failed'
      | 'content_quality_flagged'
      | 'battle_question_set_created'
      | 'content_cache_invalidated',
    payload: Record<string, unknown> = {},
  ): void {
    this.logger.log(
      JSON.stringify({
        event,
        at: new Date().toISOString(),
        ...payload,
      }),
    );
  }
}
