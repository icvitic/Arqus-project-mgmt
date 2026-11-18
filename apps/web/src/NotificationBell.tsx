import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './lib/api';
import { dateTime } from './lib/format';
import { go } from './lib/hooks';
import type { AppNotification, NotificationPage } from './lib/types';
import { announce } from './ui';

/** Koliko često se provjerava broj nepročitanih (dok je kartica vidljiva). */
const POLL_MS = 60_000;

const Bell = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
);

/**
 * WP1.18 – zvonce u zaglavlju: broj nepročitanih obavijesti i kratak popis najnovijih. Klik na obavijest je označava
 * pročitanom i vodi na mjesto događaja. Obavijesti su samo događaji koji su se dogodili korisniku (ne stanje – to je „Moj rad”).
 */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<NotificationPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const load = useCallback(async () => {
    try { setData(await api<NotificationPage>('GET', '/me/notifications?limit=8')); setError(null); } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    const onHash = () => setOpen(false);
    window.addEventListener('hashchange', onHash);
    return () => { window.clearInterval(t); window.removeEventListener('hashchange', onHash); };
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    // WP1.22: Escape zatvara i vraća fokus na zvonce (fokus ne ostaje na elementu koji je nestao).
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { const inside = !!box.current?.contains(document.activeElement); setOpen(false); if (inside) button.current?.focus(); } };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const unread = data?.unread ?? 0;
  const follow = async (n: AppNotification) => {
    if (!n.read) { try { await api('POST', `/me/notifications/${n.id}/read`); } catch { /* i bez oznake vodi dalje */ } }
    setOpen(false); void load();
    if (n.link) go(n.link);
  };
  return (
    <div className="bell-wrap" ref={box}>
      <button ref={button} className="bell" aria-label={`Obavijesti${unread ? ` – ${unread} nepročitanih` : ''}`} aria-haspopup="dialog" aria-expanded={open} aria-controls="notifications-panel" onClick={() => { setOpen(!open); if (!open) void load(); }}>
        <Bell />{unread > 0 && <span className="badge" data-testid="unread" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="dropdown" id="notifications-panel" role="dialog" aria-label="Obavijesti" onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node | null) && e.relatedTarget) setOpen(false); }}>
          <div className="dropdown-head">
            <b>Obavijesti</b>
            {unread > 0 && <button className="link" onClick={async () => { await api('POST', '/me/notifications/read-all'); await load(); announce('Sve obavijesti su označene pročitanima.'); }}>Označi sve pročitanim</button>}
          </div>
          {error && <p className="muted">{error}</p>}
          {!data ? <p className="muted">Učitavam…</p> : !data.items.length ? <p className="muted dropdown-empty">Nema obavijesti. Ovdje se pojavljuje kad ti netko odobri ili vrati timesheet, vrati ili odluči o ZNS-u koji si predao, dodijeli pristup projektu ili te imenuje voditeljem.</p> : (
            <ul className="notes">
              {data.items.map((n) => (
                <li key={n.id} className={n.read ? 'read' : 'unread'}>
                  <button className="note" onClick={() => void follow(n)}>
                    <span className="note-title">{!n.read && <><i className="dot" aria-hidden="true" /><span className="sr-only">Nepročitano: </span></>}{n.title}</span>
                    {n.detail && <span className="note-detail muted">{n.detail}</span>}
                    <span className="note-when muted">{dateTime(n.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
