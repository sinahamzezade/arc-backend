import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUserPayload } from '../../common/decorators/current-user.decorator';
import { UsersService } from '../../users/users.service';
import { AccessTokenPayload } from '../services/token.service';
import { AuthUserCacheService } from '../services/auth-user-cache.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly usersService: UsersService,
    private readonly authUserCache: AuthUserCacheService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthUserPayload> {
    const cached = await this.authUserCache.get(payload.sub);
    if (cached) {
      return cached;
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.isActive || user.deletedAt) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Unauthorized',
      });
    }

    const authUser: AuthUserPayload = {
      userId: user.id,
      email: user.email,
      emailVerified: Boolean(user.emailVerifiedAt),
    };
    await this.authUserCache.set(user.id, authUser);
    return authUser;
  }
}
