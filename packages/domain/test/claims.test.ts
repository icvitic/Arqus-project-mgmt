import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { claimChecklist, claimDecision, claimTotals, effectiveAmount, monthsInPeriod, paymentIssues, type ClaimChecklistInput } from '../src/claims.js';
import type { ProgrammePackage } from '../src/programme-package.js';

const here = dirname(fileURLToPath(import.meta.url));
const npoo = JSON.parse(readFileSync(join(here, '..', '..', '..', 'docs', 'domena', 'paketi', 'npoo-2021-2026.v1.json'), 'utf-8')) as ProgrammePackage;
// NPOO: neizravni (NT) 15 % od osoblja (OS), financiranje 100 %. Za stopu financiranja ispod 100 % – izmijenjena kopija.
const npoo80: ProgrammePackage = { ...npoo, actionTypes: npoo.actionTypes.map((a) => ({ ...a, fundingRates: [{ beneficiaryType: 'default', ratePercent: 80 }] })) };

const period = { startDate: '2027-01-01', endDate: '2027-06-30' };
const base = (over: Partial<ClaimChecklistInput> = {}): ClaimChecklistInput => ({
  today: '2027-07-15', period,
  expenses: [
    { id: 'os1', date: '2027-02-28', description: 'Rad: Ana, 2027-02', amount: 100_000, categoryCode: 'OS', source: 'timesheet', documents: 0 },
    { id: 'vu1', date: '2027-03-10', description: 'Anketa', amount: 250_000, categoryCode: 'VU', source: 'manual', documents: 1 },
  ],
  timesheets: [{ memberName: 'Ana', month: '2027-02', status: 'approved', minutes: 600 }],
  budget: [{ categoryCode: 'OS', planned: 2_000_000, claimedBefore: 0 }, { categoryCode: 'VU', planned: 1_000_000, claimedBefore: 0 }],
  ...over,
});
const item = (c: ReturnType<typeof claimChecklist>, key: string) => c.items.find((i) => i.key === key)!;

describe('popis za provjeru prije predaje ZNS-a', () => {
  it('sve u redu nakon kraja razdoblja: predaja moguća, bez upozorenja', () => {
    const c = claimChecklist(base());
    expect(c).toMatchObject({ canSubmit: true, early: false, blocking: [], warnings: [] });
    expect(c.items.map((i) => i.key)).toEqual(['period_ended', 'has_expenses', 'timesheets_approved', 'evidence', 'dates_in_period', 'budget']);
  });

  it('razdoblje koje završava danas još traje – predaja je rana i traži razlog', () => {
    const c = claimChecklist(base({ today: '2027-06-30' }));
    expect(c.canSubmit).toBe(false); expect(c.early).toBe(true);
    expect(item(c, 'period_ended')).toMatchObject({ ok: false, severity: 'blocking', resolution: 'early_reason' });
    expect(claimChecklist(base({ today: '2027-07-01' })).canSubmit).toBe(true);
  });

  it('rana predaja s razlogom: dopuštena, zapisana kao upozorenje; prekratak razlog ne vrijedi', () => {
    const c = claimChecklist(base({ today: '2027-05-01', earlyReason: 'Završetak projekta po aneksu ugovora' }));
    expect(c.canSubmit).toBe(true); expect(c.early).toBe(true);
    expect(c.warnings.map((w) => w.key)).toEqual(['period_ended']);
    expect(item(c, 'period_ended').details.join(' ')).toMatch(/aneksu/);
    expect(claimChecklist(base({ today: '2027-05-01', earlyReason: '  ok ' })).canSubmit).toBe(false);
  });

  it('neodobreni timesheetovi blokiraju i navode se (nacrt bez sati se ne broji)', () => {
    const c = claimChecklist(base({ timesheets: [
      { memberName: 'Ana', month: '2027-02', status: 'approved', minutes: 600 },
      { memberName: 'Marko', month: '2027-03', status: 'submitted', minutes: 480 },
      { memberName: 'Ana', month: '2027-04', status: 'draft', minutes: 120 },
      { memberName: 'Iva', month: '2027-05', status: 'draft', minutes: 0 },
    ] }));
    expect(c.canSubmit).toBe(false);
    expect(item(c, 'timesheets_approved').details).toEqual(['Marko, 2027-03 (čeka odobrenje, 8 h)', 'Ana, 2027-04 (nacrt, 2 h)']);
  });

  it('ručni trošak bez dokaza blokira dok se ne potvrdi; trošak osoblja ne traži dokaz', () => {
    const exp = [...base().expenses, { id: 'put', date: '2027-04-02', description: 'Put', amount: 30_000, categoryCode: 'PUT', source: 'manual', documents: 0 }];
    const c = claimChecklist(base({ expenses: exp }));
    expect(c.canSubmit).toBe(false);
    expect(item(c, 'evidence')).toMatchObject({ ok: false, resolution: 'acknowledge', expenseIds: ['put'] });
    const ok = claimChecklist(base({ expenses: exp, acknowledgedWithoutEvidence: ['put'], budget: [...base().budget, { categoryCode: 'PUT', planned: 100_000, claimedBefore: 0 }] }));
    expect(ok.canSubmit).toBe(true);
    expect(ok.warnings.map((w) => w.key)).toEqual(['evidence']);
    expect(claimChecklist(base({ expenses: exp, acknowledgedWithoutEvidence: ['drugi'] })).canSubmit).toBe(false);
  });

  it('trošak izvan razdoblja i prazan zahtjev blokiraju', () => {
    const c = claimChecklist(base({ expenses: [{ id: 'x', date: '2027-07-02', description: 'Kasni', amount: 1, categoryCode: 'VU', source: 'manual', documents: 1 }] }));
    expect(item(c, 'dates_in_period').ok).toBe(false);
    expect(claimChecklist(base({ expenses: [] })).blocking.map((b) => b.key)).toEqual(['has_expenses']);
  });

  it('kumulativno prekoračenje kategorije je upozorenje, ne blokada', () => {
    const c = claimChecklist(base({ budget: [{ categoryCode: 'OS', planned: 2_000_000, claimedBefore: 0 }, { categoryCode: 'VU', name: 'Vanjske usluge', planned: 1_000_000, claimedBefore: 800_000 }] }));
    expect(c.canSubmit).toBe(true);
    expect(item(c, 'budget')).toMatchObject({ ok: false, severity: 'warning' });
    expect(item(c, 'budget').details[0]).toMatch(/^VU Vanjske usluge: ukupno 10\.500,00 EUR uz ugovoreno 10\.000,00 EUR/);
    // kategorija bez plana
    expect(claimChecklist(base({ budget: [] })).warnings[0]!.details).toHaveLength(2);
  });

  it('mjeseci razdoblja', () => {
    expect(monthsInPeriod('2026-11-01', '2027-02-28')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
});

describe('odluka po trošku i priznati iznos', () => {
  const exps = [
    { id: 'os1', categoryCode: 'OS', amount: 100_000 },
    { id: 'os2', categoryCode: 'OS', amount: 60_000 },
    { id: 'vu1', categoryCode: 'VU', amount: 250_000 },
  ];
  // traženo: 410.000 + 15 % od 160.000 = 434.000
  const requested = 434_000;

  it('bez odluka po trošku: sve priznato, odobren', () => {
    const d = claimDecision(npoo, 'BESPOVRATNA', 'default', { expenses: exps, decisions: [], requested });
    expect(d).toMatchObject({ outcome: 'approved', computed: 434_000, approved: 434_000, difference: 0, errors: [] });
    expect(d.unrecognised).toEqual({ direct: 0, indirect: 0, total: 0, requested: 0 });
  });

  it('djelomično na kategoriji s neizravnima: neizravni se smanjuju po pravilu paketa', () => {
    const d = claimDecision(npoo, 'BESPOVRATNA', 'default', { expenses: exps, decisions: [{ id: 'os2', recognised: 20_000, reason: 'Sati iznad ugovorenih' }], requested });
    expect(d.expenses.find((e) => e.id === 'os2')).toMatchObject({ status: 'partially_accepted', recognised: 20_000, reason: 'Sati iznad ugovorenih' });
    expect(d.recognised).toEqual({ direct: 370_000, indirect: 18_000, total: 388_000, requested: 388_000 });
    expect(d.unrecognised).toEqual({ direct: 40_000, indirect: 6_000, total: 46_000, requested: 46_000 });
    expect(d.outcome).toBe('partially_approved');
  });

  it('stopa financiranja ispod 100 % primjenjuje se na priznato', () => {
    const d = claimDecision(npoo80, 'BESPOVRATNA', 'default', { expenses: exps, decisions: [{ id: 'vu1', recognised: 0, reason: 'Nema dokaza o plaćanju' }], requested: 347_200 });
    expect(d.recognised).toMatchObject({ total: 184_000, requested: 147_200 });
    expect(d.expenses.find((e) => e.id === 'vu1')!.status).toBe('rejected');
  });

  it('sve odbijeno: ishod odbijen, priznato 0', () => {
    const d = claimDecision(npoo, 'BESPOVRATNA', 'default', { expenses: exps, decisions: exps.map((e) => ({ id: e.id, recognised: 0, reason: 'Neprihvatljivo razdoblje' })), requested });
    expect(d).toMatchObject({ outcome: 'rejected', computed: 0, approved: 0, errors: [] });
    expect(d.unrecognised.requested).toBe(434_000);
  });

  it('razlog je obavezan kod umanjenja; priznato ne smije biti veće od traženog ni trošak izvan zahtjeva', () => {
    const d = claimDecision(npoo, 'BESPOVRATNA', 'default', { expenses: exps, decisions: [{ id: 'vu1', recognised: 100 }, { id: 'os1', recognised: 100_001, reason: 'previše' }, { id: 'tuđi', recognised: 1 }], requested });
    expect(d.errors).toHaveLength(3);
    expect(d.errors.join(' | ')).toMatch(/razlog je obavezan.*veći je od traženog.*nije u zahtjevu/);
  });

  it('iznos financijera različit od izračunatog traži napomenu; s napomenom odobreni = iznos financijera', () => {
    const noNote = claimDecision(npoo, 'BESPOVRATNA', 'default', { expenses: exps, decisions: [], requested, funderTotal: 433_990 });
    expect(noNote.errors[0]).toMatch(/razlikuje se.*za .0,10 EUR/);
    const d = claimDecision(npoo, 'BESPOVRATNA', 'default', { expenses: exps, decisions: [], requested, funderTotal: 433_990, note: 'Zaokruživanje u odluci PT-a' });
    expect(d).toMatchObject({ errors: [], approved: 433_990, computed: 434_000, difference: -10, outcome: 'partially_approved' });
    // isti iznos financijera kao izračunati: bez napomene
    expect(claimDecision(npoo, 'BESPOVRATNA', 'default', { expenses: exps, decisions: [], requested, funderTotal: 434_000 }).errors).toEqual([]);
  });

  it('ostvareno: prije odluke traženi iznos, nakon odluke priznati, odbijeno 0', () => {
    expect(effectiveAmount({ amount: 500 })).toBe(500);
    expect(effectiveAmount({ amount: 500, recognised: null })).toBe(500);
    expect(effectiveAmount({ amount: 500, recognised: 200 })).toBe(200);
    expect(effectiveAmount({ amount: 500, recognised: 0 })).toBe(0);
    const t = claimTotals(npoo, 'BESPOVRATNA', 'default', [{ categoryCode: 'OS', amount: 1000, recognised: 0 }, { categoryCode: 'VU', amount: 500 }]);
    expect([t.claimed.total, t.recognised.total, t.unrecognised.total]).toEqual([1650, 500, 1150]);
  });
});

describe('isplata', () => {
  const ok = { paidAt: '2027-09-15', paidAmount: 1000, decisionDate: '2027-09-01', approved: 1000, today: '2027-09-20' };
  it('ispravna isplata', () => { expect(paymentIssues(ok)).toEqual([]); });
  it('prije odluke, u budućnosti, razlika bez napomene', () => {
    expect(paymentIssues({ ...ok, paidAt: '2027-08-31' })[0]).toMatch(/prije datuma odluke/);
    expect(paymentIssues({ ...ok, paidAt: '2027-09-21' })[0]).toMatch(/u budućnosti/);
    expect(paymentIssues({ ...ok, paidAmount: 900 })[0]).toMatch(/razlikuje se od odobrenog/);
    expect(paymentIssues({ ...ok, paidAmount: 900, note: 'Prijeboj s povratom' })).toEqual([]);
  });
});

describe('troškovi iz ranijih razdoblja (WP1.16b)', () => {
  const late = { id: 'late', date: '2026-12-15', description: 'Kasno evidentiran račun', amount: 40_000, categoryCode: 'VU', source: 'manual', documents: 1 };
  it('izričito uključen trošak iz ranijeg razdoblja ne ruši provjeru datuma; ulazi u broj, dokaze i proračun', () => {
    const c = claimChecklist(base({ earlier: [late] }));
    expect(c.canSubmit).toBe(true);
    expect(item(c, 'dates_in_period')).toMatchObject({ ok: true, title: 'Svi ostali troškovi su unutar razdoblja' });
    expect(item(c, 'has_expenses').title).toBe('3 troška u zahtjevu (od toga 1 iz ranijih razdoblja)');
    expect(item(c, 'earlier_periods')).toMatchObject({ ok: true, severity: 'warning', resolution: 'select_earlier' });
    expect(c.warnings.map((w) => w.key)).toEqual(['earlier_periods']);
    const noEvidence = claimChecklist(base({ earlier: [{ ...late, documents: 0 }] }));
    expect(item(noEvidence, 'evidence')).toMatchObject({ ok: false, expenseIds: ['late'] });
    const over = claimChecklist(base({ earlier: [{ ...late, amount: 800_000 }] }));
    expect(item(over, 'budget').ok).toBe(false);
  });
  it('neuključeni nepredani troškovi ranijih razdoblja su upozorenje (ne blokiraju)', () => {
    const c = claimChecklist(base({ earlierNotSelected: [{ date: '2026-12-15', description: 'Kasno evidentiran račun', amount: 40_000, period: 1 }] }));
    expect(c.canSubmit).toBe(true);
    expect(item(c, 'earlier_periods')).toMatchObject({ ok: false, severity: 'warning', title: '1 nepredan trošak iz ranijih razdoblja nije uključen' });
    expect(item(c, 'earlier_periods').details).toEqual(['nije uključeno: 15. 12. 2026. Kasno evidentiran račun (400,00 EUR, RP1)']);
  });
  it('bez troškova iz ranijih razdoblja stavka se ne prikazuje', () => {
    expect(claimChecklist(base()).items.some((i) => i.key === 'earlier_periods')).toBe(false);
  });
});
