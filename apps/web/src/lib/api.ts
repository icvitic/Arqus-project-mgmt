/** Tanki klijent za REST API. Token u sessionStorage (briše se zatvaranjem kartice). */
const KEY = 'arqus.token';

export class ApiError extends Error {
  constructor(public status: number, message: string, public issues: string[] = [], public data: unknown = null) { super(message); }
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
    throw new ApiError(res.status, typeof msg === 'string' ? msg : Array.isArray(msg) ? msg.join(', ') : `Greška ${res.status}`, issuesOf(data), data);
  }
  return data as T;
}

/** Slanje datoteke (multipart); Content-Type s granicom postavlja preglednik. */
export async function upload<T>(path: string, form: FormData): Promise<T> {
  const t = token.get();
  const res = await fetch(`/api${path}`, { method: 'POST', headers: { Accept: 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: form });
  const text = await res.text();
  const data: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401) onUnauthorized();
    const msg = (data as { message?: unknown })?.message;
    throw new ApiError(res.status, res.status === 413 ? 'Datoteka je prevelika (najviše 25 MB)' : typeof msg === 'string' ? msg : `Greška ${res.status}`, issuesOf(data), data);
  }
  return data as T;
}

/** Preuzimanje uz token (poveznica bez zaglavlja ne bi bila ovlaštena): blob → privremeni URL → spremanje. */
export async function downloadFile(path: string, fileName: string): Promise<void> {
  const t = token.get();
  const res = await fetch(`/api${path}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) { if (res.status === 401) onUnauthorized(); throw new ApiError(res.status, `Preuzimanje nije uspjelo (${res.status})`); }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
