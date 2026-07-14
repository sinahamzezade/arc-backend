import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { AdminRedirectException } from '../exceptions/admin-redirect.exception';
import { AuthErrorCode } from '../errors/auth-error.codes';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<{
      path?: string;
      method?: string;
      headers?: { accept?: string };
    }>();

    if (exception instanceof AdminRedirectException) {
      return response.redirect(exception.url);
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      let message: string;
      let code: string | undefined;
      let errors: unknown;
      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const body = exceptionResponse as Record<string, unknown>;
        message = Array.isArray(body.message)
          ? body.message.join('; ')
          : (body.message as string) || exception.message;
        code = body.code as string | undefined;
        errors = body.errors;
      } else {
        message = String(exceptionResponse);
      }

      // Multer field/size errors on admin catalog import → flash redirect.
      const path = request.path ?? '';
      if (
        status < 500 &&
        request.method === 'POST' &&
        path === '/admin/skill-graph/import'
      ) {
        const q = new URLSearchParams({
          tab: 'import',
          err: message,
        });
        return response.redirect(`/admin/skill-graph?${q.toString()}`);
      }

      return response.status(status).json({
        statusCode: status,
        code:
          code ||
          this.mapStatusToCode(
            status,
            typeof exceptionResponse === 'object' &&
              exceptionResponse !== null
              ? (exceptionResponse as Record<string, unknown>)
              : undefined,
          ),
        message,
        ...(errors ? { errors } : {}),
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
