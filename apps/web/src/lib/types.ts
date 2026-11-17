/** `permissions` – dozvole na razini institucije; `projectPermissions` – dozvole po projektu (WP1.14). */
export interface Me { user: { id: string; email: string; displayName: string; mfaEnabled: boolean }; tenant: { id: string; slug: string; name: string } | null; permissions: string[]; projectPermissions: Record<string, string[]> }
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
/** `annualCost` je null bez dozvole personnel:read; `costSet` kaže je li trošak upisan. */
export interface TeamMember { id: string; fullName: string; userId: string | null; partnerId: string; role: string | null; annualCost: number | null; costSet: boolean; active: boolean }
export interface Timesheet { status: string; entries: { day: number; minutes: number; workPackageId: string | null }[]; totalMinutes: number; warnings: string[] }
/** Trošak; `person`/`month`/`workPackage` za troškove osoblja (grupiranje po osobi i mjesecu). `recognised` – priznati iznos nakon odluke o ZNS-u. */
export interface Expense {
  id: string; partnerId: string; categoryCode: string; workPackageId: string | null; date: string; description: string; supplier: string | null; amount: number; recognised: number | null; decisionReason: string | null;
  evidenceRef: string | null; source: string; status: string; documents: number; timesheetId: string | null; person: string | null; month: string | null; workPackage: string | null;
}
export interface Money { direct: number; indirect: number; total: number; requested: number }
export interface ChecklistItem { key: string; ok: boolean; severity: 'blocking' | 'warning'; title: string; details: string[]; resolution?: 'early_reason' | 'acknowledge'; expenseIds?: string[] }
export interface ClaimExpense {
  id: string; date: string; categoryCode: string; description: string; supplier: string | null; amount: number; recognised: number | null; decisionReason: string | null;
  status: string; source: string; documents: number; timesheetId: string | null; person: string | null; month: string | null; workPackage: string | null;
}
export interface Claim {
  id: string; period: Period; status: string; expenses: ClaimExpense[]; missingEvidence: number;
  totals: Money & { ratePercent: number }; recognised: Money | null; unrecognised: Money | null;
  checklist: { items: ChecklistItem[]; canSubmit: boolean; early: boolean } | null;
  earlyReason: string | null; submission: { early: boolean; earlyReason: string | null; acknowledgedWithoutEvidence: { id: string; date: string; description: string; amount: number }[]; warnings: { key: string; title: string; details: string[] }[] } | null;
  decision: { date: string | null; computed: number; funderTotal: number | null; difference: number; backfilled: boolean } | null;
  requested: number | null; approved: number | null; paid: number | null; submittedAt: string | null; decisionDate: string | null; paidAt: string | null; paymentNote: string | null; note: string | null;
}
export interface DecisionPreview { outcome: string; claimed: Money; recognised: Money; unrecognised: Money; computed: number; funderTotal: number | null; approved: number; difference: number; errors: string[] }
export interface FinanceOverview {
  budgetStatus: string; planned: Money; actual: Money; unrecognised: Money;
  byCategory: { code: string; name: string; planned: number; actual: number; unrecognised: number; remaining: number; percent: number | null }[]; byPartner: { partnerId: string; name: string; planned: number; actual: number; unrecognised: number }[];
}
export interface ProjectRole { assignmentId: string; code: string; projectId: string; acronym: string | null }
/** `roles` – uloge na razini institucije; `projectRoles` – uloge na pojedinom projektu. */
export interface UserRow { id: string; email: string; displayName: string; status: string; mfaEnabled: boolean; lastLoginAt: string | null; roles: string[]; projectRoles: ProjectRole[] }
export interface RoleRow { code: string; name: string; scope: string; system: boolean }
export interface AccessEntry { assignmentId: string | null; userId: string; displayName: string; email: string; status: string; roleCode: string; roleName: string; scope: 'tenant' | 'project'; revocable: boolean }
export interface ProjectAccess { projectId: string; entries: AccessEntry[]; users: { id: string; displayName: string; email: string }[]; roles: { code: string; name: string; scope: string; grantable: boolean }[] }

/** Kategorije u koje se unose iznosi: listovi stabla bez neizravnih. */
export function enterable(categories: Category[]): Category[] {
  return categories.flatMap((c) => (c.children && c.children.length ? enterable(c.children) : [c])).filter((c) => c.kind !== 'indirect');
}

export interface CallDeadline { kind: 'submission' | 'stage1' | 'stage2' | 'info_day' | 'other'; at: string; label?: string }
export interface CallTracking { fitScores: Record<string, number> | null; fitTotal: number | null; fitComment: string | null; assessedAt: string | null; decision: 'go' | 'no_go' | 'watch' | null; rationale: string | null; decidedAt: string | null; internalDeadline: string | null; ownerUserId: string | null }
export interface CallSummary {
  id: string; scope: 'global' | 'tenant'; code: string; title: string; summary: string | null; programme: string; funder: string | null; packageId: string | null; actionTypes: string[];
  budget: number | null; expectedGrants: number | null; opensAt: string | null; deadlines: CallDeadline[]; url: string | null; tags: string[]; source?: 'manual' | 'ft'; syncedAt?: string | null;
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

export interface DocVersion { version: number; fileName: string; mimeType: string; size: number; sha256: string; note?: string | null; createdAt: string; createdBy?: string | null }
export interface DocumentSummary { id: string; title: string; kind: string; confidentiality: string; aiGenerated: boolean; entityType: string; entityId: string; projectId: string | null; proposalId: string | null; currentVersion: number; updatedAt: string; current: DocVersion }
export interface DocumentDetail extends Omit<DocumentSummary, 'current'> { versions: DocVersion[] }

/* ---------- Portfelj (WP1.15) ---------- */
export interface PortfolioAttention { lateDeliverables: number; highRisks: number; timesheetsToApprove: number | null; expensesWithoutEvidence: number | null; unclaimedPeriods: number | null }
export interface PortfolioProject {
  id: string; acronym: string; title: string; programme: string; packageId: string; actionType: string; role: string; status: string;
  startDate: string | null; durationMonths: number | null; endDate: string | null;
  time: { state: 'unknown' | 'not_started' | 'running' | 'finished'; month: number; percent: number | null };
  /** Vlastita organizacija (naš dio); `project*` = cijeli projekt sa svim partnerima. Null bez finance:read na projektu. */
  budget: { planned: number; actual: number; requested: number; percent: number | null; signal: 'none' | 'ok' | 'lagging' | 'ahead'; gap: number | null; projectPlanned: number; projectActual: number; projectRequested: number } | null;
  nextReport: { period: number; endDate: string; dueDate: string; days: number; overdue: boolean } | null;
  attention: PortfolioAttention | null;
}
export interface PortfolioDeadline { kind: string; date: string; at?: string; days: number; overdue: boolean; title: string; detail?: string; link: string; scope?: string; projectId?: string; callId?: string; proposalId?: string }
export interface PortfolioPerson { key: string; name: string; userId: string | null; projects: { id: string; acronym: string }[]; months: { month: string; minutes: number }[]; yearMinutes: number; annualLimitHours: number | null; overAnnual: boolean; overDays: { date: string; minutes: number; projects: number }[] }
export interface PortfolioStatusRow { status: string; count: number; requested: number; requestedOwn: number }
export interface PortfolioProposal { id: string; acronym: string; title: string; status: string; callCode: string | null; internalDeadline: string | null; days: number | null; requested: number; requestedOwn: number }
export interface Portfolio {
  today: string; days: number; thresholdPp: number;
  access: { full: boolean; people: boolean; pipeline: boolean; calls: boolean; finance: 'all' | 'partial' | 'none' };
  summary: {
    projects: number; activeProjects: number; deadlinesSoon: number; overdue: number; attention: { lagging: number; ahead: number };
    money: { projects: number; planned: number; requested: number; spent: number; spentPercent: number | null; unrecognised: number; projectPlanned: number; projectRequested: number; projectSpent: number; projectUnrecognised: number } | null;
    pipeline: { open: number; requested: number; requestedOwn: number; byStatus: PortfolioStatusRow[] } | null;
    successRate: { funded: number; rejected: number; percent: number | null } | null;
  };
  projects: PortfolioProject[];
  deadlines: PortfolioDeadline[];
  people: { months: string[]; year: string; dailyLimitHours: number; persons: PortfolioPerson[] } | null;
  pipeline: { open: number; requested: number; requestedOwn: number; byStatus: PortfolioStatusRow[]; proposals: PortfolioProposal[] } | null;
}
