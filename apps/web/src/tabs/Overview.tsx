import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { date, label, TRANSITIONS } from '../lib/format';
import { useLoad } from '../lib/hooks';
import type { Organisation } from '../lib/types';
import { ActionButton, ActionForm, ConflictNotice, Field, conflictOf, isConflict, type Conflict } from '../ui';
import type { Deviation } from '../lib/types';
import { can, type TabProps } from '../pages/ProjectDetail';

const ROLE: Record<string, string> = { coordinator: 'koordinator', partner: 'partner', associated: 'pridruženi', third_party: 'treća strana' };

export function Overview({ project: p, me, reloadProject }: TabProps) {
  const write = can(me, 'projects:write', p.id) && !['closed', 'terminated', 'archived'].includes(p.status);
  const contracting = p.status === 'contracting';
  const [f, setF] = useState({ contractNo: p.contractNo ?? '', startDate: p.startDate ?? '', durationMonths: p.durationMonths ? String(p.durationMonths) : '', title: p.title });
  const orgs = useLoad(() => (contracting && write ? api<Organisation[]>('GET', '/organisations') : Promise.resolve([] as Organisation[])), [contracting, write]);
  const [newPartner, setNewPartner] = useState({ organisationId: '', role: 'partner' });
  const [conflict, setConflict] = useState<Conflict<typeof f> | null>(null);
  // Nova revizija projekta (vlastito spremanje ili učitano tuđe) → obrazac prikazuje spremljeno stanje; vlastiti unos ostaje u obavijesti o sukobu.
  useEffect(() => { setF({ contractNo: p.contractNo ?? '', startDate: p.startDate ?? '', durationMonths: p.durationMonths ? String(p.durationMonths) : '', title: p.title }); }, [p.revision]);
  const shown = { title: p.title, contractNo: p.contractNo ?? '', startDate: p.startDate ?? '', durationMonths: p.durationMonths ? String(p.durationMonths) : '' };
  const FIELDS: [keyof typeof f, string][] = [['title', 'Naslov'], ['contractNo', 'Broj ugovora'], ['startDate', 'Početak'], ['durationMonths', 'Trajanje (mj.)']];
  const available = (orgs.data ?? []).filter((o) => !p.partners.some((x) => x.organisationId === o.id));
  return (
    <>
    <ImportHint projectId={p.id} show={(can(me, 'projects:write', p.id) || can(me, 'finance:write', p.id)) && ['contracting', 'active'].includes(p.status)} />
    <Deviations list={p.deviations} />
    <div className="grid g2">
      <div className="card">
        <h2>Ugovor</h2>
        {conflict && <ConflictNotice conflict={conflict} what="Projekt"
          diff={FIELDS.filter(([k]) => conflict.mine[k] !== conflict.base[k] && conflict.mine[k] !== shown[k]).map(([k, l]) => ({ label: l, mine: conflict.mine[k], now: shown[k] }))}
          onReload={async () => { await reloadProject(); setConflict({ ...conflict, reloaded: true }); }}
          onRestore={() => { setF({ ...shown, ...Object.fromEntries(FIELDS.filter(([k]) => conflict.mine[k] !== conflict.base[k]).map(([k]) => [k, conflict.mine[k]])) }); setConflict(null); }} onDismiss={() => setConflict(null)} />}
        {write ? (
          <ActionForm submit="Spremi" onSubmit={async () => {
            try {
              await api('PATCH', `/projects/${p.id}`, { revision: p.revision, title: f.title, contractNo: f.contractNo || null,
                ...(contracting ? { startDate: f.startDate || null, durationMonths: f.durationMonths ? Number(f.durationMonths) : null } : {}) });
            } catch (e) { if (!isConflict(e)) throw e; setConflict(conflictOf(e, { ...f }, { ...shown })); return; }
            setConflict(null);
            await reloadProject();
          }}>
            <Field label="Naslov"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
            <Field label="Broj ugovora"><input value={f.contractNo} onChange={(e) => setF({ ...f, contractNo: e.target.value })} /></Field>
            <Field label="Početak" hint={contracting ? undefined : 'nakon aktivacije samo amandmanom'}><input type="date" value={f.startDate} disabled={!contracting} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
            <Field label="Trajanje (mj.)"><input type="number" min={1} max={120} value={f.durationMonths} disabled={!contracting} onChange={(e) => setF({ ...f, durationMonths: e.target.value })} /></Field>
          </ActionForm>
        ) : (
          <div className="kv"><b>Broj ugovora</b><span>{p.contractNo ?? '–'}</span><b>Početak</b><span>{date(p.startDate)}</span><b>Trajanje</b><span>{p.durationMonths ?? '–'} mj.</span></div>
        )}
        {write && (
          <>
            <h3>Promjena statusa</h3>
            <div className="actions">
              {TRANSITIONS[p.status]?.map((to) => (
                <ActionButton key={to} kind={to === 'active' ? 'primary' : to === 'terminated' ? 'danger' : undefined}
                  confirm={to === 'terminated' ? 'Prekinuti projekt? Radnja se ne može poništiti.' : to === 'active' && contracting ? 'Aktivacija zaključava proračun v1 i generira izvještajna razdoblja. Nastaviti?' : undefined}
                  onClick={async () => { await api('POST', `/projects/${p.id}/transition`, { to }); await reloadProject(); }}>
                  → {label(to)}
                </ActionButton>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="card">
        <h2>Partneri ({p.partners.length})</h2>
        <table>
          <thead><tr><th>#</th><th>Organizacija</th><th>Uloga</th><th>Vrsta korisnika</th><th /></tr></thead>
          <tbody>{p.partners.map((x) => (
            <tr key={x.id}><td>{x.orderNo}</td><td>{x.name} <span className="muted">({x.country})</span></td><td>{ROLE[x.role] ?? x.role}</td><td>{x.beneficiaryType}</td>
              <td>{write && contracting && !x.isSelf && <ActionButton kind="danger" onClick={async () => { await api('DELETE', `/projects/${p.id}/partners/${x.id}`); await reloadProject(); }}>ukloni</ActionButton>}</td></tr>
          ))}</tbody>
        </table>
        {write && contracting && (
          <ActionForm submit="Dodaj partnera" onSubmit={async () => { await api('POST', `/projects/${p.id}/partners`, newPartner); setNewPartner({ organisationId: '', role: 'partner' }); await reloadProject(); }}>
            <Field label="Organizacija" hint="nova se dodaje u izborniku Organizacije">
              <select value={newPartner.organisationId} onChange={(e) => setNewPartner({ ...newPartner, organisationId: e.target.value })} required>
                <option value="">– odaberi –</option>{available.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.country})</option>)}
              </select>
            </Field>
            <Field label="Uloga"><select value={newPartner.role} onChange={(e) => setNewPartner({ ...newPartner, role: e.target.value })}>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          </ActionForm>
        )}
        <h2>Izvještajna razdoblja</h2>
        {p.reportingPeriods.length === 0 ? <p className="muted">Generiraju se iz paketa programa pri aktivaciji projekta.</p> : (
          <table><thead><tr><th>Razdoblje</th><th>Od</th><th>Do</th><th>Rok predaje</th></tr></thead>
            <tbody>{p.reportingPeriods.map((r) => <tr key={r.number}><td>RP{r.number}</td><td>{date(r.startDate)}</td><td>{date(r.endDate)}</td><td>{date(r.dueDate)}</td></tr>)}</tbody></table>
        )}
      </div>
    </div>
    </>
  );
}

/** WP1.14b: odstupanja od pravila programa – računaju se pri svakom učitavanju projekta (valjanost paketa, pravila `validations`). */
export function Deviations({ list }: { list: Deviation[] | undefined }) {
  if (!list?.length) return null;
  return (
    <div className="deviations" role="status">
      <h2>Odstupanja od pravila programa ({list.length})</h2>
      <ul>{list.map((d) => <li key={d.key} className={d.severity}>{d.message}</li>)}</ul>
      <small className="muted">Projekt je prihvaćen; provjeri odstupanja s financijerom ili ispravi podatke. Popis se osvježava pri svakoj izmjeni.</small>
    </div>
  );
}

/**
 * WP1.17: projekt koji je već u tijeku unosi se iz Excela – uputa na novom projektu (dok na njemu nema primijenjenog uvoza),
 * koju korisnik može sakriti (zapamćeno u ovom pregledniku); kartica „Uvoz” ostaje uvijek dostupna.
 */
function ImportHint({ projectId, show }: { projectId: string; show: boolean }) {
  const key = `arqus.importHint.${projectId}`;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } });
  const imports = useLoad(() => (show && !hidden ? api<{ status: string }[]>('GET', `/projects/${projectId}/imports`) : Promise.resolve(null)), [projectId, show, hidden]);
  if (!show || hidden || !imports.data || imports.data.some((i) => i.status === 'applied')) return null;
  return (
    <div className="import-hint" role="note">
      <span><b>Projekt je već u tijeku?</b> Radne pakete, proračun, tim i dosadašnje troškove (i one već potraživane prije ArQusa) uvezi iz Excela – pregled prije spremanja, sve ili ništa.</span>
      <span className="actions" style={{ marginTop: 0 }}><a className="chip acc" href={`#/projekti/${projectId}/uvoz`}>Uvoz iz Excela →</a>
        <button className="link" onClick={() => { try { localStorage.setItem(key, '1'); } catch { /* privatni način */ } setHidden(true); }}>Sakrij</button></span>
    </div>
  );
}
