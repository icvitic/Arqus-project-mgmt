import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { securityHeaders } from './common/security';

async function bootstrap(): Promise<void> {
  const production = process.env.NODE_ENV === 'production';
  if (production && (process.env.AUTH_JWT_SECRET ?? '').length < 32) throw new Error('AUTH_JWT_SECRET mora imati barem 32 znaka u produkciji');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, logger: production ? ['error', 'warn', 'log'] : undefined });
  app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal');
  app.disable('x-powered-by');
  app.useBodyParser('json', { limit: process.env.BODY_LIMIT ?? '1mb' });
  app.use(securityHeaders(production));
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  // Izgrađeno web sučelje poslužuje isti proces (jedno podrijetlo, bez CORS-a). Hash usmjeravanje → dovoljan je index.html.
  const webDist = process.env.WEB_DIST ?? join(__dirname, '..', '..', 'web', 'dist');
  if (existsSync(join(webDist, 'index.html'))) app.useStaticAssets(webDist, { index: 'index.html', maxAge: production ? '1h' : 0 });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`ArQus API sluša na http://localhost:${port}/api/health${existsSync(join(webDist, 'index.html')) ? ` · web: ${webDist}` : ''}`);
}
void bootstrap();
