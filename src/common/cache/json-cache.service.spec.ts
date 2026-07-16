import { ConfigService } from '@nestjs/config';
import { JsonCacheService } from './json-cache.service';
import { RedisService } from '../redis/redis.service';

describe('JsonCacheService', () => {
  const redis = {
    isAvailable: false,
    get: jest.fn(),
    set: jest.fn(),
    raw: null as null,
  } as unknown as RedisService;

  const config = {
    get: jest.fn((key: string) =>
      key === 'CACHE_DEFAULT_TTL_SEC' ? '300' : undefined,
    ),
  } as unknown as ConfigService;

  let service: JsonCacheService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new JsonCacheService(redis, config);
  });

  it('stores and reads JSON in memory when Redis is unavailable', async () => {
    await service.setJson('test:key', { ok: true }, 60);
    await expect(service.getJson<{ ok: boolean }>('test:key')).resolves.toEqual({
      ok: true,
    });
  });

  it('deletes keys from memory', async () => {
    await service.setJson('test:del', 'value', 60);
    await service.del('test:del');
    await expect(service.getJson('test:del')).resolves.toBeNull();
  });

  it('deletes keys by prefix via memory scan', async () => {
    await service.setJson('prefix:a', 1, 60);
    await service.setJson('prefix:b', 2, 60);
    await service.setJson('other:c', 3, 60);

    const removed = await service.delByPrefix('prefix:');
    expect(removed).toBe(2);
    await expect(service.getJson('prefix:a')).resolves.toBeNull();
    await expect(service.getJson('other:c')).resolves.toEqual(3);
  });

  it('expires entries after TTL in memory mode', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000);
    await service.setJson('ttl:key', 'fresh', 1);
    jest.spyOn(Date, 'now').mockReturnValue(3_000);
    await expect(service.getJson('ttl:key')).resolves.toBeNull();
    jest.restoreAllMocks();
  });
});
