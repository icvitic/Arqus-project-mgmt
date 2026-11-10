import Ajv2020Module, { type ErrorObject } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import schema from './schema/programme-package.v1.json' with { type: 'json' };
import type { ProgrammePackage } from './programme-package.js';
import { flattenCategories } from './programme-package.js';

export interface ValidationIssue { path: string; message: string }
export type ValidationResult =
  | { ok: true; pkg: ProgrammePackage }
  | { ok: false; issues: ValidationIssue[] };

/** CJS→ESM interop: Node daje `module.exports`, TS tipovi očekuju `default`. */
function interop<T>(m: T): T extends { default: infer D } ? D : T {
  return ((m as { default?: unknown }).default ?? m) as T extends { default: infer D } ? D : T;
}
const Ajv2020 = interop(Ajv2020Module);
const addFormats = interop(addFormatsModule);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

function fromAjv(errors: ErrorObject[] | null | undefined): ValidationIssue[] {
  return (errors ?? []).map((e) => ({ path: e.instancePath || '/', message: e.message ?? 'neispravno' }));
}

/** Semantička pravila koja JSON shema ne može izraziti. */
export function semanticIssues(pkg: ProgrammePackage): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const all = flattenCategories(pkg.costCategories);
  const codes = new Set<string>();
  all.forEach((c) => {
    if (codes.has(c.code)) issues.push({ path: `/costCategories/${c.code}`, message: `dvostruka šifra kategorije "${c.code}"` });
    codes.add(c.code);
  });
  all.forEach((c) => {
    if (c.kind === 'indirect') {
      if (c.calculation?.ratePercent === undefined) issues.push({ path: `/costCategories/${c.code}`, message: 'neizravna kategorija mora imati calculation.ratePercent' });
      (c.calculation?.baseCategories ?? []).forEach((b) => {
        if (!codes.has(b)) issues.push({ path: `/costCategories/${c.code}/calculation/baseCategories`, message: `nepoznata osnovica "${b}"` });
      });
      if (!c.calculation?.baseCategories?.length) issues.push({ path: `/costCategories/${c.code}`, message: 'neizravna kategorija mora imati osnovicu (baseCategories)' });
    }
  });
  pkg.actionTypes.forEach((a) => {
    if (!a.fundingRates.some((r) => r.beneficiaryType === 'default')) {
      issues.push({ path: `/actionTypes/${a.code}`, message: 'nedostaje stopa financiranja za beneficiaryType "default"' });
    }
  });
  const pc = pkg.personnelRule?.categoryCode;
  if (pc) {
    const c = all.find((x) => x.code === pc);
    if (!c || c.kind === 'indirect' || (c.children && c.children.length)) issues.push({ path: '/personnelRule/categoryCode', message: `"${pc}" nije kategorija u koju se unose troškovi` });
  }
  if (pkg.meta.validTo && pkg.meta.validTo < pkg.meta.validFrom) {
    issues.push({ path: '/meta/validTo', message: 'validTo je prije validFrom' });
  }
  return issues;
}

/** Validira JSON paket programa prema shemi v1 i semantičkim pravilima (semantika se preskače za pakete s `extends`; za njih validirati razriješeni paket). */
export function validateProgrammePackage(input: unknown, opts: { schemaOnly?: boolean } = {}): ValidationResult {
  if (!validateSchema(input)) return { ok: false, issues: fromAjv(validateSchema.errors) };
  const pkg = input as unknown as ProgrammePackage;
  // Dijete s `extends` nasljeđuje osnovice, stope i vrste akcija – semantika se provjerava tek na razriješenom paketu.
  const issues = opts.schemaOnly || pkg.meta.extends ? [] : semanticIssues(pkg);
  return issues.length ? { ok: false, issues } : { ok: true, pkg };
}
