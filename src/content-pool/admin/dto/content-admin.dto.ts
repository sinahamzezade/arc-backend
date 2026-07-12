import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateLessonDto {
  @IsUUID()
  skillNodeId!: string;

  @IsString()
  @MaxLength(120)
  slug!: string;

  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  lessonType!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  estimatedMinutes?: number;

  @IsOptional()
  @IsString()
  difficulty?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  learningStyleTags?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  schedulingTags?: string[];

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  missionNameTemplate?: string;
}

export class LessonVersionBodyDto {
  @IsInt()
  schemaVersion!: number;

  @IsString()
  objective!: string;

  @IsArray()
  sections!: Array<Record<string, unknown>>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  practiceIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  quizIds?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  resourceIds?: string[];
}

export class CreateLessonVersionDto {
  @ValidateNested()
  @Type(() => LessonVersionBodyDto)
  body!: LessonVersionBodyDto;

  @IsOptional()
  @IsString()
  changeNote?: string;
}

export class CreateQuestionDto {
  @IsString()
  @MaxLength(120)
  slug!: string;

  @IsString()
  questionType!: string;

  @IsOptional()
  @IsUUID()
  skillNodeId?: string;

  @IsOptional()
  @IsString()
  techStackSlug?: string;

  @IsOptional()
  @IsString()
  difficulty?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  estimatedSeconds?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedContexts?: string[];
}

export class CreateQuestionVersionDto {
  @IsObject()
  prompt!: Record<string, unknown>;

  @IsObject()
  answer!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  explanation?: string;

  @IsOptional()
  @IsString()
  changeNote?: string;
}

export class VersionActionDto {
  @IsIn(['lesson_version', 'question_version'])
  entityType!: 'lesson_version' | 'question_version';
}
