import { useState } from 'react';
import { api } from '../lib/api';
import { date, label, TRANSITIONS } from '../lib/format';
import { useLoad } from '../lib/hooks';
import type { Organisation } from '../lib/types';
import { ActionButton, ActionForm, Field } from '../ui';
import { can, type TabProps } from '../pages/ProjectDetail';

const ROLE: Record<string, string> = { coordinator: 'koordinator', partner: 'partner', associated: 'pridruženi', third_party: 'treća strana' };

export function Overview({ project: p, me, reloadProject }: TabProps) {
  const write = can(me, 'projects:write') && !['closed', 'terminated', 'archived'].includes(p.status);
  const contracting = p.status === 'contracting';
  const [f, setF] = useState({ contractNo: p.contractNo ?? '', startDate: p.startDate ?? '', durationMonths: p.durationMonths ? String(p.durationMonths) : '', title: p.title });
  const orgs = useLoad(() => (contracting && write ? api<Organisation[]>('GET', '/organisations') : Promise.resolve([] as Organisation[])), [contracting, write]);
  const [newPartner, setNewPartner] = useState({ organisationId: '', role: 'partner' });
  const available = (orgs.data ?? []).filter((o) => !p.partners.some((x) => x.organisationId === o.id));
  return (
    <div className="grid g2">
      <div className="card">
        <h2>Ugovor</h2>
        {write ? (
          <ActionForm submit="Spremi" onSubmit={async () => {
            await api('PATCH', `/projects/${p.id}`, { title: f.title, contractNo: f.contractNo || null,
              ...(contracting ? { startDate: f.startDate || null, durationMonths: f.durationMonths ? Number(f.durationMonths) : null } : {}) });
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
  );
}
