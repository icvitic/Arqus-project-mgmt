import { useCallback, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler, token } from './lib/api';
import { go, useRoute } from './lib/hooks';
import type { Me } from './lib/types';
import { Login } from './pages/Login';
import { Projects } from './pages/Projects';
import { ProjectDetail } from './pages/ProjectDetail';
import { Organisations } from './pages/Organisations';
import { Loading } from './ui';

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(true);
  const route = useRoute();
  const logout = useCallback(() => { token.clear(); setMe(null); }, []);
  const loadMe = useCallback(async () => {
    if (!token.get()) { setChecking(false); return; }
    try { setMe(await api<Me>('GET', '/me')); } catch { token.clear(); } finally { setChecking(false); }
  }, []);
  useEffect(() => { setUnauthorizedHandler(logout); void loadMe(); }, [logout, loadMe]);

  if (checking) return <main><Loading /></main>;
  if (!me) return <Login onLogin={async () => { await loadMe(); go('projekti'); }} />;

  const [page, id, tab] = route;
  return (
    <>
      <header className="top">
        <div className="brand">ArQus Projekti<small>{me.tenant?.name}</small></div>
        <nav>
          <a href="#/projekti" className={page === 'projekti' ? 'active' : ''}>Projekti</a>
          <a href="#/organizacije" className={page === 'organizacije' ? 'active' : ''}>Organizacije</a>
        </nav>
        <div className="spacer" />
        <span className="muted">{me.user.displayName}</span>
        <button onClick={logout}>Odjava</button>
      </header>
      <main>
        {page === 'organizacije' ? <Organisations me={me} />
          : id ? <ProjectDetail id={id} tab={tab ?? 'pregled'} me={me} />
          : <Projects me={me} />}
      </main>
    </>
  );
}
