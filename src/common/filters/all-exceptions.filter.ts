import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthError } from '../errors/auth-error';

/**
 * Global filter that normalizes every error into the standard envelope (§2.4):
 *   { code, message, retry_after_seconds? }
 * so mobile clients never parse free text. Handles AuthError (typed codes),
 * ThrottlerException (429 + retry-after), other HttpExceptions (e.g. ValidationPipe),
 * and unexpected errors (masked as a generic 500 — never leak internals, §8.7).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'Internal server error';
    let retryAfterSeconds: number | undefined;

    if (exception instanceof AuthError) {
      status = exception.status;
      code = exception.code;
      message = exception.message;
      retryAfterSeconds = exception.retryAfterSeconds;
    } else if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      code = 'rate_limited';
      message = 'Too many requests';
      const ttl = (exception.getResponse() as { ttl?: number })?.ttl;
      retryAfterSeconds = ttl ? Math.ceil(ttl / 1000) : undefined;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
        code = 'invalid_request';
      } else {
        const b = body as { message?: string | string[]; error?: string };
        const msg = Array.isArray(b.message) ? b.message.join('; ') : b.message;
        message = msg ?? exception.message;
        // ValidationPipe failures → generic input code; keep it non-revealing.
        code = status === HttpStatus.BAD_REQUEST ? 'invalid_request' : 'request_failed';
      }
    } else {
      // Unexpected: log full detail server-side, return a masked envelope.
      this.logger.error(
        `Unhandled error on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (status >= 500 && !(exception instanceof AuthError)) {
      this.logger.warn(`${status} ${code} on ${request.method} ${request.url}`);
    }

    const envelope: Record<string, unknown> = { code, message };
    if (retryAfterSeconds !== undefined) envelope.retry_after_seconds = retryAfterSeconds;

    response.status(status).json(envelope);
  }
}
