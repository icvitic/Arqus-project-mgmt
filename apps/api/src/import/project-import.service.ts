import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import {
  budgetLineIssues, cellText, deliverableCodeIssues, expenseRuleIssues, flattenCategories, historicIssues, isEmptyCell, isPersonnelCategory, monthRangeIssue,
  MONTH_PREFIX, normalizeHeader, parseBool, parseDate, parseInteger, parseMoney, parseText, sheetDef, WP_PREFIX,
  type ImportCell, type ImportSheetKey, type ProgrammePackage,
} from '@arqus/domain';
import type { Tx } from '../db/db.service';
import {
  budgetLines, deliverables, documents, expenses, milestones, organisations, projectBudgets, projectImports, projectPartners, projects, reimbursementClaims,
  reportingPeriods, roleAssignments, tasks, teamMembers, timesheetEntries, timesheets, users, workPackages, type Project, type ProjectImportCreated, type ProjectImportRow,
} from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { ProgrammePackagesService } from '../programmes/programme-packages.service';
import { loadProject } from '../common/project-access';
import { canOnProject } from '../common/access';
import { currentContext, tenantToday } from '../common/tenant-context';
import { assertRevision, bump } from '../common/revision';
import { projectEnd } from '../finance/finance-common';
import { budgetLinesInput } from '../budget/budget.service';
import { memberInput } from '../finance/timesheets.service';
import { expenseInput } from '../finance/expenses.service';
import { deliverableInput, milestoneInput, wpInput } from '../implementation/implementation.service';
import { ensureTeamMemberAccess } from '../identity/project-grants';
import type { Permission } from '../identity/permissions';
import { importTemplate, type TemplateContext } from './import-template';
import { isBlankRow, readImportSource, type ImportSource, type SourceSheet } from './import-source';
import type { SheetRow } from './xlsx-reader';
import { buildXlsx } from '../export/xlsx-writer';

/**
 * WP1.17 – uvoz postojećeg projekta iz Excela. Tijek: predložak za projekt → pregled (ništa se ne sprema) → potvrda istih
 * bajtova (SHA-256 datoteke, revizija projekta i otisak plana) → primjena u jednoj transakciji → povijest i poništavanje.
 *
 * Svaki redak prolazi ista pravila kao ručni unos: Zod sheme ruta (`wpInput`, `deliverableInput`, `milestoneInput`,
 * `budgetLinesInput`, `memberInput`, `expenseInput`) i domenska pravila (`monthRangeIssue`, `deliverableCodeIssues`,
 * `budgetLineIssues`, `expenseRuleIssues`). Dozvole se provjeravaju po listu (list bez dozvole je greška, ne tiho preskakanje).
 */

export interface ImportIssue { sheet: string; row: number | null; column: string | null; value: string | null; message: string }
export interface ImportItem { row: number; action: 'create' | 'update' | 'unchanged'; text: string; historic?: boolean }
export type SheetStatus = 'ready' | 'empty' | 'skipped' | 'rejected' | 'absent';
export interface SheetPlan {
  key: ImportSheetKey; label: string; name: string | null; permission: string; status: SheetStatus; reason: string | null;
  rowsRead: number; rowsValid: number; created: number; updated: number; unchanged: number;
  errors: ImportIssue[]; warnings: ImportIssue[]; items: ImportItem[];
}

interface WpOp { row: number; number: number; title: string; startMonth: number; endMonth: number; leadPartnerId: string | null; objectives: string | null }
interface DelivOp { row: number; wp: { id: string } | { number: number }; number: number; title: string; type: string; dissemination: string; dueMonth: number; leadPartnerId: string | null }
interface MsOp { row: number; number: number; title: string; dueMonth: number; verification: string | null }
interface BudgetLineOp { partnerId: string; categoryCode: string; wp: { id: string } | { number: number } | null; amount: number; description: string | null }
interface TeamOp { row: number; key: string; fullName: string; role: string | null; partnerId: string; userId: string | null; annualCost: number | null }
interface ExpenseOp {
  row: number; partnerId: string; categoryCode: string; wp: { id: string } | { number: number } | null; date: string; description: string; supplier: string | null; amount: number;
  evidenceRef: string | null; historic: boolean; recognised: number | null; reason: string | null; externalClaim: string | null; person: { id: string } | { key: string } | null;
}
interface Ops { workPackages: WpOp[]; deliverables: DelivOp[]; milestones: MsOp[]; budget: { mode: 'create' | 'replace'; lines: BudgetLineOp[] } | null; team: TeamOp[]; expenses: ExpenseOp[] }

export interface ImportPlan {
  fileName: string; sha256: string; size: number; format: 'xlsx' | 'csv';
  projectId: string; projectRevision: number; fingerprint: string;
  sheets: SheetPlan[]; ignoredSheets: string[]; fileWarnings: string[];
  errors: number; warnings: number; canConfirm: boolean; needsAcknowledge: boolean;
  /** Dozvole koje primjena traži (i poništavanje). */
  permissions: Permission[];
  ops: Ops;
}

export const IMPORT_SHEET_TAB: Record<ImportSheetKey, string> = { workPackages: 'struktura', deliverables: 'struktura', milestones: 'struktura', budget: 'proracun', team: 'tim', expenses: 'troskovi' };
const HEADS = 'Nedostaje dozvola';
const eurText = (cents: number): string => `${(cents / 100).toLocaleString('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
const hrDate = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}.`;
const norm = (s: string | null | undefined) => normalizeHeader(s ?? '');
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const pl = (n: number, one: string, few: string, many: string): string => { const d = n % 10, h = n % 100; return d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many; };

/** Čitanje jednog retka lista: vrijednosti po ključu stupca uz greške s listom, retkom, stupcem i vrijednošću. */
class RowReader {
  readonly issues: ImportIssue[] = [];
  constructor(private readonly sheet: SourceSheet, readonly row: SheetRow, private readonly date1904: boolean) {}
  cell(key: string): ImportCell | undefined { const i = this.sheet.match?.columns.get(key); return i === undefined ? undefined : this.row.cells[i]; }
  column(key: string | null): string | null {
    if (!key) return null;
    return this.sheet.match?.headers.get(key) ?? this.sheet.def.columns.find((c) => c.key === key)?.label ?? key;
  }
  has(key: string): boolean { return !isEmptyCell(this.cell(key)); }
  err(key: string | null, message: string): void {
    this.issues.push({ sheet: this.sheet.name, row: this.row.n, column: this.column(key), value: key ? cellText(this.cell(key)) || null : null, message });
  }
  private get<T>(key: string, required: boolean, parse: (c: ImportCell) => { ok: true; value: T } | { ok: false; message: string }): T | null {
    const c = this.cell(key);
    if (isEmptyCell(c)) { if (required) this.err(key, 'obavezna vrijednost nedostaje'); return null; }
    const r = parse(c!);
    if (!r.ok) { this.err(key, r.message); return null; }
    return r.value;
  }
  text(key: string, required = false): string | null { const v = this.get(key, required, parseText); return v === '' ? null : v; }
  money(key: string, required = false): number | null { return this.get(key, required, parseMoney); }
  int(key: string, required = false, prefix?: RegExp): number | null { return this.get(key, required, (c) => parseInteger(c, prefix)); }
  date(key: string, required = false): string | null { return this.get(key, required, (c) => parseDate(c, this.date1904)); }
  bool(key: string): boolean { return this.get(key, false, parseBool) ?? false; }
  /** Greške Zod sheme rute (iste granice kao ručni unos) pripisane stupcu, s porukom na hrvatskom. */
  zod(result: { success: boolean; error?: { issues: ZodIssueLike[] } }, columnOf: Record<string, string | null>): boolean {
    if (result.success) return true;
    for (const i of result.error!.issues) this.err(columnOf[String(i.path[0] ?? '')] ?? null, zodMessage(i));
    return false;
  }
}

interface ZodIssueLike { path: PropertyKey[]; message: string; code?: string; origin?: string; minimum?: number | bigint; maximum?: number | bigint }
/** Poruka Zod provjere na hrvatskom (ista ograničenja kao ručni unos; tekst za korisnika uvoza). */
function zodMessage(i: ZodIssueLike): string {
  const n = Number(i.code === 'too_small' ? i.minimum : i.maximum);
  if (i.code === 'too_small' && i.origin === 'string') return `najmanje ${n} ${pl(n, 'znak', 'znaka', 'znakova')}`;
  if (i.code === 'too_big' && i.origin === 'string') return `najviše ${n} ${pl(n, 'znak', 'znaka', 'znakova')}`;
  if (i.code === 'too_small') return `najmanje ${n.toLocaleString('hr-HR')}`;
  if (i.code === 'too_big') return `najviše ${n.toLocaleString('hr-HR')}`;
  return `neispravna vrijednost (${i.message})`;
}

interface Ctx {
  tx: Tx; project: Project; pkg: ProgrammePackage; today: string;
  partners: { id: string; orderNo: number; name: string; shortName: string | null; isSelf: boolean; role: string }[];
  wps: { id: string; number: number; title: string; startMonth: number; endMonth: number; leadPartnerId: string | null }[];
  delivCount: Map<string, number>;
  milestones: { number: number; title: string; dueMonth: number }[];
  budget: { id: string; status: string; revision: number; version: number } | null;
  budgetLines: { partnerId: string; categoryCode: string; workPackageId: string | null; amountCents: number; description: string | null }[];
  team: { id: string; fullName: string; partnerId: string; userId: string | null; role: string | null; annualCostCents: number | null }[];
  expenses: { id: string; partnerId: string; date: string; amountCents: number; categoryCode: string; description: string; teamMemberId: string | null; source: string }[];
  periods: { id: string; number: number; startDate: string; endDate: string }[];
  claimedPeriods: { partnerId: string; periodId: string }[];
  timesheetMonths: { teamMemberId: string; month: string; status: string }[];
  can: (p: Permission) => boolean;
  /** E-adrese korisnika institucije navedene u datoteci (mala slova → id). */
  userIds: Map<string, string>;
  /** Ostvareno prije uvoza po trošku (priznato nakon odluke, inače traženo) – za usporedbu s proračunom. */
  actualBefore: { categoryCode: string; amount: number }[];
}

@Injectable()
export class ProjectImportService {
  constructor(private readonly audit: AuditService, private readonly packages: ProgrammePackagesService) {}

  private can(projectId: string, p: Permission): boolean { const c = currentContext(); return !c?.userId || canOnProject(c, p, projectId); }

  /** Uvoz traži barem jednu dozvolu pisanja na projektu (struktura ili financije) – samo čitatelj dobiva 403. */
  assertMayImport(projectId: string): void {
    if (!this.can(projectId, 'projects:write') && !this.can(projectId, 'finance:write')) throw new ForbiddenException('Uvoz traži dozvolu projects:write ili finance:write na ovom projektu');
  }

  private async context(tx: Tx, projectId: string): Promise<Ctx> {
    const project = await loadProject(tx, projectId);
    const pkg = await this.packages.get(tx, project.packageId, project.packageVersion);
    // Upiti jedan za drugim na istoj transakciji (WP1.14b).
    const partners = await tx.select({ id: projectPartners.id, orderNo: projectPartners.orderNo, role: projectPartners.role, name: organisations.name, shortName: organisations.shortName, isSelf: organisations.isSelf })
      .from(projectPartners).innerJoin(organisations, eq(organisations.id, projectPartners.organisationId)).where(eq(projectPartners.projectId, projectId)).orderBy(asc(projectPartners.orderNo));
    const wps = await tx.select({ id: workPackages.id, number: workPackages.number, title: workPackages.title, startMonth: workPackages.startMonth, endMonth: workPackages.endMonth, leadPartnerId: workPackages.leadPartnerId })
      .from(workPackages).where(and(eq(workPackages.projectId, projectId), isNull(workPackages.deletedAt))).orderBy(asc(workPackages.number));
    const dl = await tx.select({ wp: deliverables.workPackageId, n: sql<number>`max(${deliverables.number})::int` }).from(deliverables).where(eq(deliverables.projectId, projectId)).groupBy(deliverables.workPackageId);
    const ms = await tx.select({ number: milestones.number, title: milestones.title, dueMonth: milestones.dueMonth }).from(milestones).where(eq(milestones.projectId, projectId)).orderBy(asc(milestones.number));
    const budget = (await tx.select({ id: projectBudgets.id, status: projectBudgets.status, revision: projectBudgets.revision, version: projectBudgets.version }).from(projectBudgets)
      .where(eq(projectBudgets.projectId, projectId)).orderBy(desc(projectBudgets.version)).limit(1))[0] ?? null;
    const lines = budget ? await tx.select({ partnerId: budgetLines.partnerId, categoryCode: budgetLines.categoryCode, workPackageId: budgetLines.workPackageId, amountCents: budgetLines.amountCents, description: budgetLines.description })
      .from(budgetLines).where(eq(budgetLines.budgetId, budget.id)).orderBy(asc(budgetLines.createdAt), asc(budgetLines.id)) : [];
    const team = await tx.select({ id: teamMembers.id, fullName: teamMembers.fullName, partnerId: teamMembers.partnerId, userId: teamMembers.userId, role: teamMembers.role, annualCostCents: teamMembers.annualCostCents })
      .from(teamMembers).where(eq(teamMembers.projectId, projectId)).orderBy(asc(teamMembers.fullName));
    const ex = await tx.select({ id: expenses.id, partnerId: expenses.partnerId, date: expenses.date, amountCents: expenses.amountCents, categoryCode: expenses.categoryCode, description: expenses.description, teamMemberId: expenses.teamMemberId, source: expenses.source })
      .from(expenses).where(eq(expenses.projectId, projectId));
    const periods = await tx.select({ id: reportingPeriods.id, number: reportingPeriods.number, startDate: reportingPeriods.startDate, endDate: reportingPeriods.endDate }).from(reportingPeriods).where(eq(reportingPeriods.projectId, projectId)).orderBy(asc(reportingPeriods.number));
    const claimed = await tx.select({ partnerId: reimbursementClaims.partnerId, periodId: reimbursementClaims.reportingPeriodId }).from(reimbursementClaims)
      .where(and(eq(reimbursementClaims.projectId, projectId), sql`${reimbursementClaims.status} <> 'draft'`));
    const tsm = await tx.select({ teamMemberId: timesheets.teamMemberId, month: timesheets.month, status: timesheets.status }).from(timesheets)
      .where(and(eq(timesheets.projectId, projectId), inArray(timesheets.status, ['submitted', 'approved', 'locked'])));
    return {
      tx, project, pkg, today: tenantToday(), partners, wps, delivCount: new Map(dl.map((d) => [d.wp, d.n])), milestones: ms, budget, budgetLines: lines, team, expenses: ex,
      periods, claimedPeriods: claimed, timesheetMonths: tsm, can: (p) => this.can(projectId, p), userIds: new Map(), actualBefore: [],
    };
  }

  /* ---------- predložak ---------- */

  async template(tx: Tx, projectId: string): Promise<{ fileName: string; data: Buffer }> {
    const c = await this.context(tx, projectId);
    const personnel = c.can('personnel:read');
    const flat = flattenCategories(c.pkg.costCategories).filter((x) => x.kind !== 'indirect' && !(x.children && x.children.length));
    const ctx: TemplateContext = {
      project: { acronym: c.project.acronym, title: c.project.title, startDate: c.project.startDate, durationMonths: c.project.durationMonths, status: c.project.status, packageLabel: `${c.pkg.meta.programme} v${c.project.packageVersion}` },
      partners: c.partners.map((p) => ({ name: p.name, shortName: p.shortName, role: p.role, orderNo: p.orderNo, isSelf: p.isSelf })),
      categories: flat.map((x) => ({ code: x.code, name: x.name, personnel: isPersonnelCategory(c.pkg, x.code), timeRecording: !!c.pkg.personnelRule?.timeRecordingRequired })),
      workPackages: c.wps.map((w) => ({ number: w.number, title: w.title, startMonth: w.startMonth, endMonth: w.endMonth })),
      deliverableTypes: (c.pkg.deliverableTypes ?? []).map((d) => ({ code: d.code, name: d.name })),
      disseminationLevels: (c.pkg.disseminationLevels ?? []).map((d) => ({ code: d.code, name: d.name })),
      team: personnel ? c.team.map((t) => ({ fullName: t.fullName, partner: this.partnerName(c, t.partnerId) })) : null,
      personnel,
      allowed: (['workPackages', 'deliverables', 'milestones', 'budget', 'team', 'expenses'] as ImportSheetKey[]).filter((k) => c.can(sheetDef(k).permission)),
    };
    const data = await buildXlsx(importTemplate(ctx));
    return { fileName: `Uvoz_${c.project.acronym.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40)}_predlozak.xlsx`, data };
  }

  private partnerName(c: Ctx, id: string): string { const p = c.partners.find((x) => x.id === id); return p ? (p.shortName || p.name) : ''; }

  /* ---------- pregled (plan) ---------- */

  private plan(c: Ctx, source: ImportSource, file: { fileName: string; sha256: string; size: number }, skip: ImportSheetKey[]): ImportPlan {
    const ops: Ops = { workPackages: [], deliverables: [], milestones: [], budget: null, team: [], expenses: [] };
    const sheets: SheetPlan[] = [];
    const byKey = new Map(source.sheets.map((s) => [s.def.key, s]));
    const perms = new Set<Permission>();
    // Radni paketi i članovi tima koje stvara ovaj uvoz (na njih se pozivaju isporuke, proračun i troškovi).
    const newWps = new Map<number, string>(); const newTeam: TeamOp[] = [];

    for (const def of [sheetDef('workPackages'), sheetDef('deliverables'), sheetDef('milestones'), sheetDef('budget'), sheetDef('team'), sheetDef('expenses')]) {
      const s = byKey.get(def.key);
      const plan: SheetPlan = { key: def.key, label: def.label, name: s?.name ?? null, permission: def.permission, status: 'absent', reason: null, rowsRead: 0, rowsValid: 0, created: 0, updated: 0, unchanged: 0, errors: [], warnings: [], items: [] };
      sheets.push(plan);
      if (!s) continue;
      const rows = s.rows.filter((r) => !isBlankRow(s, r));
      plan.rowsRead = rows.length;
      if (!rows.length) { plan.status = 'empty'; plan.reason = 'list nema podataka – preskače se'; continue; }
      if (skip.includes(def.key)) { plan.status = 'skipped'; plan.reason = 'izostavljen na tvoj zahtjev – ništa s ovog lista neće se uvesti'; continue; }
      const sheetError = (message: string) => { plan.status = 'rejected'; plan.reason = message; plan.errors.push({ sheet: s.name, row: null, column: null, value: null, message }); };
      if (!c.can(def.permission)) { sheetError(`${HEADS} ${def.permission} na ovom projektu – list „${s.name}” ne možeš uvesti. Izostavi list ili zamoli ured za projekte da ga uveze.`); continue; }
      if (!s.match) { sheetError(`Na listu „${s.name}” nije pronađen redak s nazivima stupaca (u prvih 15 redaka). Prvi redak mora sadržavati nazive iz predloška, npr. ${def.columns.filter((x) => x.required).map((x) => `„${x.label}”`).join(', ')}.`); continue; }
      if (s.match.missing.length) { sheetError(`Na listu „${s.name}” nedostaje ${pl(s.match.missing.length, 'obavezni stupac', 'obavezna stupca', 'obaveznih stupaca')}: ${s.match.missing.map((x) => `„${x.label}”`).join(', ')} (redak zaglavlja ${s.headerRow}).`); continue; }
      if (s.match.duplicates.length) { sheetError(`Na listu „${s.name}” se stupac ponavlja: ${s.match.duplicates.map((x) => `„${x}”`).join(', ')} – ostavi samo jedan.`); continue; }
      plan.status = 'ready';
      perms.add(def.permission);
      const readers = rows.map((r) => new RowReader(s, r, source.date1904));
      switch (def.key) {
        case 'workPackages': this.planWorkPackages(c, readers, plan, ops, newWps); break;
        case 'deliverables': this.planDeliverables(c, readers, plan, ops, newWps); break;
        case 'milestones': this.planMilestones(c, readers, plan, ops); break;
        case 'budget': this.planBudget(c, readers, plan, ops, newWps); break;
        case 'team': this.planTeam(c, readers, plan, ops, newTeam, perms); break;
        case 'expenses': this.planExpenses(c, readers, plan, ops, newWps, newTeam, perms); break;
      }
      for (const r of readers) plan.errors.push(...r.issues);
      plan.rowsValid = readers.filter((r) => !r.issues.length).length;
      if (plan.errors.length) plan.status = 'rejected';
    }
    for (const e of source.errors) sheets.find((x) => x.name === e.sheet)?.errors.push({ sheet: e.sheet, row: null, column: null, value: null, message: e.message });
    const fileErrors = source.errors.filter((e) => !sheets.some((x) => x.name === e.sheet));
    const errors = sheets.reduce((a, x) => a + x.errors.length, 0) + fileErrors.length;
    const warnings = sheets.reduce((a, x) => a + x.warnings.length, 0);
    const anything = sheets.some((x) => x.status === 'ready' && x.created + x.updated > 0);
    const fileWarnings = [...source.warnings, ...fileErrors.map((e) => e.message)];
    const fingerprint = sha256(JSON.stringify({ file: file.sha256, skip: [...skip].sort(), ops, warnings: sheets.map((x) => x.warnings.map((w) => `${w.row}:${w.message}`)) }));
    return {
      ...file, format: source.format, projectId: c.project.id, projectRevision: c.project.revision, fingerprint, sheets, ignoredSheets: source.ignoredSheets, fileWarnings,
      errors, warnings, canConfirm: errors === 0 && anything, needsAcknowledge: warnings > 0, permissions: [...perms].sort(), ops,
    };
  }

  /** Partner iz teksta: naziv ili kratica organizacije, ili redni broj partnera; prazno = vlastita institucija (ili nitko). */
  private partner(c: Ctx, r: RowReader, key: string, fallbackSelf: boolean): string | null | undefined {
    const t = r.text(key);
    if (!t) return fallbackSelf ? c.partners.find((p) => p.isSelf)?.id ?? null : null;
    const n = norm(t);
    const hits = c.partners.filter((p) => norm(p.name) === n || norm(p.shortName) === n || String(p.orderNo) === n || `p${p.orderNo}` === n);
    if (hits.length === 1) return hits[0]!.id;
    r.err(key, hits.length ? 'naziv odgovara više partnera – upiši puni naziv' : `partner nije na projektu (partneri: ${c.partners.map((p) => p.shortName || p.name).join(', ')})`);
    return undefined;
  }

  /** Kategorija troška: šifra („VU”), šifra s nazivom („VU – Vanjske usluge”) ili naziv. */
  private category(c: Ctx, r: RowReader, key: string): string | null {
    const t = r.text(key, true);
    if (!t) return null;
    const flat = flattenCategories(c.pkg.costCategories);
    const code = t.split(/\s+[–—-]\s+|\s+/)[0]!;
    const hit = flat.find((x) => x.code.toLowerCase() === t.toLowerCase()) ?? flat.find((x) => x.code.toLowerCase() === code.toLowerCase()) ?? flat.find((x) => norm(x.name) === norm(t));
    if (!hit) { r.err(key, `kategorija ne postoji u paketu programa (šifre: ${flat.filter((x) => x.kind !== 'indirect' && !(x.children && x.children.length)).map((x) => x.code).join(', ')})`); return null; }
    return hit.code;
  }

  /** Radni paket: broj (1, WP1) ili naziv – postojeći ili s lista „Radni paketi” ovog uvoza. */
  private workPackage(c: Ctx, r: RowReader, key: string, required: boolean, newWps: Map<number, string>): { id: string } | { number: number } | null | undefined {
    const cell = r.cell(key);
    if (isEmptyCell(cell)) { if (required) r.err(key, 'obavezna vrijednost nedostaje'); return null; }
    const asNumber = parseInteger(cell!, WP_PREFIX);
    if (asNumber.ok) {
      const ex = c.wps.find((w) => w.number === asNumber.value);
      if (ex) return { id: ex.id };
      if (newWps.has(asNumber.value)) return { number: asNumber.value };
    } else {
      const n = norm(cellText(cell));
      const ex = c.wps.filter((w) => norm(w.title) === n);
      if (ex.length === 1) return { id: ex[0]!.id };
      const nw = [...newWps].filter(([, title]) => norm(title) === n);
      if (nw.length === 1) return { number: nw[0]![0] };
    }
    const known = [...c.wps.map((w) => w.number), ...newWps.keys()].sort((a, b) => a - b);
    r.err(key, `radni paket ne postoji na projektu ni na listu „Radni paketi”${known.length ? ` (postoje: ${known.map((n) => `WP${n}`).join(', ')})` : ''}`);
    return undefined;
  }

  private wpLabel(c: Ctx, wp: { id: string } | { number: number } | null): string {
    if (!wp) return '';
    return 'id' in wp ? `WP${c.wps.find((w) => w.id === wp.id)?.number ?? '?'}` : `WP${wp.number}`;
  }

  private planWorkPackages(c: Ctx, readers: RowReader[], plan: SheetPlan, ops: Ops, newWps: Map<number, string>) {
    let next = Math.max(0, ...c.wps.map((w) => w.number), ...readers.map((r) => { const v = parseInteger(r.cell('number') ?? { t: 's', v: '' }, WP_PREFIX); return v.ok ? v.value : 0; })) + 1;
    const seen = new Set<number>();
    for (const r of readers) {
      const number = r.has('number') ? r.int('number', false, WP_PREFIX) : null;
      const title = r.text('title', true); const start = r.int('startMonth', true, MONTH_PREFIX); const end = r.int('endMonth', true, MONTH_PREFIX);
      const lead = this.partner(c, r, 'lead', false); const objectives = r.text('objectives');
      if (r.issues.length) continue;
      const n = number ?? next++;
      const input = { number: n, title: title!, startMonth: start!, endMonth: end!, ...(lead ? { leadPartnerId: lead } : {}), ...(objectives ? { objectives } : {}) };
      if (!r.zod(wpInput.safeParse(input), { number: 'number', title: 'title', startMonth: 'startMonth', endMonth: 'endMonth', objectives: 'objectives' })) continue;
      const months = monthRangeIssue(c.project.durationMonths, start!, end!, `WP${n}`);
      if (months) { r.err('endMonth', months); continue; }
      if (seen.has(n)) { r.err('number', `radni paket WP${n} se ponavlja u datoteci`); continue; }
      seen.add(n);
      const existing = c.wps.find((w) => w.number === n);
      if (existing) {
        const same = norm(existing.title) === norm(title) && existing.startMonth === start && existing.endMonth === end && (!lead || existing.leadPartnerId === lead);
        if (!same) { r.err('number', `WP${n} već postoji na projektu s drugim podacima („${existing.title}”, M${existing.startMonth}–M${existing.endMonth}) – izmijeni ga na kartici „Struktura rada” ili upiši drugi broj`); continue; }
        plan.unchanged++; plan.items.push({ row: r.row.n, action: 'unchanged', text: `WP${n} ${existing.title} – već postoji, preskače se` });
        continue;
      }
      newWps.set(n, title!);
      ops.workPackages.push({ row: r.row.n, number: n, title: title!, startMonth: start!, endMonth: end!, leadPartnerId: lead ?? null, objectives });
      plan.created++; plan.items.push({ row: r.row.n, action: 'create', text: `WP${n} ${title} (M${start}–M${end})` });
    }
  }

  private planDeliverables(c: Ctx, readers: RowReader[], plan: SheetPlan, ops: Ops, newWps: Map<number, string>) {
    const counters = new Map<string, number>();
    for (const r of readers) {
      const wp = this.workPackage(c, r, 'workPackage', true, newWps);
      const title = r.text('title', true); const type = r.text('type', true); const dissemination = r.text('dissemination', true); const due = r.int('dueMonth', true, MONTH_PREFIX);
      const lead = this.partner(c, r, 'lead', false);
      if (r.issues.length || !wp) continue;
      const input = { title: title!, type: type!, dissemination: dissemination!, dueMonth: due!, ...(lead ? { leadPartnerId: lead } : {}) };
      if (!r.zod(deliverableInput.safeParse(input), { title: 'title', type: 'type', dissemination: 'dissemination', dueMonth: 'dueMonth' })) continue;
      const months = monthRangeIssue(c.project.durationMonths, due!, due!, 'Isporuka'); if (months) { r.err('dueMonth', months); continue; }
      const codes = deliverableCodeIssues(c.pkg, type!, dissemination!);
      if (codes.length) { for (const m of codes) r.err(m.startsWith('Vrsta') ? 'type' : 'dissemination', m); continue; }
      const key = 'id' in wp ? wp.id : `n${wp.number}`;
      const number = (counters.get(key) ?? ('id' in wp ? c.delivCount.get(wp.id) ?? 0 : 0)) + 1; counters.set(key, number);
      const wpNo = 'id' in wp ? c.wps.find((w) => w.id === wp.id)!.number : wp.number;
      ops.deliverables.push({ row: r.row.n, wp, number, title: title!, type: type!, dissemination: dissemination!, dueMonth: due!, leadPartnerId: lead ?? null });
      plan.created++; plan.items.push({ row: r.row.n, action: 'create', text: `D${wpNo}.${number} ${title} (M${due}, ${type}/${dissemination})` });
    }
  }

  private planMilestones(c: Ctx, readers: RowReader[], plan: SheetPlan, ops: Ops) {
    let next = Math.max(0, ...c.milestones.map((m) => m.number)) + 1;
    for (const r of readers) {
      const title = r.text('title', true); const due = r.int('dueMonth', true, MONTH_PREFIX); const verification = r.text('verification');
      if (r.issues.length) continue;
      if (!r.zod(milestoneInput.safeParse({ title, dueMonth: due, ...(verification ? { verification } : {}) }), { title: 'title', dueMonth: 'dueMonth', verification: 'verification' })) continue;
      const months = monthRangeIssue(c.project.durationMonths, due!, due!, 'Prekretnica'); if (months) { r.err('dueMonth', months); continue; }
      const existing = c.milestones.find((m) => norm(m.title) === norm(title) && m.dueMonth === due);
      if (existing) { plan.unchanged++; plan.items.push({ row: r.row.n, action: 'unchanged', text: `MS${existing.number} ${existing.title} – već postoji, preskače se` }); continue; }
      const number = next++;
      ops.milestones.push({ row: r.row.n, number, title: title!, dueMonth: due!, verification });
      plan.created++; plan.items.push({ row: r.row.n, action: 'create', text: `MS${number} ${title} (M${due})` });
    }
  }

  private planBudget(c: Ctx, readers: RowReader[], plan: SheetPlan, ops: Ops, newWps: Map<number, string>) {
    const lines: (BudgetLineOp & { row: number })[] = [];
    for (const r of readers) {
      // Predložak smije imati unaprijed upisane parove partner × kategorija: redak bez iznosa se preskače.
      if (!r.has('amount')) continue;
      const partnerId = this.partner(c, r, 'partner', true); const code = this.category(c, r, 'category');
      const wp = this.workPackage(c, r, 'workPackage', false, newWps); const amount = r.money('amount', true); const description = r.text('description');
      if (r.issues.length || !partnerId || !code || wp === undefined) continue;
      const shape = budgetLinesInput.shape.lines.element.safeParse({ partnerId, categoryCode: code, amount, ...(wp && 'id' in wp ? { workPackageId: wp.id } : {}), ...(description ? { description } : {}) });
      if (!r.zod(shape, { partnerId: 'partner', categoryCode: 'category', amount: 'amount', description: 'description', workPackageId: 'workPackage' })) continue;
      const issues = budgetLineIssues(c.pkg, [{ partnerId, categoryCode: code, amount: amount! }], new Set(c.partners.map((p) => p.id)));
      if (issues.length) { for (const i of issues) r.err('category', i.replace(/^redak 1: /, '')); continue; }
      lines.push({ row: r.row.n, partnerId, categoryCode: code, wp, amount: amount!, description });
    }
    if (lines.length > 2000) { plan.errors.push({ sheet: plan.name!, row: null, column: null, value: null, message: 'proračun smije imati najviše 2000 redaka' }); return; }
    if (readers.some((r) => r.issues.length)) return;
    const key = (l: { partnerId: string; categoryCode: string; wp: string | null; amount: number }) => `${l.partnerId}|${l.categoryCode}|${l.wp ?? ''}|${l.amount}`;
    const incoming = lines.map((l) => key({ ...l, wp: l.wp ? ('id' in l.wp ? l.wp.id : `n${l.wp.number}`) : null })).sort();
    const current = c.budgetLines.map((l) => key({ partnerId: l.partnerId, categoryCode: l.categoryCode, wp: l.workPackageId, amount: l.amountCents })).sort();
    const same = incoming.length === current.length && incoming.every((k, i) => k === current[i]);
    const total = lines.reduce((a, l) => a + l.amount, 0); const oldTotal = c.budgetLines.reduce((a, l) => a + l.amountCents, 0);
    const describe = (l: BudgetLineOp) => `${this.partnerName(c, l.partnerId)} · ${l.categoryCode}${l.wp ? ` · ${this.wpLabel(c, l.wp)}` : ''} · ${eurText(l.amount)}`;
    if (c.budget?.status === 'locked') {
      if (same) { plan.unchanged += lines.length; plan.items.push({ row: lines[0]?.row ?? 0, action: 'unchanged', text: `Proračun v${c.budget.version} je zaključan i jednak datoteci (${eurText(total)}) – preskače se` }); return; }
      plan.status = 'rejected';
      plan.reason = `Proračun v${c.budget.version} je zaključan (aktivacijom projekta) – mijenja se samo amandmanom, ne uvozom.`;
      plan.errors.push({ sheet: plan.name!, row: null, column: null, value: null, message: `${plan.reason} Izostavi list „${plan.name}” ili ga isprazni.` });
      return;
    }
    if (same && c.budget) { plan.unchanged += lines.length; plan.items.push({ row: lines[0]?.row ?? 0, action: 'unchanged', text: `Nacrt proračuna već je jednak datoteci (${eurText(total)}) – preskače se` }); return; }
    if (!lines.length) return;
    const mode = c.budget ? 'replace' : 'create';
    ops.budget = { mode, lines: lines.map(({ row: _r, ...l }) => l) };
    if (mode === 'replace') {
      plan.updated += lines.length;
      if (c.budgetLines.length) plan.warnings.push({ sheet: plan.name!, row: null, column: null, value: null, message: `Uvoz zamjenjuje postojeći nacrt proračuna (${c.budgetLines.length} ${pl(c.budgetLines.length, 'redak', 'retka', 'redaka')}, ${eurText(oldTotal)}) novim (${lines.length} ${pl(lines.length, 'redak', 'retka', 'redaka')}, ${eurText(total)}).` });
    } else plan.created += lines.length;
    for (const l of lines) plan.items.push({ row: l.row, action: mode === 'replace' ? 'update' : 'create', text: describe(l) });
  }

  private planTeam(c: Ctx, readers: RowReader[], plan: SheetPlan, ops: Ops, newTeam: TeamOp[], perms: Set<Permission>) {
    const canCost = c.can('personnel:read');
    const emails = new Set<string>(); const names = new Set<string>();
    for (const r of readers) {
      const fullName = r.text('fullName', true); const role = r.text('role'); const partnerId = this.partner(c, r, 'partner', true); const email = r.text('email');
      let annualCost: number | null = null;
      if (r.has('annualCost')) {
        if (!canCost) r.err('annualCost', `${HEADS} personnel:read – godišnji trošak (plaću) uvozi samo uloga s pristupom podacima o osoblju; ostavi stupac prazan ili zamoli financije`);
        else { annualCost = r.money('annualCost'); perms.add('personnel:read'); }
      }
      if (r.issues.length || !partnerId) continue;
      const input = { fullName: fullName!, partnerId, ...(role ? { role } : {}), ...(annualCost !== null ? { annualCost } : {}) };
      if (!r.zod(memberInput.safeParse(input), { fullName: 'fullName', role: 'role', annualCost: 'annualCost', partnerId: 'partner' })) continue;
      const key = `${norm(fullName)}|${partnerId}`;
      if (names.has(key)) { r.err('fullName', 'osoba se ponavlja u datoteci (isto ime kod istog partnera)'); continue; }
      names.add(key);
      let userId: string | null = null;
      if (email) {
        const e = email.toLowerCase();
        if (emails.has(e)) { r.err('email', 'ista e-adresa je već navedena u datoteci'); continue; }
        emails.add(e);
        userId = c.userIds.get(e) ?? null;
        if (!userId) { r.err('email', 'korisnik s tom e-adresom ne postoji u instituciji (ostavi prazno ili ga najprije dodaj u izborniku Korisnici)'); continue; }
      }
      const existing = c.team.find((t) => norm(t.fullName) === norm(fullName) && t.partnerId === partnerId);
      if (existing) {
        const differs = (role && role !== existing.role) || (userId && userId !== existing.userId) || (annualCost !== null && annualCost !== existing.annualCostCents);
        if (differs) plan.warnings.push({ sheet: plan.name!, row: r.row.n, column: r.column('fullName'), value: fullName, message: 'član tima već postoji – uvoz ga ne mijenja (izmjene na kartici „Tim i timesheetovi”)' });
        plan.unchanged++; plan.items.push({ row: r.row.n, action: 'unchanged', text: `${existing.fullName} – već u timu, preskače se` });
        continue;
      }
      if (userId) {
        const taken = c.team.find((t) => t.userId === userId);
        if (taken) { r.err('email', `korisnik je već član tima projekta (${taken.fullName})`); continue; }
      }
      const op: TeamOp = { row: r.row.n, key, fullName: fullName!, role, partnerId, userId, annualCost };
      ops.team.push(op); newTeam.push(op);
      plan.created++; plan.items.push({ row: r.row.n, action: 'create', text: `${fullName}${role ? ` (${role})` : ''} – ${this.partnerName(c, partnerId)}${userId ? ` · ${email}` : ''}${annualCost !== null ? ' · godišnji trošak upisan' : ''}` });
    }
  }

  private planExpenses(c: Ctx, readers: RowReader[], plan: SheetPlan, ops: Ops, newWps: Map<number, string>, newTeam: TeamOp[], perms: Set<Permission>) {
    if (!['active', 'suspended', 'closing'].includes(c.project.status)) {
      plan.status = 'rejected';
      plan.reason = `Troškovi se uvoze dok je projekt aktivan (sada: ${c.project.status === 'contracting' ? 'u ugovaranju' : c.project.status}).`;
      plan.errors.push({ sheet: plan.name!, row: null, column: null, value: null, message: `${plan.reason} Uvezi najprije strukturu, proračun i tim, aktiviraj projekt na kartici „Pregled” pa ponovno uvezi datoteku – već uvezeni retci prepoznat će se i preskočiti. Ili izostavi list „${plan.name}”.` });
      return;
    }
    const canPersonnel = c.can('personnel:read');
    const ruleCtx = { partnerIds: new Set(c.partners.map((p) => p.id)), workPackageIds: new Set(c.wps.map((w) => w.id)), projectStart: c.project.startDate, projectEnd: projectEnd(c.project) };
    const fileKeys = new Map<string, number>(); const personMonths = new Map<string, number>();
    const periodOf = (date: string) => c.periods.find((p) => date >= p.startDate && date <= p.endDate) ?? null;
    for (const r of readers) {
      const date = r.date('date', true); const partnerId = this.partner(c, r, 'partner', true); const code = this.category(c, r, 'category');
      const wp = this.workPackage(c, r, 'workPackage', false, newWps); const amount = r.money('amount', true);
      let description = r.text('description'); const supplier = r.text('supplier'); const evidenceRef = r.text('evidenceRef');
      const historic = r.bool('historic'); const externalClaim = r.text('externalClaim'); const recognised = r.money('recognised'); const reason = r.text('reason');
      if (r.issues.length || !partnerId || !code || wp === undefined) continue;
      const personnel = isPersonnelCategory(c.pkg, code);
      if (!historic) for (const k of ['externalClaim', 'recognised', 'reason'] as const) if (r.has(k)) r.err(k, 'popunjava se samo za trošak potraživan izvan sustava (stupac „Potraživano izvan sustava” = DA)');
      let person: ExpenseOp['person'] = null;
      if (personnel && historic) {
        if (!canPersonnel) { r.err('category', `${HEADS} personnel:read – troškove osoblja iz ranijih razdoblja uvozi samo uloga s pristupom podacima o osoblju (financije, ured za projekte)`); continue; }
        perms.add('personnel:read');
        const name = r.text('person');
        if (!name) { r.err('person', 'za trošak osoblja upiši osobu (člana tima s lista „Tim” ili postojećeg)'); continue; }
        const ex = c.team.filter((t) => norm(t.fullName) === norm(name) && t.partnerId === partnerId);
        const nw = newTeam.filter((t) => norm(t.fullName) === norm(name) && t.partnerId === partnerId);
        if (ex.length + nw.length !== 1) { r.err('person', ex.length + nw.length ? 'ime odgovara više članova tima' : `osoba nije u timu partnera ${this.partnerName(c, partnerId)} (dodaj je na list „Tim”)`); continue; }
        person = ex.length ? { id: ex[0]!.id } : { key: nw[0]!.key };
        description ??= `Trošak osoblja: ${name}, ${date!.slice(5, 7)}/${date!.slice(0, 4)} (potraživano prije ArQusa)`;
        const month = date!.slice(0, 7);
        const pk = `${'id' in person ? person.id : person.key}|${month}`;
        if (personMonths.has(pk)) { r.err('person', `trošak osoblja za ${name} u ${month.slice(5)}/${month.slice(0, 4)} već je u retku ${personMonths.get(pk)}`); continue; }
        personMonths.set(pk, r.row.n);
        if ('id' in person) {
          const pid = person.id;
          if (c.timesheetMonths.some((t) => t.teamMemberId === pid && t.month === month)) { r.err('date', `za ${name} u ${month.slice(5)}/${month.slice(0, 4)} već postoji predan ili odobren timesheet – trošak osoblja tog mjeseca nastaje iz timesheeta, ne uvozi se dvaput`); continue; }
          if (c.expenses.some((e) => e.teamMemberId === pid && e.source === 'historic_personnel' && e.date.slice(0, 7) === month)) { r.err('date', `za ${name} u ${month.slice(5)}/${month.slice(0, 4)} trošak osoblja iz ranijeg razdoblja već je uvezen`); continue; }
        }
      } else if (r.has('person') && !personnel) {
        plan.warnings.push({ sheet: plan.name!, row: r.row.n, column: r.column('person'), value: cellText(r.cell('person')), message: 'osoba se upisuje samo za trošak osoblja – vrijednost se zanemaruje' });
      }
      if (r.issues.length) continue;
      const shape = expenseInput.safeParse({ partnerId, categoryCode: code, date, description: description ?? '', amount, ...(wp && 'id' in wp ? { workPackageId: wp.id } : {}), ...(supplier ? { supplier } : {}), ...(evidenceRef ? { evidenceRef } : {}) });
      if (!r.zod(shape, { partnerId: 'partner', categoryCode: 'category', date: 'date', description: 'description', amount: 'amount', supplier: 'supplier', evidenceRef: 'evidenceRef', workPackageId: 'workPackage' })) continue;
      const rules = expenseRuleIssues(c.pkg, ruleCtx, { partnerId, categoryCode: code, date: date!, amount: amount!, workPackageId: wp && 'id' in wp ? wp.id : null }, { historicPersonnel: personnel && historic });
      if (rules.length) {
        for (const m of rules) r.err(m.startsWith('datum') ? 'date' : m.startsWith('radni') ? 'workPackage' : 'category', m.startsWith('trošak osoblja') ? `${m}. Ako je trošak već potraživan u ZNS-u prije ArQusa, upiši DA u stupac „Potraživano izvan sustava” (redak po osobi i mjesecu).` : m);
        continue;
      }
      if (historic) { for (const m of historicIssues({ amount: amount!, recognised, reason })) r.err(m.startsWith('priznati') ? 'recognised' : 'reason', m); if (r.issues.length) continue; }
      if (externalClaim && externalClaim.length > 200) { r.err('externalClaim', 'najviše 200 znakova'); continue; }

      // Upozorenja: mogući duplikati, razdoblja sa ZNS-om u sustavu, razdoblje koje još traje.
      const warn = (message: string, col: string | null = null) => plan.warnings.push({ sheet: plan.name!, row: r.row.n, column: r.column(col), value: col ? cellText(r.cell(col)) || null : null, message });
      const dupKey = `${partnerId}|${date}|${amount}|${code}`;
      const dup = c.expenses.find((e) => e.partnerId === partnerId && e.date === date && e.amountCents === amount && e.categoryCode === code);
      if (dup) warn(`mogući duplikat troška koji već postoji u sustavu (${hrDate(dup.date)}, ${code}, ${eurText(dup.amountCents)}: „${dup.description.slice(0, 60)}”)`, 'amount');
      if (fileKeys.has(dupKey)) warn(`isti datum, kategorija i iznos kao u retku ${fileKeys.get(dupKey)} – mogući duplikat u datoteci`, 'amount');
      fileKeys.set(dupKey, r.row.n);
      const period = periodOf(date!);
      const claimedInSystem = period && c.claimedPeriods.some((x) => x.partnerId === partnerId && x.periodId === period.id);
      if (claimedInSystem && !historic) warn(`datiran u razdoblju RP${period.number}, za koje je ZNS već predan u sustavu – neće ući automatski u ZNS; nudit će se kao trošak iz ranijeg razdoblja`, 'date');
      if (claimedInSystem && historic) warn(`razdoblje RP${period.number} već ima ZNS predan u sustavu – provjeri da trošak nije potraživan dvaput`, 'date');
      if (historic && period && period.endDate >= c.today) warn(`označen kao već potraživan, a razdoblje RP${period.number} još traje (do ${hrDate(period.endDate)})`, 'historic');

      ops.expenses.push({ row: r.row.n, partnerId, categoryCode: code, wp, date: date!, description: description!, supplier, amount: amount!, evidenceRef, historic, recognised: historic ? recognised : null, reason: historic && recognised !== null && recognised < amount! ? reason : null, externalClaim: historic ? externalClaim : null, person });
      plan.created++;
      plan.items.push({ row: r.row.n, action: 'create', historic, text: `${hrDate(date!)} · ${code}${wp ? ` · ${this.wpLabel(c, wp)}` : ''} · ${eurText(amount!)} · ${description}${historic ? ` · potraživano izvan sustava${externalClaim ? ` (${externalClaim})` : ''}${recognised !== null ? `, priznato ${eurText(recognised)}` : ''}` : ''}` });
    }
    // Ukupno po kategoriji nakon uvoza prema ugovorenom proračunu (upozorenje, kao u popisu za provjeru ZNS-a).
    if (!readers.some((r) => r.issues.length) && ops.expenses.length) {
      const planned = new Map<string, number>();
      const budget = ops.budget ? ops.budget.lines.map((l) => ({ categoryCode: l.categoryCode, amountCents: l.amount })) : c.budgetLines;
      for (const l of budget) planned.set(l.categoryCode, (planned.get(l.categoryCode) ?? 0) + l.amountCents);
      const actual = new Map<string, number>();
      for (const e of c.actualBefore) actual.set(e.categoryCode, (actual.get(e.categoryCode) ?? 0) + e.amount);
      for (const e of ops.expenses) actual.set(e.categoryCode, (actual.get(e.categoryCode) ?? 0) + (e.recognised ?? e.amount));
      for (const [code, a] of [...actual].sort()) {
        const p = planned.get(code) ?? 0;
        if (ops.expenses.some((e) => e.categoryCode === code) && a > p) plan.warnings.push({ sheet: plan.name!, row: null, column: null, value: null, message: `${code}: ostvareno nakon uvoza ${eurText(a)} prelazi ugovoreni proračun ${eurText(p)} (za ${eurText(a - p)})` });
      }
    }
  }

  /** Priprema podataka koji ovise o sadržaju datoteke (e-adrese) i ostvarenog prije uvoza. */
  private async prepare(tx: Tx, c: Ctx, source: ImportSource): Promise<void> {
    const team = source.sheets.find((s) => s.def.key === 'team');
    const emails = new Set<string>();
    const col = team?.match?.columns.get('email');
    if (team && col !== undefined) for (const r of team.rows) { const c = r.cells[col]; if (c && c.t === 's' && c.v.trim()) emails.add(c.v.trim().toLowerCase()); }
    if (emails.size) {
      const rows = await tx.select({ id: users.id, email: users.email }).from(users).where(and(inArray(sql`lower(${users.email})`, [...emails].slice(0, 5000)), isNull(users.deletedAt), sql`${users.status} <> 'disabled'`));
      for (const r of rows) c.userIds.set(r.email.toLowerCase(), r.id);
    }
    c.actualBefore = (await tx.select({ categoryCode: expenses.categoryCode, amount: sql<string>`coalesce(${expenses.recognisedCents}, ${expenses.amountCents})` }).from(expenses).where(eq(expenses.projectId, c.project.id)))
      .map((r) => ({ categoryCode: r.categoryCode, amount: Number(r.amount) }));
  }

  /** Pregled s pripremom (javni ulaz za kontroler). */
  async previewFile(tx: Tx, projectId: string, file: { buffer: Buffer; originalname: string }, opts: { skip: ImportSheetKey[]; csvSheet?: ImportSheetKey | null }): Promise<ImportPlan> {
    this.assertMayImport(projectId);
    const source = readImportSource(file.buffer, file.originalname, opts.csvSheet);
    const c = await this.context(tx, projectId);
    await this.prepare(tx, c, source);
    return this.plan(c, source, { fileName: file.originalname, sha256: sha256(file.buffer), size: file.buffer.length }, opts.skip);
  }

  /* ---------- potvrda ---------- */

  /**
   * Primjena istih bajtova koji su pregledani: SHA-256 datoteke mora odgovarati onome iz pregleda, revizija projekta onoj
   * iz pregleda, a plan izračunan ponovno u ovoj transakciji (uz zaključan redak projekta) mora imati isti otisak – inače
   * 409 i ništa se ne zapisuje. Sve u jednoj transakciji: greška u bilo kojem retku poništava cijeli uvoz.
   */
  async confirm(tx: Tx, tenantId: string, projectId: string, file: { buffer: Buffer; originalname: string }, input: { sha256: string; revision: number; fingerprint: string; acknowledgeWarnings: boolean; skip: ImportSheetKey[]; csvSheet?: ImportSheetKey | null }, actorId?: string) {
    this.assertMayImport(projectId);
    const actual = sha256(file.buffer);
    if (actual !== input.sha256.toLowerCase()) throw new ConflictException({ code: 'import_file_changed', message: 'Datoteka nije ista kao ona koju si pregledao (SHA-256 se razlikuje). Ništa nije spremljeno – učitaj datoteku ponovno i pregledaj je.' });
    await loadProject(tx, projectId, { editable: true });
    await assertRevision(tx, projects, projectId, input.revision, 'Projekt');
    const source = readImportSource(file.buffer, file.originalname, input.csvSheet);
    const c = await this.context(tx, projectId);
    await this.prepare(tx, c, source);
    const plan = this.plan(c, source, { fileName: file.originalname, sha256: actual, size: file.buffer.length }, input.skip);
    if (plan.fingerprint !== input.fingerprint) throw new ConflictException({ code: 'import_plan_changed', message: 'Podaci na projektu promijenili su se nakon pregleda (ili je odabir listova drugačiji). Ništa nije spremljeno – pregledaj datoteku ponovno.' });
    if (plan.errors) throw new BadRequestException({ code: 'import_has_errors', message: `Datoteka ima ${plan.errors} ${pl(plan.errors, 'grešku', 'greške', 'grešaka')} – ništa nije spremljeno. Ispravi ih i učitaj datoteku ponovno.` });
    if (!plan.canConfirm) throw new BadRequestException({ code: 'import_nothing', message: 'U datoteci nema ničega novog za uvoz.' });
    if (plan.needsAcknowledge && !input.acknowledgeWarnings) throw new BadRequestException({ code: 'import_warnings_unacknowledged', message: `Pregled ima ${plan.warnings} ${pl(plan.warnings, 'upozorenje', 'upozorenja', 'upozorenja')} – potvrdi da si ih pročitao.` });
    for (const p of plan.permissions) if (!c.can(p)) throw new ForbiddenException(`${HEADS} ${p} na ovom projektu`);
    return this.apply(c, tenantId, plan, actorId);
  }

  private async apply(c: Ctx, tenantId: string, plan: ImportPlan, actorId?: string) {
    const { tx } = c; const ops = plan.ops; const importId = randomUUID(); const now = new Date();
    const created: ProjectImportCreated = { workPackages: [], deliverables: [], milestones: [], teamMembers: [], expenses: [], roleAssignments: [], budget: null };
    const wpIds = new Map<number, string>();
    const wpId = (ref: { id: string } | { number: number } | null) => (!ref ? null : 'id' in ref ? ref.id : wpIds.get(ref.number)!);
    for (const w of ops.workPackages) {
      const [row] = await tx.insert(workPackages).values({ tenantId, projectId: c.project.id, number: w.number, title: w.title, startMonth: w.startMonth, endMonth: w.endMonth, leadPartnerId: w.leadPartnerId, objectives: w.objectives, createdBy: actorId, updatedBy: actorId }).returning({ id: workPackages.id });
      wpIds.set(w.number, row!.id); created.workPackages.push(row!.id);
    }
    for (const d of ops.deliverables) {
      const [row] = await tx.insert(deliverables).values({ tenantId, projectId: c.project.id, workPackageId: wpId(d.wp)!, number: d.number, title: d.title, type: d.type, dissemination: d.dissemination, dueMonth: d.dueMonth, leadPartnerId: d.leadPartnerId, createdBy: actorId, updatedBy: actorId }).returning({ id: deliverables.id });
      created.deliverables.push(row!.id);
    }
    for (const m of ops.milestones) {
      const [row] = await tx.insert(milestones).values({ tenantId, projectId: c.project.id, number: m.number, title: m.title, dueMonth: m.dueMonth, verification: m.verification, createdBy: actorId, updatedBy: actorId }).returning({ id: milestones.id });
      created.milestones.push(row!.id);
    }
    if (ops.budget) {
      // Isti zaštitni redoslijed kao spremanje proračuna (BudgetService): zaključan redak projekta, pa provjera da proračun nije zaključan.
      let budget = c.budget;
      if (budget) {
        const cur = (await tx.select({ status: projectBudgets.status, revision: projectBudgets.revision }).from(projectBudgets).where(eq(projectBudgets.id, budget.id)).for('update'))[0]!;
        if (cur.status === 'locked' || cur.revision !== budget.revision) throw new ConflictException({ code: 'import_plan_changed', message: 'Proračun se promijenio nakon pregleda – ništa nije spremljeno; pregledaj datoteku ponovno.' });
      } else {
        const [row] = await tx.insert(projectBudgets).values({ tenantId, projectId: c.project.id, version: 1, createdBy: actorId, updatedBy: actorId }).returning();
        budget = { id: row!.id, status: row!.status, revision: row!.revision, version: row!.version };
      }
      await tx.delete(budgetLines).where(eq(budgetLines.budgetId, budget.id));
      await tx.insert(budgetLines).values(ops.budget.lines.map((l) => ({ tenantId, budgetId: budget!.id, partnerId: l.partnerId, categoryCode: l.categoryCode, workPackageId: wpId(l.wp), amountCents: l.amount, description: l.description, createdBy: actorId })));
      const [after] = await tx.update(projectBudgets).set({ revision: bump(projectBudgets), updatedAt: now, updatedBy: actorId }).where(eq(projectBudgets.id, budget.id)).returning({ revision: projectBudgets.revision });
      created.budget = { budgetId: budget.id, created: !c.budget, revisionAfter: after!.revision, previousLines: c.budget ? c.budgetLines : [] };
    }
    const memberIds = new Map<string, string>();
    for (const t of ops.team) {
      const [row] = await tx.insert(teamMembers).values({ tenantId, projectId: c.project.id, partnerId: t.partnerId, userId: t.userId, fullName: t.fullName, role: t.role, annualCostCents: t.annualCost, createdBy: actorId, updatedBy: actorId }).returning({ id: teamMembers.id });
      memberIds.set(t.key, row!.id); created.teamMembers.push(row!.id);
      if (t.userId) { const g = await ensureTeamMemberAccess(tx, this.audit, tenantId, c.project.id, t.userId, actorId); if (g) created.roleAssignments.push(g.id); }
    }
    for (const e of ops.expenses) {
      const personnel = e.person !== null;
      const [row] = await tx.insert(expenses).values({
        tenantId, projectId: c.project.id, partnerId: e.partnerId, categoryCode: e.categoryCode, workPackageId: wpId(e.wp), date: e.date, description: e.description, supplier: e.supplier,
        amountCents: e.amount, evidenceRef: e.evidenceRef, source: personnel ? 'historic_personnel' : 'manual', status: e.historic ? 'historic' : 'recorded',
        recognisedCents: e.historic ? e.recognised : null, decisionReason: e.historic ? e.reason : null, externalClaim: e.historic ? e.externalClaim : null,
        teamMemberId: e.person ? ('id' in e.person ? e.person.id : memberIds.get(e.person.key)!) : null, importId, createdBy: actorId, updatedBy: actorId,
      }).returning({ id: expenses.id });
      created.expenses.push(row!.id);
    }
    await tx.update(projects).set({ revision: bump(projects), updatedAt: now, updatedBy: actorId }).where(eq(projects.id, c.project.id));
    const counts = Object.fromEntries(plan.sheets.filter((s) => s.status === 'ready').map((s) => [s.key, { created: s.created, updated: s.updated, unchanged: s.unchanged, rows: s.rowsRead }]));
    await tx.insert(projectImports).values({
      id: importId, tenantId, projectId: c.project.id, fileName: plan.fileName.slice(0, 255), fileSha256: plan.sha256, fileSize: plan.size, format: plan.format, counts, created,
      permissions: plan.permissions, fingerprint: plan.fingerprint, createdAt: now, createdBy: actorId ?? null,
    });
    // Jedan revizijski zapis za cijeli uvoz: tko, kada, datoteka, SHA-256 i brojevi po listu (bez iznosa – plaće se ne bilježe ovdje).
    await this.audit.record(tx, { entity: 'project_import', entityId: importId, action: 'apply', diff: { after: { status: 'applied', counts }, meta: {
      projectId: c.project.id, fileName: plan.fileName, sha256: plan.sha256, size: plan.size, format: plan.format, warningsAcknowledged: plan.warnings,
      historic: ops.expenses.filter((e) => e.historic).length, skipped: plan.sheets.filter((s) => s.status === 'skipped').map((s) => s.key),
    } } });
    return { importId, counts, links: plan.sheets.filter((s) => s.status === 'ready' && s.created + s.updated > 0).map((s) => ({ sheet: s.key, label: s.label, tab: IMPORT_SHEET_TAB[s.key] })) };
  }

  /* ---------- povijest i poništavanje ---------- */

  async history(tx: Tx, projectId: string) {
    await loadProject(tx, projectId);
    const rows = await tx.select({ i: projectImports, by: users.displayName }).from(projectImports).leftJoin(users, eq(users.id, projectImports.createdBy))
      .where(eq(projectImports.projectId, projectId)).orderBy(desc(projectImports.createdAt));
    const undoneBy = new Map((await tx.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, [...new Set(rows.map((r) => r.i.undoneBy).filter((x): x is string => !!x)), '00000000-0000-0000-0000-000000000000']))).map((u) => [u.id, u.name]));
    const out = [];
    for (const { i, by } of rows) {
      const blockers = i.status === 'applied' ? await this.blockers(tx, i) : [];
      const missing = i.permissions.filter((p) => !this.can(projectId, p as Permission));
      out.push({
        id: i.id, fileName: i.fileName, sha256: i.fileSha256, size: i.fileSize, format: i.format, status: i.status, counts: i.counts, createdAt: i.createdAt, createdBy: by ?? null,
        undoneAt: i.undoneAt, undoneBy: i.undoneBy ? undoneBy.get(i.undoneBy) ?? null : null, blockers, canUndo: i.status === 'applied' && !blockers.length && !missing.length,
        missingPermissions: missing,
      });
    }
    return out;
  }

  /** Što je u međuvremenu izgrađeno na uvezenim podacima (poništavanje tada nije moguće). */
  private async blockers(tx: Tx, imp: ProjectImportRow): Promise<string[]> {
    const cr = imp.created; const out: string[] = [];
    if (cr.expenses.length) {
      const ex = await tx.select({ id: expenses.id, status: expenses.status, claimId: expenses.claimId, date: expenses.date, description: expenses.description, updatedAt: expenses.updatedAt }).from(expenses).where(inArray(expenses.id, cr.expenses));
      const inClaim = ex.filter((e) => e.claimId || !['recorded', 'historic'].includes(e.status));
      if (inClaim.length) out.push(`${inClaim.length} ${pl(inClaim.length, 'uvezeni trošak je', 'uvezena troška su', 'uvezenih troškova je')} u zahtjevu za nadoknadu (npr. ${hrDate(inClaim[0]!.date)} „${inClaim[0]!.description.slice(0, 50)}”)`);
      const edited = ex.filter((e) => e.updatedAt.getTime() > imp.createdAt.getTime() + 1000 && !inClaim.includes(e));
      if (edited.length) out.push(`${edited.length} ${pl(edited.length, 'uvezeni trošak je', 'uvezena troška su', 'uvezenih troškova je')} u međuvremenu ${pl(edited.length, 'izmijenjen', 'izmijenjena', 'izmijenjeno')}`);
      const selected = await tx.select({ n: sql<number>`count(*)::int` }).from(reimbursementClaims).where(and(eq(reimbursementClaims.projectId, imp.projectId), sql`${reimbursementClaims.earlierExpenseIds} && ${`{${cr.expenses.join(',')}}`}::uuid[]`));
      if (selected[0]!.n) out.push('uvezeni trošak je odabran kao trošak iz ranijih razdoblja u nacrtu ZNS-a');
      const docs = await tx.select({ n: sql<number>`count(*)::int` }).from(documents).where(and(eq(documents.entityType, 'expense'), inArray(documents.entityId, cr.expenses), isNull(documents.deletedAt)));
      if (docs[0]!.n) out.push(`uz uvezene troškove priložen${docs[0]!.n === 1 ? ' je' : 'o je'} ${docs[0]!.n} ${pl(docs[0]!.n, 'dokaz', 'dokaza', 'dokaza')}`);
    }
    if (cr.workPackages.length) {
      const t = (await tx.select({ n: sql<number>`count(*)::int` }).from(tasks).where(inArray(tasks.workPackageId, cr.workPackages)))[0]!.n;
      if (t) out.push(`uvezeni radni paketi imaju ${t} ${pl(t, 'zadatak', 'zadatka', 'zadataka')}`);
      const d = (await tx.select({ n: sql<number>`count(*)::int` }).from(deliverables).where(and(inArray(deliverables.workPackageId, cr.workPackages), cr.deliverables.length ? notInArray(deliverables.id, cr.deliverables) : undefined)))[0]!.n;
      if (d) out.push(`uvezeni radni paketi imaju ${d} ${pl(d, 'isporuku', 'isporuke', 'isporuka')} dodanih poslije`);
      const e = (await tx.select({ n: sql<number>`count(*)::int` }).from(expenses).where(and(inArray(expenses.workPackageId, cr.workPackages), sql`(${expenses.importId} is distinct from ${imp.id})`)))[0]!.n;
      if (e) out.push(`na uvezene radne pakete evidentirano je ${e} ${pl(e, 'trošak', 'troška', 'troškova')} izvan ovog uvoza`);
      const te = (await tx.select({ n: sql<number>`count(*)::int` }).from(timesheetEntries).where(inArray(timesheetEntries.workPackageId, cr.workPackages)))[0]!.n;
      if (te) out.push('na uvezene radne pakete upisani su sati u timesheetovima');
      const bl = (await tx.select({ n: sql<number>`count(*)::int` }).from(budgetLines).innerJoin(projectBudgets, eq(projectBudgets.id, budgetLines.budgetId))
        .where(and(inArray(budgetLines.workPackageId, cr.workPackages), cr.budget ? sql`${projectBudgets.id} <> ${cr.budget.budgetId}` : undefined)))[0]!.n;
      if (bl) out.push('uvezeni radni paketi koriste se u drugoj verziji proračuna');
    }
    if (cr.deliverables.length) {
      const d = await tx.select({ status: deliverables.status }).from(deliverables).where(inArray(deliverables.id, cr.deliverables));
      if (d.some((x) => x.status !== 'planned')) out.push('status uvezene isporuke je u međuvremenu promijenjen');
      const docs = (await tx.select({ n: sql<number>`count(*)::int` }).from(documents).where(and(eq(documents.entityType, 'deliverable'), inArray(documents.entityId, cr.deliverables), isNull(documents.deletedAt))))[0]!.n;
      if (docs) out.push('uz uvezenu isporuku priložen je dokument');
    }
    if (cr.milestones.length) {
      const m = await tx.select({ status: milestones.status }).from(milestones).where(inArray(milestones.id, cr.milestones));
      if (m.some((x) => x.status !== 'planned')) out.push('status uvezene prekretnice je u međuvremenu promijenjen');
    }
    if (cr.teamMembers.length) {
      const ts = (await tx.select({ n: sql<number>`count(*)::int` }).from(timesheets).where(inArray(timesheets.teamMemberId, cr.teamMembers)))[0]!.n;
      if (ts) out.push(`uvezeni članovi tima imaju ${ts} ${pl(ts, 'timesheet', 'timesheeta', 'timesheetova')}`);
      const e = (await tx.select({ n: sql<number>`count(*)::int` }).from(expenses).where(and(inArray(expenses.teamMemberId, cr.teamMembers), sql`(${expenses.importId} is distinct from ${imp.id})`)))[0]!.n;
      if (e) out.push('na uvezene članove tima vezani su troškovi osoblja iz drugog uvoza');
    }
    if (cr.budget) {
      const b = (await tx.select({ status: projectBudgets.status, revision: projectBudgets.revision }).from(projectBudgets).where(eq(projectBudgets.id, cr.budget.budgetId)))[0];
      if (!b) out.push('uvezeni proračun više ne postoji');
      else if (b.status === 'locked') out.push('proračun je u međuvremenu zaključan (aktivacija projekta)');
      else if (b.revision !== cr.budget.revisionAfter) out.push('proračun je u međuvremenu izmijenjen');
    }
    return out;
  }

  async undo(tx: Tx, projectId: string, importId: string, actorId?: string) {
    this.assertMayImport(projectId);
    await loadProject(tx, projectId, { editable: true });
    await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for('update');
    const imp = (await tx.select().from(projectImports).where(and(eq(projectImports.id, importId), eq(projectImports.projectId, projectId))).for('update'))[0];
    if (!imp) throw new NotFoundException('Uvoz ne postoji na projektu');
    if (imp.status !== 'applied') throw new ConflictException('Uvoz je već poništen');
    for (const p of imp.permissions) if (!this.can(projectId, p as Permission)) throw new ForbiddenException(`Poništavanje ovog uvoza traži iste dozvole kao uvoz – ${HEADS.toLowerCase()} ${p} na ovom projektu`);
    const blockers = await this.blockers(tx, imp);
    if (blockers.length) throw new ConflictException({ code: 'import_undo_blocked', message: 'Uvoz se ne može poništiti jer je na uvezenim podacima u međuvremenu nešto izgrađeno. Ništa nije promijenjeno.', blockers });
    const cr = imp.created; const now = new Date();
    // Obrnutim redoslijedom: troškovi → tim (i dodjele) → proračun → prekretnice → isporuke → radni paketi.
    if (cr.expenses.length) {
      await tx.execute(sql`select set_config('app.import_undo', ${imp.id}, true)`);
      await tx.delete(expenses).where(and(inArray(expenses.id, cr.expenses), eq(expenses.importId, imp.id), eq(expenses.projectId, projectId)));
      await tx.execute(sql`select set_config('app.import_undo', '', true)`);
    }
    if (cr.roleAssignments.length) await tx.delete(roleAssignments).where(and(inArray(roleAssignments.id, cr.roleAssignments), eq(roleAssignments.projectId, projectId)));
    if (cr.teamMembers.length) await tx.delete(teamMembers).where(and(inArray(teamMembers.id, cr.teamMembers), eq(teamMembers.projectId, projectId)));
    if (cr.budget) {
      await tx.delete(budgetLines).where(eq(budgetLines.budgetId, cr.budget.budgetId));
      if (cr.budget.created) await tx.delete(projectBudgets).where(and(eq(projectBudgets.id, cr.budget.budgetId), eq(projectBudgets.projectId, projectId)));
      else {
        if (cr.budget.previousLines.length) await tx.insert(budgetLines).values(cr.budget.previousLines.map((l) => ({ tenantId: imp.tenantId, budgetId: cr.budget!.budgetId, ...l, createdBy: actorId })));
        await tx.update(projectBudgets).set({ revision: bump(projectBudgets), updatedAt: now, updatedBy: actorId }).where(eq(projectBudgets.id, cr.budget.budgetId));
      }
    }
    if (cr.milestones.length) await tx.delete(milestones).where(and(inArray(milestones.id, cr.milestones), eq(milestones.projectId, projectId)));
    if (cr.deliverables.length) await tx.delete(deliverables).where(and(inArray(deliverables.id, cr.deliverables), eq(deliverables.projectId, projectId)));
    if (cr.workPackages.length) await tx.delete(workPackages).where(and(inArray(workPackages.id, cr.workPackages), eq(workPackages.projectId, projectId)));
    await tx.update(projects).set({ revision: bump(projects), updatedAt: now, updatedBy: actorId }).where(eq(projects.id, projectId));
    await tx.update(projectImports).set({ status: 'undone', undoneAt: now, undoneBy: actorId ?? null }).where(eq(projectImports.id, imp.id));
    await this.audit.record(tx, { entity: 'project_import', entityId: imp.id, action: 'undo', diff: { before: { status: 'applied', counts: imp.counts }, after: { status: 'undone' }, meta: { projectId, fileName: imp.fileName, sha256: imp.fileSha256 } } });
    return { undone: true, importId: imp.id };
  }
}
