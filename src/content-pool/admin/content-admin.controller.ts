import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  AdminOnly,
  AdminRolesGuard,
} from '../../common/guards/admin-roles.guard';
import { ContentCatalogService } from '../content-catalog.service';
import { ContentPublicationService } from '../content-publication.service';
import { ContentQueryService } from '../content-query.service';
import { ContentVersionService } from '../content-version.service';
import type { LessonVersionBody } from '../entities/lesson-version.entity';
import type {
  QuestionVersionAnswer,
  QuestionVersionPrompt,
} from '../entities/question-version.entity';
import {
  CreateLessonDto,
  CreateLessonVersionDto,
  CreateQuestionDto,
  CreateQuestionVersionDto,
} from './dto/content-admin.dto';

type AuthedRequest = Request & { user?: { id?: string; userId?: string } };

@ApiTags('admin-content')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminRolesGuard)
@AdminOnly()
@Controller('admin/content')
export class ContentAdminController {
  constructor(
    private readonly versions: ContentVersionService,
    private readonly publication: ContentPublicationService,
    private readonly query: ContentQueryService,
    private readonly catalog: ContentCatalogService,
  ) {}

  private actorId(req: AuthedRequest): string | undefined {
    return req.user?.id ?? req.user?.userId;
  }

  @Get('lessons')
  @ApiOperation({ summary: 'Search lesson templates' })
  listLessons(@Query('q') q?: string) {
    return this.query.searchLessons(q ?? '');
  }

  @Get('courses')
  listCourses(@Query('q') q?: string) {
    return this.catalog.listCourses(q);
  }

  @Post('courses')
  createCourse(@Body() body: Record<string, unknown>, @Req() req: AuthedRequest) {
    return this.catalog.createCourse(
      body as { slug: string; title: string },
      this.actorId(req),
    );
  }

  @Get('modules')
  listModules(@Query('courseTemplateId') courseTemplateId?: string) {
    return this.catalog.listModules(courseTemplateId);
  }

  @Post('modules')
  createModule(@Body() body: Record<string, unknown>, @Req() req: AuthedRequest) {
    return this.catalog.createModule(
      body as {
        courseTemplateId: string;
        slug: string;
        title: string;
      },
      this.actorId(req),
    );
  }

  @Get('datasets')
  listDatasets(@Query('q') q?: string) {
    return this.catalog.listDatasets(q);
  }

  @Post('datasets')
  createDataset(@Body() body: Record<string, unknown>, @Req() req: AuthedRequest) {
    return this.catalog.createDataset(
      body as {
        slug: string;
        title: string;
        storageKey: string;
        checksum: string;
      },
      this.actorId(req),
    );
  }

  @Get('datasets/:id')
  getDataset(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.getDataset(id);
  }

  @Post('datasets/:id/check')
  checkDataset(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.checkDatasetIntegrity(id);
  }

  @Get('prerequisites')
  listPrereqs(@Query('skillNodeId') skillNodeId?: string) {
    return this.catalog.listPrerequisiteEdges(skillNodeId);
  }

  @Post('prerequisites/sync')
  syncPrereqs(@Req() req: AuthedRequest) {
    return this.catalog.syncPrerequisiteEdges(this.actorId(req));
  }

  @Get('recipes/:roleSlug')
  @ApiOperation({ summary: 'Get role recipe by slug' })
  getRecipe(@Param('roleSlug') roleSlug: string) {
    return this.query.getRoleRecipe(roleSlug);
  }

  @Post('lessons')
  @ApiOperation({ summary: 'Create lesson template (draft)' })
  createLesson(@Body() dto: CreateLessonDto, @Req() req: AuthedRequest) {
    return this.versions.createLessonTemplate({
      ...dto,
      authorId: this.actorId(req),
    });
  }

  @Post('lessons/:id/versions')
  @ApiOperation({ summary: 'Create immutable lesson version (draft)' })
  createLessonVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateLessonVersionDto,
    @Req() req: AuthedRequest,
  ) {
    return this.versions.createLessonVersion({
      lessonTemplateId: id,
      body: dto.body as LessonVersionBody,
      changeNote: dto.changeNote,
      authorId: this.actorId(req),
    });
  }

  @Post('questions')
  @ApiOperation({ summary: 'Create question template (draft)' })
  createQuestion(@Body() dto: CreateQuestionDto, @Req() req: AuthedRequest) {
    return this.versions.createQuestionTemplate({
      ...dto,
      authorId: this.actorId(req),
    });
  }

  @Post('questions/:id/versions')
  @ApiOperation({ summary: 'Create immutable question version (draft)' })
  createQuestionVersion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateQuestionVersionDto,
    @Req() req: AuthedRequest,
  ) {
    return this.versions.createQuestionVersion({
      questionTemplateId: id,
      prompt: dto.prompt as QuestionVersionPrompt,
      answer: dto.answer as QuestionVersionAnswer,
      explanation: dto.explanation,
      changeNote: dto.changeNote,
      authorId: this.actorId(req),
    });
  }

  @Post('versions/:id/submit-review')
  @ApiOperation({ summary: 'Move version draft → review' })
  submitReview(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('entityType') entityType: 'lesson_version' | 'question_version',
    @Req() req: AuthedRequest,
  ) {
    return this.publication.submitReview(
      entityType ?? 'lesson_version',
      id,
      this.actorId(req),
    );
  }

  @Post('versions/:id/publish')
  @ApiOperation({ summary: 'Publish reviewed version' })
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('entityType') entityType: 'lesson_version' | 'question_version',
    @Req() req: AuthedRequest,
  ) {
    return this.publication.publish(
      entityType ?? 'lesson_version',
      id,
      this.actorId(req),
    );
  }

  @Post('versions/:id/retire')
  @ApiOperation({ summary: 'Retire published version' })
  retire(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('entityType') entityType: 'lesson_version' | 'question_version',
    @Req() req: AuthedRequest,
  ) {
    return this.publication.retire(
      entityType ?? 'lesson_version',
      id,
      this.actorId(req),
    );
  }

  @Post('validate-graph')
  @ApiOperation({ summary: 'Validate skill prerequisite DAG' })
  validateGraph() {
    return this.publication.validateGraph();
  }

  @Post('roadmaps/:id/materialize')
  @ApiOperation({ summary: 'Materialize rolling content window' })
  materialize(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { weeks?: number; fromWeek?: number },
  ) {
    return this.query.materializeRoadmapContent(id, {
      weeks: body.weeks ?? 3,
      fromWeek: body.fromWeek ?? 1,
    });
  }
}
