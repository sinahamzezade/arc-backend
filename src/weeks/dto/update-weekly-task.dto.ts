import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateWeeklyTaskDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 6 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dayIndex?: number;

  /** Client may only skip or move — never mark done. */
  @ApiPropertyOptional({ enum: ['skipped', 'upcoming', 'missed'] })
  @IsOptional()
  @IsIn(['skipped', 'upcoming', 'missed'])
  status?: 'skipped' | 'upcoming' | 'missed';
}

export class MoveWeeklyTaskDto {
  @ApiProperty({ minimum: 0, maximum: 6 })
  @IsInt()
  @Min(0)
  @Max(6)
  dayIndex!: number;
}

export class SkipWeeklyTaskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
