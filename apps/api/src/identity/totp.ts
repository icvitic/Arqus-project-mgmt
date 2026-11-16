import { createHmac, randomBytes } from 'node:crypto';

/** TOTP prema RFC 6238 (HMAC-SHA1, korak 30 s, 6 znamenki) – kompatibilno s Google/Microsoft Authenticator, Aegis, 1Password. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const s = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of s) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('Neispravan base32 zapis');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const o = h[h.length - 1]! & 0xf;
  const code = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(code % 10 ** digits).padStart(digits, '0');
}

export const totpStep = (nowMs = Date.now()): number => Math.floor(nowMs / 30_000);
export const generateTotpSecret = (): string => base32Encode(randomBytes(20));

/**
 * Provjera koda uz toleranciju ±1 korak (pomak sata). Vraća iskorišteni korak ili null.
 * `lastStep` sprječava ponovnu upotrebu istog ili starijeg koda (ASVS V2.8.4).
 */
export function verifyTotp(secretB32: string, code: string, opts: { nowMs?: number; lastStep?: number | null; window?: number } = {}): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretB32); const now = totpStep(opts.nowMs); const w = opts.window ?? 1;
  for (let s = now - w; s <= now + w; s++) {
    if (opts.lastStep !== undefined && opts.lastStep !== null && s <= opts.lastStep) continue;
    if (hotp(secret, s) === code) return s;
  }
  return null;
}

export function otpauthUri(secretB32: string, account: string, issuer = 'ArQus Projekti'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
