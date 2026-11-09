/** Paket programa v1 – TypeScript tipovi usklađeni sa shemom `schema/programme-package.v1.json` (ADR-0004). */

export type CostKind = 'direct' | 'indirect' | 'unit' | 'lumpSum';
export type Severity = 'error' | 'warning' | 'info';
export type PackageStatus = 'draft' | 'published' | 'deprecated';

export interface CostCategory {
  code: string;
  name: string;
  kind: CostKind;
  calculation?: {
    ratePercent?: number;
    baseCategories?: string[];
    excludeCategories?: string[];
    unitPrice?: number;
    unit?: string;
  };
  constraints?: {
    maxPercentOfDirect?: number;
    requiresJustification?: boolean;
    requiresEvidence?: boolean;
    vatEligible?: 'yes' | 'no' | 'ifNotRecoverable';
  };
  children?: CostCategory[];
}

export interface FundingRate { beneficiaryType: string; ratePercent: number }
export interface ActionType { code: string; name: string; fundingRates: FundingRate[] }
export interface CodeName { code: string; name: string }

export interface ProgrammePackage {
  meta: {
    id: string;
    extends?: string;
    programme: string;
    funder?: string;
    version: string;
    status?: PackageStatus;
    validFrom: string;
    validTo?: string;
    language: string;
    sources?: string[];
    notes?: string;
  };
  actionTypes: ActionType[];
  costCategories: CostCategory[];
  personnelRule?: {
    method?: 'dailyRate' | 'hourlyRate' | 'unitCost' | 'actualSalary';
    divisor?: number;
    maxUnitsPerYear?: number;
    timeRecordingRequired?: boolean;
    declarationAllowed?: boolean;
  };
  reporting: {
    periodMonths: number;
    submissionDeadlineDays: number;
    finalReportDeadlineDays?: number;
    reportTypes?: { code: string; name: string; template?: string; sections?: string[] }[];
  };
  proposalStructure?: { code: string; name: string; pageLimit?: number; required?: boolean; sections?: string[] }[];
  deliverableTypes?: CodeName[];
  disseminationLevels?: CodeName[];
  consortiumRules?: {
    minPartners?: number;
    minCountries?: number;
    eligibleCountries?: string[];
    eligibleOrganisationTypes?: string[];
    notes?: string;
  };
  validations?: { id: string; severity: Severity; rule: string; message: string }[];
}

/** Ravna lista svih kategorija (uključujući podkategorije). */
export function flattenCategories(categories: CostCategory[]): CostCategory[] {
  return categories.flatMap((c) => [c, ...(c.children ? flattenCategories(c.children) : [])]);
}

/** Kategorije u koje se smiju unositi stavke proračuna (listovi bez djece, osim neizravnih). */
export function enterableCategories(pkg: ProgrammePackage): CostCategory[] {
  return flattenCategories(pkg.costCategories).filter(
    (c) => (c.kind === 'direct' || c.kind === 'unit' || c.kind === 'lumpSum') && !(c.children && c.children.length),
  );
}
