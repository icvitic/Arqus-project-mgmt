import type { Category, PackageContent } from './types';

/** Obrazac „paket po pozivu”: nasljeđuje programski paket (`extends`) i navodi samo pravila poziva (ADR-0004). */
export interface PackageForm {
  parentId: string;
  callCode: string;
  id: string;
  programme: string;
  version: string;
  validFrom: string;
  validTo: string;
  sourceUrl: string;
  notes: string;
  periodMonths: string;
  deadlineDays: string;
  personnelMethod: string;
  personnelDivisor: string;
  /** akcija → vrsta korisnika → stopa (%) */
  rates: Record<string, Record<string, string>>;
  /** neizravna kategorija → stopa i osnovica */
  indirect: Record<string, { rate: string; base: string[] }>;
  extraCategories: { code: string; name: string }[];
}

/** "NPOO.C3.2.R2-I1.05" → "npoo-c3-2-r2-i1-05" (dopušteno u meta.id). */
export function slugify(input: string): string {
  return input.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

export const flatten = (cats: Category[]): Category[] => cats.flatMap((c) => [c, ...(c.children ? flatten(c.children) : [])]);

/** Početno stanje iz roditelja (razriješenog paketa) i, za novu verziju, iz izvornog sadržaja postojećeg paketa po pozivu. */
export function initialForm(parent: PackageContent & { meta: { id: string } }, existing?: PackageContent): PackageForm {
  const src = existing;
  const indirectCats = flatten(parent.costCategories).filter((c) => c.kind === 'indirect');
  const overrideOf = (code: string) => src ? flatten(src.costCategories).find((c) => c.code === code) : undefined;
  const actionOverride = (code: string) => src?.actionTypes.find((a) => a.code === code);
  return {
    parentId: parent.meta.id,
    callCode: src?.meta.programme ?? '',
    id: src?.meta.id ?? '',
    programme: src?.meta.programme ?? '',
    version: src ? bumpMinor(src.meta.version) : '1.0.0',
    validFrom: src?.meta.validFrom ?? '',
    validTo: src?.meta.validTo ?? '',
    sourceUrl: src?.meta.sources?.[0] ?? '',
    notes: src?.meta.notes ?? '',
    periodMonths: String(src?.reporting.periodMonths ?? parent.reporting.periodMonths),
    deadlineDays: String(src?.reporting.submissionDeadlineDays ?? parent.reporting.submissionDeadlineDays),
    personnelMethod: src?.personnelRule?.method ?? parent.personnelRule?.method ?? '',
    personnelDivisor: String(src?.personnelRule?.divisor ?? parent.personnelRule?.divisor ?? ''),
    rates: Object.fromEntries(parent.actionTypes.map((a) => [a.code, Object.fromEntries((actionOverride(a.code) ?? a).fundingRates.map((r) => [r.beneficiaryType, String(r.ratePercent)]))])),
    indirect: Object.fromEntries(indirectCats.map((c) => {
      const o = overrideOf(c.code)?.calculation;
      return [c.code, { rate: String(o?.ratePercent ?? c.calculation?.ratePercent ?? 0), base: o?.baseCategories ?? c.calculation?.baseCategories ?? [] }];
    })),
    extraCategories: src ? src.costCategories.filter((c) => c.kind !== 'indirect' && !flatten(parent.costCategories).some((p) => p.code === c.code)).map((c) => ({ code: c.code, name: c.name })) : [],
  };
}

export function bumpMinor(v: string): string {
  const [maj = 1, min = 0] = v.split('.').map(Number);
  return `${maj}.${min + 1}.0`;
}

const num = (s: string) => (s.trim() === '' ? undefined : Number(s.replace(',', '.')));

/** Gradi JSON paketa po pozivu. Neizravne kategorije, stope i razdoblja upisuju se eksplicitno radi preglednosti. */
export function buildChildPackage(parent: PackageContent & { meta: { id: string } }, f: PackageForm): PackageContent {
  const parentCats = flatten(parent.costCategories);
  const method = f.personnelMethod || undefined; const divisor = num(f.personnelDivisor);
  return {
    meta: {
      id: f.id, extends: parent.meta.id, programme: f.programme, version: f.version, validFrom: f.validFrom,
      ...(f.validTo ? { validTo: f.validTo } : {}), language: 'hr',
      ...(f.sourceUrl ? { sources: [f.sourceUrl] } : {}), ...(f.notes ? { notes: f.notes } : {}),
    },
    actionTypes: parent.actionTypes.map((a) => ({ code: a.code, name: a.name, fundingRates: a.fundingRates.map((r) => ({ beneficiaryType: r.beneficiaryType, ratePercent: num(f.rates[a.code]?.[r.beneficiaryType] ?? '') ?? r.ratePercent })) })),
    costCategories: [
      ...parentCats.filter((c) => c.kind === 'indirect').map((c) => ({
        code: c.code, name: c.name, kind: 'indirect',
        calculation: { ...c.calculation, ratePercent: num(f.indirect[c.code]?.rate ?? '') ?? 0, baseCategories: f.indirect[c.code]?.base ?? [] },
      })),
      ...f.extraCategories.filter((c) => c.code.trim() && c.name.trim()).map((c) => ({ code: c.code.trim(), name: c.name.trim(), kind: 'direct' })),
    ],
    ...(method || divisor ? { personnelRule: { ...(method ? { method } : {}), ...(divisor ? { divisor } : {}) } } : {}),
    reporting: { periodMonths: num(f.periodMonths) ?? parent.reporting.periodMonths, submissionDeadlineDays: num(f.deadlineDays) ?? parent.reporting.submissionDeadlineDays },
  };
}
