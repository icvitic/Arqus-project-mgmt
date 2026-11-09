import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const PARAMS = { N: 2 ** 15, r: 8, p: 1 };
const maxmem = (N: number, r: number) => 128 * N * r * 2; // Node zadano 32 MiB je premalo za N=2^15

/** Format: scrypt$N$r$p$salt(base64)$hash(base64). Bez nativnih ovisnosti (ADR-0008). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, { ...PARAMS, maxmem: maxmem(PARAMS.N, PARAMS.r) });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [alg, N, r, p, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !N || !r || !p || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: +N, r: +r, p: +p, maxmem: maxmem(+N, +r) });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
