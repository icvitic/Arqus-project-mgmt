export interface Me { user: { id: string; email: string; displayName: string }; tenant: { id: string; slug: string; name: string } | null; permissions: string[] }
export interface PackageSummary { id: string; packageId: string; version: string; programme: string; status: string; scope: 'global' | 'tenant' }
export interface Category { code: string; name: string; kind: string; children?: Category[] }
export interface PackageDetail {
  meta: { id: string; programme: string; version: string }; actionTypes: { code: string; name: string }[]; costCategories: Category[];
  deliverableTypes?: { code: string; name: string }[]; disseminationLevels?: { code: string; name: string }[]; _row: PackageSummary;
}
export interface Organisation { id: string; name: string; country: string; type: string; nonProfit: boolean; isSelf: boolean; identifiers: { pic?: string; oib?: string } }
export interface ProjectSummary { id: string; acronym: string; title: string; status: string; role: string; actionType: string; package: { id: string; version: string }; contractNo: string | null; startDate: string | null; durationMonths: number | null; partnerCount: number }
export interface Partner { id: string; organisationId: string; name: string; country: string; isSelf: boolean; role: string; beneficiaryType: string; orderNo: number }
export interface Period { number: number; startDate: string; endDate: string; dueDate: string }
export interface Project extends Omit<ProjectSummary, 'partnerCount'> { partners: Partner[]; reportingPeriods: Period[] }
export interface Task { id: string; code: string; title: string; startMonth: number; endMonth: number; status: string }
export interface Deliverable { id: string; code: string; title: string; type: string; dissemination: string; dueMonth: number; dueDate: string | null; status: string }
export interface WorkPackage { id: string; code: string; number: number; title: string; startMonth: number; endMonth: number; leadPartnerId: string | null; tasks: Task[]; deliverables: Deliverable[] }
export interface Structure {
  workPackages: WorkPackage[]; milestones: { id: string; code: string; title: string; dueMonth: number; dueDate: string | null; status: string }[];
  risks: { id: string; number: number; description: string; likelihood: number; impact: number; mitigation: string | null; status: string; score: number; level: string }[];
}
export interface PartnerBudget { partnerId: string; name?: string; directTotal: number; indirectTotal: number; total: number; ratePercent: number; requested: number }
export interface Budget {
  version: number | null; status: string; categories: Category[]; lines: { partnerId: string; categoryCode: string; workPackageId: string | null; amount: number }[];
  partners: PartnerBudget[]; totals: { direct: number; indirect: number; total: number; requested: number }; warnings: string[];
}
export interface TeamMember { id: string; fullName: string; userId: string | null; partnerId: string; role: string | null; annualCost: number; active: boolean }
export interface Timesheet { status: string; entries: { day: number; minutes: number; workPackageId: string | null }[]; totalMinutes: number; warnings: string[] }
export interface Expense { id: string; partnerId: string; categoryCode: string; workPackageId: string | null; date: string; description: string; supplier: string | null; amount: number; evidenceRef: string | null; source: string; status: string }
export interface Claim {
  id: string; period: Period; status: string; expenses: { id: string; date: string; categoryCode: string; description: string; amount: number; status: string }[];
  totals: { direct: number; indirect: number; total: number; ratePercent: number; requested: number }; requested: number | null; approved: number | null; paid: number | null; note: string | null;
}
export interface FinanceOverview {
  budgetStatus: string; planned: { direct: number; indirect: number; total: number; requested: number }; actual: { direct: number; indirect: number; total: number; requested: number };
  byCategory: { code: string; name: string; planned: number; actual: number; remaining: number; percent: number | null }[]; byPartner: { partnerId: string; name: string; planned: number; actual: number }[];
}
export interface UserRow { id: string; email: string; displayName: string }

/** Kategorije u koje se unose iznosi: listovi stabla bez neizravnih. */
export function enterable(categories: Category[]): Category[] {
  return categories.flatMap((c) => (c.children && c.children.length ? enterable(c.children) : [c])).filter((c) => c.kind !== 'indirect');
}
