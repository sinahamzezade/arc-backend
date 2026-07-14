import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUserPayload } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SystemFlagsService } from './system-flags.service';

@ApiTags('system')
@Controller('system')
export class SystemFlagsController {
  constructor(private readonly flags: SystemFlagsService) {}

  @Get('flags')
  @ApiOperation({ summary: 'Public feature flags (system defaults)' })
  async getPublicFlags() {
    return this.flags.getPublicFlags();
  }

  @Get('flags/me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Feature flags resolved for the authenticated user (overrides applied)',
  })
  async getMyFlags(@CurrentUser() user: AuthUserPayload) {
    return this.flags.getPublicFlags(user.userId);
  }
}
