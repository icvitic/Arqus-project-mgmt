import { Fragment, useCallback, useEffect, useState } from 'react';
import { api, downloadFile } from '../lib/api';
import { date, dateTime, eur, label } from '../lib/format';
import { useLoad } from '../lib/hooks';
import type { AuditEntry, AuditFacets, Me } from '../lib/types';
import { ActionButton, ErrorBox, Field, Loading } from '../ui';

/**
 * Revizija (WP1.14b): tko je što i kada promijenio u instituciji. Najnovije prvo, filtri, učitavanje starijih zapisa
 * (keyset), čitljiv prikaz „prije → poslije” i izvoz filtriranog rezultata u CSV (izvoz se bilježi u reviziju).
 * Plaće vidi samo uloga s pristupom podacima o osoblju; tajne se nikad ne prikazuju (poslužitelj ih uklanja).
 */
const PAGE = 50;

export const ENTITY: Record<string, string> = {
  project: 'projekt', project_budget: 'proračun projekta', proposal: 'prijava', timesheet: 'timesheet', team_member: 'član tima', expense: 'trošak',
  claim: 'ZNS', document: 'dokument', user: 'korisnik', role_assignment: 'dodjela uloge', organisation: 'organizacija', programme_package: 'paket programa',
  call: 'poziv', call_tracking: 'praćenje poziva', work_package: 'radni paket', task: 'zadatak', deliverable: 'isporuka', milestone: 'prekretnica', risk: 'rizik',
  tenant: 'institucija', audit: 'revizija',
};
const ACTION: Record<string, string> = {
  create: 'stvaranje', update: 'izmjena', delete: 'brisanje', transition: 'promjena statusa', submit: 'predaja', 'submit.early': 'rana predaja', approve: 'odobrenje',
  reopen: 'vraćanje u nacrt', 'login.ok': 'prijava u sustav', 'login.failed': 'neuspjela prijava', 'login.mfa_failed': 'neispravan MFA kod', logout: 'odjava',
  'password.change': 'promjena lozinke', 'password.reset': 'nova lozinka (administrator)', 'mfa.enable': 'uključen MFA', 'mfa.disable': 'isključen MFA', 'mfa.reset': 'reset MFA',
  'lines.replace': 'izmjena proračuna', 'budget.replace': 'izmjena proračuna', 'budget.lock': 'zaključavanje proračuna', 'budget.unlock': 'otključavanje proračuna',
  'member.add': 'dodan član konzorcija', 'member.update': 'izmjena člana', 'member.remove': 'uklonjen član', 'work_package.add': 'dodan radni paket', 'work_package.remove': 'uklonjen radni paket',
  'partner.add': 'dodan partner', 'partner.remove': 'uklonjen partner', grant: 'dodjela uloge', revoke: 'oduzimanje uloge', 'revoke.duplicate': 'uklonjena dvostruka dodjela', export: 'izvoz', 'export.failed': 'neuspio izvoz',
  download: 'preuzimanje', 'version.add': 'nova verzija', publish: 'objava', assess: 'ocjena prikladnosti', 'decision.go': 'odluka go', 'decision.no_go': 'odluka no-go', 'decision.watch': 'odluka: pratimo',
  'decision.returned': 'vraćen na dopunu', 'decision.approved': 'odobren', 'decision.partially_approved': 'djelomično odobren', 'decision.rejected': 'odbijen', 'decision.correct': 'ispravak odluke',
  'recognition.correct': 'ispravak priznatog iznosa', payment: 'isplata', 'earlier.select': 'odabir troškova iz ranijih razdoblja', 'preparation.update': 'sati pripreme', 'settings.update': 'postavke',
  contract: 'ugovaranje', cancel: 'otkazivanje', 'outcome.funded': 'ishod: financirana', 'outcome.reserve': 'ishod: rezervna lista', 'outcome.rejected': 'ishod: odbijena',
};
const FIELD: Record<string, string> = {
  status: 'status', title: 'naslov', acronym: 'akronim', annualCostCents: 'godišnji trošak', fullName: 'ime', role: 'uloga', active: 'aktivan', contractNo: 'broj ugovora',
  startDate: 'početak', durationMonths: 'trajanje (mj.)', managerUserId: 'voditelj', leadUserId: 'voditelj prijave', internalDeadline: 'interni rok', amount: 'iznos', recognised: 'priznato',
  requested: 'zatraženo', approved: 'odobreno', total: 'ukupno', direct: 'izravni', indirect: 'neizravni', description: 'opis', date: 'datum', displayName: 'ime', email: 'e-adresa', reason: 'razlog',
  lines: 'broj redaka', version: 'verzija', projectId: 'projekt', memberId: 'član tima', month: 'mjesec', minutes: 'minute', workPackageId: 'radni paket', expenses: 'troškovi',
  note: 'napomena', period: 'razdoblje', submittedBy: 'predao', partnerId: 'partner', categoryCode: 'kategorija', supplier: 'dobavljač', userId: 'korisnik', roles: 'uloge',
  filters: 'filtri', rows: 'redaka', truncated: 'skraćeno', organisation: 'organizacija', confirmed: 'potvrđeno', number: 'broj', decision: 'odluka', rationale: 'obrazloženje',
  computed: 'izračunato', funderTotal: 'iznos financijera', reduced: 'umanjeni troškovi', recognisedCents: 'priznato', amountCents: 'iznos', paidAmount: 'isplaćeno', paidAt: 'datum isplate',
  budgetTotal: 'ukupni proračun', portal: 'portal', reference: 'referenca', score: 'bodovi', after: 'poslije', claimBaselineHours: 'polazna mjera (h)', scores: 'ocjene', comment: 'komentar',
  sessionId: 'sesija', mfa: 'MFA', ip: 'IP adresa', expenseIds: 'troškovi', preparationMinutes: 'minute pripreme', earlyReason: 'razlog rane predaje', decisionDate: 'datum odluke',
};
const STATUS_KEY = /^(status|result|decision|outcome)$/;
const MONEY = /cents$|^(amount|recognised|requested|approved|total|direct|indirect|paidAmount|funderTotal|computed|budgetTotal|difference)$/i;
const HIDDEN = '[skriveno]';

type Flat = { key: string; value: unknown }[];
/** Ravni popis vrijednosti (`a.b.c`) za usporedbu prije/poslije. */
function flatten(v: unknown, prefix = ''): Flat {
  if (v === null || v === undefined || typeof v !== 'object') return prefix ? [{ key: prefix, value: v }] : [];
  if (Array.isArray(v)) return v.length && v.every((x) => x === null || typeof x !== 'object') ? [{ key: prefix, value: v }] : v.flatMap((x, i) => flatten(x, `${prefix}[${i + 1}]`));
  return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => flatten(x, prefix ? `${prefix}.${k}` : k));
}
const fieldLabel = (key: string) => key.split('.').map((p) => { const base = p.replace(/\[\d+\]$/, ''); return (FIELD[base] ?? base) + (p.slice(base.length)); }).join(' › ');
function show(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '–';
  if (v === HIDDEN) return 'skriveno';
  const leaf = key.split('.').pop()!.replace(/\[\d+\]$/, '');
  if (typeof v === 'number' && MONEY.test(leaf)) return eur(v);
  if (typeof v === 'boolean') return v ? 'da' : 'ne';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return date(v);
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return dateTime(v);
  if (typeof v === 'string' && STATUS_KEY.test(leaf)) return label(v);
  return Array.isArray(v) ? v.join(', ') : String(v);
}

/** Čitljiv prikaz promjene: polje, prije, poslije; zatim dodatni podaci (meta). */
export function Changes({ e }: { e: AuditEntry }) {
  const before = new Map(flatten(e.diff?.before).map((x) => [x.key, x.value]));
  const after = new Map(flatten(e.diff?.after).map((x) => [x.key, x.value]));
  const keys = [...new Set([...before.keys(), ...after.keys()])].filter((k) => JSON.stringify(before.get(k)) !== JSON.stringify(after.get(k)) || !before.size || !after.size);
  const meta = flatten(e.diff?.meta);
  if (!keys.length && !meta.length) return <span className="muted">bez pojedinosti</span>;
  const cls = (v: unknown, base: string) => (v === HIDDEN ? `${base} hidden` : base);
  return (
    <>
      {keys.length > 0 && (
        <div className="audit-changes">
          <span className="h">polje</span><span className="h">prije</span><span className="h">poslije</span>
          {keys.map((k) => <Fragment key={k}><b>{fieldLabel(k)}</b><span className={cls(before.get(k), before.has(k) && after.has(k) ? 'before' : '')}>{before.has(k) ? show(k, before.get(k)) : ''}</span><span className={cls(after.get(k), '')}>{after.has(k) ? show(k, after.get(k)) : ''}</span></Fragment>)}
        </div>
      )}
      {meta.length > 0 && (
        <div className="audit-changes">
          {meta.map((m) => <Fragment key={m.key}><b>{fieldLabel(m.key)}</b><span className={cls(m.value, '')} style={{ gridColumn: 'span 2' }}>{show(m.key, m.value)}</span></Fragment>)}
        </div>
      )}
    </>
  );
}

const EMPTY = { from: '', to: '', actorId: '', entity: '', entityId: '', action: '' };
type Filters = typeof EMPTY;
const query = (f: Filters) => Object.entries(f).filter(([, v]) => v.trim()).map(([k, v]) => `${k}=${encodeURIComponent(v.trim())}`).join('&');

export function AuditLog({ me }: { me: Me }) {
  const facets = useLoad(() => api<AuditFacets>('GET', '/audit/facets'), []);
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [rows, setRows] = useState<AuditEntry[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const load = useCallback(async (f: Filters, before?: number) => {
    setError(null);
    try {
      const q = [query(f), `limit=${PAGE}`, before ? `before=${before}` : ''].filter(Boolean).join('&');
      const page = await api<AuditEntry[]>('GET', `/audit?${q}`);
      setRows((r) => (before && r ? [...r, ...page] : page)); setMore(page.length === PAGE);
    } catch (e) { setError(e); if (!before) setRows([]); }
  }, []);
  useEffect(() => { void load(filters); }, [filters, load]);
  const set = (k: keyof Filters) => (e: { target: { value: string } }) => setDraft({ ...draft, [k]: e.target.value });
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const seesSalary = me.permissions.includes('*') || me.permissions.includes('personnel:read');
  return (
    <>
      <h1>Revizija</h1>
      <p className="sub">Tko je što i kada promijenio u instituciji – odluke, proračuni, timesheetovi, ZNS, korisnici i uloge. Zapisi se ne mogu mijenjati ni brisati. {seesSalary ? 'Iznosi plaća su vidljivi jer imaš pristup podacima o osoblju.' : 'Iznosi plaća i iz njih izvedeni troškovi osoblja su skriveni (potreban pristup podacima o osoblju).'}</p>
      <div className="card">
        <form className="audit-filters" aria-label="Filtri revizije" onSubmit={(e) => { e.preventDefault(); setOpen(new Set()); setFilters({ ...draft }); }}>
          <Field label="Od datuma"><input type="date" value={draft.from} onChange={set('from')} /></Field>
          <Field label="Do datuma"><input type="date" value={draft.to} onChange={set('to')} min={draft.from || undefined} /></Field>
          <Field label="Korisnik"><select value={draft.actorId} onChange={set('actorId')}><option value="">svi</option>{facets.data?.actors.map((a) => <option key={a.id} value={a.id}>{a.displayName}</option>)}</select></Field>
          <Field label="Vrsta zapisa"><select value={draft.entity} onChange={set('entity')}><option value="">sve</option>{facets.data?.entities.map((x) => <option key={x} value={x}>{ENTITY[x] ?? x}</option>)}</select></Field>
          <Field label="Id zapisa" hint="npr. id projekta ili prijave"><input value={draft.entityId} onChange={set('entityId')} placeholder="id" /></Field>
          <Field label="Radnja"><select value={draft.action} onChange={set('action')}><option value="">sve</option>{facets.data?.actions.map((x) => <option key={x} value={x}>{ACTION[x] ?? x}</option>)}</select></Field>
          <div className="actions" style={{ gridColumn: '1/-1' }}>
            <button className="primary" type="submit">Primijeni filtre</button>
            <button type="button" onClick={() => { setDraft(EMPTY); setFilters(EMPTY); }}>Očisti</button>
            <ActionButton onClick={() => downloadFile(`/audit/export.csv${query(filters) ? `?${query(filters)}` : ''}`, 'revizija.csv')}>Izvoz u CSV</ActionButton>
            <span className="muted">CSV sadrži sve zapise prema primijenjenim filtrima (UTF-8, odvojeno „;”); izvoz se bilježi u reviziju.</span>
          </div>
        </form>
        <ErrorBox error={facets.error} />
      </div>
      <div className="card scroll">
        <ErrorBox error={error} />
        {!rows ? <Loading what="reviziju" /> : rows.length === 0 ? <p className="muted">Nema zapisa za odabrane filtre.</p> : (
          <table className="audit-table">
            <thead><tr><th>Vrijeme</th><th>Korisnik</th><th>Zapis</th><th>Radnja</th><th>Promjena</th></tr></thead>
            <tbody>{rows.map((e) => (
              <Fragment key={e.id}>
                <tr>
                  <td className="when">{dateTime(e.at)}</td>
                  <td>{e.actor?.displayName ?? (e.actorType === 'system' ? <span className="muted">sustav</span> : '–')}{e.ip && <small className="muted">{e.ip}</small>}</td>
                  <td>{ENTITY[e.entity] ?? e.entity}{e.entityId && <small className="muted break" title={e.entityId}>{e.entityId.length > 13 ? `${e.entityId.slice(0, 8)}…` : e.entityId}</small>}</td>
                  <td title={e.action}>{ACTION[e.action] ?? e.action}{e.redacted && <> <span className="chip warn" title="dio vrijednosti skriven – plaće">skriveno</span></>}</td>
                  <td>{e.diff ? <button className="link" aria-expanded={open.has(e.id)} onClick={() => toggle(e.id)}>{open.has(e.id) ? 'Sakrij' : 'Prikaži prije / poslije'}</button> : <span className="muted">–</span>}</td>
                </tr>
                {open.has(e.id) && <tr><td colSpan={5}><div className="sub-panel"><Changes e={e} /></div></td></tr>}
              </Fragment>
            ))}</tbody>
          </table>
        )}
        {rows && more && <div className="actions"><ActionButton onClick={() => load(filters, rows[rows.length - 1]!.id)}>Učitaj starije zapise</ActionButton></div>}
      </div>
    </>
  );
}
