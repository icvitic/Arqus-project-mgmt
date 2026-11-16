import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { centsToInput, date, dateTime, eur, label, parseEur } from '../lib/format';
import { go, useLoad } from '../lib/hooks';
import { enterable, type Me, type Organisation, type PackageDetail, type PackageSummary, type Proposal, type ProposalSummary, type UserRow } from '../lib/types';
import { ActionButton, ActionForm, Chip, ErrorBox, Field, Loading } from '../ui';
import { DocumentList } from '../tabs/Documents';

const can = (me: Me, p: string) => me.permissions.includes('*') || me.permissions.includes(p);
const STEPS = ['idea', 'preparation', 'internal_review', 'submitted', 'in_evaluation', 'funded', 'contracted'];
const TONE: Record<string, string> = { funded: 'ok', contracted: 'ok', submitted: 'acc', in_evaluation: 'acc', reserve: 'warn', internal_review: 'warn', rejected: 'bad', withdrawn: 'bad' };
const ROLE: Record<string, string> = { coordinator: 'koordinator', partner: 'partner', associated: 'pridruženi', third_party: 'treća strana' };
const NEXT: Record<string, [string, string][]> = {
  idea: [['preparation', 'Započni pripremu']], preparation: [['internal_review', 'Pošalji na internu provjeru']], internal_review: [['preparation', 'Vrati u pripremu']], submitted: [['in_evaluation', 'U evaluaciji']],
};

export function Proposals({ me, route }: { me: Me; route: string[] }) {
  const [, id] = route;
  if (id === 'nova') return <NewProposal />;
  if (id) return <ProposalView me={me} id={id} />;
  return <ProposalList me={me} />;
}

function ProposalList({ me }: { me: Me }) {
  const list = useLoad(() => api<ProposalSummary[]>('GET', '/proposals'), []);
  return (
    <>
      <h1>Prijave</h1>
      <p className="sub">Od odluke „go” do predaje i ugovaranja: konzorcij, struktura rada, proračun po pravilima paketa i provjera spremnosti. Financirana prijava ugovara se u projekt.</p>
      {can(me, 'proposals:write') && <div className="actions" style={{ marginBottom: 12 }}><button className="primary" onClick={() => go('prijave/nova')}>Nova prijava</button> <span className="muted">ili otvori prijavu iz poziva na radaru</span></div>}
      <div className="card scroll">
        <ErrorBox error={list.error} />
        {!list.data ? <Loading /> : list.data.length === 0 ? <p className="muted">Još nema prijava.</p> : (
          <table>
            <thead><tr><th>Prijava</th><th>Poziv / paket</th><th>Interni rok</th><th className="num">Članovi</th><th className="num">Zatraženo</th><th>Status</th></tr></thead>
            <tbody>{list.data.map((p) => (
              <tr key={p.id} className="row" tabIndex={0} onClick={() => go(`prijave/${p.id}`)} onKeyDown={(e) => e.key === 'Enter' && go(`prijave/${p.id}`)}>
                <td><b>{p.acronym}</b><br /><span className="muted">{p.title}</span></td>
                <td>{p.callCode ?? '–'}<br /><span className="muted">{p.packageId} · {p.actionType}</span></td>
                <td>{date(p.internalDeadline)}</td><td className="num">{p.members}</td><td className="num">{p.requested !== null ? eur(p.requested) : '–'}</td>
                <td><Chip s={p.status} tone={TONE[p.status]} /></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </>
  );
}

function NewProposal() {
  const packages = useLoad(() => api<PackageSummary[]>('GET', '/programme-packages'), []);
  const [packageId, setPackageId] = useState('');
  const pkg = useLoad(() => (packageId ? api<PackageDetail>('GET', `/programme-packages/${encodeURIComponent(packageId)}`) : Promise.resolve(null)), [packageId]);
  const [f, setF] = useState({ acronym: '', title: '', actionType: '', role: 'coordinator', durationMonths: '36', internalDeadline: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const unique = [...new Map((packages.data ?? []).filter((p) => p.status !== 'deprecated').map((p) => [p.packageId, p])).values()];
  return (
    <>
      <p><a href="#/prijave">← Prijave</a></p>
      <div className="card"><h2>Nova prijava (bez poziva s radara)</h2>
        <ActionForm submit="Otvori prijavu" onSubmit={async () => {
          const p = await api<{ id: string }>('POST', '/proposals', { packageId, actionType: f.actionType, acronym: f.acronym, title: f.title, role: f.role, durationMonths: Number(f.durationMonths), ...(f.internalDeadline ? { internalDeadline: f.internalDeadline } : {}) });
          go(`prijave/${p.id}`);
        }}>
          <Field label="Akronim"><input value={f.acronym} onChange={set('acronym')} required /></Field>
          <Field label="Naslov"><input value={f.title} onChange={set('title')} required /></Field>
          <Field label="Paket programa"><select value={packageId} onChange={(e) => { setPackageId(e.target.value); setF({ ...f, actionType: '' }); }} required><option value="">– odaberi –</option>{unique.map((p) => <option key={p.packageId} value={p.packageId}>{p.programme}</option>)}</select></Field>
          <Field label="Vrsta akcije"><select value={f.actionType} onChange={set('actionType')} required disabled={!pkg.data}><option value="">– odaberi –</option>{pkg.data?.actionTypes.map((a) => <option key={a.code} value={a.code}>{a.code} – {a.name}</option>)}</select></Field>
          <Field label="Uloga institucije"><select value={f.role} onChange={set('role')}><option value="coordinator">koordinator</option><option value="partner">partner</option></select></Field>
          <Field label="Trajanje (mjeseci)"><input type="number" min={1} max={120} value={f.durationMonths} onChange={set('durationMonths')} required /></Field>
          <Field label="Interni rok"><input type="date" value={f.internalDeadline} onChange={set('internalDeadline')} /></Field>
        </ActionForm>
      </div>
    </>
  );
}

function ProposalView({ me, id }: { me: Me; id: string }) {
  const p = useLoad(() => api<Proposal>('GET', `/proposals/${id}`), [id]);
  if (p.error) return <ErrorBox error={p.error} />;
  if (!p.data) return <Loading what="prijavu" />;
  const d = p.data;
  const write = can(me, 'proposals:write');
  const editable = write && ['idea', 'preparation'].includes(d.status);
  const set = (x: Proposal) => p.setData(x);
  const stepIdx = STEPS.indexOf(d.status);
  return (
    <>
      <p><a href="#/prijave">← Prijave</a></p>
      <h1>{d.acronym} <Chip s={d.status} tone={TONE[d.status]} /></h1>
      <p className="sub">{d.title} · {d.package.id} v{d.package.version} · {d.actionType} · {ROLE[d.role]}{d.call && <> · poziv <a href={`#/radar/${d.call.id}`}>{d.call.code}</a> <Chip s={d.call.status} /></>}</p>
      <ol className="stepper" aria-label="Faze prijave">{STEPS.map((s, i) => <li key={s} className={s === d.status ? 'cur' : stepIdx > i ? 'done' : ''}>{label(s)}</li>)}</ol>
      <div className="grid g2">
        <div className="card"><h2>Spremnost za predaju {d.ready ? <Chip s="spremna" tone="ok" /> : <Chip s="nije spremna" tone="warn" />}</h2>
          <ul className="checklist">{d.readiness.map((r) => <li key={r.key} className={r.ok ? 'ok' : 'bad'}>{r.ok ? '✓' : '✗'} {r.label}</li>)}</ul>
        </div>
        <StatusCard d={d} me={me} set={set} />
      </div>
      <Basics d={d} editable={write && !['contracted', 'withdrawn', 'rejected'].includes(d.status)} durationEditable={editable} me={me} set={set} />
      <Consortium d={d} editable={editable} set={set} />
      <WorkPlan d={d} editable={editable} set={set} />
      <BudgetGrid d={d} editable={editable} set={set} />
      <div className="card scroll"><h2>Dokumenti prijave</h2>
        <DocumentList target={{ entityType: 'proposal', entityId: d.id }} defaultKind="proposal" canWrite={can(me, 'documents:write') && !['contracted', 'withdrawn', 'rejected'].includes(d.status)} />
      </div>
    </>
  );
}

function StatusCard({ d, me, set }: { d: Proposal; me: Me; set: (p: Proposal) => void }) {
  const write = can(me, 'proposals:write');
  const [sub, setSub] = useState({ portal: d.package.id.startsWith('horizon') ? 'EU Funding & Tenders' : 'eFondovi', reference: '' });
  const [out, setOut] = useState({ result: 'funded', score: '', note: '' });
  const [con, setCon] = useState({ contractNo: '', startDate: '' });
  const tr = (to: string) => async () => set(await api<Proposal>('POST', `/proposals/${d.id}/transition`, { to }));
  return (
    <div className="card"><h2>Tijek prijave</h2>
      {d.submission && <p>Predano {dateTime(d.submission.at)} na <b>{d.submission.portal}</b> ({d.submission.reference}), proračun v{d.submission.budgetVersion}: ukupno {eur(d.submission.total)}, zatraženo <b>{eur(d.submission.requested)}</b>.</p>}
      {d.outcome && <p>Ishod: <Chip s={d.outcome.result} tone={TONE[d.outcome.result]} />{d.outcome.score && ` · bodovi ${d.outcome.score}`}{d.outcome.note && ` · ${d.outcome.note}`}</p>}
      {d.projectId && <p><a href={`#/projekti/${d.projectId}`}>Otvori projekt →</a></p>}
      {write && <div className="actions">
        {(NEXT[d.status] ?? []).map(([to, l]) => <ActionButton key={to} kind={to === 'preparation' && d.status === 'internal_review' ? undefined : 'primary'} onClick={tr(to)}>{l}</ActionButton>)}
        {!['rejected', 'withdrawn', 'contracted'].includes(d.status) && <ActionButton kind="danger" confirm="Povući prijavu? Radnja se ne može poništiti." onClick={tr('withdrawn')}>Povuci prijavu</ActionButton>}
      </div>}
      {write && d.status === 'internal_review' && (
        <ActionForm submit="Evidentiraj predaju" onSubmit={async () => set(await api<Proposal>('POST', `/proposals/${d.id}/submit`, sub))}>
          <Field label="Portal"><input value={sub.portal} onChange={(e) => setSub({ ...sub, portal: e.target.value })} required /></Field>
          <Field label="Referentni broj prijave"><input value={sub.reference} onChange={(e) => setSub({ ...sub, reference: e.target.value })} required /></Field>
        </ActionForm>
      )}
      {write && ['submitted', 'in_evaluation', 'reserve'].includes(d.status) && (
        <ActionForm submit="Upiši ishod" onSubmit={async () => set(await api<Proposal>('POST', `/proposals/${d.id}/outcome`, { result: out.result, ...(out.score ? { score: out.score } : {}), ...(out.note ? { note: out.note } : {}) }))}>
          <Field label="Ishod evaluacije"><select value={out.result} onChange={(e) => setOut({ ...out, result: e.target.value })}><option value="funded">financirana</option>{d.status !== 'reserve' && <option value="reserve">rezervna lista</option>}<option value="rejected">odbijena</option></select></Field>
          <Field label="Bodovi"><input value={out.score} onChange={(e) => setOut({ ...out, score: e.target.value })} placeholder="npr. 13,5/15" /></Field>
          <Field label="Napomena"><input value={out.note} onChange={(e) => setOut({ ...out, note: e.target.value })} /></Field>
        </ActionForm>
      )}
      {can(me, 'projects:write') && d.status === 'funded' && (
        <ActionForm submit="Ugovori u projekt" onSubmit={async () => { const r = await api<{ projectId: string }>('POST', `/proposals/${d.id}/contract`, { ...(con.contractNo ? { contractNo: con.contractNo } : {}), ...(con.startDate ? { startDate: con.startDate } : {}) }); go(`projekti/${r.projectId}`); }}>
          <p className="muted" style={{ gridColumn: '1/-1' }}>Stvara projekt s partnerima, radnim paketima i proračunom (nacrt v1) iz prijave. Prijava ostaje arhiv predane verzije.</p>
          <Field label="Broj ugovora"><input value={con.contractNo} onChange={(e) => setCon({ ...con, contractNo: e.target.value })} /></Field>
          <Field label="Početak projekta"><input type="date" value={con.startDate} onChange={(e) => setCon({ ...con, startDate: e.target.value })} /></Field>
        </ActionForm>
      )}
    </div>
  );
}

function Basics({ d, editable, durationEditable, me, set }: { d: Proposal; editable: boolean; durationEditable: boolean; me: Me; set: (p: Proposal) => void }) {
  const users = useLoad(() => (can(me, 'users:read') ? api<UserRow[]>('GET', '/users') : Promise.resolve([] as UserRow[])), []);
  const init = { acronym: d.acronym, title: d.title, durationMonths: String(d.durationMonths), internalDeadline: d.internalDeadline ?? '', leadUserId: d.leadUserId ?? '' };
  const [f, setF] = useState(init);
  useEffect(() => setF(init), [d]);
  const s = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  if (!editable) return null;
  return (
    <div className="card"><h2>Osnovno</h2>
      <ActionForm submit="Spremi" onSubmit={async () => set(await api<Proposal>('PATCH', `/proposals/${d.id}`, {
        acronym: f.acronym, title: f.title, internalDeadline: f.internalDeadline || null, leadUserId: f.leadUserId || null, ...(durationEditable ? { durationMonths: Number(f.durationMonths) } : {}),
      }))}>
        <Field label="Akronim"><input value={f.acronym} onChange={s('acronym')} required /></Field>
        <Field label="Naslov"><input value={f.title} onChange={s('title')} required /></Field>
        <Field label="Trajanje (mjeseci)"><input type="number" min={1} max={120} value={f.durationMonths} onChange={s('durationMonths')} disabled={!durationEditable} /></Field>
        <Field label="Interni rok"><input type="date" value={f.internalDeadline} onChange={s('internalDeadline')} /></Field>
        <Field label="Voditelj prijave"><select value={f.leadUserId} onChange={s('leadUserId')}><option value="">–</option>{users.data?.map((u) => <option key={u.id} value={u.id}>{u.displayName}</option>)}</select></Field>
      </ActionForm>
    </div>
  );
}

function Consortium({ d, editable, set }: { d: Proposal; editable: boolean; set: (p: Proposal) => void }) {
  const orgs = useLoad(() => (editable ? api<Organisation[]>('GET', '/organisations') : Promise.resolve([] as Organisation[])), [editable]);
  const [f, setF] = useState({ organisationId: '', role: 'partner' });
  const free = (orgs.data ?? []).filter((o) => !d.members.some((m) => m.organisationId === o.id));
  const countries = new Set(d.members.map((m) => m.country)).size;
  return (
    <div className="card scroll"><h2>Konzorcij <span className="muted">({d.members.length} članova, {countries} {countries === 1 ? 'država' : 'države'})</span></h2>
      <table>
        <thead><tr><th>#</th><th>Organizacija</th><th>Država</th><th>Uloga</th><th>Potvrda</th>{editable && <th />}</tr></thead>
        <tbody>{d.members.map((m) => (
          <tr key={m.id}><td>{m.orderNo}</td><td>{m.name}{m.isSelf && <> <span className="chip">mi</span></>}</td><td>{m.country}</td><td>{ROLE[m.role] ?? m.role}</td>
            <td>{m.confirmed ? <Chip s="potvrđeno" tone="ok" /> : <Chip s="čeka potvrdu" tone="warn" />}</td>
            {editable && <td style={{ whiteSpace: 'nowrap' }}>
              {!m.isSelf && <ActionButton onClick={async () => set(await api<Proposal>('PATCH', `/proposals/${d.id}/members/${m.id}`, { confirmed: !m.confirmed }))}>{m.confirmed ? 'Poništi potvrdu' : 'Potvrdi'}</ActionButton>}
              {!m.isSelf && <ActionButton kind="danger" onClick={async () => set(await api<Proposal>('DELETE', `/proposals/${d.id}/members/${m.id}`))}>Ukloni</ActionButton>}
            </td>}
          </tr>
        ))}</tbody>
      </table>
      {editable && (
        <ActionForm submit="Dodaj člana" onSubmit={async () => { set(await api<Proposal>('POST', `/proposals/${d.id}/members`, f)); setF({ ...f, organisationId: '' }); }}>
          <Field label="Organizacija" hint="nove organizacije dodaju se u Organizacijama"><select value={f.organisationId} onChange={(e) => setF({ ...f, organisationId: e.target.value })} required><option value="">– odaberi –</option>{free.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.country})</option>)}</select></Field>
          <Field label="Uloga"><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        </ActionForm>
      )}
    </div>
  );
}

function WorkPlan({ d, editable, set }: { d: Proposal; editable: boolean; set: (p: Proposal) => void }) {
  const [f, setF] = useState({ title: '', leadMemberId: '', startMonth: '1', endMonth: String(d.durationMonths), personMonths: '0' });
  const name = (mid: string | null) => d.members.find((m) => m.id === mid)?.name ?? '–';
  return (
    <div className="card scroll"><h2>Struktura rada <span className="muted">({d.workPackages.reduce((a, w) => a + w.personMonths, 0)} osoba-mjeseci)</span></h2>
      {d.workPackages.length === 0 ? <p className="muted">Još nema radnih paketa.</p> : (
        <table><thead><tr><th>RP</th><th>Naslov</th><th>Voditelj</th><th className="num">Mjeseci</th><th className="num">OM</th>{editable && <th />}</tr></thead>
          <tbody>{d.workPackages.map((w) => (
            <tr key={w.id}><td>{w.code}</td><td>{w.title}</td><td>{name(w.leadMemberId)}</td><td className="num">M{w.startMonth}–M{w.endMonth}</td><td className="num">{w.personMonths}</td>
              {editable && <td><ActionButton kind="danger" onClick={async () => set(await api<Proposal>('DELETE', `/proposals/${d.id}/work-packages/${w.id}`))}>Ukloni</ActionButton></td>}</tr>
          ))}</tbody></table>
      )}
      {editable && (
        <ActionForm submit="Dodaj radni paket" onSubmit={async () => { set(await api<Proposal>('POST', `/proposals/${d.id}/work-packages`, { title: f.title, ...(f.leadMemberId ? { leadMemberId: f.leadMemberId } : {}), startMonth: Number(f.startMonth), endMonth: Number(f.endMonth), personMonths: Number(f.personMonths) })); setF({ ...f, title: '' }); }}>
          <Field label="Naslov radnog paketa"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></Field>
          <Field label="Voditelj"><select value={f.leadMemberId} onChange={(e) => setF({ ...f, leadMemberId: e.target.value })}><option value="">–</option>{d.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
          <Field label="Od mjeseca"><input type="number" min={1} max={d.durationMonths} value={f.startMonth} onChange={(e) => setF({ ...f, startMonth: e.target.value })} /></Field>
          <Field label="Do mjeseca"><input type="number" min={1} max={d.durationMonths} value={f.endMonth} onChange={(e) => setF({ ...f, endMonth: e.target.value })} /></Field>
          <Field label="Osoba-mjeseci"><input type="number" min={0} value={f.personMonths} onChange={(e) => setF({ ...f, personMonths: e.target.value })} /></Field>
        </ActionForm>
      )}
    </div>
  );
}

function BudgetGrid({ d, editable, set }: { d: Proposal; editable: boolean; set: (p: Proposal) => void }) {
  const b = d.budget;
  const cats = enterable(b.categories);
  const key = (m: string, c: string) => `${m}|${c}`;
  const fromLines = () => Object.fromEntries(b.lines.map((l) => [key(l.memberId, l.categoryCode), centsToInput(l.amount)]));
  const [cells, setCells] = useState<Record<string, string>>(fromLines);
  useEffect(() => setCells(fromLines()), [d]);
  const canEdit = editable && !b.locked;
  const invalid = Object.entries(cells).filter(([, v]) => parseEur(v) === null).map(([k]) => k);
  return (
    <div className="card scroll">
      <h2>Proračun v{b.version} {b.locked ? <Chip s="locked" /> : <Chip s="draft" />}</h2>
      <p className="muted">Iznosi u eurima. Neizravni troškovi i zatraženi doprinos izračunavaju se iz pravila paketa. Zaključani proračun ulazi u provjeru spremnosti; otključavanje otvara novu verziju.</p>
      <table>
        <thead><tr><th>Član</th>{cats.map((c) => <th key={c.code} className="num" title={c.name}>{c.code}<br /><span style={{ textTransform: 'none', fontWeight: 400 }}>{c.name}</span></th>)}<th className="num">Neizravni</th><th className="num">Ukupno</th><th className="num">Stopa</th><th className="num">Zatraženo</th></tr></thead>
        <tbody>{b.partners.map((r) => (
          <tr key={r.partnerId}><td>{r.name}</td>
            {cats.map((c) => { const k = key(r.partnerId, c.code); return <td key={c.code} className="num">{canEdit
              ? <input className="cell" inputMode="decimal" aria-label={`${r.name} ${c.code}`} value={cells[k] ?? ''} aria-invalid={invalid.includes(k)} onChange={(e) => setCells({ ...cells, [k]: e.target.value })} />
              : eur(b.lines.find((l) => l.memberId === r.partnerId && l.categoryCode === c.code)?.amount ?? 0)}</td>; })}
            <td className="num">{eur(r.indirectTotal)}</td><td className="num"><b>{eur(r.total)}</b></td><td className="num">{r.ratePercent} %</td><td className="num"><b>{eur(r.requested)}</b></td></tr>
        ))}</tbody>
        <tfoot><tr><td>Ukupno</td>{cats.map((c) => <td key={c.code} />)}<td className="num">{eur(b.totals.indirect)}</td><td className="num">{eur(b.totals.total)}</td><td /><td className="num">{eur(b.totals.requested)}</td></tr></tfoot>
      </table>
      {b.warnings.map((w) => <div className="warnbox" key={w}>{w}</div>)}
      {editable && <div className="actions">
        {canEdit && invalid.length > 0 && <span className="chip bad">neispravan iznos u {invalid.length} polja</span>}
        {canEdit && <ActionButton kind="primary" onClick={async () => {
          if (invalid.length) throw new Error('Ispravi označene iznose');
          const lines = Object.entries(cells).map(([k, v]) => { const [memberId, categoryCode] = k.split('|') as [string, string]; return { memberId, categoryCode, amount: parseEur(v) ?? 0 }; }).filter((l) => l.amount > 0);
          set(await api<Proposal>('PUT', `/proposals/${d.id}/budget/lines`, { lines }));
        }}>Spremi proračun</ActionButton>}
        {canEdit ? <ActionButton onClick={async () => set(await api<Proposal>('POST', `/proposals/${d.id}/budget/lock`))}>Zaključaj proračun</ActionButton>
          : <ActionButton onClick={async () => set(await api<Proposal>('POST', `/proposals/${d.id}/budget/unlock`))}>Otključaj (nova verzija)</ActionButton>}
      </div>}
    </div>
  );
}
