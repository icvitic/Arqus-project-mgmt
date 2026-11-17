import { useCallback, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler, token } from './lib/api';
import { go, useRoute } from './lib/hooks';
import type { Me } from './lib/types';
import { Login } from './pages/Login';
import { Projects } from './pages/Projects';
import { ProjectDetail } from './pages/ProjectDetail';
import { Organisations } from './pages/Organisations';
import { Users } from './pages/Users';
import { Account } from './pages/Account';
import { Packages } from './pages/Packages';
import { Radar } from './pages/Radar';
import { Proposals } from './pages/Proposals';
import { Portfolio } from './pages/Portfolio';
import { AuditLog } from './pages/AuditLog';
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
    try { setMe(await api<Me>('GET', '/me')); } catch { token.clear(); } finally { setChecking(false); }
  }, []);
  useEffect(() => { setUnauthorizedHandler(logout); void loadMe(); }, [logout, loadMe]);

  if (checking) return <main><Loading /></main>;
  if (!me) return <Login onLogin={async () => { go(''); await loadMe(); }} />;

  // Početna stranica: portfelj za upravu i ured (portfolio:read institucije), inače popis projekata (WP1.15).
  const [routePage, id, tab] = route;
  const page = routePage ?? (can(me, 'portfolio:read') ? 'portfelj' : 'projekti');
  // WP1.14b: prijave vidi i voditelj prijave bez uloge institucije (samo vlastite).
  const proposals = can(me, 'proposals:read') || !!me.leadProposals?.length;
  return (
    <>
      <header className="top">
        <div className="brand">ArQus Projekti<small>{me.tenant?.name}</small></div>
        <nav>
          {/* Izbornik prikazuje samo ono što korisnik smije otvoriti (WP1.14): radar i prijave su radnje institucije,
              projekti, organizacije i paketi dostupni su i uz ulogu samo na projektu. */}
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
        <a href="#/racun" className="muted" style={{ textDecoration: 'none' }} title="Moj račun">{me.user.displayName}{!me.user.mfaEnabled && ' · bez MFA'}</a>
        <button onClick={() => void signOut()}>Odjava</button>
      </header>
      <main>
        {page === 'racun' ? <Account me={me} reloadMe={loadMe} />
          : page === 'organizacije' ? (canAny(me, 'organisations:read') ? <Organisations me={me} /> : <NoAccess />)
          : page === 'korisnici' ? <Users me={me} />
          : page === 'paketi' ? (canAny(me, 'packages:read') ? <Packages me={me} route={route} /> : <NoAccess />)
          : page === 'radar' ? (can(me, 'calls:read') ? <Radar me={me} route={route} /> : <NoAccess />)
          : page === 'prijave' ? (proposals ? <Proposals me={me} route={route} /> : <NoAccess />)
          : page === 'revizija' ? (can(me, 'audit:read') ? <AuditLog me={me} /> : <NoAccess />)
          : !canAny(me, 'projects:read') ? <NoAccess what="Nemaš pristup nijednom projektu. Administrator ili voditelj projekta može ti dodijeliti ulogu na projektu." />
          : page === 'portfelj' ? <Portfolio me={me} />
          : id ? <ProjectDetail id={id} tab={tab ?? 'pregled'} me={me} />
          : <Projects me={me} />}
      </main>
    </>
  );
}
