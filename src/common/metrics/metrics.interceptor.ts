import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const started = Date.now();
    const req = context.switchToHttp().getRequest<Request & { path?: string }>();
    const path = req.path ?? 'unknown';
    const method = (req as { method?: string }).method ?? 'UNKNOWN';

    return next.handle().pipe(
      tap({
        next: () => {
          const durationMs = Date.now() - started;
          if (durationMs >= 1000) {
            // Slow request signal for log/metrics scrapers.
            console.info(
              JSON.stringify({
                type: 'slow_request',
                method,
                path,
                durationMs,
              }),
            );
          }
        },
      }),
    );
  }
}
