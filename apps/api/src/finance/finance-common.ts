import { ConflictException, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
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
