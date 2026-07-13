import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AdminRedirectException } from '../../common/exceptions/admin-redirect.exception';
import type { AdminRequest } from '../types/admin-request';

@Injectable()
export class AdminSessionGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    if (req.session?.adminUserId) {
      return true;
    }
    throw new AdminRedirectException('/admin/login');
  }
}
