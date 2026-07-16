import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { MePulseService } from './me-pulse.service';

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MePulseController {
  constructor(private readonly mePulse: MePulseService) {}

  @Get('pulse')
  @ApiOperation({
    summary:
      'Badge counts + presence heartbeat (single background poll for the app)',
  })
  pulse(@CurrentUser() user: AuthUserPayload) {
    return this.mePulse.pulse(user.userId);
  }
}
