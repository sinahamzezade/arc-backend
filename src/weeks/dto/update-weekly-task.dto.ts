import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { WeeklyTaskStatus } from '../entities/weekly-task.entity';

export class UpdateWeeklyTaskDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 6 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dayIndex?: number;

  @ApiPropertyOptional({
    enum: ['upcoming', 'today', 'done', 'missed', 'skipped'],
  })
  @IsOptional()
  @IsIn(['upcoming', 'today', 'done', 'missed', 'skipped'])
  status?: WeeklyTaskStatus;
}
