import { useState, type ReactNode, type FormEvent } from 'react';
import { ApiError } from './lib/api';
import { label } from './lib/format';

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

export const Chip = ({ s, tone }: { s: string; tone?: string }) => (
  <span className={`chip ${tone ?? ({ active: 'ok', approved: 'ok', accepted: 'ok', achieved: 'ok', done: 'ok', submitted: 'acc', claimed: 'acc', locked: 'acc', rejected: 'bad', terminated: 'bad', missed: 'bad', high: 'bad', medium: 'warn', partially_approved: 'warn', draft: 'warn', contracting: 'warn' } as Record<string, string>)[s] ?? ''}`}>{label(s)}</span>
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
export function ActionButton({ onClick, children, kind, confirm: ask }: { onClick: () => Promise<unknown>; children: ReactNode; kind?: 'primary' | 'danger'; confirm?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <span className="action-button">
      <button className={kind} disabled={busy} onClick={async () => {
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
