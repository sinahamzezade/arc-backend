import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateLessonProgressDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  contentStep?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  practiceDone?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  practiceOptionId?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  quizAnswers?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  quizIndex?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  timeSpentMinutes?: number;

  @ApiPropertyOptional({ description: 'Active attempt — validates answer IDs' })
  @IsOptional()
  @IsString()
  attemptId?: string;
}

export class CheckPracticeDto {
  @ApiProperty()
  @IsString()
  optionId!: string;

  @ApiProperty({ description: 'Active attempt id from start/play' })
  @IsString()
  attemptId!: string;

  @ApiPropertyOptional({ description: 'True if learner opened the hint' })
  @IsOptional()
  @IsBoolean()
  hintUsed?: boolean;
}

export class CheckQuizDto {
  @ApiProperty()
  @IsString()
  questionId!: string;

  @ApiProperty()
  @IsString()
  optionId!: string;

  @ApiProperty({ description: 'Active attempt id from start/play' })
  @IsString()
  attemptId!: string;
}

export class CompleteLessonDto {
  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  quizAnswers?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  practiceOptionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  timeSpentMinutes?: number;

  @ApiProperty({ description: 'Active attempt id from start/play' })
  @IsString()
  attemptId!: string;
}

export class ArloChatDto {
  @ApiProperty()
  @IsString()
  message!: string;
}
