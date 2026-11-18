import { useState } from 'react';
import { api, ApiError, token } from '../lib/api';
import type { Me } from '../lib/types';
import { ActionForm, Dialog, Field, announce } from '../ui';

/**
 * WP1.22 – istek sesije (WCAG 2.2.1, 2.2.5): sesija istekne (8 h) ili je opozvana dok korisnik ima upisane, nespremljene
 * podatke (timesheet, trošak). Umjesto da aplikacija odmah prijeđe na prijavu i izgubi sve upisano, iznad zaslona se otvara
 * ponovna prijava ISTOG računa; zaslon ispod ostaje kakav jest, a nakon prijave korisnik ponovno sprema. Drugi korisnik
 * se ne može prijaviti preko tuđeg zaslona – za to je „Odjava”, koja briše sve kao i do sada.
 */
export function ReauthDialog({ me, onDone, onSignOut }: { me: Me; onDone: () => Promise<void>; onSignOut: () => void }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  const slug = me.tenant?.slug ?? (() => { try { return localStorage.getItem('arqus.tenant') ?? ''; } catch { return ''; } })();
  return (
    <>
    {/* Escape ne zatvara: zatvaranje bi značilo odjavu i gubitak upisanog – izbor je izričit (prijava ili odjava). */}
    <Dialog title="Sesija je istekla" onClose={() => undefined} className="reauth">
      <p>Iz sigurnosnih razloga prijava vrijedi ograničeno vrijeme. <b>Ništa od upisanog nije izgubljeno</b> – prijavi se ponovno i zatim spremi svoje izmjene.</p>
      <ActionForm submit={needCode ? 'Potvrdi kod' : 'Prijavi se ponovno'} onSubmit={async () => {
        try {
          const r = await api<{ accessToken: string }>('POST', '/auth/login', { tenantSlug: slug, email: me.user.email, password, ...(needCode ? { code: code.trim() } : {}) });
          token.set(r.accessToken);
        } catch (e) {
          if (e instanceof ApiError && (e.data as { mfaRequired?: boolean } | null)?.mfaRequired && !needCode) { setNeedCode(true); return; }
          throw e;
        }
        announce('Ponovno si prijavljen/a. Spremi svoje izmjene.');
        await onDone();
      }}>
        <input type="email" autoComplete="username" value={me.user.email} readOnly hidden />
        <Field label="Račun"><input value={`${me.user.email}${me.tenant ? ` (${me.tenant.name})` : ''}`} readOnly /></Field>
        <Field label="Lozinka"><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={needCode} /></Field>
        {needCode && <Field label="Kod iz aplikacije za autentikaciju" hint="6 znamenki"><input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus /></Field>}
      </ActionForm>
      <div className="actions"><button onClick={onSignOut}>Odjava (upisano se ne sprema)</button></div>
    </Dialog>
    </>
  );
}
