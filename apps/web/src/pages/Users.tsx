import { useState } from 'react';
import { api } from '../lib/api';
import { date } from '../lib/format';
import { useLoad } from '../lib/hooks';
import type { Me, RoleRow, UserRow } from '../lib/types';
import { ActionButton, ActionForm, Chip, ErrorBox, Field, Loading } from '../ui';

const can = (me: Me, p: string) => me.permissions.includes('*') || me.permissions.includes(p);

export function Users({ me }: { me: Me }) {
  if (!can(me, 'users:read')) return <p className="muted">Nemaš pristup popisu korisnika.</p>;
  return <UsersInner me={me} />;
}

function UsersInner({ me }: { me: Me }) {
  const users = useLoad(() => api<UserRow[]>('GET', '/users'), []);
  const roles = useLoad(() => (can(me, 'roles:read') ? api<RoleRow[]>('GET', '/roles') : Promise.resolve([] as RoleRow[])), []);
  const write = can(me, 'users:write');
  const [f, setF] = useState({ email: '', displayName: '', password: '', role: 'team-member' });
  const roleName = (code: string) => roles.data?.find((r) => r.code === code)?.name ?? code;
  return (
    <>
      <h1>Korisnici</h1>
      <p className="sub">Korisnici institucije, njihove uloge i stanje prijave. Promjena uloga vrijedi odmah; deaktivacija i reset lozinke odjavljuju korisnika sa svih uređaja.</p>
      {write && (
        <div className="card"><h2>Novi korisnik</h2>
          <ActionForm submit="Dodaj korisnika" onSubmit={async () => {
            await api('POST', '/users', { email: f.email, displayName: f.displayName, password: f.password, roleCodes: [f.role] });
            setF({ email: '', displayName: '', password: '', role: f.role }); await users.reload();
          }}>
            <Field label="Ime i prezime"><input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} required /></Field>
            <Field label="E-adresa"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
            <Field label="Privremena lozinka" hint="najmanje 12 znakova; korisnik je mijenja u Moj račun"><input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required /></Field>
            <Field label="Uloga"><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{roles.data?.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}</select></Field>
          </ActionForm>
        </div>
      )}
      <div className="card scroll">
        <ErrorBox error={users.error} />
        {!users.data ? <Loading /> : (
          <table>
            <thead><tr><th>Korisnik</th><th>Uloge</th><th>Stanje</th><th>MFA</th><th>Zadnja prijava</th>{write && <th />}</tr></thead>
            <tbody>{users.data.map((u) => (
              <tr key={u.id}>
                <td><b>{u.displayName}</b><br /><span className="muted">{u.email}</span></td>
                <td>{write && u.id !== me.user.id ? (
                  <select aria-label={`Uloga ${u.email}`} value={u.roles[0] ?? ''} onChange={async (e) => { try { await api('PATCH', `/users/${u.id}`, { roleCodes: [e.target.value] }); } catch (err) { alert((err as Error).message); } await users.reload(); }}>
                    {u.roles.length === 0 && <option value="">–</option>}
                    {roles.data?.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                  </select>) : u.roles.map(roleName).join(', ') || '–'}</td>
                <td><Chip s={u.status} tone={u.status === 'active' ? 'ok' : u.status === 'disabled' ? 'bad' : 'warn'} /></td>
                <td>{u.mfaEnabled ? <span className="chip ok">uključen</span> : <span className="chip">isključen</span>}</td>
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
