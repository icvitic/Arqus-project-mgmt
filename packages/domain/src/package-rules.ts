/**
 * Valjanost paketa programa i pravila `validations` (WP1.14b). Čiste funkcije.
 *
 * Pravilo:
 *  - zastario paket ili paket koji još ne vrijedi (`validFrom` je poslije današnjeg dana) BLOKIRA stvaranje projekta i prijave;
 *  - projekt ili prijava izvan razdoblja valjanosti paketa, ili koja krši provjerljivo pravilo `validations`, prihvaća se,
 *    ali nosi vidljiva odstupanja („Odstupanja od pravila programa”) koja se računaju svaki put iznova.
 *
 * Razdoblje valjanosti (`validFrom`–`validTo`) odnosi se na POČETAK projekta (ugovaranje u razdoblju programa), ne na kraj:
 * projekti Obzora Europa ugovoreni 2027. traju do 2031. Ograničenje kraja provedbe (npr. NPOO, RRF do 31. 8. 2026.) izražava
 * se pravilom u `validations` (`project.endDate > 2026-06-30`). Projekt bez početka i otvorena prijava uspoređuju se s današnjim danom.
 *
 * Jezik pravila (podskup koji se može provjeriti bez dodatnih podataka): `A op B`, op ∈ `> >= < <= == !=`; operandi su broj,
 * datum `GGGG-MM-DD`, `null`, `project.startDate`, `project.endDate`, `package.extends`, `sum(KOD)` (zbroj proračuna u kategoriji
 * s podkategorijama), `sum(direct)` (izravni troškovi) i umnožak `broj * operand`. Pravilo opisuje KRŠENJE (istinito = odstupanje).
 * Pravilo koje se ne može izračunati (nepoznat izraz ili nedostaju podaci) preskače se – nikad ne daje lažno odstupanje.
 */
import type { CostCategory, ProgrammePackage, Severity } from './programme-package.js';
import { flattenCategories } from './programme-package.js';

export interface PackageDeviation { key: string; severity: Severity; message: string }

const hrDate = (iso: string): string => `${iso.slice(8, 10)}. ${iso.slice(5, 7)}. ${iso.slice(0, 4)}.`;

/** Razlog zbog kojeg se na paketu ne smije stvoriti projekt ili prijava; null = smije. */
export function packageAvailabilityIssue(pkg: Pick<ProgrammePackage, 'meta'>, status: string, today: string): string | null {
  if (status === 'deprecated') return `Paket ${pkg.meta.id} v${pkg.meta.version} je zastario`;
  if (pkg.meta.validFrom && today < pkg.meta.validFrom) return `Paket ${pkg.meta.id} v${pkg.meta.version} vrijedi tek od ${hrDate(pkg.meta.validFrom)}`;
  return null;
}

export interface DeviationFacts {
  /** Današnji dan institucije. */
  today: string;
  kind: 'project' | 'proposal';
  startDate?: string | null;
  endDate?: string | null;
  /** Prijava: interni rok; ulazi u provjeru valjanosti umjesto početka projekta. */
  internalDeadline?: string | null;
  /** Prijava: je li još otvorena (ideja, priprema, interna provjera) – zaključena prijava ne dobiva upozorenje „paket je istekao”. */
  open?: boolean;
  /** Retci proračuna (kategorija, iznos u centima); izostavljeno = pravila nad proračunom se ne provjeravaju. */
  budget?: { categoryCode: string; amount: number }[];
}

type Value = number | string | null;
type Ctx = { facts: DeviationFacts; pkg: ProgrammePackage; categories: CostCategory[] };

/** Vrijednost operanda ili `undefined` ako se ne može izračunati. */
function operand(raw: string, c: Ctx): Value | undefined {
  const s = raw.trim();
  const product = /^(\d+(?:\.\d+)?)\s*\*\s*(.+)$/.exec(s);
  if (product) {
    const v = operand(product[2]!, c);
    return typeof v === 'number' ? Number(product[1]) * v : undefined;
  }
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s === 'null') return null;
  if (s === 'project.startDate') return c.facts.kind === 'project' ? (c.facts.startDate ?? undefined) : undefined;
  if (s === 'project.endDate') return c.facts.kind === 'project' ? (c.facts.endDate ?? undefined) : undefined;
  if (s === 'package.extends') return c.pkg.meta.extends ?? null;
  const sum = /^sum\(\s*([A-Za-z0-9_.]+)\s*\)$/.exec(s);
  if (sum) {
    const lines = c.facts.budget;
    if (!lines) return undefined;
    const code = sum[1]!;
    if (code === 'direct') {
      const direct = new Set(c.categories.filter((x) => x.kind !== 'indirect').map((x) => x.code));
      return lines.filter((l) => direct.has(l.categoryCode)).reduce((a, l) => a + l.amount, 0);
    }
    const cat = c.categories.find((x) => x.code === code);
    if (!cat) return undefined;
    const codes = new Set(flattenCategories([cat]).map((x) => x.code));
    return lines.filter((l) => codes.has(l.categoryCode)).reduce((a, l) => a + l.amount, 0);
  }
  return undefined;
}

/** Je li pravilo prekršeno: true / false, ili null kad se ne može izračunati. */
export function evaluateRule(rule: string, pkg: ProgrammePackage, facts: DeviationFacts): boolean | null {
  const m = /^(.+?)\s*(>=|<=|==|!=|>|<)\s*(.+)$/.exec(rule.trim());
  if (!m) return null;
  const c: Ctx = { facts, pkg, categories: flattenCategories(pkg.costCategories) };
  const a = operand(m[1]!, c), b = operand(m[3]!, c);
  if (a === undefined || b === undefined) return null;
  const op = m[2]!;
  if (op === '==') return a === b;
  if (op === '!=') return a !== b;
  if (a === null || b === null || typeof a !== typeof b) return null;
  switch (op) {
    case '>': return a > b;
    case '>=': return a >= b;
    case '<': return a < b;
    default: return a <= b;
  }
}

/** Odstupanja projekta ili prijave od valjanosti i provjerljivih pravila paketa (bez pravila razine `info`). */
export function packageDeviations(pkg: ProgrammePackage, facts: DeviationFacts): PackageDeviation[] {
  const out: PackageDeviation[] = [];
  const { validFrom, validTo } = pkg.meta;
  const range = `${hrDate(validFrom)} – ${validTo ? hrDate(validTo) : 'bez kraja'}`;
  const reference = facts.kind === 'project' ? facts.startDate : facts.internalDeadline;
  if (reference) {
    if (reference < validFrom || (validTo && reference > validTo)) {
      out.push({ key: 'validity', severity: 'warning', message: facts.kind === 'project'
        ? `Početak projekta (${hrDate(reference)}) je izvan razdoblja valjanosti paketa ${pkg.meta.id} (${range}).`
        : `Interni rok prijave (${hrDate(reference)}) je izvan razdoblja valjanosti paketa ${pkg.meta.id} (${range}).` });
    }
  } else if ((facts.kind === 'project' || facts.open) && validTo && facts.today > validTo) {
    out.push({ key: 'validity', severity: 'warning', message: `Paket ${pkg.meta.id} vrijedio je do ${hrDate(validTo)} – provjeri vrijedi li program još za ${facts.kind === 'project' ? 'ovaj projekt' : 'ovu prijavu'}.` });
  }
  for (const v of pkg.validations ?? []) {
    if (v.severity === 'info') continue;
    if (evaluateRule(v.rule, pkg, facts) === true) out.push({ key: `rule:${v.id}`, severity: v.severity, message: v.message });
  }
  return out;
}
