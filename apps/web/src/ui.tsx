import { useState, type ReactNode, type FormEvent } from 'react';
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

export function Loading({ what }: { what?: string }) { return <p className="muted">Učitavam{what ? ` ${what}` : ''}…</p>; }

/** Obrazac koji poziva radnju, prikazuje grešku i onemogućuje gumb tijekom slanja. */
export function ActionForm({ onSubmit, children, submit, className }: { onSubmit: () => Promise<unknown>; children: ReactNode; submit: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const handle = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await onSubmit(); } catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={handle} className={className ?? 'form'}>
      {children}
      <div className="actions"><button className="primary" disabled={busy}>{busy ? 'Spremam…' : submit}</button></div>
      <ErrorBox error={error} />
    </form>
  );
}

/** Gumb za jednokratnu radnju s prikazom greške. */
export function ActionButton({ onClick, children, kind, confirm: ask, disabled }: { onClick: () => Promise<unknown>; children: ReactNode; kind?: 'primary' | 'danger'; confirm?: string; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <span className="action-button">
      <button className={kind} disabled={busy || disabled} onClick={async () => {
        if (ask && !window.confirm(ask)) return;
        setBusy(true); setError(null);
        try { await onClick(); } catch (err) { setError(err); } finally { setBusy(false); }
      }}>{children}</button>
      <ErrorBox error={error} />
    </span>
  );
}

export const Field = ({ label: l, children, hint }: { label: string; children: ReactNode; hint?: string }) => (
  <label className="field"><span>{l}</span>{children}{hint && <small className="muted">{hint}</small>}</label>
);

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
