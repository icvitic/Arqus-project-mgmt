import { ConflictException, NotFoundException } from '@nestjs/common';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../db/db.service';
import { organisations, projectPartners, type Project } from '../db/schema';
import { addDays, addMonths } from '@arqus/domain';

/** Troškovi se evidentiraju samo dok projekt traje (aktivan, obustavljen, u završetku). */
export function assertSpendable(p: Project): void {
  if (!['active', 'suspended', 'closing'].includes(p.status)) throw new ConflictException(`Troškovi se ne evidentiraju za projekt u statusu "${p.status}"`);
}

export function projectEnd(p: Project): string | null {
  return p.startDate && p.durationMonths ? addDays(addMonths(p.startDate, p.durationMonths), -1) : null;
}

export async function selfPartner(tx: Tx, projectId: string) {
  const r = (await tx.select({ id: projectPartners.id, beneficiaryType: projectPartners.beneficiaryType }).from(projectPartners)
    .innerJoin(organisations, eq(organisations.id, projectPartners.organisationId))
    .where(and(eq(projectPartners.projectId, projectId), eq(organisations.isSelf, true))))[0];
  if (!r) throw new NotFoundException('Vlastita organizacija nije partner na projektu');
  return r;
}

/**
 * WP1.16b – nepredan trošak iz ranijeg razdoblja: evidentiran, nije u zahtjevu, a datiran je u razdoblju za koje je ZNS
 * istog partnera već predan (nije nacrt). Takav trošak više ne ulazi automatski ni u jedan zahtjev; nacrt kasnijeg
 * razdoblja ga nudi kao „trošak iz ranijih razdoblja” (`docs/domena/zns-pravila.md`). `alias` – naziv tablice troškova u upitu.
 */
export const strandedExpense = (alias = 'expenses'): SQL => sql.raw(`("${alias}".status = 'recorded' and "${alias}".claim_id is null and exists (
  select 1 from reimbursement_claims sc join reporting_periods srp on srp.id = sc.reporting_period_id
  where sc.project_id = "${alias}".project_id and sc.partner_id = "${alias}".partner_id and sc.status <> 'draft' and "${alias}".date between srp.start_date and srp.end_date))`);

/** Trošak koji nije izričito uključen ni u jedan nacrt zahtjeva (signal „nepredani troškovi” broji samo takve). */
export const notSelectedInDraft = (alias = 'expenses'): SQL => sql.raw(`(not exists (select 1 from reimbursement_claims dc
  where dc.project_id = "${alias}".project_id and dc.status = 'draft' and "${alias}".id = any(dc.earlier_expense_ids)))`);
