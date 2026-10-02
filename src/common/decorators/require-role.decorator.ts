import { Role } from '@prisma/client';
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'auth:required_roles';

/**
 * Restrict a route to the given roles (§7 require_role). Paired with RolesGuard.
 * Usage: `@Roles(Role.admin)` on a Backoffice controller handler.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
