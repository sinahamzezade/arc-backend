import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { AppException } from '../../common/errors/app.exception';
import { AuthErrorCode } from '../../common/errors/auth-error.codes';
import { OAuthProvider } from '../entities/auth-identity.entity';

export type VerifiedOAuthIdentity = {
  provider: OAuthProvider;
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
};

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);
  private googleClient: OAuth2Client | null = null;
  private readonly appleJwks = jwksClient({
    jwksUri: 'https://appleid.apple.com/auth/keys',
    cache: true,
    rateLimit: true,
  });

  constructor(private readonly config: ConfigService) {}

  async verifyGoogle(idToken: string): Promise<VerifiedOAuthIdentity> {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    if (!clientId) {
      throw new AppException(
        AuthErrorCode.OAUTH_FAILED,
        'Google OAuth is not configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (!this.googleClient) {
      this.googleClient = new OAuth2Client(clientId);
    }

    try {
      const ticket = await this.googleClient.verifyIdToken({
        idToken,
        audience: clientId,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub) {
        throw new Error('Missing sub');
      }

      return {
        provider: OAuthProvider.GOOGLE,
        providerUserId: payload.sub,
        email: payload.email?.toLowerCase() ?? null,
        emailVerified: Boolean(payload.email_verified),
      };
    } catch (err) {
      this.logger.warn(`Google verify failed: ${String(err)}`);
      throw new AppException(
        AuthErrorCode.OAUTH_FAILED,
        'Google authentication failed',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  async verifyApple(idToken: string): Promise<VerifiedOAuthIdentity> {
    const clientId = this.config.get<string>('APPLE_CLIENT_ID');
    if (!clientId) {
      throw new AppException(
        AuthErrorCode.OAUTH_FAILED,
        'Apple OAuth is not configured',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    try {
      const decoded = jwt.decode(idToken, { complete: true });
      if (!decoded || typeof decoded === 'string' || !decoded.header.kid) {
        throw new Error('Invalid Apple token');
      }

      const key = await this.appleJwks.getSigningKey(decoded.header.kid);
      const signingKey = key.getPublicKey();

      const payload = jwt.verify(idToken, signingKey, {
        algorithms: ['RS256'],
        issuer: 'https://appleid.apple.com',
        audience: clientId,
      }) as jwt.JwtPayload;

      if (!payload.sub) {
        throw new Error('Missing sub');
      }

      const email =
        typeof payload.email === 'string'
          ? payload.email.toLowerCase()
          : null;
      const emailVerified =
        payload.email_verified === true ||
        payload.email_verified === 'true';

      return {
        provider: OAuthProvider.APPLE,
        providerUserId: payload.sub,
        email,
        emailVerified: Boolean(emailVerified),
      };
    } catch (err) {
      this.logger.warn(`Apple verify failed: ${String(err)}`);
      throw new AppException(
        AuthErrorCode.OAUTH_FAILED,
        'Apple authentication failed',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }
}
