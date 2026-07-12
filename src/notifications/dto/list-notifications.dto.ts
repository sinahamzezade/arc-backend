import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export enum NotificationListFilter {
  All = 'all',
  Unread = 'unread',
  Rewards = 'rewards',
  Social = 'social',
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

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number = 0;
}
