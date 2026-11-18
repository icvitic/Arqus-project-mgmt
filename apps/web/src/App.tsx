import { useCallback, useEffect, useState } from 'react';
import { api, setMfaRequiredHandler, setUnauthorizedHandler, token } from './lib/api';
import { go, useRoute } from './lib/hooks';
import { setInstitutionTimeZone } from './lib/claims';
import type { Me, MyWork as WorkData, WorkSummary } from './lib/types';
import { Login } from './pages/Login';
import { AccountLink } from './pages/AccountLink';
import { Projects } from './pages/Projects';
import { ProjectDetail } from './pages/ProjectDetail';
import { Organisations } from './pages/Organisations';
import { Users } from './pages/Users';
import { Account, MfaRequired } from './pages/Account';
import { Packages } from './pages/Packages';
import { Radar } from './pages/Radar';
import { Proposals } from './pages/Proposals';
import { Portfolio } from './pages/Portfolio';
import { AuditLog } from './pages/AuditLog';
import { MyWork } from './pages/MyWork';
import { NotificationBell } from './NotificationBell';
import { Loading } from './ui';
import { can, canAny } from './lib/access';

const NoAccess = ({ what }: { what?: string }) => <p className="muted">{what ?? 'Nemaš pristup ovom dijelu sustava.'}</p>;

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(true);
  const route = useRoute();
  const logout = useCallback(() => { token.clear(); setMe(null); go(''); }, []);
  const signOut = useCallback(async () => { try { await api('POST', '/auth/logout'); } catch { /* sesija možda već istekla */ } logout(); }, [logout]);
  const loadMe = useCallback(async () => {
    if (!token.get()) { setChecking(false); return; }
    try { const m = await api<Me>('GET', '/me'); setInstitutionTimeZone(m.tenant?.timeZone); setMe(m); } catch { token.clear(); } finally { setChecking(false); }
  }, []);
  useEffect(() => { setUnauthorizedHandler(logout); setMfaRequiredHandler(() => { void loadMe(); }); void loadMe(); }, [logout, loadMe]);
  // WP1.18: značka „Moj rad” (prošli i bliski rokovi) – pri promjeni stranice (najviše svakih 15 s) i svake 2 minute.
  const [work, setWork] = useState<WorkSummary | null>(null);
  const ready = !!me && !me.mfa?.setupRequired;
  useEffect(() => {
    if (!ready) return;
    let last = 0;
    const refresh = (force = false) => {
      if (!force && Date.now() - last < 15_000) return;
      last = Date.now();
      api<WorkData>('GET', '/me/work').then((w) => setWork(w.summary)).catch(() => undefined);
    };
    refresh(true);
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(true); }, 120_000);
    const onHash = () => refresh();
    window.addEventListener('hashchange', onHash);
    return () => { window.clearInterval(t); window.removeEventListener('hashchange', onHash); };
  }, [ready]);

  // WP1.21: javne stranice s jednokratnim tokenom u fragmentu adrese (pozivnica, nova lozinka) – i bez prijave.
  if (route[0] === 'pozivnica' || route[0] === 'lozinka') {
    return <AccountLink key={route[1] ?? ''} kind={route[0] === 'pozivnica' ? 'invite' : 'reset'} token={route[1] ?? ''} onLoggedIn={async () => { await loadMe(); window.dispatchEvent(new HashChangeEvent('hashchange')); }} />;
  }
  if (checking) return <main><Loading /></main>;
  if (!me) return <Login onLogin={async () => { go(''); await loadMe(); }} />;

  // WP1.19: obvezni MFA nije postavljen – samo postavljanje MFA i odjava (poslužitelj odbija sve ostalo).
  if (me.mfa?.setupRequired) {
    return (
      <>
        <header className="top">
          <div className="brand">ArQus Projekti<small>{me.tenant?.name}</small></div>
          <div className="spacer" />
          <span className="muted">{me.user.displayName}</span>
          <button onClick={() => void signOut()}>Odjava</button>
        </header>
        <main><MfaRequired me={me} reloadMe={loadMe} /></main>
      </>
    );
  }

  // Početna stranica: portfelj za upravu i ured (portfolio:read institucije), inače „Moj rad” (WP1.18).
  const [routePage, id, tab] = route;
  const page = routePage ?? (can(me, 'portfolio:read') ? 'portfelj' : 'moj-rad');
  // WP1.14b: prijave vidi i voditelj prijave bez uloge institucije (samo vlastite).
  const proposals = can(me, 'proposals:read') || !!me.leadProposals?.length;
  return (
    <>
      <header className="top">
        <div className="brand">ArQus Projekti<small>{me.tenant?.name}</small></div>
        <nav>
          {/* Izbornik prikazuje samo ono što korisnik smije otvoriti (WP1.14): radar i prijave su radnje institucije,
              projekti, organizacije i paketi dostupni su i uz ulogu samo na projektu. */}
          <a href="#/moj-rad" className={page === 'moj-rad' ? 'active' : ''}>Moj rad{work && work.attention > 0 && <span className="badge nav-badge" title={`${work.overdue} kasni, ${work.dueSoon} uskoro`}>{work.attention}</span>}</a>
          {canAny(me, 'projects:read') && <a href="#/portfelj" className={page === 'portfelj' ? 'active' : ''}>Portfelj</a>}
          {can(me, 'calls:read') && <a href="#/radar" className={page === 'radar' ? 'active' : ''}>Radar poziva</a>}
          {proposals && <a href="#/prijave" className={page === 'prijave' ? 'active' : ''}>Prijave</a>}
          {canAny(me, 'projects:read') && <a href="#/projekti" className={page === 'projekti' ? 'active' : ''}>Projekti</a>}
          {canAny(me, 'organisations:read') && <a href="#/organizacije" className={page === 'organizacije' ? 'active' : ''}>Organizacije</a>}
          {canAny(me, 'packages:read') && <a href="#/paketi" className={page === 'paketi' ? 'active' : ''}>Paketi programa</a>}
          {can(me, 'users:read') && <a href="#/korisnici" className={page === 'korisnici' ? 'active' : ''}>Korisnici</a>}
          {can(me, 'audit:read') && <a href="#/revizija" className={page === 'revizija' ? 'active' : ''}>Revizija</a>}
        </nav>
        <div className="spacer" />
        <NotificationBell />
        <a href="#/racun" className="muted" style={{ textDecoration: 'none' }} title="Moj račun">{me.user.displayName}{!me.user.mfaEnabled && ' · bez MFA'}</a>
        <button onClick={() => void signOut()}>Odjava</button>
      </header>
      <main>
        {page === 'racun' ? <Account me={me} reloadMe={loadMe} />
          : page === 'moj-rad' ? <MyWork me={me} onSummary={setWork} />
          : page === 'organizacije' ? (canAny(me, 'organisations:read') ? <Organisations me={me} /> : <NoAccess />)
          : page === 'korisnici' ? <Users me={me} />
          : page === 'paketi' ? (canAny(me, 'packages:read') ? <Packages me={me} route={route} /> : <NoAccess />)
          : page === 'radar' ? (can(me, 'calls:read') ? <Radar me={me} route={route} /> : <NoAccess />)
          : page === 'prijave' ? (proposals ? <Proposals me={me} route={route} /> : <NoAccess />)
          : page === 'revizija' ? (can(me, 'audit:read') ? <AuditLog me={me} /> : <NoAccess />)
          : !canAny(me, 'projects:read') ? <NoAccess what="Nemaš pristup nijednom projektu. Administrator ili voditelj projekta može ti dodijeliti ulogu na projektu." />
          : page === 'portfelj' ? <Portfolio me={me} />
          : id ? <ProjectDetail id={id} tab={tab ?? 'pregled'} sub={route.slice(3)} me={me} />
          : <Projects me={me} />}
      </main>
    </>
  );
}
