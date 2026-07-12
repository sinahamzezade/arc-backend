import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthErrorCode } from '../errors/auth-error.codes';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const body = exceptionResponse as Record<string, unknown>;
        const message = Array.isArray(body.message)
          ? body.message.join('; ')
          : (body.message as string) || exception.message;

        return response.status(status).json({
          statusCode: status,
          code: (body.code as string) || this.mapStatusToCode(status, body),
          message,
          ...(body.errors ? { errors: body.errors } : {}),
        });
      }

      return response.status(status).json({
        statusCode: status,
        code: this.mapStatusToCode(status),
        message: String(exceptionResponse),
      });
    }

    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
    );

    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  }

  private mapStatusToCode(
    status: number,
    body?: Record<string, unknown>,
  ): string {
    if (status === HttpStatus.UNAUTHORIZED) {
      return AuthErrorCode.UNAUTHORIZED;
    }
    if (
      status === HttpStatus.BAD_REQUEST &&
      (body?.message !== undefined || body?.error === 'Bad Request')
    ) {
      return AuthErrorCode.VALIDATION_ERROR;
    }
    return `HTTP_${status}`;
  }
}
