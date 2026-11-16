/** M5 Prijava: životni ciklus i provjera spremnosti za predaju (domenski model, odj. 3; ADR-0006). Čiste funkcije. */

export type ProposalStatus = 'idea' | 'preparation' | 'internal_review' | 'submitted' | 'in_evaluation' | 'funded' | 'reserve' | 'rejected' | 'withdrawn' | 'contracted';

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  idea: 'ideja', preparation: 'u pripremi', internal_review: 'interna provjera', submitted: 'predana', in_evaluation: 'u evaluaciji',
  funded: 'financirana', reserve: 'rezervna lista', rejected: 'odbijena', withdrawn: 'povučena', contracted: 'ugovorena',
};

/** Ručni prijelazi; predaja, ishod i ugovaranje imaju vlastite radnje s dodatnim provjerama. */
export const PROPOSAL_TRANSITIONS: Readonly<Record<ProposalStatus, readonly ProposalStatus[]>> = {
  idea: ['preparation', 'withdrawn'],
  preparation: ['internal_review', 'withdrawn'],
  internal_review: ['preparation', 'withdrawn'],
  submitted: ['in_evaluation', 'withdrawn'],
  in_evaluation: ['withdrawn'],
  funded: ['withdrawn'],
  reserve: ['withdrawn'],
  rejected: [], withdrawn: [], contracted: [],
};

/** Struktura i proračun mijenjaju se samo dok se prijava priprema. */
export const isProposalEditable = (s: ProposalStatus): boolean => s === 'idea' || s === 'preparation';
export const OUTCOME_FROM: readonly ProposalStatus[] = ['submitted', 'in_evaluation', 'reserve'];

export interface ReadinessFacts {
  members: { country: string; confirmed: boolean }[];
  minPartners?: number;
  minCountries?: number;
  workPackages: number;
  budgetTotal: number;
  budgetLocked: boolean;
  hasLead: boolean;
  /** null = prijava nije vezana uz poziv s radara */
  callOpen: boolean | null;
}
export interface ReadinessItem { key: string; label: string; ok: boolean }

export function proposalReadiness(f: ReadinessFacts): ReadinessItem[] {
  const countries = new Set(f.members.map((m) => m.country)).size;
  const minP = f.minPartners ?? 1, minC = f.minCountries ?? 1;
  const items: ReadinessItem[] = [
    { key: 'consortium', label: `Konzorcij: najmanje ${minP} partnera iz ${minC} država (sada ${f.members.length} iz ${countries})`, ok: f.members.length >= minP && countries >= minC },
    { key: 'confirmed', label: 'Svi članovi konzorcija potvrdili sudjelovanje', ok: f.members.length > 0 && f.members.every((m) => m.confirmed) },
    { key: 'work_packages', label: 'Barem jedan radni paket', ok: f.workPackages > 0 },
    { key: 'budget', label: 'Proračun unesen', ok: f.budgetTotal > 0 },
    { key: 'budget_locked', label: 'Proračun zaključan', ok: f.budgetLocked },
    { key: 'lead', label: 'Voditelj prijave određen', ok: f.hasLead },
  ];
  if (f.callOpen !== null) items.push({ key: 'call_open', label: 'Poziv je otvoren za predaju', ok: f.callOpen });
  return items;
}
export const isReady = (items: ReadinessItem[]): boolean => items.every((i) => i.ok);
