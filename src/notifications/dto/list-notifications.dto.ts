import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export enum NotificationListFilter {
  All = 'all',
  Unread = 'unread',
  Rewards = 'rewards',
  Social = 'social',
  Learning = 'learning',
  Coach = 'coach',
  System = 'system',
}

export class ListNotificationsDto {
  @ApiPropertyOptional({ enum: NotificationListFilter, default: 'all' })
  @IsOptional()
  @IsEnum(NotificationListFilter)
  filter?: NotificationListFilter = NotificationListFilter.All;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  /** @deprecated Prefer cursor. Kept for FE compat. */
  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;

  @ApiPropertyOptional({ description: 'Opaque cursor from previous page' })
  @IsOptional()
  @IsString()
  cursor?: string;
}
