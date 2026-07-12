import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import {
  MoveSlotDto,
  PatchCommitmentDto,
  ReplanTimingDto,
  SkipSlotDto,
} from './dto/timing.dto';
import { ScheduleChangeActor } from './timing.constants';
import { TimingService } from './timing.service';

@ApiTags('course-timing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('course-timing')
export class TimingController {
  constructor(private readonly timing: TimingService) {}

  @Get('current')
  @ApiOperation({ summary: 'Current pace, ETA, next session' })
  getCurrent(@CurrentUser() user: AuthUserPayload) {
    return this.timing.getCurrent(user.userId);
  }

  @Get('calendar')
  @ApiOperation({ summary: 'Schedule slots in date range' })
  getCalendar(
    @CurrentUser() user: AuthUserPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.timing.getCalendar(user.userId, from, to);
  }

  @Get('feasibility')
  @ApiOperation({ summary: 'Capacity vs required content' })
  getFeasibility(@CurrentUser() user: AuthUserPayload) {
    return this.timing.getFeasibility(user.userId);
  }

  @Patch('commitment')
  @ApiOperation({ summary: 'Update learning commitment' })
  patchCommitment(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: PatchCommitmentDto,
  ) {
    return this.timing.patchCommitment(user.userId, dto);
  }

  @Post('replan')
  @ApiOperation({ summary: 'Replan active window' })
  replan(@CurrentUser() user: AuthUserPayload, @Body() dto: ReplanTimingDto) {
    return this.timing.replan(user.userId, {
      reason: dto.reason ?? 'user_request',
      actor: ScheduleChangeActor.User,
      expectedVersion: dto.expectedVersion,
    });
  }

  @Post('slots/:id/move')
  moveSlot(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveSlotDto,
  ) {
    return this.timing.moveSlot(user.userId, id, dto);
  }

  @Post('slots/:id/skip')
  skipSlot(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SkipSlotDto,
  ) {
    return this.timing.skipSlot(user.userId, id, dto.reason);
  }
}
