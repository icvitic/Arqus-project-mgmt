import { useCallback, useEffect, useState } from 'react';

/** Učitavanje podataka s ponovnim učitavanjem; greške se prikazuju, ne bacaju. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(fn, deps);
  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await load()); setError(null); } catch (e) { setError(e as Error); } finally { setLoading(false); }
  }, [load]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

/** Hash usmjeravanje: #/projekti/<id>/<kartica>. */
export function useRoute(): string[] {
  const parse = () => (window.location.hash.replace(/^#\/?/, '') || 'projekti').split('/').filter(Boolean);
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
export const go = (path: string): void => { window.location.hash = `#/${path}`; };
