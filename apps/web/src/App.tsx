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
import { Loading } from './ui';
import { can, canAny } from './lib/access';

const NoAccess = ({ what }: { what?: string }) => <p className="muted">{what ?? 'Nemaš pristup ovom dijelu sustava.'}</p>;

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(true);
  const route = useRoute();
  const logout = useCallback(() => { token.clear(); setMe(null); go('projekti'); }, []);
  const signOut = useCallback(async () => { try { await api('POST', '/auth/logout'); } catch { /* sesija možda već istekla */ } logout(); }, [logout]);
  const loadMe = useCallback(async () => {
    if (!token.get()) { setChecking(false); return; }
    try { setMe(await api<Me>('GET', '/me')); } catch { token.clear(); } finally { setChecking(false); }
  }, []);
  useEffect(() => { setUnauthorizedHandler(logout); void loadMe(); }, [logout, loadMe]);

  if (checking) return <main><Loading /></main>;
  if (!me) return <Login onLogin={async () => { go('projekti'); await loadMe(); }} />;

  const [page, id, tab] = route;
  return (
    <>
      <header className="top">
        <div className="brand">ArQus Projekti<small>{me.tenant?.name}</small></div>
        <nav>
          {/* Izbornik prikazuje samo ono što korisnik smije otvoriti (WP1.14): radar i prijave su radnje institucije,
              projekti, organizacije i paketi dostupni su i uz ulogu samo na projektu. */}
          {can(me, 'calls:read') && <a href="#/radar" className={page === 'radar' ? 'active' : ''}>Radar poziva</a>}
          {can(me, 'proposals:read') && <a href="#/prijave" className={page === 'prijave' ? 'active' : ''}>Prijave</a>}
          {canAny(me, 'projects:read') && <a href="#/projekti" className={page === 'projekti' ? 'active' : ''}>Projekti</a>}
          {canAny(me, 'organisations:read') && <a href="#/organizacije" className={page === 'organizacije' ? 'active' : ''}>Organizacije</a>}
          {canAny(me, 'packages:read') && <a href="#/paketi" className={page === 'paketi' ? 'active' : ''}>Paketi programa</a>}
          {can(me, 'users:read') && <a href="#/korisnici" className={page === 'korisnici' ? 'active' : ''}>Korisnici</a>}
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
          : page === 'prijave' ? (can(me, 'proposals:read') ? <Proposals me={me} route={route} /> : <NoAccess />)
          : !canAny(me, 'projects:read') ? <NoAccess what="Nemaš pristup nijednom projektu. Administrator ili voditelj projekta može ti dodijeliti ulogu na projektu." />
          : id ? <ProjectDetail id={id} tab={tab ?? 'pregled'} me={me} />
          : <Projects me={me} />}
      </main>
    </>
  );
}
