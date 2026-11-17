import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { claimTotals, flattenCategories, monthsInPeriod, type PartnerBudgetResult } from '@arqus/domain';
import { DbService, type Tx } from '../db/db.service';
import { documents, documentVersions, expenses, organisations, projectPartners, reimbursementClaims, teamMembers, timesheetEntries, timesheets, users, workPackages } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { ProgrammePackagesService } from '../programmes/programme-packages.service';
import { DocumentStorage } from '../documents/document-storage';
import { TenantContext, tenantToday } from '../common/tenant-context';
import { canOnProject } from '../common/access';
import { loadProject } from '../common/project-access';
import { readVersion } from '../health/health.controller';
import { asciiSlug, safeFileName, UniqueNames, ZipWriter } from '../export/zip-writer';
import { buildXlsx } from '../export/xlsx-writer';
import { ClaimsService } from './claims.service';
import { checklistHtml, claimWorkbook, manifestCsv, type EvidenceRef, type ExportData, type ManifestFile, type ManifestOmitted, type PersonnelRow } from './claim-export-render';
import { loadTimesheetRecords, renderTimesheetRecord } from './timesheet-record';

/**
 * Najveći ukupni zbroj dokaza u jednom paketu (zadano 500 MiB, `CLAIM_EXPORT_MAX_BYTES`). Pojedini dokaz je najviše 25 MB;
 * granica čuva poslužitelj (dvostruko čitanje: provjera pa slanje) i ostaje daleko ispod 4 GiB (ZIP bez ZIP64).
 */
export const DEFAULT_MAX_EXPORT_BYTES = 500 * 1024 * 1024;
const maxBytes = () => { const n = Number(process.env.CLAIM_EXPORT_MAX_BYTES); return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_EXPORT_BYTES; };
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const mb = (n: number) => `${(n / 1024 / 1024).toLocaleString('hr-HR', { maximumFractionDigits: 1 })} MB`;

interface EvidencePlan { expenseId: string; path: string; storageKey: string; sha256: string; size: number; documentId: string }
interface Generated { path: string; data: Buffer }

/**
 * Paket ZNS-a za predaju (WP1.16b): jedan ZIP s radnom knjigom troškova, mjesečnim evidencijama rada, dokazima,
 * kontrolnom listom i manifestom. Tijek: (1) svi podaci u jednoj transakciji, (2) izrada generiranih datoteka,
 * (3) provjera SHA-256 svih dokaza prije prvog poslanog bajta (neslaganje → 409 i revizijski zapis o neuspjehu),
 * (4) revizijski zapis izvoza, (5) strujanje ZIP-a bez otvorene transakcije – dokaz se pri slanju ponovno provjerava.
 */
@Injectable()
export class ClaimExportService {
  private readonly log = new Logger(ClaimExportService.name);
  constructor(
    private readonly claims: ClaimsService, private readonly packages: ProgrammePackagesService, private readonly storage: DocumentStorage,
    private readonly audit: AuditService, private readonly db: DbService, private readonly ctx: TenantContext,
  ) {}

  async export(projectId: string, claimId: string): Promise<{ fileName: string; stream: Readable }> {
    const ctx = this.ctx.require();
    const now = new Date();
    const read = await this.db.tx((tx) => this.read(tx, projectId, claimId));
    const { data, evidence, omitted, records, exporter } = read;

    const total = evidence.reduce((a, e) => a + e.size, 0);
    if (total > maxBytes()) {
      throw new ConflictException(`Dokazi zahtjeva zajedno imaju ${mb(total)}, a paket smije imati najviše ${mb(maxBytes())}. Preuzmi dokaze pojedinačno na kartici „Dokumenti” ili javi administratoru (CLAIM_EXPORT_MAX_BYTES).`);
    }

    // Generirane datoteke (deterministične – bez vremena izvoza).
    const generated: Generated[] = [];
    generated.push({ path: 'troskovi.xlsx', data: await buildXlsx(claimWorkbook(data)) });
    generated.push({ path: 'kontrolna-lista.html', data: Buffer.from(checklistHtml(data), 'utf8') });
    for (const r of records) generated.push({ path: r.path, data: Buffer.from(renderTimesheetRecord(r.record, { draftClaim: data.draft }), 'utf8') });

    // Provjera cjelovitosti svih dokaza PRIJE slanja (jasna greška umjesto prekinutog preuzimanja).
    for (const e of evidence) {
      let content: Buffer | null = null;
      try { content = await this.storage.get(e.storageKey); } catch { content = null; }
      if (!content || sha256(content) !== e.sha256) {
        const reason = content ? 'sadržaj se ne slaže s pohranjenim SHA-256' : 'datoteka nedostaje u pohrani';
        await this.db.tx((tx) => this.audit.record(tx, { entity: 'claim', entityId: claimId, action: 'export.failed', diff: { meta: { documentId: e.documentId, path: e.path, reason } } }));
        throw new ConflictException(`Izvoz je prekinut: provjera cjelovitosti dokaza „${e.path}” nije uspjela (${reason}). Obavijesti administratora – datoteku treba vratiti iz sigurnosne kopije.`);
      }
    }

    const files: ManifestFile[] = [
      ...generated.map((g) => ({ path: g.path, size: g.data.length, sha256: sha256(g.data) })),
      ...evidence.map((e) => ({ path: e.path, size: e.size, sha256: e.sha256, note: 'dokaz (trenutna verzija, SHA-256 provjeren pri izvozu)' })),
    ].sort((a, b) => order(a.path) - order(b.path)); // stabilno: unutar skupine redoslijed troškova i dokaza u zahtjevu
    const manifest = Buffer.from(manifestCsv([
      ['zahtjev', claimId], ['projekt', `${data.project.acronym} – ${data.project.title}`], ['razdoblje', `RP${data.claim.period.number} (${data.claim.period.startDate} – ${data.claim.period.endDate})`],
      ['status', data.draft ? 'NACRT – zahtjev nije predan' : data.claim.status], ['izvezeno', now.toISOString()], ['izvezao', exporter],
      ['verzija_aplikacije', readVersion()], ['napomena', 'sadrzaj.csv nije naveden u vlastitom popisu (ne može sadržavati vlastiti SHA-256)'],
    ], files, omitted), 'utf8');

    await this.db.tx((tx) => this.audit.record(tx, { entity: 'claim', entityId: claimId, action: 'export', diff: { meta: {
      status: data.claim.status, draft: data.draft, files: files.length + 1, evidence: evidence.length, evidenceBytes: total, omittedConfidential: omitted.length, manifestSha256: sha256(manifest),
    } } }));

    const fileName = `ZNS_${asciiSlug(data.project.acronym, 40)}_RP${data.claim.period.number}${data.draft ? '_NACRT' : ''}_${tenantToday(now)}.zip`;
    const storage = this.storage; const log = this.log; const userId = ctx.userId;
    async function* chunks(): AsyncGenerator<Buffer> {
      const zip = new ZipWriter(now);
      for (const part of await zip.entry('sadrzaj.csv', manifest)) yield part;
      const byPath = new Map(generated.map((g) => [g.path, g.data]));
      for (const f of files) {
        let content = byPath.get(f.path);
        if (!content) {
          const e = evidence.find((x) => x.path === f.path)!;
          content = await storage.get(e.storageKey);
          // Datoteka se mogla promijeniti nakon provjere: prekid (nepotpun ZIP) umjesto paketa s pogrešnim sadržajem.
          if (sha256(content) !== e.sha256) { log.error(`Izvoz ZNS-a ${claimId} (korisnik ${userId}): dokaz ${e.path} promijenjen tijekom slanja`); throw new Error('Provjera cjelovitosti dokaza nije uspjela tijekom slanja'); }
        }
        for (const part of await zip.entry(f.path, content)) yield part;
        content = undefined;
      }
      yield zip.finish();
    }
    return { fileName, stream: Readable.from(chunks(), { objectMode: false }) };
  }

  /** Sve što paket treba, u jednoj transakciji (upiti jedan za drugim). */
  private async read(tx: Tx, projectId: string, claimId: string) {
    const ctx = this.ctx.require();
    const project = await loadProject(tx, projectId);
    const claim = await this.claims.get(tx, projectId, claimId);
    const pkg = await this.packages.get(tx, project.packageId, project.packageVersion);
    const partner = (await tx.select({ name: organisations.name, beneficiaryType: projectPartners.beneficiaryType }).from(projectPartners)
      .innerJoin(organisations, eq(organisations.id, projectPartners.organisationId)).where(eq(projectPartners.id, claim.partnerId)))[0]!;
    const opened = (await tx.select({ createdAt: reimbursementClaims.createdAt }).from(reimbursementClaims).where(eq(reimbursementClaims.id, claimId)))[0]!.createdAt;
    const canConfidential = canOnProject(ctx, 'documents:confidential', projectId);
    const canPersonnel = canOnProject(ctx, 'personnel:read', projectId);
    const exporterRow = ctx.userId ? (await tx.select({ name: users.displayName, email: users.email }).from(users).where(eq(users.id, ctx.userId)))[0] : undefined;
    const ids = claim.expenses.map((e) => e.id);
    const expRows = ids.length ? await tx.select({ id: expenses.id, wp: expenses.workPackageId, ts: expenses.timesheetId, amount: expenses.amountCents, recognised: expenses.recognisedCents, categoryCode: expenses.categoryCode })
      .from(expenses).where(inArray(expenses.id, ids)) : [];
    const wps = await tx.select({ id: workPackages.id, number: workPackages.number, title: workPackages.title }).from(workPackages).where(eq(workPackages.projectId, projectId)).orderBy(asc(workPackages.number));
    // Dokazi (trenutna verzija) uz troškove zahtjeva, stabilnim redoslijedom.
    const docs = ids.length ? await tx.select({ id: documents.id, entityId: documents.entityId, title: documents.title, confidentiality: documents.confidentiality, createdAt: documents.createdAt,
      fileName: documentVersions.fileName, size: documentVersions.sizeBytes, sha256: documentVersions.sha256, storageKey: documentVersions.storageKey })
      .from(documents).innerJoin(documentVersions, and(eq(documentVersions.documentId, documents.id), eq(documentVersions.version, documents.currentVersion)))
      .where(and(eq(documents.entityType, 'expense'), inArray(documents.entityId, ids), isNull(documents.deletedAt))).orderBy(asc(documents.createdAt), asc(documents.id)) : [];

    // Evidencije rada: članovi tima partnera s upisanim satima u mjesecima razdoblja + timesheetovi troškova osoblja u zahtjevu (i iz ranijih razdoblja).
    const months = monthsInPeriod(claim.period.startDate, claim.period.endDate);
    const inPeriod = await tx.select({ memberId: timesheets.teamMemberId, month: timesheets.month }).from(timesheets).innerJoin(teamMembers, eq(teamMembers.id, timesheets.teamMemberId))
      .where(and(eq(timesheets.projectId, projectId), eq(teamMembers.partnerId, claim.partnerId), inArray(timesheets.month, months),
        sql`exists (select 1 from timesheet_entries te where te.timesheet_id = "timesheets"."id" and te.minutes > 0)`));
    const tsIds = [...new Set(expRows.map((e) => e.ts).filter((x): x is string => !!x))];
    const fromExpenses = tsIds.length ? await tx.select({ id: timesheets.id, memberId: timesheets.teamMemberId, month: timesheets.month }).from(timesheets).where(inArray(timesheets.id, tsIds)) : [];
    const keyMap = new Map<string, { memberId: string; month: string }>();
    for (const k of [...inPeriod, ...fromExpenses]) keyMap.set(`${k.memberId}|${k.month}`, { memberId: k.memberId, month: k.month });
    const recs = await loadTimesheetRecords(tx, project, pkg.meta.programme, [...keyMap.values()]);
    recs.sort((a, b) => a.person.fullName.localeCompare(b.person.fullName, 'hr') || a.person.id.localeCompare(b.person.id) || a.month.localeCompare(b.month));
    const entries = tsIds.length ? await tx.select({ ts: timesheetEntries.timesheetId, wp: timesheetEntries.workPackageId, minutes: timesheetEntries.minutes }).from(timesheetEntries).where(inArray(timesheetEntries.timesheetId, tsIds)) : [];

    // Troškovi osoblja po osobi i mjesecu (timesheet), s podjelom po radnom paketu: minute iz unosa, iznos iz troška.
    const personnel: PersonnelRow[] = [];
    for (const t of fromExpenses) {
      const rec = recs.find((r) => r.person.id === t.memberId && r.month === t.month);
      const rows = expRows.filter((e) => e.ts === t.id);
      const byWp = new Map<string, { minutes: number; amount: number }>();
      for (const e of rows) {
        const minutes = entries.filter((x) => x.ts === t.id && (x.wp ?? null) === (e.wp ?? null)).reduce((a, x) => a + x.minutes, 0);
        const k = e.wp ?? ''; const prev = byWp.get(k) ?? { minutes: 0, amount: 0 };
        byWp.set(k, { minutes: prev.minutes + minutes, amount: prev.amount + e.amount });
      }
      personnel.push({
        person: rec?.person.fullName ?? '', role: rec?.person.role ?? null, month: t.month,
        minutes: [...byWp.values()].reduce((a, x) => a + x.minutes, 0), amount: rows.reduce((a, e) => a + e.amount, 0),
        recognised: rows.every((e) => e.recognised !== null) ? rows.reduce((a, e) => a + (e.recognised ?? 0), 0) : null, byWp,
      });
    }
    personnel.sort((a, b) => a.person.localeCompare(b.person, 'hr') || a.month.localeCompare(b.month));

    // Nazivi u paketu: stabilni (redoslijed troškova u zahtjevu), čitljivi, sigurni i jedinstveni.
    const names = new UniqueNames();
    const records = recs.map((record) => ({ record, path: names.take('evidencije-rada', `${asciiSlug(record.person.fullName, 50)}_${record.month}.html`) }));
    const expenseFolder = new Map<string, string>();
    const evidenceRefs = new Map<string, EvidenceRef[]>();
    const evidence: EvidencePlan[] = []; const omitted: ManifestOmitted[] = [];
    claim.expenses.forEach((e, i) => {
      const mine = docs.filter((d) => d.entityId === e.id);
      if (!mine.length) return;
      const folder = `dokazi/${String(i + 1).padStart(3, '0')}_${e.date}_${asciiSlug(e.description, 40)}`;
      expenseFolder.set(e.id, `${folder}/`);
      const refs: EvidenceRef[] = [];
      for (const d of mine) {
        if (d.confidentiality === 'confidential' && !canConfidential) {
          refs.push({ path: null, title: '', fileName: null, confidential: true, omitted: true });
          omitted.push({ note: `povjerljivi dokaz uz trošak br. ${i + 1} (${e.date}) – naziv i sadržaj izostavljeni: izvoznik nema dozvolu documents:confidential` });
          continue;
        }
        const path = names.take(folder, safeFileName(d.fileName));
        refs.push({ path, title: d.title, fileName: path.slice(folder.length + 1), confidential: d.confidentiality === 'confidential', omitted: false });
        evidence.push({ expenseId: e.id, path, storageKey: d.storageKey, sha256: d.sha256, size: d.size, documentId: d.id });
      }
      evidenceRefs.set(e.id, refs);
    });

    const isDecided = ['approved', 'partially_approved', 'rejected'].includes(claim.status);
    let recognised: PartnerBudgetResult | null = null;
    if (isDecided) recognised = claimTotals(pkg, project.actionType, partner.beneficiaryType, expRows.map((e) => ({ categoryCode: e.categoryCode, amount: e.amount, recognised: e.recognised }))).recognised;
    const flat = flattenCategories(pkg.costCategories);
    const data: ExportData = {
      draft: claim.status === 'draft', claim,
      project: { acronym: project.acronym, title: project.title, contractNo: project.contractNo, actionType: project.actionType, programme: pkg.meta.programme, packageId: project.packageId, packageVersion: project.packageVersion, funder: pkg.meta.funder ?? null },
      partnerName: partner.name,
      categories: flat.filter((c) => !(c.children && c.children.length)).map((c) => ({ code: c.code, name: c.name, kind: c.kind, ratePercent: c.calculation?.ratePercent })),
      personnelRule: pkg.personnelRule ? { method: pkg.personnelRule.method, divisor: pkg.personnelRule.divisor, hoursPerDay: pkg.personnelRule.hoursPerDay } : null,
      canPersonnel,
      workPackages: [...wps.map((w) => ({ id: w.id, code: `WP${w.number}`, title: w.title })), { id: '', code: 'bez RP', title: 'bez radnog paketa' }],
      expenseWp: new Map(expRows.map((e) => [e.id, e.wp])),
      expenseFolder, evidence: evidenceRefs, personnel, recognised, openedAt: opened,
      expenseTotal: expRows.reduce((a, e) => a + e.amount, 0), recognisedTotal: expRows.reduce((a, e) => a + (e.recognised ?? 0), 0),
    };
    return { data, evidence, omitted, records, exporter: exporterRow ? `${exporterRow.name} <${exporterRow.email}>` : 'sustav' };
  }
}

/** Redoslijed u manifestu i arhivi: radna knjiga, kontrolna lista, evidencije rada, dokazi. */
function order(path: string): number {
  if (path === 'troskovi.xlsx') return 0;
  if (path === 'kontrolna-lista.html') return 1;
  if (path.startsWith('evidencije-rada/')) return 2;
  return 3;
}
