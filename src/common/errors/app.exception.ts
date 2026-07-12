import { HttpException, HttpStatus } from '@nestjs/common';
import { AuthErrorCode } from './auth-error.codes';

export class AppException extends HttpException {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super({ statusCode: status, code, message }, status);
  }
}
