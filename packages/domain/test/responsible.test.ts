import { describe, it, expect } from 'vitest';
import { RESPONSIBLE_TRANSITIONS, responsibleMayChange, responsibleNextStatuses } from '../src/responsible.js';
import { deriveWorkItems, notificationText, whoText, type WorkFacts } from '../src/my-work.js';

const ME = 'u-me';
const base = (over: Partial<WorkFacts> = {}): WorkFacts => ({
  today: '2027-07-15', userId: ME,
  projects: [{ id: 'A', acronym: 'ALFA', startDate: '2027-01-01', endDate: '2027-12-31' }, { id: 'B', acronym: 'BETA', startDate: '2027-01-01', endDate: '2027-12-31' }],
  members: [], approvals: [], finance: [], managers: [], ownRisks: [], proposals: [], calls: [], mfaMissing: null, ...over,
});

describe('WP1.22 – statusi koje smije odgovorna osoba', () => {
  const DELIVERABLE = ['planned', 'in_progress', 'submitted', 'accepted', 'rejected'];
  const TASK = ['planned', 'in_progress', 'done', 'cancelled'];
  const MILESTONE = ['planned', 'achieved', 'missed'];
  const allowed = (kind: 'deliverable' | 'task' | 'milestone', all: string[]) => all.flatMap((f) => all.filter((t) => responsibleMayChange(kind, f, t)).map((t) => `${f}→${t}`));

  it('isporuka: samo radni dio (planirana, u izradi, predana, dorada odbijene) – prihvaćanje, odbijanje i vraćanje predane ne', () => {
    expect(allowed('deliverable', DELIVERABLE)).toEqual([
      'planned→in_progress', 'planned→submitted', 'in_progress→planned', 'in_progress→submitted', 'rejected→in_progress', 'rejected→submitted',
    ]);
    for (const to of ['accepted', 'rejected']) for (const from of DELIVERABLE) expect(responsibleMayChange('deliverable', from, to)).toBe(false);
    for (const to of DELIVERABLE) { expect(responsibleMayChange('deliverable', 'submitted', to)).toBe(false); expect(responsibleMayChange('deliverable', 'accepted', to)).toBe(false); }
  });

  it('zadatak: planiran ↔ u tijeku → gotov; otkazivanje i ponovno otvaranje gotovog ne', () => {
    expect(allowed('task', TASK)).toEqual(['planned→in_progress', 'planned→done', 'in_progress→planned', 'in_progress→done']);
    for (const from of TASK) expect(responsibleMayChange('task', from, 'cancelled')).toBe(false);
    for (const to of TASK) { expect(responsibleMayChange('task', 'done', to)).toBe(false); expect(responsibleMayChange('task', 'cancelled', to)).toBe(false); }
  });

  it('prekretnica: nijedan prijelaz (postignuće potvrđuje voditelj); isti status nije prijelaz; nepoznat status ništa', () => {
    expect(allowed('milestone', MILESTONE)).toEqual([]);
    expect(RESPONSIBLE_TRANSITIONS.milestone).toEqual({});
    expect(responsibleMayChange('deliverable', 'planned', 'planned')).toBe(false);
    expect(responsibleMayChange('deliverable', 'nepoznat', 'submitted')).toBe(false);
    expect(responsibleNextStatuses('deliverable', 'in_progress')).toEqual(['planned', 'submitted']);
    expect(responsibleNextStatuses('milestone', 'planned')).toEqual([]);
  });
});

describe('WP1.22 – Moj rad: stavke odgovorne osobe', () => {
  const r = (kind: 'deliverable' | 'milestone' | 'task', due: string, status = 'planned', projectId = 'A') => ({ projectId, kind, id: `${kind}-${due}`, code: kind === 'task' ? 'T1.1' : kind === 'deliverable' ? 'D1.1' : 'MS1', title: 'Naslov', due, status });

  it('granice hitnosti iste kao voditeljeve: prošao rok kasni, do 30 dana uskoro, dalje se ne prikazuje', () => {
    const items = deriveWorkItems(base({ responsible: [
      r('deliverable', '2027-07-14'), r('deliverable', '2027-07-15'), r('deliverable', '2027-08-14'), r('deliverable', '2027-08-15'),
      r('milestone', '2027-06-30'), r('task', '2027-07-31', 'in_progress'), r('task', '2027-09-30'),
    ] })).items;
    expect(items.map((i) => `${i.kind}|${i.urgency}|${i.due}|${i.role}`)).toEqual([
      'milestone_responsible|overdue|2027-06-30|responsible', 'deliverable_responsible|overdue|2027-07-14|responsible',
      'deliverable_responsible|due_soon|2027-07-15|responsible', 'task_responsible|due_soon|2027-07-31|responsible', 'deliverable_responsible|due_soon|2027-08-14|responsible',
    ]);
    expect(items[2]).toMatchObject({ days: 0, link: 'projekti/A/struktura', acronym: 'ALFA', title: 'Isporuka D1.1 Naslov' });
    expect(items[2]!.detail).toBe('rok je danas · ti si odgovorna osoba · planirana');
    expect(items[3]!.detail).toMatch(/^završava 31\. 7\. 2027\. \(za 16 dana\) · ti si odgovorna osoba · u tijeku$/);
    expect(items[0]!.detail).toMatch(/postignuće potvrđuje voditelj projekta$/);
  });

  it('voditelj koji je i odgovoran vidi stavku jednom (kao odgovorna osoba); voditelj vidi tko je odgovoran', () => {
    const managers = [{ projectId: 'A', highRisks: 0, deviations: 0, periods: [], financeLink: false,
      deliverables: [
        { id: 'deliverable-2027-07-20', code: 'D1.1', title: 'Moja', due: '2027-07-20', responsible: { name: 'Ja', userId: ME, active: true } },
        { id: 'd2', code: 'D1.2', title: 'Tuđa', due: '2027-07-10', responsible: { name: 'Ana Novak', userId: 'u-ana', active: true } },
        { id: 'd3', code: 'D1.3', title: 'Bez', due: '2027-07-25', responsible: null },
        { id: 'd4', code: 'D1.4', title: 'Neaktivan', due: '2027-07-26', responsible: { name: 'Ivo', userId: null, active: false } },
      ],
      milestones: [{ id: 'm1', code: 'MS1', title: 'Vanjski', due: '2027-07-30', responsible: { name: 'Marko', userId: null, active: true } }] }];
    const items = deriveWorkItems(base({ managers, responsible: [r('deliverable', '2027-07-20')] })).items;
    expect(items.filter((i) => i.key === 'deliverable:deliverable-2027-07-20').map((i) => i.kind)).toEqual(['deliverable_responsible']);
    expect(items.find((i) => i.key === 'deliverable:d2')!.detail).toMatch(/· odgovorna osoba: Ana Novak$/);
    expect(items.find((i) => i.key === 'deliverable:d3')!.detail).toMatch(/· odgovorna osoba nije određena$/);
    expect(items.find((i) => i.key === 'deliverable:d4')!.detail).toMatch(/Ivo više nije aktivna u timu – odredi drugu$/);
    expect(items.find((i) => i.key === 'milestone:m1')!.detail).toMatch(/Marko \(bez korisničkog računa\)$/);
    expect(whoText(undefined)).toBe('odgovorna osoba nije određena');
  });

  it('projekt koji korisnik ne vidi: nema stavke; nijedna stavka ne nosi iznos', () => {
    const items = deriveWorkItems(base({ projects: [{ id: 'A', acronym: 'ALFA', startDate: '2027-01-01', endDate: '2027-12-31' }], responsible: [r('deliverable', '2027-07-20', 'planned', 'B')] })).items;
    expect(items).toEqual([]);
  });

  it('obavijesti: određen / više nije odgovoran, bez iznosa', () => {
    expect(notificationText('responsible_assigned', { acronym: 'ALFA', item: 'D1.2 Izvještaj', itemKind: 'deliverable' }, 'Iva Ured')).toEqual({ title: 'Odgovoran/na si za isporuku D1.2 Izvještaj (ALFA)', detail: 'Odredio/la Iva Ured. Stavka je u tvom „Moj rad” kad joj se približi rok.' });
    expect(notificationText('responsible_removed', { acronym: 'ALFA', item: 'T1.1 Anketa', itemKind: 'task' }, 'Iva Ured').title).toBe('Više nisi odgovoran/na za zadatak T1.1 Anketa (ALFA)');
  });
});
