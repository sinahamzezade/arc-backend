import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  OutboxEvent,
  OutboxEventStatus,
} from './entities/outbox-event.entity';

@Injectable()
export class OutboxService {
  async enqueue(
    manager: EntityManager,
    input: {
      type: string;
      aggregateId?: string | null;
      payload: Record<string, unknown>;
    },
  ): Promise<OutboxEvent> {
    const repo = manager.getRepository(OutboxEvent);
    return repo.save(
      repo.create({
        type: input.type,
        aggregateId: input.aggregateId ?? null,
        payload: input.payload,
        status: OutboxEventStatus.Pending,
      }),
    );
  }

  async markPublished(manager: EntityManager, id: string): Promise<void> {
    await manager.getRepository(OutboxEvent).update(id, {
      status: OutboxEventStatus.Published,
      publishedAt: new Date(),
    });
  }

  async markFailed(
    manager: EntityManager,
    id: string,
    error: string,
  ): Promise<void> {
    const repo = manager.getRepository(OutboxEvent);
    const row = await repo.findOne({ where: { id } });
    if (!row) return;
    row.status = OutboxEventStatus.Failed;
    row.attempts += 1;
    row.lastError = error.slice(0, 2000);
    await repo.save(row);
  }
}
