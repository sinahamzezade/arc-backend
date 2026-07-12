import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  CurrentUser,
  type AuthUserPayload,
} from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  SubmitQuestionnaireDto,
  UpsertQuestionnaireDto,
} from './dto/questionnaire.dto';
import { QuestionnaireService } from './questionnaire.service';

@ApiTags('questionnaire')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('questionnaire')
export class QuestionnaireController {
  constructor(private readonly questionnaireService: QuestionnaireService) {}

  @Get('schema')
  @ApiOperation({
    summary: 'Questionnaire steps, questions, and allowed options',
  })
  schema() {
    return this.questionnaireService.getSchema();
  }

  @Get()
  @ApiOperation({ summary: 'Get current questionnaire (draft or submitted)' })
  get(@CurrentUser() user: AuthUserPayload) {
    return this.questionnaireService.getForUser(user.userId);
  }

  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upsert questionnaire draft answers' })
  upsertDraft(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: UpsertQuestionnaireDto,
  ) {
    return this.questionnaireService.upsertDraft(user.userId, dto.answers);
  }

  @Post('submit')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Submit questionnaire, upsert goal, enqueue roadmap',
  })
  submit(
    @CurrentUser() user: AuthUserPayload,
    @Body() dto: SubmitQuestionnaireDto,
  ) {
    return this.questionnaireService.submit(user.userId, dto.answers);
  }
}
