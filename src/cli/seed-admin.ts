import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminSeedService } from '../admin/admin-seed.service';
import { AuthChallenge } from '../auth/entities/auth-challenge.entity';
import { AuthIdentity } from '../auth/entities/auth-identity.entity';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { PasswordService } from '../auth/services/password.service';
import { typeOrmPostgresConfig } from '../common/database/typeorm-postgres.config';
import { Profile } from '../profiles/entities/profile.entity';
import { User } from '../users/entities/user.entity';

/** All entities User relation graph needs (TypeORM metadata). */
const SEED_ENTITIES = [
  User,
  Profile,
  AuthIdentity,
  AuthChallenge,
  RefreshToken,
];

/**
 * Lean Nest context for ops CLI — no HTTP, no full AppModule side-effects.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        typeOrmPostgresConfig(config, {
          entities: SEED_ENTITIES,
          synchronize: false,
        }),
    }),
    TypeOrmModule.forFeature([User, Profile]),
  ],
  providers: [PasswordService, AdminSeedService],
})
class SeedAdminCliModule {}

function usage(): never {
  console.error(`Usage:
  npm run seed:admin
  npm run seed:admin -- --email admin@example.com --password 'Secret123!'

Env (used when flags omitted):
  ADMIN_SEED_EMAIL
  ADMIN_SEED_PASSWORD
  DATABASE_URL   (Railway)  OR  DB_HOST DB_PORT DB_USERNAME DB_PASSWORD DB_NAME
  DB_SSL=true|false  (optional; auto for Railway URLs)
`);
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const out: { email?: string; password?: string; help?: boolean } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--email' || a === '-e') out.email = argv[++i];
    else if (a === '--password' || a === '-p') out.password = argv[++i];
    else if (a.startsWith('--email=')) out.email = a.slice('--email='.length);
    else if (a.startsWith('--password='))
      out.password = a.slice('--password='.length);
    else {
      console.error(`Unknown arg: ${a}`);
      usage();
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) usage();

  if (args.email) process.env.ADMIN_SEED_EMAIL = args.email;
  if (args.password) process.env.ADMIN_SEED_PASSWORD = args.password;
  // Prevent AdminSeedService.onModuleInit from double-running; CLI calls runSeed().
  process.env.ADMIN_SEED = 'false';

  const logger = new Logger('seed-admin');
  const app = await NestFactory.createApplicationContext(SeedAdminCliModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const seed = app.get(AdminSeedService);
    const result = await seed.runSeed();
    logger.log(
      result.created
        ? `Admin created: ${result.email}`
        : `Admin updated: ${result.email}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
