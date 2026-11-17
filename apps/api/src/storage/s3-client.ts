import { createReadStream } from 'node:fs';
import { PassThrough, Readable } from 'node:stream';
import { amzDate, canonicalQuery, EMPTY_SHA256, sha256Hex, sign, uriEncode } from './sigv4';

/**
 * Minimalni S3 klijent (WP1.20) nad Node `fetch` i `sigv4.ts`: put (Buffer ili datoteka), get kao tok, head, delete,
 * popis s nastavkom (ListObjectsV2). Namjerno bez vanjskih ovisnosti; podržano je samo ono što aplikacija treba.
 *
 * Pouzdanost: svaki zahtjev ima vremensko ograničenje (do zaglavlja odgovora, a za tijelo – najdulja stanka između
 * dijelova), a ponavljanje (najviše `retries` puta, s rastućom stankom) samo za idempotentne operacije s ponovljivim
 * tijelom: GET, HEAD, DELETE, popis i PUT cijelog objekta pod istim ključem (isti sadržaj → isti rezultat).
 * Ponavlja se pri mrežnoj grešci, isteku vremena, 5xx i 429; 4xx (osim 429) nikad.
 * Tajni ključ nikad ne ulazi u poruke grešaka ni zapise.
 */

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** `true`: http(s)://endpoint/bucket/kljuc (MinIO, većina pružatelja); `false`: http(s)://bucket.endpoint/kljuc. */
  forcePathStyle: boolean;
  /** Prefiks ključeva objekata (npr. `arqus/`); prazno = korijen bucketa. */
  prefix: string;
  /** Vrijednost zaglavlja `x-amz-server-side-encryption` (npr. `AES256`), ako ga pružatelj traži. */
  sse?: string;
  timeoutMs: number;
  retries: number;
}

/** Pohrana nije dostupna (mreža, istek vremena, 5xx nakon ponavljanja). */
export class S3UnavailableError extends Error {
  constructor(message: string, readonly op: string) { super(message); this.name = 'S3UnavailableError'; }
}
/** Poslužitelj je odbio zahtjev (4xx): pogrešne vjerodajnice, nepostojeći bucket, neispravan potpis… */
export class S3ResponseError extends Error {
  constructor(message: string, readonly op: string, readonly status: number, readonly code: string) { super(message); this.name = 'S3ResponseError'; }
}

export interface S3Object { key: string; size: number; lastModified: Date; etag: string }
export type PutBody = Buffer | { path: string; size: number; sha256: string };

const ENV_KEYS = ['ENDPOINT', 'REGION', 'BUCKET', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY'] as const;

/**
 * Konfiguracija iz okruženja s danim prefiksom (`DOCUMENTS_S3_`, `DOCUMENTS_MIRROR_S3_`, `BACKUP_S3_`).
 * Greška navodi samo NAZIVE varijabli koje nedostaju, nikad vrijednosti.
 */
export function s3ConfigFromEnv(env: NodeJS.ProcessEnv, p: string): S3Config {
  const get = (k: string) => (env[`${p}${k}`] ?? '').trim();
  const missing = ENV_KEYS.filter((k) => !get(k)).map((k) => `${p}${k}`);
  if (missing.length) throw new Error(`S3 nije konfiguriran – nedostaje: ${missing.join(', ')}`);
  let url: URL;
  try { url = new URL(get('ENDPOINT')); } catch { throw new Error(`${p}ENDPOINT nije ispravna adresa (npr. https://sos-hr-zag-1.exo.io)`); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`${p}ENDPOINT mora počinjati s https:// (ili http:// za lokalni poslužitelj)`);
  if (url.search || url.hash || url.username) throw new Error(`${p}ENDPOINT ne smije sadržavati upit, sidro ni korisničke podatke`);
  const prefix = get('PREFIX');
  if (prefix && (!/^[A-Za-z0-9._\-/]+$/.test(prefix) || prefix.startsWith('/') || prefix.includes('//') || prefix.split('/').includes('..'))) throw new Error(`${p}PREFIX smije sadržavati samo slova, brojke, . _ - i / (bez vodeće /)`);
  const bucket = get('BUCKET');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error(`${p}BUCKET nije ispravan naziv bucketa`);
  const num = (k: string, d: number, min: number, max: number) => { const n = Number(get(k) || d); if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${p}${k} mora biti cijeli broj ${min}–${max}`); return n; };
  const ps = get('FORCE_PATH_STYLE').toLowerCase();
  return {
    endpoint: url.toString().replace(/\/+$/, ''), region: get('REGION'), bucket, accessKeyId: get('ACCESS_KEY_ID'), secretAccessKey: get('SECRET_ACCESS_KEY'),
    forcePathStyle: ps === '' ? true : ['1', 'true', 'da', 'yes'].includes(ps),
    prefix: prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix, sse: get('SSE') || undefined,
    timeoutMs: num('TIMEOUT_MS', 15000, 500, 600000), retries: num('RETRIES', 2, 0, 5),
  };
}

/** Je li išta od konfiguracije s tim prefiksom postavljeno (za jasnu poruku kad je postavljeno samo djelomično). */
export const s3Configured = (env: NodeJS.ProcessEnv, p: string) => ENV_KEYS.some((k) => (env[`${p}${k}`] ?? '').trim() !== '');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const xmlTag = (xml: string, name: string) => { const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml); return m ? decodeXml(m[1]!) : undefined; };
const xmlBlocks = (xml: string, name: string) => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1]!);

interface Req {
  op: string; method: 'GET' | 'PUT' | 'HEAD' | 'DELETE'; key?: string; query?: Record<string, string>;
  headers?: Record<string, string>; body?: PutBody; timeoutMs?: number; retries?: number;
}

/** Tok s ograničenjem stanke: ako između dva dijela prođe više od `ms`, tok se prekida greškom. */
function withIdleTimeout(src: Readable, ms: number, op: string): Readable {
  const out = new PassThrough();
  let timer: NodeJS.Timeout | undefined;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { const e = new S3UnavailableError(`S3 ${op}: prijenos je zastao dulje od ${ms} ms`, op); src.destroy(e); out.destroy(e); }, ms); };
  arm();
  src.on('data', arm);
  src.on('end', () => clearTimeout(timer));
  src.on('error', (e) => { clearTimeout(timer); out.destroy(e instanceof S3UnavailableError ? e : new S3UnavailableError(`S3 ${op}: prijenos prekinut (${e.message})`, op)); });
  out.on('close', () => { clearTimeout(timer); if (!src.destroyed) src.destroy(); });
  src.pipe(out);
  return out;
}

export class S3Client {
  private readonly base: URL;
  constructor(readonly config: S3Config, private readonly now: () => Date = () => new Date()) { this.base = new URL(config.endpoint); }

  /** Ključ objekta s prefiksom iz konfiguracije. */
  objectKey(key: string): string { return `${this.config.prefix}${key}`; }

  private target(key: string | undefined, query?: Record<string, string>): { url: string; host: string; canonicalUri: string } {
    const basePath = this.base.pathname.replace(/\/+$/, '');
    const keyPath = key === undefined ? '' : `/${uriEncode(key, true)}`;
    const host = this.config.forcePathStyle ? this.base.host : `${this.config.bucket}.${this.base.host}`;
    const canonicalUri = this.config.forcePathStyle ? `${basePath}/${uriEncode(this.config.bucket)}${keyPath}` : `${basePath}${keyPath || '/'}`;
    const qs = canonicalQuery(query);
    return { url: `${this.base.protocol}//${host}${canonicalUri}${qs ? `?${qs}` : ''}`, host, canonicalUri };
  }

  /** Jedan potpisani zahtjev s ponavljanjem; vraća odgovor čije tijelo pozivatelj čita (ili ga odbacuje). */
  private async send(r: Req): Promise<{ res: Response; done: () => void }> {
    const timeoutMs = r.timeoutMs ?? this.config.timeoutMs;
    const attempts = 1 + (r.retries ?? this.config.retries);
    let last: Error | undefined;
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await sleep(Math.min(200 * 4 ** (i - 1), 5000) + Math.floor(Math.random() * 100));
      const { url, host, canonicalUri } = this.target(r.key, r.query);
      const payloadHash = r.body === undefined ? EMPTY_SHA256 : Buffer.isBuffer(r.body) ? sha256Hex(r.body) : r.body.sha256;
      const date = this.now(); // jedno vrijeme za zaglavlje i potpis (dva poziva na granici sekunde daju SignatureDoesNotMatch)
      const headers: Record<string, string> = { ...(r.headers ?? {}), 'x-amz-date': amzDate(date), 'x-amz-content-sha256': payloadHash };
      if (r.body !== undefined) headers['content-length'] = String(Buffer.isBuffer(r.body) ? r.body.length : r.body.size);
      const { authorization } = sign({ method: r.method, canonicalUri, query: r.query, headers: { ...headers, host }, payloadHash, region: this.config.region, service: 's3', accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey, date });
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      let body: BodyInit | undefined;
      if (Buffer.isBuffer(r.body)) body = r.body as unknown as BodyInit;
      else if (r.body) body = Readable.toWeb(createReadStream(r.body.path)) as unknown as BodyInit;
      try {
        const res = await fetch(url, { method: r.method, headers: { ...headers, authorization }, body, signal: ac.signal, redirect: 'manual', ...(body && !Buffer.isBuffer(r.body) ? { duplex: 'half' } : {}) } as RequestInit);
        if (res.status >= 500 || res.status === 429) {
          await res.arrayBuffer().catch(() => undefined); clearTimeout(timer);
          last = new S3UnavailableError(`S3 ${r.op}: poslužitelj je vratio ${res.status}`, r.op);
          continue;
        }
        return { res, done: () => clearTimeout(timer) };
      } catch (e) {
        clearTimeout(timer);
        const cause = (e as { cause?: { code?: string; message?: string } }).cause;
        last = new S3UnavailableError(ac.signal.aborted ? `S3 ${r.op}: nema odgovora unutar ${timeoutMs} ms` : `S3 ${r.op}: veza nije uspjela (${cause?.code ?? cause?.message ?? (e as Error).message})`, r.op);
      }
    }
    throw last ?? new S3UnavailableError(`S3 ${r.op}: nepoznata greška`, r.op);
  }

  private async fail(op: string, res: Response, done: () => void): Promise<never> {
    const text = res.status === 304 || res.headers.get('content-length') === '0' ? '' : await res.text().catch(() => '');
    done();
    const code = xmlTag(text, 'Code') ?? `HTTP${res.status}`;
    const msg = xmlTag(text, 'Message') ?? res.statusText;
    throw new S3ResponseError(`S3 ${op}: ${res.status} ${code}${msg ? ` – ${msg}` : ''}`, op, res.status, code);
  }

  async put(key: string, body: PutBody, opts: { contentType?: string } = {}): Promise<{ etag: string }> {
    const headers: Record<string, string> = { 'content-type': opts.contentType ?? 'application/octet-stream' };
    if (this.config.sse) headers['x-amz-server-side-encryption'] = this.config.sse;
    const { res, done } = await this.send({ op: 'put', method: 'PUT', key: this.objectKey(key), headers, body });
    if (!res.ok) return this.fail('put', res, done);
    await res.arrayBuffer(); done();
    return { etag: res.headers.get('etag') ?? '' };
  }

  async head(key: string): Promise<{ size: number; lastModified: Date; etag: string } | null> {
    const { res, done } = await this.send({ op: 'head', method: 'HEAD', key: this.objectKey(key) });
    done();
    if (res.status === 404) return null;
    if (!res.ok) throw new S3ResponseError(`S3 head: ${res.status}`, 'head', res.status, `HTTP${res.status}`);
    return { size: Number(res.headers.get('content-length') ?? 0), lastModified: new Date(res.headers.get('last-modified') ?? 0), etag: res.headers.get('etag') ?? '' };
  }

  /** Sadržaj kao tok (bez držanja cijelog objekta u memoriji); `null` ako objekt ne postoji. */
  async getStream(key: string): Promise<{ stream: Readable; size: number } | null> {
    const { res, done } = await this.send({ op: 'get', method: 'GET', key: this.objectKey(key) });
    if (res.status === 404) { await res.arrayBuffer().catch(() => undefined); done(); return null; }
    if (!res.ok) return this.fail('get', res, done);
    done(); // dalje vrijedi ograničenje stanke na toku
    const size = Number(res.headers.get('content-length') ?? NaN);
    const src = res.body ? Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]) : Readable.from([]);
    return { stream: withIdleTimeout(src, this.config.timeoutMs, 'get'), size };
  }

  async delete(key: string): Promise<void> {
    const { res, done } = await this.send({ op: 'delete', method: 'DELETE', key: this.objectKey(key) });
    if (!res.ok && res.status !== 404) return this.fail('delete', res, done);
    await res.arrayBuffer(); done();
  }

  /** Svi objekti pod prefiksom (ključevi BEZ prefiksa iz konfiguracije), stranicu po stranicu. */
  async *list(prefix = '', opts: { pageSize?: number } = {}): AsyncGenerator<S3Object> {
    let token: string | undefined;
    do {
      const page = await this.listPage(prefix, token, opts.pageSize ?? 1000);
      for (const o of page.objects) yield o;
      token = page.next;
    } while (token);
  }

  async listPage(prefix: string, token: string | undefined, maxKeys: number, opts: { timeoutMs?: number; retries?: number } = {}): Promise<{ objects: S3Object[]; next?: string }> {
    const query: Record<string, string> = { 'list-type': '2', prefix: this.objectKey(prefix), 'max-keys': String(maxKeys) };
    if (token) query['continuation-token'] = token;
    const { res, done } = await this.send({ op: 'list', method: 'GET', query, ...opts });
    if (!res.ok) return this.fail('list', res, done);
    const xml = await res.text(); done();
    const strip = this.config.prefix.length;
    const objects = xmlBlocks(xml, 'Contents').map((b) => ({
      key: (xmlTag(b, 'Key') ?? '').slice(strip), size: Number(xmlTag(b, 'Size') ?? 0), lastModified: new Date(xmlTag(b, 'LastModified') ?? 0), etag: xmlTag(b, 'ETag') ?? '',
    }));
    const truncated = xmlTag(xml, 'IsTruncated') === 'true';
    const next = truncated ? xmlTag(xml, 'NextContinuationToken') : undefined;
    if (truncated && !next) throw new S3ResponseError('S3 list: odgovor je skraćen bez oznake nastavka', 'list', 200, 'BadListing');
    return { objects, next };
  }

  /** Dostupnost (spremnost): jedan kratki popis bez ponavljanja. */
  async check(timeoutMs = 3000): Promise<void> { await this.listPage('', undefined, 1, { timeoutMs, retries: 0 }); }

  /** Stvaranje bucketa (samo testovi i lokalna proba; u produkciji bucket stvara pružatelj). */
  async createBucket(): Promise<void> {
    const { res, done } = await this.send({ op: 'create-bucket', method: 'PUT' });
    if (!res.ok && res.status !== 409) return this.fail('create-bucket', res, done);
    await res.arrayBuffer(); done();
  }
}
