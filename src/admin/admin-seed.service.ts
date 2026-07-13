import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PasswordService } from '../auth/services/password.service';
import { normalizeEmail } from '../common/utils/email.util';
import { Profile } from '../profiles/entities/profile.entity';
import { AuthProvider, User } from '../users/entities/user.entity';

/** Dev defaults — override via ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD. */
const DEFAULT_ADMIN_EMAIL = 'ops.ctrl.9f2a@arc.internal';
const DEFAULT_ADMIN_PASSWORD = 'K7#mQ9$vL2!pR4xW8nT';
const LEGACY_WEAK_ADMIN_EMAIL = 'admin@arc.local';

@Injectable()
export class AdminSeedService implements OnModuleInit {
  private readonly logger = new Logger(AdminSeedService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly passwordService: PasswordService,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @InjectRepository(Profile)
    private readonly profilesRepo: Repository<Profile>,
  ) {}

  async onModuleInit() {
    if (this.config.get<string>('ADMIN_SEED') === 'false') return;
    try {
      await this.ensureAdmin();
      await this.retireLegacyWeakAdmin();
    } catch (err) {
      this.logger.warn(
        `Admin seed skipped: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async ensureAdmin(): Promise<void> {
    const email = normalizeEmail(
      this.config.get<string>('ADMIN_SEED_EMAIL') || DEFAULT_ADMIN_EMAIL,
    );
    const password =
      this.config.get<string>('ADMIN_SEED_PASSWORD') || DEFAULT_ADMIN_PASSWORD;

    let user = await this.usersRepo.findOne({ where: { email } });
    const passwordHash = await this.passwordService.hash(password);

    if (!user) {
      user = await this.usersRepo.save(
        this.usersRepo.create({
          email,
          passwordHash,
          passwordLastChangedAt: new Date(),
          emailVerifiedAt: new Date(),
          authProvider: AuthProvider.EMAIL,
          isActive: true,
          isAdmin: true,
        }),
      );

      await this.profilesRepo.save(
        this.profilesRepo.create({
          userId: user.id,
          displayName: 'Arc Ops',
          username: 'ops_ctrl_9f2a',
          language: 'en',
          totalXp: 0,
          coins: 0,
          gems: 0,
          weeklyStreak: 0,
        }),
      );

      this.logger.log(`Seeded admin user ${email}`);
      return;
    }

    user.isAdmin = true;
    user.isActive = true;
    user.emailVerifiedAt = user.emailVerifiedAt ?? new Date();
    user.passwordHash = passwordHash;
    user.passwordLastChangedAt = new Date();
    await this.usersRepo.save(user);
    this.logger.log(`Synced admin credentials for ${email}`);

    const profile = await this.profilesRepo.findOne({
      where: { userId: user.id },
    });
    if (!profile) {
      await this.profilesRepo.save(
        this.profilesRepo.create({
          userId: user.id,
          displayName: 'Arc Ops',
          username: 'ops_ctrl_9f2a',
          language: 'en',
          totalXp: 0,
          coins: 0,
          gems: 0,
          weeklyStreak: 0,
        }),
      );
    }
  }

  /** Strip admin flag from the previous weak default seed account. */
  private async retireLegacyWeakAdmin(): Promise<void> {
    const seedEmail = normalizeEmail(
      this.config.get<string>('ADMIN_SEED_EMAIL') || DEFAULT_ADMIN_EMAIL,
    );
    if (seedEmail === LEGACY_WEAK_ADMIN_EMAIL) return;

    const legacy = await this.usersRepo.findOne({
      where: { email: LEGACY_WEAK_ADMIN_EMAIL },
    });
    if (!legacy?.isAdmin) return;

    legacy.isAdmin = false;
    await this.usersRepo.save(legacy);
    this.logger.log(`Retired legacy weak admin ${LEGACY_WEAK_ADMIN_EMAIL}`);
  }
}
