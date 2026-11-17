import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { securityHeaders } from './security';

/**
 * WP1.19 – HTTP postavke zajedničke za produkcijski proces (`main.ts`) i testove:
 * - sigurnosna zaglavlja prije čitanja tijela, pa ih imaju i odgovori 400/413 parsera (prije su ih preskakali);
 * - tijelo JSON najviše `BODY_LIMIT` (zadano 1 MB); neispravan ili prevelik JSON → kratka poruka bez detalja parsera;
 * - bez `X-Powered-By`, prefiks `/api`.
 */
export function configureHttp(app: NestExpressApplication, production: boolean): void {
  app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal');
  app.disable('x-powered-by');
  app.use(securityHeaders(production));
  app.useBodyParser('json', { limit: process.env.BODY_LIMIT ?? '1mb' });
  app.use(bodyParserErrors);
  app.setGlobalPrefix('api');
}

/** Greške parsera tijela (body-parser) → JSON 400/413 s jasnom porukom; ostale greške idu dalje (Nest). */
export function bodyParserErrors(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  const e = err as { type?: string; status?: number } | null;
  if (e?.type === 'entity.too.large') { res.status(413).json({ statusCode: 413, message: 'Tijelo zahtjeva je preveliko' }); return; }
  if (e?.type === 'entity.parse.failed') { res.status(400).json({ statusCode: 400, message: 'Tijelo zahtjeva nije ispravan JSON' }); return; }
  if (e?.type && typeof e.status === 'number' && e.status >= 400 && e.status < 500) { res.status(e.status).json({ statusCode: e.status, message: 'Neispravno tijelo zahtjeva' }); return; }
  next(err);
}
