import { useState } from 'react';
import { api } from '../lib/api';
import { date, eur, parseEur } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { enterable, type Expense, type Structure } from '../lib/types';
import { ActionButton, ActionForm, Chip, ErrorBox, Field, Loading } from '../ui';
import { can, type TabProps } from '../pages/ProjectDetail';

export function ExpensesTab({ project: p, pkg, me }: TabProps) {
  const ex = useLoad(() => api<Expense[]>('GET', `/projects/${p.id}/expenses`), [p.id]);
  const st = useLoad(() => api<Structure>('GET', `/projects/${p.id}/structure`), [p.id]);
  const cats = enterable(pkg.costCategories);
  const write = can(me, 'finance:write') && ['active', 'suspended', 'closing'].includes(p.status);
  const [f, setF] = useState({ categoryCode: cats[0]?.code ?? '', workPackageId: '', date: new Date().toISOString().slice(0, 10), description: '', supplier: '', amount: '', evidenceRef: '' });
  const catName = (c: string) => cats.find((x) => x.code === c)?.name ?? c;
  return (
    <>
      {write ? (
        <div className="card"><h2>Novi trošak</h2>
          <ActionForm submit="Evidentiraj trošak" onSubmit={async () => {
            const amount = parseEur(f.amount); if (amount === null || amount === 0) throw new Error('Unesi ispravan iznos');
            await api('POST', `/projects/${p.id}/expenses`, { categoryCode: f.categoryCode, date: f.date, description: f.description, amount,
              ...(f.workPackageId ? { workPackageId: f.workPackageId } : {}), ...(f.supplier ? { supplier: f.supplier } : {}), ...(f.evidenceRef ? { evidenceRef: f.evidenceRef } : {}) });
            setF({ ...f, description: '', supplier: '', amount: '', evidenceRef: '' }); await ex.reload();
          }}>
            <Field label="Kategorija"><select value={f.categoryCode} onChange={(e) => setF({ ...f, categoryCode: e.target.value })}>{cats.map((c) => <option key={c.code} value={c.code}>{c.code} – {c.name}</option>)}</select></Field>
            <Field label="Radni paket"><select value={f.workPackageId} onChange={(e) => setF({ ...f, workPackageId: e.target.value })}><option value="">–</option>{st.data?.workPackages.map((w) => <option key={w.id} value={w.id}>{w.code} {w.title}</option>)}</select></Field>
            <Field label="Datum"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} required /></Field>
            <Field label="Opis"><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required /></Field>
            <Field label="Dobavljač"><input value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} /></Field>
            <Field label="Iznos (€)"><input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required /></Field>
            <Field label="Dokaz (broj računa)"><input value={f.evidenceRef} onChange={(e) => setF({ ...f, evidenceRef: e.target.value })} /></Field>
          </ActionForm>
          <p className="muted">Trošak osoblja nastaje odobrenjem timesheeta u kartici Tim i timesheetovi.</p>
        </div>
      ) : <p className="muted">Troškovi se evidentiraju dok je projekt aktivan.</p>}
      <div className="card scroll">
        <h2>Troškovi</h2>
        <ErrorBox error={ex.error} />
        {!ex.data ? <Loading /> : (
          <table>
            <thead><tr><th>Datum</th><th>Kategorija</th><th>Opis</th><th>Dobavljač / dokaz</th><th className="num">Iznos</th><th>Izvor</th><th>Status</th><th /></tr></thead>
            <tbody>{ex.data.map((e) => (
              <tr key={e.id}><td>{date(e.date)}</td><td title={catName(e.categoryCode)}>{e.categoryCode}</td><td>{e.description}</td><td>{e.supplier ?? '–'}{e.evidenceRef ? ` · ${e.evidenceRef}` : ''}</td>
                <td className="num">{eur(e.amount)}</td><td>{e.source === 'timesheet' ? 'timesheet' : 'ručno'}</td><td><Chip s={e.status} /></td>
                <td>{write && e.status === 'recorded' && e.source === 'manual' && <ActionButton kind="danger" confirm="Obrisati trošak?" onClick={async () => { await api('DELETE', `/projects/${p.id}/expenses/${e.id}`); await ex.reload(); }}>obriši</ActionButton>}</td></tr>
            ))}
            {ex.data.length === 0 && <tr><td colSpan={8} className="muted">Nema troškova.</td></tr>}</tbody>
            <tfoot><tr><td colSpan={4}>Ukupno</td><td className="num">{eur(ex.data.filter((e) => e.status !== 'rejected').reduce((a, e) => a + e.amount, 0))}</td><td colSpan={3} /></tr></tfoot>
          </table>
        )}
      </div>
    </>
  );
}
