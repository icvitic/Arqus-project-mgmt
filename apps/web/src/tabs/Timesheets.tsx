import { useEffect, useMemo, useRef, useState } from 'react';
import { api, apiText, downloadFile } from '../lib/api';
import { eur, minutesToHours, parseEur, parseHours } from '../lib/format';
import { useLoad } from '../lib/hooks';
import type { ProjectAccess, Structure, TeamMember, Timesheet, UserRow } from '../lib/types';
import { ActionButton, ActionForm, Chip, ConflictNotice, ErrorBox, Field, Loading, conflictOf, editedKeys, isConflict, type Conflict } from '../ui';
import { can, type TabProps } from '../pages/ProjectDetail';
import { can as canTenant, canManageAccess } from '../lib/access';
import { localToday } from '../lib/claims';

type Person = { id: string; displayName: string; email: string };

/** Tekući mjesec po lokalnom kalendaru (ne UTC – oko ponoći prvog u mjesecu inače prethodni mjesec), WP1.14b. */
const thisMonth = () => localToday().slice(0, 7);
const dim = (m: string) => { const [y, mo] = m.split('-').map(Number) as [number, number]; return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
const weekend = (m: string, d: number) => { const w = new Date(`${m}-${String(d).padStart(2, '0')}T00:00:00Z`).getUTCDay(); return w === 0 || w === 6; };

export function TimesheetsTab({ project: p, me, sub }: TabProps) {
  const team = useLoad(() => api<TeamMember[]>('GET', `/projects/${p.id}/team`), [p.id]);
  // Korisnički računi za povezivanje s članom tima: popis korisnika (users:read) ili popis iz upravljanja pristupom projektu.
  const users = useLoad<Person[]>(() => (canTenant(me, 'users:read') ? api<UserRow[]>('GET', '/users')
    : canManageAccess(me, p.id) ? api<ProjectAccess>('GET', `/projects/${p.id}/access`).then((a) => a.users) : Promise.resolve([])), [p.id]);
  const seeCost = can(me, 'personnel:read', p.id); // plaće: čitanje i unos samo uz pristup podacima o osoblju
  const writeTeam = can(me, 'finance:write', p.id);
  // WP1.18: poveznica iz „Moj rad” ili obavijesti (`tim/<član>/<mjesec>`) otvara točno taj timesheet.
  const [subMember, subMonth] = [sub?.[0] ?? '', /^\d{4}-(0[1-9]|1[0-2])$/.test(sub?.[1] ?? '') ? sub![1]! : ''];
  const [memberId, setMemberId] = useState(subMember);
  const [month, setMonth] = useState(() => subMonth || (p.startDate && p.startDate.slice(0, 7) > thisMonth() ? p.startDate.slice(0, 7) : thisMonth()));
  useEffect(() => { if (subMember) setMemberId(subMember); if (subMonth) setMonth(subMonth); }, [subMember, subMonth]);
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
            <tbody>{team.data.map((t) => <tr key={t.id}><td>{t.fullName}</td><td>{t.role ?? '–'}</td><td>{t.userId ? (t.userId === me.user.id ? 'ja' : users.data?.find((u) => u.id === t.userId)?.email ?? 'da') : '–'}</td>
              <td className="num">{!t.costSet ? <span className="muted" title="upisuju financije ili ured za projekte">nije upisan</span> : t.annualCost === null ? <span className="muted" title="vidljivo uz dozvolu za troškove osoblja">skriveno</span> : eur(t.annualCost)}
                {seeCost && writeTeam && <> <ActionButton onClick={async () => {
                  const v = window.prompt(`Godišnji trošak za ${t.fullName} (€, bruto 2 s doprinosima)`, t.annualCost === null ? '' : String(t.annualCost / 100).replace('.', ','));
                  if (v === null) return; const annualCost = parseEur(v); if (annualCost === null) throw new Error('Neispravan godišnji trošak');
                  await api('PATCH', `/projects/${p.id}/team/${t.id}`, { annualCost }); await team.reload();
                }}>{t.costSet ? 'promijeni' : 'upiši'}</ActionButton></>}</td></tr>)}
              {team.data.length === 0 && <tr><td colSpan={4} className="muted">Još nema članova tima.</td></tr>}</tbody></table>
        )}
        {writeTeam && (
          <ActionForm submit="Dodaj člana tima" onSubmit={async () => {
            const annualCost = seeCost && m.annualCost ? parseEur(m.annualCost) : undefined; if (annualCost === null) throw new Error('Neispravan godišnji trošak');
            await api('POST', `/projects/${p.id}/team`, { fullName: m.fullName, ...(annualCost !== undefined ? { annualCost } : {}), ...(m.userId ? { userId: m.userId } : {}), ...(m.role ? { role: m.role } : {}) });
            setM({ fullName: '', userId: '', role: '', annualCost: '' }); await team.reload();
          }}>
            <Field label="Ime i prezime"><input value={m.fullName} onChange={(e) => setM({ ...m, fullName: e.target.value })} required /></Field>
            <Field label="Uloga"><input value={m.role} onChange={(e) => setM({ ...m, role: e.target.value })} /></Field>
            <Field label="Korisnički račun" hint="za unos vlastitog timesheeta; korisnik dobiva ulogu člana tima na ovom projektu"><select value={m.userId} onChange={(e) => setM({ ...m, userId: e.target.value })}><option value="">–</option>{users.data?.map((u) => <option key={u.id} value={u.id}>{u.displayName} ({u.email})</option>)}</select></Field>
            {seeCost
              ? <Field label="Godišnji trošak (€)" hint="bruto 2 s doprinosima; može se upisati i kasnije"><input inputMode="decimal" value={m.annualCost} onChange={(e) => setM({ ...m, annualCost: e.target.value })} /></Field>
              : <p className="muted">Godišnji trošak (plaću) upisuju financije ili ured za projekte; do tada se timesheet ne može odobriti.</p>}
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
  const [printing, setPrinting] = useState(false);
  const [conflict, setConflict] = useState<Conflict<Record<string, string>> | null>(null);
  const stored = (data: Timesheet): Record<string, string> => Object.fromEntries(data.entries.map((e) => [`${e.workPackageId ?? ''}|${e.day}`, minutesToHours(e.minutes)]));
  useEffect(() => { if (ts.data) setCells(stored(ts.data)); }, [ts.data]);
  if (ts.error) return <ErrorBox error={ts.error} />;
  if (!ts.data || !structure.data) return <Loading what="timesheet" />;
  const days = Array.from({ length: dim(month) }, (_, i) => i + 1);
  const status = ts.data.status;
  const approver = can(me, 'timesheets:approve', projectId);
  // WP1.14b – četiri oka: tko je predao timesheet, ne odobrava ga (poslužitelj bi odbio).
  const submittedByMe = ts.data.submittedBy === me.user.id;
  const label = (k: string) => { const [wp, day] = k.split('|') as [string, string]; return `${rows.find((r) => r.id === wp)?.label ?? 'Bez radnog paketa'}, dan ${day}`; };
  const sameHours = (x: string | undefined, y: string | undefined) => (parseHours(x ?? '') ?? -1) === (parseHours(y ?? '') ?? -1);
  const edited = conflict ? editedKeys(conflict.mine, conflict.base, sameHours) : [];
  const diff = edited.filter((k) => !sameHours(conflict!.mine[k], cells[k])).map((k) => ({ label: label(k), mine: conflict!.mine[k] ?? '', now: cells[k] ?? '' }));
  const save = async () => {
    if (invalid) throw new Error('Sati u obliku 7,5');
    try { await api('PUT', url, { revision: ts.data!.revision, entries: entries() }); setConflict(null); await ts.reload(); }
    catch (e) { if (!isConflict(e)) throw e; setConflict(conflictOf(e, { ...cells }, stored(ts.data!))); }
  };
  const canEdit = (status === 'draft' || status === 'none') && (mine || approver) && can(me, 'timesheets:write', projectId);
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
      {conflict && <ConflictNotice conflict={conflict} what="Timesheet" diff={diff}
        onReload={async () => { await ts.reload(); setConflict({ ...conflict, reloaded: true }); }}
        onRestore={() => { setCells({ ...cells, ...Object.fromEntries(edited.map((k) => [k, conflict.mine[k] ?? ''])) }); setConflict(null); }} onDismiss={() => setConflict(null)} />}
      <div className="actions">
        {canEdit && <ActionButton kind="primary" onClick={save}>Spremi</ActionButton>}
        {status === 'draft' && canEdit && <ActionButton onClick={() => act('submit')}>Predaj na odobrenje</ActionButton>}
        {status === 'submitted' && approver && !mine && !submittedByMe && <ActionButton kind="primary" onClick={() => act('approve')}>Odobri (stvara trošak osoblja)</ActionButton>}
        {status === 'submitted' && approver && mine && <span className="muted">Vlastiti timesheet odobrava druga osoba (voditelj projekta ili ured za projekte).</span>}
        {status === 'submitted' && approver && !mine && submittedByMe && <span className="muted">Timesheet koji si predao odobrava druga osoba s pravom odobravanja (četiri oka).</span>}
        {(status === 'submitted' || status === 'approved') && approver && <ActionButton onClick={() => act('reopen')}>Vrati u nacrt</ActionButton>}
        <button onClick={() => setPrinting((v) => !v)} aria-expanded={printing}>{printing ? 'Zatvori evidenciju za ispis' : 'Evidencija za ispis i potpis'}</button>
      </div>
      {printing && <RecordView url={`${url}/record`} month={month} />}
    </>
  );
}

/**
 * Mjesečna evidencija rada za ispis i potpis (WP1.16b) – isti dokument kao u paketu ZNS-a. Prikazuje se u izoliranom
 * okviru (bez skripti); „Ispiši” otvara ispis samo tog dokumenta (jedna stranica A4).
 */
function RecordView({ url, month }: { url: string; month: string }) {
  const html = useLoad(() => apiText(url), [url]);
  const frame = useRef<HTMLIFrameElement>(null);
  if (html.error) return <ErrorBox error={html.error} />;
  if (html.data === null) return <Loading what="evidenciju" />;
  return (
    <div className="sub-panel">
      <div className="actions" style={{ marginTop: 0 }}>
        <button className="primary" onClick={() => frame.current?.contentWindow?.print()}>Ispiši</button>
        <ActionButton onClick={() => downloadFile(url, `evidencija-rada_${month}.html`)}>Preuzmi (HTML)</ActionButton>
        <span className="muted">Jedna stranica A4 s crtama za potpis zaposlenika i nadređenog.</span>
      </div>
      <iframe ref={frame} title="Evidencija rada za ispis" sandbox="allow-same-origin allow-modals" srcDoc={html.data}
        style={{ width: '100%', height: 1000, border: '1px solid var(--line)', borderRadius: 6, background: '#fff' }} />
    </div>
  );
}
