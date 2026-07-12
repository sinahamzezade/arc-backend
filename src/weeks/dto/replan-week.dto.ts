import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class ReplanWeekDto {
  @ApiPropertyOptional({ enum: ['catch_up', 'reduce', 'rebuild'] })
  @IsOptional()
  @IsIn(['catch_up', 'reduce', 'rebuild'])
  mode?: 'catch_up' | 'reduce' | 'rebuild';

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  reduceHours?: boolean;
}
