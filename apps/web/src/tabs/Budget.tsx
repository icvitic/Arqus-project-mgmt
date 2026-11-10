import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { centsToInput, eur, parseEur } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { enterable, type Budget } from '../lib/types';
import { ActionButton, Chip, ErrorBox, Loading } from '../ui';
import { can, type TabProps } from '../pages/ProjectDetail';

/** Tablični unos proračuna: partner × kategorija u koju se unose iznosi; neizravni i doprinos računa server iz paketa. */
export function BudgetTab({ project: p, me }: TabProps) {
  const b = useLoad(() => api<Budget>('GET', `/projects/${p.id}/budget`), [p.id]);
  const [cells, setCells] = useState<Record<string, string>>({});
  const editable = can(me, 'finance:write') && b.data?.status !== 'locked' && !['closed', 'terminated', 'archived'].includes(p.status);
  const cats = b.data ? enterable(b.data.categories) : [];
  const key = (partnerId: string, code: string) => `${partnerId}|${code}`;
  useEffect(() => {
    if (!b.data) return;
    const sums: Record<string, number> = {};
    for (const l of b.data.lines) sums[key(l.partnerId, l.categoryCode)] = (sums[key(l.partnerId, l.categoryCode)] ?? 0) + l.amount;
    setCells(Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, centsToInput(v)])));
  }, [b.data]);
  if (b.error) return <ErrorBox error={b.error} />;
  if (!b.data) return <Loading what="proračun" />;
  const invalid = Object.entries(cells).filter(([, v]) => parseEur(v) === null).map(([k]) => k);
  const hasWpSplit = b.data.lines.some((l) => l.workPackageId);
  const save = async () => {
    const lines = Object.entries(cells).map(([k, v]) => { const [partnerId, categoryCode] = k.split('|') as [string, string]; return { partnerId, categoryCode, amount: parseEur(v) ?? 0 }; }).filter((l) => l.amount > 0);
    b.setData(await api<Budget>('PUT', `/projects/${p.id}/budget/lines`, { lines }));
  };
  return (
    <div className="card scroll">
      <h2>Proračun {b.data.version ? `v${b.data.version}` : ''} <Chip s={b.data.status} /></h2>
      <p className="muted">Iznosi u eurima. Neizravni troškovi i zatraženi doprinos izračunavaju se iz pravila paketa programa.{b.data.status === 'locked' && ' Proračun je zaključan aktivacijom projekta; izmjene idu amandmanom.'}</p>
      {hasWpSplit && editable && <div className="warnbox">Proračun sadrži raspodjelu po radnim paketima. Spremanje iz ove tablice objedinjuje iznose po kategoriji.</div>}
      <table>
        <thead><tr><th>Partner</th>{cats.map((c) => <th key={c.code} className="num" title={c.name}>{c.code}<br /><span style={{ textTransform: 'none', fontWeight: 400 }}>{c.name}</span></th>)}
          <th className="num">Neizravni</th><th className="num">Ukupno</th><th className="num">Stopa</th><th className="num">Zatraženo</th></tr></thead>
        <tbody>{b.data.partners.map((r) => (
          <tr key={r.partnerId}><td>{r.name}</td>
            {cats.map((c) => { const k = key(r.partnerId, c.code); return (
              <td key={c.code} className="num">{editable
                ? <input className="cell" inputMode="decimal" aria-label={`${r.name} ${c.code}`} value={cells[k] ?? ''} aria-invalid={invalid.includes(k)} onChange={(e) => setCells({ ...cells, [k]: e.target.value })} />
                : eur(b.data!.lines.filter((l) => l.partnerId === r.partnerId && l.categoryCode === c.code).reduce((a, l) => a + l.amount, 0))}</td>); })}
            <td className="num">{eur(r.indirectTotal)}</td><td className="num"><b>{eur(r.total)}</b></td><td className="num">{r.ratePercent} %</td><td className="num"><b>{eur(r.requested)}</b></td></tr>
        ))}</tbody>
        <tfoot><tr><td>Ukupno</td>{cats.map((c) => <td key={c.code} />)}<td className="num">{eur(b.data.totals.indirect)}</td><td className="num">{eur(b.data.totals.total)}</td><td /><td className="num">{eur(b.data.totals.requested)}</td></tr></tfoot>
      </table>
      {b.data.warnings.map((w) => <div className="warnbox" key={w}>{w}</div>)}
      {editable && <div className="actions">
        {invalid.length > 0 && <span className="chip bad">neispravan iznos u {invalid.length} polja</span>}
        <ActionButton kind="primary" onClick={async () => { if (invalid.length) throw new Error('Ispravi označene iznose'); await save(); }}>Spremi proračun</ActionButton>
      </div>}
    </div>
  );
}
