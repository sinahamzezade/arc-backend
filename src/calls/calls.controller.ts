import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import { CallService } from './call.service';

@ApiTags('calls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('calls')
export class CallsController {
  constructor(private readonly calls: CallService) {}

  @Get('ice-servers')
  @ApiOperation({ summary: 'STUN + short-lived TURN credentials' })
  iceServers(@CurrentUser() user: AuthUserPayload) {
    return this.calls.getIceServers(user.userId);
  }

  @Get('history')
  @ApiOperation({ summary: 'Paginated past calls for the user' })
  history(
    @CurrentUser() user: AuthUserPayload,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? Number(limit) : 30;
    return this.calls.listHistory(user.userId, Number.isFinite(n) ? n : 30);
  }
}
