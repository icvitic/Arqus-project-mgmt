/**
 * Sadržaj demo institucije (WP1.13). Sve se stvara kroz HTTP API kao različiti korisnici – iste rute, dozvole i poslovna pravila
 * kao u sučelju, pa su podaci valjani po konstrukciji. Datumi su relativni prema „danas”, da demo uvijek izgleda aktualno.
 * Sva imena institucija, osoba, poziva i brojeva ugovora su izmišljena.
 */
import { addDays, addMonths, daysInMonth, DEFAULT_TIME_ZONE, todayIn } from '@arqus/domain';
import { DemoApi } from './client';
import { demoPdf } from './pdf';

/** `project` = uloga se ne dodjeljuje na razini institucije; korisnik dobiva pristup samo projektu na kojem je voditelj ili član tima (WP1.14). */
export interface DemoUser { key: string; local: string; displayName: string; role: string; scope: 'tenant' | 'project'; roleLabel: string; note: string }

/** Demo korisnici: e-adresa je `<local>@<oznaka>.local`, svi imaju istu demo lozinku. */
export const DEMO_USERS: DemoUser[] = [
  { key: 'admin', local: 'admin', displayName: 'Nikola Radić', role: 'tenant-admin', scope: 'tenant', roleLabel: 'Administrator stanara', note: 'korisnici, uloge, sve postavke, revizija' },
  { key: 'office', local: 'ured', displayName: 'Ana Kovačević', role: 'project-office', scope: 'tenant', roleLabel: 'Voditeljica ureda za projekte', note: 'radar, odluke go/no-go, prijave, svi projekti, revizija – glavni račun za demonstraciju' },
  { key: 'pm', local: 'voditelj', displayName: 'doc. dr. sc. Petra Horvat', role: 'project-manager', scope: 'project', roleLabel: 'Voditeljica projekta – samo BLUESENSE; voditeljica prijave AQUAREST', note: 'vidi samo BLUESENSE i svoju prijavu AQUAREST; struktura, tim, odobrava timesheetove (ne vlastite ni one koje je sama predala)' },
  { key: 'pm2', local: 'voditelj2', displayName: 'Josip Barić', role: 'project-manager', scope: 'project', roleLabel: 'Voditelj projekta – samo ZELENI-LAB', note: 'vidi samo ZELENI-LAB' },
  { key: 'member', local: 'clan', displayName: 'Luka Novak', role: 'team-member', scope: 'project', roleLabel: 'Član tima – samo BLUESENSE', note: 'vlastiti timesheetovi (jedan čeka odobrenje); ne vidi plaće ni povjerljive dokumente' },
  { key: 'finance', local: 'financije', displayName: 'Maja Jurić', role: 'finance', scope: 'tenant', roleLabel: 'Financije / računovodstvo', note: 'svi projekti: troškovi s dokazima, plaće u timovima, ZNS' },
  { key: 'board', local: 'uprava', displayName: 'prof. dr. sc. Tomislav Perić', role: 'reader', scope: 'tenant', roleLabel: 'Uprava (samo čitanje)', note: 'pregled projekata i financija' },
];

export const demoEmail = (local: string, slug: string): string => `${local}@${slug}.local`;
export const DEMO_TENANT_NAME = 'Pokazno sveučilište';
export const DEMO_DEFAULT_PASSWORD = 'Plavi-Jadran-2026';
/** WP1.16b: polazna mjera (sati po ZNS-u prije ArQusa) i prijavljeni sati pripreme ZNS-a 1 ZELENI-LAB → ušteda 40 %. */
export const DEMO_BASELINE_HOURS = 30;
export const DEMO_PREPARATION_HOURS = 18;

type Row = { id: string } & Record<string, unknown>;
type Api = DemoApi;
interface Wp { id: string; start: number; end: number }

const pad = (n: number): string => String(n).padStart(2, '0');
/** Prvi dan mjeseca pomaknut za `offset` mjeseci od tekućeg (`todayIso` – današnji dan institucije). */
const firstOfMonth = (todayIso: string, offset: number): string => addMonths(`${todayIso.slice(0, 7)}-01`, offset);
/** Mjesec (GGGG-MM) n-tog mjeseca projekta (1 = mjesec početka). */
const projectMonth = (start: string, n: number): string => addMonths(start, n - 1).slice(0, 7);
const dayOf = (start: string, n: number, day: number): string => `${projectMonth(start, n)}-${pad(Math.min(day, daysInMonth(projectMonth(start, n))))}`;
const deadline = (date: string, time = '15:00:00'): string => `${date}T${time}Z`;
/** WP1.19: revizija je obavezna pri spremanju proračuna i timesheeta – seeder je čita kao sučelje (GET pa PUT). */
const revisionOf = async (api: DemoApi, path: string): Promise<number> => (await api.get<{ revision: number }>(path)).revision;
const eur = (cents: number): string => `${(cents / 100).toLocaleString('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;

/** Raspored rada: radni dani, minute po uzorku, radni paketi koji su u tom mjesecu aktivni. Deterministično (isti podaci pri svakom pokretanju). */
function timesheetEntries(month: string, projectMonthNo: number, pattern: number[], wps: Wp[], seed: number, untilDay?: number) {
  const active = wps.filter((w) => projectMonthNo >= w.start && projectMonthNo <= w.end);
  const out: { day: number; minutes: number; workPackageId: string | null }[] = [];
  const last = Math.min(daysInMonth(month), untilDay ?? 31);
  for (let d = 1; d <= last; d++) {
    const wd = new Date(`${month}-${pad(d)}T00:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const minutes = pattern[(d + seed) % pattern.length]!;
    if (!minutes) continue;
    out.push({ day: d, minutes, workPackageId: active.length ? active[(d * 7 + seed) % active.length]!.id : null });
  }
  return out;
}

export interface DemoContext { base: string; slug: string; password: string; today: Date; log: (m: string) => void }
export interface DemoSummary { projects: string[]; proposals: string[]; calls: number; organisations: number; timesheets: number; expenses: number; documents: number; claims: number }

export async function buildDemo(ctx: DemoContext): Promise<DemoSummary> {
  const { base, slug, password, today, log } = ctx;
  const sum: DemoSummary = { projects: [], proposals: [], calls: 0, organisations: 0, timesheets: 0, expenses: 0, documents: 0, claims: 0 };
  // WP1.14b: „danas” demo institucije je kalendarski dan u Europe/Zagreb (kao u aplikaciji), ne UTC – oko ponoći isti dan.
  const todayIso = todayIn(DEFAULT_TIME_ZONE, today);
  const inDays = (n: number): string => addDays(todayIso, n);

  // ---------- korisnici ----------
  const admin = await DemoApi.login(base, slug, demoEmail('admin', slug), password);
  const userIds: Record<string, string> = {};
  const existing = await admin.get<{ id: string; email: string }[]>('/users');
  userIds.admin = existing.find((u) => u.email === demoEmail('admin', slug))!.id;
  for (const u of DEMO_USERS.filter((x) => x.key !== 'admin')) {
    // Voditelji i član tima nemaju ulogu na razini institucije: pristup dobivaju na projektu (imenovanjem za voditelja, dodavanjem u tim).
    const r = await admin.post<Row>('/users', { email: demoEmail(u.local, slug), displayName: u.displayName, password, roleCodes: u.scope === 'tenant' ? [u.role] : [] });
    userIds[u.key] = r.id;
  }
  const as = async (key: string): Promise<Api> => DemoApi.login(base, slug, demoEmail(DEMO_USERS.find((u) => u.key === key)!.local, slug), password);
  const office = await as('office'); const pm = await as('pm'); const pm2 = await as('pm2'); const member = await as('member'); const finance = await as('finance');
  log(`korisnici: ${DEMO_USERS.length}`);

  const upload = async (api: Api, entityType: string, entityId: string, fileName: string, title: string, kind: string, lines: string[], confidentiality = 'internal') => {
    await api.upload({ entityType, entityId, title, kind, confidentiality }, fileName, demoPdf(title, lines));
    sum.documents++;
  };

  // ---------- radar poziva ----------
  const npooStart = firstOfMonth(todayIso, -12); // NPOO projekt u 13. mjesecu: RP1 (mj. 1–6) isplaćen, RP2 (mj. 7–12) završio prošli mjesec, ZNS još nije predan
  const heStart = firstOfMonth(todayIso, -10); // HE projekt: u 11. mjesecu provedbe
  const npooPackageId = 'npoo-poziv-zdp-2025';
  const pkgRow = await office.post<Row>('/programme-packages', {
    meta: { id: npooPackageId, extends: 'npoo-2021-2026', programme: 'NPOO – Zeleni i digitalni prijelaz visokih učilišta (pokazni poziv)', funder: 'Ministarstvo znanosti, obrazovanja i mladih', version: '1.0.0', validFrom: addMonths(npooStart, -14), language: 'hr' },
    actionTypes: [], costCategories: [], reporting: { periodMonths: 6, submissionDeadlineDays: 30 },
  });
  await office.post(`/programme-packages/${pkgRow.id}/publish`);

  const calls: Record<string, Row> = {};
  const addCall = async (key: string, body: Record<string, unknown>, assessment?: [number, number, number, number, string], decision?: Record<string, unknown>) => {
    const c = await office.post<Row>('/calls', { ...body, tags: body.tags ?? [] });
    if (assessment) await office.put(`/calls/${c.id}/assessment`, { scores: { strategic: assessment[0], capacity: assessment[1], probability: assessment[2], financial: assessment[3] }, comment: assessment[4] });
    if (decision) await office.put(`/calls/${c.id}/decision`, decision);
    calls[key] = c; sum.calls++;
  };
  await addCall('npoo', {
    code: 'NPOO.C3.2.R3-I2.07', title: 'Zeleni i digitalni prijelaz visokih učilišta – istraživačka infrastruktura', programme: 'NPOO', funder: 'Ministarstvo znanosti, obrazovanja i mladih',
    summary: 'Pokazni poziv (izmišljeni podaci). Otvoreni poziv do iskorištenja sredstava: oprema i istraživački laboratoriji za zelenu i digitalnu tranziciju. Izvještavanje svakih 6 mjeseci (paket po pozivu).',
    packageId: npooPackageId, actionTypes: ['BESPOVRATNA'], budget: 2_000_000_000, expectedGrants: 25, opensAt: addMonths(npooStart, -13),
    deadlines: [{ kind: 'submission', at: deadline(inDays(70), '23:59:00'), label: 'Krajnji rok (do iskorištenja sredstava)' }], tags: ['oprema', 'energetska učinkovitost'],
  }, [4, 4, 4, 5, 'Odlično se uklapa u strategiju istraživanja; laboratorij za zgradarstvo već postoji.'], { decision: 'go', rationale: 'Strateški prioritet fakulteta; tim i partner spremni.', ownerUserId: userIds.pm2 });
  await addCall('heA', {
    code: 'HORIZON-CL6-2027-ZEROPOLLUTION-02-04', title: 'Pametno praćenje i obnova obalnih ekosustava', programme: 'Horizon Europe', funder: 'Europska komisija',
    summary: 'Pokazni poziv (izmišljeni podaci). Senzorske mreže, digitalni blizanci i rješenja temeljena na prirodi za obnovu obalnih staništa.',
    packageId: 'horizon-europe-2021-2027', actionTypes: ['RIA'], budget: 1_500_000_000, expectedGrants: 3, opensAt: inDays(-30),
    deadlines: [{ kind: 'info_day', at: deadline(inDays(9), '09:00:00'), label: 'Info dan (online)' }, { kind: 'submission', at: deadline(inDays(41)), label: 'Rok za predaju' }], tags: ['more', 'senzori', 'umjetna inteligencija'],
  }, [5, 4, 3, 4, 'Nastavak projekta BLUESENSE; konzorcij većinom postoji.'], { decision: 'go', rationale: 'Izravno nastavlja BLUESENSE, jak konzorcij.', internalDeadline: inDays(27), ownerUserId: userIds.pm });
  await addCall('heB', {
    code: 'HORIZON-CL5-2027-D3-03-11', title: 'Integracija obnovljivih izvora energije u lučku infrastrukturu', programme: 'Horizon Europe', funder: 'Europska komisija',
    summary: 'Pokazni poziv (izmišljeni podaci). Inovacijske akcije za luke s nultom neto emisijom.',
    packageId: 'horizon-europe-2021-2027', actionTypes: ['IA'], budget: 2_400_000_000, expectedGrants: 4, opensAt: inDays(-10),
    deadlines: [{ kind: 'submission', at: deadline(inDays(88)), label: 'Rok za predaju' }], tags: ['energija', 'luke'],
  }, [3, 3, 3, 4, 'Zanimljivo, ali treba industrijskog partnera.'], { decision: 'watch', internalDeadline: inDays(50), ownerUserId: userIds.office });
  await addCall('interreg', {
    code: 'ITHR-2027-SO2.4-03', title: 'Prilagodba klimatskim promjenama u obalnim područjima', programme: 'Interreg VI-A Italija – Hrvatska', funder: 'Zajedničko tajništvo programa',
    summary: 'Pokazni poziv (izmišljeni podaci).', actionTypes: [], budget: 800_000_000, opensAt: inDays(-45),
    deadlines: [{ kind: 'submission', at: deadline(inDays(19)), label: 'Rok za predaju' }], tags: ['klima'],
  }, [2, 2, 3, 2, 'Nemamo talijanskog partnera, a tim je zauzet prijavom AQUAREST.'], { decision: 'no_go', rationale: 'Bez partnera s talijanske strane i bez slobodnog kapaciteta do roka.' });
  await addCall('hrzz', {
    code: 'IP-2027-02', title: 'Istraživački projekti', programme: 'Hrvatska zaklada za znanost', funder: 'Hrvatska zaklada za znanost',
    summary: 'Pokazni poziv (izmišljeni podaci).', actionTypes: [], opensAt: inDays(-14),
    deadlines: [{ kind: 'submission', at: deadline(inDays(56)), label: 'Rok za predaju' }], tags: ['temeljna istraživanja'],
  }, undefined, { decision: 'watch', internalDeadline: inDays(42), ownerUserId: userIds.office });
  await addCall('erasmus', {
    code: 'ERASMUS-EDU-2026-PI-ALL-INNO', title: 'Partnerstva za izvrsnost i inovacije u visokom obrazovanju', programme: 'Erasmus+', funder: 'Europska komisija',
    summary: 'Pokazni poziv (izmišljeni podaci). Rok je prošao.', actionTypes: [], opensAt: inDays(-120),
    deadlines: [{ kind: 'submission', at: deadline(inDays(-25)), label: 'Rok za predaju' }], tags: ['obrazovanje'],
  });
  log(`radar: ${sum.calls} poziva, paket po pozivu ${npooPackageId}`);

  // ---------- organizacije ----------
  const orgs: Record<string, Row> = {};
  const addOrg = async (key: string, body: Record<string, unknown>) => { orgs[key] = await office.post<Row>('/organisations', body); sum.organisations++; };
  await addOrg('de', { name: 'Hochschule Nordwald', shortName: 'HSNW', country: 'DE', type: 'university', nonProfit: true });
  await addOrg('it', { name: 'Politecnico di Valmarina', shortName: 'POLIVAL', country: 'IT', type: 'university', nonProfit: true });
  await addOrg('es', { name: 'Fundación Tecnológica Montesol', shortName: 'FTM', country: 'ES', type: 'institute', nonProfit: true });
  await addOrg('nl', { name: 'Polder Analytics B.V.', shortName: 'PolderAI', country: 'NL', type: 'sme' });
  await addOrg('si', { name: 'Alpinus Data d.o.o.', shortName: 'Alpinus', country: 'SI', type: 'sme' });
  await addOrg('hr', { name: 'Razvojna agencija Velebitsko primorje', shortName: 'RAVP', country: 'HR', type: 'public_body', nonProfit: true });

  // ---------- NPOO: poziv → go → prijava → predaja → financirana → ugovorena → projekt ----------
  const npooProposal = await office.post<Row>(`/calls/${calls.npoo!.id}/proposal`, {
    acronym: 'ZELENI-LAB', title: 'Zeleni istraživački laboratorij za energetsku učinkovitost zgrada', durationMonths: 24, leadUserId: userIds.pm2,
  });
  const npooPid = npooProposal.id;
  // Vlastita organizacija nastaje s prvom prijavom – dopunjujemo je podacima institucije.
  const self = (await office.get<Row[]>('/organisations')).find((o) => o.isSelf)!;
  await office.patch(`/organisations/${self.id}`, { name: DEMO_TENANT_NAME, shortName: 'PSU', type: 'university', nonProfit: true });
  sum.organisations++;
  const p = await office.post<{ members: Row[] }>(`/proposals/${npooPid}/members`, { organisationId: orgs.hr!.id, role: 'partner', confirmed: true });
  const nSelf = p.members.find((m) => m.isSelf)!.id; const nAgency = p.members.find((m) => !m.isSelf)!.id;
  for (const w of [
    { title: 'Upravljanje projektom', leadMemberId: nSelf, startMonth: 1, endMonth: 24, personMonths: 6 },
    { title: 'Nabava i postavljanje opreme laboratorija', leadMemberId: nSelf, startMonth: 1, endMonth: 12, personMonths: 10 },
    { title: 'Istraživanje i pilot-mjerenja na zgradama', leadMemberId: nSelf, startMonth: 6, endMonth: 24, personMonths: 18 },
    { title: 'Promidžba i prijenos znanja', leadMemberId: nAgency, startMonth: 1, endMonth: 24, personMonths: 4 },
  ]) await office.post(`/proposals/${npooPid}/work-packages`, w);
  await office.put(`/proposals/${npooPid}/budget/lines`, { revision: await revisionOf(office, `/proposals/${npooPid}`), lines: [
    { memberId: nSelf, categoryCode: 'OS', amount: 9_600_000 }, { memberId: nSelf, categoryCode: 'VU', amount: 4_500_000 }, { memberId: nSelf, categoryCode: 'OP', amount: 12_000_000 },
    { memberId: nSelf, categoryCode: 'PUT', amount: 600_000 }, { memberId: nSelf, categoryCode: 'UP', amount: 1_800_000 }, { memberId: nSelf, categoryCode: 'PV', amount: 700_000 },
    { memberId: nAgency, categoryCode: 'OS', amount: 2_400_000 }, { memberId: nAgency, categoryCode: 'VU', amount: 900_000 }, { memberId: nAgency, categoryCode: 'PV', amount: 800_000 },
  ] });
  await upload(office, 'proposal', npooPid, 'ZELENI-LAB-obrazac-prijave.pdf', 'Obrazac prijave ZELENI-LAB', 'proposal', ['Prijavitelj: Pokazno sveučilište', 'Partner: Razvojna agencija Velebitsko primorje', 'Trajanje: 24 mjeseca']);
  await office.post(`/proposals/${npooPid}/budget/lock`);
  await office.post(`/proposals/${npooPid}/transition`, { to: 'preparation' });
  await office.post(`/proposals/${npooPid}/transition`, { to: 'internal_review' });
  await office.post(`/proposals/${npooPid}/submit`, { portal: 'eNPOO (fondovieu.gov.hr)', reference: 'ZDP-2025-0147', submittedAt: `${addMonths(npooStart, -4)}T10:30:00Z` });
  await office.post(`/proposals/${npooPid}/transition`, { to: 'in_evaluation' });
  await office.post(`/proposals/${npooPid}/outcome`, { result: 'funded', score: '87/100', note: 'Odluka o financiranju – puni iznos.' });
  const contracted = await office.post<{ projectId: string }>(`/proposals/${npooPid}/contract`, { contractNo: 'NPOO.C3.2.R3-I2.07.0147', startDate: npooStart });
  const npoo = contracted.projectId;
  sum.proposals.push('ZELENI-LAB (ugovorena)'); sum.projects.push('ZELENI-LAB');
  log('NPOO: prijava ZELENI-LAB predana, financirana i ugovorena');

  // Struktura projekta (radni paketi kopirani iz prijave).
  const nStruct = await pm2.get<{ workPackages: Row[] }>(`/projects/${npoo}/structure`);
  const nWp = nStruct.workPackages.map((w) => ({ id: w.id, start: w.startMonth as number, end: w.endMonth as number }));
  const nPartners = (await pm2.get<{ partners: Row[] }>(`/projects/${npoo}`)).partners;
  const nSelfPartner = nPartners.find((x) => x.isSelf)!.id; const nAgencyPartner = nPartners.find((x) => !x.isSelf)!.id;
  for (const [i, t] of [[0, 'Koordinacija i izvještavanje prema posredničkom tijelu'], [1, 'Javna nabava opreme'], [1, 'Postavljanje i puštanje opreme u rad'], [2, 'Mjerenja na tri pilot-zgrade'], [3, 'Info-dani i radionice za lokalnu zajednicu']] as const) {
    const w = nStruct.workPackages[i]!;
    await pm2.post(`/projects/${npoo}/work-packages/${w.id}/tasks`, { title: t, startMonth: w.startMonth, endMonth: w.endMonth, leadPartnerId: i === 3 ? nAgencyPartner : nSelfPartner });
  }
  await pm2.post(`/projects/${npoo}/work-packages/${nStruct.workPackages[1]!.id}/deliverables`, { title: 'Oprema laboratorija nabavljena i u funkciji', type: 'POK', dissemination: 'JAV', dueMonth: 9 });
  await pm2.post(`/projects/${npoo}/work-packages/${nStruct.workPackages[2]!.id}/deliverables`, { title: 'Izvještaj o pilot-mjerenjima', type: 'ISP', dissemination: 'JAV', dueMonth: 18 });
  await pm2.post(`/projects/${npoo}/milestones`, { title: 'Laboratorij otvoren za korisnike', dueMonth: 12, verification: 'Zapisnik o primopredaji i fotodokumentacija' });
  await pm2.post(`/projects/${npoo}/risks`, { description: 'Žalba u postupku javne nabave opreme odgađa isporuku', likelihood: 2, impact: 3, mitigation: 'Tehničke specifikacije pregledala pravna služba; rezervni rok u planu.', ownerUserId: userIds.pm2 });
  // Tim s godišnjim troškom (plaće vidi i unosi samo uloga s pristupom podacima o osoblju).
  const josip = (await finance.post<Row>(`/projects/${npoo}/team`, { fullName: 'Josip Barić', userId: userIds.pm2, role: 'voditelj projekta', annualCost: 4_300_000 })).id;
  const marina = (await finance.post<Row>(`/projects/${npoo}/team`, { fullName: 'Marina Šimić', role: 'istraživačica', annualCost: 3_600_000 })).id;
  await upload(office, 'project', npoo, 'ZELENI-LAB-ugovor.pdf', 'Ugovor o dodjeli bespovratnih sredstava', 'contract', ['Broj ugovora: NPOO.C3.2.R3-I2.07.0147', `Početak provedbe: ${npooStart}`, 'Trajanje: 24 mjeseca'], 'confidential');
  await office.post(`/projects/${npoo}/transition`, { to: 'active' });

  // Timesheetovi NPOO: mj. 1–12 (RP1 i RP2). Josipov timesheet za 12. mjesec čeka odobrenje ureda (otvorena stavka ZNS-a 2).
  // Marina u 12. mjesecu radi i na BLUESENSE (portfelj: dan iznad 8 h kroz dva projekta).
  const timesheet = async (writer: Api, approver: Api, projectId: string, memberId: string, month: string, entries: unknown[], approve = true) => {
    const url = `/projects/${projectId}/team/${memberId}/timesheets/${month}`;
    await writer.put(url, { revision: await revisionOf(writer, url), entries });
    await writer.post(`/projects/${projectId}/team/${memberId}/timesheets/${month}/submit`);
    if (approve) await approver.post(`/projects/${projectId}/team/${memberId}/timesheets/${month}/approve`);
    sum.timesheets++;
  };
  let marinaLast: { day: number; minutes: number }[] = [];
  for (let m = 1; m <= 12; m++) {
    const month = projectMonth(npooStart, m);
    const mEntries = timesheetEntries(month, m, [360, 420, 300, 480, 240, 360], nWp, 3);
    await timesheet(pm2, office, npoo, josip, month, timesheetEntries(month, m, [120, 180, 90, 240, 120], nWp, 1), m < 12);
    // WP1.14b – četiri oka: voditelj unosi i predaje sate člana bez korisničkog računa, ured za projekte ih odobrava.
    await timesheet(pm2, office, npoo, marina, month, mEntries);
    if (m === 12) marinaLast = mEntries;
  }
  // Ručni troškovi RP1 s dokazima (trošak i dokaz unose financije).
  const expense = async (projectId: string, body: Record<string, unknown>, evidence?: { api: Api; file: string }) => {
    const e = await finance.post<Row>(`/projects/${projectId}/expenses`, body);
    sum.expenses++;
    if (evidence) await upload(evidence.api, 'expense', e.id, evidence.file, `Dokaz ${String(body.evidenceRef ?? '')}`.trim(), 'evidence', [String(body.description), `Dobavljač: ${String(body.supplier ?? '-')}`, `Datum: ${String(body.date)}`, `Iznos: ${eur(body.amount as number)}`]);
    return e;
  };
  const rp1 = [
    // Glavna oprema laboratorija (120.000 EUR) još nije nabavljena – žalba u javnoj nabavi; zato potrošnja kasni za vremenom (portfelj).
    { categoryCode: 'OP', date: dayOf(npooStart, 3, 12), description: 'Prijenosni mjerači temperature i vlage (sitna oprema)', supplier: 'Mjerna tehnika d.o.o.', amount: 320_000, evidenceRef: 'R-412/2026' },
    { categoryCode: 'VU', date: dayOf(npooStart, 4, 8), description: 'Elaborat energetskog pregleda pilot-zgrade', supplier: 'Energo-plan d.o.o.', amount: 1_180_000, evidenceRef: 'R-88/2026' },
    { categoryCode: 'PUT', date: dayOf(npooStart, 5, 21), description: 'Studijsko putovanje – posjet laboratoriju za zgradarstvo', supplier: 'Putnički nalog 14/2026', amount: 86_500, evidenceRef: 'PN-14/2026' },
    { categoryCode: 'PV', date: dayOf(npooStart, 2, 17), description: 'Vizualni identitet i informativne ploče projekta', supplier: 'Studio Kvadrat d.o.o.', amount: 245_000, evidenceRef: 'R-31/2026' },
  ];
  const rp1Ids: string[] = [];
  for (const e of rp1) rp1Ids.push((await expense(npoo, e, { api: finance, file: `${e.evidenceRef.replace(/[^A-Za-z0-9-]/g, '-')}.pdf` })).id);
  // ZNS za RP1 (razdoblje je završilo): predaja → odluka po trošku (elaborat umanjen, putovanje odbijeno) → isplaćen priznati iznos.
  const claim1 = await finance.post<Row>(`/projects/${npoo}/claims`, { period: 1 });
  // WP1.16b: financije pri predaji upisuju sate utrošene na pripremu (osnova izvještaja „Ušteda na ZNS-u” na portfelju).
  await finance.post(`/projects/${npoo}/claims/${claim1.id}/submit`, { preparationHours: DEMO_PREPARATION_HOURS });
  const reducedTo = 1_050_000;
  const decided = await finance.post<{ approved: number; requested: number }>(`/projects/${npoo}/claims/${claim1.id}/decision`, {
    decision: 'decided', decisionDate: todayIso,
    expenses: [
      { id: rp1Ids[1], recognised: reducedTo, reason: 'Priznato do iznosa iz ugovora s izvršiteljem (10.500,00 EUR); razlika je dodatni posao izvan plana nabave.' },
      { id: rp1Ids[2], recognised: 0, reason: 'Nedostaje izvješće sa studijskog putovanja.' },
    ],
    note: 'Odluka posredničkog tijela: djelomično odobren – jedan trošak umanjen, jedan nije priznat.',
  });
  await finance.post(`/projects/${npoo}/claims/${claim1.id}/payment`, { paidAmount: decided.approved, paidAt: todayIso });
  await upload(pm2, 'claim', claim1.id, 'ZNS-1-odluka.pdf', 'Odluka posredničkog tijela o ZNS-u 1', 'correspondence', [`Zatraženo: ${eur(decided.requested)}`, `Odobreno: ${eur(decided.approved)}`, `Elaborat energetskog pregleda umanjen na ${eur(reducedTo)}`, 'Nepriznat trošak: studijsko putovanje (865,00 EUR)']);
  // WP1.16b: račun za RP1 stigao i evidentiran nakon predaje ZNS-a 1 – nepredan trošak iz ranijeg razdoblja (portfelj ga broji,
  // nacrt ZNS-a 2 ga nudi kao „trošak iz ranijih razdoblja” koji priprematelj izričito uključuje).
  await expense(npoo, { categoryCode: 'VU', date: dayOf(npooStart, 6, 18), description: 'Najam termovizijske kamere za pilot-mjerenje', supplier: 'Termo-vizija d.o.o.', amount: 64_000, evidenceRef: 'R-598/2026' }, { api: finance, file: 'R-598-2026.pdf' });
  // Polazna mjera institucije (ured za projekte): koliko je jedan ZNS trajao prije ArQusa.
  await office.put('/portfolio/claim-savings/baseline', { hours: DEMO_BASELINE_HOURS });
  // RP2 završio prošli mjesec: dva troška (brošure bez dokaza) i nacrt ZNS-a s otvorenim stavkama (timesheet čeka odobrenje, trošak bez dokaza).
  await expense(npoo, { categoryCode: 'VU', date: dayOf(npooStart, 7, 15), description: 'Kalibracija mjernih senzora', supplier: 'Mjerna tehnika d.o.o.', amount: 320_000, evidenceRef: 'R-655/2026' }, { api: finance, file: 'R-655-2026.pdf' });
  await expense(npoo, { categoryCode: 'PV', date: dayOf(npooStart, 8, 6), description: 'Tisak brošura za info-dan', supplier: 'Tiskara Primorje d.o.o.', amount: 118_000, evidenceRef: 'R-702/2026' });
  await finance.post(`/projects/${npoo}/claims`, { period: 2 });
  sum.claims += 2;
  log('NPOO: projekt aktivan, ZNS 1 djelomično odobren i isplaćen, ZNS 2 u nacrtu s otvorenim stavkama');

  // ---------- Horizon Europe: projekt u provedbi (izravni unos – projekt prije uvođenja sustava) ----------
  const he = await office.post<{ id: string; partners: Row[] }>('/projects', {
    acronym: 'BLUESENSE', title: 'Pametni senzori i umjetna inteligencija za praćenje kakvoće obalnog mora', packageId: 'horizon-europe-2021-2027', actionType: 'RIA', role: 'coordinator',
    contractNo: 'GA-DEMO-2025-0117', startDate: heStart, durationMonths: 36, managerUserId: userIds.pm,
    partners: [{ organisationId: orgs.de!.id, role: 'partner' }, { organisationId: orgs.it!.id, role: 'partner' }, { organisationId: orgs.es!.id, role: 'partner' }, { organisationId: orgs.nl!.id, role: 'partner' }],
  });
  const heId = he.id;
  const hp = (org: string) => he.partners.find((x) => x.organisationId === orgs[org]!.id)!.id;
  const hSelf = he.partners.find((x) => x.isSelf)!.id;
  sum.projects.push('BLUESENSE');
  const wpDefs = [
    { title: 'Upravljanje i koordinacija', leadPartnerId: hSelf, startMonth: 1, endMonth: 36, objectives: 'Koordinacija konzorcija, izvještavanje prema Europskoj komisiji, upravljanje kvalitetom i rizicima.' },
    { title: 'Senzorska mreža i postavljanje', leadPartnerId: hp('de'), startMonth: 1, endMonth: 24, objectives: 'Razvoj i testiranje senzorskih plutača za mjerenje temperature, saliniteta, klorofila i mutnoće.' },
    { title: 'Podatkovna platforma i modeli umjetne inteligencije', leadPartnerId: hp('nl'), startMonth: 4, endMonth: 30, objectives: 'Otvorena podatkovna platforma i modeli za predviđanje cvjetanja algi.' },
    { title: 'Pilot-lokacije i validacija', leadPartnerId: hp('it'), startMonth: 10, endMonth: 33, objectives: 'Validacija na tri pilot-lokacije na Jadranu i Mediteranu.' },
    { title: 'Diseminacija, komunikacija i iskorištavanje', leadPartnerId: hp('es'), startMonth: 1, endMonth: 36, objectives: 'Komunikacija s javnošću, otvorena znanost i plan iskorištavanja rezultata.' },
  ];
  const hWps: (Row & { startMonth: number; endMonth: number })[] = [];
  for (const w of wpDefs) hWps.push(await pm.post(`/projects/${heId}/work-packages`, w) as Row & { startMonth: number; endMonth: number });
  const curMonth = 11; // tekući mjesec provedbe (heStart = prije 10 mjeseci)
  const taskDefs: [number, string, number, number, string][] = [
    [0, 'Upravljanje konzorcijem i komunikacija s EK', 1, 36, 'in_progress'], [0, 'Upravljanje kvalitetom i rizicima', 1, 36, 'in_progress'],
    [1, 'Specifikacija senzora i komunikacijskog modula', 1, 6, 'done'], [1, 'Izrada i laboratorijsko testiranje prototipa', 4, 12, 'in_progress'], [1, 'Postavljanje mreže na pilot-lokacije', 13, 24, 'planned'],
    [2, 'Arhitektura podatkovne platforme', 4, 9, 'in_progress'], [2, 'Modeli predviđanja cvjetanja algi', 10, 30, 'planned'],
    [3, 'Plan validacije i odabir lokacija', 10, 14, 'in_progress'], [3, 'Terenska validacija', 15, 33, 'planned'],
    [4, 'Web stranica i društvene mreže', 1, 36, 'in_progress'], [4, 'Plan iskorištavanja rezultata', 6, 36, 'in_progress'],
  ];
  for (const [i, title, s, e, status] of taskDefs) {
    const t = await pm.post<Row>(`/projects/${heId}/work-packages/${hWps[i]!.id}/tasks`, { title, startMonth: s, endMonth: e });
    if (status !== 'planned') await pm.patch(`/projects/${heId}/tasks/${t.id}`, { status });
  }
  const delivDefs: [number, string, string, string, number, string][] = [
    [0, 'Plan upravljanja projektom', 'R', 'PU', 3, 'accepted'], [0, 'Plan upravljanja podacima', 'DMP', 'PU', 6, 'accepted'],
    [1, 'Specifikacija senzorske mreže', 'R', 'SEN', 6, 'submitted'], [1, 'Prototip senzorske plutače', 'DEM', 'PU', 12, 'in_progress'],
    [2, 'Arhitektura podatkovne platforme', 'R', 'PU', 9, 'in_progress'], [2, 'Otvoreni skup podataka s pilot-lokacija', 'DATA', 'PU', 24, 'planned'],
    [3, 'Plan pilot-validacije', 'R', 'SEN', 14, 'planned'],
    [4, 'Web stranica i plan komunikacije', 'DEC', 'PU', 3, 'accepted'],
  ];
  let d11 = '';
  for (const [i, title, type, dissemination, dueMonth, status] of delivDefs) {
    const d = await pm.post<Row>(`/projects/${heId}/work-packages/${hWps[i]!.id}/deliverables`, { title, type, dissemination, dueMonth, leadPartnerId: hWps[i]!.leadPartnerId });
    if (!d11) d11 = d.id;
    if (status === 'accepted') await pm.patch(`/projects/${heId}/deliverables/${d.id}`, { status: 'submitted' });
    if (status !== 'planned') await pm.patch(`/projects/${heId}/deliverables/${d.id}`, { status });
  }
  for (const [title, dueMonth, verification, status] of [
    ['Konzorcij i alati za suradnju uspostavljeni', 3, 'Održan početni sastanak; zajednički repozitorij u uporabi', 'achieved'],
    ['Prototip senzora testiran u laboratoriju', 9, 'Izvještaj o laboratorijskom testu', 'achieved'],
    ['Senzorska mreža postavljena na pilot-lokacije', 18, 'Podaci s tri lokacije u platformi', 'planned'],
    ['Validirani modeli predviđanja', 30, 'Točnost modela ≥ 80 % na testnom skupu', 'planned'],
  ] as const) {
    const m = await pm.post<Row>(`/projects/${heId}/milestones`, { title, dueMonth, verification });
    if (status !== 'planned') await pm.patch(`/projects/${heId}/milestones/${m.id}`, { status });
  }
  for (const r of [
    { description: 'Kašnjenje isporuke elektroničkih komponenti senzora', likelihood: 3, impact: 2, mitigation: 'Dva dobavljača, narudžba ključnih komponenti unaprijed.', ownerUserId: userIds.pm },
    { description: 'Odlazak ključnog istraživača iz konzorcija', likelihood: 2, impact: 3, mitigation: 'Dokumentiranje znanja, zamjene po partneru.', ownerUserId: userIds.office },
    { description: 'Nepovoljni vremenski uvjeti odgađaju terenska mjerenja', likelihood: 2, impact: 2, mitigation: 'Terenski rad planiran u dva sezonska prozora.', ownerUserId: userIds.pm },
    { description: 'Nedovoljna kvaliteta podataka za treniranje modela', likelihood: 1, impact: 3, mitigation: 'Povijesni podaci partnera i sintetički skupovi.', status: 'mitigated' },
  ]) {
    const { status, ...body } = r as typeof r & { status?: string };
    const row = await pm.post<Row>(`/projects/${heId}/risks`, body);
    if (status) await pm.patch(`/projects/${heId}/risks/${row.id}`, { status });
  }
  await office.put(`/projects/${heId}/budget/lines`, { revision: await revisionOf(office, `/projects/${heId}/budget`), lines: [
    ...[['A.1', 42_000_000], ['B', 1_500_000], ['C.1', 3_600_000], ['C.2', 6_500_000], ['C.3', 2_800_000]].map(([c, a]) => ({ partnerId: hSelf, categoryCode: c, amount: a })),
    ...[['A.1', 38_000_000], ['C.1', 2_400_000], ['C.2', 9_000_000], ['C.3', 1_800_000]].map(([c, a]) => ({ partnerId: hp('de'), categoryCode: c, amount: a })),
    ...[['A.1', 29_000_000], ['C.1', 2_200_000], ['C.3', 2_500_000]].map(([c, a]) => ({ partnerId: hp('it'), categoryCode: c, amount: a })),
    ...[['A.1', 21_000_000], ['C.1', 1_800_000], ['C.3', 3_000_000]].map(([c, a]) => ({ partnerId: hp('es'), categoryCode: c, amount: a })),
    ...[['A.1', 26_000_000], ['C.1', 1_200_000], ['C.3', 900_000]].map(([c, a]) => ({ partnerId: hp('nl'), categoryCode: c, amount: a })),
  ] });
  const petra = (await finance.post<Row>(`/projects/${heId}/team`, { fullName: 'Petra Horvat', userId: userIds.pm, role: 'voditeljica projekta', annualCost: 5_400_000 })).id;
  const luka = (await finance.post<Row>(`/projects/${heId}/team`, { fullName: 'Luka Novak', userId: userIds.member, role: 'asistent – istraživač', annualCost: 3_900_000 })).id;
  const ivana = (await finance.post<Row>(`/projects/${heId}/team`, { fullName: 'Ivana Marić', role: 'poslijedoktorandica', annualCost: 4_500_000 })).id;
  // Marina Šimić (ZELENI-LAB) od prošlog mjeseca pomaže i na mjerenjima BLUESENSE; bez korisničkog računa – portfelj je prepoznaje po imenu.
  const marinaHe = (await finance.post<Row>(`/projects/${heId}/team`, { fullName: 'Marina Šimić', role: 'istraživačica – terenska mjerenja', annualCost: 3_600_000 })).id;
  await upload(office, 'project', heId, 'BLUESENSE-grant-agreement.pdf', 'Ugovor o dodjeli (Grant Agreement)', 'contract', ['Projekt: BLUESENSE (RIA)', 'Broj ugovora: GA-DEMO-2025-0117', `Početak: ${heStart}, trajanje 36 mjeseci`], 'confidential');
  await upload(office, 'project', heId, 'BLUESENSE-sporazum-o-konzorciju.pdf', 'Sporazum o konzorciju', 'contract', ['Partneri: Pokazno sveučilište, Hochschule Nordwald, Politecnico di Valmarina, Fundación Tecnológica Montesol, Polder Analytics B.V.']);
  // Povjerljivo (WP1.14): vide ga ured, voditeljica i financije; član tima i uprava ga ne vide ni u popisu.
  await upload(finance, 'project', heId, 'BLUESENSE-place-tima.pdf', 'Odluka o plaćama projektnog tima', 'contract', ['Godišnji bruto trošak po članu tima', 'Petra Horvat · Luka Novak · Ivana Marić', 'Povjerljivo – osobni podaci'], 'confidential');
  await office.post(`/projects/${heId}/transition`, { to: 'active' });
  await upload(pm, 'deliverable', d11, 'D1.1-plan-upravljanja-projektom.pdf', 'D1.1 Plan upravljanja projektom', 'deliverable', ['Isporuka D1.1, mjesec 3', 'Status: prihvaćena'], 'public');

  // Timesheetovi HE: mj. 1 do prošlog mjeseca; Luka predaje sam, posljednji mjesec čeka odobrenje; tekući mjesec u nacrtu.
  const hWp = hWps.map((w) => ({ id: w.id, start: w.startMonth, end: w.endMonth }));
  for (let m = 1; m < curMonth; m++) {
    const month = projectMonth(heStart, m);
    await timesheet(pm, office, heId, petra, month, timesheetEntries(month, m, [180, 240, 120, 240, 300], hWp, 2));
    await timesheet(member, pm, heId, luka, month, timesheetEntries(month, m, [360, 420, 480, 300, 420, 360], hWp, 5), m < curMonth - 1);
    await timesheet(pm, office, heId, ivana, month, timesheetEntries(month, m, [300, 360, 240, 420], hWp, 7));
  }
  // Marina na BLUESENSE prošli mjesec: dva dana po 2 h; jedan od njih je dan s 8 h na ZELENI-LAB → 10 h kroz dva projekta (provjera dvostrukog financiranja).
  const fullDay = marinaLast.find((e) => e.minutes === 480) ?? marinaLast[0]!;
  const lightDay = marinaLast.find((e) => e.minutes <= 300 && e.day !== fullDay.day) ?? marinaLast.find((e) => e.day !== fullDay.day)!;
  await timesheet(pm, office, heId, marinaHe, projectMonth(heStart, curMonth - 1), [fullDay, lightDay].sort((a, b) => a.day - b.day).map((e) => ({ day: e.day, minutes: 120, workPackageId: hWps[3]!.id })));
  const thisMonth = projectMonth(heStart, curMonth);
  const draft = timesheetEntries(thisMonth, curMonth, [360, 420, 480, 300], hWp, 5, Number(todayIso.slice(8, 10)) - 1);
  if (draft.length) await member.put(`/projects/${heId}/team/${luka}/timesheets/${thisMonth}`, { revision: await revisionOf(member, `/projects/${heId}/team/${luka}/timesheets/${thisMonth}`), entries: draft });
  // Ručni troškovi koordinatora; jedan namjerno bez dokaza.
  const heExpenses = [
    { categoryCode: 'C.1', date: dayOf(heStart, 2, 14), description: 'Početni sastanak konzorcija – putni trošak (2 osobe)', supplier: 'Putnički nalozi 3/2026 i 4/2026', amount: 142_000, evidenceRef: 'PN-3-4/2026' },
    { categoryCode: 'B', date: dayOf(heStart, 3, 10), description: 'Izrada i održavanje web stranice projekta', supplier: 'Mreža digital d.o.o.', amount: 480_000, evidenceRef: 'R-2026-031' },
    { categoryCode: 'C.2', date: dayOf(heStart, 4, 22), description: 'Multiparametarska sonda za kakvoću mora (amortizacija)', supplier: 'OceanLab GmbH', amount: 1_280_000, evidenceRef: 'INV-77821' },
    { categoryCode: 'C.1', date: dayOf(heStart, 5, 9), description: 'Kotizacija – konferencija o oceanografskim senzorima', supplier: 'Organizator konferencije', amount: 65_000, evidenceRef: 'R-2026-118' },
    { categoryCode: 'C.3', date: dayOf(heStart, 6, 18), description: 'Potrošni materijal za kalibraciju senzora', supplier: 'Labo-opskrba d.o.o.', amount: 238_500, evidenceRef: 'R-2026-204' },
  ];
  for (const e of heExpenses) await expense(heId, { ...e, workPackageId: e.categoryCode === 'B' ? hWps[4]!.id : hWps[1]!.id }, { api: pm, file: `${e.evidenceRef.replace(/[^A-Za-z0-9-]/g, '-')}.pdf` });
  await expense(heId, { categoryCode: 'C.1', workPackageId: hWps[3]!.id, date: dayOf(heStart, 9, 25), description: 'Smještaj – terenska mjerenja na pilot-lokaciji', supplier: 'Hotel Lungomare', amount: 54_000 });
  // WP1.14b – revizija: financije usklađuju godišnji trošak (povišica od idućeg mjeseca; već odobreni troškovi osoblja ostaju).
  // Na stranici Revizija promjenu plaće s iznosima vide samo uloge s pristupom podacima o osoblju.
  await finance.patch(`/projects/${heId}/team/${ivana}`, { annualCost: 4_680_000 });
  log('HE: BLUESENSE aktivan, timesheetovi i troškovi uneseni');

  // ---------- prijava u pripremi (iz odluke go na radaru) ----------
  const aq = await office.post<Row>(`/calls/${calls.heA!.id}/proposal`, { acronym: 'AQUAREST', title: 'Obnova obalnih staništa uz podvodne senzorske mreže i digitalne blizance', durationMonths: 48, internalDeadline: inDays(27), leadUserId: userIds.pm });
  for (const [org, confirmed] of [['de', true], ['si', true], ['es', false], ['it', false]] as const) await office.post(`/proposals/${aq.id}/members`, { organisationId: orgs[org]!.id, role: 'partner', confirmed });
  const aqd = await office.get<{ members: Row[] }>(`/proposals/${aq.id}`);
  const mem = (org: string) => aqd.members.find((m) => m.organisationId === orgs[org]!.id)!.id;
  const aSelf = aqd.members.find((m) => m.isSelf)!.id;
  for (const w of [
    { title: 'Upravljanje projektom', leadMemberId: aSelf, startMonth: 1, endMonth: 48, personMonths: 14 },
    { title: 'Podvodne senzorske mreže', leadMemberId: mem('de'), startMonth: 1, endMonth: 30, personMonths: 40 },
    { title: 'Digitalni blizanac obalnog ekosustava', leadMemberId: mem('si'), startMonth: 6, endMonth: 42, personMonths: 36 },
    { title: 'Obnova staništa na pilot-lokacijama', leadMemberId: mem('es'), startMonth: 12, endMonth: 46, personMonths: 30 },
    { title: 'Diseminacija i iskorištavanje', leadMemberId: aSelf, startMonth: 1, endMonth: 48, personMonths: 10 },
  ]) await office.post(`/proposals/${aq.id}/work-packages`, w);
  // WP1.14b: voditeljica prijave (Petra, bez uloge institucije) sama unosi proračun i pokreće pripremu vlastite prijave.
  await pm.put(`/proposals/${aq.id}/budget/lines`, { revision: await revisionOf(pm, `/proposals/${aq.id}`), lines: [
    { memberId: aSelf, categoryCode: 'A.1', amount: 52_000_000 }, { memberId: aSelf, categoryCode: 'C.1', amount: 4_000_000 }, { memberId: aSelf, categoryCode: 'C.3', amount: 3_500_000 },
    { memberId: mem('de'), categoryCode: 'A.1', amount: 61_000_000 }, { memberId: mem('de'), categoryCode: 'C.2', amount: 12_000_000 },
  ] });
  await pm.post(`/proposals/${aq.id}/transition`, { to: 'preparation' });
  await upload(pm, 'proposal', aq.id, 'AQUAREST-Part-B-nacrt-v3.pdf', 'Part B – nacrt v3', 'proposal', ['Odjeljci 1 (Izvrsnost) i 2 (Učinak) – nacrt', 'Odjeljak 3 (Provedba) – u izradi']);
  sum.proposals.push('AQUAREST (u pripremi)');
  log('prijava AQUAREST u pripremi');

  // ---------- odbijena prijava (prošli krug NPOO-a): uspješnost prijava na portfelju ----------
  const rj = await office.post<{ id: string; members: Row[] }>('/proposals', { packageId: 'npoo-2021-2026', actionType: 'BESPOVRATNA', acronym: 'PAMETNI-KAMPUS', title: 'Digitalni blizanac sveučilišnog kampusa za upravljanje energijom', durationMonths: 24, leadUserId: userIds.pm2 });
  const rjSelf = rj.members[0]!.id;
  await office.post(`/proposals/${rj.id}/work-packages`, { title: 'Digitalni blizanac i senzorska mreža kampusa', leadMemberId: rjSelf, startMonth: 1, endMonth: 24, personMonths: 14 });
  await office.put(`/proposals/${rj.id}/budget/lines`, { revision: await revisionOf(office, `/proposals/${rj.id}`), lines: [{ memberId: rjSelf, categoryCode: 'OS', amount: 7_200_000 }, { memberId: rjSelf, categoryCode: 'OP', amount: 5_500_000 }, { memberId: rjSelf, categoryCode: 'VU', amount: 1_800_000 }] });
  await office.post(`/proposals/${rj.id}/budget/lock`);
  await office.post(`/proposals/${rj.id}/transition`, { to: 'preparation' });
  await office.post(`/proposals/${rj.id}/transition`, { to: 'internal_review' });
  await office.post(`/proposals/${rj.id}/submit`, { portal: 'eNPOO (fondovieu.gov.hr)', reference: 'ZDP-2025-0093', submittedAt: `${addMonths(npooStart, -4)}T12:00:00Z` });
  await office.post(`/proposals/${rj.id}/outcome`, { result: 'rejected', score: '61/100', note: 'Ispod praga za financiranje (65 bodova).' });
  sum.proposals.push('PAMETNI-KAMPUS (odbijena)');

  for (const api of [admin, office, pm, pm2, member, finance]) await api.post('/auth/logout').catch(() => undefined);
  return sum;
}
