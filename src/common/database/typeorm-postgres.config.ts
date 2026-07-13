import type { ConfigService } from '@nestjs/config';
import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

type DbOpts = {
  entities?: TypeOrmModuleOptions['entities'];
  autoLoadEntities?: boolean;
  synchronize?: boolean;
};

/**
 * Shared Postgres config for Nest app + ops CLIs.
 * Prefers DATABASE_URL (Railway); falls back to DB_HOST / DB_* vars.
 */
export function typeOrmPostgresConfig(
  config: ConfigService,
  opts: DbOpts = {},
): TypeOrmModuleOptions {
  const url = config.get<string>('DATABASE_URL')?.trim();
  const synchronize =
    opts.synchronize ?? config.get<string>('DB_SYNC') !== 'false';
  const ssl = resolveSsl(config, url);

  if (url) {
    return {
      type: 'postgres',
      url,
      ssl,
      autoLoadEntities: opts.autoLoadEntities,
      entities: opts.entities,
      synchronize,
    };
  }

  return {
    type: 'postgres',
    host: config.get<string>('DB_HOST'),
    port: Number(config.get('DB_PORT') ?? 5432),
    username: config.get<string>('DB_USERNAME'),
    password: config.get<string>('DB_PASSWORD'),
    database: config.get<string>('DB_NAME'),
    ssl,
    autoLoadEntities: opts.autoLoadEntities,
    entities: opts.entities,
    synchronize,
  };
}

function resolveSsl(config: ConfigService, url?: string) {
  const flag = config.get<string>('DB_SSL') ?? config.get<string>('DATABASE_SSL');
  if (flag === 'false') return undefined;
  if (flag === 'true') return { rejectUnauthorized: false };

  // Railway public / proxy hosts usually require TLS
  if (
    url &&
    (url.includes('railway') ||
      url.includes('rlwy.net') ||
      url.includes('proxy.rlwy.net'))
  ) {
    return { rejectUnauthorized: false };
  }

  return undefined;
}
