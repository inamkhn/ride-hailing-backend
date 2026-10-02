import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { AuthError } from '../errors/auth-error';
import { ROLES_KEY } from '../decorators/require-role.decorator';
import { AuthenticatedUser } from '../../modules/auth/types/auth.types';

/**
 * Enforces @Roles(...) after authentication. Runs after JwtAuthGuard, which
 * populates request.user. A route with no @Roles is left open to any authenticated
 * caller. Rejects with 403 forbidden_role (§8.6).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    // No user => JwtAuthGuard didn't run/allow; treat as forbidden role.
    if (!request.user) throw AuthError.forbiddenRole();
    if (!required.includes(request.user.role)) throw AuthError.forbiddenRole();
    return true;
  }
}
