import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import { AppException } from '../common/errors/app.exception';
import { AuthErrorCode } from '../common/errors/auth-error.codes';
import { ChooseNextDto } from './dto/choose-next.dto';
import { ReEnrollmentService } from './re-enrollment.service';
import { RoadmapCompletionService } from './roadmap-completion.service';
import { RoadmapsService } from './roadmaps.service';

@ApiTags('roadmaps')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('roadmaps')
export class RoadmapsController {
  constructor(
    private readonly roadmapsService: RoadmapsService,
    private readonly completion: RoadmapCompletionService,
    private readonly reenrollment: ReEnrollmentService,
  ) {}

  @Get('current')
  @ApiOperation({ summary: 'Current user roadmap tree or generation status' })
  getCurrent(@CurrentUser() user: AuthUserPayload) {
    return this.roadmapsService.getCurrent(user.userId);
  }

  @Post('current/retry')
  @ApiOperation({ summary: 'Re-enqueue roadmap generation (Redraw map)' })
  retry(@CurrentUser() user: AuthUserPayload) {
    return this.roadmapsService.retryGenerate(user.userId);
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'Poll a roadmap generation job' })
  getJob(
    @CurrentUser() user: AuthUserPayload,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.roadmapsService.getJob(user.userId, jobId);
  }

  @Get('re-enrollment-jobs/:jobId')
  @ApiOperation({ summary: 'Poll a re-enrollment job' })
  getReEnrollmentJob(
    @CurrentUser() user: AuthUserPayload,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.reenrollment.getJob(user.userId, jobId);
  }

  @Get(':id/completion-summary')
  @ApiOperation({ summary: 'Graduation screen payload for a finished roadmap' })
  async getCompletionSummary(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const summary = await this.completion.getCompletionSummary(
      user.userId,
      id,
    );
    if (!summary) {
      throw new AppException(
        AuthErrorCode.ROADMAP_NOT_COMPLETE,
        'Roadmap is not complete',
        HttpStatus.NOT_FOUND,
      );
    }
    return summary;
  }

  @Post(':id/choose-next')
  @ApiOperation({ summary: 'Choose post-graduation path' })
  chooseNext(
    @CurrentUser() user: AuthUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChooseNextDto,
  ) {
    return this.reenrollment.chooseNext(user.userId, id, dto.choice);
  }
}
