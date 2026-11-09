import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateProgrammePackage, resolvePackage, type ProgrammePackage, type ValidationIssue } from '@arqus/domain';
import { DbService, type Tx } from '../db/db.service';
import { programmePackages, type ProgrammePackageRow } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { TenantContext } from '../common/tenant-context';

export interface PackageSummary {
  id: string; packageId: string; version: string; programme: string; funder: string | null; status: string;
  scope: 'global' | 'tenant'; extendsId: string | null; validFrom: string; validTo: string | null; publishedAt: Date | null; updatedAt: Date;
}

const checksumOf = (content: unknown) => createHash('sha256').update(JSON.stringify(content)).digest('hex');
const summary = (r: ProgrammePackageRow): PackageSummary => ({
  id: r.id, packageId: r.packageId, version: r.version, programme: r.programme, funder: r.funder, status: r.status,
  scope: r.tenantId ? 'tenant' : 'global', extendsId: r.extendsId, validFrom: r.validFrom, validTo: r.validTo, publishedAt: r.publishedAt, updatedAt: r.updatedAt,
});

/**
 * M2 Paketi programa (ADR-0004). Globalne pakete uvozi vlasnik (`importDir`), stanari stvaraju vlastite
 * (npr. paket po pozivu s `extends`). Čitanje vraća RAZRIJEŠEN paket (lanac nasljeđivanja spojen).
 */
@Injectable()
export class ProgrammePackagesService {
  constructor(private readonly db: DbService, private readonly audit: AuditService, private readonly ctx: TenantContext) {}

  async list(tx: Tx, opts: { status?: string } = {}): Promise<PackageSummary[]> {
    const rows = await tx.select().from(programmePackages)
      .where(and(isNull(programmePackages.deletedAt), opts.status ? eq(programmePackages.status, opts.status as ProgrammePackageRow['status']) : undefined))
      .orderBy(programmePackages.packageId, desc(programmePackages.version));
    return rows.map(summary);
  }

  /** Najnovija objavljena verzija (ili bilo koja ako `anyStatus`) po `packageId`; stanarski ima prednost pred globalnim. */
  private async findRow(tx: Tx, packageId: string, version?: string, anyStatus = false): Promise<ProgrammePackageRow | undefined> {
    const rows = await tx.select().from(programmePackages)
      .where(and(eq(programmePackages.packageId, packageId), isNull(programmePackages.deletedAt),
        version ? eq(programmePackages.version, version) : undefined,
        anyStatus ? undefined : eq(programmePackages.status, 'published')))
      .orderBy(sql`${programmePackages.tenantId} is null`, desc(programmePackages.version));
    return rows[0];
  }

  async get(tx: Tx, packageId: string, version?: string): Promise<ProgrammePackage & { _row: PackageSummary }> {
    const row = await this.findRow(tx, packageId, version, true);
    if (!row) throw new NotFoundException(`Paket programa "${packageId}"${version ? ` v${version}` : ''} ne postoji`);
    const resolved = await this.resolve(tx, row.content as unknown as ProgrammePackage);
    return { ...resolved, _row: summary(row) };
  }

  private async resolve(tx: Tx, pkg: ProgrammePackage): Promise<ProgrammePackage> {
    // Učitaj cijeli lanac roditelja unaprijed (resolvePackage je sinkron).
    const parents = new Map<string, ProgrammePackage>();
    let ext = pkg.meta.extends; let guard = 0;
    while (ext && guard++ < 10 && !parents.has(ext)) {
      const row = await this.findRow(tx, ext, undefined, true); // roditelj smije biti i nacrt; 'samo objavljeni' vrijedi pri vezanju prijave/projekta
      if (!row) break;
      const p = row.content as unknown as ProgrammePackage;
      parents.set(ext, p); ext = p.meta.extends;
    }
    try { return resolvePackage(pkg, (id) => parents.get(id)); }
    catch (e) { throw new BadRequestException((e as Error).message); }
  }

  /** Validacija bez spremanja: shema + semantika, uz razrješenje nasljeđivanja ako je `extends` zadan. */
  async validate(tx: Tx, input: unknown): Promise<{ ok: boolean; issues: ValidationIssue[]; resolved?: ProgrammePackage }> {
    const direct = validateProgrammePackage(input);
    if (!direct.ok) return { ok: false, issues: direct.issues };
    if (!direct.pkg.meta.extends) return { ok: true, issues: [], resolved: direct.pkg };
    let resolved: ProgrammePackage;
    try { resolved = await this.resolve(tx, direct.pkg); }
    catch (e) { return { ok: false, issues: [{ path: '/meta/extends', message: (e as Error).message }] }; }
    const r = validateProgrammePackage(resolved);
    return r.ok ? { ok: true, issues: [], resolved } : { ok: false, issues: r.issues.map((i) => ({ ...i, message: `nakon nasljeđivanja: ${i.message}` })) };
  }

  /** Stanarski paket (nacrt). Isti packageId+version ne smije već postojati kod stanara. */
  async create(tx: Tx, tenantId: string, input: unknown, actorId?: string): Promise<PackageSummary> {
    const v = await this.validate(tx, input);
    if (!v.ok || !v.resolved) throw new BadRequestException({ message: 'Paket nije valjan', issues: v.issues });
    const pkg = input as ProgrammePackage;
    const dup = await tx.select({ id: programmePackages.id }).from(programmePackages)
      .where(and(eq(programmePackages.tenantId, tenantId), eq(programmePackages.packageId, pkg.meta.id), eq(programmePackages.version, pkg.meta.version)));
    if (dup.length) throw new ConflictException(`Paket ${pkg.meta.id} v${pkg.meta.version} već postoji`);
    const [row] = await tx.insert(programmePackages).values({
      tenantId, packageId: pkg.meta.id, version: pkg.meta.version, programme: pkg.meta.programme, funder: pkg.meta.funder ?? null,
      status: 'draft', extendsId: pkg.meta.extends ?? null, validFrom: pkg.meta.validFrom, validTo: pkg.meta.validTo ?? null,
      content: pkg as unknown as Record<string, unknown>, checksum: checksumOf(pkg), createdBy: actorId, updatedBy: actorId,
    }).returning();
    if (!row) throw new Error('Unos paketa nije uspio');
    await this.audit.record(tx, { entity: 'programme_package', entityId: row.id, action: 'create', diff: { after: summary(row) } });
    return summary(row);
  }

  /** Objava: nacrt → objavljen (nepromjenjiv). Prijave i projekti smiju koristiti samo objavljene verzije. */
  async publish(tx: Tx, tenantId: string, rowId: string, actorId?: string): Promise<PackageSummary> {
    const row = (await tx.select().from(programmePackages).where(and(eq(programmePackages.id, rowId), eq(programmePackages.tenantId, tenantId))))[0];
    if (!row) throw new NotFoundException('Paket ne postoji ili nije stanarski');
    if (row.status !== 'draft') throw new ConflictException(`Paket je u statusu "${row.status}"`);
    const [upd] = await tx.update(programmePackages).set({ status: 'published', publishedAt: new Date(), updatedAt: new Date(), updatedBy: actorId })
      .where(eq(programmePackages.id, rowId)).returning();
    await this.audit.record(tx, { entity: 'programme_package', entityId: rowId, action: 'publish', diff: { before: { status: 'draft' }, after: { status: 'published' } } });
    return summary(upd!);
  }

  /** Uvoz globalnih paketa iz mape (vlasnička veza, bez stanara). Idempotentno po (packageId, version, checksum). */
  static async importDir(tx: Tx, dir: string): Promise<{ imported: string[]; unchanged: string[]; rejected: { file: string; issues: ValidationIssue[] }[] }> {
    const out = { imported: [] as string[], unchanged: [] as string[], rejected: [] as { file: string; issues: ValidationIssue[] }[] };
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('schema')).sort()) {
      const json = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
      const r = validateProgrammePackage(json);
      if (!r.ok) { out.rejected.push({ file, issues: r.issues }); continue; }
      const pkg = r.pkg; const checksum = checksumOf(pkg);
      const existing = (await tx.select().from(programmePackages)
        .where(and(isNull(programmePackages.tenantId), eq(programmePackages.packageId, pkg.meta.id), eq(programmePackages.version, pkg.meta.version))))[0];
      if (existing && existing.checksum === checksum) { out.unchanged.push(file); continue; }
      const values = {
        programme: pkg.meta.programme, funder: pkg.meta.funder ?? null, status: (pkg.meta.status ?? 'published') as ProgrammePackageRow['status'],
        extendsId: pkg.meta.extends ?? null, validFrom: pkg.meta.validFrom, validTo: pkg.meta.validTo ?? null,
        content: pkg as unknown as Record<string, unknown>, checksum, updatedAt: new Date(),
        publishedAt: (pkg.meta.status ?? 'published') === 'published' ? new Date() : null,
      };
      if (existing) await tx.update(programmePackages).set(values).where(eq(programmePackages.id, existing.id));
      else await tx.insert(programmePackages).values({ tenantId: null, packageId: pkg.meta.id, version: pkg.meta.version, ...values });
      out.imported.push(file);
    }
    return out;
  }
}

/** Pomoćno: `or`/`isNull` izvezeni za testove koji sastavljaju upite. */
export { or, isNull };
