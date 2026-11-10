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

const TABS: [string, string][] = [['pregled', 'Pregled'], ['struktura', 'Struktura rada'], ['proracun', 'Proračun'], ['tim', 'Tim i timesheetovi'], ['troskovi', 'Troškovi'], ['zns', 'Zahtjevi za nadoknadu'], ['financije', 'Ugovoreno / ostvareno']];

export interface TabProps { project: Project; pkg: PackageDetail; me: Me; reloadProject: () => Promise<void> }
export const can = (me: Me, p: string) => me.permissions.includes('*') || me.permissions.includes(p);

export function ProjectDetail({ id, tab, me }: { id: string; tab: string; me: Me }) {
  const project = useLoad(() => api<Project>('GET', `/projects/${id}`), [id]);
  const pkg = useLoad(() => (project.data ? api<PackageDetail>('GET', `/programme-packages/${encodeURIComponent(project.data.package.id)}?version=${project.data.package.version}`) : Promise.resolve(null)), [project.data?.package.id, project.data?.package.version]);
  if (project.error) return <ErrorBox error={project.error} />;
  if (!project.data || !pkg.data) return <><ErrorBox error={pkg.error} /><Loading what="projekt" /></>;
  const p = project.data;
  const props: TabProps = { project: p, pkg: pkg.data, me, reloadProject: project.reload };
  return (
    <>
      <div className="crumbs"><a href="#/projekti">Projekti</a> › {p.acronym}</div>
      <h1>{p.acronym} <Chip s={p.status} /></h1>
      <p className="sub">{p.title} · {pkg.data.meta.programme} v{p.package.version} · {p.actionType}</p>
      <div className="tabs" role="tablist">{TABS.map(([k, l]) => <a key={k} role="tab" aria-selected={tab === k} href={`#/projekti/${id}/${k}`} className={tab === k ? 'active' : ''}>{l}</a>)}</div>
      {tab === 'struktura' ? <StructureTab {...props} /> : tab === 'proracun' ? <BudgetTab {...props} /> : tab === 'tim' ? <TimesheetsTab {...props} />
        : tab === 'troskovi' ? <ExpensesTab {...props} /> : tab === 'zns' ? <ClaimsTab {...props} /> : tab === 'financije' ? <FinanceTab {...props} /> : <Overview {...props} />}
    </>
  );
}
