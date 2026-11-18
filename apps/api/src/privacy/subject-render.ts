import { buildXlsx, type Cell, type Sheet } from '../export/xlsx-writer';
import { esc } from '../finance/timesheet-record';
import { CATEGORY_LABELS, EXPORT_CATEGORIES, type ExportCategory, type ResolvedSubject, type SubjectExport } from './subject-data';

/** Što izvoz sadrži i zašto – isti tekst u `procitaj-me.html` i `podaci.json` (`meta.rules`). */
export const EXPORT_RULES: string[] = [
  'Izvoz sadrži podatke koje ArQus Projekti drži o osobi: korisnički račun, uloge, sesije, članstva u timovima projekata, timesheetove i sate, troškove osoblja, odgovornosti, rizike, projekte i prijave koje vodi, praćenje poziva, dokumente koje je prenijela (popis), obavijesti, isporuke e-pošte i revizijski zapis.',
  'Zapisi člana tima bez korisničkog računa uključeni su samo ako ih je operater izričito pripisao osobi; sustav ih ne pripisuje po imenu.',
  'Podaci drugih osoba nisu uključeni: ni sati, ni iznosi, ni imena drugih članova tima. Uz timesheet je navedeno samo ime osobe koja ga je odobrila (dio zapisa, kao na potpisanoj evidenciji rada).',
  'Revizijski zapis: zapisi kojima je osoba predmet – s promjenama, ali bez identiteta drugih korisnika i njihovih IP adresa; zapisi u kojima je osoba radila na tuđem zapisu – samo vrijeme, radnja i vrsta zapisa, bez sadržaja.',
  'Sadržaj prenesenih datoteka nije u izvozu: datoteke mogu sadržavati podatke drugih osoba koje sustav ne vidi. Popis je u listu „Dokumenti”; datoteke institucija predaje nakon pregleda.',
  'Lozinke, tajne dvofaktorske prijave i tokeni nikad nisu u izvozu (u bazi su samo kao nepovratni otisci ili šifrirani).',
];

export interface ExportMeta {
  institution: string; generatedAt: Date; generatedBy: string; selfService: boolean; appVersion: string;
}

const fmtCell = (v: unknown): Cell => (v === null || v === undefined ? '' : typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 'da' : 'ne') : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v));

/** Radna knjiga: list „Sažetak” i jedan list po nepraznoj kategoriji (stupci = ključevi zapisa). */
export async function subjectWorkbook(s: ResolvedSubject, e: SubjectExport, meta: ExportMeta): Promise<Buffer> {
  const name = s.user?.displayName ?? s.members[0]?.fullName ?? '';
  const sheets: Sheet[] = [{
    name: 'Sažetak', widths: [36, 60],
    rows: [
      [{ v: `Podaci o osobi – ${name}`, s: 'title' }], [],
      ['Institucija (voditelj obrade)', meta.institution], ['Izrađeno', meta.generatedAt.toISOString()], ['Izradio/la', meta.generatedBy],
      ['Iznosi plaća i troškova osoblja', e.withAmounts ? 'uključeni' : 'NISU uključeni (izvoz je izradila osoba bez pristupa podacima o plaćama)'],
      [], [{ v: 'Kategorija', s: 'header' }, { v: 'Broj zapisa', s: 'header' }],
      ...EXPORT_CATEGORIES.map((k) => [CATEGORY_LABELS[k], e.categories[k].length] as Cell[]),
    ],
  }];
  for (const k of EXPORT_CATEGORIES) {
    const list = e.categories[k];
    if (!list.length) continue;
    const keys = [...new Set(list.flatMap((r) => Object.keys(r)))];
    sheets.push({ name: CATEGORY_LABELS[k].slice(0, 31), freezeRows: 1, widths: keys.map(() => 22), rows: [keys.map((x) => ({ v: x, s: 'header' as const })), ...list.map((r) => keys.map((x) => fmtCell(r[x])))] });
  }
  return buildXlsx({ sheets, title: `Podaci o osobi – ${name}`, creator: 'ArQus Projekti' });
}

/** Strojno čitljiv JSON (UTF-8): meta, pravila i kategorije. */
export function subjectJson(s: ResolvedSubject, e: SubjectExport, meta: ExportMeta): Buffer {
  return Buffer.from(JSON.stringify({
    format: 'arqus-osobni-podaci', version: 1,
    meta: { institution: meta.institution, generatedAt: meta.generatedAt.toISOString(), generatedBy: meta.generatedBy, selfService: meta.selfService, appVersion: meta.appVersion,
      withAmounts: e.withAmounts, truncated: e.truncated, rules: EXPORT_RULES },
    subject: { account: s.user ? { displayName: s.user.displayName, email: s.user.email, status: s.user.status } : null, teamMemberRecords: s.members.length },
    categories: e.categories,
  }, null, 2), 'utf8');
}

/** Čitljiv sažetak (samostalan HTML bez skripti). */
export function subjectReadme(s: ResolvedSubject, e: SubjectExport, meta: ExportMeta): Buffer {
  const name = s.user?.displayName ?? s.members[0]?.fullName ?? '';
  const row = (k: ExportCategory) => `<tr><td>${esc(CATEGORY_LABELS[k])}</td><td class="n">${e.categories[k].length}${e.truncated[k] ? ' (skraćeno)' : ''}</td></tr>`;
  const html = `<!doctype html><html lang="hr"><head><meta charset="utf-8"><title>Podaci o osobi – ${esc(name)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;color:#1b1f24}td,th{border-bottom:1px solid #ccd;padding:.3rem .6rem;text-align:left}.n{text-align:right}.note{background:#fff6dd;border:1px solid #e8c766;padding:.6rem .8rem}</style></head><body>
<h1>Podaci o osobi: ${esc(name)}</h1>
<p>Institucija <b>${esc(meta.institution)}</b> je voditelj obrade ovih podataka. Izvoz je izrađen ${esc(meta.generatedAt.toISOString())} (${meta.selfService ? 'osoba ga je sama preuzela u „Moj račun”' : `izradio/la: ${esc(meta.generatedBy)}`}).</p>
${e.withAmounts ? '<p>Iznosi plaća i troškova osoblja <b>su uključeni</b>.</p>' : `<p class="note">Iznosi plaća (godišnji trošak) i iz njih izvedeni troškovi osoblja <b>nisu uključeni</b> – izvoz je izradila osoba bez pristupa podacima o plaćama.${meta.selfService ? ' Potpuni izvoz s iznosima možeš zatražiti od institucije (administrator ArQus Projekata ili službenik za zaštitu podataka).' : ''}</p>`}
<h2>Datoteke</h2><ul><li><code>podaci.json</code> – svi podaci, strojno čitljivo (UTF-8 JSON)</li><li><code>podaci.xlsx</code> – isti podaci po listovima</li><li><code>procitaj-me.html</code> – ovaj sažetak</li></ul>
<h2>Sadržaj</h2><table><thead><tr><th>Kategorija</th><th class="n">Zapisa</th></tr></thead><tbody>${EXPORT_CATEGORIES.map(row).join('')}</tbody></table>
<h2>Pravila izvoza</h2><ul>${EXPORT_RULES.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
</body></html>`;
  return Buffer.from(html, 'utf8');
}
