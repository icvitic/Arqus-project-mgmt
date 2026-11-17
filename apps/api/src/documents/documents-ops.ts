import { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { hashStream } from './document-storage';
import type { DocumentBackend, ObjectInfo } from './storage-backends';

/**
 * Operativne naredbe nad sadržajem dokumenata (WP1.20): `documents verify` i `documents migrate`.
 * Obje su sigurne na živom sustavu: samo čitaju bazu, nikad ne brišu ni ne prepisuju postojeći objekt, a redoslijed
 * (popis pohrane → čitanje baze → ponovna provjera onoga što nedostaje) sprječava lažne nalaze zbog prijenosa u tijeku.
 */

export interface VersionRef { key: string; sha256: string; size: number; documentId: string; version: number; tenantId: string }

/** Sve verzije dokumenata svih institucija (vlasnička veza; aplikacijska uloga bi vidjela samo jednu instituciju). */
export async function loadVersions(ownerUrl: string, opts: { tenantIds?: string[] } = {}): Promise<VersionRef[]> {
  const pool = new Pool({ connectionString: ownerUrl, max: 1 });
  try {
    const filter = opts.tenantIds ? 'where tenant_id = any($1::uuid[])' : '';
    const { rows } = await pool.query<{ storage_key: string; sha256: string; size_bytes: string; document_id: string; version: number; tenant_id: string }>(
      `select storage_key, sha256, size_bytes, document_id, version, tenant_id from document_versions ${filter} order by created_at, document_id, version`, opts.tenantIds ? [opts.tenantIds] : []);
    return rows.map((r) => ({ key: r.storage_key, sha256: r.sha256, size: Number(r.size_bytes), documentId: r.document_id, version: r.version, tenantId: r.tenant_id }));
  } finally { await pool.end(); }
}

export interface VerifyReport {
  checked: number; ok: number; quick: boolean;
  missing: VersionRef[];
  corrupted: Array<VersionRef & { actualSize: number }>;
  /** Objekti bez verzije u bazi, stariji od `orphanGraceMs` (npr. pad procesa između zapisa i transakcije). */
  orphaned: ObjectInfo[];
  /** Objekti bez verzije, mlađi od praga – vjerojatno prijenos u tijeku; nisu problem. */
  recent: ObjectInfo[];
}

export const verifyProblems = (r: VerifyReport) => r.missing.length + r.corrupted.length + r.orphaned.length;

export async function verifyDocuments(storage: DocumentBackend, versions: () => Promise<VersionRef[]>, opts: { quick?: boolean; orphanGraceMs?: number; now?: () => Date; progress?: (done: number, total: number) => void } = {}): Promise<VerifyReport> {
  const now = opts.now ?? (() => new Date());
  const grace = opts.orphanGraceMs ?? 60 * 60 * 1000;
  const listed = new Map<string, ObjectInfo>();
  for await (const o of storage.list('')) listed.set(o.key, o);
  const refs = await versions();
  const r: VerifyReport = { checked: 0, ok: 0, quick: !!opts.quick, missing: [], corrupted: [], orphaned: [], recent: [] };
  const referenced = new Set<string>();
  for (const v of refs) {
    referenced.add(v.key);
    r.checked++;
    const head = listed.get(v.key) ?? (await storage.head(v.key));
    if (!head) { r.missing.push(v); continue; }
    if (head.size !== v.size) { r.corrupted.push({ ...v, actualSize: head.size }); continue; }
    if (!opts.quick) {
      const o = await storage.getStream(v.key);
      if (!o) { r.missing.push(v); continue; }
      const h = await hashStream(o.stream);
      if (h.sha256 !== v.sha256 || h.size !== v.size) { r.corrupted.push({ ...v, actualSize: h.size }); continue; }
    }
    r.ok++;
    opts.progress?.(r.checked, refs.length);
  }
  for (const o of listed.values()) {
    if (referenced.has(o.key)) continue;
    (now().getTime() - o.lastModified.getTime() < grace ? r.recent : r.orphaned).push(o);
  }
  return r;
}

export interface MigrateReport { total: number; copied: number; skipped: number; failed: Array<{ ref: VersionRef; reason: string }> }

/**
 * Kopija svih verzija iz baze iz `source` u `target` s istim ključem. Idempotentno i nastavljivo: objekt koji u odredištu
 * već postoji s ispravnim hashom preskače se; drugačiji sadržaj u odredištu se NE prepisuje (nalaz). Izvor se nikad ne
 * mijenja. Hash se provjerava na izvoru prije kopiranja i na odredištu nakon kopiranja. Nedostupnost bilo koje pohrane
 * prekida izvođenje (ponovno pokretanje nastavlja gdje je stalo).
 */
export async function migrateDocuments(source: DocumentBackend, target: DocumentBackend, refs: VersionRef[], opts: { progress?: (r: MigrateReport) => void } = {}): Promise<MigrateReport> {
  const r: MigrateReport = { total: refs.length, copied: 0, skipped: 0, failed: [] };
  const targetHash = async (key: string) => { const o = await target.getStream(key); return o ? hashStream(o.stream) : null; };
  for (const v of refs) {
    const existing = await target.head(v.key);
    if (existing) {
      const h = existing.size === v.size ? await targetHash(v.key) : null;
      if (h && h.sha256 === v.sha256 && h.size === v.size) r.skipped++;
      else r.failed.push({ ref: v, reason: 'u odredištu već postoji drugačiji sadržaj – ne prepisuje se' });
    } else {
      const o = await source.getStream(v.key);
      if (!o) { r.failed.push({ ref: v, reason: 'nedostaje u izvoru' }); opts.progress?.(r); continue; }
      const parts: Buffer[] = []; let n = 0; let tooBig = false;
      for await (const c of o.stream) { n += (c as Buffer).length; if (n > v.size) { tooBig = true; o.stream.destroy(); break; } parts.push(c as Buffer); }
      const content = Buffer.concat(parts);
      if (tooBig || content.length !== v.size || createHash('sha256').update(content).digest('hex') !== v.sha256) { r.failed.push({ ref: v, reason: 'oštećeno u izvoru (veličina ili SHA-256) – ne kopira se' }); opts.progress?.(r); continue; }
      await target.put(v.key, content);
      const h = await targetHash(v.key);
      if (!h || h.sha256 !== v.sha256 || h.size !== v.size) r.failed.push({ ref: v, reason: 'provjera u odredištu nakon kopiranja nije uspjela' });
      else r.copied++;
    }
    opts.progress?.(r);
  }
  return r;
}
