import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  categoryNames, claimChecklist, claimDecision, claimTotals, computePartnerBudget, hoursToMinutes, dateIn, monthsInPeriod, paymentIssues, preparationMeasures,
  type ClaimChecklist, type ProgrammePackage,
} from '@arqus/domain';
import type { Tx } from '../db/db.service';
import {
  budgetLines, documents, expenses, projectBudgets, projectPartners, reimbursementClaims, reportingPeriods, teamMembers, timesheetEntries, timesheets, workPackages,
} from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { ProgrammePackagesService } from '../programmes/programme-packages.service';
import { assertPartnerOnProject, loadProject } from '../common/project-access';
import { assertRevision, bump, revisionField } from '../common/revision';
import { tenantTimeZone, tenantToday } from '../common/tenant-context';
import { selfPartner, strandedExpense } from './finance-common';
import { evidenceCount, seesConfidential } from './expenses.service';
import { assertMayDecidePersonnel, hidesAmount, seesPersonnelAmounts } from '../common/personnel';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const note = z.string().trim().max(2000);
export const claimInput = z.object({ period: z.number().int().min(1), partnerId: z.string().uuid().optional() });
/** Predaja: razlog rane predaje (prije kraja razdoblja) i potvrda ručnih troškova bez dokaza. */
export const submitInput = z.object({
  earlyReason: note.optional(),
  acknowledgeWithoutEvidence: z.array(z.string().uuid()).max(5000).optional(),
  /** WP1.16b: sati utrošeni na pripremu ovog zahtjeva (neobavezno, za izvještaj o uštedi). */
  preparationHours: z.number().min(0).max(10_000).nullable().optional(),
}).strict();
/** WP1.16b: izričit odabir troškova iz ranijih razdoblja u nacrtu (zamjenjuje dosadašnji odabir). */
export const earlierInput = z.object({ expenseIds: z.array(z.string().uuid()).max(5000), revision: revisionField }).strict();
/** WP1.16b: naknadni upis ili ispravak sati pripreme predanog zahtjeva. */
export const preparationInput = z.object({ hours: z.number().min(0).max(10_000).nullable() }).strict();
const expenseDecision = z.object({ id: z.string().uuid(), recognised: z.number().int().min(0), reason: z.string().trim().max(1000).nullable().optional() }).strict();
const decided = {
  /** Datum odluke financijera; zadano danas. */
  decisionDate: isoDate.optional(),
  /** Odluke po trošku; trošak koji nije naveden priznaje se u cijelosti (kod ispravka: ostaje kako je odlučeno). */
  expenses: z.array(expenseDecision).max(5000).optional(),
  /** Ukupni odobreni iznos iz odluke financijera (neobavezno). */
  funderTotal: z.number().int().min(0).nullable().optional(),
};
export const decisionInput = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('returned'), note: note.min(5, 'upiši razlog povrata na dopunu') }).strict(),
  z.object({ decision: z.literal('decided'), ...decided, note: note.optional() }).strict(),
]);
/** Namjerni ispravak odluke (npr. nakon prigovora): obavezno obrazloženje; nije moguć nakon isplate. */
export const correctionInput = z.object({ ...decided, note: note.min(5, 'upiši razlog ispravka odluke') }).strict();
export const previewInput = z.object({ ...decided, note: note.optional() }).strict();
export const paymentInput = z.object({ paidAmount: z.number().int().min(0), paidAt: isoDate, note: note.optional() }).strict();

const DECIDED = ['approved', 'partially_approved', 'rejected'] as const;
type ClaimRow = typeof reimbursementClaims.$inferSelect;
type PeriodRow = typeof reportingPeriods.$inferSelect;
type ExpenseRow = typeof expenses.$inferSelect;
type StoredTotals = ReturnType<typeof computePartnerBudget>;
/** Troškovi osoblja (iz timesheeta) među troškovima zahtjeva – o njima odlučuje samo uloga s personnel:read (WP1.19). */
const personnelIds = (rows: ExpenseRow[]): Set<string> => new Set(rows.filter((e) => e.source === 'timesheet').map((e) => e.id));

/** Zahtjev za nadoknadu (ZNS / financial statement) po izvještajnom razdoblju i partneru. Pravila: `docs/domena/zns-pravila.md`. */
@Injectable()
export class ClaimsService {
  constructor(private readonly audit: AuditService, private readonly packages: ProgrammePackagesService) {}

  private async claim(tx: Tx, projectId: string, id: string) {
    const r = (await tx.select({ c: reimbursementClaims, rp: reportingPeriods }).from(reimbursementClaims)
      .innerJoin(reportingPeriods, eq(reportingPeriods.id, reimbursementClaims.reportingPeriodId))
      .where(and(eq(reimbursementClaims.id, id), eq(reimbursementClaims.projectId, projectId))))[0];
    if (!r) throw new NotFoundException('Zahtjev za nadoknadu ne postoji na projektu');
    return r;
  }

  /** Paket, vrsta akcije i vrsta korisnika partnera – ulaz za izračun traženog i priznatog iznosa. */
  private async rules(tx: Tx, projectId: string, partnerId: string): Promise<{ pkg: ProgrammePackage; actionType: string; beneficiaryType: string }> {
    const p = await loadProject(tx, projectId);
    const pkg = await this.packages.get(tx, p.packageId, p.packageVersion);
    const partner = (await tx.select({ bt: projectPartners.beneficiaryType }).from(projectPartners).where(eq(projectPartners.id, partnerId)))[0]!;
    return { pkg, actionType: p.actionType, beneficiaryType: partner.bt };
  }

  /**
   * Troškovi koji ulaze u zahtjev: u nacrtu prihvatljivi (evidentirani, partner, datum u razdoblju, nisu u drugom zahtjevu)
   * i izričito odabrani troškovi iz ranijih razdoblja (WP1.16b); nakon predaje pridruženi troškovi.
   */
  private async claimExpenses(tx: Tx, c: ClaimRow, rp: PeriodRow): Promise<ExpenseRow[]> {
    if (c.status !== 'draft') return tx.select().from(expenses).where(eq(expenses.claimId, c.id)).orderBy(asc(expenses.date), asc(expenses.createdAt));
    const rows = await tx.select().from(expenses).where(and(eq(expenses.projectId, c.projectId), eq(expenses.partnerId, c.partnerId), eq(expenses.status, 'recorded'), isNull(expenses.claimId))).orderBy(asc(expenses.date), asc(expenses.createdAt));
    const selected = new Set(c.earlierExpenseIds ?? []);
    const eligible = selected.size ? new Set((await this.earlierCandidates(tx, c, rp)).map((x) => x.e.id)) : new Set<string>();
    return rows.filter((e) => (e.date >= rp.startDate && e.date <= rp.endDate) || (selected.has(e.id) && eligible.has(e.id)));
  }

  /**
   * Nepredani troškovi iz ranijih razdoblja istog partnera (WP1.16b): datirani prije početka ovog razdoblja u razdoblju
   * čiji je ZNS već predan. `period` – razdoblje u kojem je trošak datiran; `selectedElsewhere` – broj razdoblja drugog
   * nacrta koji ga je već odabrao (tada ga ovaj nacrt ne može uključiti).
   */
  private async earlierCandidates(tx: Tx, c: ClaimRow, rp: PeriodRow) {
    const rows = await tx.select().from(expenses).where(and(eq(expenses.projectId, c.projectId), eq(expenses.partnerId, c.partnerId), lt(expenses.date, rp.startDate), strandedExpense()))
      .orderBy(asc(expenses.date), asc(expenses.createdAt));
    if (!rows.length) return [];
    const periods = await tx.select({ number: reportingPeriods.number, startDate: reportingPeriods.startDate, endDate: reportingPeriods.endDate }).from(reportingPeriods).where(eq(reportingPeriods.projectId, c.projectId));
    const drafts = await tx.select({ id: reimbursementClaims.id, ids: reimbursementClaims.earlierExpenseIds, number: reportingPeriods.number }).from(reimbursementClaims)
      .innerJoin(reportingPeriods, eq(reportingPeriods.id, reimbursementClaims.reportingPeriodId))
      .where(and(eq(reimbursementClaims.projectId, c.projectId), eq(reimbursementClaims.status, 'draft'), ne(reimbursementClaims.id, c.id)));
    return rows.map((e) => ({
      e,
      period: periods.find((p) => e.date >= p.startDate && e.date <= p.endDate)?.number ?? null,
      selectedElsewhere: drafts.find((d) => (d.ids ?? []).includes(e.id))?.number ?? null,
    }));
  }

  /** Broj dokaza i podaci za grupiranje troškova osoblja (osoba, mjesec, radni paket). */
  private async expenseInfo(tx: Tx, projectId: string, ids: string[]) {
    if (!ids.length) return new Map<string, { documents: number; person: string | null; month: string | null; wp: number | null }>();
    const rows = await tx.select({ id: expenses.id, documents: evidenceCount(seesConfidential(projectId)), person: teamMembers.fullName, month: timesheets.month, wp: workPackages.number })
      .from(expenses).leftJoin(timesheets, eq(timesheets.id, expenses.timesheetId)).leftJoin(teamMembers, eq(teamMembers.id, timesheets.teamMemberId))
      .leftJoin(workPackages, eq(workPackages.id, expenses.workPackageId)).where(inArray(expenses.id, ids));
    return new Map(rows.map((r) => [r.id, { documents: r.documents, person: r.person, month: r.month, wp: r.wp }]));
  }

  /** Broj aktivnih dokaza uz troškove (svi, i povjerljivi – samo zbroj, bez naziva; mjera pripreme). */
  private async evidenceFiles(tx: Tx, ids: string[]): Promise<number> {
    if (!ids.length) return 0;
    const r = await tx.select({ n: sql<number>`count(*)::int` }).from(documents).where(and(eq(documents.entityType, 'expense'), inArray(documents.entityId, ids), isNull(documents.deletedAt)));
    return r[0]?.n ?? 0;
  }

  /** Popis za provjeru (samo za nacrt): timesheetovi članova tima partnera u mjesecima razdoblja, dokazi, proračun po kategoriji. */
  private async checklist(tx: Tx, c: ClaimRow, rp: PeriodRow, all: ExpenseRow[], docs: (id: string) => number, pkg: ProgrammePackage, opts: { earlyReason?: string; acknowledged?: string[] } = {}): Promise<ClaimChecklist> {
    const rows = all.filter((e) => e.date >= rp.startDate);
    const earlier = all.filter((e) => e.date < rp.startDate);
    const candidates = await this.earlierCandidates(tx, c, rp);
    const notSelected = candidates.filter((x) => !earlier.some((e) => e.id === x.e.id) && x.selectedElsewhere === null);
    const months = monthsInPeriod(rp.startDate, rp.endDate);
    const ts = await tx.select({ memberName: teamMembers.fullName, month: timesheets.month, status: timesheets.status, minutes: sql<number>`coalesce(sum(${timesheetEntries.minutes}), 0)::int` })
      .from(timesheets).innerJoin(teamMembers, eq(teamMembers.id, timesheets.teamMemberId)).leftJoin(timesheetEntries, eq(timesheetEntries.timesheetId, timesheets.id))
      .where(and(eq(timesheets.projectId, c.projectId), eq(teamMembers.partnerId, c.partnerId), inArray(timesheets.month, months)))
      .groupBy(teamMembers.fullName, timesheets.month, timesheets.status);
    const budget = (await tx.select({ id: projectBudgets.id }).from(projectBudgets).where(eq(projectBudgets.projectId, c.projectId)).orderBy(desc(projectBudgets.version)).limit(1))[0];
    const planned = budget ? await tx.select({ code: budgetLines.categoryCode, amount: sql<string>`sum(${budgetLines.amountCents})` }).from(budgetLines)
      .where(and(eq(budgetLines.budgetId, budget.id), eq(budgetLines.partnerId, c.partnerId))).groupBy(budgetLines.categoryCode) : [];
    // Ranije zatraženo istog partnera, kao ostvareno: priznati iznos nakon odluke, inače traženi. WP1.17: i troškovi
    // potraživani izvan sustava (prije ArQusa) – kumulativ prema proračunu uključuje cijelo dosadašnje potraživanje.
    const before = await tx.select({ code: expenses.categoryCode, amount: sql<string>`sum(coalesce(${expenses.recognisedCents}, ${expenses.amountCents}))` }).from(expenses)
      .where(and(eq(expenses.projectId, c.projectId), eq(expenses.partnerId, c.partnerId), or(and(isNotNull(expenses.claimId), ne(expenses.claimId, c.id)), eq(expenses.status, 'historic')))).groupBy(expenses.categoryCode);
    const names = categoryNames(pkg);
    const codes = new Set([...planned.map((x) => x.code), ...before.map((x) => x.code)]);
    const asItem = (e: ExpenseRow) => ({ id: e.id, date: e.date, description: e.description, amount: e.amountCents, categoryCode: e.categoryCode, source: e.source, documents: docs(e.id) });
    return claimChecklist({
      today: tenantToday(), period: { startDate: rp.startDate, endDate: rp.endDate },
      expenses: rows.map(asItem),
      earlier: earlier.map(asItem),
      earlierNotSelected: notSelected.map((x) => ({ date: x.e.date, description: x.e.description, amount: x.e.amountCents, period: x.period ?? 0, source: x.e.source })),
      timesheets: ts,
      budget: [...codes].map((code) => ({ categoryCode: code, name: names.get(code), planned: Number(planned.find((x) => x.code === code)?.amount ?? 0), claimedBefore: Number(before.find((x) => x.code === code)?.amount ?? 0) })),
      earlyReason: opts.earlyReason, acknowledgedWithoutEvidence: opts.acknowledged,
    });
  }

  async get(tx: Tx, projectId: string, id: string) {
    const { c, rp } = await this.claim(tx, projectId, id);
    const rows = await this.claimExpenses(tx, c, rp);
    const info = await this.expenseInfo(tx, projectId, rows.map((e) => e.id));
    const docs = (eid: string) => info.get(eid)?.documents ?? 0;
    const r = await this.rules(tx, projectId, c.partnerId);
    const live = claimTotals(r.pkg, r.actionType, r.beneficiaryType, rows.map((e) => ({ categoryCode: e.categoryCode, amount: e.amountCents, recognised: e.recognisedCents })));
    // Traženo: u nacrtu iz trenutnih troškova, nakon predaje snimka iz trenutka predaje.
    const t = c.status === 'draft' || !c.totals ? live.claimed : (c.totals as unknown as StoredTotals);
    const isDecided = (DECIDED as readonly string[]).includes(c.status);
    const checklist = c.status === 'draft' ? await this.checklist(tx, c, rp, rows, docs, r.pkg) : null;
    const decision = (c.decision ?? null) as { computed?: number; funderTotal?: number | null; difference?: number; backfilled?: boolean } | null;
    const candidates = c.status === 'draft' ? await this.earlierCandidates(tx, c, rp) : [];
    const candidateDocs = candidates.length ? await this.expenseInfo(tx, projectId, candidates.map((x) => x.e.id)) : new Map();
    const selected = new Set(c.earlierExpenseIds ?? []);
    // WP1.19: iznos pojedinog troška osoblja samo uz personnel:read na projektu (inače null i `amountHidden`).
    const canSee = seesPersonnelAmounts(projectId);
    const measures = c.status !== 'draft' && c.submittedAt ? preparationMeasures({
      periodEnd: rp.endDate, openedAt: c.createdAt.toISOString(), submittedAt: c.submittedAt.toISOString(),
      returns: (await this.audit.countByEntity(tx, 'claim', [c.id], 'decision.returned')).get(c.id) ?? 0,
      expenses: rows.length, evidenceFiles: await this.evidenceFiles(tx, rows.map((e) => e.id)),
      timesheets: new Set(rows.map((e) => e.timesheetId).filter(Boolean)).size, earlierExpenses: rows.filter((e) => e.date < rp.startDate).length,
    }) : null;
    return {
      id: c.id, projectId, period: { number: rp.number, startDate: rp.startDate, endDate: rp.endDate, dueDate: rp.dueDate }, partnerId: c.partnerId, status: c.status,
      revision: c.revision, updatedAt: c.updatedAt,
      expenses: rows.map((e) => {
        const x = info.get(e.id);
        const hidden = hidesAmount(e.source, canSee);
        return {
          id: e.id, date: e.date, categoryCode: e.categoryCode, description: e.description, supplier: e.supplier, amount: hidden ? null : e.amountCents,
          recognised: hidden ? null : e.recognisedCents, amountHidden: hidden, decisionReason: e.decisionReason, source: e.source, status: e.status, documents: x?.documents ?? 0,
          timesheetId: e.timesheetId, workPackage: x?.wp ? `WP${x.wp}` : null, person: x?.person ?? null, month: x?.month ?? null,
          /** WP1.16b: trošak iz ranijeg razdoblja (datiran prije početka razdoblja zahtjeva). */
          earlier: e.date < rp.startDate,
        };
      }),
      /** Samo u nacrtu: nepredani troškovi iz ranijih razdoblja koje priprematelj može izričito uključiti. */
      earlierCandidates: c.status === 'draft' ? candidates.map((x) => ({
        id: x.e.id, date: x.e.date, categoryCode: x.e.categoryCode, description: x.e.description, supplier: x.e.supplier,
        amount: hidesAmount(x.e.source, canSee) ? null : x.e.amountCents, amountHidden: hidesAmount(x.e.source, canSee), source: x.e.source,
        documents: candidateDocs.get(x.e.id)?.documents ?? 0, period: x.period, selected: selected.has(x.e.id) && x.selectedElsewhere === null, selectedElsewhere: x.selectedElsewhere,
      })) : null,
      /** WP1.16b: prijavljeni sati pripreme i automatske mjere (nakon predaje). */
      preparation: { hours: c.preparationMinutes === null ? null : Math.round((c.preparationMinutes / 60) * 100) / 100, measures },
      /** Ručno uneseni troškovi bez priloženog dokaza (trošak osoblja dokazuje se timesheetom). */
      missingEvidence: rows.filter((e) => e.source === 'manual' && !docs(e.id)).length,
      totals: { direct: t.directTotal, indirect: t.indirectTotal, total: t.total, ratePercent: t.ratePercent, requested: t.requested, byCategory: t.direct, indirectByCategory: t.indirect },
      /** Nakon odluke: priznato (iz priznatih iznosa, isti izračun) i nepriznato (traženo − priznato). */
      recognised: isDecided ? { direct: live.recognised.directTotal, indirect: live.recognised.indirectTotal, total: live.recognised.total, requested: live.recognised.requested, byCategory: live.recognised.direct } : null,
      unrecognised: isDecided ? live.unrecognised : null,
      checklist,
      earlyReason: c.earlyReason, submission: c.submission,
      /** WP1.19: smije li korisnik odlučivati o pojedinom trošku osoblja (personnel:read); bez toga troškovi osoblja ostaju priznati kako su zatraženi. */
      canDecidePersonnel: canSee,
      decision: isDecided ? { date: c.decisionDate, computed: live.recognised.requested, funderTotal: decision?.funderTotal ?? null, difference: decision?.funderTotal == null ? 0 : decision.funderTotal - live.recognised.requested, backfilled: !!decision?.backfilled } : null,
      requested: c.requestedCents, approved: c.approvedCents, paid: c.paidCents, submittedAt: c.submittedAt, decidedAt: c.decidedAt, decisionDate: c.decisionDate,
      paidAt: c.paidAt, paymentNote: c.paymentNote, note: c.note,
    };
  }

  /** Popis zahtjeva projekta. Upiti jedan za drugim (bez Promise.all na istoj transakciji). */
  async list(tx: Tx, projectId: string) {
    await loadProject(tx, projectId);
    const rows = await tx.select({ id: reimbursementClaims.id }).from(reimbursementClaims).innerJoin(reportingPeriods, eq(reportingPeriods.id, reimbursementClaims.reportingPeriodId))
      .where(eq(reimbursementClaims.projectId, projectId)).orderBy(asc(reportingPeriods.number));
    const out: Awaited<ReturnType<ClaimsService['get']>>[] = [];
    for (const r of rows) out.push(await this.get(tx, projectId, r.id));
    return out;
  }

  /** Nacrt se smije otvoriti u bilo kojem trenutku (i prije kraja razdoblja); predaja tek nakon kraja. */
  async create(tx: Tx, tenantId: string, projectId: string, input: z.infer<typeof claimInput>, actorId?: string) {
    const p = await loadProject(tx, projectId, { editable: true });
    if (p.status === 'contracting') throw new ConflictException('Projekt još nije aktivan');
    const rp = (await tx.select().from(reportingPeriods).where(and(eq(reportingPeriods.projectId, projectId), eq(reportingPeriods.number, input.period))))[0];
    if (!rp) throw new NotFoundException(`Razdoblje RP${input.period} ne postoji`);
    const partnerId = input.partnerId ?? (await selfPartner(tx, projectId)).id;
    await assertPartnerOnProject(tx, projectId, partnerId);
    const [row] = await tx.insert(reimbursementClaims).values({ tenantId, projectId, reportingPeriodId: rp.id, partnerId, createdBy: actorId, updatedBy: actorId }).returning();
    await this.audit.record(tx, { entity: 'claim', entityId: row!.id, action: 'create', diff: { meta: { period: rp.number, partnerId } } });
    return this.get(tx, projectId, row!.id);
  }

  /**
   * Predaja: popis za provjeru mora proći (razdoblje završilo ili rana predaja s razlogom; svi timesheetovi odobreni;
   * dokazi ili potvrda troškova bez dokaza; datumi u razdoblju). Pridružuje troškove (invarijanta 6), zaključava timesheetove,
   * snima izračun i upozorenja.
   */
  async submit(tx: Tx, projectId: string, id: string, input: z.infer<typeof submitInput>, actorId?: string) {
    await loadProject(tx, projectId, { editable: true });
    const { c, rp } = await this.claim(tx, projectId, id);
    if (c.status !== 'draft') throw new ConflictException(`Zahtjev je u statusu "${c.status}"`);
    const rows = await this.claimExpenses(tx, c, rp);
    const info = await this.expenseInfo(tx, projectId, rows.map((e) => e.id));
    const docs = (eid: string) => info.get(eid)?.documents ?? 0;
    const r = await this.rules(tx, projectId, c.partnerId);
    const check = await this.checklist(tx, c, rp, rows, docs, r.pkg, { earlyReason: input.earlyReason, acknowledged: input.acknowledgeWithoutEvidence });
    if (!check.canSubmit) {
      throw new ConflictException({ message: 'Zahtjev nije spreman za predaju', issues: check.blocking.map((b) => (b.details.length ? `${b.title}: ${b.details.join('; ')}` : b.title)) });
    }
    const ids = rows.map((e) => e.id);
    const now = new Date();
    await tx.update(expenses).set({ claimId: c.id, status: 'claimed', updatedAt: now, updatedBy: actorId }).where(inArray(expenses.id, ids));
    const tsIds = [...new Set(rows.map((e) => e.timesheetId).filter((x): x is string => !!x))];
    if (tsIds.length) await tx.update(timesheets).set({ status: 'locked', updatedAt: now }).where(inArray(timesheets.id, tsIds));
    const t = claimTotals(r.pkg, r.actionType, r.beneficiaryType, rows.map((e) => ({ categoryCode: e.categoryCode, amount: e.amountCents }))).claimed;
    const missing = new Set(rows.filter((e) => e.source === 'manual' && !docs(e.id)).map((e) => e.id));
    const acknowledged = rows.filter((e) => missing.has(e.id)).map((e) => ({ id: e.id, date: e.date, description: e.description, amount: e.amountCents }));
    const earlyReason = check.early ? input.earlyReason!.trim() : null;
    const earlier = rows.filter((e) => e.date < rp.startDate).map((e) => e.id);
    // Snimka popisa za provjeru kakav je bio pri predaji (stavke, upozorenja, potvrde) – ulazi u paket za predaju (kontrolna lista).
    const submission = {
      checkedOn: tenantToday(now), early: check.early, earlyReason, acknowledgedWithoutEvidence: acknowledged, earlierExpenses: earlier,
      warnings: check.warnings.map((w) => ({ key: w.key, title: w.title, details: w.details })),
      items: check.items.map((i) => ({ key: i.key, ok: i.ok, severity: i.severity, title: i.title, details: i.details })),
    };
    const preparationMinutes = input.preparationHours === undefined ? c.preparationMinutes : hoursToMinutes(input.preparationHours);
    await tx.update(reimbursementClaims).set({ revision: bump(reimbursementClaims), status: 'submitted', totals: t as unknown as Record<string, unknown>, requestedCents: t.requested, submittedAt: now, earlyReason, submission, preparationMinutes, note: null, updatedAt: now, updatedBy: actorId }).where(eq(reimbursementClaims.id, c.id));
    await this.audit.record(tx, { entity: 'claim', entityId: c.id, action: check.early ? 'submit.early' : 'submit', diff: {
      after: { requested: t.requested, expenses: ids.length, preparationMinutes },
      meta: { earlyReason, acknowledgedWithoutEvidence: acknowledged.map((a) => a.id), earlierExpenses: earlier, warnings: submission.warnings.map((w) => w.title) },
    } });
    return this.get(tx, projectId, id);
  }

  /**
   * WP1.16b: izričit odabir troškova iz ranijih razdoblja u nacrtu. Smiju se odabrati samo nepredani troškovi istog partnera
   * datirani u ranijem, već predanom razdoblju, koje nije odabrao drugi nacrt. Prazan popis poništava odabir.
   */
  async selectEarlier(tx: Tx, projectId: string, id: string, input: z.infer<typeof earlierInput>, actorId?: string) {
    await loadProject(tx, projectId, { editable: true });
    const { c, rp } = await this.claim(tx, projectId, id);
    await assertRevision(tx, reimbursementClaims, c.id, input.revision, 'Zahtjev za nadoknadu');
    if (c.status !== 'draft') throw new ConflictException('Troškovi iz ranijih razdoblja biraju se samo u nacrtu zahtjeva');
    const candidates = new Map((await this.earlierCandidates(tx, c, rp)).map((x) => [x.e.id, x]));
    const ids = [...new Set(input.expenseIds)];
    const issues: string[] = [];
    for (const eid of ids) {
      const x = candidates.get(eid);
      if (!x) issues.push(`trošak ${eid} nije nepredan trošak ranijeg razdoblja ovog partnera`);
      else if (x.selectedElsewhere !== null) issues.push(`trošak „${x.e.description}” već je odabran u nacrtu ZNS-a za RP${x.selectedElsewhere}`);
    }
    if (issues.length) throw new BadRequestException({ message: 'Odabir nije valjan', issues });
    await tx.update(reimbursementClaims).set({ revision: bump(reimbursementClaims), earlierExpenseIds: ids, updatedAt: new Date(), updatedBy: actorId }).where(eq(reimbursementClaims.id, c.id));
    await this.audit.record(tx, { entity: 'claim', entityId: c.id, action: 'earlier.select', diff: { before: { expenseIds: c.earlierExpenseIds ?? [] }, after: { expenseIds: ids } } });
    return this.get(tx, projectId, id);
  }

  /** WP1.16b: naknadni upis ili ispravak sati pripreme (samo predan ili odlučen zahtjev; u nacrtu se sati upisuju pri predaji). */
  async setPreparation(tx: Tx, projectId: string, id: string, input: z.infer<typeof preparationInput>, actorId?: string) {
    await loadProject(tx, projectId, { editable: true });
    const { c } = await this.claim(tx, projectId, id);
    if (c.status === 'draft') throw new ConflictException('Sati pripreme upisuju se pri predaji zahtjeva');
    const minutes = hoursToMinutes(input.hours);
    await tx.update(reimbursementClaims).set({ revision: bump(reimbursementClaims), preparationMinutes: minutes, updatedAt: new Date(), updatedBy: actorId }).where(eq(reimbursementClaims.id, c.id));
    await this.audit.record(tx, { entity: 'claim', entityId: c.id, action: 'preparation.update', diff: { before: { preparationMinutes: c.preparationMinutes }, after: { preparationMinutes: minutes } } });
    return this.get(tx, projectId, id);
  }

  private assertDecisionDate(c: ClaimRow, decisionDate: string, today: string): void {
    if (decisionDate > today) throw new BadRequestException({ message: 'Odluka nije valjana', issues: [`datum odluke (${decisionDate}) je u budućnosti`] });
    const submitted = c.submittedAt ? dateIn(tenantTimeZone(), c.submittedAt) : null;
    if (submitted && decisionDate < submitted) throw new BadRequestException({ message: 'Odluka nije valjana', issues: [`datum odluke (${decisionDate}) je prije predaje zahtjeva (${submitted})`] });
  }

  /** Odluka po trošku → statusi troškova, priznati iznos, ishod zahtjeva. Zajedničko za odluku i ispravak. */
  private async applyDecision(tx: Tx, c: ClaimRow, rows: ExpenseRow[], input: { decisions: { id: string; recognised: number; reason?: string | null }[]; funderTotal?: number | null; note?: string | null; decisionDate: string }, actorId?: string) {
    const r = await this.rules(tx, c.projectId, c.partnerId);
    const d = claimDecision(r.pkg, r.actionType, r.beneficiaryType, {
      expenses: rows.map((e) => ({ id: e.id, categoryCode: e.categoryCode, amount: e.amountCents })),
      decisions: input.decisions, requested: c.requestedCents ?? 0, funderTotal: input.funderTotal, note: input.note,
    });
    if (d.errors.length) throw new BadRequestException({ message: 'Odluka nije valjana', issues: d.errors });
    const now = new Date();
    const before = new Map(rows.map((e) => [e.id, e]));
    for (const x of d.expenses) {
      const e = before.get(x.id)!;
      if (e.status === x.status && e.recognisedCents === x.recognised && e.decisionReason === x.reason) continue;
      await tx.update(expenses).set({ status: x.status, recognisedCents: x.recognised, decisionReason: x.reason, updatedAt: now, updatedBy: actorId }).where(eq(expenses.id, x.id));
    }
    const decision = { computed: d.computed, funderTotal: d.funderTotal, difference: d.difference, claimed: d.claimed, recognised: d.recognised, unrecognised: d.unrecognised, ratePercent: d.ratePercent };
    await tx.update(reimbursementClaims).set({ revision: bump(reimbursementClaims), status: d.outcome, approvedCents: d.approved, decidedAt: now, decisionDate: input.decisionDate, decision, note: input.note?.trim() || null, updatedAt: now, updatedBy: actorId }).where(eq(reimbursementClaims.id, c.id));
    return d;
  }

  /**
   * Pregled odluke bez spremanja: isti izračun kao odluka (priznato, nepriznato, razlika prema iznosu financijera, ishod, greške).
   * Za predan zahtjev (odluka) ili odlučen, neisplaćen zahtjev (ispravak – nenavedeni troškovi ostaju kako su odlučeni).
   */
  async previewDecision(tx: Tx, projectId: string, id: string, input: z.infer<typeof previewInput>) {
    await loadProject(tx, projectId);
    const { c } = await this.claim(tx, projectId, id);
    if (c.status !== 'submitted' && !(DECIDED as readonly string[]).includes(c.status)) throw new ConflictException('Pregled odluke postoji samo za predan ili odlučen zahtjev');
    const rows = await tx.select().from(expenses).where(eq(expenses.claimId, c.id));
    assertMayDecidePersonnel(projectId, personnelIds(rows), input.expenses);
    const merged = new Map(rows.map((e) => [e.id, { id: e.id, recognised: e.recognisedCents ?? e.amountCents, reason: e.decisionReason }]));
    for (const x of input.expenses ?? []) merged.set(x.id, { id: x.id, recognised: x.recognised, reason: x.reason ?? null });
    const r = await this.rules(tx, projectId, c.partnerId);
    const d = claimDecision(r.pkg, r.actionType, r.beneficiaryType, {
      expenses: rows.map((e) => ({ id: e.id, categoryCode: e.categoryCode, amount: e.amountCents })),
      decisions: [...merged.values()], requested: c.requestedCents ?? 0, funderTotal: input.funderTotal, note: input.note,
    });
    return { outcome: d.outcome, claimed: d.claimed, recognised: d.recognised, unrecognised: d.unrecognised, computed: d.computed, funderTotal: d.funderTotal, approved: d.approved, difference: d.difference, errors: d.errors };
  }

  async decide(tx: Tx, projectId: string, id: string, input: z.infer<typeof decisionInput>, actorId?: string) {
    await loadProject(tx, projectId, { editable: true });
    const { c } = await this.claim(tx, projectId, id);
    if (c.status !== 'submitted') throw new ConflictException(`Odluka se donosi samo za predan zahtjev (trenutno "${c.status}")`);
    const now = new Date();
    if (input.decision === 'returned') {
      // Povrat na dopunu: troškovi i timesheetovi se otključavaju (dokazi se mogu dopuniti); ponovna predaja ponovno prolazi popis za provjeru.
      const rows = await tx.select({ id: expenses.id, ts: expenses.timesheetId }).from(expenses).where(eq(expenses.claimId, c.id));
      await tx.update(expenses).set({ claimId: null, status: 'recorded', updatedAt: now, updatedBy: actorId }).where(eq(expenses.claimId, c.id));
      const tsIds = [...new Set(rows.map((r) => r.ts).filter((x): x is string => !!x))];
      if (tsIds.length) await tx.update(timesheets).set({ status: 'approved', updatedAt: now }).where(inArray(timesheets.id, tsIds));
      await tx.update(reimbursementClaims).set({ revision: bump(reimbursementClaims), status: 'draft', totals: null, requestedCents: null, submittedAt: null, earlyReason: null, submission: null, note: input.note, updatedAt: now, updatedBy: actorId }).where(eq(reimbursementClaims.id, c.id));
      await this.audit.record(tx, { entity: 'claim', entityId: c.id, action: 'decision.returned', diff: { before: { requested: c.requestedCents, submission: c.submission }, meta: { note: input.note } } });
      return this.get(tx, projectId, id);
    }
    const today = tenantToday(now);
    const decisionDate = input.decisionDate ?? today;
    this.assertDecisionDate(c, decisionDate, today);
    const rows = await tx.select().from(expenses).where(eq(expenses.claimId, c.id));
    assertMayDecidePersonnel(projectId, personnelIds(rows), input.expenses);
    const d = await this.applyDecision(tx, c, rows, { decisions: input.expenses ?? [], funderTotal: input.funderTotal, note: input.note, decisionDate }, actorId);
    await this.audit.record(tx, { entity: 'claim', entityId: c.id, action: `decision.${d.outcome}`, diff: {
      after: { status: d.outcome, approved: d.approved, computed: d.computed, funderTotal: d.funderTotal, decisionDate },
      meta: { note: input.note ?? null, reduced: d.expenses.filter((x) => x.status !== 'accepted').map((x) => ({ id: x.id, amount: x.amount, recognised: x.recognised, reason: x.reason })) },
    } });
    return this.get(tx, projectId, id);
  }

  /**
   * Ispravak odluke (namjerni, revidirani put): samo za odlučen, još neisplaćen zahtjev, uz obavezan razlog.
   * Baza dopušta promjenu priznatog iznosa samo kad transakcija najavi ovaj zahtjev (`app.claim_correction`) i sama
   * upisuje revizijski zapis za svaki promijenjeni trošak (okidač `expenses_immutable_trg`, migracija 0021).
   */
  async correct(tx: Tx, projectId: string, id: string, input: z.infer<typeof correctionInput>, actorId?: string) {
    await loadProject(tx, projectId, { editable: true });
    const { c } = await this.claim(tx, projectId, id);
    if (!(DECIDED as readonly string[]).includes(c.status)) throw new ConflictException('Ispravlja se samo odluka o odlučenom zahtjevu');
    if (c.paidCents !== null) throw new ConflictException('Zahtjev je isplaćen – odluka se više ne ispravlja');
    const today = tenantToday();
    const decisionDate = input.decisionDate ?? c.decisionDate ?? today;
    this.assertDecisionDate(c, decisionDate, today);
    const rows = await tx.select().from(expenses).where(eq(expenses.claimId, c.id));
    assertMayDecidePersonnel(projectId, personnelIds(rows), input.expenses);
    const merged = new Map(rows.map((e) => [e.id, { id: e.id, recognised: e.recognisedCents ?? e.amountCents, reason: e.decisionReason }]));
    for (const x of input.expenses ?? []) {
      if (!merged.has(x.id)) throw new BadRequestException({ message: 'Odluka nije valjana', issues: [`trošak ${x.id} nije u zahtjevu`] });
      merged.set(x.id, { id: x.id, recognised: x.recognised, reason: x.reason ?? null });
    }
    const previous = { status: c.status, approved: c.approvedCents, decisionDate: c.decisionDate, note: c.note };
    await tx.execute(sql`select set_config('app.claim_correction', ${c.id}, true)`);
    const d = await this.applyDecision(tx, c, rows, { decisions: [...merged.values()], funderTotal: input.funderTotal === undefined ? ((c.decision as { funderTotal?: number | null } | null)?.funderTotal ?? null) : input.funderTotal, note: input.note, decisionDate }, actorId);
    await tx.execute(sql`select set_config('app.claim_correction', '', true)`);
    await this.audit.record(tx, { entity: 'claim', entityId: c.id, action: 'decision.correct', diff: { before: previous, after: { status: d.outcome, approved: d.approved, computed: d.computed, decisionDate }, meta: { note: input.note } } });
    return this.get(tx, projectId, id);
  }

  /** Isplata: datum ne prije odluke i ne u budućnosti; razlika prema odobrenom traži napomenu. */
  async pay(tx: Tx, projectId: string, id: string, input: z.infer<typeof paymentInput>, actorId?: string) {
    await loadProject(tx, projectId, { editable: true });
    const { c } = await this.claim(tx, projectId, id);
    if (!['approved', 'partially_approved'].includes(c.status)) throw new ConflictException('Isplata se bilježi samo za odobren zahtjev');
    if (c.paidCents !== null) throw new ConflictException('Isplata je već zabilježena');
    const decisionDate = c.decisionDate ?? (c.decidedAt ? dateIn(tenantTimeZone(), c.decidedAt) : null);
    const issues = paymentIssues({ paidAt: input.paidAt, paidAmount: input.paidAmount, decisionDate, approved: c.approvedCents, today: tenantToday(), note: input.note });
    if (issues.length) throw new BadRequestException({ message: 'Isplata nije valjana', issues });
    await tx.update(reimbursementClaims).set({ revision: bump(reimbursementClaims), paidCents: input.paidAmount, paidAt: input.paidAt, paymentNote: input.note?.trim() || null, updatedAt: new Date(), updatedBy: actorId }).where(eq(reimbursementClaims.id, c.id));
    await this.audit.record(tx, { entity: 'claim', entityId: c.id, action: 'payment', diff: { after: input, meta: { approved: c.approvedCents, difference: input.paidAmount - (c.approvedCents ?? 0) } } });
    return this.get(tx, projectId, id);
  }
}

