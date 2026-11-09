import { BadRequestException } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';

/** Validacija tijela zahtjeva Zod shemom; greška → 400 s popisom problema u istom obliku kao validacija paketa. */
export function parseBody<T>(schema: ZodType<T, ZodTypeDef, unknown>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    throw new BadRequestException({ message: 'Neispravan zahtjev', issues: r.error.issues.map((i) => ({ path: `/${i.path.join('/')}`, message: i.message })) });
  }
  return r.data;
}
