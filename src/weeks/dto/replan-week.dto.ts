import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

export class ReplanWeekDto {
  @ApiPropertyOptional({
    enum: [
      'catch_up',
      'reduce',
      'rebuild',
      'user_request',
      'missed_sessions',
      'reduce_workload',
      'increase_pace',
      'availability_changed',
      'coach_recommendation',
    ],
  })
  @IsOptional()
  @IsIn([
    'catch_up',
    'reduce',
    'rebuild',
    'user_request',
    'missed_sessions',
    'reduce_workload',
    'increase_pace',
    'availability_changed',
    'coach_recommendation',
  ])
  mode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  reduceHours?: boolean;
}
