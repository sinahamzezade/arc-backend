import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import { RoadmapsService } from './roadmaps.service';

@ApiTags('roadmaps')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('roadmaps')
export class RoadmapsController {
  constructor(private readonly roadmapsService: RoadmapsService) {}

  @Get('current')
  @ApiOperation({ summary: 'Current user roadmap tree or generation status' })
  getCurrent(@CurrentUser() user: AuthUserPayload) {
    return this.roadmapsService.getCurrent(user.userId);
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'Poll a roadmap generation job' })
  getJob(
    @CurrentUser() user: AuthUserPayload,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.roadmapsService.getJob(user.userId, jobId);
  }
}
