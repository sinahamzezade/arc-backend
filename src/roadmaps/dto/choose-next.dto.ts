import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ReEnrollmentTrigger } from '../entities/re-enrollment-job.entity';

export class ChooseNextDto {
  @ApiProperty({
    enum: [
      ReEnrollmentTrigger.NewGoal,
      ReEnrollmentTrigger.SameGoalAdvanced,
      ReEnrollmentTrigger.TopUp,
    ],
  })
  @IsIn([
    ReEnrollmentTrigger.NewGoal,
    ReEnrollmentTrigger.SameGoalAdvanced,
    ReEnrollmentTrigger.TopUp,
  ])
  choice:
    | ReEnrollmentTrigger.NewGoal
    | ReEnrollmentTrigger.SameGoalAdvanced
    | ReEnrollmentTrigger.TopUp;
}
