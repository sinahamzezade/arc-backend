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
import { UpdateWeeklyTaskDto } from './dto/update-weekly-task.dto';
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

  @Post('current/replan')
  @ApiOperation({ summary: 'Replan remaining sessions this week' })
  replan(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: ReplanWeekDto,
  ) {
    return this.weeksService.replan(user.userId, dto);
  }

  @Patch('current/tasks/:taskId')
  @ApiOperation({ summary: 'Reschedule or skip a weekly task' })
  updateTask(
    @CurrentUser() user: AuthUserPayload,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: UpdateWeeklyTaskDto,
  ) {
    return this.weeksService.updateTask(user.userId, taskId, dto);
  }
}
