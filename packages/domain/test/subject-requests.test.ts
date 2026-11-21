import { describe, it, expect } from 'vitest';
import { addCalendarMonths, extensionIsLate, subjectRequestDue, subjectRequestRef, subjectRequestState } from '../src/subject-requests.js';
import { deriveWorkItems, type WorkFacts } from '../src/my-work.js';

const base = (over: Partial<WorkFacts> = {}): WorkFacts => ({
  today: '2027-07-15', userId: 'u', projects: [], members: [], approvals: [], finance: [], managers: [], ownRisks: [], proposals: [], calls: [], mfaMissing: null, ...over,
});

describe('Zahtjevi ispitanika – rok (WP1.24)', () => {
  it('mjesec dana kalendarski: isti dan idućeg mjeseca', () => {
    expect(subjectRequestDue('2026-11-20', false)).toBe('2026-12-20');
    expect(subjectRequestDue('2026-12-15', false)).toBe('2027-01-15');
  });

  it('ako mjesec nema taj dan, posljednji dan mjeseca (i prijestupna godina)', () => {
    expect(subjectRequestDue('2027-01-31', false)).toBe('2027-02-28');
    expect(subjectRequestDue('2028-01-31', false)).toBe('2028-02-29');
    expect(subjectRequestDue('2027-03-31', false)).toBe('2027-04-30');
    expect(addCalendarMonths('2027-08-31', 1)).toBe('2027-09-30');
  });

  it('produljenje: tri mjeseca od zaprimanja, ne od osnovnog roka', () => {
    expect(subjectRequestDue('2026-11-20', true)).toBe('2027-02-20');
    // 30. 11. + 1 mj. = 30. 12.; + 3 mj. = 28. 2. (ne 30. 12. + 2 mj.)
    expect(subjectRequestDue('2026-11-30', true)).toBe('2027-02-28');
    expect(subjectRequestDue('2026-12-31', true)).toBe('2027-03-31');
  });

  it('rok na vikend se ne pomiče (prikazani rok nikad nije kasniji od pravnog)', () => {
    expect(new Date('2026-12-20T00:00:00Z').getUTCDay()).toBe(0); // nedjelja
    expect(subjectRequestDue('2026-11-20', false)).toBe('2026-12-20');
  });

  it('obavijest o produljenju nakon osnovnog roka je zakašnjela', () => {
    expect(extensionIsLate('2026-11-20', '2026-12-20')).toBe(false);
    expect(extensionIsLate('2026-11-20', '2026-12-21')).toBe(true);
  });

  it('stanje prema roku', () => {
    const r = { dueOn: '2027-07-20', closedOn: null };
    expect(subjectRequestState(r, '2027-07-09')).toBe('open');
    expect(subjectRequestState(r, '2027-07-10')).toBe('due_soon');
    expect(subjectRequestState(r, '2027-07-20')).toBe('due_soon');
    expect(subjectRequestState(r, '2027-07-21')).toBe('overdue');
    expect(subjectRequestState({ dueOn: '2027-07-20', closedOn: '2027-07-20' }, '2027-09-01')).toBe('closed');
    expect(subjectRequestState({ dueOn: '2027-07-20', closedOn: '2027-07-21' }, '2027-09-01')).toBe('closed_late');
    expect(subjectRequestRef(7)).toBe('ZI-7');
  });
});

describe('Moj rad – zahtjevi ispitanika (WP1.24)', () => {
  it('svaki otvoreni zahtjev je stavka s rokom; hitnost po roku; bez imena podnositelja', () => {
    const { items, summary } = deriveWorkItems(base({ subjectRequests: [
      { id: 'r1', number: 1, kind: 'access', dueOn: '2027-07-10', extended: false },
      { id: 'r2', number: 2, kind: 'erasure', dueOn: '2027-07-25', extended: true },
      { id: 'r3', number: 3, kind: 'other', dueOn: '2027-08-14', extended: false },
    ] }));
    expect(items.map((i) => `${i.key}|${i.kind}|${i.role}|${i.urgency}|${i.due}|${i.days}|${i.link}`)).toEqual([
      'subject-request:r1|subject_request|admin|overdue|2027-07-10|-5|osobni-podaci/zahtjevi',
      'subject-request:r2|subject_request|admin|due_soon|2027-07-25|10|osobni-podaci/zahtjevi',
      'subject-request:r3|subject_request|admin|waiting|2027-08-14|30|osobni-podaci/zahtjevi',
    ]);
    expect(items[0]!.title).toBe('Zahtjev ispitanika ZI-1: pristup podacima (čl. 15)');
    expect(items[0]!.detail).toContain('kasni 5 dana');
    expect(items[1]!.detail).toContain('rok je produljen');
    expect(summary).toMatchObject({ overdue: 1, dueSoon: 1, waiting: 1, attention: 2 });
  });

  it('bez zahtjeva (ili bez prava) nema stavki', () => {
    expect(deriveWorkItems(base()).items).toEqual([]);
    expect(deriveWorkItems(base({ subjectRequests: [] })).items).toEqual([]);
  });
});
