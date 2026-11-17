import { describe, it, expect } from 'vitest';
import { defaultPeriod, groupExpenses } from './claims';

const e = (id: string, date: string, over: Partial<Parameters<typeof groupExpenses>[0][number]> = {}) => ({ id, date, source: 'manual', timesheetId: null, person: null, month: null, amount: 100, recognised: null, ...over });

describe('grupiranje troškova u ZNS-u', () => {
  it('troškovi osoblja po timesheetu (osoba i mjesec), ručni pojedinačno, poredak po datumu', () => {
    const g = groupExpenses([
      e('m1', '2027-03-10'),
      e('a1', '2027-02-28', { source: 'timesheet', timesheetId: 't1', person: 'Ana', month: '2027-02', amount: 300, recognised: 300 }),
      e('a2', '2027-02-28', { source: 'timesheet', timesheetId: 't1', person: 'Ana', month: '2027-02', amount: 40, recognised: 0 }),
      e('b1', '2027-02-28', { source: 'timesheet', timesheetId: 't2', person: 'Boris', month: '2027-02', amount: 50 }),
      e('m0', '2027-02-28'),
    ]);
    expect(g.map((x) => `${x.kind}:${x.person ?? x.key}:${x.rows.length}:${x.amount}:${x.recognised}`)).toEqual([
      'personnel:Ana:2:340:300', 'personnel:Boris:1:50:null', 'single:m0:1:100:null', 'single:m1:1:100:null',
    ]);
  });
});

describe('WP1.19: skriveni iznosi troškova osoblja', () => {
  it('grupa s retkom bez iznosa nema zbroj (ne zbraja se djelomično)', () => {
    const g = groupExpenses([
      e('a1', '2027-02-28', { source: 'timesheet', timesheetId: 't1', person: 'Ana', month: '2027-02', amount: null, amountHidden: true }),
      e('a2', '2027-02-28', { source: 'timesheet', timesheetId: 't1', person: 'Ana', month: '2027-02', amount: null, amountHidden: true }),
      e('m0', '2027-02-28'),
    ]);
    expect(g.map((x) => `${x.kind}:${x.rows.length}:${x.amount}:${x.hidden}`)).toEqual(['personnel:2:null:true', 'single:1:100:false']);
  });
});

describe('zadano razdoblje novog ZNS-a', () => {
  const free = [{ number: 3, endDate: '2027-09-30' }, { number: 2, endDate: '2027-06-30' }];
  it('najranije završeno bez zahtjeva', () => { expect(defaultPeriod(free, '2027-10-05')).toBe(2); });
  it('ne buduće razdoblje ako je neko završilo; razdoblje koje završava danas još nije završilo', () => {
    expect(defaultPeriod(free, '2027-07-01')).toBe(2);
    expect(defaultPeriod([{ number: 2, endDate: '2027-06-30' }, { number: 3, endDate: '2027-09-30' }], '2027-06-30')).toBe(2);
  });
  it('bez slobodnih razdoblja: null', () => { expect(defaultPeriod([], '2027-01-01')).toBeNull(); });
});
