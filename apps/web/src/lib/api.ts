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

/** Naziv datoteke iz zaglavlja Content-Disposition (`filename*=UTF-8''…` ima prednost). */
export function fileNameFrom(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star) { try { return decodeURIComponent(star[1]!); } catch { /* neispravno kodiranje */ } }
  const plain = /filename="([^"]+)"/i.exec(header);
  return plain ? plain[1]! : null;
}

/** Odgovor s greškom → ApiError s porukom poslužitelja (npr. 409 kod izvoza). */
async function failure(res: Response, fallback: string): Promise<ApiError> {
  if (res.status === 401) onUnauthorized();
  let data: unknown = null;
  try { data = JSON.parse(await res.text()); } catch { /* nije JSON */ }
  const msg = (data as { message?: unknown })?.message;
  return new ApiError(res.status, typeof msg === 'string' ? msg : `${fallback} (${res.status})`, issuesOf(data), data);
}

/**
 * Preuzimanje uz token (poveznica bez zaglavlja ne bi bila ovlaštena): blob → privremeni URL → spremanje.
 * Naziv: iz odgovora poslužitelja (Content-Disposition), inače `fileName`.
 */
export async function downloadFile(path: string, fileName: string): Promise<void> {
  const t = token.get();
  const res = await fetch(`/api${path}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) throw await failure(res, 'Preuzimanje nije uspjelo');
  const name = fileNameFrom(res.headers.get('Content-Disposition')) ?? fileName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Tekstualni odgovor (npr. evidencija rada za ispis kao HTML). */
export async function apiText(path: string): Promise<string> {
  const t = token.get();
  const res = await fetch(`/api${path}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });
  if (!res.ok) throw await failure(res, 'Učitavanje nije uspjelo');
  return res.text();
}
