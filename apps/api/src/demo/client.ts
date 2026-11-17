/** Minimalni HTTP klijent prema API-ju koji demo seeder diže u istom procesu (svi podaci idu kroz iste rute, dozvole i pravila kao u sučelju). */

export class DemoApiError extends Error {
  constructor(readonly status: number, method: string, path: string, body: unknown) {
    const b = body as { message?: unknown; issues?: unknown } | null;
    super(`${method} ${path} → ${status}: ${JSON.stringify(b?.message ?? body)}${b?.issues ? ` ${JSON.stringify(b.issues)}` : ''}`);
  }
}

export class DemoApi {
  constructor(private readonly base: string, private readonly token?: string) {}

  static async login(base: string, tenantSlug: string, email: string, password: string): Promise<DemoApi> {
    const r = await new DemoApi(base).req<{ accessToken: string }>('POST', '/auth/login', { tenantSlug, email, password });
    return new DemoApi(base, r.accessToken);
  }

  private headers(): Record<string, string> { return this.token ? { Authorization: `Bearer ${this.token}` } : {}; }

  async req<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}/api${path}`, {
      method, headers: { ...this.headers(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const data: unknown = text ? JSON.parse(text) : null;
    if (!res.ok) throw new DemoApiError(res.status, method, path, data);
    return data as T;
  }

  get<T = Record<string, unknown>>(path: string): Promise<T> { return this.req<T>('GET', path); }
  post<T = Record<string, unknown>>(path: string, body: unknown = {}): Promise<T> { return this.req<T>('POST', path, body); }
  put<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> { return this.req<T>('PUT', path, body); }
  patch<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> { return this.req<T>('PATCH', path, body); }

  /** Prijenos dokumenta (multipart, polje "file") – kao u sučelju. */
  async upload(fields: Record<string, string>, fileName: string, content: Buffer, mime = 'application/pdf'): Promise<{ id: string }> {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    fd.set('file', new Blob([new Uint8Array(content)], { type: mime }), fileName);
    const res = await fetch(`${this.base}/api/documents`, { method: 'POST', headers: this.headers(), body: fd });
    const data: unknown = await res.json();
    if (!res.ok) throw new DemoApiError(res.status, 'POST', '/documents', data);
    return data as { id: string };
  }
}
