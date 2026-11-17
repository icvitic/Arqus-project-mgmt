import { useEffect } from 'react';
import { api } from '../lib/api';
import { date } from '../lib/format';
import { useLoad } from '../lib/hooks';
import type { Me, MyWork as Data, WorkItem, WorkSummary, WorkUrgency } from '../lib/types';
import { ErrorBox, Loading } from '../ui';
import { can } from '../lib/access';

const GROUPS: [WorkUrgency, string, string][] = [
  ['overdue', 'Kasni', 'rok je prošao'],
  ['due_soon', 'Uskoro', 'rok u idućim danima'],
  ['waiting', 'Čeka', 'bez bliskog roka'],
  ['info', 'Za informaciju', ''],
];
const ROLE: Record<string, string> = { member: 'član tima', owner: 'nositelj rizika', approver: 'odobravanje', finance: 'financije', manager: 'voditelj', proposals: 'prijave', calls: 'radar', admin: 'administracija' };

/** Rok stavke: „kasni 3 d” / „danas” / „za 5 d”; bez roka ništa. */
function DueChip({ it }: { it: WorkItem }) {
  if (it.days === null) return null;
  const d = it.days;
  return <span className={`chip ${d < 0 ? 'bad' : d <= 7 ? 'warn' : ''}`} title={it.due ? `rok ${date(it.due)}` : undefined}>{d < 0 ? `kasni ${-d} d` : d === 0 ? 'danas' : `za ${d} d`}</span>;
}

/**
 * WP1.18 – „Moj rad”: što danas čeka korisnika, na svim projektima na kojima ima ulogu. Svaka stavka vodi ravno na zaslon
 * na kojem se rješava. Iznosi se ne prikazuju. Početna stranica za sve osim uprave i ureda (portfelj).
 */
export function MyWork({ me, onSummary }: { me: Me; onSummary?: (s: WorkSummary) => void }) {
  const w = useLoad(() => api<Data>('GET', '/me/work'), []);
  useEffect(() => { if (w.data) onSummary?.(w.data.summary); }, [w.data, onSummary]);
  return (
    <>
      <h1>Moj rad</h1>
      <p className="sub">Što čeka tebe – na svim projektima i prijavama na kojima imaš ulogu{w.data ? ` · stanje ${date(w.data.today)}` : ''}</p>
      <ErrorBox error={w.error} />
      {!w.data ? <Loading what="tvoj popis" /> : !w.data.items.length ? <Empty me={me} /> : (
        <>
          <div className="work-summary" role="status">
            {w.data.summary.overdue > 0 && <span className="chip bad">{w.data.summary.overdue} kasni</span>}
            {w.data.summary.dueSoon > 0 && <span className="chip warn">{w.data.summary.dueSoon} uskoro</span>}
            {w.data.summary.waiting > 0 && <span className="chip">{w.data.summary.waiting} čeka</span>}
            {w.data.summary.info > 0 && <span className="chip">{w.data.summary.info} za informaciju</span>}
            <button className="link" onClick={() => void w.reload()}>Osvježi</button>
          </div>
          {GROUPS.map(([u, title, hint]) => {
            const items = w.data!.items.filter((i) => i.urgency === u);
            if (!items.length) return null;
            return (
              <section key={u} className={`card work-group ${u}`} aria-label={title}>
                <h2>{title} <span className="muted">· {items.length}{hint ? ` · ${hint}` : ''}</span></h2>
                <ul className="work-list">
                  {items.map((it) => (
                    <li key={it.key}>
                      <a className="work-item" href={`#/${it.link}`} data-kind={it.kind}>
                        <span className="work-main">
                          <span className="work-title">{it.acronym && <span className="chip acr">{it.acronym}</span>}{it.title}</span>
                          {it.detail && <span className="work-detail muted">{it.detail}</span>}
                        </span>
                        <span className="work-meta"><DueChip it={it} /><span className="muted work-role">{ROLE[it.role] ?? it.role}</span></span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </>
  );
}

function Empty({ me }: { me: Me }) {
  return (
    <div className="card empty work-empty">
      <h2>Nema ničega na čekanju</h2>
      <p>Svi tvoji timesheetovi su predani, ništa ne čeka tvoje odobrenje i nijedan rok nije blizu. Ovdje se pojavljuje:</p>
      <ul>
        <li>timesheet tekućeg mjeseca i mjeseci koji nisu predani, timesheet vraćen na doradu;</li>
        <li>timesheetovi koji čekaju tvoje odobrenje, isporuke i prekretnice koje kasne ili dospijevaju u 30 dana;</li>
        <li>troškovi bez dokaza i zahtjevi za nadoknadu koji čekaju predaju (ako radiš financije projekta);</li>
        <li>interni rokovi prijava i praćeni pozivi bez odluke (ured za projekte, voditelji prijava).</li>
      </ul>
      {can(me, 'portfolio:read') && <p className="muted">Stanje svih projekata institucije je na stranici <a href="#/portfelj">Portfelj</a>.</p>}
    </div>
  );
}
