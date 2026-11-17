import { Fragment, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { date, eur, monthLabel, parseEur } from '../lib/format';
import { groupExpenses, localToday } from '../lib/claims';
import { useLoad } from '../lib/hooks';
import { enterable, type Expense, type Structure } from '../lib/types';
import { ActionButton, ActionForm, Chip, ErrorBox, Field, HiddenAmount, Loading } from '../ui';
import { can, type TabProps } from '../pages/ProjectDetail';
import { DocumentList } from './Documents';

export function ExpensesTab({ project: p, pkg, me }: TabProps) {
  const ex = useLoad(() => api<Expense[]>('GET', `/projects/${p.id}/expenses`), [p.id]);
  const st = useLoad(() => api<Structure>('GET', `/projects/${p.id}/structure`), [p.id]);
  const cats = enterable(pkg.costCategories);
  const [open, setOpen] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Troškovi osoblja grupirani po timesheetu (osoba i mjesec), najnoviji prvi; ručni troškovi pojedinačno.
  const groups = useMemo(() => groupExpenses(ex.data ?? []).reverse(), [ex.data]);
  const toggle = (k: string) => setExpanded((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const write = can(me, 'finance:write', p.id) && ['active', 'suspended', 'closing'].includes(p.status);
  const [f, setF] = useState({ categoryCode: cats[0]?.code ?? '', workPackageId: '', date: localToday(), description: '', supplier: '', amount: '', evidenceRef: '' });
  const catName = (c: string) => cats.find((x) => x.code === c)?.name ?? c;
  // WP1.19: bez pristupa podacima o osoblju poslužitelj ne šalje iznose troškova osoblja (vide se sati).
  const hiddenRows = (ex.data ?? []).some((e) => e.amountHidden);
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
        {hiddenRows && <p className="muted" role="note">Iznosi troškova osoblja (plaće) vidljivi su samo uz pristup podacima o osoblju (financije, ured za projekte). Ovdje vidiš sate po osobi i mjesecu; zbroj troškova osoblja po kategoriji je na kartici „Ugovoreno / ostvareno”.</p>}
        <ErrorBox error={ex.error} />
        {!ex.data ? <Loading /> : (
          <table className="expense-table">
            <thead><tr><th>Datum</th><th>Kategorija</th><th>Opis</th><th>Dobavljač / dokaz</th><th className="num">Iznos</th><th className="num">Priznato</th><th>Izvor</th><th>Status</th><th /></tr></thead>
            <tbody>{groups.map((g) => g.kind === 'personnel' ? (
              <Fragment key={g.key}>
                <tr><td>{date(g.date)}</td><td title={catName(g.rows[0]!.categoryCode)}>{g.rows[0]!.categoryCode}</td>
                  <td><button className="link" aria-expanded={expanded.has(g.key)} onClick={() => toggle(g.key)}>{expanded.has(g.key) ? '▾' : '▸'} Rad: {g.person}, {g.month ? monthLabel(g.month) : ''}</button> <span className="muted">· {g.rows.length} WP</span></td>
                  <td className="muted">timesheet</td><td className="num">{g.hidden ? <HiddenAmount /> : eur(g.amount)}</td><td className="num">{g.hidden ? <HiddenAmount /> : g.recognised === null ? '–' : eur(g.recognised)}</td><td>timesheet</td>
                  <td>{g.rows.every((r) => r.status === g.rows[0]!.status) ? <Chip s={g.rows[0]!.status} /> : <span className="chip warn">djelomično</span>}</td><td /></tr>
                {expanded.has(g.key) && g.rows.map((e) => <tr key={e.id}><td /><td /><td style={{ paddingLeft: 28 }}>{e.workPackage ?? 'bez radnog paketa'} <span className="muted">· {e.description.replace(/^Rad: [^,]*, \d{4}-\d{2} /, '')}</span>{e.decisionReason && <small className="muted">Razlog: {e.decisionReason}</small>}</td><td /><td className="num">{e.amountHidden ? <HiddenAmount /> : eur(e.amount)}</td><td className="num">{e.amountHidden ? <HiddenAmount /> : e.recognised === null ? '–' : eur(e.recognised)}</td><td /><td><Chip s={e.status} /></td><td /></tr>)}
              </Fragment>
            ) : g.rows.map((e) => (
              <Fragment key={e.id}><tr><td>{date(e.date)}</td><td title={catName(e.categoryCode)}>{e.categoryCode}</td><td>{e.description}{e.decisionReason && <small className="muted">Razlog: {e.decisionReason}</small>}</td><td>{e.supplier ?? '–'}{e.evidenceRef ? ` · ${e.evidenceRef}` : ''}</td>
                <td className="num">{eur(e.amount)}</td><td className="num">{e.recognised === null ? '–' : eur(e.recognised)}</td><td>ručno</td><td><Chip s={e.status} /></td>
                <td style={{ whiteSpace: 'nowrap' }}><button onClick={() => setOpen(open === e.id ? null : e.id)} aria-expanded={open === e.id}>Dokazi ({e.documents})</button>
                  {write && e.status === 'recorded' && <ActionButton kind="danger" confirm="Obrisati trošak?" onClick={async () => { await api('DELETE', `/projects/${p.id}/expenses/${e.id}`); await ex.reload(); }}>obriši</ActionButton>}</td></tr>
              {open === e.id && <tr><td colSpan={9}><DocumentList target={{ entityType: 'expense', entityId: e.id }} defaultKind="evidence" canWrite={can(me, 'documents:write', p.id) && e.status === 'recorded'} allowConfidential={can(me, 'documents:confidential', p.id)} onChange={ex.reload} /></td></tr>}</Fragment>
            )))}
            {ex.data.length === 0 && <tr><td colSpan={9} className="muted">Nema troškova.</td></tr>}</tbody>
            <tfoot><tr><td colSpan={4}>{hiddenRows ? 'Ukupno bez troškova osoblja (njihovi iznosi su skriveni – zbroj po kategoriji na kartici „Ugovoreno / ostvareno”)' : 'Ukupno (ostvareno: priznato nakon odluke, inače traženo)'}</td><td className="num">{eur(ex.data.reduce((a, e) => a + (e.amount ?? 0), 0))}</td><td className="num">{eur(ex.data.reduce((a, e) => a + (e.recognised ?? e.amount ?? 0), 0))}</td><td colSpan={3} /></tr></tfoot>
          </table>
        )}
      </div>
    </>
  );
}
