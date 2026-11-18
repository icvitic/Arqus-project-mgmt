import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode, type FormEvent } from 'react';
import { ApiError } from './lib/api';
import { dateTime, label } from './lib/format';

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as Error;
  const issues = e instanceof ApiError ? e.issues : [];
  return (
    <div className="alert" role="alert">
      <b>{e.message}</b>
      {issues.length > 0 && <ul>{issues.map((i) => <li key={i}>{i}</li>)}</ul>}
    </div>
  );
}

/** Oznaka statusa; `f` – imenica ženskog roda (prijava, isporuka, prekretnica), WP1.14b. */
export const Chip = ({ s, tone, f }: { s: string; tone?: string; f?: boolean }) => (
  <span className={`chip ${tone ?? ({ active: 'ok', approved: 'ok', accepted: 'ok', achieved: 'ok', done: 'ok', submitted: 'acc', claimed: 'acc', locked: 'acc', rejected: 'bad', terminated: 'bad', missed: 'bad', high: 'bad', medium: 'warn', partially_approved: 'warn', partially_accepted: 'warn', draft: 'warn', contracting: 'warn' } as Record<string, string>)[s] ?? ''}`}>{label(s, f ? 'f' : 'm')}</span>
);

/** WP1.19: umjesto iznosa troška osoblja korisniku bez pristupa podacima o osoblju. */
export const HiddenAmount = () => <span className="muted" title="Iznos troška osoblja vidljiv je samo uz pristup podacima o osoblju (personnel:read). Sati su u opisu, zbroj kategorije na kartici „Ugovoreno / ostvareno”.">skriveno</span>;

export function Loading({ what }: { what?: string }) { return <p className="muted" role="status">Učitavam{what ? ` ${what}` : ''}…</p>; }

/* ---------- WP1.22: pristupačnost – zajednički dijelovi (WCAG 2.1 AA, docs/PRISTUPACNOST.md) ---------- */

/**
 * Statusne poruke bez pomicanja fokusa (WCAG 4.1.3): spremljeno, predano, kopirano, neuspjelo. Jedno područje `aria-live`
 * za cijelu aplikaciju (`<Announcer />` u korijenu); ista poruka dvaput zaredom ponovno se izgovara.
 */
const listeners = new Set<(m: { text: string; n: number }) => void>();
let seq = 0;
export function announce(text: string): void { seq++; for (const l of listeners) l({ text, n: seq }); }
export function Announcer() {
  const [m, setM] = useState<{ text: string; n: number } | null>(null);
  useEffect(() => { const l = (x: { text: string; n: number }) => setM(x); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return <div id="announcer" className="sr-only" role="status" aria-live="polite" aria-atomic="true">{m ? <span key={m.n}>{m.text}</span> : null}</div>;
}

/** Naslov kartice preglednika po zaslonu (WCAG 2.4.2): „Naslov – ArQus Projekti”. */
export function usePageTitle(title: string | null | undefined): void {
  useEffect(() => { if (title) document.title = `${title} – ArQus Projekti`; }, [title]);
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
const focusables = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => !e.hidden && (e.offsetWidth || e.offsetHeight || e.getClientRects().length));

/**
 * Modalni dijalog (WCAG 2.1.1, 2.1.2, 2.4.3): pri otvaranju fokus na prvi element u dijalogu, Tab i Shift+Tab kruže
 * unutar njega, Escape zatvara, a nakon zatvaranja fokus se vraća na element koji ga je otvorio.
 */
export function Dialog({ title, onClose, children, className, initialFocus }: { title: ReactNode; onClose: () => void; children: ReactNode; className?: string; initialFocus?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const box = ref.current;
    if (box) ((initialFocus ? box.querySelector<HTMLElement>(initialFocus) : null) ?? focusables(box)[0] ?? box).focus();
    return () => { if (trigger && document.contains(trigger)) trigger.focus(); };
  }, [initialFocus]);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab' || !ref.current) return;
    const list = focusables(ref.current);
    if (!list.length) { e.preventDefault(); return; }
    const first = list[0]!, last = list[list.length - 1]!;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <div className="dialog-backdrop" onKeyDown={onKeyDown}>
      <div className={`dialog card ${className ?? ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref}>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/**
 * Kartice (WCAG 2.1.1, 4.1.2; obrazac ARIA „tabs”): svaka kartica je poveznica (adresa ostaje u povijesti preglednika);
 * u traci je jedna u redoslijedu tipke Tab, strelice lijevo/desno, Home i End premještaju fokus i otvaraju karticu.
 */
export function TabList({ label, tabs, active }: { label: string; tabs: { key: string; label: string; href: string }[]; active: string }) {
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const move = (e: ReactKeyboardEvent, i: number) => {
    const n = tabs.length;
    const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    refs.current[to]?.focus();
    window.location.hash = tabs[to]!.href;
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t, i) => (
        <a key={t.key} id={`tab-${t.key}`} role="tab" aria-selected={active === t.key} aria-controls="tabpanel" tabIndex={active === t.key ? 0 : -1}
          ref={(el) => { refs.current[i] = el; }} href={t.href} className={active === t.key ? 'active' : ''} onKeyDown={(e) => move(e, i)}>{t.label}</a>
      ))}
    </div>
  );
}
export const TabPanel = ({ active, children }: { active: string; children: ReactNode }) => <div role="tabpanel" id="tabpanel" aria-labelledby={`tab-${active}`}>{children}</div>;

/**
 * Tablice i druga područja koja se pomiču vodoravno (`.scroll`, WCAG 1.4.10, 2.1.1): dok se sadržaj stvarno ne stane,
 * područje je označeno (naziv iz naslova kartice) i dostupno tipkovnicom, pa se pomiče strelicama. Tablica bez naziva
 * dobiva naziv iz naslova kartice, a zaglavlja stupaca opseg `col` (WCAG 1.3.1). Jedan promatrač za cijelu aplikaciju.
 */
export function useAccessibleTables(): void {
  useEffect(() => {
    let frame = 0;
    const headingOf = (el: Element) => (el.closest('.card, section')?.querySelector('h2, h3')?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const sync = () => {
      frame = 0;
      for (const el of document.querySelectorAll<HTMLElement>('.scroll')) {
        const overflow = el.scrollWidth > el.clientWidth + 1;
        if (overflow && el.getAttribute('role') !== 'region') {
          el.setAttribute('role', 'region'); el.tabIndex = 0;
          el.setAttribute('aria-label', `${headingOf(el) || 'Tablica'} (pomiče se vodoravno)`);
        } else if (!overflow && el.getAttribute('role') === 'region') {
          el.removeAttribute('role'); el.removeAttribute('tabindex'); el.removeAttribute('aria-label');
        }
      }
      for (const t of document.querySelectorAll<HTMLTableElement>('table')) {
        if (!t.caption && !t.hasAttribute('aria-label') && !t.hasAttribute('aria-labelledby')) { const h = headingOf(t); if (h) t.setAttribute('aria-label', h); }
        for (const th of t.querySelectorAll('thead th:not([scope])')) th.setAttribute('scope', 'col');
      }
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', schedule);
    schedule();
    return () => { mo.disconnect(); window.removeEventListener('resize', schedule); if (frame) cancelAnimationFrame(frame); };
  }, []);
}

/**
 * Fokus pri promjeni stranice (hash usmjeravanje, WCAG 2.4.3): nakon prelaska fokus ide na naslov nove stranice (h1) čim se
 * pojavi, inače na glavni sadržaj – čitač zaslona izgovara gdje je korisnik, a Tab nastavlja od sadržaja, ne od vrha.
 * Ne pomiče fokus kad se kartica mijenja strelicama (fokus ostaje u traci kartica) ni pri prvom učitavanju.
 */
export function useRouteFocus(key: string): void {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (document.activeElement?.closest('[role="tablist"]')) return;
    let tries = 0;
    const t = window.setInterval(() => {
      const h1 = document.querySelector<HTMLElement>('main h1');
      const main = document.querySelector<HTMLElement>('main');
      if (h1 || tries++ > 20) {
        window.clearInterval(t);
        const target = h1 ?? main;
        if (!target || document.activeElement?.closest('[role="dialog"]')) return;
        if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
        target.focus({ preventScroll: false });
      }
    }, 50);
    return () => window.clearInterval(t);
  }, [key]);
}

/** Obrazac koji poziva radnju, prikazuje grešku i onemogućuje gumb tijekom slanja. */
export function ActionForm({ onSubmit, children, submit, className }: { onSubmit: () => Promise<unknown>; children: ReactNode; submit: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const handle = async (e: FormEvent) => {
    e.preventDefault(); if (busy) return; setBusy(true); setError(null);
    try { await onSubmit(); announce(`${submit}: gotovo.`); } catch (err) { setError(err); announce(`${submit}: nije uspjelo.`); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={handle} className={className ?? 'form'} aria-busy={busy || undefined}>
      {children}
      {/* WP1.22: tijekom slanja aria-disabled umjesto disabled – onemogućen gumb gubi fokus (fokus bi pao na početak stranice). */}
      <div className="actions"><button className="primary" aria-disabled={busy || undefined}>{busy ? 'Spremam…' : submit}</button></div>
      <ErrorBox error={error} />
    </form>
  );
}

/** Gumb za jednokratnu radnju s prikazom greške. */
export function ActionButton({ onClick, children, kind, confirm: ask, disabled, label: name }: { onClick: () => Promise<unknown>; children: ReactNode; kind?: 'primary' | 'danger'; confirm?: string; disabled?: boolean; /** WP1.22: puni naziv gumba kad vidljivi tekst sam nije dovoljan (npr. „×”, „→ predana”). */ label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <span className="action-button">
      <button className={kind} disabled={disabled} aria-disabled={busy || undefined} aria-label={name} onClick={async () => {
        if (busy) return;
        if (ask && !window.confirm(ask)) return;
        setBusy(true); setError(null);
        try { await onClick(); if (name || typeof children === 'string') announce(`${name ?? children}: gotovo.`); } catch (err) { setError(err); } finally { setBusy(false); }
      }}>{children}</button>
      <ErrorBox error={error} />
    </span>
  );
}

/**
 * Polje obrasca s programskom oznakom (WCAG 1.3.1, 3.3.2). Uputa (`hint`) nije dio naziva polja nego njegov opis
 * (`aria-describedby`) – čitač zaslona izgovara naziv, pa uputu.
 */
export function Field({ label: l, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const id = useId();
  if (!isValidElement(children)) return <label className="field"><span>{l}</span>{children}{hint && <small className="muted">{hint}</small>}</label>;
  const child = children as ReactElement<{ id?: string; 'aria-describedby'?: string }>;
  const controlId = child.props.id ?? `${id}-c`;
  const hintId = `${id}-h`;
  return (
    <div className="field">
      <label htmlFor={controlId}>{l}</label>
      {cloneElement(child, { id: controlId, ...(hint ? { 'aria-describedby': [child.props['aria-describedby'], hintId].filter(Boolean).join(' ') } : {}) })}
      {hint && <small id={hintId} className="muted">{hint}</small>}
    </div>
  );
}

/** WP1.14b: je li greška sukob revizija – netko je u međuvremenu spremio isti zapis (409, `code: revision_conflict`). */
export const isConflict = (e: unknown): e is ApiError => e instanceof ApiError && e.status === 409 && (e.data as { code?: unknown } | null)?.code === 'revision_conflict';

/**
 * Stanje sukoba u obrascu (WP1.14b): tko je i kada spremio, vlastiti nespremljeni unos (`mine`) i stanje koje je korisnik
 * bio učitao prije svojih izmjena (`base`) – tako se zna što je korisnik sam promijenio (trosmjerna usporedba).
 */
export interface Conflict<T> { who: string; when: string | null; mine: T; base: T; reloaded: boolean }

export function conflictOf<T>(e: ApiError, mine: T, base: T): Conflict<T> {
  const c = (e.data as { conflict?: { updatedBy?: { displayName?: string } | null; updatedAt?: string | null } } | null)?.conflict;
  return { who: c?.updatedBy?.displayName ?? 'drugi korisnik', when: c?.updatedAt ?? null, mine, base, reloaded: false };
}

/** Polja koja je korisnik sam promijenio (vlastiti unos ≠ učitano stanje) – `same` uspoređuje vrijednosti (npr. iznose). */
export function editedKeys(mine: Record<string, string>, base: Record<string, string>, same: (a: string | undefined, b: string | undefined) => boolean = (a, b) => (a ?? '') === (b ?? '')): string[] {
  return [...new Set([...Object.keys(mine), ...Object.keys(base)])].filter((k) => !same(mine[k], base[k]));
}

/**
 * Obavijest o istovremenoj izmjeni (WP1.14b). Ništa nije spremljeno; korisnik učitava najnovije stanje, a vlastite izmjene
 * i dalje vidi (polje, tvoj unos, sada spremljeno) i može ih primijeniti na najnovije stanje te svjesno spremiti ponovno.
 */
export function ConflictNotice({ conflict, what, diff, onReload, onRestore, onDismiss }: {
  /** Što je promijenjeno, u akuzativu („Proračun”, „Prijavu”, „Timesheet”). */
  conflict: Conflict<unknown>; what: string; diff: { label: string; mine: string; now: string }[];
  onReload: () => Promise<unknown>; onRestore?: () => void; onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const stamp = conflict.when ? dateTime(conflict.when) : null;
  return (
    <div className="alert conflict" role="alert" aria-live="assertive">
      {conflict.reloaded
        ? <><b>Učitano je najnovije stanje</b> – ono koje je spremio korisnik {conflict.who}{stamp ? ` (${stamp})` : ''}.</>
        : <><b>Tvoje izmjene nisu spremljene.</b> {what} je u međuvremenu promijenio korisnik {conflict.who}{stamp ? ` (${stamp})` : ''}. Učitaj najnovije stanje – tvoj unos ostaje prikazan ovdje.</>}
      {conflict.reloaded && (diff.length
        ? <><p style={{ margin: '8px 0 4px' }}>Tvoje nespremljene izmjene:</p>
          <table className="conflict-diff"><thead><tr><th>Polje</th><th>Tvoj unos</th><th>Sada spremljeno</th></tr></thead>
            <tbody>{diff.map((d) => <tr key={d.label}><td>{d.label}</td><td><b>{d.mine || '–'}</b></td><td>{d.now || '–'}</td></tr>)}</tbody></table></>
        : <p style={{ margin: '8px 0 0' }}>Tvoje izmjene već su sadržane u spremljenom stanju.</p>)}
      <div className="actions">
        {!conflict.reloaded && <button className="primary" disabled={busy} onClick={async () => { setBusy(true); try { await onReload(); } finally { setBusy(false); } }}>Učitaj najnovije stanje</button>}
        {conflict.reloaded && onRestore && diff.length > 0 && <button className="primary" onClick={onRestore}>Primijeni moje izmjene na najnovije stanje</button>}
        <button onClick={onDismiss}>{conflict.reloaded ? 'Zatvori' : 'Odustani'}</button>
      </div>
    </div>
  );
}
