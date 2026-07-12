import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'soheil@arc.app' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Secret1!' })
  @IsString()
  @MinLength(1)
  password: string;
}
