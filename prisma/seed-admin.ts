/**
 * Admin seed CLI (auth-api-spec §4.2, plan admin section). Admins are created ONLY
 * via this operator-run script — there is no public registration. Idempotent upsert
 * by email; password is argon2id-hashed with the exact same params the app uses at
 * login (see AdminAuthService.ARGON2_OPTIONS) so a seeded admin verifies cleanly.
 *
 * Usage (PowerShell):
 *   $env:ADMIN_EMAIL="ops@example.com"; $env:ADMIN_PASSWORD="correct horse...";
 *   npx ts-node prisma/seed-admin.ts
 *
 * Pass ENABLE_TOTP=true to generate + print a TOTP secret/URI to enroll in an
 * authenticator app; the secret is stored on the row and totpEnabled set true.
 */
import { PrismaClient, Role } from '@prisma/client';
import { argon2id, hash } from 'argon2';
import { authenticator } from 'otplib';

// Keep identical to AdminAuthService so verify() succeeds (§8.5).
const ARGON2_OPTIONS = {
  type: argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

function assertStrongPassword(pw: string): void {
  const ok = pw.length >= 12 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
  if (!ok) {
    throw new Error('ADMIN_PASSWORD must be >= 12 chars and include a letter and a digit');
  }
}

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const enableTotp = process.env.ENABLE_TOTP === 'true';

  if (!email || !password) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD environment variables are required');
  }
  assertStrongPassword(password);

  const prisma = new PrismaClient();
  try {
    const passwordHash = await hash(password, ARGON2_OPTIONS);

    let totpSecret: string | null = null;
    if (enableTotp) {
      authenticator.options = { step: 30, window: 1, digits: 6 };
      totpSecret = authenticator.generateSecret();
      const uri = authenticator.keyuri(email, process.env.TOTP_ISSUER ?? 'RideHailing Backoffice', totpSecret);
      console.log(`Enroll TOTP (scan in authenticator app):\n  ${uri}`);
    }

    const admin = await prisma.user.upsert({
      where: { email },
      update: {
        role: Role.admin,
        passwordHash,
        isActive: true,
        ...(enableTotp && totpSecret ? { totpSecret, totpEnabled: true } : {}),
      },
      create: {
        email,
        role: Role.admin,
        passwordHash,
        isActive: true,
        ...(enableTotp && totpSecret ? { totpSecret, totpEnabled: true } : {}),
      },
    });

    console.log(`Admin seeded: id=${admin.id} email=${admin.email} totpEnabled=${admin.totpEnabled}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
