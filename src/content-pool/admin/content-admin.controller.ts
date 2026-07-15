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
import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import { AuthErrorCode } from '../../common/errors/auth-error.codes';
import { ContentCatalogService } from '../content-catalog.service';
import { ContentPublicationService } from '../content-publication.service';
import { ContentQueryService } from '../content-query.service';
import { ContentVersionService } from '../content-version.service';
import type { LessonVersionBody } from '../entities/lesson-version.entity';
import type {
  QuestionVersionAnswer,
  QuestionVersionPrompt,
} from '../entities/question-version.entity';
import { UnitsCatalogService } from '../units-catalog.service';
import {
  isUnitsJsonDocument,
  type UnitsJsonSkill,
  type UnitsJsonUnit,
} from '../units-json.types';
import { UnitsGraphError } from '../units-graph.util';
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
    private readonly unitsCatalog: UnitsCatalogService,
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
  @ApiOperation({ summary: 'Validate skill prerequisite DAG (legacy nodes)' })
  validateGraph() {
    return this.publication.validateGraph();
  }

  @Get('units')
  @ApiOperation({ summary: 'List active flattened units' })
  listUnits(
    @Query('stack') stack?: string,
    @Query('domain') domain?: string,
  ) {
    return this.unitsCatalog.listActiveUnits({ stack, domain });
  }

  @Get('skills')
  @ApiOperation({ summary: 'List skills index' })
  listSkills() {
    return this.unitsCatalog.listActiveSkills();
  }

  @Get('units/export')
  @ApiOperation({ summary: 'Export pool as units JSON' })
  exportUnits() {
    return this.unitsCatalog.exportDocument();
  }

  @Post('units/import')
  @ApiOperation({
    summary: 'Import units JSON (skills_index + units) — add a course at runtime',
  })
  async importUnits(
    @Body() body: unknown,
    @Query('deactivateMissing') deactivateMissing?: string,
  ) {
    if (!isUnitsJsonDocument(body)) {
      throw new AppException(
        AuthErrorCode.CONTENT_UNITS_INVALID,
        'Body must be { skills_index: [], units: [] }',
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      return await this.unitsCatalog.importDocument(body, {
        deactivateMissing: deactivateMissing === 'true',
      });
    } catch (err) {
      if (err instanceof UnitsGraphError) {
        throw new AppException(
          err.code === 'CONTENT_GRAPH_CYCLE'
            ? AuthErrorCode.CONTENT_GRAPH_CYCLE
            : AuthErrorCode.CONTENT_PREREQ_UNRESOLVED,
          err.message,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw err;
    }
  }

  @Post('units')
  @ApiOperation({ summary: 'Upsert a single unit' })
  async upsertUnit(@Body() body: UnitsJsonUnit) {
    try {
      return await this.unitsCatalog.upsertUnit(body);
    } catch (err) {
      if (err instanceof UnitsGraphError) {
        throw new AppException(
          err.code === 'CONTENT_GRAPH_CYCLE'
            ? AuthErrorCode.CONTENT_GRAPH_CYCLE
            : AuthErrorCode.CONTENT_PREREQ_UNRESOLVED,
          err.message,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw err;
    }
  }

  @Post('skills')
  @ApiOperation({ summary: 'Upsert a skill index entry' })
  async upsertSkill(@Body() body: UnitsJsonSkill) {
    try {
      return await this.unitsCatalog.upsertSkill(body);
    } catch (err) {
      if (err instanceof UnitsGraphError) {
        throw new AppException(
          err.code === 'CONTENT_GRAPH_CYCLE'
            ? AuthErrorCode.CONTENT_GRAPH_CYCLE
            : AuthErrorCode.CONTENT_PREREQ_UNRESOLVED,
          err.message,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw err;
    }
  }

  @Post('units/:id/deactivate')
  deactivateUnit(@Param('id') id: string) {
    return this.unitsCatalog.deactivateUnit(id).then(() => ({ ok: true, id }));
  }

  @Post('skills/:id/deactivate')
  deactivateSkill(@Param('id') id: string) {
    return this.unitsCatalog.deactivateSkill(id).then(() => ({ ok: true, id }));
  }

  @Post('units/validate')
  @ApiOperation({ summary: 'Validate units JSON DAG without saving' })
  validateUnitsDoc(@Body() body: unknown) {
    if (!isUnitsJsonDocument(body)) {
      throw new AppException(
        AuthErrorCode.CONTENT_UNITS_INVALID,
        'Body must be { skills_index: [], units: [] }',
        HttpStatus.BAD_REQUEST,
      );
    }
    try {
      this.unitsCatalog.validateDocument(body);
      return { ok: true };
    } catch (err) {
      if (err instanceof UnitsGraphError) {
        throw new AppException(
          err.code === 'CONTENT_GRAPH_CYCLE'
            ? AuthErrorCode.CONTENT_GRAPH_CYCLE
            : AuthErrorCode.CONTENT_PREREQ_UNRESOLVED,
          err.message,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw err;
    }
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
