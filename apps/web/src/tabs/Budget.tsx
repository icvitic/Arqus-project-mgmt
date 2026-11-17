import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { centsToInput, eur, parseEur } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { enterable, type Budget } from '../lib/types';
import { ActionButton, Chip, ConflictNotice, ErrorBox, Loading, conflictOf, editedKeys, isConflict, type Conflict } from '../ui';
import { can, type TabProps } from '../pages/ProjectDetail';

/** Tablični unos proračuna: partner × kategorija u koju se unose iznosi; neizravni i doprinos računa server iz paketa. */
export function BudgetTab({ project: p, me }: TabProps) {
  const b = useLoad(() => api<Budget>('GET', `/projects/${p.id}/budget`), [p.id]);
  const [cells, setCells] = useState<Record<string, string>>({});
  // WP1.14b: istovremena izmjena – vlastiti unos ostaje sačuvan dok korisnik ne odluči (vrati u tablicu ili odbaci).
  const [conflict, setConflict] = useState<Conflict<Record<string, string>> | null>(null);
  const editable = can(me, 'finance:write', p.id) && b.data?.status !== 'locked' && !['closed', 'terminated', 'archived'].includes(p.status);
  const cats = b.data ? enterable(b.data.categories) : [];
  const key = (partnerId: string, code: string) => `${partnerId}|${code}`;
  const stored = (data: Budget): Record<string, string> => {
    const sums: Record<string, number> = {};
    for (const l of data.lines) sums[key(l.partnerId, l.categoryCode)] = (sums[key(l.partnerId, l.categoryCode)] ?? 0) + l.amount;
    return Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, centsToInput(v)]));
  };
  useEffect(() => { if (b.data) setCells(stored(b.data)); }, [b.data]);
  if (b.error) return <ErrorBox error={b.error} />;
  if (!b.data) return <Loading what="proračun" />;
  const invalid = Object.entries(cells).filter(([, v]) => parseEur(v) === null).map(([k]) => k);
  const hasWpSplit = b.data.lines.some((l) => l.workPackageId);
  const save = async () => {
    const lines = Object.entries(cells).map(([k, v]) => { const [partnerId, categoryCode] = k.split('|') as [string, string]; return { partnerId, categoryCode, amount: parseEur(v) ?? 0 }; }).filter((l) => l.amount > 0);
    try {
      b.setData(await api<Budget>('PUT', `/projects/${p.id}/budget/lines`, { revision: b.data!.revision, lines }));
      setConflict(null);
    } catch (e) {
      if (!isConflict(e)) throw e;
      setConflict(conflictOf(e, { ...cells }, stored(b.data!)));
    }
  };
  const partnerName = (id: string) => b.data!.partners.find((x) => x.partnerId === id)?.name ?? 'partner';
  const amount = (v: string | undefined) => { const c = parseEur(v ?? ''); return c ? eur(c) : ''; };
  // Samo polja koja je korisnik sam promijenio (u odnosu na stanje koje je bio učitao), uz ono što je sada spremljeno.
  const edited = conflict ? editedKeys(conflict.mine, conflict.base, (x, y) => amount(x) === amount(y)) : [];
  const diff = edited.filter((k) => amount(conflict!.mine[k]) !== amount(cells[k]))
    .map((k) => { const [pid, code] = k.split('|') as [string, string]; return { label: `${partnerName(pid)} · ${code}`, mine: amount(conflict!.mine[k]), now: amount(cells[k]) }; });
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
      {conflict && <ConflictNotice conflict={conflict} what="Proračun" diff={diff}
        onReload={async () => { await b.reload(); setConflict({ ...conflict, reloaded: true }); }}
        onRestore={() => { setCells({ ...cells, ...Object.fromEntries(edited.map((k) => [k, conflict.mine[k] ?? ''])) }); setConflict(null); }} onDismiss={() => setConflict(null)} />}
      {editable && <div className="actions">
        {invalid.length > 0 && <span className="chip bad">neispravan iznos u {invalid.length} polja</span>}
        <ActionButton kind="primary" onClick={async () => { if (invalid.length) throw new Error('Ispravi označene iznose'); await save(); }}>Spremi proračun</ActionButton>
      </div>}
    </div>
  );
}
