import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  daysBetween, extensionIsLate, subjectRequestDue, subjectRequestRef, subjectRequestState,
  SUBJECT_REQUEST_CHANNELS, SUBJECT_REQUEST_KINDS, SUBJECT_REQUEST_OUTCOMES,
  type SubjectRequestFact, type SubjectRequestKind, type SubjectRequestOutcome,
} from '@arqus/domain';
import type { Tx } from '../db/db.service';
import { subjectRequests, tenants, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { TenantContext, tenantToday } from '../common/tenant-context';
import { assertRevision, bump, revisionField } from '../common/revision';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'datum u obliku GGGG-MM-DD').refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s, 'datum ne postoji');
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
/** GDPR se primjenjuje od 25. 5. 2018. – raniji dan zaprimanja je greška u unosu. */
const GDPR_START = '2018-05-25';

const baseFields = {
  receivedOn: isoDate,
  kind: z.enum(SUBJECT_REQUEST_KINDS),
  channel: z.enum(SUBJECT_REQUEST_CHANNELS),
  requesterName: z.string().trim().min(2, 'ime podnositelja ima najmanje 2 znaka').max(200),
  requesterContact: optionalText(300),
  subjectUserId: z.string().uuid().nullable().optional().transform((v) => v ?? null),
  description: optionalText(2000),
  identityVerifiedOn: isoDate.nullable().optional().transform((v) => v ?? null),
};
export const subjectRequestCreateInput = z.object(baseFields).strict();
export const subjectRequestUpdateInput = z.object({ ...baseFields, revision: revisionField }).strict();
export const subjectRequestExtendInput = z.object({
  informedOn: isoDate,
  reason: z.string().trim().min(10, 'razlog produljenja ima najmanje 10 znakova').max(1000),
  revision: revisionField,
}).strict();
export const subjectRequestCloseInput = z.object({
  closedOn: isoDate,
  outcome: z.enum(SUBJECT_REQUEST_OUTCOMES),
  note: optionalText(2000),
  revision: revisionField,
}).strict();
export const subjectRequestRevisionInput = z.object({ revision: revisionField }).strict();

type BaseInput = z.infer<typeof subjectRequestCreateInput>;
type RequestRow = typeof subjectRequests.$inferSelect;

/** Ishodi koji traže obrazloženje: ispitanik ima pravo znati zašto zahtjevu nije (u cijelosti) udovoljeno (čl. 12(4)). */
const NOTE_REQUIRED: SubjectRequestOutcome[] = ['partly_fulfilled', 'refused'];

/**
 * WP1.24 – evidencija zahtjeva ispitanika (čl. 12(3) GDPR-a): tko je i kada podnio zahtjev, na koje se pravo odnosi, rok za
 * odgovor (mjesec dana, uz produljenje tri) i ishod. Zahtjev se ne briše kroz API – zatvoreni zahtjevi brišu se poslom
 * čuvanja po isteku roka kategorije `subjectRequests`. Revizijski zapis bilježi radnju i rokove, nikad ime podnositelja
 * ni slobodni tekst (revizija se čuva dulje od same evidencije).
 */
@Injectable()
export class SubjectRequestsService {
  constructor(private readonly audit: AuditService, private readonly ctx: TenantContext) {}

  private async present(tx: Tx, list: RequestRow[]) {
    const today = tenantToday();
    const ids = [...new Set(list.map((r) => r.subjectUserId).filter((x): x is string => !!x))];
    const people = ids.length ? await tx.select({ id: users.id, displayName: users.displayName, email: users.email, status: users.status }).from(users).where(inArray(users.id, ids)) : [];
    const byId = new Map(people.map((u) => [u.id, u]));
    return list.map((r) => {
      const state = subjectRequestState({ dueOn: r.dueOn, closedOn: r.closedOn }, today);
      return {
        id: r.id, number: r.number, ref: subjectRequestRef(r.number), receivedOn: r.receivedOn, kind: r.kind as SubjectRequestKind, channel: r.channel,
        requesterName: r.requesterName, requesterContact: r.requesterContact, subjectUser: r.subjectUserId ? byId.get(r.subjectUserId) ?? null : null,
        description: r.description, identityVerifiedOn: r.identityVerifiedOn,
        extension: r.extensionInformedOn ? { informedOn: r.extensionInformedOn, reason: r.extensionReason, late: extensionIsLate(r.receivedOn, r.extensionInformedOn) } : null,
        baseDueOn: subjectRequestDue(r.receivedOn, false), dueOn: r.dueOn, daysLeft: r.status === 'open' ? daysBetween(today, r.dueOn) : null,
        status: r.status, state, outcome: r.outcome as SubjectRequestOutcome | null, closedOn: r.closedOn, outcomeNote: r.outcomeNote,
        revision: r.revision, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  private async one(tx: Tx, id: string): Promise<RequestRow> {
    const r = (await tx.select().from(subjectRequests).where(eq(subjectRequests.id, id)))[0];
    if (!r) throw new NotFoundException('Zahtjev ispitanika ne postoji');
    return r;
  }

  /** Zahtjev za izmjenu: nepostojeći (ili tuđi – RLS) → 404; zatim provjera revizije uz zaključavanje retka i svježe čitanje. */
  private async locked(tx: Tx, id: string, revision: number): Promise<RequestRow> {
    await this.one(tx, id);
    await assertRevision(tx, subjectRequests, id, revision, 'Zahtjev ispitanika');
    return this.one(tx, id);
  }

  private async view(tx: Tx, id: string) { return (await this.present(tx, [await this.one(tx, id)]))[0]!; }

  /** Popis: otvoreni po roku (najraniji prvi), zatim zatvoreni (najnoviji prvi), uz zbroj po stanju. */
  async list(tx: Tx) {
    const open = await tx.select().from(subjectRequests).where(eq(subjectRequests.status, 'open')).orderBy(asc(subjectRequests.dueOn), asc(subjectRequests.number));
    const closed = await tx.select().from(subjectRequests).where(eq(subjectRequests.status, 'closed')).orderBy(desc(subjectRequests.closedOn), desc(subjectRequests.number)).limit(500);
    const items = await this.present(tx, [...open, ...closed]);
    const count = (s: string) => items.filter((i) => i.state === s).length;
    return {
      today: tenantToday(), items,
      summary: { open: open.length, overdue: count('overdue'), dueSoon: count('due_soon'), closed: closed.length, closedLate: count('closed_late') },
    };
  }

  private async checkBase(tx: Tx, i: BaseInput): Promise<void> {
    const today = tenantToday();
    const issues: { path: string; message: string }[] = [];
    if (i.receivedOn > today) issues.push({ path: '/receivedOn', message: 'dan zaprimanja ne može biti u budućnosti' });
    if (i.receivedOn < GDPR_START) issues.push({ path: '/receivedOn', message: 'dan zaprimanja je prije početka primjene GDPR-a (25. 5. 2018.)' });
    if (i.identityVerifiedOn && (i.identityVerifiedOn < i.receivedOn || i.identityVerifiedOn > today)) issues.push({ path: '/identityVerifiedOn', message: 'dan utvrđivanja identiteta je između dana zaprimanja i danas' });
    if (i.subjectUserId && !(await tx.select({ id: users.id }).from(users).where(eq(users.id, i.subjectUserId))).length) issues.push({ path: '/subjectUserId', message: 'korisnički račun ne postoji' });
    if (issues.length) throw new BadRequestException({ message: 'Neispravan zahtjev', issues });
  }

  async create(tx: Tx, i: BaseInput) {
    const c = this.ctx.require();
    await this.checkBase(tx, i);
    // Redni broj unutar institucije: zaključan redak institucije serijalizira istovremena upisivanja.
    await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, c.tenantId)).for('update');
    const last = (await tx.select({ number: subjectRequests.number }).from(subjectRequests).orderBy(desc(subjectRequests.number)).limit(1))[0]?.number ?? 0;
    const dueOn = subjectRequestDue(i.receivedOn, false);
    const [row] = await tx.insert(subjectRequests).values({
      tenantId: c.tenantId, number: last + 1, receivedOn: i.receivedOn, kind: i.kind, channel: i.channel, requesterName: i.requesterName, requesterContact: i.requesterContact,
      subjectUserId: i.subjectUserId, description: i.description, identityVerifiedOn: i.identityVerifiedOn, dueOn, createdBy: c.userId ?? null, updatedBy: c.userId ?? null,
    }).returning();
    await this.audit.record(tx, { entity: 'subject_request', entityId: row!.id, action: 'create', diff: { meta: { number: row!.number, kind: i.kind, channel: i.channel, receivedOn: i.receivedOn, dueOn, linkedToAccount: !!i.subjectUserId } } });
    return this.view(tx, row!.id);
  }

  /** Ispravak upisanih podataka dok je zahtjev otvoren; promjena dana zaprimanja ponovno računa rok. */
  async update(tx: Tx, id: string, i: z.infer<typeof subjectRequestUpdateInput>) {
    const c = this.ctx.require();
    const r = await this.locked(tx, id, i.revision);
    if (r.status !== 'open') throw new ConflictException('Zatvoren zahtjev se ne mijenja – najprije ga ponovno otvori');
    await this.checkBase(tx, i);
    if (r.extensionInformedOn && r.extensionInformedOn < i.receivedOn) throw new BadRequestException({ message: 'Neispravan zahtjev', issues: [{ path: '/receivedOn', message: 'dan zaprimanja je nakon dana obavijesti o produljenju – najprije poništi produljenje' }] });
    const dueOn = subjectRequestDue(i.receivedOn, !!r.extensionInformedOn);
    await tx.update(subjectRequests).set({
      receivedOn: i.receivedOn, kind: i.kind, channel: i.channel, requesterName: i.requesterName, requesterContact: i.requesterContact, subjectUserId: i.subjectUserId,
      description: i.description, identityVerifiedOn: i.identityVerifiedOn, dueOn, revision: bump(subjectRequests), updatedAt: new Date(), updatedBy: c.userId ?? null,
    }).where(eq(subjectRequests.id, id));
    await this.audit.record(tx, { entity: 'subject_request', entityId: id, action: 'update', diff: {
      before: { kind: r.kind, channel: r.channel, receivedOn: r.receivedOn, dueOn: r.dueOn, identityVerifiedOn: r.identityVerifiedOn, linkedToAccount: !!r.subjectUserId },
      after: { kind: i.kind, channel: i.channel, receivedOn: i.receivedOn, dueOn, identityVerifiedOn: i.identityVerifiedOn, linkedToAccount: !!i.subjectUserId },
      meta: { number: r.number, textChanged: r.requesterName !== i.requesterName || r.requesterContact !== i.requesterContact || r.description !== i.description },
    } });
    return this.view(tx, id);
  }

  /**
   * Produljenje roka za dva daljnja mjeseca (ukupno tri od zaprimanja). Bilježi se dan kad je ispitanik obaviješten i
   * razlog; obavijest nakon osnovnog roka sustav prihvaća, ali je označava zakašnjelom. Ponovni poziv ispravlja upisano.
   */
  async extend(tx: Tx, id: string, i: z.infer<typeof subjectRequestExtendInput>) {
    const c = this.ctx.require();
    const r = await this.locked(tx, id, i.revision);
    if (r.status !== 'open') throw new ConflictException('Zatvorenom zahtjevu rok se ne produljuje');
    const today = tenantToday();
    if (i.informedOn < r.receivedOn || i.informedOn > today) throw new BadRequestException({ message: 'Neispravan zahtjev', issues: [{ path: '/informedOn', message: 'dan obavijesti ispitaniku je između dana zaprimanja i danas' }] });
    const dueOn = subjectRequestDue(r.receivedOn, true);
    await tx.update(subjectRequests).set({ extensionInformedOn: i.informedOn, extensionReason: i.reason, dueOn, revision: bump(subjectRequests), updatedAt: new Date(), updatedBy: c.userId ?? null }).where(eq(subjectRequests.id, id));
    await this.audit.record(tx, { entity: 'subject_request', entityId: id, action: 'extend', diff: { before: { dueOn: r.dueOn }, after: { dueOn },
      meta: { number: r.number, informedOn: i.informedOn, late: extensionIsLate(r.receivedOn, i.informedOn), corrected: !!r.extensionInformedOn } } });
    return this.view(tx, id);
  }

  /** Poništava pogrešno upisano produljenje – rok se vraća na mjesec dana od zaprimanja. */
  async cancelExtension(tx: Tx, id: string, i: z.infer<typeof subjectRequestRevisionInput>) {
    const c = this.ctx.require();
    const r = await this.locked(tx, id, i.revision);
    if (r.status !== 'open') throw new ConflictException('Zatvoren zahtjev se ne mijenja – najprije ga ponovno otvori');
    if (!r.extensionInformedOn) throw new ConflictException('Rok ovog zahtjeva nije produljen');
    const dueOn = subjectRequestDue(r.receivedOn, false);
    await tx.update(subjectRequests).set({ extensionInformedOn: null, extensionReason: null, dueOn, revision: bump(subjectRequests), updatedAt: new Date(), updatedBy: c.userId ?? null }).where(eq(subjectRequests.id, id));
    await this.audit.record(tx, { entity: 'subject_request', entityId: id, action: 'extend.cancel', diff: { before: { dueOn: r.dueOn }, after: { dueOn }, meta: { number: r.number } } });
    return this.view(tx, id);
  }

  /** Zatvaranje: dan odgovora ispitaniku i ishod; djelomično udovoljenje i odbijanje traže obrazloženje. */
  async close(tx: Tx, id: string, i: z.infer<typeof subjectRequestCloseInput>) {
    const c = this.ctx.require();
    const r = await this.locked(tx, id, i.revision);
    if (r.status !== 'open') throw new ConflictException('Zahtjev je već zatvoren');
    const issues: { path: string; message: string }[] = [];
    if (i.closedOn < r.receivedOn || i.closedOn > tenantToday()) issues.push({ path: '/closedOn', message: 'dan odgovora je između dana zaprimanja i danas' });
    if (NOTE_REQUIRED.includes(i.outcome) && (!i.note || i.note.length < 5)) issues.push({ path: '/note', message: 'uz djelomično udovoljenje ili odbijanje upiši obrazloženje (najmanje 5 znakova)' });
    if (issues.length) throw new BadRequestException({ message: 'Neispravan zahtjev', issues });
    await tx.update(subjectRequests).set({ status: 'closed', outcome: i.outcome, closedOn: i.closedOn, outcomeNote: i.note, revision: bump(subjectRequests), updatedAt: new Date(), updatedBy: c.userId ?? null }).where(eq(subjectRequests.id, id));
    await this.audit.record(tx, { entity: 'subject_request', entityId: id, action: 'close', diff: { before: { status: 'open' }, after: { status: 'closed', outcome: i.outcome, closedOn: i.closedOn },
      meta: { number: r.number, dueOn: r.dueOn, late: i.closedOn > r.dueOn } } });
    return this.view(tx, id);
  }

  /** Ponovno otvaranje pogrešno zatvorenog zahtjeva; rok ostaje isti (teče od zaprimanja). */
  async reopen(tx: Tx, id: string, i: z.infer<typeof subjectRequestRevisionInput>) {
    const c = this.ctx.require();
    const r = await this.locked(tx, id, i.revision);
    if (r.status !== 'closed') throw new ConflictException('Zahtjev je otvoren');
    await tx.update(subjectRequests).set({ status: 'open', outcome: null, closedOn: null, outcomeNote: null, revision: bump(subjectRequests), updatedAt: new Date(), updatedBy: c.userId ?? null }).where(eq(subjectRequests.id, id));
    await this.audit.record(tx, { entity: 'subject_request', entityId: id, action: 'reopen', diff: { before: { status: 'closed', outcome: r.outcome, closedOn: r.closedOn }, after: { status: 'open' }, meta: { number: r.number, dueOn: r.dueOn } } });
    return this.view(tx, id);
  }
}

/** Otvoreni zahtjevi za „Moj rad” (bez imena i opisa – stavka ide i u dnevni sažetak e-poštom). */
export async function openSubjectRequestFacts(tx: Tx): Promise<SubjectRequestFact[]> {
  const list = await tx.select({ id: subjectRequests.id, number: subjectRequests.number, kind: subjectRequests.kind, dueOn: subjectRequests.dueOn, informed: subjectRequests.extensionInformedOn })
    .from(subjectRequests).where(and(eq(subjectRequests.status, 'open'))).orderBy(asc(subjectRequests.dueOn), asc(subjectRequests.number));
  return list.map((r) => ({ id: r.id, number: r.number, kind: r.kind as SubjectRequestKind, dueOn: r.dueOn, extended: !!r.informed }));
}
