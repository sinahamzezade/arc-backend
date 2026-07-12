import {
  Controller,
  Get,
  Param,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ReferralsService } from './referrals.service';

/** Unauthenticated click resolve for first-party /r proxy. */
@ApiTags('referrals-public')
@Controller('referrals/public')
export class ReferralClickController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get(':publicToken/click')
  @ApiOperation({ summary: 'Record referral click (no redirect)' })
  async click(
    @Param('publicToken') publicToken: string,
    @Req() req: Request,
  ) {
    const result = await this.referrals.handlePublicRedirect(publicToken, {
      ip: req.ip,
      ua: req.headers['user-agent'],
    });
    return {
      ok: true,
      cookieToken: result.cookieToken,
      cookieMaxAgeSec: result.cookieMaxAgeSec ?? null,
      signupPath: '/signup',
    };
  }
}
