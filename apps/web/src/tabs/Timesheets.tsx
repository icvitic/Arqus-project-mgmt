import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { eur, minutesToHours, parseEur, parseHours } from '../lib/format';
import { useLoad } from '../lib/hooks';
import type { Structure, TeamMember, Timesheet, UserRow } from '../lib/types';
import { ActionButton, ActionForm, Chip, ErrorBox, Field, Loading } from '../ui';
import { can, type TabProps } from '../pages/ProjectDetail';

const thisMonth = () => new Date().toISOString().slice(0, 7);
const dim = (m: string) => { const [y, mo] = m.split('-').map(Number) as [number, number]; return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
const weekend = (m: string, d: number) => { const w = new Date(`${m}-${String(d).padStart(2, '0')}T00:00:00Z`).getUTCDay(); return w === 0 || w === 6; };

export function TimesheetsTab({ project: p, me }: TabProps) {
  const team = useLoad(() => api<TeamMember[]>('GET', `/projects/${p.id}/team`), [p.id]);
  const users = useLoad(() => (can(me, 'users:read') ? api<UserRow[]>('GET', '/users') : Promise.resolve([] as UserRow[])), []);
  const [memberId, setMemberId] = useState('');
  const [month, setMonth] = useState(() => (p.startDate && p.startDate.slice(0, 7) > thisMonth() ? p.startDate.slice(0, 7) : thisMonth()));
  const [m, setM] = useState({ fullName: '', userId: '', role: '', annualCost: '' });
  const own = team.data?.find((t) => t.userId === me.user.id);
  useEffect(() => { if (!memberId && team.data?.length) setMemberId((own ?? team.data[0]!).id); }, [team.data, memberId, own]);
  return (
    <>
      <div className="card scroll">
        <h2>Tim projekta</h2>
        <ErrorBox error={team.error} />
        {!team.data ? <Loading /> : (
          <table><thead><tr><th>Ime</th><th>Uloga</th><th>Korisnik</th><th className="num">Godišnji trošak</th></tr></thead>
            <tbody>{team.data.map((t) => <tr key={t.id}><td>{t.fullName}</td><td>{t.role ?? '–'}</td><td>{t.userId ? (users.data?.find((u) => u.id === t.userId)?.email ?? 'da') : '–'}</td><td className="num">{eur(t.annualCost)}</td></tr>)}
              {team.data.length === 0 && <tr><td colSpan={4} className="muted">Još nema članova tima.</td></tr>}</tbody></table>
        )}
        {can(me, 'finance:write') && (
          <ActionForm submit="Dodaj člana tima" onSubmit={async () => {
            const annualCost = parseEur(m.annualCost); if (annualCost === null) throw new Error('Neispravan godišnji trošak');
            await api('POST', `/projects/${p.id}/team`, { fullName: m.fullName, annualCost, ...(m.userId ? { userId: m.userId } : {}), ...(m.role ? { role: m.role } : {}) });
            setM({ fullName: '', userId: '', role: '', annualCost: '' }); await team.reload();
          }}>
            <Field label="Ime i prezime"><input value={m.fullName} onChange={(e) => setM({ ...m, fullName: e.target.value })} required /></Field>
            <Field label="Uloga"><input value={m.role} onChange={(e) => setM({ ...m, role: e.target.value })} /></Field>
            <Field label="Korisnički račun" hint="za unos vlastitog timesheeta"><select value={m.userId} onChange={(e) => setM({ ...m, userId: e.target.value })}><option value="">–</option>{users.data?.map((u) => <option key={u.id} value={u.id}>{u.displayName} ({u.email})</option>)}</select></Field>
            <Field label="Godišnji trošak (€)" hint="bruto 2 s doprinosima"><input inputMode="decimal" value={m.annualCost} onChange={(e) => setM({ ...m, annualCost: e.target.value })} required /></Field>
          </ActionForm>
        )}
      </div>
      {team.data && team.data.length > 0 && (
        <div className="card">
          <div className="actions" style={{ marginTop: 0 }}>
            <Field label="Član tima"><select value={memberId} onChange={(e) => setMemberId(e.target.value)}>{team.data.map((t) => <option key={t.id} value={t.id}>{t.fullName}</option>)}</select></Field>
            <Field label="Mjesec"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
          </div>
          {memberId && <TimesheetGrid key={`${memberId}-${month}`} projectId={p.id} memberId={memberId} month={month} me={me} mine={own?.id === memberId} />}
        </div>
      )}
    </>
  );
}

function TimesheetGrid({ projectId, memberId, month, me, mine }: { projectId: string; memberId: string; month: string; me: TabProps['me']; mine: boolean }) {
  const url = `/projects/${projectId}/team/${memberId}/timesheets/${month}`;
  const ts = useLoad(() => api<Timesheet>('GET', url), [url]);
  const structure = useLoad(() => api<Structure>('GET', `/projects/${projectId}/structure`), [projectId]);
  const rows = useMemo(() => [...(structure.data?.workPackages ?? []).map((w) => ({ id: w.id, label: `${w.code} ${w.title}` })), { id: '', label: 'Bez radnog paketa' }], [structure.data]);
  const [cells, setCells] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!ts.data) return;
    setCells(Object.fromEntries(ts.data.entries.map((e) => [`${e.workPackageId ?? ''}|${e.day}`, minutesToHours(e.minutes)])));
  }, [ts.data]);
  if (ts.error) return <ErrorBox error={ts.error} />;
  if (!ts.data || !structure.data) return <Loading what="timesheet" />;
  const days = Array.from({ length: dim(month) }, (_, i) => i + 1);
  const status = ts.data.status;
  const canEdit = (status === 'draft' || status === 'none') && (mine || can(me, 'timesheets:approve')) && can(me, 'timesheets:write');
  const invalid = Object.values(cells).some((v) => parseHours(v) === null);
  const entries = () => Object.entries(cells).map(([k, v]) => { const [wp, day] = k.split('|') as [string, string]; return { day: Number(day), minutes: parseHours(v) ?? 0, workPackageId: wp || null }; }).filter((e) => e.minutes > 0);
  const total = entries().reduce((a, e) => a + e.minutes, 0);
  const act = async (path: string) => { await api('POST', `${url}/${path}`); await ts.reload(); };
  return (
    <>
      <h3>Timesheet {month} <Chip s={status} /> <span className="muted" style={{ fontWeight: 400 }}>ukupno {minutesToHours(total) || 0} h</span></h3>
      <div className="scroll">
        <table>
          <thead><tr><th>Radni paket</th>{days.map((d) => <th key={d} className={`num ${weekend(month, d) ? 'weekend' : ''}`}>{d}</th>)}<th className="num">Σ h</th></tr></thead>
          <tbody>{rows.map((r) => {
            const sum = days.reduce((a, d) => a + (parseHours(cells[`${r.id}|${d}`] ?? '') ?? 0), 0);
            return (
              <tr key={r.id || 'none'}><td style={{ whiteSpace: 'nowrap' }}>{r.label}</td>
                {days.map((d) => { const k = `${r.id}|${d}`; return (
                  <td key={d} className={weekend(month, d) ? 'weekend' : ''} style={{ padding: 2 }}>
                    {canEdit ? <input className="h" inputMode="decimal" aria-label={`${r.label} dan ${d}`} value={cells[k] ?? ''} onChange={(e) => setCells({ ...cells, [k]: e.target.value })} /> : <span className="muted">{cells[k] ?? ''}</span>}
                  </td>); })}
                <td className="num">{minutesToHours(sum) || ''}</td></tr>
            );
          })}</tbody>
        </table>
      </div>
      {ts.data.warnings.map((w) => <div className="warnbox" key={w}>{w}</div>)}
      <div className="actions">
        {canEdit && <ActionButton kind="primary" onClick={async () => { if (invalid) throw new Error('Sati u obliku 7,5'); await api('PUT', url, { entries: entries() }); await ts.reload(); }}>Spremi</ActionButton>}
        {status === 'draft' && canEdit && <ActionButton onClick={() => act('submit')}>Predaj na odobrenje</ActionButton>}
        {status === 'submitted' && can(me, 'timesheets:approve') && <ActionButton kind="primary" onClick={() => act('approve')}>Odobri (stvara trošak osoblja)</ActionButton>}
        {(status === 'submitted' || status === 'approved') && can(me, 'timesheets:approve') && <ActionButton onClick={() => act('reopen')}>Vrati u nacrt</ActionButton>}
      </div>
    </>
  );
}
