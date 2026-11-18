import { useState } from 'react';
import { api, downloadFile } from '../lib/api';
import { dateTime } from '../lib/format';
import { useLoad } from '../lib/hooks';
import type { CalendarStatus, DigestSetting, Me } from '../lib/types';
import { ActionButton, ActionForm, ErrorBox, Field, Loading } from '../ui';

export function Account({ me, reloadMe }: { me: Me; reloadMe: () => Promise<void> }) {
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' });
  const [done, setDone] = useState('');
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
        <MfaCard me={me} reloadMe={reloadMe} onDone={setDone} />
      </div>
      <DigestCard />
      <CalendarCard />
      <MyDataCard me={me} />
    </>
  );
}

/**
 * WP1.21 – dnevni sažetak e-poštom: radnim danom ujutro, samo kad nešto kasni, dospijeva uskoro ili ima novih obavijesti.
 * Zadano uključen; promjena vrijedi odmah (u poruci nema poveznice za odjavu – postavka je ovdje).
 */
function DigestCard() {
  const st = useLoad(() => api<DigestSetting>('GET', '/me/digest'), []);
  return (
    <div className="card digest-card"><h2>Dnevni sažetak e-poštom</h2>
      <ErrorBox error={st.error} />
      {!st.data ? <Loading /> : (
        <>
          <label className="switch-row">
            <input type="checkbox" checked={st.data.enabled} aria-describedby="digest-hint" onChange={async (e) => { try { st.setData(await api<DigestSetting>('PUT', '/me/digest', { enabled: e.target.checked })); } catch (err) { alert((err as Error).message); } }} />
            <span><b>{st.data.enabled ? 'Uključen' : 'Isključen'}</b> – jedna poruka radnim danom u {st.data.hour}:00, samo kad nešto kasni, dospijeva u sljedećih 30 dana ili imaš novu obavijest.</span>
          </label>
          <p className="muted" id="digest-hint">Sadrži iste stavke kao „Moj rad” (naslove i rokove, bez iznosa) i poveznicu u aplikaciju.{!st.data.mailEnabled && ' Ova instalacija trenutno ne šalje e-poštu – postavka će vrijediti kad administrator uključi slanje.'}</p>
        </>
      )}
    </div>
  );
}

/**
 * WP1.18 – osobni kalendar rokova (iCalendar) za Outlook, Google Kalendar ili Apple Kalendar. Poveznica sadrži tajni token
 * i prikazuje se samo jednom, odmah nakon stvaranja; nova poveznica poništava staru, „Ukloni” je gasi.
 */
function CalendarCard() {
  const st = useLoad(() => api<CalendarStatus>('GET', '/me/calendar'), []);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const generate = async () => {
    const r = await api<CalendarStatus>('POST', '/me/calendar');
    setFresh(`${window.location.origin}${r.path}`); setCopied(false); st.setData(r);
  };
  const copy = async () => { if (!fresh) return; try { await navigator.clipboard.writeText(fresh); setCopied(true); } catch { setCopied(false); } };
  return (
    <div className="card calendar-card"><h2>Rokovi u mom kalendaru</h2>
      <p className="muted">Poveznica pretplate prikazuje rokove koje i inače vidiš (izvještajna razdoblja i rokovi ZNS-a, isporuke i prekretnice tvojih projekata, interni rokovi i rokovi poziva i prijava) – samo naslove i datume, bez iznosa. Tko ima poveznicu, vidi te rokove bez prijave: ne dijeli je i ukloni je ako je netko drugi dobije.</p>
      <ErrorBox error={st.error} />
      {!st.data ? <Loading /> : (
        <>
          {fresh ? (
            <div className="calendar-link">
              <p><b>Kopiraj poveznicu sada</b> – iz sigurnosnih razloga više se neće prikazati (u sustavu je spremljen samo njezin otisak).</p>
              <div className="copy-row">
                <input readOnly value={fresh} onFocus={(e) => e.currentTarget.select()} aria-label="Poveznica kalendara" data-testid="calendar-url" />
                <button className="primary" onClick={() => void copy()}>{copied ? 'Kopirano' : 'Kopiraj'}</button>
              </div>
              <p className="muted">Outlook: „Dodaj kalendar” → „Pretplati se s weba”. Google Kalendar: „Ostali kalendari” → „+” → „Iz URL-a”. Kalendar se osvježava sam (obično svakih nekoliko sati).</p>
            </div>
          ) : st.data.active ? (
            <p><span className="chip ok">aktivna</span> Poveznica je stvorena {dateTime(st.data.createdAt)}{st.data.lastUsedAt ? `, zadnji dohvat ${dateTime(st.data.lastUsedAt)}` : ', još nije dohvaćena'}.</p>
          ) : <p className="muted">Poveznica još ne postoji.</p>}
          <div className="actions">
            <ActionButton kind={st.data.active ? undefined : 'primary'} confirm={st.data.active ? 'Nova poveznica odmah poništava staru – kalendari koji koriste staru prestat će se osvježavati. Nastaviti?' : undefined} onClick={generate}>{st.data.active ? 'Stvori novu poveznicu' : 'Stvori poveznicu'}</ActionButton>
            {st.data.active && <ActionButton kind="danger" confirm="Ukloniti poveznicu? Kalendari koji je koriste prestat će se osvježavati." onClick={async () => { st.setData(await api<CalendarStatus>('DELETE', '/me/calendar')); setFresh(null); }}>Ukloni poveznicu</ActionButton>}
          </div>
        </>
      )}
    </div>
  );
}

/** Postavljanje i isključivanje MFA (TOTP) – na stranici računa i na obveznom postavljanju (WP1.19). */
export function MfaCard({ me, reloadMe, onDone }: { me: Me; reloadMe: () => Promise<void>; onDone: (msg: string) => void }) {
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const setDone = onDone;
  return (
    <div className="card"><h2>Dvofaktorska prijava (MFA)</h2>
      {me.user.mfaEnabled ? (
        <>
          <p><span className="chip ok">uključena</span> Pri prijavi se traži kod iz aplikacije za autentikaciju.</p>
          {me.mfa?.required ? <p className="muted">Institucija zahtijeva MFA za tvoju ulogu, pa se ne može isključiti.</p> : (
            <ActionForm submit="Isključi MFA" onSubmit={async () => { await api('POST', '/me/mfa/disable', { code }); setCode(''); setDone('MFA je isključen. Ostali uređaji su odjavljeni.'); await reloadMe(); }}>
              <Field label="Trenutni kod (6 znamenki)"><input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required /></Field>
            </ActionForm>
          )}
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
          <p className="muted">Dvofaktorska prijava štiti račun i kad netko dozna lozinku. {me.mfa?.required ? 'Institucija je zahtijeva za tvoju ulogu.' : 'Preporučeno za administratore i financije.'}</p>
          <ActionButton kind="primary" onClick={async () => setSetup(await api<{ secret: string; otpauthUri: string }>('POST', '/me/mfa/setup'))}>Postavi MFA</ActionButton>
        </>
      )}
    </div>
  );
}

/**
 * WP1.19: obvezno postavljanje MFA. Institucija zahtijeva MFA za korisnikovu ulogu, a on ga još nema – poslužitelj do tada
 * odbija sve osim vlastitog računa i odjave, pa sučelje nudi samo ovo.
 */
export function MfaRequired({ me, reloadMe }: { me: Me; reloadMe: () => Promise<void> }) {
  const [done, setDone] = useState('');
  const why = me.mfa?.policy === 'all' ? 'za sve korisnike' : 'za uloge s pristupom administraciji, plaćama, reviziji ili financijskim izmjenama';
  return (
    <>
      <h1>Postavi dvofaktorsku prijavu</h1>
      <div className="warnbox" role="alert">
        <b>Tvoja institucija zahtijeva dvofaktorsku prijavu (MFA) {why}.</b> Dok je ne postaviš, sustav je zaključan: dostupni su samo ovaj korak i odjava.
        Treba ti aplikacija za autentikaciju na mobitelu (npr. Microsoft ili Google Authenticator, Aegis). Postavljanje traje minutu; nakon toga se pri svakoj prijavi uz lozinku upisuje kod iz aplikacije.
      </div>
      {done && <div className="warnbox" role="status">{done}</div>}
      <div className="grid g2"><MfaCard me={me} reloadMe={reloadMe} onDone={setDone} /></div>
    </>
  );
}

/**
 * WP1.23 – samoposluga prava na pristup: korisnik preuzima vlastite podatke (ZIP: JSON, Excel, sažetak). Iznosi plaće i
 * troška osoblja samo ako ih korisnik i inače vidi (pristup podacima o plaćama) – potpun izvoz izrađuje institucija.
 */
function MyDataCard({ me }: { me: Me }) {
  const seesSalaries = me.permissions.includes('*') || me.permissions.includes('personnel:read');
  return (
    <div className="card my-data-card"><h2>Moji podaci</h2>
      <p className="muted">Preuzmi sve što ArQus Projekti drži o tebi: račun, uloge, sesije (IP adresa i preglednik), članstva u timovima, timesheetove, odgovornosti, obavijesti i revizijski zapis tvojih radnji – kao strojno čitljiv JSON, Excel i čitljiv sažetak. {seesSalaries ? 'Izvoz uključuje iznose plaće i troška osoblja jer ih i inače vidiš.' : 'Iznosi plaće i troška osoblja nisu uključeni (kao ni u sučelju) – potpun izvoz možeš zatražiti od institucije.'} Što se obrađuje i kako ostvariti prava: <a href="#/privatnost">Privatnost</a>.</p>
      <div className="actions"><ActionButton onClick={() => downloadFile('/me/privacy-export', 'moji-podaci.zip')}>Preuzmi moje podatke (ZIP)</ActionButton></div>
    </div>
  );
}
