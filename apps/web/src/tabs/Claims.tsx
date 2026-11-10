import { useState } from 'react';
import { api } from '../lib/api';
import { date, eur, parseEur } from '../lib/format';
import { useLoad } from '../lib/hooks';
import type { Claim } from '../lib/types';
import { ActionButton, ActionForm, Chip, ErrorBox, Field, Loading } from '../ui';
import { can, type TabProps } from '../pages/ProjectDetail';

export function ClaimsTab({ project: p, me }: TabProps) {
  const claims = useLoad(() => api<Claim[]>('GET', `/projects/${p.id}/claims`), [p.id]);
  const write = can(me, 'finance:write') && p.status !== 'contracting';
  const free = p.reportingPeriods.filter((r) => !claims.data?.some((c) => c.period.number === r.number));
  const [period, setPeriod] = useState('');
  if (claims.error) return <ErrorBox error={claims.error} />;
  if (!claims.data) return <Loading what="zahtjeve" />;
  return (
    <>
      {write && free.length > 0 && (
        <div className="card"><h2>Novi zahtjev za nadoknadu</h2>
          <ActionForm submit="Otvori zahtjev" onSubmit={async () => { await api('POST', `/projects/${p.id}/claims`, { period: Number(period || free[0]!.number) }); await claims.reload(); }}>
            <Field label="Izvještajno razdoblje"><select value={period} onChange={(e) => setPeriod(e.target.value)}>{free.map((r) => <option key={r.number} value={r.number}>RP{r.number} ({date(r.startDate)} – {date(r.endDate)})</option>)}</select></Field>
          </ActionForm>
        </div>
      )}
      {p.reportingPeriods.length === 0 && <p className="muted">Zahtjevi se otvaraju po izvještajnim razdobljima, koja nastaju aktivacijom projekta.</p>}
      {claims.data.map((c) => <ClaimCard key={c.id} claim={c} projectId={p.id} write={write} reload={claims.reload} />)}
    </>
  );
}

function ClaimCard({ claim: c, projectId, write, reload }: { claim: Claim; projectId: string; write: boolean; reload: () => Promise<void> }) {
  const base = `/projects/${projectId}/claims/${c.id}`;
  const [partial, setPartial] = useState('');
  const [paid, setPaid] = useState({ amount: '', at: new Date().toISOString().slice(0, 10) });
  return (
    <div className="card scroll">
      <h2>ZNS za RP{c.period.number} <Chip s={c.status} /> <span className="muted" style={{ fontWeight: 400, fontSize: 14 }}>{date(c.period.startDate)} – {date(c.period.endDate)} · rok {date(c.period.dueDate)}</span></h2>
      <div className="grid g4">
        <div className="tile"><div className="v">{eur(c.totals.direct)}</div><div className="l">izravni troškovi</div></div>
        <div className="tile"><div className="v">{eur(c.totals.indirect)}</div><div className="l">neizravni (iz paketa)</div></div>
        <div className="tile"><div className="v">{eur(c.totals.requested)}</div><div className="l">traženo ({c.totals.ratePercent} %)</div></div>
        <div className="tile"><div className="v">{eur(c.approved)}</div><div className="l">odobreno · isplaćeno {eur(c.paid)}</div></div>
      </div>
      {c.note && <div className="warnbox">Napomena: {c.note}</div>}
      <h3>{c.status === 'draft' ? 'Troškovi koji će ući u zahtjev' : 'Troškovi u zahtjevu'} ({c.expenses.length})</h3>
      <table><tbody>{c.expenses.map((e) => <tr key={e.id}><td>{date(e.date)}</td><td>{e.categoryCode}</td><td>{e.description}</td><td className="num">{eur(e.amount)}</td><td><Chip s={e.status} /></td></tr>)}
        {c.expenses.length === 0 && <tr><td className="muted">Nema troškova u razdoblju.</td></tr>}</tbody></table>
      {write && (
        <div className="actions">
          {c.status === 'draft' && <ActionButton kind="primary" confirm="Predati zahtjev? Troškovi i timesheetovi se zaključavaju." onClick={async () => { await api('POST', `${base}/submit`); await reload(); }}>Predaj zahtjev</ActionButton>}
          {c.status === 'submitted' && <>
            <ActionButton kind="primary" onClick={async () => { await api('POST', `${base}/decision`, { decision: 'approved' }); await reload(); }}>Odobren</ActionButton>
            <input aria-label="Odobreni iznos" placeholder="odobreno €" inputMode="decimal" value={partial} onChange={(e) => setPartial(e.target.value)} style={{ width: 120 }} />
            <ActionButton onClick={async () => { const a = parseEur(partial); if (a === null) throw new Error('Neispravan iznos'); await api('POST', `${base}/decision`, { decision: 'partially_approved', approvedAmount: a }); await reload(); }}>Djelomično odobren</ActionButton>
            <ActionButton onClick={async () => { await api('POST', `${base}/decision`, { decision: 'returned', note: window.prompt('Razlog povrata na dopunu') ?? undefined }); await reload(); }}>Vraćen na dopunu</ActionButton>
            <ActionButton kind="danger" confirm="Označiti zahtjev odbijenim? Troškovi postaju odbijeni." onClick={async () => { await api('POST', `${base}/decision`, { decision: 'rejected' }); await reload(); }}>Odbijen</ActionButton>
          </>}
          {['approved', 'partially_approved'].includes(c.status) && c.paid === null && <>
            <input aria-label="Isplaćeni iznos" placeholder="isplaćeno €" inputMode="decimal" value={paid.amount} onChange={(e) => setPaid({ ...paid, amount: e.target.value })} style={{ width: 120 }} />
            <input aria-label="Datum isplate" type="date" value={paid.at} onChange={(e) => setPaid({ ...paid, at: e.target.value })} />
            <ActionButton onClick={async () => { const a = parseEur(paid.amount); if (a === null) throw new Error('Neispravan iznos'); await api('POST', `${base}/payment`, { paidAmount: a, paidAt: paid.at }); await reload(); }}>Zabilježi isplatu</ActionButton>
          </>}
        </div>
      )}
    </div>
  );
}
