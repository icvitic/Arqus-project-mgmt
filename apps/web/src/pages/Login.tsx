import { useState } from 'react';
import { api, ApiError, token } from '../lib/api';
import { ActionForm, Field } from '../ui';

export function Login({ onLogin }: { onLogin: () => Promise<void> }) {
  const [tenantSlug, setSlug] = useState(() => { try { return localStorage.getItem('arqus.tenant') ?? ''; } catch { return ''; } });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needCode, setNeedCode] = useState(false);
  return (
    <main className="login">
      <h1>ArQus Projekti</h1>
      <p className="sub">Prijava u sustav za upravljanje projektima.</p>
      <div className="card">
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
        {needCode && <button className="link" onClick={() => { setNeedCode(false); setCode(''); }}>Natrag</button>}
      </div>
    </main>
  );
}
