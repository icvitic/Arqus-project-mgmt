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
import { Loading } from './ui';

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
          <a href="#/projekti" className={page === 'projekti' ? 'active' : ''}>Projekti</a>
          <a href="#/organizacije" className={page === 'organizacije' ? 'active' : ''}>Organizacije</a>
          <a href="#/paketi" className={page === 'paketi' ? 'active' : ''}>Paketi programa</a>
          {(me.permissions.includes('*') || me.permissions.includes('users:read')) && <a href="#/korisnici" className={page === 'korisnici' ? 'active' : ''}>Korisnici</a>}
        </nav>
        <div className="spacer" />
        <a href="#/racun" className="muted" style={{ textDecoration: 'none' }} title="Moj račun">{me.user.displayName}{!me.user.mfaEnabled && ' · bez MFA'}</a>
        <button onClick={() => void signOut()}>Odjava</button>
      </header>
      <main>
        {page === 'organizacije' ? <Organisations me={me} />
          : page === 'korisnici' ? <Users me={me} />
          : page === 'paketi' ? <Packages me={me} route={route} />
          : page === 'racun' ? <Account me={me} reloadMe={loadMe} />
          : id ? <ProjectDetail id={id} tab={tab ?? 'pregled'} me={me} />
          : <Projects me={me} />}
      </main>
    </>
  );
}
