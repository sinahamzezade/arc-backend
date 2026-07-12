import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class OAuthTokenDto {
  @ApiProperty({ description: 'ID token from Google or Apple' })
  @IsString()
  @MinLength(1)
  idToken: string;
}
