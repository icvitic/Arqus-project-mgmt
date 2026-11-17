import { useState } from 'react';
import { api } from '../lib/api';
import { date } from '../lib/format';
import { useLoad } from '../lib/hooks';
import type { Me, MfaPolicy, ProjectSummary, RoleRow, SecuritySettings, UserRow } from '../lib/types';
import { ActionButton, ActionForm, Chip, ErrorBox, Field, Loading } from '../ui';
import { can } from '../lib/access';

export function Users({ me }: { me: Me }) {
  if (!can(me, 'users:read')) return <p className="muted">Nemaš pristup popisu korisnika.</p>;
  return <UsersInner me={me} />;
}

/** Uloga na projektu: ulogu tipa „projekt” (voditelj, član tima) sučelje zadano dodjeljuje na projektu (WP1.14). */
const projectGrant = (projectId: string, userId: string, roleCode: string) => api('POST', `/projects/${projectId}/access`, { userId, roleCode });

function UsersInner({ me }: { me: Me }) {
  const users = useLoad(() => api<UserRow[]>('GET', '/users'), []);
  const roles = useLoad(() => (can(me, 'roles:read') ? api<RoleRow[]>('GET', '/roles') : Promise.resolve([] as RoleRow[])), []);
  const write = can(me, 'users:write');
  const projects = useLoad(() => (write ? api<ProjectSummary[]>('GET', '/projects') : Promise.resolve([] as ProjectSummary[])), [write]);
  const [f, setF] = useState({ email: '', displayName: '', password: '', role: 'team-member', scope: 'project', projectId: '' });
  const [g, setG] = useState({ userId: '', role: 'team-member', projectId: '' });
  const roleName = (code: string) => roles.data?.find((r) => r.code === code)?.name ?? code;
  const scopeOf = (code: string) => roles.data?.find((r) => r.code === code)?.scope ?? 'tenant';
  const projectSelect = (value: string, onChange: (v: string) => void, label = 'Projekt') => (
    <Field label={label}><select value={value} onChange={(e) => onChange(e.target.value)} required>
      <option value="">– odaberi –</option>{projects.data?.map((p) => <option key={p.id} value={p.id}>{p.acronym} – {p.title}</option>)}
    </select></Field>
  );
  return (
    <>
      <h1>Korisnici</h1>
      <p className="sub">Korisnici institucije i njihove uloge. Uloga <b>institucije</b> vrijedi za sve projekte; uloga <b>na projektu</b> samo za taj projekt (voditelj projekta A ne vidi projekt B). Promjena uloga vrijedi odmah; deaktivacija i reset lozinke odjavljuju korisnika sa svih uređaja.</p>
      <MfaPolicyCard write={write} onChange={users.reload} />
      {write && (
        <div className="grid g2">
          <div className="card"><h2>Novi korisnik</h2>
            <ActionForm submit="Dodaj korisnika" onSubmit={async () => {
              const onProject = f.scope === 'project';
              const u = await api<{ id: string }>('POST', '/users', { email: f.email, displayName: f.displayName, password: f.password, roleCodes: onProject ? [] : [f.role] });
              if (onProject) await projectGrant(f.projectId, u.id, f.role);
              setF({ ...f, email: '', displayName: '', password: '' }); await users.reload();
            }}>
              <Field label="Ime i prezime"><input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} required /></Field>
              <Field label="E-adresa"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
              <Field label="Privremena lozinka" hint="najmanje 12 znakova; korisnik je mijenja u Moj račun"><input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
              <Field label="Uloga"><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value, scope: scopeOf(e.target.value) })}>{roles.data?.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select></Field>
              <Field label="Opseg uloge" hint="voditelj i član tima zadano dobivaju ulogu na jednom projektu"><select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
                <option value="project">na projektu</option><option value="tenant">cijela institucija (svi projekti)</option>
              </select></Field>
              {f.scope === 'project' && projectSelect(f.projectId, (v) => setF({ ...f, projectId: v }))}
            </ActionForm>
          </div>
          <div className="card"><h2>Uloga na projektu</h2>
            <p className="muted">Postojećem korisniku dodijeli ulogu koja vrijedi samo na odabranom projektu. Isto se može i u kartici „Pristup” na projektu.</p>
            <ActionForm submit="Dodijeli na projektu" onSubmit={async () => { await projectGrant(g.projectId, g.userId, g.role); setG({ ...g, userId: '' }); await users.reload(); }}>
              <Field label="Korisnik"><select value={g.userId} onChange={(e) => setG({ ...g, userId: e.target.value })} required>
                <option value="">– odaberi –</option>{users.data?.filter((u) => u.status !== 'disabled').map((u) => <option key={u.id} value={u.id}>{u.displayName} ({u.email})</option>)}
              </select></Field>
              <Field label="Uloga na projektu"><select value={g.role} onChange={(e) => setG({ ...g, role: e.target.value })}>{roles.data?.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select></Field>
              {projectSelect(g.projectId, (v) => setG({ ...g, projectId: v }))}
            </ActionForm>
          </div>
        </div>
      )}
      <div className="card scroll">
        <ErrorBox error={users.error} />
        {!users.data ? <Loading /> : (
          <table>
            <thead><tr><th>Korisnik</th><th>Uloga institucije</th><th>Uloge na projektima</th><th>Stanje</th><th>MFA</th><th>Zadnja prijava</th>{write && <th />}</tr></thead>
            <tbody>{users.data.map((u) => (
              <tr key={u.id}>
                <td><b>{u.displayName}</b><br /><span className="muted">{u.email}</span></td>
                <td>{write && u.id !== me.user.id ? (
                  <select aria-label={`Uloga ${u.email}`} value={u.roles[0] ?? ''} onChange={async (e) => { try { await api('PATCH', `/users/${u.id}`, { roleCodes: e.target.value ? [e.target.value] : [] }); } catch (err) { alert((err as Error).message); } await users.reload(); }}>
                    <option value="">– samo na projektima –</option>
                    {roles.data?.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                  </select>) : u.roles.map(roleName).join(', ') || <span className="muted">samo na projektima</span>}</td>
                <td>{u.projectRoles.length === 0 ? <span className="muted">–</span> : u.projectRoles.map((r) => (
                  <span key={r.assignmentId} style={{ whiteSpace: 'nowrap', marginRight: 6 }}>
                    <Chip s={`${roleName(r.code)} · ${r.acronym ?? 'projekt'}`} tone="acc" />
                    {write && <ActionButton confirm={`Oduzeti ulogu „${roleName(r.code)}” na projektu ${r.acronym ?? ''}?`} onClick={async () => { await api('DELETE', `/projects/${r.projectId}/access/${r.assignmentId}`); await users.reload(); }}>×</ActionButton>}
                  </span>
                ))}</td>
                <td><Chip s={u.status} tone={u.status === 'active' ? 'ok' : u.status === 'disabled' ? 'bad' : 'warn'} /></td>
                <td>{u.mfaEnabled ? <span className="chip ok">uključen</span> : u.mfaRequired ? <span className="chip bad" title="Institucija zahtijeva MFA za ovu ulogu; do postavljanja korisnik ima pristup samo vlastitom računu">obvezan – nije postavljen</span> : <span className="chip">isključen</span>}</td>
                <td>{u.lastLoginAt ? date(u.lastLoginAt) : '–'}</td>
                {write && <td><div className="actions" style={{ marginTop: 0 }}>{u.id !== me.user.id && <>
                  {u.status === 'active'
                    ? <ActionButton kind="danger" confirm={`Deaktivirati ${u.email}? Korisnik se odjavljuje sa svih uređaja.`} onClick={async () => { await api('PATCH', `/users/${u.id}`, { status: 'disabled' }); await users.reload(); }}>deaktiviraj</ActionButton>
                    : <ActionButton onClick={async () => { await api('PATCH', `/users/${u.id}`, { status: 'active' }); await users.reload(); }}>aktiviraj</ActionButton>}
                  <ActionButton onClick={async () => { const pw = window.prompt(`Nova privremena lozinka za ${u.email} (najmanje 12 znakova)`); if (!pw) return; await api('POST', `/users/${u.id}/reset-password`, { newPassword: pw }); await users.reload(); }}>nova lozinka</ActionButton>
                  {u.mfaEnabled && <ActionButton confirm="Isključiti MFA korisniku? Morat će ga ponovno postaviti." onClick={async () => { await api('POST', `/users/${u.id}/reset-mfa`); await users.reload(); }}>reset MFA</ActionButton>}
                </>}</div></td>}
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}

const MFA_OPTIONS: { value: MfaPolicy; label: string; hint: string }[] = [
  { value: 'none', label: 'Nije obvezna', hint: 'svaki korisnik sam odlučuje (preporučeno samo za demo)' },
  { value: 'privileged', label: 'Obvezna za povlaštene uloge', hint: 'administratori, ured za projekte, financije – tko na razini institucije upravlja korisnicima ili postavkama, vidi plaće ili reviziju ili mijenja financije' },
  { value: 'all', label: 'Obvezna za sve', hint: 'svaki korisnik institucije' },
];

/**
 * WP1.19: obvezna dvofaktorska prijava – postavka institucije. Mijenja je samo administrator korisnika (users:write);
 * promjena se bilježi u reviziju. Korisnik kojem je MFA obvezan, a nema ga, pri sljedećem zahtjevu ide na postavljanje MFA.
 */
function MfaPolicyCard({ write, onChange }: { write: boolean; onChange: () => Promise<void> }) {
  const s = useLoad(() => api<SecuritySettings>('GET', '/tenant/security'), []);
  const [choice, setChoice] = useState<MfaPolicy | null>(null);
  if (s.error) return <ErrorBox error={s.error} />;
  if (!s.data) return <Loading what="sigurnosne postavke" />;
  const value = choice ?? s.data.requireMfa;
  const impact = s.data.impact[value];
  return (
    <div className="card" aria-label="Obvezna dvofaktorska prijava">
      <h2>Obvezna dvofaktorska prijava (MFA)</h2>
      <div className="form one">
        {MFA_OPTIONS.map((o) => (
          <label key={o.value} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14 }}>
            <input type="radio" name="requireMfa" value={o.value} checked={value === o.value} disabled={!write} onChange={() => setChoice(o.value)} />
            <span><b>{o.label}</b> <span className="muted">– {o.hint}</span></span>
          </label>
        ))}
      </div>
      <p className="muted">{value === 'none' ? 'MFA nije obvezan ni za koga.' : `Odnosi se na ${impact.required} aktivnih korisnika; od njih ${impact.withoutMfa} još nema MFA i pri sljedećem zahtjevu bit će upućeni na postavljanje (do tada samo vlastiti račun i odjava).`}</p>
      {write ? (
        <div className="actions">
          <ActionButton kind="primary" disabled={value === s.data.requireMfa} onClick={async () => { s.setData(await api<SecuritySettings>('PUT', '/tenant/security', { requireMfa: value })); setChoice(null); await onChange(); }}>Spremi postavku</ActionButton>
          <span className="muted">Promjena se bilježi u reviziju. Tko postrožuje postavku, mora i sam imati MFA.</span>
        </div>
      ) : <p className="muted">Postavku mijenja administrator korisnika.</p>}
    </div>
  );
}
