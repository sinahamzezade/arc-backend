import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  LearnerProfileDto,
  ContentSnapshotDto,
  PlanResponseDto,
  ReplanCurrentStateDto,
} from './dto/roadmap-engine.types';

@Injectable()
export class RoadmapEngineClient {
  private readonly logger = new Logger(RoadmapEngineClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly engineVersion: number;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = (
      config.get<string>('ROADMAP_ENGINE_URL') ?? 'http://localhost:8080'
    ).replace(/\/$/, '');
    this.timeoutMs = Number(
      config.get('ROADMAP_GENERATION_TIMEOUT_MS') ?? 15_000,
    );
    this.engineVersion = Number(config.get('ROADMAP_ENGINE_VERSION') ?? 2);
  }

  getEngineVersion(): number {
    return this.engineVersion;
  }

  async health(): Promise<{ status: string; engineVersion: number }> {
    const res = await this.fetchJson<{ status: string; engineVersion: number }>(
      '/v1/health',
      { method: 'GET' },
    );
    return res;
  }

  async plan(
    profile: LearnerProfileDto,
    snapshot: ContentSnapshotDto,
    seed: number,
  ): Promise<PlanResponseDto> {
    return this.fetchJson<PlanResponseDto>('/v1/plan', {
      method: 'POST',
      body: JSON.stringify({ profile, snapshot, seed }),
    });
  }

  async replan(
    profile: LearnerProfileDto,
    snapshot: ContentSnapshotDto,
    seed: number,
    currentState: ReplanCurrentStateDto,
  ): Promise<PlanResponseDto> {
    return this.fetchJson<PlanResponseDto>('/v1/replan', {
      method: 'POST',
      body: JSON.stringify({
        profile,
        snapshot,
        seed,
        current_state: currentState,
      }),
    });
  }

  private async fetchJson<T>(
    path: string,
    init: RequestInit,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.logger.error(
          `Engine ${path} HTTP ${res.status}: ${text.slice(0, 300)}`,
        );
        throw new Error(`Roadmap engine HTTP ${res.status}`);
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
