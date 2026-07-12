import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class EmailOnlyDto {
  @ApiProperty({ example: 'soheil@arc.app' })
  @IsEmail()
  email: string;
}
