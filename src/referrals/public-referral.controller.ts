import {
  Controller,
  Get,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { REFERRAL_COOKIE } from './referral.constants';
import { ReferralsService } from './referrals.service';

@ApiTags('referrals-public')
@Controller('r')
export class PublicReferralController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get(':publicToken')
  @ApiOperation({ summary: 'Public referral redirect + click attribution' })
  async redirect(
    @Param('publicToken') publicToken: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const result = await this.referrals.handlePublicRedirect(publicToken, {
      ip: req.ip,
      ua: req.headers['user-agent'],
    });

    if (result.cookieToken && result.cookieMaxAgeSec) {
      res.cookie(REFERRAL_COOKIE, result.cookieToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: result.cookieMaxAgeSec * 1000,
        path: '/',
      });
    }

    return res.redirect(302, result.redirectTo);
  }
}
