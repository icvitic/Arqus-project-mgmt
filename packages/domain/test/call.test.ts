import { describe, it, expect } from 'vitest';
import { callStatus, nextDeadline, daysUntil, fitScore } from '../src/call.js';

const now = new Date('2027-02-01T10:00:00Z');
const d = (kind: 'submission' | 'stage1' | 'stage2' | 'info_day', at: string) => ({ kind, at });

describe('status poziva', () => {
  it('najavljen → otvoren → zatvoren; otkazan uvijek otkazan', () => {
    const c = { opensAt: '2027-01-14', deadlines: [d('submission', '2027-04-22T17:00:00+02:00')] };
    expect(callStatus(c, new Date('2027-01-10T00:00:00Z'))).toBe('announced');
    expect(callStatus(c, now)).toBe('open');
    expect(callStatus(c, new Date('2027-04-22T15:00:01Z'))).toBe('closed');
    expect(callStatus({ ...c, cancelled: true }, now)).toBe('cancelled');
  });
  it('dvofazni poziv zatvara se nakon zadnjeg roka; info-dan ne utječe na zatvaranje', () => {
    const c = { opensAt: null, deadlines: [d('stage1', '2027-01-20T17:00:00Z'), d('stage2', '2027-06-10T17:00:00Z'), d('info_day', '2027-09-01T09:00:00Z')] };
    expect(callStatus(c, now)).toBe('open');
    expect(callStatus(c, new Date('2027-07-01T00:00:00Z'))).toBe('closed');
    expect(callStatus({ opensAt: null, deadlines: [] }, now)).toBe('announced');
  });
  it('sljedeći rok i broj dana', () => {
    const ds = [d('stage1', '2027-01-20T17:00:00Z'), d('stage2', '2027-06-10T17:00:00Z'), d('info_day', '2027-02-05T09:00:00Z')];
    expect(nextDeadline(ds, now)).toEqual(d('info_day', '2027-02-05T09:00:00Z'));
    expect(daysUntil('2027-02-05T09:00:00Z', now)).toBe(4);
    expect(daysUntil('2027-02-01T18:00:00Z', now)).toBe(0); // danas
    expect(daysUntil('2027-03-03T17:00:00+01:00', now)).toBe(30);
    expect(nextDeadline([], now)).toBeNull();
  });
});

describe('ocjena prikladnosti', () => {
  it('postotak i preporuka', () => {
    expect(fitScore({ strategic: 5, capacity: 4, probability: 3, financial: 3 })).toEqual({ total: 75, recommendation: 'go' });
    expect(fitScore({ strategic: 3, capacity: 3, probability: 2, financial: 3 })).toEqual({ total: 55, recommendation: 'consider' });
    expect(fitScore({ strategic: 1, capacity: 2, probability: 1, financial: 2 }).recommendation).toBe('no_go');
    expect(() => fitScore({ strategic: 6, capacity: 1, probability: 1, financial: 1 })).toThrow(/1–5/);
  });
});
