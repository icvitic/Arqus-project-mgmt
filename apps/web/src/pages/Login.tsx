import { useState } from 'react';
import { api, token } from '../lib/api';
import { ActionForm, Field } from '../ui';

export function Login({ onLogin }: { onLogin: () => Promise<void> }) {
  const [tenantSlug, setSlug] = useState(() => { try { return localStorage.getItem('arqus.tenant') ?? ''; } catch { return ''; } });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <main className="login">
      <h1>ArQus Projekti</h1>
      <p className="sub">Prijava u sustav za upravljanje projektima.</p>
      <div className="card">
        <ActionForm submit="Prijava" onSubmit={async () => {
          const r = await api<{ accessToken: string }>('POST', '/auth/login', { tenantSlug: tenantSlug.trim(), email: email.trim(), password });
          token.set(r.accessToken);
          try { localStorage.setItem('arqus.tenant', tenantSlug.trim()); } catch { /* ništa */ }
          await onLogin();
        }}>
          <Field label="Institucija (oznaka)"><input value={tenantSlug} onChange={(e) => setSlug(e.target.value)} required autoComplete="organization" /></Field>
          <Field label="E-adresa"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" /></Field>
          <Field label="Lozinka"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></Field>
        </ActionForm>
      </div>
    </main>
  );
}
