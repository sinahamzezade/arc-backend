import {
  Equals,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsString()
  @MinLength(1, { message: 'Name is required' })
  @MaxLength(80)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsBoolean()
  @Equals(true, { message: 'You must agree to continue' })
  agreeToTerms: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  referralCode?: string;
}
