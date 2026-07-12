import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RefreshToken } from '../entities/refresh-token.entity';
import { User } from '../../users/entities/user.entity';
import { PasswordService } from './password.service';

export type AccessTokenPayload = {
  sub: string;
  email: string;
  email_verified: boolean;
};

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly passwordService: PasswordService,
    @InjectRepository(RefreshToken)
    private readonly refreshRepo: Repository<RefreshToken>,
  ) {}

  get accessTtlSeconds(): number {
    return this.parseTtlSeconds(
      this.config.get<string>('JWT_ACCESS_TTL') || '15m',
    );
  }

  get refreshTtlMs(): number {
    return (
      this.parseTtlSeconds(
        this.config.get<string>('JWT_REFRESH_TTL') || '30d',
      ) * 1000
    );
  }

  async issueAccessToken(user: User): Promise<{
    accessToken: string;
    expiresIn: number;
  }> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      email_verified: Boolean(user.emailVerifiedAt),
    };

    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: (this.config.get<string>('JWT_ACCESS_TTL') ||
        '15m') as `${number}m`,
    });

    return { accessToken, expiresIn: this.accessTtlSeconds };
  }

  async issueRefreshToken(
    user: User,
    meta?: { userAgent?: string; ip?: string },
  ): Promise<string> {
    const raw = this.passwordService.generateRefreshToken();
    const tokenHash = this.passwordService.hashToken(raw);
    const expiresAt = new Date(Date.now() + this.refreshTtlMs);

    await this.refreshRepo.save(
      this.refreshRepo.create({
        userId: user.id,
        tokenHash,
        expiresAt,
        userAgent: meta?.userAgent ?? null,
        ip: meta?.ip ?? null,
      }),
    );

    return raw;
  }

  async rotateRefreshToken(
    rawToken: string,
    meta?: { userAgent?: string; ip?: string },
  ): Promise<{ user: User; refreshToken: string } | null> {
    const tokenHash = this.passwordService.hashToken(rawToken);
    const existing = await this.refreshRepo.findOne({
      where: { tokenHash },
      relations: { user: true },
    });

    if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
      if (existing && existing.revokedAt) {
        // Reuse detection — revoke all for user
        await this.revokeAllForUser(existing.userId);
      }
      return null;
    }

    existing.revokedAt = new Date();
    await this.refreshRepo.save(existing);

    const refreshToken = await this.issueRefreshToken(existing.user, meta);
    return { user: existing.user, refreshToken };
  }

  async revokeRefreshToken(rawToken: string): Promise<void> {
    const tokenHash = this.passwordService.hashToken(rawToken);
    const existing = await this.refreshRepo.findOne({ where: { tokenHash } });
    if (existing && !existing.revokedAt) {
      existing.revokedAt = new Date();
      await this.refreshRepo.save(existing);
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.refreshRepo
      .createQueryBuilder()
      .update(RefreshToken)
      .set({ revokedAt: () => 'NOW()' })
      .where('user_id = :userId', { userId })
      .andWhere('revoked_at IS NULL')
      .execute();
  }

  private parseTtlSeconds(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl.trim());
    if (!match) return 900;
    const n = Number(match[1]);
    const unit = match[2];
    switch (unit) {
      case 's':
        return n;
      case 'm':
        return n * 60;
      case 'h':
        return n * 3600;
      case 'd':
        return n * 86400;
      default:
        return 900;
    }
  }
}
