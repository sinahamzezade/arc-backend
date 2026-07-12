import { Injectable, Logger } from '@nestjs/common';

export type TimingAnalyticsEvent =
  | 'schedule_generated'
  | 'schedule_replanned'
  | 'slot_started'
  | 'slot_completed'
  | 'slot_missed'
  | 'reminder_sent'
  | 'reminder_opened'
  | 'pace_state_changed'
  | 'estimated_completion_changed'
  | 'content_window_expanded';

@Injectable()
export class TimingAnalyticsService {
  private readonly logger = new Logger(TimingAnalyticsService.name);

  emit(event: TimingAnalyticsEvent, payload: Record<string, unknown>): void {
    this.logger.log(
      JSON.stringify({
        domain: 'course_timing',
        event,
        ts: new Date().toISOString(),
        ...payload,
      }),
    );
  }
}
