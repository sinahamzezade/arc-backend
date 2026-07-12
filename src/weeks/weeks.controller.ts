import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import { ReplanWeekDto } from './dto/replan-week.dto';
import {
  MoveWeeklyTaskDto,
  SkipWeeklyTaskDto,
  UpdateWeeklyTaskDto,
} from './dto/update-weekly-task.dto';
import { WeeksService } from './weeks.service';

@ApiTags('weeks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('weeks')
export class WeeksController {
  constructor(private readonly weeksService: WeeksService) {}

  @Get('current')
  @ApiOperation({ summary: 'Current Seal Week vault + pulse payload' })
  getCurrent(@CurrentUser() user: AuthUserPayload) {
    return this.weeksService.getCurrent(user.userId);
  }

  @Get(':weekStart')
  @ApiOperation({ summary: 'Historical week plan by weekStart (YYYY-MM-DD)' })
  getByWeekStart(
    @CurrentUser() user: AuthUserPayload,
    @Param('weekStart') weekStart: string,
  ) {
    return this.weeksService.getByWeekStart(user.userId, weekStart);
  }

  @Post('current/replan')
  @ApiOperation({ summary: 'Replan remaining sessions this week' })
  replan(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: ReplanWeekDto,
  ) {
    return this.weeksService.replan(user.userId, dto);
  }

  @Patch('current/tasks/:taskId')
  @ApiOperation({
    summary: 'Reschedule or skip a weekly task (client cannot mark done)',
  })
  updateTask(
    @CurrentUser() user: AuthUserPayload,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateWeeklyTaskDto,
  ) {
    return this.weeksService.updateTask(user.userId, taskId, dto);
  }

  @Post('current/tasks/:taskId/move')
  @ApiOperation({ summary: 'Move task to another day this week' })
  moveTask(
    @CurrentUser() user: AuthUserPayload,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: MoveWeeklyTaskDto,
  ) {
    return this.weeksService.moveTask(user.userId, taskId, dto);
  }

  @Post('current/tasks/:taskId/skip')
  @ApiOperation({ summary: 'Skip a weekly task (policy-checked)' })
  skipTask(
    @CurrentUser() user: AuthUserPayload,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: SkipWeeklyTaskDto,
  ) {
    return this.weeksService.skipTask(user.userId, taskId, dto);
  }
}
