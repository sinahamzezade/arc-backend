import { Injectable } from '@nestjs/common';
import { PasswordService } from '../auth/services/password.service';
import { UsersService } from '../users/users.service';
import { User } from '../users/entities/user.entity';

export type AdminLoginResult =
  | { ok: true; user: User }
  | { ok: false; error: string };

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
  ) {}

  async validateLogin(
    email: string,
    password: string,
  ): Promise<AdminLoginResult> {
    const invalid: AdminLoginResult = {
      ok: false,
      error: 'Email or password is incorrect',
    };

    const user = await this.usersService.findByEmail(email);
    if (!user?.passwordHash) {
      return invalid;
    }

    const valid = await this.passwordService.verify(
      user.passwordHash,
      password,
    );
    if (!valid) {
      return invalid;
    }

    if (!user.isActive || user.deletedAt) {
      return invalid;
    }

    if (!user.isAdmin) {
      return invalid;
    }

    await this.usersService.touchLastLogin(user.id);
    return { ok: true, user };
  }
}
