import { useState } from 'react';
import wordmark from '../brand/arqus-wordmark-dark.svg';
import { api, ApiError, token } from '../lib/api';
import { ActionForm, Field } from '../ui';

interface ForgotResult { ok: boolean; message: string; mailEnabled: boolean }

export function Login({ onLogin }: { onLogin: () => Promise<void> }) {
  const [tenantSlug, setSlug] = useState(() => { try { return localStorage.getItem('arqus.tenant') ?? ''; } catch { return ''; } });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  // WP1.21: zaboravljena lozinka – isti odgovor za svaki račun; bez e-pošte upućuje na administratora.
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [forgot, setForgot] = useState<ForgotResult | null>(null);
  return (
    <main className="login">
      <img className="login-logo" src={wordmark} alt="ArQus Solutions" width={298} height={136} />
      <h1>ArQus Projekti</h1>
      <p className="sub">{mode === 'login' ? 'Prijava u sustav za upravljanje projektima.' : 'Zaboravljena lozinka'}</p>
      <div className="card">
        {mode === 'login' ? (
          <>
            <ActionForm submit={needCode ? 'Potvrdi kod' : 'Prijava'} onSubmit={async () => {
              try {
                const r = await api<{ accessToken: string }>('POST', '/auth/login', { tenantSlug: tenantSlug.trim(), email: email.trim(), password, ...(needCode ? { code: code.trim() } : {}) });
                token.set(r.accessToken);
              } catch (e) {
                if (e instanceof ApiError && (e.data as { mfaRequired?: boolean } | null)?.mfaRequired) { setNeedCode(true); setCode(''); if (!needCode) return; }
                throw e;
              }
              try { localStorage.setItem('arqus.tenant', tenantSlug.trim()); } catch { /* ništa */ }
              await onLogin();
            }}>
              <Field label="Institucija (oznaka)"><input value={tenantSlug} onChange={(e) => setSlug(e.target.value)} required autoComplete="organization" disabled={needCode} /></Field>
              <Field label="E-adresa"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" disabled={needCode} /></Field>
              <Field label="Lozinka"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" disabled={needCode} /></Field>
              {needCode && <Field label="Kod iz aplikacije za autentikaciju" hint="6 znamenki"><input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus /></Field>}
            </ActionForm>
            {needCode
              ? <button className="link" onClick={() => { setNeedCode(false); setCode(''); }}>Natrag</button>
              : <button className="link" onClick={() => { setMode('forgot'); setForgot(null); }}>Zaboravljena lozinka?</button>}
          </>
        ) : forgot ? (
          <div role="status" data-testid="forgot-done">
            <p>{forgot.message}</p>
            {forgot.mailEnabled
              ? <p className="muted">Ako poruka ne stigne za nekoliko minuta, provjeri neželjenu poštu ili se obrati administratoru svoje institucije.</p>
              : <p className="warnbox">Poveznicu za novu lozinku izdaje administrator tvoje institucije (izbornik <b>Korisnici</b>) – javi mu se.</p>}
            <button className="link" onClick={() => setMode('login')}>Natrag na prijavu</button>
          </div>
        ) : (
          <>
            <p className="muted">Upiši oznaku institucije i e-adresu računa. Ako račun postoji i aktivan je, na tu adresu stiže poveznica za novu lozinku. Dvofaktorska prijava ostaje uključena.</p>
            <ActionForm submit="Pošalji poveznicu" onSubmit={async () => {
              setForgot(await api<ForgotResult>('POST', '/auth/password/forgot', { tenantSlug: tenantSlug.trim(), email: email.trim() }));
            }}>
              <Field label="Institucija (oznaka)"><input value={tenantSlug} onChange={(e) => setSlug(e.target.value)} required autoComplete="organization" /></Field>
              <Field label="E-adresa"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></Field>
            </ActionForm>
            <button className="link" onClick={() => setMode('login')}>Natrag na prijavu</button>
          </>
        )}
      </div>
    </main>
  );
}
