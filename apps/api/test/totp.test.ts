import { describe, it, expect } from 'vitest';
import { base32Decode, base32Encode, hotp, verifyTotp, otpauthUri } from '../src/identity/totp';
import { open, seal } from '../src/common/crypto-box';

describe('TOTP (RFC 6238 / RFC 4226)', () => {
  const secret = Buffer.from('12345678901234567890'); // RFC test ključ (SHA1)
  it('vektori iz RFC 6238 (8 znamenki)', () => {
    expect(hotp(secret, Math.floor(59 / 30), 8)).toBe('94287082');
    expect(hotp(secret, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(hotp(secret, Math.floor(1234567890 / 30), 8)).toBe('89005924');
    expect(hotp(secret, Math.floor(2000000000 / 30), 8)).toBe('69279037');
  });
  it('vektori iz RFC 4226 (HOTP, 6 znamenki)', () => {
    expect([0, 1, 9].map((c) => hotp(secret, c))).toEqual(['755224', '287082', '520489']);
  });
  it('base32 povratno i provjera s tolerancijom i zaštitom od ponovne upotrebe', () => {
    const b32 = base32Encode(secret);
    expect(b32).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode(b32).equals(secret)).toBe(true);
    const now = 1_700_000_000_000; const step = Math.floor(now / 30_000);
    const code = hotp(secret, step);
    expect(verifyTotp(b32, code, { nowMs: now })).toBe(step);
    expect(verifyTotp(b32, hotp(secret, step - 1), { nowMs: now })).toBe(step - 1);
    expect(verifyTotp(b32, hotp(secret, step - 2), { nowMs: now })).toBeNull();
    expect(verifyTotp(b32, code, { nowMs: now, lastStep: step })).toBeNull();
    expect(verifyTotp(b32, '12345', { nowMs: now })).toBeNull();
    expect(otpauthUri(b32, 'a@b.hr')).toMatch(/^otpauth:\/\/totp\/ArQus%20Projekti%3Aa%40b\.hr\?secret=GEZD/);
  });
  it('šifriranje tajne (AES-GCM) i otkrivanje izmjene', () => {
    const s = seal('TAJNA');
    expect(open(s)).toBe('TAJNA');
    const tampered = Buffer.from(s, 'base64'); tampered[tampered.length - 1]! ^= 1;
    expect(() => open(tampered.toString('base64'))).toThrow();
  });
});
