/* Operativni CLI za instalaciju (kontejner): `node dist/db/cli.js migrate | import-packages | seed | init`.
 * migrate – primjena migracija i usklađivanje sistemskih uloga (vlasnička uloga DATABASE_MIGRATE_URL)
 * import-packages – uvoz/osvježavanje globalnih paketa programa (ARQUS_PACKAGES_DIR)
 * seed – prvi stanar i administrator (SEED_TENANT_SLUG, SEED_TENANT_NAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD); u produkciji
 *   novi stanar dobiva obvezni MFA za povlaštene uloge (WP1.19)
 * init – migrate + import-packages (pri svakom pokretanju kontejnera; idempotentno)
 * import-calls [--file a.json ...] – uvoz globalnih poziva s portala EU Funding & Tenders (ili iz spremljenih odgovora search API-ja)
 * demo [--reset] [--slug <oznaka>] – demo institucija s realnim podacima (WP1.13; nikad implicitno). Treba i DATABASE_URL (aplikacijska uloga);
 *   u produkciji samo uz ARQUS_DEMO=1. Lozinka demo korisnika: DEMO_PASSWORD ili zadana (docs/DEMO.md).
 * documents verify [--quick] – svaka verzija iz baze postoji u pohrani s ispravnom veličinom i SHA-256 (--quick: samo veličina);
 *   popis nedostajućih, oštećenih i siročadi; izlazni kod 1 kod problema (WP1.20)
 * documents migrate --to s3|local|mirror – kopija svih verzija iz trenutne pohrane (DOCUMENTS_STORAGE) u drugu, s provjerom
 *   hasha; idempotentno i nastavljivo, izvor se nikad ne briše; mirror = drugi bucket (DOCUMENTS_MIRROR_S3_*)
 * backup offsite – jedna sinkronizacija kopija iz BACKUP_DIR (/backups) u S3 (BACKUP_S3_*), šifrirano BACKUP_ENCRYPTION_KEY
 * backup status [--max-age-hours N] – stanje kopija izvan poslužitelja; izlazni kod 1 kad nije u redu (provjera zdravlja)
 * backup fetch --dir <dir> [--at <ISO vrijeme>] [--no-documents] – preuzimanje i dešifriranje najnovije kopije baze i arhive dokumenata
 * backup decrypt <ulaz.enc> <izlaz> | backup encrypt <ulaz> <izlaz.enc> | backup key-fingerprint – samo s ključem, bez baze i mreže */
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
import { runMigrations } from './migrate';
import { IdentityService } from '../identity/identity.service';
import { importGlobalPackages, seedDemo } from './seed';
import { DEMO_INVITED } from '../demo/scenario';
import { readFileSync } from 'node:fs';
import { fetchFtResults, importFtCalls } from '../calls/ft-import';
import type { FtResult } from '@arqus/domain';
import { createReadStream } from 'node:fs';
import { createBackend, storageKindFromEnv, type StorageKind } from '../documents/storage-backends';
import { loadVersions, migrateDocuments, verifyDocuments, verifyProblems } from '../documents/documents-ops';
import { keyFingerprint, parseBackupKey } from '../backup/backup-crypto';
import { checkOffsite, decryptToFile, encryptFile, fetchLatest, s3Remote, syncOffsite } from '../backup/offsite';
import { S3Client, s3ConfigFromEnv } from '../storage/s3-client';

async function main(cmd: string | undefined): Promise<void> {
  if (cmd === 'backup') return backup(process.argv[3], process.argv.slice(4));
  const url = process.env.DATABASE_MIGRATE_URL;
  if (!url) throw new Error('DATABASE_MIGRATE_URL nije postavljen');
  if (cmd === 'migrate' || cmd === 'init') {
    await runMigrations(url); console.log('Migracije primijenjene.');
    // Sistemske uloge iz koda (dozvole se mijenjaju s verzijama, npr. WP1.14) – postojeća instalacija ih preuzima pri svakom pokretanju.
    await syncSystemRoles(url); console.log('Sistemske uloge usklađene.');
    // Migracija 0001 stvara aplikacijsku ulogu sa zadanom lozinkom; u instalaciji je zamjenjujemo tajnom iz okruženja.
    const appPw = process.env.DB_APP_PASSWORD;
    if (appPw) {
      if (appPw.length < 16) throw new Error('DB_APP_PASSWORD mora imati barem 16 znakova');
      const pool = new Pool({ connectionString: url, max: 1 });
      try { const { rows } = await pool.query<{ q: string }>(`select format('ALTER ROLE arqus_app WITH PASSWORD %L', $1::text) as q`, [appPw]); await pool.query(rows[0]!.q); }
      finally { await pool.end(); }
      console.log('Lozinka aplikacijske uloge postavljena.');
    } else if (process.env.NODE_ENV === 'production') throw new Error('U produkciji DB_APP_PASSWORD je obvezan');
  }
  if (cmd === 'import-packages' || cmd === 'init') {
    const r = await importGlobalPackages(url);
    console.log(`Paketi – uvezeno: ${r.imported.join(', ') || '-'}; nepromijenjeno: ${r.unchanged.join(', ') || '-'}`);
    if (r.rejected.length) { console.error('Odbijeni paketi:', JSON.stringify(r.rejected)); process.exitCode = 1; }
  }
  if (cmd === 'seed') {
    if (process.env.NODE_ENV === 'production' && (process.env.SEED_ADMIN_PASSWORD ?? '').length < 12) throw new Error('U produkciji SEED_ADMIN_PASSWORD mora imati barem 12 znakova');
    // WP1.19: nova produkcijska institucija ima obvezan MFA za povlaštene uloge (administrator pri prvoj prijavi postavlja MFA).
    const production = process.env.NODE_ENV === 'production';
    const r = await seedDemo({ url, importPackages: false, requireMfa: production ? 'privileged' : undefined });
    console.log(`Stanar ${r.tenantSlug}, administrator ${r.adminEmail} (lozinka iz SEED_ADMIN_PASSWORD).${production ? ' Obvezni MFA: povlaštene uloge (administrator postavlja MFA pri prvoj prijavi).' : ''}`);
  }
  if (cmd === 'import-calls') {
    const files = process.argv.slice(3).filter((a) => a !== '--file');
    const results = files.length ? files.flatMap((f) => (JSON.parse(readFileSync(f, 'utf8')) as { results: FtResult[] }).results) : await fetchFtResults();
    const r = await importFtCalls(url, results);
    console.log(`F&T – dohvaćeno ${r.fetched}; novih ${r.inserted}, osvježeno ${r.updated}, ručnih zadržano ${r.keptManual}; preskočeno: duplikati ${r.skipped.duplicate}, istekli ${r.skipped.expired}, neispravni ${r.skipped.invalid}`);
  }
  if (cmd === 'demo') await demo(url, process.argv.slice(3));
  if (cmd === 'documents') await documents(url, process.argv[3], process.argv.slice(4));
  if (!['migrate', 'import-packages', 'seed', 'init', 'import-calls', 'demo', 'documents'].includes(cmd ?? '')) throw new Error('Naredba: migrate | import-packages | seed | init | import-calls | demo | documents | backup');
}

async function syncSystemRoles(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try { await drizzle(pool, { schema }).transaction((tx) => IdentityService.ensureSystemRoles(tx)); }
  finally { await pool.end(); }
}

async function demo(ownerUrl: string, args: string[]): Promise<void> {
  if (process.env.NODE_ENV === 'production' && process.env.ARQUS_DEMO !== '1') throw new Error('Demo podaci se u produkciji pune samo uz ARQUS_DEMO=1 (zaštita pilot-instalacije).');
  const appUrl = process.env.DATABASE_URL;
  if (!appUrl) throw new Error('DATABASE_URL (aplikacijska uloga) nije postavljen – demo podaci pune se kroz API pod RLS-om');
  const unknown = args.filter((a, i) => !['--reset', '--slug'].includes(a) && args[i - 1] !== '--slug');
  if (unknown.length) throw new Error(`Nepoznati argumenti: ${unknown.join(' ')} (demo [--reset] [--slug <oznaka>])`);
  const slugAt = args.indexOf('--slug');
  const { runDemo } = await import('../demo/demo');
  const started = Date.now();
  const r = await runDemo({ ownerUrl, appUrl, reset: args.includes('--reset'), slug: slugAt >= 0 ? args[slugAt + 1] : undefined, password: process.env.DEMO_PASSWORD || undefined, log: (m) => console.log(`  ${m}`) });
  console.log(r.status === 'created' ? `Demo institucija "${r.slug}" spremna (${((Date.now() - started) / 1000).toFixed(0)} s).` : `Demo institucija "${r.slug}" već postoji.`);
  if (r.summary) console.log(`  projekti: ${r.summary.projects.join(', ')}; prijave: ${r.summary.proposals.join(', ')}; pozivi: ${r.summary.calls}; timesheetovi: ${r.summary.timesheets}; troškovi: ${r.summary.expenses}; dokumenti: ${r.summary.documents}; ZNS: ${r.summary.claims}`);
  console.log(`Prijava: oznaka institucije "${r.slug}", lozinka za sve račune: ${r.password}`);
  for (const u of r.users) console.log(`  ${u.email.padEnd(28)} ${u.roleLabel} – ${u.note}`);
  console.log(`  ${`${DEMO_INVITED.local}@${r.slug}.local`.padEnd(28)} ${DEMO_INVITED.displayName} – ${DEMO_INVITED.note} (bez lozinke)`);
}
const flag = (args: string[], name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

/** WP1.20: provjera i prijenos sadržaja dokumenata (sigurno na živom sustavu – samo čita bazu, ništa ne briše). */
async function documents(ownerUrl: string, sub: string | undefined, args: string[]): Promise<void> {
  const current = storageKindFromEnv(process.env);
  if (sub === 'verify') {
    const quick = args.includes('--quick');
    const storage = createBackend(current, process.env);
    console.log(`Provjera dokumenata (pohrana: ${current}${quick ? ', samo veličina' : ', veličina i SHA-256'})…`);
    const r = await verifyDocuments(storage, () => loadVersions(ownerUrl), { quick, progress: (d, t) => { if (d % 500 === 0) console.log(`  ${d}/${t}`); } });
    console.log(`Verzija u bazi: ${r.checked}; ispravnih: ${r.ok}; nedostaje: ${r.missing.length}; oštećeno: ${r.corrupted.length}; siročadi: ${r.orphaned.length}${r.recent.length ? ` (+${r.recent.length} mlađih od 1 h – vjerojatno prijenos u tijeku)` : ''}`);
    for (const m of r.missing) console.error(`  NEDOSTAJE  ${m.key}  dokument ${m.documentId} v${m.version} (${m.size} B)`);
    for (const c of r.corrupted) console.error(`  OŠTEĆENO   ${c.key}  dokument ${c.documentId} v${c.version} (očekivano ${c.size} B, u pohrani ${c.actualSize} B ili drugi SHA-256)`);
    for (const o of r.orphaned) console.error(`  SIROČE     ${o.key} (${o.size} B, ${o.lastModified.toISOString()}) – nema verzije u bazi`);
    if (verifyProblems(r)) { console.error('Problemi pronađeni – vidi docs/PILOT-INSTALACIJA.md (obnova dokumenata).'); process.exitCode = 1; }
    return;
  }
  if (sub === 'migrate') {
    const to = flag(args, '--to');
    if (to !== 's3' && to !== 'local' && to !== 'mirror') throw new Error('documents migrate --to s3|local|mirror');
    if (to === current) throw new Error(`Pohrana je već "${current}" (DOCUMENTS_STORAGE). Izvor je uvijek trenutna pohrana – za povratak postavi DOCUMENTS_STORAGE na izvor i ponovi.`);
    const source = createBackend(current, process.env);
    const target = to === 'mirror' ? createBackend('s3', process.env, 'DOCUMENTS_MIRROR_S3_') : createBackend(to as StorageKind, process.env);
    const refs = await loadVersions(ownerUrl);
    console.log(`Prijenos ${refs.length} verzija: ${current} → ${to} (izvor se ne mijenja; ponovno pokretanje nastavlja)…`);
    const r = await migrateDocuments(source, target, refs, { progress: (p) => { const d = p.copied + p.skipped + p.failed.length; if (d % 200 === 0) console.log(`  ${d}/${p.total}`); } });
    console.log(`Kopirano: ${r.copied}; već u odredištu (provjereno): ${r.skipped}; neuspjelo: ${r.failed.length}`);
    for (const f of r.failed) console.error(`  ${f.ref.key}  dokument ${f.ref.documentId} v${f.ref.version}: ${f.reason}`);
    if (r.failed.length) process.exitCode = 1;
    else if (to !== 'mirror') console.log(`Sve verzije su u odredištu. Sljedeće: zaustavi aplikaciju, ponovi naredbu (kopira ono što je stiglo u međuvremenu), postavi DOCUMENTS_STORAGE=${to} i pokreni aplikaciju.`);
    return;
  }
  throw new Error('Naredba: documents verify [--quick] | documents migrate --to s3|local|mirror');
}

/** WP1.20: kopije izvan poslužitelja (šifriranje na poslužitelju, S3), stanje, preuzimanje i dešifriranje za obnovu. */
async function backup(sub: string | undefined, args: string[]): Promise<void> {
  const env = process.env;
  const stateDir = env.OFFSITE_STATE_DIR ?? '/data/offsite';
  const log = { info: (m: string) => console.log(`${new Date().toISOString()} ${m}`), error: (m: string) => console.error(`${new Date().toISOString()} ${m}`) };
  if (sub === 'key-fingerprint') { console.log(keyFingerprint(parseBackupKey(env.BACKUP_ENCRYPTION_KEY))); return; }
  if (sub === 'encrypt' || sub === 'decrypt') {
    const [input, output] = args;
    if (!input || !output) throw new Error(`backup ${sub} <ulaz> <izlaz>`);
    const key = parseBackupKey(env.BACKUP_ENCRYPTION_KEY);
    if (sub === 'encrypt') await encryptFile(input, output, key); else await decryptToFile(createReadStream(input), output, key);
    console.log(`${sub === 'encrypt' ? 'Šifrirano' : 'Dešifrirano i provjereno'}: ${output}`);
    return;
  }
  if (sub === 'status') {
    const maxAge = Number(flag(args, '--max-age-hours') ?? env.BACKUP_OFFSITE_MAX_AGE_HOURS ?? 3);
    const r = await checkOffsite(stateDir, maxAge);
    if (r.status) console.log(`Zadnje izvođenje: ${r.status.lastRunAt} (${r.status.ok ? 'uspjelo' : 'NEUSPJELO'}); zadnja uspješna: ${r.status.lastSuccessAt ?? 'nikad'}; u bucketu: ${r.status.remote.count}; najnovija kopija baze: ${r.status.remote.latestDump ?? '–'}; najnovija arhiva dokumenata: ${r.status.remote.latestDocuments ?? '–'}; otisak ključa: ${r.status.keyFingerprint}`);
    for (const p of r.problems) console.error(`[GREŠKA] ${p}`);
    if (!r.ok) process.exitCode = 1;
    return;
  }
  const client = () => new S3Client(s3ConfigFromEnv(env, 'BACKUP_S3_'));
  if (sub === 'offsite') {
    const key = parseBackupKey(env.BACKUP_ENCRYPTION_KEY);
    const retention = Number(env.BACKUP_OFFSITE_RETENTION_DAYS ?? 30);
    if (!Number.isInteger(retention) || retention < 1) throw new Error('BACKUP_OFFSITE_RETENTION_DAYS mora biti cijeli broj ≥ 1');
    const s = await syncOffsite({ dir: env.BACKUP_DIR ?? '/backups', stateDir, remote: s3Remote(client()), key, retentionDays: retention, log });
    if (!s.ok) process.exitCode = 1;
    return;
  }
  if (sub === 'fetch') {
    const dir = flag(args, '--dir');
    if (!dir) throw new Error('backup fetch --dir <direktorij> [--at <ISO vrijeme>] [--no-documents]');
    const at = flag(args, '--at');
    const r = await fetchLatest({ remote: s3Remote(client()), key: parseBackupKey(env.BACKUP_ENCRYPTION_KEY), dir, at: at ? new Date(at) : undefined, documents: !args.includes('--no-documents'), log: log.info });
    console.log(`KOPIJA_BAZE=${r.dump}`);
    console.log(`ARHIVA_DOKUMENATA=${r.documents ?? ''}`);
    return;
  }
  throw new Error('Naredba: backup offsite | status | fetch | decrypt | encrypt | key-fingerprint');
}

main(process.argv[2]).catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
