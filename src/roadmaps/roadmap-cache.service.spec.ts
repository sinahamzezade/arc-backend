import { ConfigService } from '@nestjs/config';
import { JsonCacheService } from '../common/cache/json-cache.service';
import { Roadmap, RoadmapStatus } from './entities/roadmap.entity';
import { RoadmapCacheService } from './roadmap-cache.service';

describe('RoadmapCacheService', () => {
  const memory = new Map<string, string>();

  const jsonCache = {
    getJson: jest.fn(async (key: string) => {
      const raw = memory.get(key);
      return raw ? JSON.parse(raw) : null;
    }),
    setJson: jest.fn(async (key: string, value: unknown) => {
      memory.set(key, JSON.stringify(value));
    }),
    del: jest.fn(async (...keys: string[]) => {
      for (const key of keys) memory.delete(key);
    }),
    delByPrefix: jest.fn(),
  } as unknown as JsonCacheService;

  const config = {
    get: jest.fn(() => '120'),
  } as unknown as ConfigService;

  let service: RoadmapCacheService;

  beforeEach(() => {
    memory.clear();
    jest.clearAllMocks();
    service = new RoadmapCacheService(jsonCache, config);
  });

  it('caches tree and ordinals for a roadmap', async () => {
    const roadmap = Object.assign(new Roadmap(), {
      id: 'roadmap-1',
      title: 'Backend',
      primaryRoleSlug: 'backend',
      timelineWeeks: 12,
      progressPercent: '0',
      currentPhaseId: null,
      status: RoadmapStatus.Ready,
      phases: [],
    });

    await service.setTree(roadmap);
    await service.setOrdinals('roadmap-1', { 'lesson-1': 1 });

    await expect(service.getTree('roadmap-1')).resolves.toMatchObject({
      id: 'roadmap-1',
      title: 'Backend',
    });
    await expect(service.getOrdinals('roadmap-1')).resolves.toEqual({
      'lesson-1': 1,
    });
  });

  it('invalidates roadmap tree, ordinals, and active pointer', async () => {
    await service.setActiveRoadmapId('user-1', 'roadmap-1');
    await service.setOrdinals('roadmap-1', { 'lesson-1': 1 });

    await service.invalidateRoadmap('roadmap-1', 'user-1');

    await expect(service.getActiveRoadmapId('user-1')).resolves.toBeNull();
    await expect(service.getOrdinals('roadmap-1')).resolves.toBeNull();
    expect(jsonCache.del).toHaveBeenCalledWith(
      'roadmap:tree:roadmap-1',
      'roadmap:ordinals:roadmap-1',
    );
  });
});
