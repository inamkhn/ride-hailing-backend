import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Every route is served under /v1 (auth-api-spec §1).
  app.setGlobalPrefix('v1');

  // DTO contract enforcement (§2.4): strip unknown fields, reject extras, and
  // transform payloads to their DTO class instances so class-validator runs.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Uniform error envelope for all failures, including ones thrown before a
  // controller (guards, pipes) (§2.4, §8.6).
  app.useGlobalFilters(new AllExceptionsFilter());

  // Gracefully close Prisma/Redis connections on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

void bootstrap();
