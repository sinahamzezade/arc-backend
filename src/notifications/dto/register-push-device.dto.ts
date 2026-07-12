import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PushDevicePlatform } from '../entities/push-device.entity';

export class RegisterPushDeviceDto {
  @ApiProperty({ description: 'Stable client device id' })
  @IsString()
  @MinLength(4)
  @MaxLength(128)
  deviceId: string;

  @ApiProperty({ enum: PushDevicePlatform })
  @IsEnum(PushDevicePlatform)
  platform: PushDevicePlatform;

  @ApiProperty({ description: 'Push provider token' })
  @IsString()
  @MinLength(8)
  @MaxLength(4096)
  token: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  endpoint?: string;
}
