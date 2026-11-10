import { ConflictException, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { Tx } from '../db/db.service';
import { projectPartners, projects, type Project } from '../db/schema';

/** Projekt pod RLS-om (tuđi = 404). `editable` odbija zatvorene/prekinute/arhivirane projekte. */
export async function loadProject(tx: Tx, id: string, opts: { editable?: boolean } = {}): Promise<Project> {
  const p = (await tx.select().from(projects).where(and(eq(projects.id, id), isNull(projects.deletedAt))))[0];
  if (!p) throw new NotFoundException(`Projekt ${id} ne postoji`);
  if (opts.editable && ['closed', 'terminated', 'archived'].includes(p.status)) throw new ConflictException(`Projekt u statusu "${p.status}" se ne mijenja`);
  return p;
}

/** Partner mora pripadati upravo ovom projektu (kompozitni FK jamči samo isti stanar). */
export async function assertPartnerOnProject(tx: Tx, projectId: string, partnerId: string | null | undefined): Promise<void> {
  if (!partnerId) return;
  const r = await tx.select({ id: projectPartners.id }).from(projectPartners).where(and(eq(projectPartners.id, partnerId), eq(projectPartners.projectId, projectId)));
  if (!r.length) throw new NotFoundException(`Partner ${partnerId} nije na projektu`);
}
