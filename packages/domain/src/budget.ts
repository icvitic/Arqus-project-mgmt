import type { ProgrammePackage } from './programme-package.js';
import { flattenCategories } from './programme-package.js';

/** Iznosi su u centima (invarijanta: cijeli brojevi). */
export type BudgetLines = Record<string, number>; // šifra kategorije → iznos u centima

export interface PartnerBudgetResult {
  direct: Record<string, number>;
  indirect: Record<string, number>;
  directTotal: number;
  indirectTotal: number;
  total: number;
  ratePercent: number;
  requested: number;
  warnings: string[];
}

/**
 * Izračun proračuna jednog partnera po pravilima paketa: neizravni troškovi i zatraženi doprinos su izvedeni
 * (domenski model, invarijanta 4). Nepoznate šifre kategorija bacaju grešku (invarijanta 3).
 */
export function computePartnerBudget(
  pkg: ProgrammePackage,
  actionCode: string,
  lines: BudgetLines,
  beneficiaryType = 'default',
): PartnerBudgetResult {
  const cats = flattenCategories(pkg.costCategories);
  const byCode = new Map(cats.map((c) => [c.code, c]));
  const direct: Record<string, number> = {};
  const warnings: string[] = [];

  for (const [code, amount] of Object.entries(lines)) {
    const c = byCode.get(code);
    if (!c) throw new Error(`Nepoznata kategorija troška "${code}" u paketu ${pkg.meta.id}`);
    if (c.kind === 'indirect') throw new Error(`Neizravni troškovi (${code}) se ne unose ručno`);
    if (!Number.isInteger(amount) || amount < 0) throw new Error(`Iznos za ${code} mora biti nenegativan cijeli broj centi`);
    direct[code] = amount;
  }
  const directTotal = Object.values(direct).reduce((a, b) => a + b, 0);

  // zbroj po kategoriji uključujući podkategorije (npr. "C" = C.1 + C.2 + C.3), preskačući isključene
  const sumOf = (code: string, excluded: ReadonlySet<string> = new Set()): number => {
    const c = byCode.get(code);
    if (!c || excluded.has(code)) return 0;
    const own = direct[code] ?? 0;
    const kids = (c.children ?? []).reduce((a, k) => a + sumOf(k.code, excluded), 0);
    return own + kids;
  };

  const indirect: Record<string, number> = {};
  for (const c of cats.filter((x) => x.kind === 'indirect')) {
    const excluded = new Set(c.calculation?.excludeCategories ?? []);
    const base = (c.calculation?.baseCategories ?? []).reduce((a, b) => a + sumOf(b, excluded), 0);
    indirect[c.code] = Math.round((base * (c.calculation?.ratePercent ?? 0)) / 100);
  }
  const indirectTotal = Object.values(indirect).reduce((a, b) => a + b, 0);

  for (const c of cats) {
    const m = c.constraints?.maxPercentOfDirect;
    if (m !== undefined && directTotal > 0 && sumOf(c.code) > (directTotal * m) / 100) {
      warnings.push(`${c.code} ${c.name}: prelazi ${m} % izravnih troškova`);
    }
  }

  const action = pkg.actionTypes.find((a) => a.code === actionCode);
  if (!action) throw new Error(`Nepoznata vrsta akcije "${actionCode}"`);
  const rate = action.fundingRates.find((r) => r.beneficiaryType === beneficiaryType)
    ?? action.fundingRates.find((r) => r.beneficiaryType === 'default');
  const ratePercent = rate?.ratePercent ?? 100;
  const total = directTotal + indirectTotal;
  return { direct, indirect, directTotal, indirectTotal, total, ratePercent, requested: Math.round((total * ratePercent) / 100), warnings };
}
