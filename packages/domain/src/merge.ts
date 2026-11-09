import type { ProgrammePackage, CostCategory } from './programme-package.js';

/**
 * Nasljeđivanje paketa (`meta.extends`): paket po pozivu nasljeđuje programski paket i mijenja samo razlike.
 * Pravila: skalarni i objektni dijelovi se zamjenjuju ako su zadani; nizovi s `code` (kategorije, vrste akcija,
 * šifrarnici) spajaju se po šifri (dijete zamjenjuje/dodaje stavku, ne briše); `validations` po `id`.
 */
export function mergePackages(base: ProgrammePackage, child: ProgrammePackage): ProgrammePackage {
  return {
    ...base,
    ...child,
    meta: { ...base.meta, ...child.meta, sources: [...(base.meta.sources ?? []), ...(child.meta.sources ?? [])] },
    actionTypes: mergeByKey(base.actionTypes, child.actionTypes, 'code'),
    costCategories: mergeCategories(base.costCategories, child.costCategories),
    personnelRule: child.personnelRule ? { ...base.personnelRule, ...child.personnelRule } : base.personnelRule,
    reporting: { ...base.reporting, ...child.reporting },
    proposalStructure: child.proposalStructure ? mergeByKey(base.proposalStructure ?? [], child.proposalStructure, 'code') : base.proposalStructure,
    deliverableTypes: child.deliverableTypes ? mergeByKey(base.deliverableTypes ?? [], child.deliverableTypes, 'code') : base.deliverableTypes,
    disseminationLevels: child.disseminationLevels ? mergeByKey(base.disseminationLevels ?? [], child.disseminationLevels, 'code') : base.disseminationLevels,
    consortiumRules: child.consortiumRules ? { ...base.consortiumRules, ...child.consortiumRules } : base.consortiumRules,
    validations: child.validations ? mergeByKey(base.validations ?? [], child.validations, 'id') : base.validations,
  };
}

function mergeByKey<T extends object, K extends keyof T>(base: T[], child: T[] | undefined, key: K): T[] {
  if (!child) return base;
  const out = [...base];
  for (const c of child) {
    const i = out.findIndex((b) => b[key] === c[key]);
    if (i >= 0) out[i] = { ...out[i], ...c };
    else out.push(c);
  }
  return out;
}

function mergeCategories(base: CostCategory[], child: CostCategory[] | undefined): CostCategory[] {
  if (!child) return base;
  const out = [...base];
  for (const c of child) {
    const i = out.findIndex((b) => b.code === c.code);
    if (i >= 0) {
      const b = out[i]!;
      out[i] = { ...b, ...c, calculation: c.calculation ? { ...b.calculation, ...c.calculation } : b.calculation,
        constraints: c.constraints ? { ...b.constraints, ...c.constraints } : b.constraints,
        children: c.children ? mergeCategories(b.children ?? [], c.children) : b.children };
    } else out.push(c);
  }
  return out;
}

/** Razriješi lanac nasljeđivanja: `resolve(child, id => parentPackage)`. Otkriva kružno nasljeđivanje. */
export function resolvePackage(pkg: ProgrammePackage, lookup: (id: string) => ProgrammePackage | undefined): ProgrammePackage {
  const seen = new Set<string>([pkg.meta.id]);
  let current = pkg;
  const chain: ProgrammePackage[] = [];
  while (current.meta.extends) {
    if (seen.has(current.meta.extends)) throw new Error(`Kružno nasljeđivanje paketa: ${[...seen].join(' → ')} → ${current.meta.extends}`);
    const parent = lookup(current.meta.extends);
    if (!parent) throw new Error(`Nadređeni paket "${current.meta.extends}" nije pronađen`);
    seen.add(parent.meta.id);
    chain.unshift(current);
    current = parent;
  }
  let result = current;
  for (const c of chain) result = mergePackages(result, c);
  return { ...result, meta: { ...result.meta, id: pkg.meta.id, version: pkg.meta.version, extends: pkg.meta.extends } };
}
