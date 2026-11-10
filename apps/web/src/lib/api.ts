/** Tanki klijent za REST API. Token u sessionStorage (briše se zatvaranjem kartice). */
const KEY = 'arqus.token';

export class ApiError extends Error {
  constructor(public status: number, message: string, public issues: string[] = []) { super(message); }
}

export const token = {
  get(): string | null { try { return sessionStorage.getItem(KEY); } catch { return null; } },
  set(t: string): void { try { sessionStorage.setItem(KEY, t); } catch { /* privatni način */ } },
  clear(): void { try { sessionStorage.removeItem(KEY); } catch { /* ništa */ } },
};

let onUnauthorized: () => void = () => undefined;
export function setUnauthorizedHandler(fn: () => void): void { onUnauthorized = fn; }

function issuesOf(body: unknown): string[] {
  const raw = (body as { issues?: unknown })?.issues;
  if (!Array.isArray(raw)) return [];
  return raw.map((i) => (typeof i === 'string' ? i : `${(i as { path?: string }).path ?? ''} ${(i as { message?: string }).message ?? ''}`.trim()));
}

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const t = token.get();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') onUnauthorized();
    const msg = (data as { message?: unknown })?.message;
    throw new ApiError(res.status, typeof msg === 'string' ? msg : Array.isArray(msg) ? msg.join(', ') : `Greška ${res.status}`, issuesOf(data));
  }
  return data as T;
}
