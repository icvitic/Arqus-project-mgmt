import { sql, type SQL } from 'drizzle-orm';
import { notSelectedInDraft, strandedExpense } from '../finance/finance-common';
import type { ProjectStatusCol, ProposalStatusCol } from '../db/schema';

/**
 * WP1.18 – zajedničke definicije činjenica za portfelj (WP1.15) i „Moj rad”: ista stvar se na dva zaslona ne smije brojati
 * različito. Izrazi se ugrađuju u upit nad tablicom `projects` (podupiti po "projects"."id") ili `reporting_periods`.
 */

/** Projekti za koje se prikazuju rokovi i upozorenja (nisu zatvoreni, prekinuti ni arhivirani). */
export const OPEN_PROJECT_STATUSES: ProjectStatusCol[] = ['contracting', 'active', 'suspended', 'closing'];
/** Projekt „u provedbi”: troškovi i timesheetovi se smiju evidentirati. */
export const RUNNING_PROJECT_STATUSES: ProjectStatusCol[] = ['active', 'suspended', 'closing'];
/** Isporuka koja još nije predana ni prihvaćena (kasni ako je prošao kraj mjeseca roka). */
export const OPEN_DELIVERABLE_STATUSES = ['planned', 'in_progress', 'rejected'] as const;
/** WP1.22: zadatak koji još nije gotov ni otkazan (stavka odgovorne osobe kad mu se približi završni mjesec). */
export const OPEN_TASK_STATUSES = ['planned', 'in_progress'] as const;
/** Prekretnica koja još nije postignuta. */
export const OPEN_MILESTONE_STATUSES = ['planned'] as const;
/** Prijava u pripremi (interni rok je relevantan). */
export const OPEN_PROPOSAL_STATUSES: ProposalStatusCol[] = ['idea', 'preparation', 'internal_review'];

/** Visok otvoren rizik: otvoren ili nastupio, vjerojatnost × utjecaj ≥ 6. */
export const highRisksCount: SQL<number> = sql<number>`(select count(*)::int from risks r where r.project_id = "projects"."id" and r.deleted_at is null and r.status in ('open','occurred') and r.likelihood * r.impact >= 6)`;
/** Predani timesheetovi na odobrenju (svi – četiri oka primjenjuje „Moj rad” po korisniku). */
export const timesheetsToApproveCount: SQL<number> = sql<number>`(select count(*)::int from timesheets t where t.project_id = "projects"."id" and t.status = 'submitted')`;
/**
 * Ručno uneseni troškovi bez dokaza (trošak osoblja dokazuje se timesheetom; trošak potraživan izvan sustava nije otvorena
 * stavka). `visibleOnly` – povjerljiv dokaz se ne broji (korisnik bez `documents:confidential` ga ne vidi, WP1.14).
 */
export const withoutEvidenceCount = (visibleOnly: boolean): SQL<number> => sql<number>`(select count(*)::int from expenses e where e.project_id = "projects"."id" and e.source = 'manual' and e.status not in ('rejected', 'historic')
  and not exists (select 1 from documents d where d.entity_type = 'expense' and d.entity_id = e.id and d.deleted_at is null${visibleOnly ? sql` and d.confidentiality <> 'confidential'` : sql``}))`;
/** WP1.16b: nepredani troškovi iz ranijih razdoblja (razdoblje već predano, trošak nije odabran ni u jednom nacrtu). */
export const strandedCount: SQL<number> = sql<number>`(select count(*)::int from expenses e where e.project_id = "projects"."id" and ${strandedExpense('e')} and ${notSelectedInDraft('e')})`;
/**
 * Razdoblje je „predano”: postoji ZNS vlastite organizacije koji nije nacrt, ili (WP1.17) trošak vlastite organizacije
 * potraživan izvan sustava datiran u razdoblju. Izraz nad tablicom `reporting_periods`.
 */
export const periodSubmitted: SQL<boolean> = sql<boolean>`(exists (select 1 from reimbursement_claims c join project_partners pp on pp.id = c.partner_id join organisations o on o.id = pp.organisation_id
  where c.reporting_period_id = "reporting_periods"."id" and o.is_self and c.status <> 'draft')
  or exists (select 1 from expenses he join project_partners pp on pp.id = he.partner_id join organisations o on o.id = pp.organisation_id
  where he.project_id = "reporting_periods"."project_id" and o.is_self and he.status = 'historic' and he.date between "reporting_periods"."start_date" and "reporting_periods"."end_date"))`;
