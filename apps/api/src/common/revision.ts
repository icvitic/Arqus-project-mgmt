import { ConflictException } from '@nestjs/common';
import { eq, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { Tx } from '../db/db.service';
import { users } from '../db/schema';
import { tenantTimeZone } from './tenant-context';

/**
 * WP1.14b – zaštita od tihog prepisivanja (optimistička istovremenost). Jedan mehanizam za cijeli sustav: cjelobrojna
 * revizija retka (`revision`) raste pri svakoj izmjeni. Klijent uz spremanje šalje reviziju koju je učitao; ako se pohranjena
 * razlikuje, odgovor je 409 s tim tko je i kada promijenio zapis, a ništa se ne zapisuje (provjera je prva radnja u
 * transakciji, uz zaključavanje retka). `0` znači „zapis još ne postoji” (prvi proračun, prvi unos timesheeta).
 */
export const REVISION_REQUIRED = 'Nedostaje revizija (revision) – pošalji reviziju zapisa koju si učitao (0 ako zapis još ne postoji); bez nje se spremanje odbija';
/** WP1.19: revizija je obavezna na svakom spremanju koje je prima (bez nje 400) – nema spremanja bez provjere. */
export const revisionField = z.number({ error: (iss) => (iss.input === undefined ? REVISION_REQUIRED : 'revizija mora biti cijeli broj ≥ 0') }).int().min(0).max(2_147_483_647);

export const REVISION_CONFLICT = 'revision_conflict';

interface Versioned { id: PgColumn; revision: PgColumn; updatedAt: PgColumn; updatedBy: PgColumn }

/** Izraz za povećanje revizije u `set({ revision: bump(t) })`. */
export const bump = (t: { revision: PgColumn }): SQL => sql`${t.revision} + 1`;

/**
 * Provjera revizije uz zaključavanje retka (`FOR UPDATE` – istovremena spremanja čekaju jedno drugo, pa drugo vidi novu reviziju).
 * Redak `null` → zapis ne postoji (očekuje se 0). WP1.19: revizija je obavezna (shema `revisionField` odbija zahtjev bez nje).
 */
export async function assertRevision(tx: Tx, table: PgTable & Versioned, id: string | null, expected: number, what: string): Promise<void> {
  const row = id ? (await tx.select({ revision: table.revision, updatedAt: table.updatedAt, updatedBy: table.updatedBy }).from(table as PgTable).where(eq(table.id, id)).for('update'))[0] as
    { revision: number; updatedAt: Date; updatedBy: string | null } | undefined : undefined;
  const current = row?.revision ?? 0;
  if (current === expected) return;
  const by = row?.updatedBy ? (await tx.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.id, row.updatedBy)))[0] ?? null : null;
  const when = row?.updatedAt ? new Date(row.updatedAt) : null;
  const stamp = when ? when.toLocaleString('hr-HR', { timeZone: tenantTimeZone(), day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
  throw new ConflictException({
    message: `${what} je u međuvremenu promijenio${by ? ` korisnik ${by.displayName}` : ' drugi korisnik'}${stamp ? ` (${stamp})` : ''}. Tvoje izmjene nisu spremljene – učitaj najnovije stanje i ponovi izmjenu.`,
    code: REVISION_CONFLICT,
    conflict: { expected, current, updatedAt: when?.toISOString() ?? null, updatedBy: by },
  });
}
