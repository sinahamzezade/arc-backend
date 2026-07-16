import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfilesModule } from '../profiles/profiles.module';
import { ReferralsModule } from '../referrals/referrals.module';
import { SystemFlagsModule } from '../system-flags/system-flags.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthChallenge } from './entities/auth-challenge.entity';
import { AuthIdentity } from './entities/auth-identity.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { MeController } from './me.controller';
import { EmailService } from './services/email.service';
import { OAuthService } from './services/oauth.service';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { AuthUserCacheService } from './services/auth-user-cache.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    UsersModule,
    ProfilesModule,
    forwardRef(() => SystemFlagsModule),
    forwardRef(() => ReferralsModule),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          expiresIn: (config.get<string>('JWT_ACCESS_TTL') ||
            '15m') as `${number}m`,
        },
      }),
    }),
    TypeOrmModule.forFeature([AuthChallenge, AuthIdentity, RefreshToken]),
  ],
  controllers: [AuthController, MeController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    EmailService,
    OAuthService,
    AuthUserCacheService,
    JwtStrategy,
    JwtAuthGuard,
  ],
  exports: [
    AuthService,
    JwtAuthGuard,
    PasswordService,
    JwtModule,
    AuthUserCacheService,
  ],
})
export class AuthModule {}
