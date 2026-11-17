import { api } from '../lib/api';
import { useLoad } from '../lib/hooks';
import type { Me, PackageDetail, Project } from '../lib/types';
import { Chip, ErrorBox, Loading } from '../ui';
import { Overview } from '../tabs/Overview';
import { StructureTab } from '../tabs/Structure';
import { BudgetTab } from '../tabs/Budget';
import { TimesheetsTab } from '../tabs/Timesheets';
import { ExpensesTab } from '../tabs/Expenses';
import { ClaimsTab } from '../tabs/Claims';
import { FinanceTab } from '../tabs/Finance';
import { DocumentsTab } from '../tabs/Documents';
import { AccessTab } from '../tabs/Access';
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
  ['pristup', 'Pristup', (me, id) => canManageAccess(me, id)],
];

export interface TabProps { project: Project; pkg: PackageDetail; me: Me; reloadProject: () => Promise<void> }
/** Dozvola na ovom projektu (institucijska ili dodijeljena na projektu). */
export const can = (me: Me, p: string, projectId: string) => canOn(me, p, projectId);

export function ProjectDetail({ id, tab, me }: { id: string; tab: string; me: Me }) {
  const project = useLoad(() => api<Project>('GET', `/projects/${id}`), [id]);
  const pkg = useLoad(() => (project.data ? api<PackageDetail>('GET', `/programme-packages/${encodeURIComponent(project.data.package.id)}?version=${project.data.package.version}`) : Promise.resolve(null)), [project.data?.package.id, project.data?.package.version]);
  if (project.error) return <ErrorBox error={project.error} />;
  if (!project.data || !pkg.data) return <><ErrorBox error={pkg.error} /><Loading what="projekt" /></>;
  const p = project.data;
  const props: TabProps = { project: p, pkg: pkg.data, me, reloadProject: project.reload };
  const tabs = TABS.filter(([, , allowed]) => allowed(me, p.id));
  const active = tabs.some(([k]) => k === tab) ? tab : 'pregled';
  return (
    <>
      <div className="crumbs"><a href="#/projekti">Projekti</a> › {p.acronym}</div>
      <h1>{p.acronym} <Chip s={p.status} /></h1>
      <p className="sub">{p.title} · {pkg.data.meta.programme} v{p.package.version} · {p.actionType}</p>
      <div className="tabs" role="tablist">{tabs.map(([k, l]) => <a key={k} role="tab" aria-selected={active === k} href={`#/projekti/${id}/${k}`} className={active === k ? 'active' : ''}>{l}</a>)}</div>
      {active === 'struktura' ? <StructureTab {...props} /> : active === 'proracun' ? <BudgetTab {...props} /> : active === 'tim' ? <TimesheetsTab {...props} />
        : active === 'troskovi' ? <ExpensesTab {...props} /> : active === 'zns' ? <ClaimsTab {...props} /> : active === 'financije' ? <FinanceTab {...props} />
        : active === 'dokumenti' ? <DocumentsTab {...props} /> : active === 'pristup' ? <AccessTab {...props} /> : <Overview {...props} />}
    </>
  );
}
