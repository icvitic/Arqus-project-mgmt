import { useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { date, dateTime, eur, hours, label, monthLabel, plural } from '../lib/format';
import { go, useLoad } from '../lib/hooks';
import type { ClaimSavings, Me, Portfolio as Data, PortfolioDeadline, PortfolioPerson, PortfolioProject } from '../lib/types';
import { ActionButton, Chip, ErrorBox, Field, Loading } from '../ui';
import { can } from '../lib/access';

const KIND: Record<string, string> = {
  claim_due: 'rok ZNS-a i izvještaja', period_end: 'kraj razdoblja', deliverable: 'isporuka', milestone: 'prekretnica',
  call_submission: 'rok poziva', call_internal: 'interni rok poziva', proposal_internal: 'interni rok prijave',
};
const ROLE: Record<string, string> = { coordinator: 'koordinator', partner: 'partner' };

/** Dani do roka u stilu radara: danas / za N d; prošli rok „kasni N d”. */
export const daysChip = (d: number | null) => d === null ? null
  : <span className={`chip ${d < 0 || d <= 7 ? 'bad' : d <= 21 ? 'warn' : ''}`}>{d < 0 ? `kasni ${-d} d` : d === 0 ? 'danas' : `za ${d} d`}</span>;

const Tile = ({ v, l, children, tone }: { v: ReactNode; l: string; children?: ReactNode; tone?: string }) => (
  <div className={`tile${tone ? ` ${tone}` : ''}`}><div className="v">{v}</div><div className="l">{l}</div>{children && <div className="t">{children}</div>}</div>
);

export function Portfolio({ me }: { me: Me }) {
  const [days, setDays] = useState(60);
  const pf = useLoad(() => api<Data>('GET', `/portfolio?days=${days}`), [days]);
  if (pf.error) return <><h1>Portfelj</h1><ErrorBox error={pf.error} /></>;
  if (!pf.data) return <><h1>Portfelj</h1><Loading what="portfelj" /></>;
  const d = pf.data; const s = d.summary;
  return (
    <>
      <h1>Portfelj</h1>
      <p className="sub">{d.access.full ? 'Svi projekti, novac, rokovi, ljudi i prijave institucije' : 'Projekti na kojima imaš ulogu'} · stanje {date(d.today)}</p>
      {s.projects === 0 && !d.pipeline?.proposals.length ? <Empty me={me} full={d.access.full} /> : (
        <>
          <Figures d={d} />
          {can(me, 'portfolio:read') && <Savings />}
          <Projects d={d} />
          <Deadlines d={d} days={days} setDays={setDays} />
          {d.people && <People people={d.people} />}
          {d.pipeline && <Pipeline d={d} />}
        </>
      )}
    </>
  );
}

function Empty({ me, full }: { me: Me; full: boolean }) {
  if (!full) return <div className="card empty"><p>Još nemaš ulogu ni na jednom projektu. Voditelj projekta ili administrator dodijelit će ti ulogu na projektu; tada se projekt, njegovi rokovi i upozorenja pojavljuju ovdje.</p></div>;
  return (
    <div className="card empty">
      <h2>Portfelj je prazan – ovako počinje</h2>
      <ol>
        <li><b>Projekti koji su već u provedbi:</b> {can(me, 'projects:write') ? <a href="#/projekti">Projekti → Novi projekt</a> : 'Projekti → Novi projekt (ured za projekte)'} – paket programa, početak i trajanje, partneri, zatim proračun i tim.</li>
        <li><b>Novi pozivi:</b> {can(me, 'calls:read') ? <a href="#/radar">Radar poziva</a> : 'Radar poziva'} – ocjena prikladnosti i odluka go; iz odluke go otvara se prijava.</li>
        <li><b>Ljudi:</b> {can(me, 'users:read') ? <a href="#/korisnici">Korisnici</a> : 'Korisnici'} – voditelji i članovi tima dobivaju ulogu na svojem projektu.</li>
      </ol>
      <p className="muted">Čim postoji projekt s proračunom, rokovima i timesheetovima, ovdje se vide potrošnja prema vremenu, rokovi i opterećenje ljudi.</p>
    </div>
  );
}

function Figures({ d }: { d: Data }) {
  const s = d.summary; const m = s.money;
  return (
    <div className="tiles">
      <Tile v={s.activeProjects} l={`${plural(s.activeProjects, 'projekt', 'projekta', 'projekata')} u provedbi`}>{s.projects !== s.activeProjects && `${s.projects} u portfelju`}</Tile>
      {m && <Tile v={eur(m.planned)} l="ugovoreni proračun (naš dio)">zatraženo financiranje {eur(m.requested)}{m.projectPlanned !== m.planned && <><br />cijeli projekti {eur(m.projectPlanned)}</>}</Tile>}
      {m && (
        <Tile v={eur(m.spent)} l={`potrošeno · ${m.spentPercent ?? 0} % proračuna`}>
          <div className="bar" role="img" aria-label={`potrošeno ${m.spentPercent ?? 0} %`}><i style={{ width: `${Math.min(m.spentPercent ?? 0, 100)}%` }} /></div>
          {m.unrecognised > 0 && <span>nepriznato u odlukama o ZNS-u {eur(m.unrecognised)}<br /></span>}
          {d.access.finance === 'partial' && <span>samo projekti na kojima vidiš financije ({m.projects})</span>}
        </Tile>
      )}
      <Tile v={s.deadlinesSoon} l={`${plural(s.deadlinesSoon, 'rok', 'roka', 'rokova')} u idućih 30 dana`} tone={s.overdue ? 'alert-tile' : undefined}>
        {s.overdue ? <span className="bad-text">{s.overdue} {plural(s.overdue, 'prošao rok', 'prošla roka', 'prošlih rokova')} bez ispunjene obveze</span> : 'nema prošlih rokova'}
      </Tile>
      {s.pipeline && <Tile v={s.pipeline.open} l={`${plural(s.pipeline.open, 'prijava', 'prijave', 'prijava')} u tijeku`}>traženo (naš dio) {eur(s.pipeline.requestedOwn)}</Tile>}
      {s.successRate && <Tile v={s.successRate.percent === null ? '–' : `${s.successRate.percent} %`} l="uspješnost prijava">{s.successRate.funded} financirano · {s.successRate.rejected} odbijeno</Tile>}
    </div>
  );
}

const num = (n: number | null | undefined, d = 1) => (n === null || n === undefined ? '–' : n.toLocaleString('hr-HR', { maximumFractionDigits: d }));

/**
 * „Ušteda na ZNS-u” (WP1.16b): prosjek prijavljenih sati pripreme predanih ZNS-ova prema polaznoj mjeri institucije
 * (sati po ZNS-u prije ArQusa), uz automatske mjere. Cilj iz uvjeta za fazu 2: ušteda ≥ 30 %.
 */
function Savings() {
  const r = useLoad(() => api<ClaimSavings>('GET', '/portfolio/claim-savings'), []);
  const [edit, setEdit] = useState(false);
  const [value, setValue] = useState('');
  if (r.error) return <div className="card"><h2>Ušteda na ZNS-u</h2><ErrorBox error={r.error} /></div>;
  if (!r.data) return null;
  const s = r.data; const a = s.automatic;
  const parsed = Number(value.trim().replace(',', '.'));
  const valid = value.trim() !== '' && Number.isFinite(parsed) && parsed > 0 && parsed <= 10000;
  return (
    <div className="card" aria-label="Ušteda na ZNS-u">
      <div className="card-head">
        <h2>Ušteda na ZNS-u</h2>
        <span className="muted">cilj: ušteda ≥ {s.targetPercent} % vremena pripreme</span>
      </div>
      {s.status === 'ok' ? (
        <div className="tiles">
          <Tile v={`${num(s.savingPercent)} %`} l="ušteda vremena pripreme" tone={s.meetsTarget ? undefined : 'alert-tile'}>{s.meetsTarget ? `iznad cilja od ${s.targetPercent} %` : `ispod cilja od ${s.targetPercent} %`}</Tile>
          <Tile v={`${num(s.averageHours, 2)} h`} l="prosječno po ZNS-u (prijavljeno)">prije ArQusa {num(s.baselineHours, 2)} h · razlika {num(s.savingHours, 2)} h</Tile>
          <Tile v={s.reportedClaims} l={`${plural(s.reportedClaims, 'ZNS', 'ZNS-a', 'ZNS-ova')} s upisanim satima`}>od {s.submittedClaims} {plural(s.submittedClaims, 'predanog', 'predana', 'predanih')}</Tile>
        </div>
      ) : (
        <div className="warnbox">
          {s.missing.includes('baseline') && <p style={{ margin: 0 }}><b>Nedostaje polazna mjera:</b> koliko je sati prosječno trajala priprema jednog ZNS-a prije ArQusa (procjena ureda za projekte i financija; upisuje se jednom).</p>}
          {s.missing.includes('hours') && <p style={{ margin: s.missing.length > 1 ? '6px 0 0' : 0 }}><b>Nema prijavljenih sati:</b> pri predaji ZNS-a upiši „sati utrošeni na pripremu” (ili ih naknadno upiši u „Mjerenje pripreme” na predanom zahtjevu).</p>}
          {s.status === 'no_baseline' && s.reportedClaims > 0 && <p className="muted" style={{ margin: '6px 0 0' }}>Prijavljeno zasad: prosječno {num(s.averageHours, 2)} h na {s.reportedClaims} {plural(s.reportedClaims, 'ZNS', 'ZNS-a', 'ZNS-ova')}.</p>}
        </div>
      )}
      {a && <p className="muted">Automatski izmjereno na {a.claims} {plural(a.claims, 'predanom', 'predana', 'predanih')} ZNS-{a.claims === 1 ? 'u' : 'ova'}: predaja prosječno {num(a.averageDaysAfterPeriodEnd)} d nakon kraja razdoblja, {num(a.averageDaysInPreparation)} d od otvaranja nacrta; {a.returns} {plural(a.returns, 'povrat', 'povrata', 'povrata')} na dopunu; prosječno {num(a.averageExpenses)} troškova, {num(a.averageEvidenceFiles)} dokaza i {num(a.averageTimesheets)} timesheetova po zahtjevu.</p>}
      {s.claims.length > 0 && (
        <details><summary>Zahtjevi u izračunu ({s.claims.length})</summary>
          <div className="scroll">
            <table>
              <thead><tr><th>ZNS</th><th>Predan</th><th className="num">Sati pripreme</th><th className="num">Dana nakon razdoblja</th><th className="num">Dana u pripremi</th><th className="num">Povrati</th><th className="num">Troškovi / dokazi / timesheetovi</th></tr></thead>
              <tbody>{s.claims.map((c) => (
                <tr key={c.id}><td><a href={`#/projekti/${c.projectId}/zns`}>{c.acronym} RP{c.period}</a></td><td>{date(c.submittedAt)}</td><td className="num">{c.reportedHours === null ? <span className="muted">nije upisano</span> : num(c.reportedHours, 2)}</td>
                  <td className="num">{c.measures.daysAfterPeriodEnd}</td><td className="num">{c.measures.daysInPreparation}</td><td className="num">{c.measures.returns}</td><td className="num">{c.measures.expenses} / {c.measures.evidenceFiles} / {c.measures.timesheets}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </details>
      )}
      {s.canEditBaseline && !edit && <div className="actions"><button onClick={() => { setValue(s.baselineHours === null ? '' : String(s.baselineHours).replace('.', ',')); setEdit(true); }}>{s.baselineHours === null ? 'Upiši polaznu mjeru' : `Polazna mjera: ${num(s.baselineHours, 2)} h – promijeni`}</button></div>}
      {s.canEditBaseline && edit && (
        <div className="actions">
          <Field label="Sati po ZNS-u prije ArQusa"><input aria-label="Sati po ZNS-u prije ArQusa" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="npr. 30" /></Field>
          <ActionButton kind="primary" disabled={!valid} onClick={async () => { r.setData(await api<ClaimSavings>('PUT', '/portfolio/claim-savings/baseline', { hours: parsed })); setEdit(false); }}>Spremi</ActionButton>
          <button onClick={() => setEdit(false)}>Odustani</button>
        </div>
      )}
      {!s.canEditBaseline && s.baselineHours === null && <p className="muted">Polaznu mjeru upisuje ured za projekte ili administrator.</p>}
    </div>
  );
}

const SIGNAL: Record<string, [string, string]> = { lagging: ['warn', 'potrošnja kasni'], ahead: ['bad', 'potrošnja ispred vremena'] };

function Progress({ p, threshold }: { p: PortfolioProject; threshold: number }) {
  const t = p.time; const b = p.budget;
  const timeText = t.state === 'unknown' ? 'bez početka' : t.state === 'not_started' ? 'nije počeo' : t.state === 'finished' ? 'završio' : `mj. ${t.month}/${p.durationMonths}`;
  const sig = b ? SIGNAL[b.signal] : undefined;
  return (
    <div className="progress">
      <div className="pbar" title={`Proteklo vrijeme: ${t.percent ?? 0} % (${timeText})`}><span>vrijeme</span><div className="bar time"><i style={{ width: `${t.percent ?? 0}%` }} /></div><b>{t.percent === null ? '–' : `${t.percent} %`}</b></div>
      {b && <div className="pbar" title={`Potrošeno ${eur(b.actual)} od ${eur(b.planned)} (naš dio)`}><span>potrošnja</span><div className={`bar ${b.signal}`}><i style={{ width: `${Math.min(b.percent ?? 0, 100)}%` }} /></div><b>{b.percent === null ? '–' : `${b.percent} %`}</b></div>}
      <small className="muted">{timeText}{sig && b?.gap !== null && b ? <> · <span className={`chip ${sig[0]}`} title={`razlika veća od ${threshold} postotnih bodova`}>{sig[1]} {b.gap! > 0 ? '+' : '−'}{Math.abs(b.gap!)} p. b.</span></> : b?.percent === null ? ' · bez proračuna' : ''}</small>
    </div>
  );
}

function AttentionChips({ p }: { p: PortfolioProject }) {
  const a = p.attention;
  if (!a) return <span className="muted">–</span>;
  const base = `#/projekti/${p.id}`;
  const chips: [number | null, string, string, string][] = [
    [a.lateDeliverables, plural(a.lateDeliverables, 'isporuka kasni', 'isporuke kasne', 'isporuka kasni'), 'struktura', 'bad'],
    [a.highRisks, plural(a.highRisks, 'visok rizik', 'visoka rizika', 'visokih rizika'), 'struktura', 'bad'],
    [a.timesheetsToApprove, plural(a.timesheetsToApprove ?? 0, 'timesheet čeka odobrenje', 'timesheeta čekaju odobrenje', 'timesheetova čeka odobrenje'), 'tim', 'warn'],
    [a.expensesWithoutEvidence, plural(a.expensesWithoutEvidence ?? 0, 'trošak bez dokaza', 'troška bez dokaza', 'troškova bez dokaza'), 'troskovi', 'warn'],
    [a.unclaimedPeriods, plural(a.unclaimedPeriods ?? 0, 'razdoblje bez predanog ZNS-a', 'razdoblja bez predanog ZNS-a', 'razdoblja bez predanog ZNS-a'), 'zns', 'bad'],
    [a.strandedExpenses, plural(a.strandedExpenses ?? 0, 'nepredan trošak iz ranijeg razdoblja', 'nepredana troška iz ranijih razdoblja', 'nepredanih troškova iz ranijih razdoblja'), 'zns', 'warn'],
  ];
  const shown = chips.filter(([n]) => n);
  if (!shown.length) return <span className="chip ok">sve u redu</span>;
  return <div className="chips">{shown.map(([n, text, tab, tone]) => <a key={text} className={`chip ${tone}`} href={`${base}/${tab}`} onClick={(e) => e.stopPropagation()}>{n} {text}</a>)}</div>;
}

function Projects({ d }: { d: Data }) {
  return (
    <div className="card">
      <h2>Projekti</h2>
      {d.projects.length === 0 ? <p className="muted">Nema projekata u portfelju.</p> : (
        <div className="scroll">
          <table className="portfolio">
            <thead><tr><th>Projekt</th><th>Program · uloga</th><th>Status</th><th>Vrijeme i potrošnja</th><th>Sljedeći izvještaj</th><th>Traži pažnju</th></tr></thead>
            <tbody>{d.projects.map((p) => (
              <tr key={p.id} className="row" tabIndex={0} onClick={() => go(`projekti/${p.id}`)} onKeyDown={(e) => e.key === 'Enter' && go(`projekti/${p.id}`)}>
                <td><a href={`#/projekti/${p.id}`} onClick={(e) => e.stopPropagation()}><b>{p.acronym}</b></a><br /><span className="muted clamp">{p.title}</span></td>
                <td><span className="clamp">{p.programme}</span><small className="muted">{ROLE[p.role] ?? p.role} · {p.actionType}</small></td>
                <td><Chip s={p.status} /></td>
                <td style={{ minWidth: 220 }}><Progress p={p} threshold={d.thresholdPp} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>{p.nextReport ? <>RP{p.nextReport.period} · {date(p.nextReport.dueDate)}<br />{daysChip(p.nextReport.days)}</> : <span className="muted">–</span>}</td>
                <td style={{ minWidth: 190 }}><AttentionChips p={p} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {d.access.finance === 'none' && d.projects.length > 0 && <p className="muted">Iznosi se prikazuju samo uz pristup financijama projekta.</p>}
      {d.access.finance !== 'none' && d.projects.length > 0 && <p className="muted">Potrošnja = ostvareno / ugovoreno za našu organizaciju (kao na kartici „Ugovoreno / ostvareno”); oznaka kad se od proteklog vremena razlikuje za više od {d.thresholdPp} postotnih bodova.</p>}
    </div>
  );
}

function Deadlines({ d, days, setDays }: { d: Data; days: number; setDays: (n: number) => void }) {
  const where = (x: PortfolioDeadline) => x.scope ?? '';
  return (
    <div className="card">
      <div className="card-head">
        <h2>Rokovi</h2>
        <select aria-label="Prozor rokova" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[30, 60, 90, 180].map((n) => <option key={n} value={n}>idućih {n} dana</option>)}</select>
      </div>
      {d.deadlines.length === 0 ? <p className="muted">Nema prošlih ni nadolazećih rokova u idućih {days} dana.{d.access.calls ? ' Rokovi poziva prikazuju se za pozive s odlukom go ili „pratimo” na radaru.' : ''}</p> : (
        <div className="scroll">
          <table>
            <thead><tr><th>Rok</th><th>Projekt / poziv</th><th>Što</th></tr></thead>
            <tbody>{d.deadlines.map((x, i) => (
              <tr key={`${x.kind}-${x.link}-${x.date}-${i}`} className={`row${x.overdue ? ' overdue' : ''}`} tabIndex={0} onClick={() => go(x.link)} onKeyDown={(e) => e.key === 'Enter' && go(x.link)}>
                <td style={{ whiteSpace: 'nowrap' }}>{x.at ? dateTime(x.at) : date(x.date)}<br />{daysChip(x.days)}</td>
                <td><b className="break">{where(x)}</b><small className="muted">{KIND[x.kind] ?? x.kind}</small></td>
                <td>{x.title}{x.detail && <> <span className="chip">{x.detail}</span></>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function People({ people }: { people: NonNullable<Data['people']> }) {
  const flagged = people.persons.filter((p) => p.overAnnual || p.overDays.length).length;
  return (
    <div className="card">
      <h2>Opterećenje ljudi</h2>
      <p className="sub">Sati iz predanih i odobrenih timesheetova kroz sve projekte (ista osoba po korisničkom računu, inače po imenu). Provjera dvostrukog financiranja: više od {people.dailyLimitHours} h na dan ukupno i godišnji fond produktivnih sati iz pravila paketa.{flagged ? ` Upozorenja: ${flagged} ${plural(flagged, 'osoba', 'osobe', 'osoba')}.` : ''}</p>
      {people.persons.length === 0 ? <p className="muted">Još nema predanih timesheetova. Članovi tima unose ih na kartici projekta „Tim i timesheetovi”.</p> : (
        <div className="scroll">
          <table>
            <thead><tr><th>Osoba</th><th>Projekti</th>{people.months.map((m) => <th key={m} className="num">{monthLabel(m, true)}</th>)}<th>{people.year}. (h / fond)</th><th>Provjera</th></tr></thead>
            <tbody>{people.persons.map((p) => <PersonRow key={p.key} p={p} limit={people.dailyLimitHours} />)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PersonRow({ p, limit }: { p: PortfolioPerson; limit: number }) {
  const pct = p.annualLimitHours ? Math.round((p.yearMinutes / 60 / p.annualLimitHours) * 100) : null;
  const multi = p.overDays.filter((x) => x.projects > 1).length;
  return (
    <tr>
      <td><b>{p.name}</b>{!p.userId && <small className="muted">bez korisničkog računa</small>}</td>
      <td><div className="chips">{p.projects.map((x) => <a key={x.id} className="chip" href={`#/projekti/${x.id}/tim`}>{x.acronym}</a>)}</div></td>
      {p.months.map((m) => <td key={m.month} className="num">{m.minutes ? hours(m.minutes) : <span className="muted">–</span>}</td>)}
      <td style={{ minWidth: 130 }}>
        <span className="num-inline">{hours(p.yearMinutes)}{p.annualLimitHours ? ` / ${p.annualLimitHours}` : ''}</span>
        {pct !== null && <div className={`bar${p.overAnnual ? ' ahead' : ''}`}><i style={{ width: `${Math.min(pct, 100)}%` }} /></div>}
      </td>
      <td>
        <div className="chips">
          {p.overAnnual && <span className="chip bad">iznad godišnjeg fonda</span>}
          {p.overDays.length > 0 && <span className="chip bad" title={p.overDays.map((x) => `${date(x.date)}: ${hours(x.minutes)} h${x.projects > 1 ? ` na ${x.projects} projekta` : ''}`).join('\n')}>{p.overDays.length} {plural(p.overDays.length, 'dan', 'dana', 'dana')} &gt; {limit} h{multi ? ` (${multi} kroz više projekata)` : ''}</span>}
          {!p.overAnnual && !p.overDays.length && <span className="chip ok">u redu</span>}
        </div>
        {p.overDays.length > 0 && <small className="muted">{p.overDays.slice(0, 3).map((x) => `${date(x.date)} ${hours(x.minutes)} h`).join(' · ')}{p.overDays.length > 3 ? ' …' : ''}</small>}
      </td>
    </tr>
  );
}

function Pipeline({ d }: { d: Data }) {
  const pl = d.pipeline!;
  return (
    <div className="card">
      <h2>Prijave</h2>
      {pl.byStatus.length > 0 && <div className="chips status-row">{pl.byStatus.map((s) => <span key={s.status} className="chip" title={`traženo ukupno ${eur(s.requested)}`}>{s.status === 'rejected' ? 'odbijena' : label(s.status)}: <b>{s.count}</b>{s.requestedOwn ? ` · ${eur(s.requestedOwn)}` : ''}</span>)}</div>}
      {pl.proposals.length === 0 ? <p className="muted">Nema prijava u tijeku. Prijava se otvara iz odluke go na <a href="#/radar">radaru poziva</a>.</p> : (
        <div className="scroll">
          <table>
            <thead><tr><th>Prijava</th><th>Status</th><th>Poziv</th><th>Interni rok</th><th className="num">Traženo (naš dio)</th><th className="num">Traženo ukupno</th></tr></thead>
            <tbody>{pl.proposals.map((x) => (
              <tr key={x.id} className="row" tabIndex={0} onClick={() => go(`prijave/${x.id}`)} onKeyDown={(e) => e.key === 'Enter' && go(`prijave/${x.id}`)}>
                <td><b>{x.acronym}</b><br /><span className="muted clamp">{x.title}</span></td>
                <td><Chip s={x.status} /></td>
                <td>{x.callCode ?? <span className="muted">–</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{x.internalDeadline ? <>{date(x.internalDeadline)} {daysChip(x.days)}</> : <span className="muted">–</span>}</td>
                <td className="num">{eur(x.requestedOwn)}</td><td className="num">{eur(x.requested)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
