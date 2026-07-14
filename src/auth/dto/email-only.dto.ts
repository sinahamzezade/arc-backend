import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class EmailOnlyDto {
  @ApiProperty({ example: 'alex@arc.app' })
  @IsEmail()
  email: string;
}
