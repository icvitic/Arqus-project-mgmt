import { describe, it, expect } from 'vitest';
import { deriveWorkItems, notificationText, timesheetMonths, urgencyFor, type WorkFacts } from '../src/my-work.js';
import { buildCalendar, foldLine, icalText } from '../src/ical.js';
import { todayIn } from '../src/time.js';

const ME = 'u-me';
const base = (over: Partial<WorkFacts> = {}): WorkFacts => ({
  today: '2027-07-15', userId: ME,
  projects: [{ id: 'A', acronym: 'ALFA', startDate: '2027-01-01', endDate: '2027-12-31' }, { id: 'B', acronym: 'BETA', startDate: '2027-01-01', endDate: '2027-12-31' }],
  members: [], approvals: [], finance: [], managers: [], ownRisks: [], proposals: [], calls: [], mfaMissing: null, ...over,
});
const kinds = (f: WorkFacts) => deriveWorkItems(f).items.map((i) => `${i.kind}|${i.urgency}|${i.acronym ?? ''}`);

describe('Moj rad – član tima', () => {
  it('mjeseci od kasnijeg od početka projekta i pridruživanja do tekućeg, unutar trajanja', () => {
    expect(timesheetMonths('2027-01-01', '2027-12-31', '2027-05-20', '2027-07-15')).toEqual(['2027-05', '2027-06', '2027-07']);
    expect(timesheetMonths('2027-03-10', '2027-12-31', '2027-01-01', '2027-04-02')).toEqual(['2027-03', '2027-04']);
    expect(timesheetMonths('2027-01-01', '2027-02-28', '2027-01-01', '2027-07-15')).toEqual(['2027-01', '2027-02']); // projekt je završio
    expect(timesheetMonths('2027-09-01', '2027-12-31', '2027-01-01', '2027-07-15')).toEqual([]); // nije počeo
    expect(timesheetMonths(null, null, '2027-01-01', '2027-07-15')).toEqual([]);
  });

  it('tekući mjesec, ranije nepredani mjeseci, predan (čeka), vraćen, odobren i pokriven uvozom', () => {
    const f = base({ members: [{
      projectId: 'A', memberId: 'm1', joined: '2027-02-10', coveredMonths: ['2027-02'],
      timesheets: [
        { month: '2027-03', status: 'approved', minutes: 600, reopened: false },
        { month: '2027-04', status: 'draft', minutes: 120, reopened: false },
        { month: '2027-05', status: 'draft', minutes: 300, reopened: true },
        { month: '2027-06', status: 'submitted', minutes: 900, reopened: false },
        { month: '2027-07', status: 'draft', minutes: 480, reopened: false },
      ],
    }] });
    const { items } = deriveWorkItems(f);
    expect(items.map((i) => `${i.kind}|${i.urgency}|${i.due}`)).toEqual([
      'timesheet_missing|overdue|2027-04-30', 'timesheet_reopened|overdue|2027-05-31',
      'timesheet_current|waiting|2027-07-31', 'timesheet_submitted|waiting|null',
    ]);
    expect(items[0]).toMatchObject({ link: 'projekti/A/tim/m1/2027-04', acronym: 'ALFA', detail: 'u nacrtu (2 h) – predaj ga', days: -76 });
    expect(items[2]!.detail).toMatch(/^u tijeku – 8 h/);
    expect(items.find((i) => i.kind === 'timesheet_current')!.title).toBe('Timesheet za srpanj 2027.');
  });

  it('tekući timesheet: granica „uskoro” je zadnjih 5 dana mjeseca (po danu institucije)', () => {
    const m = (today: string, minutes = 0) => deriveWorkItems(base({ today, members: [{ projectId: 'A', memberId: 'm1', joined: '2027-07-01', coveredMonths: [], timesheets: minutes ? [{ month: '2027-07', status: 'draft', minutes, reopened: false }] : [] }] })).items[0]!;
    expect(m('2027-07-25')).toMatchObject({ urgency: 'waiting', detail: expect.stringMatching(/^nije započet/) }); // 6 dana
    expect(m('2027-07-26', 60)).toMatchObject({ urgency: 'due_soon', detail: expect.stringMatching(/^spreman za predaju – 1 h/) }); // 5 dana
    expect(m('2027-07-31')).toMatchObject({ urgency: 'due_soon', days: 0 });
    // Prvi dan sljedećeg mjeseca srpanjski timesheet postaje nepredan (prošao rok).
    const aug = deriveWorkItems(base({ today: '2027-08-01', members: [{ projectId: 'A', memberId: 'm1', joined: '2027-07-01', coveredMonths: [], timesheets: [] }] })).items;
    expect(aug.map((i) => `${i.kind}|${i.urgency}`)).toEqual(['timesheet_missing|overdue', 'timesheet_current|waiting']);
    // „Danas” je dan u zoni institucije: 31. 7. 23:30 u Zagrebu je već 1. 8. – srpanjski timesheet tada kasni.
    expect(todayIn('Europe/Zagreb', new Date('2027-07-31T22:30:00Z'))).toBe('2027-08-01');
  });

  it('član upisan u tim naknadno, a s ranijim timesheetovima: mjeseci od prvog timesheeta', () => {
    const f = base({ members: [{ projectId: 'A', memberId: 'm1', joined: '2027-07-10', coveredMonths: [], timesheets: [
      { month: '2027-04', status: 'approved', minutes: 600, reopened: false }, { month: '2027-06', status: 'submitted', minutes: 600, reopened: false },
    ] }] });
    expect(deriveWorkItems(f).items.map((i) => `${i.kind}|${i.due ?? ''}`)).toEqual(['timesheet_missing|2027-05-31', 'timesheet_current|2027-07-31', 'timesheet_submitted|']);
  });

  it('rizik kojem sam nositelj', () => {
    expect(deriveWorkItems(base({ ownRisks: [{ projectId: 'B', riskId: 'r1', number: 2, description: 'Kvar senzora' }] })).items[0])
      .toMatchObject({ kind: 'risk_owned', role: 'owner', urgency: 'waiting', title: 'Rizik R2: Kvar senzora', link: 'projekti/B/struktura', acronym: 'BETA' });
  });
});

describe('Moj rad – odobravatelj (četiri oka)', () => {
  it('ne vlastiti timesheet, ne onaj koji sam predao, ne bez predavatelja', () => {
    const f = base({ approvals: [
      { projectId: 'A', memberId: 'm1', fullName: 'Ana', month: '2027-06', memberUserId: 'u-ana', submittedBy: 'u-ana' },
      { projectId: 'A', memberId: 'm2', fullName: 'Ja', month: '2027-06', memberUserId: ME, submittedBy: ME },
      { projectId: 'A', memberId: 'm3', fullName: 'Bez računa', month: '2027-06', memberUserId: null, submittedBy: ME },
      { projectId: 'A', memberId: 'm4', fullName: 'Stari', month: '2027-06', memberUserId: null, submittedBy: null },
    ] });
    expect(deriveWorkItems(f).items.map((i) => i.title)).toEqual(['Odobri timesheet: Ana, lipanj 2027.']);
    expect(deriveWorkItems(f).items[0]).toMatchObject({ kind: 'timesheet_to_approve', link: 'projekti/A/tim/m1/2027-06', urgency: 'waiting' });
  });
});

describe('Moj rad – financije', () => {
  it('troškovi bez dokaza, nepredani iz ranijih razdoblja, nacrt s blokadama, vraćen, razdoblje bez ZNS-a, neisplaćen', () => {
    const f = base({ finance: [{ projectId: 'A', withoutEvidence: 2, stranded: 1,
      periods: [
        { number: 1, endDate: '2027-03-31', dueDate: '2027-04-30', submitted: true },
        { number: 2, endDate: '2027-06-30', dueDate: '2027-07-30', submitted: false },
        { number: 3, endDate: '2027-09-30', dueDate: '2027-10-30', submitted: false },
      ],
      claims: [
        { id: 'c1', period: 1, periodEnd: '2027-03-31', dueDate: '2027-04-30', status: 'approved', returned: false, paid: false, blockers: null },
        { id: 'c3', period: 3, periodEnd: '2027-09-30', dueDate: '2027-10-30', status: 'draft', returned: false, paid: false, blockers: 1 },
      ] }] });
    const { items } = deriveWorkItems(f);
    expect(items.map((i) => `${i.kind}|${i.urgency}|${i.count ?? ''}`)).toEqual([
      'period_unclaimed|due_soon|', 'expenses_stranded|waiting|1', 'expenses_without_evidence|waiting|2', 'claim_unpaid|info|',
    ]); // nacrt RP3 (razdoblje traje) nije stavka
    expect(items[2]!.title).toBe('2 ručno unesena troška nemaju dokaz');

    const g = base({ finance: [{ projectId: 'A', withoutEvidence: 0, stranded: 0,
      periods: [{ number: 2, endDate: '2027-06-30', dueDate: '2027-07-10', submitted: false }],
      claims: [{ id: 'c2', period: 2, periodEnd: '2027-06-30', dueDate: '2027-07-10', status: 'draft', returned: false, paid: false, blockers: 2 }] }] });
    expect(deriveWorkItems(g).items).toEqual([expect.objectContaining({ kind: 'claim_draft', urgency: 'overdue', detail: 'razdoblje je završilo 30. 6. 2027. · 2 stavke blokiraju predaju', link: 'projekti/A/zns' })]);
    const r = base({ finance: [{ projectId: 'A', withoutEvidence: 0, stranded: 0, periods: [{ number: 2, endDate: '2027-06-30', dueDate: '2027-08-30', submitted: false }],
      claims: [{ id: 'c2', period: 2, periodEnd: '2027-06-30', dueDate: '2027-08-30', status: 'draft', returned: true, paid: false, blockers: 0 }] }] });
    expect(deriveWorkItems(r).items).toEqual([expect.objectContaining({ kind: 'claim_returned', urgency: 'waiting', detail: expect.stringMatching(/^popis za provjeru je prošao/) })]);
  });
});

describe('Moj rad – voditelj projekta', () => {
  it('isporuke i prekretnice koje kasne ili dospijevaju u 30 dana, rizici, odstupanja, rok izvještaja', () => {
    const f = base({ managers: [{ projectId: 'A', highRisks: 1, deviations: 2, financeLink: true,
      deliverables: [{ id: 'd1', code: 'D1.1', title: 'Plan', due: '2027-06-30' }, { id: 'd2', code: 'D2.1', title: 'Prototip', due: '2027-08-14' }, { id: 'd3', code: 'D2.2', title: 'Daleko', due: '2027-08-15' }],
      milestones: [{ id: 'm1', code: 'MS1', title: 'Početak', due: '2027-07-15' }],
      periods: [{ number: 1, endDate: '2027-06-30', dueDate: '2027-09-30', submitted: false }] }] });
    expect(kinds(f)).toEqual([
      'deliverable_due|overdue|ALFA', 'milestone_due|due_soon|ALFA', 'deliverable_due|due_soon|ALFA',
      'risks_high|waiting|ALFA', 'deviations|waiting|ALFA', 'report_next|info|ALFA',
    ]);
    const items = deriveWorkItems(f).items;
    expect(items[1]).toMatchObject({ days: 0, detail: 'rok je danas' });
    expect(items[2]).toMatchObject({ days: 30 });
    expect(items.find((i) => i.kind === 'report_next')!.link).toBe('projekti/A/zns');
  });

  it('osoba s različitim ulogama na dva projekta: član tima na A, voditelj na B (rok izvještaja bez dvostrukih stavki uz financije)', () => {
    const f = base({
      members: [{ projectId: 'A', memberId: 'm1', joined: '2027-07-01', coveredMonths: [], timesheets: [] }],
      managers: [{ projectId: 'B', highRisks: 0, deviations: 0, financeLink: false, deliverables: [], milestones: [], periods: [{ number: 2, endDate: '2027-06-30', dueDate: '2027-07-30', submitted: false }] }],
      finance: [{ projectId: 'B', withoutEvidence: 0, stranded: 0, periods: [{ number: 2, endDate: '2027-06-30', dueDate: '2027-07-30', submitted: false }], claims: [] }],
    });
    expect(kinds(f)).toEqual(['period_unclaimed|due_soon|BETA', 'timesheet_current|waiting|ALFA']);
    expect(deriveWorkItems(f).items.map((i) => i.role)).toEqual(['finance', 'member']);
  });
});

describe('Moj rad – prijave, pozivi, administrator, prazno', () => {
  it('interni rok prijave u 30 dana ili prošao, s otvorenim stavkama spremnosti', () => {
    const f = base({ proposals: [
      { id: 'p1', acronym: 'AQUA', title: 'x', internalDeadline: '2027-08-14', openReadiness: 2 },
      { id: 'p2', acronym: 'LATE', title: 'y', internalDeadline: '2027-07-10', openReadiness: 0 },
      { id: 'p3', acronym: 'FAR', title: 'z', internalDeadline: '2027-08-15', openReadiness: 3 },
    ] });
    const { items } = deriveWorkItems(f);
    expect(items.map((i) => `${i.proposalId}|${i.urgency}`)).toEqual(['p2|overdue', 'p1|due_soon']);
    expect(items[1]!.detail).toBe('rok 14. 8. 2027. (za 30 dana) · 2 stavke spremnosti nisu ispunjene');
    expect(items[0]!.detail).toMatch(/sve stavke spremnosti su ispunjene$/);
  });

  it('praćeni poziv bez odluke: najbliži relevantan rok', () => {
    const f = base({ calls: [
      { id: 'c1', code: 'HE-1', title: 'a', internalDeadline: '2027-07-20', submission: '2027-08-01' },
      { id: 'c2', code: 'HE-2', title: 'b', internalDeadline: '2027-07-01', submission: '2027-07-30' }, // interni prošao, predaja traje
      { id: 'c3', code: 'HE-3', title: 'c', internalDeadline: null, submission: '2027-07-01' }, // rok predaje prošao – nije stavka
      { id: 'c4', code: 'HE-4', title: 'd', internalDeadline: '2027-09-20', submission: '2027-10-01' }, // daleko
    ] });
    expect(deriveWorkItems(f).items.map((i) => `${i.callId}|${i.urgency}|${i.due}`)).toEqual(['c2|overdue|2027-07-01', 'c1|due_soon|2027-07-20']);
  });

  it('administrator: računi bez obveznog MFA; nula ne daje stavku', () => {
    expect(kinds(base({ mfaMissing: 3 }))).toEqual(['mfa_missing|waiting|']);
    expect(deriveWorkItems(base({ mfaMissing: 0 })).items).toEqual([]);
  });

  it('ništa na čekanju: prazan popis i nule u sažetku', () => {
    expect(deriveWorkItems(base())).toEqual({ items: [], summary: { overdue: 0, dueSoon: 0, waiting: 0, info: 0, attention: 0 } });
  });

  it('sažetak: značka broji prošle i bliske rokove; stavke projekta koji korisnik ne vidi se izostavljaju', () => {
    const f = base({
      projects: [{ id: 'A', acronym: 'ALFA', startDate: '2027-01-01', endDate: '2027-12-31' }],
      ownRisks: [{ projectId: 'X', riskId: 'r', number: 1, description: 'tuđi' }],
      members: [{ projectId: 'A', memberId: 'm1', joined: '2027-06-01', coveredMonths: [], timesheets: [] }],
    });
    expect(deriveWorkItems(f).summary).toEqual({ overdue: 1, dueSoon: 0, waiting: 1, info: 0, attention: 1 });
    expect(urgencyFor('2027-07-14', '2027-07-15', 30, 'info')).toBe('overdue');
    expect(urgencyFor(null, '2027-07-15', 30, 'info')).toBe('info');
  });

  it('nijedna stavka ne nosi iznos', () => {
    const f = base({ finance: [{ projectId: 'A', withoutEvidence: 1, stranded: 1, periods: [], claims: [{ id: 'c', period: 1, periodEnd: '2027-03-31', dueDate: '2027-04-30', status: 'partially_approved', returned: false, paid: false, blockers: null }] }] });
    expect(JSON.stringify(deriveWorkItems(f))).not.toMatch(/EUR|€|\d+,\d{2}/);
  });
});

describe('obavijesti – tekst', () => {
  it('bez iznosa; razlog samo kad postoji', () => {
    expect(notificationText('timesheet_approved', { acronym: 'ALFA', month: '2027-06' }, 'Petra')).toEqual({ title: 'Timesheet za lipanj 2027. je odobren (ALFA)', detail: 'Petra ga je odobrio/la.' });
    expect(notificationText('claim_returned', { period: 2, reason: 'Nedostaje račun', acronym: 'ALFA' }).detail).toBe('Razlog: Nedostaje račun');
    expect(notificationText('claim_decided', { period: 1, outcome: 'partially_approved' }, 'Ana').title).toBe('ZNS za RP1 je djelomično odobren');
    expect(notificationText('access_granted', { acronym: 'BETA', role: 'team-member' })).toEqual({ title: 'Dobio/la si pristup projektu BETA', detail: 'Uloga: član tima.' });
  });
});

describe('iCalendar (RFC 5545)', () => {
  it('escape teksta i presavijanje na 75 okteta bez prelamanja UTF-8 znaka', () => {
    expect(icalText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    const long = `SUMMARY:${'č'.repeat(60)}`;
    const folded = foldLine(long);
    const parts = folded.split('\r\n');
    expect(parts.length).toBeGreaterThan(1);
    for (const [i, p] of parts.entries()) {
      expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
      expect(i === 0 || p.startsWith(' ')).toBe(true);
    }
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(long);
    expect(foldLine('KRATKO')).toBe('KRATKO');
  });

  it('cjelodnevni i događaj s vremenom, CRLF, DTSTAMP, UID', () => {
    const out = buildCalendar([
      { uid: 'deliverable-1@arqus', date: '2027-06-30', summary: '[ALFA] D1.1 Plan, verzija 2', categories: ['Isporuka'] },
      { uid: 'call-2-submission@arqus', date: '2027-07-25', at: '2027-07-25T15:00:00Z', summary: 'Rok poziva' },
    ], { name: 'ArQus – rokovi', stamp: new Date('2027-07-15T10:00:00Z'), refresh: 'PT4H' });
    expect(out.endsWith('\r\n')).toBe(true);
    expect(out.replace(/\r\n/g, '')).not.toMatch(/\n/);
    expect(out).toContain('DTSTART;VALUE=DATE:20270630\r\nDTEND;VALUE=DATE:20270701');
    expect(out).toContain('DTSTART:20270725T150000Z');
    expect(out).toContain('SUMMARY:[ALFA] D1.1 Plan\\, verzija 2');
    expect(out).toContain('DTSTAMP:20270715T100000Z');
    expect(out.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(out.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
  });
});
