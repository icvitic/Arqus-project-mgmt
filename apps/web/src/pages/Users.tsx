import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { date, dateTime } from '../lib/format';
import { useLoad } from '../lib/hooks';
import type { IssuedLink, MailStatus, Me, MfaPolicy, ProjectSummary, RoleRow, SecuritySettings, UserRow } from '../lib/types';
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
  const [f, setF] = useState({ email: '', displayName: '', role: 'team-member', scope: 'project', projectId: '' });
  const mail = useLoad(() => api<MailStatus>('GET', '/tenant/mail'), []);
  // WP1.21: jednokratni prikaz poveznice (instalacija bez e-pošte) ili potvrda slanja.
  const [shown, setShown] = useState<{ kind: 'invite' | 'reset'; user: string; link: string; expiresAt: string } | null>(null);
  const [notice, setNotice] = useState('');
  const handOver = async (kind: 'invite' | 'reset', who: { displayName: string; email: string }, r: IssuedLink) => {
    if (r.token) setShown({ kind, user: `${who.displayName} (${who.email})`, link: linkFor(kind, r.token), expiresAt: r.expiresAt });
    else setNotice(`${kind === 'invite' ? 'Pozivnica' : 'Poveznica za novu lozinku'} poslana je e-poštom na ${who.email} (vrijedi do ${dateTime(r.expiresAt)}). Ishod slanja vidi se u kartici E-pošta.`);
    await users.reload(); await mail.reload();
  };
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
      <p className="sub">Korisnici institucije i njihove uloge. Uloga <b>institucije</b> vrijedi za sve projekte; uloga <b>na projektu</b> samo za taj projekt (voditelj projekta A ne vidi projekt B). Novi korisnik dobiva <b>pozivnicu</b> i sam bira lozinku – administrator nikad ne zna ničiju lozinku. Promjena uloga vrijedi odmah; deaktivacija i nova lozinka odjavljuju korisnika sa svih uređaja.</p>
      {shown && <LinkDialog {...shown} onClose={() => setShown(null)} />}
      {notice && <div className="warnbox" role="status">{notice} <button className="link" onClick={() => setNotice('')}>U redu</button></div>}
      <MfaPolicyCard write={write} onChange={users.reload} />
      <MailCard status={mail.data} error={mail.error} write={write} reload={mail.reload} />
      {write && (
        <div className="grid g2">
          <div className="card"><h2>Pozovi korisnika</h2>
            <p className="muted">{mail.data?.enabled ? 'Pozivnica s poveznicom stiže korisniku e-poštom; poveznica vrijedi 7 dana.' : 'Ova instalacija ne šalje e-poštu: poveznicu pozivnice prikazat ćemo ti jednom, a ti je predaj korisniku pouzdanim kanalom.'} Korisnik na poveznici sam bira lozinku.</p>
            <ActionForm submit="Pošalji pozivnicu" onSubmit={async () => {
              const onProject = f.scope === 'project';
              const u = await api<{ id: string; email: string; displayName: string; invitation: IssuedLink }>('POST', '/users', { email: f.email, displayName: f.displayName, roleCodes: onProject ? [] : [f.role] });
              if (onProject) await projectGrant(f.projectId, u.id, f.role);
              setF({ ...f, email: '', displayName: '' });
              await handOver('invite', u, u.invitation);
            }}>
              <Field label="Ime i prezime"><input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} required /></Field>
              <Field label="E-adresa"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></Field>
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
                <td><StateCell u={u} /></td>
                <td>{u.mfaEnabled ? <span className="chip ok">uključen</span> : u.mfaRequired ? <span className="chip bad" title="Institucija zahtijeva MFA za ovu ulogu; do postavljanja korisnik ima pristup samo vlastitom računu">obvezan – nije postavljen</span> : <span className="chip">isključen</span>}</td>
                <td>{u.lastLoginAt ? date(u.lastLoginAt) : '–'}</td>
                {write && <td><div className="actions" style={{ marginTop: 0 }}>{u.id !== me.user.id && <>
                  {u.status === 'invited' && <ActionButton kind={u.invitation ? undefined : 'primary'} confirm={u.invitation ? 'Nova pozivnica odmah poništava dosadašnju poveznicu. Nastaviti?' : undefined} onClick={async () => handOver('invite', u, await api<IssuedLink>('POST', `/users/${u.id}/invitation`))}>{mail.data?.enabled ? 'pošalji pozivnicu ponovno' : 'nova poveznica pozivnice'}</ActionButton>}
                  {u.status === 'invited' && u.invitation && <ActionButton confirm={`Poništiti pozivnicu za ${u.email}? Poveznica odmah prestaje vrijediti; korisnik ostaje na popisu kao pozvan.`} onClick={async () => { await api('DELETE', `/users/${u.id}/invitation`); await users.reload(); }}>poništi pozivnicu</ActionButton>}
                  {u.status === 'active' && <ActionButton confirm={`Izdati poveznicu za novu lozinku za ${u.email}? Poveznica vrijedi 1 h; dosadašnja lozinka vrijedi dok korisnik ne odabere novu, a dvofaktorska prijava ostaje.`} onClick={async () => handOver('reset', u, await api<IssuedLink>('POST', `/users/${u.id}/password-link`))}>poveznica za novu lozinku</ActionButton>}
                  {u.status !== 'disabled'
                    ? <ActionButton kind="danger" confirm={`Deaktivirati ${u.email}? Korisnik se odjavljuje sa svih uređaja, a neiskorištene poveznice prestaju vrijediti.`} onClick={async () => { await api('PATCH', `/users/${u.id}`, { status: 'disabled' }); await users.reload(); }}>deaktiviraj</ActionButton>
                    : <ActionButton onClick={async () => { await api('PATCH', `/users/${u.id}`, { status: 'active' }); await users.reload(); }}>aktiviraj</ActionButton>}
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

/** WP1.21: poveznica iz izvora same stranice (ne iz poslužitelja) – token je u fragmentu (#), ne ide poslužitelju. */
const linkFor = (kind: 'invite' | 'reset', token: string) => `${window.location.origin}${window.location.pathname}#/${kind === 'invite' ? 'pozivnica' : 'lozinka'}/${token}`;

/** Stanje računa: pozvan (s rokom pozivnice), aktivan, deaktiviran; uz aktivnog i izdana poveznica za novu lozinku. */
function StateCell({ u }: { u: UserRow }) {
  if (u.status === 'invited') return (
    <>
      <span className="chip warn">pozvan</span>
      <small className="muted">{u.invitation ? `pozivnica do ${dateTime(u.invitation.expiresAt)}${u.invitation.delivery === 'mail' ? ' · e-poštom' : ' · ručno'}` : 'pozivnica istekla ili poništena'}</small>
    </>
  );
  if (u.status === 'disabled') return <span className="chip bad">deaktiviran</span>;
  return (
    <>
      <span className="chip ok">aktivan</span>
      {u.passwordLink && <small className="muted">poveznica za novu lozinku do {dateTime(u.passwordLink.expiresAt)}</small>}
    </>
  );
}

/**
 * WP1.21: jednokratni prikaz poveznice (instalacija bez e-pošte). Poveznica se gradi iz adrese ove stranice; poslužitelj je
 * vratio token samo jednom i u bazi ima samo njegov otisak – nakon zatvaranja se ne može ponovno prikazati.
 */
function LinkDialog({ kind, user, link, expiresAt, onClose }: { kind: 'invite' | 'reset'; user: string; link: string; expiresAt: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const copy = async () => { try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setCopied(false); } };
  return (
    <div className="dialog-backdrop" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="dialog card" role="dialog" aria-modal="true" aria-labelledby="link-dialog-title" tabIndex={-1} ref={ref}>
        <h2 id="link-dialog-title">{kind === 'invite' ? 'Poveznica pozivnice' : 'Poveznica za novu lozinku'}</h2>
        <p>Za: <b>{user}</b> · vrijedi do {dateTime(expiresAt)} · može se upotrijebiti samo jednom.</p>
        <div className="copy-row">
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Poveznica" data-testid="handover-link" />
          <button className="primary" onClick={() => void copy()}>{copied ? 'Kopirano' : 'Kopiraj'}</button>
        </div>
        <p className="warnbox"><b>Predaj poveznicu osobno ili pouzdanim kanalom</b> (uživo, telefonom, službenim chatom institucije) – ne javnim kanalom ni na zajedničkom zaslonu. Tko ima poveznicu, može postaviti lozinku tog računa. Ova poveznica prikazuje se samo sada; ako se izgubi, izdaj novu.</p>
        <div className="actions"><button onClick={onClose}>Zatvori</button></div>
      </div>
    </div>
  );
}

const KIND: Record<string, string> = { invite: 'pozivnica', reset: 'nova lozinka', password_changed: 'obavijest o lozinci', digest: 'dnevni sažetak', test: 'probna poruka' };
const ERR: Record<string, string> = { timeout: 'istek vremena', connection: 'veza', tls: 'TLS / certifikat', auth: 'prijava na poslužitelj', rejected: 'odbijeno', temporary: 'privremena greška', protocol: 'protokol', invalid: 'neispravna adresa', error: 'greška' };

/** WP1.21: stanje e-pošte – uključena ili ne, zadnje isporuke (bez sadržaja), probna poruka sebi. */
function MailCard({ status, error, write, reload }: { status: MailStatus | null; error: Error | null; write: boolean; reload: () => Promise<void> }) {
  const [sent, setSent] = useState('');
  if (error) return <ErrorBox error={error} />;
  if (!status) return <Loading what="stanje e-pošte" />;
  return (
    <div className="card" aria-label="E-pošta">
      <h2>E-pošta</h2>
      {status.enabled ? (
        <>
          <p><span className="chip ok">uključena</span> Pošiljatelj <b>{status.from}</b>, poveznice vode na <b>{status.publicUrl}</b>. Zadnjih 7 dana: {status.last7Days.sent} poslano, <span className={status.last7Days.failed ? 'bad-text' : ''}>{status.last7Days.failed} neuspjelo</span>.</p>
          {write && <div className="actions"><ActionButton onClick={async () => { const r = await api<{ sent: boolean }>('POST', '/tenant/mail/test'); setSent(r.sent ? 'Probna poruka je predana poslužitelju e-pošte – provjeri svoj pretinac.' : 'Slanje probne poruke nije uspjelo – vidi zapis ispod.'); await reload(); }}>Pošalji probnu poruku sebi</ActionButton>{sent && <span className="muted" role="status">{sent}</span>}</div>}
          {status.recent.length > 0 && (
            <div className="scroll"><table className="mail-table">
              <thead><tr><th>Vrijeme</th><th>Primatelj</th><th>Vrsta</th><th>Ishod</th></tr></thead>
              <tbody>{status.recent.map((d) => (
                <tr key={d.id}><td>{dateTime(d.createdAt)}</td><td>{d.displayName ?? '–'}</td><td>{KIND[d.kind] ?? d.kind}</td>
                  <td>{d.outcome === 'sent' ? <span className="chip ok">poslano</span> : <span className="chip bad" title={d.errorClass ?? ''}>neuspjelo{d.errorClass ? ` · ${ERR[d.errorClass] ?? d.errorClass}` : ''}</span>}{d.attempts > 1 && <small className="muted">{d.attempts} pokušaja</small>}</td></tr>
              ))}</tbody>
            </table></div>
          )}
          <p className="muted">Sadržaj poruka se ne sprema (poveznice u njima su tajne). Neuspjelu sigurnosnu poruku korisnik jednostavno zatraži ponovno.</p>
        </>
      ) : (
        <p><span className="chip">isključena</span> Ova instalacija ne šalje e-poštu. Poveznice pozivnica i novih lozinki prikazuju se tebi jednom – predaj ih korisniku pouzdanim kanalom. Dnevni sažetak se ne šalje. Uključivanje: postavke <code>MAIL_TRANSPORT</code> i <code>SMTP_*</code> instalacije (docs/PILOT-INSTALACIJA.md).</p>
      )}
    </div>
  );
}
