export interface Me { user: { id: string; email: string; displayName: string; mfaEnabled: boolean }; tenant: { id: string; slug: string; name: string } | null; permissions: string[] }
export interface PackageSummary { id: string; packageId: string; version: string; programme: string; funder: string | null; status: string; scope: 'global' | 'tenant'; extendsId: string | null; validFrom: string; validTo: string | null; publishedAt: string | null }
export interface Category { code: string; name: string; kind: string; calculation?: { ratePercent?: number; baseCategories?: string[]; excludeCategories?: string[] }; children?: Category[] }
export interface ActionType { code: string; name: string; fundingRates: { beneficiaryType: string; ratePercent: number }[] }
export interface PackageContent {
  meta: { id: string; extends?: string; programme: string; funder?: string; version: string; status?: string; validFrom: string; validTo?: string; language: string; sources?: string[]; notes?: string };
  actionTypes: ActionType[]; costCategories: Category[];
  personnelRule?: { method?: string; divisor?: number; categoryCode?: string; maxUnitsPerYear?: number; timeRecordingRequired?: boolean };
  reporting: { periodMonths: number; submissionDeadlineDays: number; finalReportDeadlineDays?: number };
  deliverableTypes?: { code: string; name: string }[]; disseminationLevels?: { code: string; name: string }[];
  validations?: { id: string; severity: string; rule: string; message: string }[];
}
export interface PackageDetail extends PackageContent { _row: PackageSummary }
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
export interface TeamMember { id: string; fullName: string; userId: string | null; partnerId: string; role: string | null; annualCost: number | null; active: boolean }
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
export interface UserRow { id: string; email: string; displayName: string; status: string; mfaEnabled: boolean; lastLoginAt: string | null; roles: string[] }
export interface RoleRow { code: string; name: string; scope: string; system: boolean }

/** Kategorije u koje se unose iznosi: listovi stabla bez neizravnih. */
export function enterable(categories: Category[]): Category[] {
  return categories.flatMap((c) => (c.children && c.children.length ? enterable(c.children) : [c])).filter((c) => c.kind !== 'indirect');
}

export interface CallDeadline { kind: 'submission' | 'stage1' | 'stage2' | 'info_day' | 'other'; at: string; label?: string }
export interface CallTracking { fitScores: Record<string, number> | null; fitTotal: number | null; fitComment: string | null; assessedAt: string | null; decision: 'go' | 'no_go' | 'watch' | null; rationale: string | null; decidedAt: string | null; internalDeadline: string | null; ownerUserId: string | null }
export interface CallSummary {
  id: string; scope: 'global' | 'tenant'; code: string; title: string; summary: string | null; programme: string; funder: string | null; packageId: string | null; actionTypes: string[];
  budget: number | null; expectedGrants: number | null; opensAt: string | null; deadlines: CallDeadline[]; url: string | null; tags: string[];
  status: 'announced' | 'open' | 'closed' | 'cancelled'; nextDeadline: CallDeadline | null; daysToNextDeadline: number | null; tracking: CallTracking | null;
}
export interface CallDetail extends CallSummary { history: { at: string; action: string; actor: string | null; after: Record<string, unknown> | null }[] }
export interface UpcomingDeadline { callId: string; code: string; title: string; kind: string; label: string; at: string; days: number; decision: string | null }

export interface ProposalSummary { id: string; acronym: string; title: string; status: string; role: string; callId: string | null; callCode: string | null; packageId: string; actionType: string; internalDeadline: string | null; members: number; projectId: string | null; requested: number | null }
export interface ProposalMember { id: string; organisationId: string; name: string; country: string; isSelf: boolean; role: string; beneficiaryType: string; confirmed: boolean; orderNo: number }
export interface ProposalWp { id: string; code: string; number: number; title: string; leadMemberId: string | null; startMonth: number; endMonth: number; personMonths: number }
export interface Proposal {
  id: string; acronym: string; title: string; status: string; role: string; actionType: string; durationMonths: number; internalDeadline: string | null; leadUserId: string | null;
  package: { rowId: string; id: string; version: string }; call: { id: string; code: string; title: string; status: string } | null;
  members: ProposalMember[]; workPackages: ProposalWp[];
  budget: { version: number; locked: boolean; categories: Category[]; lines: { memberId: string; categoryCode: string; amount: number }[]; partners: PartnerBudget[]; totals: Budget['totals']; warnings: string[] };
  readiness: { key: string; label: string; ok: boolean; detail?: string }[]; ready: boolean;
  submission: { portal: string; reference: string; at: string; requested: number; total: number; budgetVersion: number } | null;
  outcome: { result: string; score?: string; note?: string; at: string } | null; projectId: string | null;
}
