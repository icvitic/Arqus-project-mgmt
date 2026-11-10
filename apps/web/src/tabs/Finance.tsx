import { api } from '../lib/api';
import { eur } from '../lib/format';
import { useLoad } from '../lib/hooks';
import type { FinanceOverview } from '../lib/types';
import { Chip, ErrorBox, Loading } from '../ui';
import type { TabProps } from '../pages/ProjectDetail';

export function FinanceTab({ project: p }: TabProps) {
  const f = useLoad(() => api<FinanceOverview>('GET', `/projects/${p.id}/finance`), [p.id]);
  if (f.error) return <ErrorBox error={f.error} />;
  if (!f.data) return <Loading />;
  const d = f.data;
  const pct = d.planned.total ? Math.round((d.actual.total / d.planned.total) * 100) : 0;
  return (
    <>
      <div className="grid g4">
        <div className="tile"><div className="v">{eur(d.planned.total)}</div><div className="l">ugovoreno ukupno <Chip s={d.budgetStatus} /></div></div>
        <div className="tile"><div className="v">{eur(d.actual.total)}</div><div className="l">ostvareno (s neizravnima)</div></div>
        <div className="tile"><div className="v">{pct} %</div><div className="l">iskorištenost proračuna</div></div>
        <div className="tile"><div className="v">{eur(d.planned.total - d.actual.total)}</div><div className="l">preostalo</div></div>
      </div>
      <div className="card scroll" style={{ marginTop: 16 }}>
        <h2>Po kategoriji (izravni troškovi)</h2>
        <table>
          <thead><tr><th>Kategorija</th><th className="num">Ugovoreno</th><th className="num">Ostvareno</th><th className="num">Preostalo</th><th>Iskorištenost</th></tr></thead>
          <tbody>{d.byCategory.filter((c) => c.planned || c.actual).map((c) => (
            <tr key={c.code}><td>{c.code} {c.name}</td><td className="num">{eur(c.planned)}</td><td className="num">{eur(c.actual)}</td><td className="num">{eur(c.remaining)}</td>
              <td><div className="bar" role="img" aria-label={`${c.percent ?? 0} %`}><i style={{ width: `${Math.min(c.percent ?? (c.actual ? 100 : 0), 100)}%` }} /></div><span className="muted">{c.percent === null ? 'bez plana' : `${c.percent} %`}</span></td></tr>
          ))}</tbody>
        </table>
      </div>
      <div className="card scroll"><h2>Po partneru (ukupno s neizravnima)</h2>
        <table><thead><tr><th>Partner</th><th className="num">Ugovoreno</th><th className="num">Ostvareno</th></tr></thead>
          <tbody>{d.byPartner.map((x) => <tr key={x.partnerId}><td>{x.name}</td><td className="num">{eur(x.planned)}</td><td className="num">{eur(x.actual)}</td></tr>)}</tbody></table>
      </div>
    </>
  );
}
