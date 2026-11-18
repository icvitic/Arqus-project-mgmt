import { readFileSync } from 'node:fs';
import { assertAddress, SmtpError, validateConfig, type MailAddress, type OutgoingMail, type SmtpConfig, type SmtpSecurity } from './smtp-client';

/**
 * WP1.21 – postavke e-pošte iz okruženja. Zadano ISKLJUČENO (`MAIL_TRANSPORT` prazan ili `off`): aplikacija tada ne šalje
 * ništa, a poveznice pozivnica i nove lozinke dobiva administrator (ručna predaja). `MAIL_TRANSPORT=smtp` uključuje predaju
 * poruka jednom relayu; neispravna ili nepotpuna postavka ZAUSTAVLJA pokretanje s jasnom porukom (bolje nego tiho ne slati).
 *
 * Poveznice u porukama grade se ISKLJUČIVO iz `PUBLIC_URL` (nikad iz zaglavlja Host ili X-Forwarded-* zahtjeva – zaštita
 * od trovanja poveznice za novu lozinku). `PUBLIC_URL` mora biti https; http samo za localhost.
 */
export interface MailSettings {
  enabled: boolean;
  /** Javna adresa instalacije bez završne kose crte (npr. `https://projekti.institucija.hr`); null ako pošta nije uključena. */
  publicUrl: string | null;
  from: MailAddress | null;
  smtp: SmtpConfig | null;
  /** Najviše istovremenih SMTP veza (slanje sažetka i sigurnosnih poruka). */
  maxConcurrency: number;
  /** Sat dnevnog sažetka u zoni institucije (zadano 7). */
  digestHour: number;
}

export const MAIL_SETTINGS = Symbol('MAIL_SETTINGS');
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');
export interface MailTransport { send(mail: OutgoingMail): Promise<{ attempts: number }> }

export class MailConfigError extends Error {
  constructor(message: string) { super(`Postavke e-pošte: ${message}`); this.name = 'MailConfigError'; }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Provjera i normalizacija `PUBLIC_URL`: apsolutni URL, https (http samo za localhost), bez upita, fragmenta i vjerodajnica. */
export function parsePublicUrl(raw: string | undefined): string {
  if (!raw?.trim()) throw new MailConfigError('PUBLIC_URL nije postavljen – poveznice u porukama grade se samo iz njega (npr. https://projekti.institucija.hr)');
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new MailConfigError(`PUBLIC_URL nije ispravan URL: ${raw}`); }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && LOCAL_HOSTS.has(u.hostname))) throw new MailConfigError('PUBLIC_URL mora počinjati s https:// (http:// samo za localhost)');
  if (u.username || u.password || u.search || u.hash) throw new MailConfigError('PUBLIC_URL ne smije sadržavati korisnika, lozinku, upit (?) ni fragment (#)');
  return `${u.origin}${u.pathname}`.replace(/\/+$/, '');
}

const int = (raw: string | undefined, def: number, name: string, min: number, max: number): number => {
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new MailConfigError(`${name} mora biti cijeli broj od ${min} do ${max}`);
  return n;
};

export function mailSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): MailSettings {
  const mode = (env.MAIL_TRANSPORT ?? '').trim().toLowerCase();
  const maxConcurrency = int(env.MAIL_MAX_CONNECTIONS, 2, 'MAIL_MAX_CONNECTIONS', 1, 10);
  const digestHour = int(env.DIGEST_HOUR, 7, 'DIGEST_HOUR', 0, 23);
  if (mode === '' || mode === 'off') return { enabled: false, publicUrl: null, from: null, smtp: null, maxConcurrency, digestHour };
  if (mode !== 'smtp') throw new MailConfigError(`MAIL_TRANSPORT mora biti "off" ili "smtp" (sada: ${env.MAIL_TRANSPORT})`);

  const publicUrl = parsePublicUrl(env.PUBLIC_URL);
  const host = (env.SMTP_HOST ?? '').trim();
  if (!host) throw new MailConfigError('SMTP_HOST nije postavljen');
  const security = ((env.SMTP_SECURITY ?? 'starttls').trim().toLowerCase()) as SmtpSecurity;
  if (!['tls', 'starttls', 'none'].includes(security)) throw new MailConfigError('SMTP_SECURITY mora biti "starttls" (zadano), "tls" (implicitni TLS, port 465) ili "none" (samo lokalni testni poslužitelj)');
  const port = int(env.SMTP_PORT, security === 'tls' ? 465 : security === 'starttls' ? 587 : 25, 'SMTP_PORT', 1, 65535);
  const user = env.SMTP_USER?.length ? env.SMTP_USER : undefined;
  const password = env.SMTP_PASSWORD?.length ? env.SMTP_PASSWORD : undefined;
  if (password && !user) throw new MailConfigError('SMTP_PASSWORD je postavljen bez SMTP_USER');
  if (user && security === 'none') throw new MailConfigError('vjerodajnice (SMTP_USER) se ne šalju nešifriranom vezom – uz SMTP_SECURITY=none ostavi SMTP_USER prazan');
  let ca: Buffer | undefined;
  if (env.SMTP_TLS_CA_FILE?.trim()) {
    try { ca = readFileSync(env.SMTP_TLS_CA_FILE.trim()); } catch { throw new MailConfigError(`SMTP_TLS_CA_FILE se ne može pročitati: ${env.SMTP_TLS_CA_FILE}`); }
  }
  const fromAddress = (env.MAIL_FROM ?? '').trim();
  const fromName = (env.MAIL_FROM_NAME ?? 'ArQus Projekti').trim();
  const heloName = (env.SMTP_HELO_NAME ?? new URL(publicUrl).hostname).trim();
  const smtp: SmtpConfig = {
    host, port, security, user, password, heloName, ca,
    timeoutMs: int(env.SMTP_TIMEOUT_SECONDS, 20, 'SMTP_TIMEOUT_SECONDS', 1, 300) * 1000,
    retries: int(env.SMTP_RETRIES, 2, 'SMTP_RETRIES', 0, 5),
  };
  try {
    assertAddress(fromAddress, 'MAIL_FROM');
    if (/[\r\n\0]/.test(fromName)) throw new SmtpError('invalid', false, 'MAIL_FROM_NAME: nedopušteni znak');
    validateConfig(smtp);
  } catch (e) {
    throw new MailConfigError(e instanceof Error ? e.message : String(e));
  }
  return { enabled: true, publicUrl, from: { address: fromAddress, name: fromName || undefined }, smtp, maxConcurrency, digestHour };
}
