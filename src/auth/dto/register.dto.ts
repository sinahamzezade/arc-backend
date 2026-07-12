import { ApiProperty } from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: 'Soheil' })
  @IsString()
  @MinLength(1, { message: 'Name is required' })
  @MaxLength(80)
  name: string;

  @ApiProperty({ example: 'soheil@arc.app' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'Secret1!' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  @Equals(true, { message: 'You must agree to continue' })
  agreeToTerms: boolean;
}
