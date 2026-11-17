import { describe, it, expect } from 'vitest';
import {
  annualProductiveHours, budgetPercent, deadlineCounts, lastMonths, mergeDeadlines, personWorkload, progressSignal, successRate, timeProgress,
  type DeadlineInput, type TeamMemberRef,
} from '../src/portfolio.js';

describe('napredak u vremenu', () => {
  it('projekt u tijeku: tekući mjesec i protekli udio (dani, uključujući današnji)', () => {
    expect(timeProgress('2027-01-01', 12, '2027-07-15')).toEqual({ state: 'running', month: 7, durationMonths: 12, percent: 54, endDate: '2027-12-31' });
    expect(timeProgress('2027-01-01', 12, '2027-01-01')).toMatchObject({ state: 'running', month: 1, percent: 0 });
    expect(timeProgress('2027-01-15', 3, '2027-02-14')).toMatchObject({ month: 1 });
    expect(timeProgress('2027-01-15', 3, '2027-02-15')).toMatchObject({ month: 2 });
  });
  it('zadnji dan projekta je 100 % i zadnji mjesec', () => {
    expect(timeProgress('2027-01-01', 12, '2027-12-31')).toMatchObject({ state: 'running', month: 12, percent: 100 });
  });
  it('nije počeo / završio', () => {
    expect(timeProgress('2027-01-01', 12, '2026-12-31')).toEqual({ state: 'not_started', month: 0, durationMonths: 12, percent: 0, endDate: '2027-12-31' });
    expect(timeProgress('2027-01-01', 12, '2028-01-01')).toMatchObject({ state: 'finished', month: 12, percent: 100 });
  });
  it('bez početka ili trajanja (i trajanje 0) – nepoznato', () => {
    expect(timeProgress(null, 12, '2027-01-01')).toMatchObject({ state: 'unknown', percent: null, endDate: null });
    expect(timeProgress('2027-01-01', null, '2027-01-01')).toMatchObject({ state: 'unknown', percent: null });
    expect(timeProgress('2027-01-01', 0, '2027-01-01')).toMatchObject({ state: 'unknown', percent: null });
  });
});

describe('potrošnja prema vremenu', () => {
  it('postotak potrošnje; bez proračuna nema usporedbe', () => {
    expect(budgetPercent(1_000_000, 250_000)).toBe(25);
    expect(budgetPercent(0, 250_000)).toBeNull();
    expect(budgetPercent(0, 0)).toBeNull();
  });
  it('signal: više od 20 postotnih bodova ispod / iznad vremena', () => {
    expect(progressSignal(50, 29)).toEqual({ signal: 'lagging', gap: -21 });
    expect(progressSignal(50, 30)).toEqual({ signal: 'ok', gap: -20 });
    expect(progressSignal(50, 70)).toEqual({ signal: 'ok', gap: 20 });
    expect(progressSignal(50, 71)).toEqual({ signal: 'ahead', gap: 21 });
  });
  it('rubni slučajevi: nije počeo, završio, nema proračuna ni trajanja', () => {
    expect(progressSignal(0, 0).signal).toBe('ok'); // nije počeo, ništa potrošeno
    expect(progressSignal(0, 25).signal).toBe('ahead'); // troškovi prije početka
    expect(progressSignal(100, 60).signal).toBe('lagging'); // završio s 60 % iskorištenosti
    expect(progressSignal(40, null)).toEqual({ signal: 'none', gap: null });
    expect(progressSignal(null, 10)).toEqual({ signal: 'none', gap: null });
  });
});

describe('rokovi', () => {
  const d = (kind: DeadlineInput['kind'], date: string, overdueRelevant = true, title = kind): DeadlineInput => ({ kind, date, overdueRelevant, title });
  const today = '2027-03-10';
  it('prošli rokovi neispunjenih obveza prvi (najstariji prvi), zatim idući rokovi do granice prozora', () => {
    const list = mergeDeadlines([
      d('call_submission', '2027-04-01', false), d('deliverable', '2027-02-28'), d('claim_due', '2027-01-30'), d('period_end', '2027-03-01', false),
      d('milestone', '2027-05-09'), d('milestone', '2027-05-10'), d('proposal_internal', '2027-03-10'),
    ], today, 60);
    expect(list.map((x) => [x.kind, x.days, x.overdue])).toEqual([
      ['claim_due', -39, true], ['deliverable', -10, true], ['proposal_internal', 0, false], ['call_submission', 22, false], ['milestone', 60, false],
    ]);
  });
  it('rok danas nije prošao; isti dan po vrsti pa po naslovu', () => {
    const list = mergeDeadlines([d('call_internal', today, true, 'B'), d('claim_due', today, true, 'Z'), d('call_internal', today, true, 'A')], today);
    expect(list.map((x) => `${x.kind}:${x.title}:${x.days}:${x.overdue}`)).toEqual(['claim_due:Z:0:false', 'call_internal:A:0:false', 'call_internal:B:0:false']);
  });
  it('brojke: idućih 30 dana (uključujući danas) i prošli', () => {
    expect(deadlineCounts([d('claim_due', today), d('deliverable', '2027-04-09'), d('milestone', '2027-04-10'), d('deliverable', '2027-03-09'), d('period_end', '2027-03-01', false)], today)).toEqual({ soon: 2, overdue: 1 });
  });
});

describe('opterećenje ljudi', () => {
  it('godišnji fond iz pravila paketa (HE dnevnica, NPOO satnica)', () => {
    expect(annualProductiveHours({ method: 'dailyRate', divisor: 215, maxUnitsPerYear: 215 })).toBe(1720);
    expect(annualProductiveHours({ method: 'dailyRate', divisor: 215, hoursPerDay: 7.5 })).toBe(1612.5);
    expect(annualProductiveHours({ method: 'hourlyRate', divisor: 1720, maxUnitsPerYear: 1720 })).toBe(1720);
    expect(annualProductiveHours({ method: 'actualSalary' })).toBeNull();
    expect(annualProductiveHours(undefined)).toBeNull();
  });
  it('zadnjih n mjeseci zaključno s tekućim', () => {
    expect(lastMonths('2027-02-17', 6)).toEqual(['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02']);
  });

  const m = (memberId: string, projectId: string, fullName: string, userId: string | null = null, annualLimitHours: number | null = 1720): TeamMemberRef => ({ memberId, projectId, fullName, userId, annualLimitHours });
  it('ista osoba kroz projekte: po računu, član bez računa po imenu; dani iznad 8 h kroz projekte', () => {
    const members = [m('a1', 'A', 'Ana Horvat', 'u1'), m('b1', 'B', '  ana  horvat '), m('b2', 'B', 'Ivo Ivić'), m('c2', 'C', 'Ivo Ivić', null, 1600)];
    const res = personWorkload(members, [
      { memberId: 'a1', date: '2027-02-01', minutes: 300 }, { memberId: 'b1', date: '2027-02-01', minutes: 240 }, // 9 h kroz dva projekta
      { memberId: 'a1', date: '2027-02-02', minutes: 480 }, // točno 8 h – nije prekoračenje
      { memberId: 'b2', date: '2027-01-10', minutes: 120 }, { memberId: 'c2', date: '2026-12-10', minutes: 60 },
    ], { months: ['2027-01', '2027-02'], year: '2027' });
    expect(res).toHaveLength(2);
    const ana = res.find((p) => p.userId === 'u1')!;
    expect(ana).toMatchObject({ name: 'Ana Horvat', projectIds: ['A', 'B'], yearMinutes: 1020, months: [{ month: '2027-01', minutes: 0 }, { month: '2027-02', minutes: 1020 }], overAnnual: false });
    expect(ana.overDays).toEqual([{ date: '2027-02-01', minutes: 540, projects: 2 }]);
    const ivo = res.find((p) => p.name === 'Ivo Ivić')!;
    expect(ivo).toMatchObject({ userId: null, projectIds: ['B', 'C'], yearMinutes: 120, annualLimitHours: 1600, overDays: [] });
    expect(res[0]).toBe(ana); // osobe s upozorenjima prve
  });
  it('osoba na jednom projektu; prekoračenje godišnjeg fonda; dani druge godine se ne broje u godinu', () => {
    const days = Array.from({ length: 220 }, (_, i) => ({ memberId: 'x', date: `2027-${String(1 + Math.floor(i / 20)).padStart(2, '0')}-${String(1 + (i % 20)).padStart(2, '0')}`, minutes: 480 }));
    const [p] = personWorkload([m('x', 'A', 'Petra Kos')], [...days, { memberId: 'x', date: '2026-12-31', minutes: 480 }], { months: ['2027-11'], year: '2027' });
    expect(p).toMatchObject({ projectIds: ['A'], yearMinutes: 220 * 480, annualLimitHours: 1720, overAnnual: true, overDays: [] });
    expect(p!.months).toEqual([{ month: '2027-11', minutes: 20 * 480 }]);
    const [q] = personWorkload([m('y', 'A', 'Bez fonda', null, null)], [{ memberId: 'y', date: '2027-01-04', minutes: 600 }], { months: [], year: '2027' });
    expect(q).toMatchObject({ annualLimitHours: null, overAnnual: false, overDays: [{ date: '2027-01-04', minutes: 600, projects: 1 }] });
  });
});

describe('prijave', () => {
  it('uspješnost: financirane i ugovorene prema odbijenima', () => {
    expect(successRate(['funded', 'contracted', 'rejected', 'reserve', 'withdrawn', 'preparation'])).toEqual({ funded: 2, rejected: 1, percent: 67 });
    expect(successRate(['preparation'])).toEqual({ funded: 0, rejected: 0, percent: null });
  });
});
