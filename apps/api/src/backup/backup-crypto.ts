import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';

/**
 * Šifriranje sigurnosnih kopija prije slanja izvan poslužitelja (WP1.20, ADR-0012).
 *
 * Shema: AES-256-GCM u odsječcima („STREAM” konstrukcija, kao `age`/Tink): datoteka se šifrira u odsječcima od 64 KiB
 * otvorenog teksta, svaki s vlastitom GCM oznakom, pa se i višegigabajtna kopija šifrira i dešifrira strujanjem, a
 * izmjena, preslagivanje, uklanjanje ili skraćivanje odsječaka otkriva se (oznaka zadnjeg odsječka je u nonceu).
 * Ključ datoteke izvodi se HKDF-SHA256 iz glavnog ključa (`BACKUP_ENCRYPTION_KEY`, 32 nasumična bajta) i nasumične
 * soli datoteke, pa se ni par (ključ, nonce) nikad ne ponavlja među datotekama.
 *
 * Format datoteke (`.enc`), svi brojevi big-endian:
 *   zaglavlje (52 B) = "ARQUSBK1" (8) ‖ otisak ključa (8) ‖ sol (32) ‖ veličina odsječka u bajtovima (4, = 65536)
 *   zatim N ≥ 1 odsječaka: šifrat (≤ 65536 B) ‖ GCM oznaka (16 B); svi osim zadnjeg imaju puni odsječak
 *   ključ datoteke = HKDF-SHA256(ikm = glavni ključ, salt = sol, info = "arqus-backup-v1 file", 32 B)
 *   nonce odsječka i = 0x000000 ‖ i (8 B) ‖ zadnji (1 B: 1 za zadnji odsječak, inače 0)
 *   AAD svakog odsječka = cijelo zaglavlje (zaglavlje se ne može zamijeniti)
 *   otisak ključa = HKDF-SHA256(ikm = glavni ključ, salt = prazno, info = "arqus-backup-v1 key id", 8 B) – samo da se
 *   kriv ključ prepozna jasnom porukom; iz njega se ključ ne može izračunati.
 * Dešifriranje: `node dist/db/cli.js backup decrypt <ulaz.enc> <izlaz>` (samo BACKUP_ENCRYPTION_KEY, bez baze i mreže).
 * Otvoreni tekst odsječka izlazi tek nakon provjere njegove oznake; cjelovitost CIJELE datoteke poznata je tek na kraju,
 * zato naredbe pišu u privremenu datoteku i preimenuju je tek nakon uspjeha.
 */

export const MAGIC = Buffer.from('ARQUSBK1', 'ascii');
export const CHUNK = 64 * 1024;
const TAG = 16;
export const HEADER_LEN = 8 + 8 + 32 + 4;

export class BackupCryptoError extends Error { constructor(message: string) { super(message); this.name = 'BackupCryptoError'; } }

/** Glavni ključ iz base64 (`openssl rand -base64 32`); poruka greške nikad ne sadrži vrijednost. */
export function parseBackupKey(b64: string | undefined): Buffer {
  const s = (b64 ?? '').trim();
  if (!s) throw new BackupCryptoError('BACKUP_ENCRYPTION_KEY nije postavljen (generiraj: openssl rand -base64 32)');
  const k = Buffer.from(s, 'base64');
  if (k.length !== 32 || k.toString('base64').replace(/=+$/, '') !== s.replace(/=+$/, '')) throw new BackupCryptoError('BACKUP_ENCRYPTION_KEY mora biti točno 32 bajta zapisana u base64 (openssl rand -base64 32)');
  return k;
}

const hkdf = (key: Buffer, salt: Buffer, info: string, len: number) => Buffer.from(hkdfSync('sha256', key, salt, info, len));
export const keyFingerprint = (key: Buffer): string => hkdf(key, Buffer.alloc(0), 'arqus-backup-v1 key id', 8).toString('hex');

function nonce(i: bigint, last: boolean): Buffer {
  const n = Buffer.alloc(12);
  n.writeBigUInt64BE(i, 3);
  n[11] = last ? 1 : 0;
  return n;
}

/** Tok koji šifrira (ulaz: otvoreni tekst, izlaz: format iznad). */
export function createEncryptStream(masterKey: Buffer): Transform {
  const salt = randomBytes(32);
  const header = Buffer.alloc(HEADER_LEN);
  MAGIC.copy(header, 0); Buffer.from(keyFingerprint(masterKey), 'hex').copy(header, 8); salt.copy(header, 16); header.writeUInt32BE(CHUNK, 48);
  const key = hkdf(masterKey, salt, 'arqus-backup-v1 file', 32);
  let pending: Buffer = Buffer.alloc(0); let i = 0n; let started = false;
  const seal = (pt: Buffer, last: boolean) => {
    const c = createCipheriv('aes-256-gcm', key, nonce(i++, last));
    c.setAAD(header);
    return Buffer.concat([c.update(pt), c.final(), c.getAuthTag()]);
  };
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      if (!started) { started = true; this.push(header); }
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      // Puni odsječak šalje se tek kad postoji barem jedan bajt iza njega (tek tada se zna da nije zadnji).
      while (pending.length > CHUNK) { this.push(seal(pending.subarray(0, CHUNK), false)); pending = pending.subarray(CHUNK); }
      cb();
    },
    flush(cb: TransformCallback) { if (!started) { started = true; this.push(header); } this.push(seal(pending, true)); pending = Buffer.alloc(0); cb(); },
  });
}

/** Tok koji dešifrira i provjerava; greška (kriv ključ, izmjena, skraćivanje) prekida tok s `BackupCryptoError`. */
export function createDecryptStream(masterKey: Buffer): Transform {
  let header: Buffer | null = null; let key: Buffer | null = null;
  let pending: Buffer = Buffer.alloc(0); let i = 0n; let chunkSize = CHUNK;
  const open = (ct: Buffer, last: boolean) => {
    if (ct.length < TAG) throw new BackupCryptoError('Datoteka kopije je skraćena ili oštećena');
    const d = createDecipheriv('aes-256-gcm', key!, nonce(i++, last));
    d.setAAD(header!);
    d.setAuthTag(ct.subarray(ct.length - TAG));
    try { return Buffer.concat([d.update(ct.subarray(0, ct.length - TAG)), d.final()]); }
    catch { throw new BackupCryptoError('Provjera cjelovitosti kopije nije uspjela – datoteka je izmijenjena, skraćena ili oštećena'); }
  };
  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      try {
        pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
        if (!header) {
          if (pending.length < HEADER_LEN) return cb();
          header = Buffer.from(pending.subarray(0, HEADER_LEN)); pending = pending.subarray(HEADER_LEN);
          if (!header.subarray(0, 8).equals(MAGIC)) throw new BackupCryptoError('Datoteka nije šifrirana kopija ArQusa (nepoznato zaglavlje)');
          const want = header.subarray(8, 16).toString('hex'); const have = keyFingerprint(masterKey);
          if (want !== have) throw new BackupCryptoError(`Kopija je šifrirana drugim ključem (otisak ključa kopije ${want}, postavljenog ključa ${have})`);
          chunkSize = header.readUInt32BE(48);
          if (chunkSize !== CHUNK) throw new BackupCryptoError('Nepodržana veličina odsječka u zaglavlju kopije');
          key = hkdf(masterKey, header.subarray(16, 48), 'arqus-backup-v1 file', 32);
        }
        const full = chunkSize + TAG;
        while (pending.length > full) { this.push(open(pending.subarray(0, full), false)); pending = pending.subarray(full); }
        cb();
      } catch (e) { cb(e as Error); }
    },
    flush(cb: TransformCallback) {
      try {
        if (!header) throw new BackupCryptoError('Datoteka kopije je skraćena (nema zaglavlja)');
        this.push(open(pending, true)); cb();
      } catch (e) { cb(e as Error); }
    },
  });
}
