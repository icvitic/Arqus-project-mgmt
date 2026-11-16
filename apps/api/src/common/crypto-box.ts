import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** AES-256-GCM za tajne u bazi (MFA). Ključ iz MFA_ENCRYPTION_KEY (preporučeno) ili AUTH_JWT_SECRET. */
function key(): Buffer {
  const k = process.env.MFA_ENCRYPTION_KEY ?? process.env.AUTH_JWT_SECRET ?? 'dev-only-secret-change-me-0123456789';
  return createHash('sha256').update(`arqus-mfa|${k}`).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

export function open(sealed: string): string {
  const b = Buffer.from(sealed, 'base64');
  const d = createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
