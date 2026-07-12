import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('EMAIL_PROVIDER_API_KEY');
    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  async sendOtp(email: string, otp: string, purpose: 'verify' | 'reset') {
    const subject =
      purpose === 'verify'
        ? 'Verify your Arc email'
        : 'Reset your Arc password';
    const text = `Your Arc code is ${otp}. It expires in 15 minutes.`;
    const html = `<p>Your Arc code is <strong>${otp}</strong>.</p><p>It expires in 15 minutes.</p>`;
    const from =
      this.config.get<string>('EMAIL_FROM') || 'Arc <onboarding@resend.dev>';

    if (!this.resend) {
      this.logger.log(`[DEV EMAIL] to=${email} subject="${subject}" ${text}`);
      return;
    }

    const { data, error } = await this.resend.emails.send({
      from,
      to: email,
      subject,
      html,
      text,
    });

    if (error) {
      this.logger.error(`Email send failed: ${error.message}`);
      return;
    }

    this.logger.log(`OTP email sent to=${email} id=${data?.id}`);
  }
}
