/** M9 Dokumenti: vrste, povjerljivost i provjera datoteka prije pohrane (bez I/O). */
export type DocumentKind = 'contract' | 'proposal' | 'deliverable' | 'evidence' | 'report' | 'timesheet' | 'correspondence' | 'other';
export const DOCUMENT_KINDS: Record<DocumentKind, string> = {
  contract: 'ugovor / sporazum', proposal: 'prijava', deliverable: 'isporuka', evidence: 'dokaz troška', report: 'izvještaj', timesheet: 'evidencija rada', correspondence: 'korespondencija', other: 'ostalo',
};
export type Confidentiality = 'public' | 'internal' | 'confidential';
export const CONFIDENTIALITY: Record<Confidentiality, string> = { public: 'javno', internal: 'interno', confidential: 'povjerljivo' };
export type DocumentEntity = 'project' | 'expense' | 'deliverable' | 'claim' | 'proposal';

export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

type Sig = 'pdf' | 'png' | 'jpg' | 'gif' | 'webp' | 'tif' | 'zip' | 'ole' | 'text' | 'any';
/** Dopuštene ekstenzije i očekivani potpis sadržaja. Izvršne datoteke, HTML i SVG nisu dopušteni (mogu nositi skripte). */
const ALLOWED: Record<string, { mime: string; sig: Sig }> = {
  pdf: { mime: 'application/pdf', sig: 'pdf' },
  png: { mime: 'image/png', sig: 'png' }, jpg: { mime: 'image/jpeg', sig: 'jpg' }, jpeg: { mime: 'image/jpeg', sig: 'jpg' }, gif: { mime: 'image/gif', sig: 'gif' },
  webp: { mime: 'image/webp', sig: 'webp' }, tif: { mime: 'image/tiff', sig: 'tif' }, tiff: { mime: 'image/tiff', sig: 'tif' },
  docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', sig: 'zip' },
  xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', sig: 'zip' },
  pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', sig: 'zip' },
  odt: { mime: 'application/vnd.oasis.opendocument.text', sig: 'zip' }, ods: { mime: 'application/vnd.oasis.opendocument.spreadsheet', sig: 'zip' }, odp: { mime: 'application/vnd.oasis.opendocument.presentation', sig: 'zip' },
  zip: { mime: 'application/zip', sig: 'zip' }, asice: { mime: 'application/vnd.etsi.asic-e+zip', sig: 'zip' },
  doc: { mime: 'application/msword', sig: 'ole' }, xls: { mime: 'application/vnd.ms-excel', sig: 'ole' }, ppt: { mime: 'application/vnd.ms-powerpoint', sig: 'ole' }, msg: { mime: 'application/vnd.ms-outlook', sig: 'ole' },
  txt: { mime: 'text/plain', sig: 'text' }, csv: { mime: 'text/csv', sig: 'text' }, xml: { mime: 'application/xml', sig: 'text' }, eml: { mime: 'message/rfc822', sig: 'text' },
  p7s: { mime: 'application/pkcs7-signature', sig: 'any' }, p7m: { mime: 'application/pkcs7-mime', sig: 'any' },
};
export const ALLOWED_EXTENSIONS = Object.keys(ALLOWED);

const startsWith = (b: Uint8Array, bytes: number[], at = 0) => bytes.every((x, i) => b[at + i] === x);
function sigOk(sig: Sig, b: Uint8Array): boolean {
  switch (sig) {
    case 'pdf': return startsWith(b, [0x25, 0x50, 0x44, 0x46]); // %PDF
    case 'png': return startsWith(b, [0x89, 0x50, 0x4e, 0x47]);
    case 'jpg': return startsWith(b, [0xff, 0xd8, 0xff]);
    case 'gif': return startsWith(b, [0x47, 0x49, 0x46, 0x38]);
    case 'webp': return startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8);
    case 'tif': return startsWith(b, [0x49, 0x49, 0x2a, 0x00]) || startsWith(b, [0x4d, 0x4d, 0x00, 0x2a]);
    case 'zip': return startsWith(b, [0x50, 0x4b, 0x03, 0x04]);
    case 'ole': return startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    case 'text': { const n = Math.min(b.length, 4096); for (let i = 0; i < n; i++) if (b[i] === 0) return false; return true; }
    case 'any': return true;
  }
}

/** Naziv bez putanje i kontrolnih znakova, najviše 200 znakova (ekstenzija se čuva). */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // WP1.19: i znakovi za smjer teksta (npr. U+202E) – naziv „racun\u202Efdp.docx” prikazivao bi se kao drugačija vrsta datoteke.
  // eslint-disable-next-line no-control-regex
  let s = base.replace(/[\u0000-\u001f\u007f"<>|:*?\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  if (s.length > 200) { const dot = s.lastIndexOf('.'); const ext = dot > 0 ? s.slice(dot) : ''; s = s.slice(0, 200 - ext.length) + ext; }
  return s || 'datoteka';
}
export const extensionOf = (name: string): string => { const d = name.lastIndexOf('.'); return d > 0 ? name.slice(d + 1).toLowerCase() : ''; };

/** Provjera prije pohrane: veličina, dopuštena ekstenzija, potpis sadržaja odgovara ekstenziji. Vraća MIME tip za pohranu ili grešku. */
export function checkUpload(fileName: string, size: number, head: Uint8Array): { ok: true; mime: string } | { ok: false; error: string } {
  if (size === 0) return { ok: false, error: 'Datoteka je prazna' };
  if (size > MAX_DOCUMENT_BYTES) return { ok: false, error: `Datoteka je veća od ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB` };
  const ext = extensionOf(fileName);
  const rule = ALLOWED[ext];
  if (!rule) return { ok: false, error: `Vrsta datoteke ".${ext || '?'}" nije dopuštena (dopušteno: ${ALLOWED_EXTENSIONS.join(', ')})` };
  if (!sigOk(rule.sig, head)) return { ok: false, error: `Sadržaj datoteke ne odgovara vrsti .${ext}` };
  return { ok: true, mime: rule.mime };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace('.', ',')} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}
