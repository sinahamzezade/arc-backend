import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ReminderPlannerService } from './reminder-planner.service';
import { TimingService } from './timing.service';

/**
 * In-process idempotent jobs (Bull later).
 * Keys conceptually: schedule_version + job name.
 */
@Injectable()
export class TimingJobsProcessor implements OnModuleInit {
  private readonly logger = new Logger(TimingJobsProcessor.name);
  private started = false;

  constructor(
    private readonly reminders: ReminderPlannerService,
    private readonly timing: TimingService,
  ) {}

  onModuleInit() {
    if (process.env.TIMING_JOBS_DISABLED === 'true') return;
    if (this.started) return;
    this.started = true;
    const intervalMs = Number(process.env.TIMING_JOBS_INTERVAL_MS ?? 60_000);
    setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.logger.log(`Course timing jobs interval=${intervalMs}ms`);
  }

  async tick(): Promise<void> {
    try {
      const sent = await this.reminders.dispatchDue(40);
      const missed = await this.timing.reconcileMissedSlots();
      if (sent || missed) {
        this.logger.debug(`timing jobs sent=${sent} missed=${missed}`);
      }
    } catch (err) {
      this.logger.warn(
        `timing tick failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Manual / cron entry for daily pace. */
  async runDailyPace(): Promise<number> {
    return this.timing.takeDailyPaceSnapshot();
  }
}
