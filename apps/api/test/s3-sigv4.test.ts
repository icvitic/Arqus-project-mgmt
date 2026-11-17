import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EMPTY_SHA256, sha256Hex, sign, uriEncode } from '../src/storage/sigv4';
import { S3Client, s3ConfigFromEnv, S3ResponseError, S3UnavailableError, type S3Config } from '../src/storage/s3-client';

/**
 * WP1.20 – AWS Signature V4 prema objavljenim primjerima:
 * (1) S3 API Reference, „Signature Calculations for the Authorization Header: Transferring Payload in a Single Chunk”
 *     (AKIAIOSFODNN7EXAMPLE, 2013-05-24, examplebucket) – GET Object, PUT Object, GET Bucket Lifecycle, GET Bucket (List Objects);
 * (2) AWS SigV4 test suite (awslabs/aws-c-auth, tests/aws-signing-test-suite/v4): get-vanilla, get-vanilla-query-order-key-case.
 */
const S3_DOC = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 's3', date: new Date('2013-05-24T00:00:00Z') };
const HOST = 'examplebucket.s3.amazonaws.com';
const SUITE = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'service', date: new Date('2015-08-30T12:36:00Z') };

describe('SigV4 – objavljeni primjeri AWS-a', () => {
  it('S3 GET Object (Range)', () => {
    const s = sign({ ...S3_DOC, method: 'GET', canonicalUri: '/test.txt', headers: { host: HOST, range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY_SHA256, 'x-amz-date': '20130524T000000Z' }, payloadHash: EMPTY_SHA256 });
    expect(s.canonicalRequest).toBe(['GET', '/test.txt', '', `host:${HOST}`, 'range:bytes=0-9', `x-amz-content-sha256:${EMPTY_SHA256}`, 'x-amz-date:20130524T000000Z', '', 'host;range;x-amz-content-sha256;x-amz-date', EMPTY_SHA256].join('\n'));
    expect(s.stringToSign).toBe('AWS4-HMAC-SHA256\n20130524T000000Z\n20130524/us-east-1/s3/aws4_request\n7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972');
    expect(s.signature).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    expect(s.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });

  it('S3 PUT Object (tijelo potpisano, $ u ključu kodiran jednom)', () => {
    const body = 'Welcome to Amazon S3.';
    expect(sha256Hex(body)).toBe('44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072');
    const s = sign({ ...S3_DOC, method: 'PUT', canonicalUri: uriEncode('/test$file.text', true), payloadHash: sha256Hex(body), headers: {
      Date: 'Fri, 24 May 2013 00:00:00 GMT', host: HOST, 'x-amz-date': '20130524T000000Z', 'x-amz-storage-class': 'REDUCED_REDUNDANCY', 'x-amz-content-sha256': sha256Hex(body) } });
    expect(s.canonicalRequest.split('\n')[1]).toBe('/test%24file.text');
    expect(s.signedHeaders).toBe('date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class');
    expect(s.signature).toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  });

  it('S3 GET Bucket Lifecycle (parametar bez vrijednosti)', () => {
    const s = sign({ ...S3_DOC, method: 'GET', canonicalUri: '/', query: { lifecycle: '' }, payloadHash: EMPTY_SHA256, headers: { host: HOST, 'x-amz-date': '20130524T000000Z', 'x-amz-content-sha256': EMPTY_SHA256 } });
    expect(s.canonicalRequest.split('\n')[2]).toBe('lifecycle=');
    expect(s.signature).toBe('fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543');
  });

  it('S3 GET Bucket (List Objects) – sortiran upit', () => {
    const s = sign({ ...S3_DOC, method: 'GET', canonicalUri: '/', query: { prefix: 'J', 'max-keys': '2' }, payloadHash: EMPTY_SHA256, headers: { host: HOST, 'x-amz-date': '20130524T000000Z', 'x-amz-content-sha256': EMPTY_SHA256 } });
    expect(s.canonicalRequest.split('\n')[2]).toBe('max-keys=2&prefix=J');
    expect(s.signature).toBe('34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
  });

  it('test suite: get-vanilla (kanonski zahtjev, niz za potpis, potpis)', () => {
    const s = sign({ ...SUITE, method: 'GET', canonicalUri: '/', headers: { Host: 'example.amazonaws.com', 'X-Amz-Date': '20150830T123600Z' }, payloadHash: EMPTY_SHA256 });
    expect(s.canonicalRequest).toBe(`GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n${EMPTY_SHA256}`);
    expect(s.stringToSign).toBe('AWS4-HMAC-SHA256\n20150830T123600Z\n20150830/us-east-1/service/aws4_request\nbb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63');
    expect(s.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  });

  it('test suite: get-vanilla-query-order-key-case', () => {
    const s = sign({ ...SUITE, method: 'GET', canonicalUri: '/', query: { Param2: 'value2', Param1: 'value1' }, headers: { Host: 'example.amazonaws.com', 'X-Amz-Date': '20150830T123600Z' }, payloadHash: EMPTY_SHA256 });
    expect(s.canonicalRequest.split('\n')[2]).toBe('Param1=value1&Param2=value2');
    expect(s.signature).toBe('b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500');
  });

  it('kodiranje: neizmijenjeni samo neobavezni znakovi, UTF-8 po bajtu, / samo u putanji', () => {
    expect(uriEncode('a b+c/ž~._-')).toBe('a%20b%2Bc%2F%C5%BE~._-');
    expect(uriEncode('a b/c', true)).toBe('a%20b/c');
  });
});

describe('S3 klijent – konfiguracija, adrese, vremena i ponavljanje', () => {
  let server: Server | undefined;
  afterEach(async () => { vi.unstubAllGlobals(); if (server) await new Promise((r) => server!.close(r)); server = undefined; });
  const base: S3Config = { endpoint: 'https://s3.example.eu', region: 'eu-central-1', bucket: 'arqus-doc', accessKeyId: 'AKIDTEST', secretAccessKey: 'tajna-vrijednost', forcePathStyle: true, prefix: 'p/', timeoutMs: 500, retries: 2 };

  it('konfiguracija iz okruženja: greška navodi nazive varijabli, nikad vrijednosti', () => {
    expect(() => s3ConfigFromEnv({ X_S3_ENDPOINT: 'https://e', X_S3_SECRET_ACCESS_KEY: 'super-tajno' }, 'X_S3_')).toThrow(/X_S3_REGION, X_S3_BUCKET, X_S3_ACCESS_KEY_ID$/);
    try { s3ConfigFromEnv({ X_S3_ENDPOINT: 'ftp://e', X_S3_REGION: 'r', X_S3_BUCKET: 'bbb', X_S3_ACCESS_KEY_ID: 'a', X_S3_SECRET_ACCESS_KEY: 'super-tajno' }, 'X_S3_'); } catch (e) { expect(String(e)).not.toContain('super-tajno'); }
    const c = s3ConfigFromEnv({ X_S3_ENDPOINT: 'https://sos-hr-zag-1.exo.io/', X_S3_REGION: 'hr-zag-1', X_S3_BUCKET: 'arqus-dokumenti', X_S3_ACCESS_KEY_ID: 'a', X_S3_SECRET_ACCESS_KEY: 's', X_S3_PREFIX: 'pilot', X_S3_FORCE_PATH_STYLE: 'false', X_S3_SSE: 'AES256' }, 'X_S3_');
    expect(c).toMatchObject({ endpoint: 'https://sos-hr-zag-1.exo.io', prefix: 'pilot/', forcePathStyle: false, sse: 'AES256', timeoutMs: 15000, retries: 2 });
    expect(() => s3ConfigFromEnv({ X_S3_ENDPOINT: 'https://e', X_S3_REGION: 'r', X_S3_BUCKET: 'bbb', X_S3_ACCESS_KEY_ID: 'a', X_S3_SECRET_ACCESS_KEY: 's', X_S3_PREFIX: '../x' }, 'X_S3_')).toThrow(/PREFIX/);
  });

  it('adrese: path-style i virtual-hosted, ključ kodiran, potpis odgovara adresi', async () => {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string> }) => { seen.push({ url, headers: init.headers }); return new Response(null, { status: 404 }); });
    const now = () => new Date('2026-11-17T10:00:00Z');
    await new S3Client(base, now).head('t/a b$.pdf');
    await new S3Client({ ...base, forcePathStyle: false, sse: 'AES256' }, now).head('t/a b$.pdf');
    expect(seen[0]!.url).toBe('https://s3.example.eu/arqus-doc/p/t/a%20b%24.pdf');
    expect(seen[1]!.url).toBe('https://arqus-doc.s3.example.eu/p/t/a%20b%24.pdf');
    for (const [i, host, uri] of [[0, 's3.example.eu', '/arqus-doc/p/t/a%20b%24.pdf'], [1, 'arqus-doc.s3.example.eu', '/p/t/a%20b%24.pdf']] as const) {
      const h = seen[i]!.headers;
      const expected = sign({ method: 'HEAD', canonicalUri: uri, headers: { host, 'x-amz-date': h['x-amz-date']!, 'x-amz-content-sha256': EMPTY_SHA256 }, payloadHash: EMPTY_SHA256, region: 'eu-central-1', service: 's3', accessKeyId: 'AKIDTEST', secretAccessKey: 'tajna-vrijednost', date: now() });
      expect(h.authorization).toBe(expected.authorization);
      expect(JSON.stringify(h)).not.toContain('tajna-vrijednost');
    }
  });

  it('zaglavlje x-amz-date i potpis koriste isto vrijeme i kad sat prijeđe granicu sekunde između poziva', async () => {
    const seen: Array<Record<string, string>> = [];
    vi.stubGlobal('fetch', async (_url: string, init: { headers: Record<string, string> }) => { seen.push(init.headers); return new Response(null, { status: 404 }); });
    let t = Date.parse('2026-11-17T10:00:00.999Z');
    const ticking = () => new Date((t += 1000)); // svaki poziv sata je sekundu kasnije
    await new S3Client(base, ticking).head('k');
    const h = seen[0]!;
    const date = new Date(h['x-amz-date']!.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
    const expected = sign({ method: 'HEAD', canonicalUri: '/arqus-doc/p/k', headers: { host: 's3.example.eu', 'x-amz-date': h['x-amz-date']!, 'x-amz-content-sha256': EMPTY_SHA256 }, payloadHash: EMPTY_SHA256, region: 'eu-central-1', service: 's3', accessKeyId: 'AKIDTEST', secretAccessKey: 'tajna-vrijednost', date });
    expect(h.authorization).toBe(expected.authorization);
  });

  const serve = async (handler: (req: IncomingMessage, res: ServerResponse) => void) => {
    server = createServer(handler);
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };

  it('poslužitelj ne odgovara: jasna greška unutar vremenskog ograničenja (s ograničenim ponavljanjem), ne visi', async () => {
    let hits = 0;
    const endpoint = await serve(() => { hits++; /* nikad ne odgovara */ });
    const t0 = Date.now();
    await expect(new S3Client({ ...base, endpoint, retries: 1, timeoutMs: 300 }).head('x')).rejects.toBeInstanceOf(S3UnavailableError);
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(hits).toBe(2);
  });

  it('5xx se ponavlja do uspjeha; 403 se ne ponavlja i daje kôd greške', async () => {
    let hits = 0;
    const endpoint = await serve((req, res) => {
      hits++;
      if (req.url!.includes('denied')) { res.writeHead(403, { 'content-type': 'application/xml' }); res.end('<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>'); return; }
      if (hits < 3) { res.writeHead(503); res.end('<Error><Code>SlowDown</Code></Error>'); return; }
      res.writeHead(200, { 'content-length': '5' }); res.end('hello');
    });
    const c = new S3Client({ ...base, endpoint, retries: 2, timeoutMs: 2000 });
    const g = await c.getStream('ok');
    const parts: Buffer[] = []; for await (const p of g!.stream) parts.push(p as Buffer);
    expect(Buffer.concat(parts).toString()).toBe('hello');
    expect(hits).toBe(3);
    hits = 0;
    const err = await c.getStream('denied').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(S3ResponseError);
    expect((err as S3ResponseError).code).toBe('AccessDenied');
    expect(hits).toBe(1);
  });

  it('prijenos koji zastane usred tijela prekida se greškom (ograničenje stanke)', async () => {
    const endpoint = await serve((_req, res) => { res.writeHead(200, { 'content-length': '100' }); res.write('pocetak'); /* zastoj */ });
    const g = await new S3Client({ ...base, endpoint, timeoutMs: 300 }).getStream('x');
    const read = (async () => { for await (const _ of g!.stream) { /* čitaj */ } })();
    await expect(read).rejects.toBeInstanceOf(S3UnavailableError);
  });
});
