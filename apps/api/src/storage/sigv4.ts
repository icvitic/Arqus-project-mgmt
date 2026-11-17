import { createHash, createHmac } from 'node:crypto';

/**
 * AWS Signature Version 4 (zaglavlje Authorization) – samo Node `crypto`, bez vanjskih ovisnosti (WP1.20).
 * Provjereno objavljenim primjerima AWS-a (S3 „Signature Calculations”, GET/PUT/lifecycle/list, i aws-c-auth
 * `get-vanilla`) u `test/s3-sigv4.test.ts` te stvarnim S3-kompatibilnim poslužiteljem (MinIO) u integracijskim testovima.
 *
 * Pravila za S3 (razlika od ostalih AWS usluga): putanja se kodira JEDNOM (bez dvostrukog kodiranja i bez normalizacije),
 * `/` u ključu ostaje, a tijelo je potpisano svojim SHA-256 (`x-amz-content-sha256`), pa poslužitelj odbija izmijenjeno tijelo.
 */

export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export const sha256Hex = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data, 'utf8').digest();

/** RFC 3986 kodiranje kakvo traži SigV4: neizmijenjeni su samo A-Z a-z 0-9 - . _ ~ (i `/` kad je `keepSlash`). */
export function uriEncode(s: string, keepSlash = false): string {
  let out = '';
  for (const ch of Buffer.from(s, 'utf8')) {
    const c = String.fromCharCode(ch);
    if (/[A-Za-z0-9\-._~]/.test(c) || (keepSlash && c === '/')) out += c;
    else out += `%${ch.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/** Kanonski upit: parovi kodirani pa sortirani po ključu (zatim vrijednosti); prazna vrijednost daje `kljuc=`. */
export function canonicalQuery(query: Record<string, string> | undefined): string {
  if (!query) return '';
  return Object.entries(query)
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join('&');
}

/** `YYYYMMDDTHHMMSSZ` */
export function amzDate(d: Date): string { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }

export interface SignInput {
  method: string;
  /** Već kodirana putanja (kanonski URI), npr. `/bucket/kljuc%24.txt`. */
  canonicalUri: string;
  query?: Record<string, string>;
  /** Zaglavlja koja se potpisuju (moraju uključiti `host` i `x-amz-date`); nazivi bez obzira na velika/mala slova. */
  headers: Record<string, string>;
  payloadHash: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  date: Date;
}

export interface Signed { authorization: string; canonicalRequest: string; stringToSign: string; signature: string; signedHeaders: string }

export function signingKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service), 'aws4_request');
}

export function sign(input: SignInput): Signed {
  const stamp = amzDate(input.date); const day = stamp.slice(0, 8);
  const hs = Object.entries(input.headers).map(([k, v]) => [k.toLowerCase().trim(), String(v).trim().replace(/\s+/g, ' ')] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonicalHeaders = hs.map(([k, v]) => `${k}:${v}\n`).join('');
  const signedHeaders = hs.map(([k]) => k).join(';');
  const canonicalRequest = [input.method.toUpperCase(), input.canonicalUri || '/', canonicalQuery(input.query), canonicalHeaders, signedHeaders, input.payloadHash].join('\n');
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(input.secretAccessKey, day, input.region, input.service)).update(stringToSign, 'utf8').digest('hex');
  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    canonicalRequest, stringToSign, signature, signedHeaders,
  };
}
