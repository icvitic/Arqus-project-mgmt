import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../src/db/schema';
import { RETENTION_CATEGORIES } from '../src/privacy/retention-policy';
import { EXPORT_CATEGORIES } from '../src/privacy/subject-data';

/**
 * WP1.23 – pokrivenost evidencije obrade (kao pokrivenost ruta): svaka tablica sheme mora imati zapis u strojno čitljivom
 * dijelu evidencije (`docs/gdpr/evidencija-obrade.json`), a svaki stupac koji po nazivu izgleda osobno mora biti naveden.
 * Nova tablica ili stupac s osobnim podacima bez zapisa ruši test – evidencija ne može tiho zastarjeti.
 */
const DOCS = join(__dirname, '..', '..', '..', 'docs', 'gdpr');
interface TableEntry { personal: boolean; reason?: string; subjects?: string[]; data?: string; purpose?: string; access?: string; retention?: string; retentionKey?: string; exportCategory?: string; columns: Record<string, string> }
const inventory = JSON.parse(readFileSync(join(DOCS, 'evidencija-obrade.json'), 'utf8')) as { subjectCategories: Record<string, string>; tables: Record<string, TableEntry> };
const markdown = readFileSync(join(DOCS, 'EVIDENCIJA-OBRADE.md'), 'utf8');

/** Nazivi stupaca koji izgledaju osobno: identiteti i veze na osobe, kontakt, mreža, vjerodajnice, plaće, slobodni tekst, JSON. */
export const LOOKS_PERSONAL = /(^|_)(email|name|ip|by|user_id|actor_id|member_id|user_agent|session_id|password_hash|token_hash|pseudonym|diff|data|link|description|note|comment|rationale|reason|mitigation|verification|objectives|supplier|submission|decision|identifiers|settings)$|^mfa_|^(last_login|last_used|closed|anonymised)_at$|cost_cents$/;

const tables = Object.values(schema).filter((v): v is PgTable => v instanceof PgTable).map((t) => getTableConfig(t));

describe('Evidencija obrade pokriva shemu (WP1.23)', () => {
  it('svaka tablica sheme ima zapis i nijedan zapis nije zastario', () => {
    const names = tables.map((t) => t.name).sort();
    expect(names.length).toBeGreaterThan(35);
    expect(names.filter((n) => !inventory.tables[n])).toEqual([]);
    expect(Object.keys(inventory.tables).filter((n) => !names.includes(n))).toEqual([]);
  });

  it('svaki stupac koji izgleda osobno je naveden; navedeni stupci postoje', () => {
    const missing: string[] = []; const stale: string[] = [];
    for (const t of tables) {
      const entry = inventory.tables[t.name]!;
      const cols = t.columns.map((c) => c.name);
      for (const c of cols) if (LOOKS_PERSONAL.test(c) && !(c in entry.columns)) missing.push(`${t.name}.${c}`);
      for (const c of Object.keys(entry.columns)) if (!cols.includes(c)) stale.push(`${t.name}.${c}`);
    }
    expect(missing).toEqual([]);
    expect(stale).toEqual([]);
  });

  it('osobna tablica ima kategoriju ispitanika, podatke, svrhu, pristup, rok i kategoriju izvoza; neosobna razlog', () => {
    const bad: string[] = [];
    for (const [name, e] of Object.entries(inventory.tables)) {
      if (!e.personal) { if (!e.reason) bad.push(`${name}: nema razloga`); continue; }
      for (const k of ['data', 'purpose', 'access', 'retention'] as const) if (!e[k]) bad.push(`${name}: nema ${k}`);
      if (!e.subjects?.length || e.subjects.some((s) => !inventory.subjectCategories[s])) bad.push(`${name}: kategorija ispitanika`);
      if (!e.exportCategory || !(EXPORT_CATEGORIES as readonly string[]).includes(e.exportCategory)) bad.push(`${name}: kategorija izvoza ${e.exportCategory}`);
      if (e.retentionKey && !RETENTION_CATEGORIES.some((c) => c.key === e.retentionKey)) bad.push(`${name}: rok ${e.retentionKey}`);
    }
    expect(bad).toEqual([]);
  });

  it('svaka kategorija izvoza dolazi iz evidencije, svaka kategorija roka čuvanja je u evidenciji', () => {
    const used = new Set(Object.values(inventory.tables).map((e) => e.exportCategory).filter(Boolean));
    expect(EXPORT_CATEGORIES.filter((c) => !used.has(c))).toEqual([]);
    const keys = new Set(Object.values(inventory.tables).map((e) => e.retentionKey).filter(Boolean));
    // Kategorije koje dijele tablicu s drugom (nepročitane obavijesti, neuspjele prijave u revizijskom zapisu) navedene su u tekstu roka.
    expect(RETENTION_CATEGORIES.map((c) => c.key).filter((k) => !keys.has(k) && !['notificationsUnread', 'loginFailures'].includes(k))).toEqual([]);
  });

  it('čitljiva evidencija (EVIDENCIJA-OBRADE.md) navodi svaku tablicu i svaki rok', () => {
    expect(tables.map((t) => t.name).filter((n) => !markdown.includes(`\`${n}\``))).toEqual([]);
    expect(RETENTION_CATEGORIES.map((c) => c.key).filter((k) => !markdown.includes(`\`${k}\``))).toEqual([]);
    expect(markdown).toMatch(/radni predložak/i);
  });
});
