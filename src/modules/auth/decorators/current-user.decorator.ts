import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../types/auth.types';

/**
 * Injects the authenticated principal set by JwtAuthGuard.
 *   `@CurrentUser() user: AuthenticatedUser`  → { userId, role, jti }
 *   `@CurrentUser('userId') id: string`        → single field
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
