/** Katalog dozvola. Format `<resurs>:<radnja>`; `*` = sve. */
export const PERMISSIONS = [
  'tenant:read', 'tenant:write',
  'users:read', 'users:write',
  'roles:read', 'roles:write',
  'audit:read',
  'packages:read', 'packages:write',
  'organisations:read', 'organisations:write',
  'calls:read', 'calls:write',
  'proposals:read', 'proposals:write',
  'projects:read', 'projects:write',
  'finance:read', 'finance:write',
  'timesheets:read', 'timesheets:write', 'timesheets:approve',
  'reports:read', 'reports:write',
  'documents:read', 'documents:write',
  'portfolio:read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Sistemske uloge v1 (domenski model, M1). */
export const SYSTEM_ROLES: { code: string; name: string; scope: 'tenant' | 'project'; permissions: readonly (Permission | '*')[] }[] = [
  { code: 'tenant-admin', name: 'Administrator stanara', scope: 'tenant', permissions: ['*'] },
  { code: 'project-office', name: 'Voditelj ureda za projekte', scope: 'tenant', permissions: ['tenant:read', 'users:read', 'roles:read', 'audit:read', 'packages:read', 'organisations:read', 'organisations:write', 'calls:read', 'calls:write', 'proposals:read', 'proposals:write', 'projects:read', 'projects:write', 'finance:read', 'finance:write', 'timesheets:read', 'timesheets:write', 'timesheets:approve', 'reports:read', 'reports:write', 'documents:read', 'documents:write', 'portfolio:read'] },
  { code: 'project-manager', name: 'Voditelj projekta', scope: 'project', permissions: ['packages:read', 'organisations:read', 'organisations:write', 'calls:read', 'proposals:read', 'proposals:write', 'projects:read', 'projects:write', 'finance:read', 'finance:write', 'timesheets:read', 'timesheets:write', 'timesheets:approve', 'reports:read', 'reports:write', 'documents:read', 'documents:write'] },
  { code: 'team-member', name: 'Član tima', scope: 'project', permissions: ['packages:read', 'organisations:read', 'projects:read', 'documents:read', 'documents:write', 'finance:read', 'timesheets:read', 'timesheets:write'] },
  { code: 'finance', name: 'Financije / računovodstvo', scope: 'tenant', permissions: ['packages:read', 'organisations:read', 'projects:read', 'finance:read', 'finance:write', 'timesheets:read', 'reports:read', 'documents:read', 'portfolio:read'] },
  { code: 'reader', name: 'Čitatelj (uprava)', scope: 'tenant', permissions: ['packages:read', 'organisations:read', 'projects:read', 'proposals:read', 'calls:read', 'finance:read', 'reports:read', 'portfolio:read'] },
];

export function hasPermission(granted: ReadonlySet<string>, required: Permission): boolean {
  return granted.has('*') || granted.has(required);
}
