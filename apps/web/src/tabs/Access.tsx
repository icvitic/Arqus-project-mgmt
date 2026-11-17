import { useState } from 'react';
import { api } from '../lib/api';
import { useLoad } from '../lib/hooks';
import type { ProjectAccess } from '../lib/types';
import { ActionButton, ActionForm, Chip, ErrorBox, Field, Loading } from '../ui';
import type { TabProps } from '../pages/ProjectDetail';

/**
 * Pristup projektu (WP1.14): tko vidi projekt i kroz koju ulogu – na razini institucije (svi projekti) ili na ovom projektu.
 * Dodjeljuje i oduzima voditelj projekta (projects:write na projektu) ili administrator; uloga s dozvolama koje dodjeljivač
 * sam nema nije ponuđena.
 */
export function AccessTab({ project: p, me }: TabProps) {
  const access = useLoad(() => api<ProjectAccess>('GET', `/projects/${p.id}/access`), [p.id]);
  const [f, setF] = useState({ userId: '', roleCode: 'team-member' });
  if (access.error) return <ErrorBox error={access.error} />;
  if (!access.data) return <Loading what="pristup" />;
  const a = access.data;
  const onProject = a.entries.filter((e) => e.scope === 'project');
  const tenantWide = a.entries.filter((e) => e.scope === 'tenant');
  const grantable = a.roles.filter((r) => r.grantable);
  const row = (e: ProjectAccess['entries'][number]) => (
    <tr key={`${e.userId}-${e.roleCode}-${e.scope}`}>
      <td><b>{e.displayName}</b>{e.userId === me.user.id && <span className="muted"> (ja)</span>}<br /><span className="muted">{e.email}</span></td>
      <td>{e.roleName}</td>
      <td>{e.scope === 'project' ? <Chip s="na ovom projektu" tone="acc" /> : <Chip s="cijela institucija" />}</td>
      <td>{e.status !== 'active' && <Chip s={e.status} tone="warn" />}</td>
      <td>{e.assignmentId && e.revocable && (
        <ActionButton kind="danger" confirm={`Oduzeti ulogu „${e.roleName}” korisniku ${e.email} na ovom projektu? Vrijedi odmah.`}
          onClick={async () => { access.setData(await api<ProjectAccess>('DELETE', `/projects/${p.id}/access/${e.assignmentId}`)); }}>oduzmi</ActionButton>
      )}</td>
    </tr>
  );
  return (
    <div className="grid g2">
      <div className="card scroll">
        <h2>Pristup na ovom projektu ({onProject.length})</h2>
        <p className="muted">Uloga dodijeljena na projektu vrijedi samo za ovaj projekt. Oduzimanje vrijedi od idućeg zahtjeva korisnika.</p>
        <table><thead><tr><th>Korisnik</th><th>Uloga</th><th>Opseg</th><th /><th /></tr></thead>
          <tbody>{onProject.map(row)}{onProject.length === 0 && <tr><td colSpan={5} className="muted">Nitko nema ulogu dodijeljenu na ovom projektu.</td></tr>}</tbody></table>
        <h3>Novi pristup</h3>
        <ActionForm submit="Dodijeli ulogu na projektu" onSubmit={async () => {
          access.setData(await api<ProjectAccess>('POST', `/projects/${p.id}/access`, f));
          setF({ ...f, userId: '' });
        }}>
          <Field label="Korisnik"><select value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })} required>
            <option value="">– odaberi –</option>{a.users.map((u) => <option key={u.id} value={u.id}>{u.displayName} ({u.email})</option>)}
          </select></Field>
          <Field label="Uloga na projektu" hint="ponuđene su uloge čije dozvole i sam imaš na projektu"><select value={f.roleCode} onChange={(e) => setF({ ...f, roleCode: e.target.value })}>
            {grantable.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
          </select></Field>
        </ActionForm>
      </div>
      <div className="card scroll">
        <h2>Pristup kroz ulogu institucije ({tenantWide.length})</h2>
        <p className="muted">Ovi korisnici vide sve projekte institucije; uloge institucije mijenja administrator u izborniku Korisnici.</p>
        <table><thead><tr><th>Korisnik</th><th>Uloga</th><th>Opseg</th><th /><th /></tr></thead><tbody>{tenantWide.map(row)}</tbody></table>
      </div>
    </div>
  );
}
