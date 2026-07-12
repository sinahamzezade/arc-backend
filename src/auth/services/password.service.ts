import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  generateRefreshToken(): string {
    return randomBytes(48).toString('base64url');
  }

  generateOtp(): string {
    // TEMP: fixed OTP while Resend is limited to verified recipient only
    return '111111';
    // return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  generateResetToken(): string {
    return randomBytes(32).toString('base64url');
  }
}
