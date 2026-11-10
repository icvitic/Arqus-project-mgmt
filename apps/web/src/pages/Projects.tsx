import { useState } from 'react';
import { api } from '../lib/api';
import { date, label } from '../lib/format';
import { go, useLoad } from '../lib/hooks';
import type { Me, PackageDetail, PackageSummary, ProjectSummary } from '../lib/types';
import { ActionForm, Chip, ErrorBox, Field, Loading } from '../ui';

export function Projects({ me }: { me: Me }) {
  const projects = useLoad(() => api<ProjectSummary[]>('GET', '/projects'), []);
  const canWrite = me.permissions.includes('*') || me.permissions.includes('projects:write');
  const [showNew, setShowNew] = useState(false);
  return (
    <>
      <h1>Projekti</h1>
      <p className="sub">Ugovoreni projekti institucije, vezani uz verziju paketa programa.</p>
      {canWrite && <div className="actions" style={{ marginBottom: 12 }}><button className="primary" onClick={() => setShowNew((v) => !v)}>{showNew ? 'Zatvori' : 'Novi projekt'}</button></div>}
      {showNew && <NewProject onCreated={(id) => go(`projekti/${id}`)} />}
      <div className="card scroll">
        <ErrorBox error={projects.error} />
        {projects.loading && !projects.data ? <Loading what="projekte" /> : projects.data?.length === 0 ? <p className="muted">Još nema projekata.</p> : (
          <table>
            <thead><tr><th>Akronim</th><th>Paket</th><th>Ugovor</th><th>Početak</th><th className="num">Trajanje</th><th className="num">Partneri</th><th>Status</th></tr></thead>
            <tbody>{projects.data?.map((p) => (
              <tr key={p.id} className="row" onClick={() => go(`projekti/${p.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go(`projekti/${p.id}`)}>
                <td><b>{p.acronym}</b><br /><span className="muted">{p.title}</span></td>
                <td>{p.package.id}<br /><span className="muted">v{p.package.version} · {p.actionType}</span></td>
                <td>{p.contractNo ?? '–'}</td><td>{date(p.startDate)}</td>
                <td className="num">{p.durationMonths ? `${p.durationMonths} mj.` : '–'}</td><td className="num">{p.partnerCount}</td>
                <td><Chip s={p.status} /></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}

function NewProject({ onCreated }: { onCreated: (id: string) => void }) {
  const packages = useLoad(() => api<PackageSummary[]>('GET', '/programme-packages'), []);
  const [packageId, setPackageId] = useState('');
  const pkg = useLoad(() => (packageId ? api<PackageDetail>('GET', `/programme-packages/${encodeURIComponent(packageId)}`) : Promise.resolve(null)), [packageId]);
  const [f, setF] = useState({ acronym: '', title: '', actionType: '', role: 'coordinator', contractNo: '', startDate: '', durationMonths: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const unique = [...new Map((packages.data ?? []).map((p) => [p.packageId, p])).values()];
  return (
    <div className="card">
      <h2>Novi projekt</h2>
      <ActionForm submit="Stvori projekt" onSubmit={async () => {
        const body = { acronym: f.acronym, title: f.title, packageId, actionType: f.actionType, role: f.role,
          ...(f.contractNo ? { contractNo: f.contractNo } : {}), ...(f.startDate ? { startDate: f.startDate } : {}), ...(f.durationMonths ? { durationMonths: Number(f.durationMonths) } : {}) };
        const p = await api<{ id: string }>('POST', '/projects', body);
        onCreated(p.id);
      }}>
        <Field label="Akronim"><input value={f.acronym} onChange={set('acronym')} required /></Field>
        <Field label="Naslov"><input value={f.title} onChange={set('title')} required /></Field>
        <Field label="Paket programa">
          <select value={packageId} onChange={(e) => { setPackageId(e.target.value); setF({ ...f, actionType: '' }); }} required>
            <option value="">– odaberi –</option>
            {unique.map((p) => <option key={p.packageId} value={p.packageId}>{p.programme} ({p.scope === 'global' ? 'globalni' : 'vlastiti'}, {label(p.status)})</option>)}
          </select>
        </Field>
        <Field label="Vrsta akcije">
          <select value={f.actionType} onChange={set('actionType')} required disabled={!pkg.data}>
            <option value="">– odaberi –</option>
            {pkg.data?.actionTypes.map((a) => <option key={a.code} value={a.code}>{a.code} – {a.name}</option>)}
          </select>
        </Field>
        <Field label="Uloga institucije"><select value={f.role} onChange={set('role')}><option value="coordinator">koordinator</option><option value="partner">partner</option></select></Field>
        <Field label="Broj ugovora"><input value={f.contractNo} onChange={set('contractNo')} /></Field>
        <Field label="Početak"><input type="date" value={f.startDate} onChange={set('startDate')} /></Field>
        <Field label="Trajanje (mjeseci)"><input type="number" min={1} max={120} value={f.durationMonths} onChange={set('durationMonths')} /></Field>
      </ActionForm>
    </div>
  );
}
