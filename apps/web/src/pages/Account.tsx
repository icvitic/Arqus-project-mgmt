import { useState } from 'react';
import { api } from '../lib/api';
import type { Me } from '../lib/types';
import { ActionButton, ActionForm, Field } from '../ui';

export function Account({ me, reloadMe }: { me: Me; reloadMe: () => Promise<void> }) {
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' });
  const [done, setDone] = useState('');
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  return (
    <>
      <h1>Moj račun</h1>
      <p className="sub">{me.user.displayName} · {me.user.email} · {me.tenant?.name}</p>
      {done && <div className="warnbox" role="status">{done}</div>}
      <div className="grid g2">
        <div className="card"><h2>Promjena lozinke</h2>
          <p className="muted">Najmanje 12 znakova. Preporuka: rečenica ili nekoliko nepovezanih riječi. Promjena odjavljuje ostale uređaje.</p>
          <ActionForm submit="Promijeni lozinku" onSubmit={async () => {
            if (pw.next !== pw.repeat) throw new Error('Nova lozinka i ponovljeni unos se ne podudaraju');
            await api('POST', '/me/password', { currentPassword: pw.current, newPassword: pw.next });
            setPw({ current: '', next: '', repeat: '' }); setDone('Lozinka je promijenjena.');
          }}>
            <Field label="Trenutna lozinka"><input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></Field>
            <Field label="Nova lozinka"><input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required /></Field>
            <Field label="Ponovi novu lozinku"><input type="password" autoComplete="new-password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} required /></Field>
          </ActionForm>
        </div>
        <div className="card"><h2>Dvofaktorska prijava (MFA)</h2>
          {me.user.mfaEnabled ? (
            <>
              <p><span className="chip ok">uključena</span> Pri prijavi se traži kod iz aplikacije za autentikaciju.</p>
              <ActionForm submit="Isključi MFA" onSubmit={async () => { await api('POST', '/me/mfa/disable', { code }); setCode(''); setDone('MFA je isključen.'); await reloadMe(); }}>
                <Field label="Trenutni kod (6 znamenki)"><input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required /></Field>
              </ActionForm>
            </>
          ) : setup ? (
            <>
              <ol className="muted" style={{ paddingLeft: 18 }}>
                <li>U aplikaciji za autentikaciju (Microsoft ili Google Authenticator, Aegis, 1Password) dodaj račun ručnim unosom ključa.</li>
                <li>Ključ: <code style={{ userSelect: 'all', wordBreak: 'break-all' }}>{setup.secret}</code> (vrsta: vremenski, 6 znamenki, 30 s)</li>
                <li>Unesi kod koji aplikacija prikazuje.</li>
              </ol>
              <p className="muted" style={{ wordBreak: 'break-all', fontSize: 12 }}>Poveznica za aplikacije koje je podržavaju: <a href={setup.otpauthUri}>{setup.otpauthUri}</a></p>
              <ActionForm submit="Uključi MFA" onSubmit={async () => { await api('POST', '/me/mfa/enable', { code }); setCode(''); setSetup(null); setDone('MFA je uključen. Ostali uređaji su odjavljeni.'); await reloadMe(); }}>
                <Field label="Kod iz aplikacije"><input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required autoFocus /></Field>
              </ActionForm>
            </>
          ) : (
            <>
              <p className="muted">Dvofaktorska prijava štiti račun i kad netko dozna lozinku. Preporučeno za administratore i financije.</p>
              <ActionButton kind="primary" onClick={async () => setSetup(await api<{ secret: string; otpauthUri: string }>('POST', '/me/mfa/setup'))}>Postavi MFA</ActionButton>
            </>
          )}
        </div>
      </div>
    </>
  );
}
