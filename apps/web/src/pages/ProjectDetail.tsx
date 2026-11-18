import { api } from '../lib/api';
import { useLoad } from '../lib/hooks';
import type { Me, PackageDetail, Project } from '../lib/types';
import { Chip, ErrorBox, Loading, TabList, TabPanel, usePageTitle } from '../ui';
import { Overview } from '../tabs/Overview';
import { StructureTab } from '../tabs/Structure';
import { BudgetTab } from '../tabs/Budget';
import { TimesheetsTab } from '../tabs/Timesheets';
import { ExpensesTab } from '../tabs/Expenses';
import { ClaimsTab } from '../tabs/Claims';
import { FinanceTab } from '../tabs/Finance';
import { DocumentsTab } from '../tabs/Documents';
import { AccessTab } from '../tabs/Access';
import { ImportTab } from '../tabs/Import';
import { canManageAccess, canOn } from '../lib/access';

/** Kartice projekta i dozvola potrebna za prikaz (na razini institucije ili na ovom projektu, WP1.14). */
const TABS: [string, string, (me: Me, projectId: string) => boolean][] = [
  ['pregled', 'Pregled', () => true],
  ['struktura', 'Struktura rada', (me, id) => canOn(me, 'projects:read', id)],
  ['proracun', 'Proračun', (me, id) => canOn(me, 'finance:read', id)],
  ['tim', 'Tim i timesheetovi', (me, id) => canOn(me, 'timesheets:read', id)],
  ['troskovi', 'Troškovi', (me, id) => canOn(me, 'finance:read', id)],
  ['zns', 'Zahtjevi za nadoknadu', (me, id) => canOn(me, 'finance:read', id)],
  ['financije', 'Ugovoreno / ostvareno', (me, id) => canOn(me, 'finance:read', id)],
  ['dokumenti', 'Dokumenti', (me, id) => canOn(me, 'documents:read', id)],
  // WP1.17: uvoz iz Excela – tko smije pisati strukturu ili financije projekta.
  ['uvoz', 'Uvoz', (me, id) => canOn(me, 'projects:write', id) || canOn(me, 'finance:write', id)],
  ['pristup', 'Pristup', (me, id) => canManageAccess(me, id)],
];

/** `sub` – dodatni dijelovi putanje kartice (WP1.18: `tim/<član>/<mjesec>` otvara timesheet iz „Moj rad” i obavijesti). */
export interface TabProps { project: Project; pkg: PackageDetail; me: Me; reloadProject: () => Promise<void>; sub?: string[] }
/** Dozvola na ovom projektu (institucijska ili dodijeljena na projektu). */
export const can = (me: Me, p: string, projectId: string) => canOn(me, p, projectId);

export function ProjectDetail({ id, tab, me, sub }: { id: string; tab: string; me: Me; sub?: string[] }) {
  const project = useLoad(() => api<Project>('GET', `/projects/${id}`), [id]);
  const pkg = useLoad(() => (project.data ? api<PackageDetail>('GET', `/programme-packages/${encodeURIComponent(project.data.package.id)}?version=${project.data.package.version}`) : Promise.resolve(null)), [project.data?.package.id, project.data?.package.version]);
  const visibleTabs = project.data ? TABS.filter(([, , allowed]) => allowed(me, project.data!.id)) : [];
  const activeTab = visibleTabs.some(([k]) => k === tab) ? tab : 'pregled';
  usePageTitle(project.data ? `${TABS.find(([k]) => k === activeTab)?.[1] ?? 'Pregled'} – ${project.data.acronym}` : project.error ? 'Projekt' : null);
  if (project.error) return <><h1>Projekt</h1><ErrorBox error={project.error} /></>;
  if (!project.data || !pkg.data) return <><h1 className="sr-only">Projekt</h1><ErrorBox error={pkg.error} /><Loading what="projekt" /></>;
  const p = project.data;
  const props: TabProps = { project: p, pkg: pkg.data, me, reloadProject: project.reload, sub };
  const tabs = visibleTabs;
  const active = activeTab;
  return (
    <>
      <nav className="crumbs" aria-label="Putanja"><a href="#/projekti">Projekti</a> <span aria-hidden="true">›</span> {p.acronym}</nav>
      <h1>{p.acronym} <Chip s={p.status} /></h1>
      <p className="sub">{p.title} · {pkg.data.meta.programme} v{p.package.version} · {p.actionType}</p>
      <TabList label={`Kartice projekta ${p.acronym}`} active={active} tabs={tabs.map(([k, l]) => ({ key: k, label: l, href: `#/projekti/${id}/${k}` }))} />
      <TabPanel active={active}>
      {active === 'struktura' ? <StructureTab {...props} /> : active === 'proracun' ? <BudgetTab {...props} /> : active === 'tim' ? <TimesheetsTab {...props} />
        : active === 'troskovi' ? <ExpensesTab {...props} /> : active === 'zns' ? <ClaimsTab {...props} /> : active === 'financije' ? <FinanceTab {...props} />
        : active === 'dokumenti' ? <DocumentsTab {...props} /> : active === 'uvoz' ? <ImportTab {...props} /> : active === 'pristup' ? <AccessTab {...props} /> : <Overview {...props} />}
      </TabPanel>
    </>
  );
}
