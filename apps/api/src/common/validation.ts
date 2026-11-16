import { BadRequestException } from '@nestjs/common';
import type { ZodType, output } from 'zod';

/** Validacija tijela zahtjeva Zod shemom; greška → 400 s popisom problema u istom obliku kao validacija paketa. */
export function parseBody<S extends ZodType>(schema: S, body: unknown): output<S> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    throw new BadRequestException({ message: 'Neispravan zahtjev', issues: r.error.issues.map((i) => ({ path: `/${i.path.map(String).join('/')}`, message: i.message })) });
  }
  return r.data as output<S>;
}
