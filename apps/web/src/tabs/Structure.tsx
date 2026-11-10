import { useState } from 'react';
import { api } from '../lib/api';
import { date, label } from '../lib/format';
import { useLoad } from '../lib/hooks';
import type { Structure } from '../lib/types';
import { ActionForm, Chip, ErrorBox, Field, Loading } from '../ui';
import { can, type TabProps } from '../pages/ProjectDetail';

const DELIV_STATUS = ['planned', 'in_progress', 'submitted', 'accepted', 'rejected'];

export function StructureTab({ project: p, pkg, me }: TabProps) {
  const s = useLoad(() => api<Structure>('GET', `/projects/${p.id}/structure`), [p.id]);
  const write = can(me, 'projects:write') && !['closed', 'terminated', 'archived'].includes(p.status);
  const max = p.durationMonths ?? 120;
  const [wp, setWp] = useState({ title: '', startMonth: '1', endMonth: String(max), leadPartnerId: '' });
  const [d, setD] = useState({ wpId: '', title: '', type: pkg.deliverableTypes?.[0]?.code ?? '', dissemination: pkg.disseminationLevels?.[0]?.code ?? '', dueMonth: '' });
  const [ms, setMs] = useState({ title: '', dueMonth: '', verification: '' });
  const [risk, setRisk] = useState({ description: '', likelihood: '2', impact: '2', mitigation: '' });
  const partnerName = (id: string | null) => p.partners.find((x) => x.id === id)?.name ?? '–';
  if (s.error) return <ErrorBox error={s.error} />;
  if (!s.data) return <Loading what="strukturu" />;
  return (
    <>
      {s.data.workPackages.map((w) => (
        <div className="card scroll" key={w.id}>
          <h2>{w.code} {w.title} <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· M{w.startMonth}–M{w.endMonth} · voditelj: {partnerName(w.leadPartnerId)}</span></h2>
          {w.tasks.length > 0 && <p className="muted">Zadaci: {w.tasks.map((t) => `${t.code} ${t.title} (M${t.startMonth}–M${t.endMonth})`).join(' · ')}</p>}
          <table>
            <thead><tr><th>Isporuka</th><th>Naziv</th><th>Vrsta</th><th>Dis.</th><th>Rok</th><th>Status</th></tr></thead>
            <tbody>
              {w.deliverables.length === 0 && <tr><td colSpan={6} className="muted">Nema isporuka.</td></tr>}
              {w.deliverables.map((x) => (
                <tr key={x.id}><td>{x.code}</td><td>{x.title}</td><td>{x.type}</td><td>{x.dissemination}</td><td>M{x.dueMonth} <span className="muted">{date(x.dueDate)}</span></td>
                  <td>{write ? (
                    <select aria-label={`Status ${x.code}`} value={x.status} onChange={async (e) => { try { await api('PATCH', `/projects/${p.id}/deliverables/${x.id}`, { status: e.target.value }); } finally { await s.reload(); } }}>
                      {DELIV_STATUS.map((st) => <option key={st} value={st}>{label(st)}</option>)}
                    </select>) : <Chip s={x.status} />}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {write && (
        <div className="grid g2">
          <div className="card"><h2>Novi radni paket</h2>
            <ActionForm submit="Dodaj radni paket" onSubmit={async () => { await api('POST', `/projects/${p.id}/work-packages`, { title: wp.title, startMonth: Number(wp.startMonth), endMonth: Number(wp.endMonth), ...(wp.leadPartnerId ? { leadPartnerId: wp.leadPartnerId } : {}) }); setWp({ ...wp, title: '' }); await s.reload(); }}>
              <Field label="Naziv"><input value={wp.title} onChange={(e) => setWp({ ...wp, title: e.target.value })} required /></Field>
              <Field label="Od mjeseca"><input type="number" min={1} max={max} value={wp.startMonth} onChange={(e) => setWp({ ...wp, startMonth: e.target.value })} required /></Field>
              <Field label="Do mjeseca"><input type="number" min={1} max={max} value={wp.endMonth} onChange={(e) => setWp({ ...wp, endMonth: e.target.value })} required /></Field>
              <Field label="Voditelj"><select value={wp.leadPartnerId} onChange={(e) => setWp({ ...wp, leadPartnerId: e.target.value })}><option value="">–</option>{p.partners.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
            </ActionForm>
          </div>
          <div className="card"><h2>Nova isporuka</h2>
            <ActionForm submit="Dodaj isporuku" onSubmit={async () => { await api('POST', `/projects/${p.id}/work-packages/${d.wpId}/deliverables`, { title: d.title, type: d.type, dissemination: d.dissemination, dueMonth: Number(d.dueMonth) }); setD({ ...d, title: '' }); await s.reload(); }}>
              <Field label="Radni paket"><select value={d.wpId} onChange={(e) => setD({ ...d, wpId: e.target.value })} required><option value="">–</option>{s.data.workPackages.map((w) => <option key={w.id} value={w.id}>{w.code} {w.title}</option>)}</select></Field>
              <Field label="Naziv"><input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} required /></Field>
              <Field label="Vrsta"><select value={d.type} onChange={(e) => setD({ ...d, type: e.target.value })}>{pkg.deliverableTypes?.map((t) => <option key={t.code} value={t.code}>{t.code} – {t.name}</option>)}</select></Field>
              <Field label="Diseminacija"><select value={d.dissemination} onChange={(e) => setD({ ...d, dissemination: e.target.value })}>{pkg.disseminationLevels?.map((t) => <option key={t.code} value={t.code}>{t.code} – {t.name}</option>)}</select></Field>
              <Field label="Rok (mjesec)"><input type="number" min={1} max={max} value={d.dueMonth} onChange={(e) => setD({ ...d, dueMonth: e.target.value })} required /></Field>
            </ActionForm>
          </div>
        </div>
      )}
      <div className="grid g2">
        <div className="card scroll"><h2>Prekretnice</h2>
          <table><tbody>{s.data.milestones.map((m) => <tr key={m.id}><td>{m.code}</td><td>{m.title}</td><td>M{m.dueMonth} <span className="muted">{date(m.dueDate)}</span></td><td><Chip s={m.status} /></td></tr>)}
            {s.data.milestones.length === 0 && <tr><td className="muted">Nema prekretnica.</td></tr>}</tbody></table>
          {write && <ActionForm submit="Dodaj prekretnicu" onSubmit={async () => { await api('POST', `/projects/${p.id}/milestones`, { title: ms.title, dueMonth: Number(ms.dueMonth), ...(ms.verification ? { verification: ms.verification } : {}) }); setMs({ title: '', dueMonth: '', verification: '' }); await s.reload(); }}>
            <Field label="Naziv"><input value={ms.title} onChange={(e) => setMs({ ...ms, title: e.target.value })} required /></Field>
            <Field label="Mjesec"><input type="number" min={1} max={max} value={ms.dueMonth} onChange={(e) => setMs({ ...ms, dueMonth: e.target.value })} required /></Field>
            <Field label="Način provjere"><input value={ms.verification} onChange={(e) => setMs({ ...ms, verification: e.target.value })} /></Field>
          </ActionForm>}
        </div>
        <div className="card scroll"><h2>Rizici</h2>
          <table><thead><tr><th>Opis</th><th className="num">V×U</th><th>Razina</th><th>Mjera</th></tr></thead>
            <tbody>{s.data.risks.map((r) => <tr key={r.id}><td>{r.description}</td><td className="num">{r.likelihood}×{r.impact}</td><td><Chip s={r.level} /></td><td>{r.mitigation ?? '–'}</td></tr>)}
              {s.data.risks.length === 0 && <tr><td colSpan={4} className="muted">Nema rizika.</td></tr>}</tbody></table>
          {write && <ActionForm submit="Dodaj rizik" onSubmit={async () => { await api('POST', `/projects/${p.id}/risks`, { description: risk.description, likelihood: Number(risk.likelihood), impact: Number(risk.impact), ...(risk.mitigation ? { mitigation: risk.mitigation } : {}) }); setRisk({ description: '', likelihood: '2', impact: '2', mitigation: '' }); await s.reload(); }}>
            <Field label="Opis"><input value={risk.description} onChange={(e) => setRisk({ ...risk, description: e.target.value })} required /></Field>
            <Field label="Vjerojatnost (1–3)"><select value={risk.likelihood} onChange={(e) => setRisk({ ...risk, likelihood: e.target.value })}>{[1, 2, 3].map((n) => <option key={n}>{n}</option>)}</select></Field>
            <Field label="Utjecaj (1–3)"><select value={risk.impact} onChange={(e) => setRisk({ ...risk, impact: e.target.value })}>{[1, 2, 3].map((n) => <option key={n}>{n}</option>)}</select></Field>
            <Field label="Mjera ublažavanja"><input value={risk.mitigation} onChange={(e) => setRisk({ ...risk, mitigation: e.target.value })} /></Field>
          </ActionForm>}
        </div>
      </div>
    </>
  );
}
