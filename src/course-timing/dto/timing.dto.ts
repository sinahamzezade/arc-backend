import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class PatchCommitmentDto {
  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  weeklyHoursToken?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  availableDays?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  timeWindows?: string[];

  @IsOptional()
  @IsString()
  deadlineToken?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(180)
  reminderLeadMinutes?: number;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  quietHoursStart?: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  quietHoursEnd?: string;

  @IsOptional()
  @IsBoolean()
  quietHoursEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  replan?: boolean;
}

export class ReplanTimingDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  expectedVersion?: number;
}

export class MoveSlotDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  localDate!: string;

  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/)
  startLocalTime?: string;
}

export class SkipSlotDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
