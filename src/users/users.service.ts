import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, AuthProvider } from './entities/user.entity';
import { normalizeEmail } from '../common/utils/email.util';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepo.findOne({
      where: { email: normalizeEmail(email) },
      relations: { profile: true },
    });
  }

  findById(id: string): Promise<User | null> {
    return this.usersRepo.findOne({
      where: { id },
      relations: { profile: true },
    });
  }

  async createEmailUser(data: {
    email: string;
    passwordHash: string;
  }): Promise<User> {
    const user = this.usersRepo.create({
      email: normalizeEmail(data.email),
      passwordHash: data.passwordHash,
      authProvider: AuthProvider.EMAIL,
      emailVerifiedAt: null,
      isActive: true,
    });
    return this.usersRepo.save(user);
  }

  async save(user: User): Promise<User> {
    return this.usersRepo.save(user);
  }

  async markEmailVerified(userId: string): Promise<void> {
    await this.usersRepo.update(userId, { emailVerifiedAt: new Date() });
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.usersRepo.update(userId, { passwordHash });
  }

  async touchLastLogin(userId: string): Promise<void> {
    await this.usersRepo.update(userId, { lastLoginAt: new Date() });
  }

  mergeAuthProvider(
    current: AuthProvider,
    added: 'google' | 'apple',
  ): AuthProvider {
    const hasEmail =
      current === AuthProvider.EMAIL ||
      current === AuthProvider.EMAIL_GOOGLE ||
      current === AuthProvider.EMAIL_APPLE ||
      current === AuthProvider.EMAIL_GOOGLE_APPLE;
    const hasGoogle =
      current === AuthProvider.GOOGLE ||
      current === AuthProvider.EMAIL_GOOGLE ||
      current === AuthProvider.EMAIL_GOOGLE_APPLE;
    const hasApple =
      current === AuthProvider.APPLE ||
      current === AuthProvider.EMAIL_APPLE ||
      current === AuthProvider.EMAIL_GOOGLE_APPLE;

    const google = hasGoogle || added === 'google';
    const apple = hasApple || added === 'apple';

    if (hasEmail && google && apple) return AuthProvider.EMAIL_GOOGLE_APPLE;
    if (hasEmail && google) return AuthProvider.EMAIL_GOOGLE;
    if (hasEmail && apple) return AuthProvider.EMAIL_APPLE;
    if (google && apple) return AuthProvider.EMAIL_GOOGLE_APPLE; // rare
    if (google) return AuthProvider.GOOGLE;
    if (apple) return AuthProvider.APPLE;
    return AuthProvider.EMAIL;
  }
}
