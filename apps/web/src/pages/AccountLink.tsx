import { useEffect, useState } from 'react';
import { api, ApiError, token as session } from '../lib/api';
import { dateTime } from '../lib/format';
import { ActionForm, Field } from '../ui';

type Kind = 'invite' | 'reset';
interface LinkInfo { kind: Kind; institution: string; tenantSlug: string; email: string; displayName: string; expiresAt: string }

const INVALID = 'invalid_link';
const isInvalid = (e: unknown) => e instanceof ApiError && (e.data as { code?: unknown } | null)?.code === INVALID;

/**
 * WP1.21 – javne stranice za prihvaćanje pozivnice (`#/pozivnica/<token>`) i novu lozinku (`#/lozinka/<token>`).
 * Token je u FRAGMENTU adrese: preglednik ga nikad ne šalje poslužitelju (nije u zapisu pristupa ni u Refereru); stranica
 * ga šalje samo u tijelu zahtjeva. Nakon uspjeha adresa se zamjenjuje (token ne ostaje u povijesti preglednika).
 */
export function AccountLink({ kind, token, onLoggedIn }: { kind: Kind; token: string; onLoggedIn: () => Promise<void> }) {
  const [info, setInfo] = useState<LinkInfo | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'error' | 'done'>('loading');
  const [message, setMessage] = useState('');
  const [pw, setPw] = useState({ next: '', repeat: '' });
  const [doneEmail, setDoneEmail] = useState('');

  useEffect(() => {
    let live = true;
    api<LinkInfo>('POST', '/auth/token/inspect', { token, kind })
      .then((r) => { if (live) { setInfo(r); setState('ready'); } })
      .catch((e: unknown) => { if (!live) return; if (isInvalid(e)) setState('invalid'); else { setMessage((e as Error).message); setState('error'); } });
    return () => { live = false; };
  }, [token, kind]);

  const forget = () => { try { window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`); } catch { /* ništa */ } };
  const toLogin = () => { forget(); window.dispatchEvent(new HashChangeEvent('hashchange')); };
  const invite = kind === 'invite';

  return (
    <main className="login account-link">
      <h1>ArQus Projekti</h1>
      <p className="sub">{invite ? 'Prihvaćanje pozivnice' : 'Nova lozinka'}</p>
      <div className="card">
        {state === 'loading' && <p className="muted">Provjeravam poveznicu…</p>}
        {state === 'invalid' && (
          <div role="alert" data-testid="link-invalid">
            <h2>Poveznica nije valjana</h2>
            <p>Istekla je, već je iskorištena ili je zamijenjena novom{invite ? ' pozivnicom' : ''}.</p>
            <p className="muted">{invite
              ? 'Zamoli administratora svoje institucije da ti pošalje novu pozivnicu.'
              : 'Zatraži novu poveznicu na stranici za prijavu („Zaboravljena lozinka?”) ili se obrati administratoru svoje institucije.'}</p>
            <button className="primary" onClick={toLogin}>Na prijavu</button>
          </div>
        )}
        {state === 'error' && <div className="alert" role="alert"><b>{message || 'Poveznicu trenutno nije moguće provjeriti.'}</b><p className="muted">Pokušaj ponovno za nekoliko minuta.</p></div>}
        {state === 'done' && (
          <div role="status" data-testid="reset-done">
            <h2>Lozinka je promijenjena</h2>
            <p>Odjavljen/a si sa svih uređaja. Prijavi se novom lozinkom{doneEmail ? ` (${doneEmail})` : ''}{info?.kind === 'reset' ? '; ako imaš dvofaktorsku prijavu, trebat će ti i kod iz aplikacije' : ''}.</p>
            <button className="primary" onClick={toLogin}>Na prijavu</button>
          </div>
        )}
        {state === 'ready' && info && (
          <>
            <p>{invite ? <>Dobrodošao/la, <b>{info.displayName}</b>! Za račun u instituciji <b>{info.institution}</b> odaberi vlastitu lozinku.</> : <>Odaberi novu lozinku za račun <b>{info.email}</b> u instituciji <b>{info.institution}</b>.</>}</p>
            <div className="kv account-link-kv"><b>E-adresa</b><span>{info.email}</span><b>Institucija</b><span>{info.institution} <span className="muted">(oznaka {info.tenantSlug})</span></span><b>Poveznica vrijedi do</b><span>{dateTime(info.expiresAt)}</span></div>
            <ActionForm submit={invite ? 'Postavi lozinku i prijavi se' : 'Postavi novu lozinku'} onSubmit={async () => {
              if (pw.next !== pw.repeat) throw new Error('Lozinka i ponovljeni unos se ne podudaraju');
              try {
                if (invite) {
                  const r = await api<{ accessToken: string }>('POST', '/auth/invitation/accept', { token, password: pw.next });
                  try { localStorage.setItem('arqus.tenant', info.tenantSlug); } catch { /* ništa */ }
                  session.set(r.accessToken);
                  forget();
                  await onLoggedIn();
                } else {
                  const r = await api<{ tenantSlug: string; email: string }>('POST', '/auth/password/reset', { token, password: pw.next });
                  try { localStorage.setItem('arqus.tenant', r.tenantSlug); } catch { /* ništa */ }
                  session.clear(); forget(); setDoneEmail(r.email); setPw({ next: '', repeat: '' }); setState('done');
                }
              } catch (e) {
                if (isInvalid(e)) { setState('invalid'); return; }
                throw e;
              }
            }}>
              <input type="email" autoComplete="username" value={info.email} readOnly hidden />
              <Field label={invite ? 'Lozinka' : 'Nova lozinka'} hint="najmanje 12 znakova; preporuka: rečenica ili nekoliko nepovezanih riječi (bez imena, e-adrese i naziva institucije)"><input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required autoFocus /></Field>
              <Field label="Ponovi lozinku"><input type="password" autoComplete="new-password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} required /></Field>
            </ActionForm>
            <p className="muted small-note">Lozinku zna samo vlasnik računa – ni administrator je ne vidi. {invite ? 'Poveznica se može upotrijebiti samo jednom.' : 'Dvofaktorska prijava (ako je imaš) ostaje uključena.'}</p>
          </>
        )}
      </div>
    </main>
  );
}
