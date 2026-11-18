import { useState } from 'react';
import { api } from '../lib/api';
import { date, label } from '../lib/format';
import { useLoad } from '../lib/hooks';
import type { Responsible, Structure } from '../lib/types';
import { ActionButton, ActionForm, Chip, ErrorBox, Field, Loading, announce } from '../ui';
import { can, type TabProps } from '../pages/ProjectDetail';
import { responsibleNext, TASK_STATUS } from '../lib/responsible';

const DELIV_STATUS = ['planned', 'in_progress', 'submitted', 'accepted', 'rejected'];
const TASK_STATUSES = ['planned', 'in_progress', 'done', 'cancelled'];

/** WP1.22: odgovorna osoba u tablici – ime, „ti” i oznaka neaktivnog člana riječima (ne samo bojom). */
function Who({ r }: { r: Responsible | null }) {
  if (!r) return <span className="muted">–</span>;
  return <span className={`who${r.active ? '' : ' inactive'}`}>{r.name}{r.mine ? ' (ti)' : ''}{!r.active && ' – neaktivan/na u timu'}</span>;
}

/**
 * WP1.22: odabir odgovorne osobe (tko smije uređivati strukturu). Neaktivan član koji je još određen ostaje vidljiv kao
 * odabran, ali se ne nudi drugima; „– nije određena –” uklanja dodjelu.
 */
function ResponsibleSelect({ label: l, team, value, current, onChange }: { label: string; team: { id: string; name: string; active: boolean }[]; value: string | null; current: Responsible | null; onChange: (id: string | null) => Promise<void> }) {
  return (
    <select aria-label={l} value={value ?? ''} onChange={async (e) => { await onChange(e.target.value || null); }}>
      <option value="">– nije određena –</option>
      {team.filter((m) => m.active || m.id === value).map((m) => <option key={m.id} value={m.id} disabled={!m.active}>{m.name}{!m.active ? ' (neaktivan/na)' : ''}</option>)}
      {value && !team.some((m) => m.id === value) && current && <option value={value}>{current.name}</option>}
    </select>
  );
}

export function StructureTab({ project: p, pkg, me }: TabProps) {
  const s = useLoad(() => api<Structure>('GET', `/projects/${p.id}/structure`), [p.id]);
  const write = can(me, 'projects:write', p.id) && !['closed', 'terminated', 'archived'].includes(p.status);
  const max = p.durationMonths ?? 120;
  const [wp, setWp] = useState({ title: '', startMonth: '1', endMonth: String(max), leadPartnerId: '' });
  const [d, setD] = useState({ wpId: '', title: '', type: pkg.deliverableTypes?.[0]?.code ?? '', dissemination: pkg.disseminationLevels?.[0]?.code ?? '', dueMonth: '', responsible: '' });
  const [ms, setMs] = useState({ title: '', dueMonth: '', verification: '', responsible: '' });
  const [tk, setTk] = useState({ wpId: '', title: '', startMonth: '1', endMonth: String(max), responsible: '' });
  const [risk, setRisk] = useState({ description: '', likelihood: '2', impact: '2', mitigation: '' });
  const partnerName = (id: string | null) => p.partners.find((x) => x.id === id)?.name ?? '–';
  if (s.error) return <ErrorBox error={s.error} />;
  if (!s.data) return <Loading what="strukturu" />;
  const team = s.data.team ?? [];
  /** Izmjena polja stavke (PATCH) s ponovnim učitavanjem i porukom za čitač zaslona; greška se prikazuje kao upozorenje. */
  const patch = async (path: string, body: Record<string, unknown>, done: string) => {
    try { await api('PATCH', `/projects/${p.id}/${path}`, body); announce(done); } catch (e) { announce(`Nije spremljeno: ${(e as Error).message}`); alert((e as Error).message); } finally { await s.reload(); }
  };
  const progress = async (path: string, status: string) => { await api('POST', `/projects/${p.id}/${path}/progress`, { status }); await s.reload(); };
  return (
    <>
      {s.data.workPackages.map((w) => (
        <div className="card scroll" key={w.id}>
          <h2>{w.code} {w.title} <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>· M{w.startMonth}–M{w.endMonth} · voditelj: {partnerName(w.leadPartnerId)}</span></h2>
          <table aria-label={`Isporuke ${w.code}`}>
            <thead><tr><th>Isporuka</th><th>Naziv</th><th>Vrsta</th><th>Dis.</th><th>Rok</th><th>Odgovorna osoba</th><th>Status</th></tr></thead>
            <tbody>
              {w.deliverables.length === 0 && <tr><td colSpan={7} className="muted">Nema isporuka.</td></tr>}
              {w.deliverables.map((x) => (
                <tr key={x.id} data-deliverable={x.code}><td>{x.code}</td><td>{x.title}</td><td>{x.type}</td><td>{x.dissemination}</td><td>M{x.dueMonth} <span className="muted">{date(x.dueDate)}</span></td>
                  <td>{write
                    ? <ResponsibleSelect label={`Odgovorna osoba ${x.code}`} team={team} value={x.responsibleMemberId} current={x.responsible} onChange={(id) => patch(`deliverables/${x.id}`, { responsibleMemberId: id }, `Odgovorna osoba za ${x.code} je spremljena.`)} />
                    : <Who r={x.responsible} />}</td>
                  <td>{write ? (
                    <select aria-label={`Status ${x.code}`} value={x.status} onChange={(e) => void patch(`deliverables/${x.id}`, { status: e.target.value }, `Status ${x.code}: ${label(e.target.value, 'f')}.`)}>
                      {DELIV_STATUS.map((st) => <option key={st} value={st}>{label(st, 'f')}</option>)}
                    </select>) : <>
                      <Chip f s={x.status} />
                      {/* WP1.22: odgovorna osoba pomiče svoju isporuku kroz radni dio statusa (poslužitelj provjerava isto). */}
                      {x.responsible?.mine && x.responsible.active && responsibleNext('deliverable', x.status).map((to) => (
                        <ActionButton key={to} label={`${x.code}: označi kao ${label(to, 'f')}`} onClick={() => progress(`deliverables/${x.id}`, to)}>→ {label(to, 'f')}</ActionButton>
                      ))}
                    </>}</td></tr>
              ))}
            </tbody>
          </table>
          {(w.tasks.length > 0 || write) && (
            <>
              <h3>Zadaci</h3>
              {w.tasks.length === 0 ? <p className="muted">Nema zadataka.</p> : (
                <table className="tasks" aria-label={`Zadaci ${w.code}`}>
                  <thead><tr><th>Zadatak</th><th>Naziv</th><th>Trajanje</th><th>Odgovorna osoba</th><th>Status</th></tr></thead>
                  <tbody>{w.tasks.map((t) => (
                    <tr key={t.id} data-task={t.code}><td>{t.code}</td><td>{t.title}</td><td>M{t.startMonth}–M{t.endMonth} <span className="muted">do {date(t.endDate)}</span></td>
                      <td>{write
                        ? <ResponsibleSelect label={`Odgovorna osoba ${t.code}`} team={team} value={t.responsibleMemberId} current={t.responsible} onChange={(id) => patch(`tasks/${t.id}`, { responsibleMemberId: id }, `Odgovorna osoba za ${t.code} je spremljena.`)} />
                        : <Who r={t.responsible} />}</td>
                      <td>{write ? (
                        <select aria-label={`Status ${t.code}`} value={t.status} onChange={(e) => void patch(`tasks/${t.id}`, { status: e.target.value }, `Status ${t.code}: ${TASK_STATUS[e.target.value]}.`)}>
                          {TASK_STATUSES.map((st) => <option key={st} value={st}>{TASK_STATUS[st]}</option>)}
                        </select>) : <>
                          <span className="chip">{TASK_STATUS[t.status] ?? t.status}</span>
                          {t.responsible?.mine && t.responsible.active && responsibleNext('task', t.status).map((to) => (
                            <ActionButton key={to} label={`${t.code}: označi kao ${TASK_STATUS[to]}`} onClick={() => progress(`tasks/${t.id}`, to)}>→ {TASK_STATUS[to]}</ActionButton>
                          ))}
                        </>}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </>
          )}
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
            <ActionForm submit="Dodaj isporuku" onSubmit={async () => { await api('POST', `/projects/${p.id}/work-packages/${d.wpId}/deliverables`, { title: d.title, type: d.type, dissemination: d.dissemination, dueMonth: Number(d.dueMonth), ...(d.responsible ? { responsibleMemberId: d.responsible } : {}) }); setD({ ...d, title: '', responsible: '' }); await s.reload(); }}>
              <Field label="Radni paket"><select value={d.wpId} onChange={(e) => setD({ ...d, wpId: e.target.value })} required><option value="">–</option>{s.data.workPackages.map((w) => <option key={w.id} value={w.id}>{w.code} {w.title}</option>)}</select></Field>
              <Field label="Naziv"><input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} required /></Field>
              <Field label="Vrsta"><select value={d.type} onChange={(e) => setD({ ...d, type: e.target.value })}>{pkg.deliverableTypes?.map((t) => <option key={t.code} value={t.code}>{t.code} – {t.name}</option>)}</select></Field>
              <Field label="Diseminacija"><select value={d.dissemination} onChange={(e) => setD({ ...d, dissemination: e.target.value })}>{pkg.disseminationLevels?.map((t) => <option key={t.code} value={t.code}>{t.code} – {t.name}</option>)}</select></Field>
              <Field label="Rok (mjesec)"><input type="number" min={1} max={max} value={d.dueMonth} onChange={(e) => setD({ ...d, dueMonth: e.target.value })} required /></Field>
              <Field label="Odgovorna osoba" hint="član tima projekta; neobavezno"><select value={d.responsible} onChange={(e) => setD({ ...d, responsible: e.target.value })}><option value="">– nije određena –</option>{team.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
            </ActionForm>
          </div>
          <div className="card"><h2>Novi zadatak</h2>
            <ActionForm submit="Dodaj zadatak" onSubmit={async () => { await api('POST', `/projects/${p.id}/work-packages/${tk.wpId}/tasks`, { title: tk.title, startMonth: Number(tk.startMonth), endMonth: Number(tk.endMonth), ...(tk.responsible ? { responsibleMemberId: tk.responsible } : {}) }); setTk({ ...tk, title: '', responsible: '' }); await s.reload(); }}>
              <Field label="Radni paket"><select value={tk.wpId} onChange={(e) => setTk({ ...tk, wpId: e.target.value })} required><option value="">–</option>{s.data.workPackages.map((w) => <option key={w.id} value={w.id}>{w.code} {w.title}</option>)}</select></Field>
              <Field label="Naziv"><input value={tk.title} onChange={(e) => setTk({ ...tk, title: e.target.value })} required /></Field>
              <Field label="Od mjeseca"><input type="number" min={1} max={max} value={tk.startMonth} onChange={(e) => setTk({ ...tk, startMonth: e.target.value })} required /></Field>
              <Field label="Do mjeseca"><input type="number" min={1} max={max} value={tk.endMonth} onChange={(e) => setTk({ ...tk, endMonth: e.target.value })} required /></Field>
              <Field label="Odgovorna osoba" hint="član tima projekta; neobavezno"><select value={tk.responsible} onChange={(e) => setTk({ ...tk, responsible: e.target.value })}><option value="">– nije određena –</option>{team.filter((m) => m.active).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
            </ActionForm>
          </div>
        </div>
      )}
      <div className="grid g2">
        <div className="card scroll"><h2>Prekretnice</h2>
          <table aria-label="Prekretnice"><thead><tr><th>Oznaka</th><th>Naziv</th><th>Rok</th><th>Odgovorna osoba</th><th>Status</th></tr></thead>
            <tbody>{s.data.milestones.map((m) => <tr key={m.id} data-milestone={m.code}><td>{m.code}</td><td>{m.title}</td><td>M{m.dueMonth} <span className="muted">{date(m.dueDate)}</span></td>
              <td>{write ? <ResponsibleSelect label={`Odgovorna osoba ${m.code}`} team={team} value={m.responsibleMemberId} current={m.responsible} onChange={(id) => patch(`milestones/${m.id}`, { responsibleMemberId: id }, `Odgovorna osoba za ${m.code} je spremljena.`)} /> : <Who r={m.responsible} />}</td>
              <td><Chip f s={m.status} /></td></tr>)}
            {s.data.milestones.length === 0 && <tr><td colSpan={5} className="muted">Nema prekretnica.</td></tr>}</tbody></table>
          {write && <ActionForm submit="Dodaj prekretnicu" onSubmit={async () => { await api('POST', `/projects/${p.id}/milestones`, { title: ms.title, dueMonth: Number(ms.dueMonth), ...(ms.verification ? { verification: ms.verification } : {}), ...(ms.responsible ? { responsibleMemberId: ms.responsible } : {}) }); setMs({ title: '', dueMonth: '', verification: '', responsible: '' }); await s.reload(); }}>
            <Field label="Naziv"><input value={ms.title} onChange={(e) => setMs({ ...ms, title: e.target.value })} required /></Field>
            <Field label="Mjesec"><input type="number" min={1} max={max} value={ms.dueMonth} onChange={(e) => setMs({ ...ms, dueMonth: e.target.value })} required /></Field>
            <Field label="Način provjere"><input value={ms.verification} onChange={(e) => setMs({ ...ms, verification: e.target.value })} /></Field>
            <Field label="Odgovorna osoba" hint="član tima projekta; neobavezno"><select value={ms.responsible} onChange={(e) => setMs({ ...ms, responsible: e.target.value })}><option value="">– nije određena –</option>{team.filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
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
