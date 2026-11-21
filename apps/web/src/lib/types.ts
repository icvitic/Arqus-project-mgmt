/** `permissions` – dozvole na razini institucije; `projectPermissions` – dozvole po projektu (WP1.14). */
/** WP1.14b: `leadProposals` – prijave kojima je korisnik voditelj (radi na njima i bez uloge institucije). */
/** WP1.19: obvezni MFA po postavci institucije; `setupRequired` – sesija je u ograničenom stanju dok korisnik ne postavi MFA. */
export type MfaPolicy = 'none' | 'privileged' | 'all';
export interface MfaState { policy: MfaPolicy; required: boolean; enabled: boolean; setupRequired: boolean }
export interface Me { user: { id: string; email: string; displayName: string; mfaEnabled: boolean }; tenant: { id: string; slug: string; name: string; timeZone?: string } | null; permissions: string[]; projectPermissions: Record<string, string[]>; leadProposals?: string[]; mfa?: MfaState }
export interface SecuritySettings { requireMfa: MfaPolicy; privilegedPermissions: string[]; impact: Record<MfaPolicy, { required: number; withoutMfa: number }> }
/** WP1.14b: odstupanje od pravila programa (valjanost paketa, pravilo `validations`). */
export interface Deviation { key: string; severity: 'error' | 'warning' | 'info'; message: string }
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
export interface Project extends Omit<ProjectSummary, 'partnerCount'> { partners: Partner[]; reportingPeriods: Period[]; revision: number; deviations: Deviation[] }
/** WP1.22: odgovorna osoba stavke – član tima projekta; `mine` = povezan je s prijavljenim korisnikom. */
export interface Responsible { memberId: string; name: string; active: boolean; mine: boolean }
export interface Task { id: string; code: string; title: string; startMonth: number; endMonth: number; endDate: string | null; status: string; responsibleMemberId: string | null; responsible: Responsible | null }
export interface Deliverable { id: string; code: string; title: string; type: string; dissemination: string; dueMonth: number; dueDate: string | null; status: string; responsibleMemberId: string | null; responsible: Responsible | null }
export interface Milestone { id: string; code: string; title: string; dueMonth: number; dueDate: string | null; status: string; responsibleMemberId: string | null; responsible: Responsible | null }
export interface WorkPackage { id: string; code: string; number: number; title: string; startMonth: number; endMonth: number; leadPartnerId: string | null; tasks: Task[]; deliverables: Deliverable[] }
export interface Structure {
  workPackages: WorkPackage[]; milestones: Milestone[];
  /** WP1.22: članovi tima za odabir odgovorne osobe – samo onome tko smije uređivati strukturu. */
  team?: { id: string; name: string; active: boolean }[];
  risks: { id: string; number: number; description: string; likelihood: number; impact: number; mitigation: string | null; status: string; score: number; level: string }[];
}
export interface PartnerBudget { partnerId: string; name?: string; directTotal: number; indirectTotal: number; total: number; ratePercent: number; requested: number }
export interface Budget {
  version: number | null; status: string; revision: number; categories: Category[]; lines: { partnerId: string; categoryCode: string; workPackageId: string | null; amount: number }[];
  partners: PartnerBudget[]; totals: { direct: number; indirect: number; total: number; requested: number }; warnings: string[];
}
/** `annualCost` je null bez dozvole personnel:read; `costSet` kaže je li trošak upisan. */
export interface TeamMember { id: string; fullName: string; userId: string | null; partnerId: string; role: string | null; annualCost: number | null; costSet: boolean; active: boolean }
export interface Timesheet { status: string; revision: number; submittedBy: string | null; entries: { day: number; minutes: number; workPackageId: string | null }[]; totalMinutes: number; warnings: string[] }
/**
 * Trošak; `person`/`month`/`workPackage` za troškove osoblja (grupiranje po osobi i mjesecu). `recognised` – priznati iznos nakon odluke o ZNS-u.
 * WP1.19: bez `personnel:read` iznos i priznati iznos troška osoblja su `null`, a `amountHidden` je `true` (sati ostaju u opisu).
 */
export interface Expense {
  id: string; partnerId: string; categoryCode: string; workPackageId: string | null; date: string; description: string; supplier: string | null; amount: number | null; recognised: number | null; amountHidden: boolean; decisionReason: string | null;
  evidenceRef: string | null; source: string; status: string; documents: number; timesheetId: string | null; person: string | null; month: string | null; workPackage: string | null;
  /** WP1.17: trošak potraživan izvan sustava (ZNS predan prije ArQusa, uvezen iz Excela) i oznaka tog zahtjeva. */
  historic?: boolean; externalClaim?: string | null; imported?: boolean;
}
export interface Money { direct: number; indirect: number; total: number; requested: number }
export interface ChecklistItem { key: string; ok: boolean; severity: 'blocking' | 'warning'; title: string; details: string[]; resolution?: 'early_reason' | 'acknowledge'; expenseIds?: string[] }
export interface ClaimExpense {
  id: string; date: string; categoryCode: string; description: string; supplier: string | null; amount: number | null; recognised: number | null; amountHidden: boolean; decisionReason: string | null;
  status: string; source: string; documents: number; timesheetId: string | null; person: string | null; month: string | null; workPackage: string | null;
  /** WP1.16b: trošak iz ranijeg razdoblja (izričito uključen). */
  earlier: boolean;
}
/** WP1.16b: nepredan trošak iz ranijeg razdoblja koji nacrt može izričito uključiti. */
export interface EarlierCandidate { id: string; date: string; categoryCode: string; description: string; supplier: string | null; amount: number | null; amountHidden: boolean; source: string; documents: number; period: number | null; selected: boolean; selectedElsewhere: number | null }
/** WP1.16b: automatske mjere pripreme predanog zahtjeva. */
export interface PreparationMeasures { daysAfterPeriodEnd: number; daysInPreparation: number; returns: number; expenses: number; evidenceFiles: number; timesheets: number; earlierExpenses: number }
export interface Claim {
  id: string; period: Period; status: string; revision: number; expenses: ClaimExpense[]; missingEvidence: number;
  totals: Money & { ratePercent: number }; recognised: Money | null; unrecognised: Money | null;
  checklist: { items: ChecklistItem[]; canSubmit: boolean; early: boolean } | null;
  earlyReason: string | null; submission: { early: boolean; earlyReason: string | null; acknowledgedWithoutEvidence: { id: string; date: string; description: string; amount: number }[]; warnings: { key: string; title: string; details: string[] }[] } | null;
  decision: { date: string | null; computed: number; funderTotal: number | null; difference: number; backfilled: boolean } | null;
  requested: number | null; approved: number | null; paid: number | null; submittedAt: string | null; decisionDate: string | null; paidAt: string | null; paymentNote: string | null; note: string | null;
  earlierCandidates: EarlierCandidate[] | null;
  preparation: { hours: number | null; measures: PreparationMeasures | null };
  /** WP1.19: o pojedinom trošku osoblja odlučuje samo uloga s personnel:read; ostali ga ostavljaju priznatim kako je zatražen. */
  canDecidePersonnel: boolean;
}
export interface DecisionPreview { outcome: string; claimed: Money; recognised: Money; unrecognised: Money; computed: number; funderTotal: number | null; approved: number; difference: number; errors: string[] }
export interface FinanceOverview {
  budgetStatus: string; planned: Money; actual: Money; unrecognised: Money;
  /** WP1.16b: nepredani troškovi iz ranijih razdoblja (razdoblje već predano, trošak nije odabran ni u jednom nacrtu). */
  strandedExpenses: { count: number; amount: number; personnelAmountHidden?: boolean };
  byCategory: { code: string; name: string; planned: number; actual: number; unrecognised: number; remaining: number; percent: number | null }[]; byPartner: { partnerId: string; name: string; planned: number; actual: number; unrecognised: number }[];
}
export interface ProjectRole { assignmentId: string; code: string; projectId: string; acronym: string | null }
/** `roles` – uloge na razini institucije; `projectRoles` – uloge na pojedinom projektu. */
/** WP1.21: izdana poveznica (pozivnica ili nova lozinka) – kada i kako; token se nikad ne vraća u popisu. */
export interface PendingLink { delivery: 'mail' | 'link'; createdAt: string; expiresAt: string }
export interface UserRow { id: string; email: string; displayName: string; status: 'invited' | 'active' | 'disabled' | 'closed'; mfaEnabled: boolean; mfaRequired?: boolean; lastLoginAt: string | null; roles: string[]; projectRoles: ProjectRole[]; invitation?: PendingLink | null; passwordLink?: PendingLink | null }
/** WP1.21: odgovor na izdavanje pozivnice ili poveznice za novu lozinku; `token` samo bez e-pošte (jednom). */
export interface IssuedLink { delivery: 'mail' | 'link'; expiresAt: string; token?: string }
export interface MailDeliveryRow { id: number; kind: 'invite' | 'reset' | 'password_changed' | 'digest' | 'test'; outcome: 'sent' | 'failed'; errorClass: string | null; attempts: number; createdAt: string; userId: string; displayName: string | null }
export interface MailStatus { enabled: boolean; from: string | null; publicUrl: string | null; last7Days: { sent: number; failed: number }; recent: MailDeliveryRow[] }
export interface DigestSetting { enabled: boolean; mailEnabled: boolean; hour: number }
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
  revision: number; deviations: Deviation[];
}

export interface DocVersion { version: number; fileName: string; mimeType: string; size: number; sha256: string; note?: string | null; createdAt: string; createdBy?: string | null }
/** `frozen` – razlog zbog kojeg se dokument više ne mijenja (WP1.14b: sučelje tada ne nudi uklanjanje ni novu verziju). */
export interface DocumentSummary { id: string; title: string; kind: string; confidentiality: string; aiGenerated: boolean; entityType: string; entityId: string; projectId: string | null; proposalId: string | null; currentVersion: number; updatedAt: string; frozen: string | null; current: DocVersion }
export interface DocumentDetail extends Omit<DocumentSummary, 'current'> { versions: DocVersion[] }

/* ---------- Portfelj (WP1.15) ---------- */
export interface PortfolioAttention { lateDeliverables: number; highRisks: number; timesheetsToApprove: number | null; expensesWithoutEvidence: number | null; unclaimedPeriods: number | null; strandedExpenses: number | null }
/** WP1.16b: „Ušteda na ZNS-u” – prijavljeni sati pripreme prema polaznoj mjeri institucije. */
export interface ClaimSavings {
  status: 'ok' | 'no_baseline' | 'no_reports'; missing: ('baseline' | 'hours')[]; baselineHours: number | null; submittedClaims: number; reportedClaims: number;
  averageHours: number | null; savingHours: number | null; savingPercent: number | null; targetPercent: number; meetsTarget: boolean | null; canEditBaseline: boolean;
  automatic: { claims: number; averageDaysAfterPeriodEnd: number; averageDaysInPreparation: number; returns: number; claimsReturned: number; averageExpenses: number; averageEvidenceFiles: number; averageTimesheets: number } | null;
  claims: { id: string; projectId: string; acronym: string; period: number; status: string; submittedAt: string; reportedHours: number | null; measures: PreparationMeasures }[];
}
export interface PortfolioProject {
  id: string; acronym: string; title: string; programme: string; packageId: string; actionType: string; role: string; status: string;
  startDate: string | null; durationMonths: number | null; endDate: string | null;
  time: { state: 'unknown' | 'not_started' | 'running' | 'finished'; month: number; percent: number | null };
  /** Vlastita organizacija (naš dio); `project*` = cijeli projekt sa svim partnerima. Null bez finance:read na projektu. */
  budget: { planned: number; actual: number; requested: number; percent: number | null; signal: 'none' | 'ok' | 'lagging' | 'ahead'; gap: number | null; projectPlanned: number; projectActual: number; projectRequested: number } | null;
  nextReport: { period: number; endDate: string; dueDate: string; days: number; overdue: boolean } | null;
  attention: PortfolioAttention | null;
}
export interface PortfolioDeadline { kind: string; date: string; at?: string; days: number; overdue: boolean; title: string; detail?: string; link: string; scope?: string; projectId?: string; callId?: string; proposalId?: string; responsible?: string }
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

/* ---------- Revizija (WP1.14b) ---------- */
export interface AuditEntry {
  id: number; at: string; actorType: 'user' | 'system' | 'ai'; actorId: string | null; actor: { id: string; displayName: string | null } | null;
  entity: string; entityId: string | null; action: string; ip: string | null;
  diff: { before?: unknown; after?: unknown; meta?: Record<string, unknown> } | null;
  /** Dio vrijednosti skriven (plaće bez dozvole personnel:read). */
  redacted: boolean;
}
export interface AuditFacets { entities: string[]; actions: string[]; actors: { id: string; displayName: string }[] }
/** WP1.18 – „Moj rad”: stavka koja čeka korisnika (bez iznosa). */
export type WorkUrgency = 'overdue' | 'due_soon' | 'waiting' | 'info';
export interface WorkItem { key: string; kind: string; role: string; urgency: WorkUrgency; due: string | null; days: number | null; title: string; detail?: string; link: string; projectId?: string; acronym?: string; proposalId?: string; callId?: string; count?: number }
export interface WorkSummary { overdue: number; dueSoon: number; waiting: number; info: number; attention: number }
export interface MyWork { today: string; items: WorkItem[]; summary: WorkSummary }
export interface AppNotification { id: number; kind: string; title: string; detail: string | null; link: string | null; projectId: string | null; proposalId: string | null; actor: string | null; createdAt: string; read: boolean }
export interface NotificationPage { items: AppNotification[]; unread: number; next: number | null }
export interface CalendarStatus { active: boolean; createdAt: string | null; lastUsedAt: string | null; token?: string; path?: string }

/** WP1.23 – osobni podaci: pretraga osobe, pregled, anonimizacija, rokovi čuvanja. */
export interface PrivacyMember { id: string; fullName: string; project: string; projectId: string; projectStatus: string; partner: string; role: string | null; userId: string | null; active: boolean; anonymised: boolean; annualCostCents: number | null; linked?: boolean; retentionEnd?: string | null; retentionRunning?: boolean }
export interface PrivacyPeople { users: { id: string; email: string; displayName: string; status: string; closedAt: string | null }[]; members: (PrivacyMember & { acronym: string })[] }
export interface PrivacySubject {
  user: { id: string; email: string; displayName: string; status: string; closedAt: string | null } | null; withAmounts: boolean;
  members: PrivacyMember[]; candidates: PrivacyMember[]; counts: Record<string, number>;
  documents: { title: string; fileName: string; project: string | null; uploadedAt: string; deleted: boolean; version: number }[];
}
export interface AnonymisePreview {
  member: { id: string; fullName: string; project: string; projectId: string; projectStatus: string; partner: string; linkedToAccount: boolean; anonymised: boolean };
  pseudonym: string; retention: { end: string | null; running: boolean; reason: string };
  changes: { teamMember: { field: string; before: string | null; after: string | null }[]; expenses: { id: string; date: string; status: string; before: string; after: string }[] };
  unchanged: { timesheets: number; minutes: number; personnelExpenses: number; responsibilities: number };
  flagged: { where: string; ref: string; text: string }[]; documents: { id: string; title: string; fileName: string; uploadedAt: string | null }[]; fingerprint: string;
}
export interface RetentionCategory { key: string; label: string; unit: string; days: number; defaultDays: number; floorDays: number; configurable: boolean; setByInstitution: boolean; basis: string; held: number; eligible: number; keptForEvidence: number }
export interface RetentionRun { id: number; day: string; mode: 'scheduled' | 'dry'; outcome: string; startedAt: string | null; finishedAt: string | null; result: { categories?: { key: string; removed: number; eligible: number; keptForEvidence: number; days: number; stoppedEarly?: boolean }[]; stoppedEarly?: boolean } | null }
export interface RetentionOverview {
  categories: RetentionCategory[];
  projectYears: { defaultYears: number; floorYears: number; institutionYears: number | null; programmes: { packageId: string; years: number; source: 'programme' | 'institution' | 'default'; set: number | null }[] };
  projects: { id: string; acronym: string; status: string; packageId: string; years: number; retentionEnd: string | null; state: 'not_started' | 'running' | 'ended' }[];
  kept: { closedAccounts: number; closedAccountMembers: number; anonymisedMembers: number };
  confirmed: { at: string | null; by: string | null };
  lastRun: RetentionRun | null; lastDryRun: RetentionRun | null;
  scheduler: { enabled: boolean; hour: number };
}

/** WP1.24: zahtjev ispitanika u evidenciji (Osobni podaci → Zahtjevi). */
export interface SubjectRequest {
  id: string; number: number; ref: string; receivedOn: string; kind: string; channel: string; requesterName: string; requesterContact: string | null;
  subjectUser: { id: string; displayName: string; email: string; status: string } | null; description: string | null; identityVerifiedOn: string | null;
  extension: { informedOn: string; reason: string; late: boolean } | null; baseDueOn: string; dueOn: string; daysLeft: number | null;
  status: 'open' | 'closed'; state: 'overdue' | 'due_soon' | 'open' | 'closed_late' | 'closed'; outcome: string | null; closedOn: string | null; outcomeNote: string | null; revision: number;
}
export interface SubjectRequestList { today: string; items: SubjectRequest[]; summary: { open: number; overdue: number; dueSoon: number; closed: number; closedLate: number } }
