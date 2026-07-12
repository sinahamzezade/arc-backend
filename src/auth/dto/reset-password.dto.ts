import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  resetToken: string;

  @ApiProperty({ example: 'Secret1!' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: 'Secret1!' })
  @IsString()
  @MinLength(8)
  confirmPassword: string;
}
