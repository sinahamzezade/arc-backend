import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ example: 'OldSecret1!' })
  @IsString()
  @MinLength(1)
  currentPassword: string;

  @ApiProperty({ example: 'NewSecret1!' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'NewSecret1!' })
  @IsString()
  @MinLength(8)
  confirmPassword: string;
}
