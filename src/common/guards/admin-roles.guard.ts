import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';

export const ADMIN_ONLY_KEY = 'admin_only';
export const AdminOnly = () => SetMetadata(ADMIN_ONLY_KEY, true);

@Injectable()
export class AdminRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const req = context.switchToHttp().getRequest<{
      user?: { userId?: string; id?: string };
    }>();
    const userId = req.user?.userId ?? req.user?.id;
    if (!userId) {
      throw new ForbiddenException({
        code: 'CONTENT_ADMIN_FORBIDDEN',
        message: 'Admin access required',
      });
    }

    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user?.isAdmin || !user.isActive) {
      throw new ForbiddenException({
        code: 'CONTENT_ADMIN_FORBIDDEN',
        message: 'Admin access required',
      });
    }
    return true;
  }
}
