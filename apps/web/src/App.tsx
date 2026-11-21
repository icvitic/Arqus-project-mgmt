import { useCallback, useEffect, useRef, useState } from 'react';
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
import { Loading, useAccessibleTables, usePageTitle, useRouteFocus } from './ui';
import { Accessibility } from './pages/Accessibility';
import { Privacy } from './pages/Privacy';
import { PersonalData } from './pages/PersonalData';
import wordmark from './brand/arqus-wordmark-dark.svg';
import { ReauthDialog } from './pages/Reauth';
import { can, canAny } from './lib/access';

const NoAccess = ({ what }: { what?: string }) => <><h1>Nema pristupa</h1><p className="muted">{what ?? 'Nemaš pristup ovom dijelu sustava.'}</p></>;

/** WP1.22: naslov kartice preglednika po ruti (WCAG 2.4.2); projekt postavlja vlastiti naslov (akronim i kartica). */
const PAGE_TITLES: Record<string, string> = {
  'moj-rad': 'Moj rad', portfelj: 'Portfelj', radar: 'Radar poziva', prijave: 'Prijave', projekti: 'Projekti', organizacije: 'Organizacije',
  paketi: 'Paketi programa', korisnici: 'Korisnici', revizija: 'Revizija', racun: 'Moj račun', pristupacnost: 'Pristupačnost',
  privatnost: 'Privatnost', 'osobni-podaci': 'Osobni podaci',
};
const SUB_TITLES: Record<string, Record<string, string>> = {
  radar: { novi: 'Novi poziv' }, prijave: { nova: 'Nova prijava' }, 'osobni-podaci': { rokovi: 'Rokovi čuvanja', zahtjevi: 'Zahtjevi ispitanika' }, paketi: { novi: 'Novi paket po pozivu', pregled: 'Paket programa', verzija: 'Nova verzija paketa' },
};
function routeTitle(page: string, id: string | undefined): string | null {
  if (page === 'projekti' && id) return null; // ProjectDetail
  const base = PAGE_TITLES[page] ?? 'ArQus Projekti';
  if (!id) return base;
  const sub = SUB_TITLES[page]?.[id] ?? (page === 'radar' ? 'Poziv' : page === 'prijave' ? 'Prijava' : null);
  return sub ? `${sub} – ${base}` : base;
}

/** WP1.22: podnožje s izjavom o pristupačnosti – i na stranicama bez prijave; WP1.23: i stranica „Privatnost”. */
const SiteFooter = () => (
  <footer className="site"><span>ArQus Projekti</span><a href="#/privatnost">Privatnost</a><a href="#/pristupacnost">Pristupačnost</a></footer>
);

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checking, setChecking] = useState(true);
  const route = useRoute();
  // WP1.22: istek sesije ne briše upisano – iznad zaslona se otvara ponovna prijava istog korisnika (ReauthDialog).
  const [expired, setExpired] = useState(false);
  const meRef = useRef<Me | null>(null);
  meRef.current = me;
  const logout = useCallback(() => { token.clear(); setExpired(false); setMe(null); go(''); }, []);
  const onUnauthorized = useCallback(() => { if (meRef.current && token.get()) setExpired(true); else logout(); }, [logout]);
  const signOut = useCallback(async () => { try { await api('POST', '/auth/logout'); } catch { /* sesija možda već istekla */ } logout(); }, [logout]);
  const loadMe = useCallback(async () => {
    if (!token.get()) { setChecking(false); return; }
    try { const m = await api<Me>('GET', '/me'); setInstitutionTimeZone(m.tenant?.timeZone); setMe(m); } catch { token.clear(); } finally { setChecking(false); }
  }, []);
  useEffect(() => { setUnauthorizedHandler(onUnauthorized); setMfaRequiredHandler(() => { void loadMe(); }); void loadMe(); }, [onUnauthorized, loadMe]);
  useAccessibleTables();
  useRouteFocus(route.join('/'));
  const [routePage0, routeId0] = route;
  const pageKey = routePage0 ?? (me && !me.mfa?.setupRequired ? (can(me, 'portfolio:read') ? 'portfelj' : 'moj-rad') : '');
  usePageTitle(routePage0 === 'pozivnica' ? 'Prihvaćanje pozivnice' : routePage0 === 'lozinka' ? 'Nova lozinka' : !me && routePage0 !== 'pristupacnost' && routePage0 !== 'privatnost' ? 'Prijava'
    : me?.mfa?.setupRequired ? 'Postavi dvofaktorsku prijavu' : routeTitle(pageKey, routeId0));
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
    return <><AccountLink key={route[1] ?? ''} kind={route[0] === 'pozivnica' ? 'invite' : 'reset'} token={route[1] ?? ''} onLoggedIn={async () => { await loadMe(); window.dispatchEvent(new HashChangeEvent('hashchange')); }} /><SiteFooter /></>;
  }
  if (checking) return <main><h1 className="sr-only">ArQus Projekti</h1><Loading /></main>;
  // WP1.22: izjava o pristupačnosti dostupna i bez prijave.
  if (!me && route[0] === 'pristupacnost') return <><main className="statement-page"><Accessibility /></main><SiteFooter /></>;
  // WP1.23: stranica „Privatnost” dostupna i bez prijave.
  if (!me && route[0] === 'privatnost') return <><main className="statement-page"><Privacy /></main><SiteFooter /></>;
  if (!me) return <><Login onLogin={async () => { go(''); await loadMe(); }} /><SiteFooter /></>;

  // WP1.19: obvezni MFA nije postavljen – samo postavljanje MFA i odjava (poslužitelj odbija sve ostalo).
  if (me.mfa?.setupRequired) {
    return (
      <>
        <a className="skip-link" href="#sadrzaj" onClick={(e) => { e.preventDefault(); document.getElementById('sadrzaj')?.focus(); }}>Preskoči na sadržaj</a>
        <header className="top">
          <div className="brand"><img className="brand-logo" src={wordmark} alt="ArQus Solutions" width={298} height={136} /><span className="brand-name">Projekti</span><small>{me.tenant?.name}</small></div>
          <div className="spacer" />
          <div className="user-tools">
            <span className="account">{me.user.displayName}</span>
            <button className="signout" onClick={() => void signOut()}>Odjava</button>
          </div>
        </header>
        <main id="sadrzaj" tabIndex={-1}><MfaRequired me={me} reloadMe={loadMe} /></main>
        <SiteFooter />
      </>
    );
  }

  // Početna stranica: portfelj za upravu i ured (portfolio:read institucije), inače „Moj rad” (WP1.18).
  const [routePage, id, tab] = route;
  const page = routePage ?? (can(me, 'portfolio:read') ? 'portfelj' : 'moj-rad');
  // WP1.14b: prijave vidi i voditelj prijave bez uloge institucije (samo vlastite).
  const proposals = can(me, 'proposals:read') || !!me.leadProposals?.length;
  const current = (p: string) => (page === p ? { className: 'active', 'aria-current': 'page' as const } : {});
  return (
    <>
      {/* WP1.22: prva stavka u redoslijedu tipke Tab (WCAG 2.4.1); hash ruter – fokus se premješta izravno na glavni sadržaj. */}
      <a className="skip-link" href="#sadrzaj" onClick={(e) => { e.preventDefault(); document.getElementById('sadrzaj')?.focus(); }}>Preskoči na sadržaj</a>
      <header className="top">
        <div className="brand"><img className="brand-logo" src={wordmark} alt="ArQus Solutions" width={298} height={136} /><span className="brand-name">Projekti</span><small>{me.tenant?.name}</small></div>
        <nav aria-label="Glavni izbornik">
          {/* Izbornik prikazuje samo ono što korisnik smije otvoriti (WP1.14): radar i prijave su radnje institucije,
              projekti, organizacije i paketi dostupni su i uz ulogu samo na projektu. */}
          <a href="#/moj-rad" {...current('moj-rad')}>Moj rad{work && work.attention > 0 && <span className="badge nav-badge" title={`${work.overdue} kasni, ${work.dueSoon} uskoro`}><span aria-hidden="true">{work.attention}</span><span className="sr-only">: {work.overdue} kasni, {work.dueSoon} uskoro</span></span>}</a>
          {canAny(me, 'projects:read') && <a href="#/portfelj" {...current('portfelj')}>Portfelj</a>}
          {/* WP1.25: skupine izbornika (vidljive u bočnoj traci); naziv skupine je vizualna pomoć, poveznice ostaju redom. */}
          {(can(me, 'calls:read') || proposals) && <span className="nav-label" aria-hidden="true">Prijave na pozive</span>}
          {can(me, 'calls:read') && <a href="#/radar" {...current('radar')}>Radar poziva</a>}
          {proposals && <a href="#/prijave" {...current('prijave')}>Prijave</a>}
          {(canAny(me, 'projects:read') || canAny(me, 'organisations:read') || canAny(me, 'packages:read')) && <span className="nav-label" aria-hidden="true">Provedba</span>}
          {canAny(me, 'projects:read') && <a href="#/projekti" {...current('projekti')}>Projekti</a>}
          {canAny(me, 'organisations:read') && <a href="#/organizacije" {...current('organizacije')}>Organizacije</a>}
          {canAny(me, 'packages:read') && <a href="#/paketi" {...current('paketi')}>Paketi programa</a>}
          {(can(me, 'users:read') || can(me, 'audit:read') || can(me, 'privacy:manage')) && <span className="nav-label" aria-hidden="true">Uprava</span>}
          {can(me, 'users:read') && <a href="#/korisnici" {...current('korisnici')}>Korisnici</a>}
          {can(me, 'audit:read') && <a href="#/revizija" {...current('revizija')}>Revizija</a>}
          {can(me, 'privacy:manage') && <a href="#/osobni-podaci" {...current('osobni-podaci')}>Osobni podaci</a>}
        </nav>
        <div className="spacer" />
        <div className="user-tools">
        <NotificationBell />
        <a href="#/racun" className="account" aria-label={`Moj račun: ${me.user.displayName}${!me.user.mfaEnabled ? ', bez MFA' : ''}`} {...(page === 'racun' ? { 'aria-current': 'page' as const } : {})}>{me.user.displayName}{!me.user.mfaEnabled && ' · bez MFA'}</a>
        <button className="signout" onClick={() => void signOut()}>Odjava</button>
        </div>
      </header>
      <main id="sadrzaj" tabIndex={-1}>
        {page === 'racun' ? <Account me={me} reloadMe={loadMe} />
          : page === 'pristupacnost' ? <Accessibility />
          : page === 'privatnost' ? <Privacy institution={me.tenant?.name} />
          : page === 'osobni-podaci' ? <PersonalData me={me} tab={id} />
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
      <SiteFooter />
      {expired && <ReauthDialog me={me} onDone={async () => { setExpired(false); await loadMe(); }} onSignOut={logout} />}
    </>
  );
}
