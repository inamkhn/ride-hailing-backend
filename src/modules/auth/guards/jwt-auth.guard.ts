import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthError } from '../../../common/errors/auth-error';
import { AuthenticatedUser } from '../types/auth.types';
import { TokenService } from '../token.service';

/**
 * Guards protected routes (§7 get_current_user): validates the bearer access token
 * and attaches `request.user = { userId, role, jti }`. Throws token_expired vs
 * token_invalid distinctly so the client knows whether to refresh or log out (§8.6).
 * Pair with RolesGuard for role-gated endpoints.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const token = this.tokens.fromBearer(header);
    if (!token) throw AuthError.tokenInvalid('Missing bearer token');

    const payload = this.tokens.verifyAccessToken(token);
    (request as Request & { user?: AuthenticatedUser }).user = {
      userId: payload.sub,
      role: payload.role,
      jti: payload.jti,
    };
    return true;
  }
}
