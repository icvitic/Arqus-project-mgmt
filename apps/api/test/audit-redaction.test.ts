import { describe, it, expect } from 'vitest';
import { expenseIdsIn, HIDDEN, redactSalary, scrubSecrets } from '../src/audit/audit-redaction';

describe('Revizija: tajne i plaće (WP1.14b)', () => {
  it('tajne se uklanjaju na svim razinama; SHA-256 dokumenta i ostali podaci ostaju', () => {
    const d = scrubSecrets({ after: { email: 'a@b.hr', passwordHash: 'scrypt$x', nested: [{ mfaSecretEnc: 'abc', token: 't', apiKey: 'k' }], sha256: 'f00' }, meta: { newPassword: 'x', ip: '1.2.3.4' } });
    expect(d).toEqual({ after: { email: 'a@b.hr', passwordHash: HIDDEN, nested: [{ mfaSecretEnc: HIDDEN, token: HIDDEN, apiKey: HIDDEN }], sha256: 'f00' }, meta: { newPassword: HIDDEN, ip: '1.2.3.4' } });
  });

  it('godišnji trošak i troškovi osoblja skriveni; sati, opisi i drugi iznosi vidljivi', () => {
    const tm = redactSalary({ entity: 'team_member', entityId: 'm', action: 'update', diff: { before: { annualCostCents: 100, role: 'x' }, after: { annualCostCents: 200 } } }, new Set());
    expect(tm.diff).toEqual({ before: { annualCostCents: HIDDEN, role: 'x' }, after: { annualCostCents: HIDDEN } });
    expect(tm.redacted).toBe(true);
    const unset = redactSalary({ entity: 'team_member', entityId: 'm', action: 'create', diff: { after: { annualCostCents: null } } }, new Set());
    expect(unset).toMatchObject({ diff: { after: { annualCostCents: null } }, redacted: false });
    const ts = redactSalary({ entity: 'timesheet', entityId: 't', action: 'approve', diff: { meta: { month: '2027-02', expenses: [{ workPackageId: 'w', minutes: 480, amount: 16_000 }] } } }, new Set());
    expect(ts.diff!.meta).toEqual({ month: '2027-02', expenses: [{ workPackageId: 'w', minutes: 480, amount: HIDDEN }] });
    const manual = redactSalary({ entity: 'expense', entityId: 'e1', action: 'create', diff: { after: { amount: 5_000, source: 'manual' } } }, new Set());
    expect(manual).toMatchObject({ diff: { after: { amount: 5_000 } }, redacted: false });
    const personnel = redactSalary({ entity: 'expense', entityId: 'e2', action: 'recognition.correct', diff: { before: { recognised: 100 }, after: { recognised: 50, reason: 'r' } } }, new Set(['e2']));
    expect(personnel.diff).toEqual({ before: { recognised: HIDDEN }, after: { recognised: HIDDEN, reason: 'r' } });
    const claim = redactSalary({ entity: 'claim', entityId: 'c', action: 'decision.partially_approved', diff: { after: { approved: 900 }, meta: { reduced: [{ id: 'e2', amount: 100, recognised: 50 }, { id: 'e1', amount: 10, recognised: 0 }] } } }, new Set(['e2']));
    expect(claim.diff!.meta!.reduced).toEqual([{ id: 'e2', amount: HIDDEN, recognised: HIDDEN }, { id: 'e1', amount: 10, recognised: 0 }]);
    expect(claim.diff!.after).toEqual({ approved: 900 });
  });

  it('troškovi za provjeru izvora', () => {
    const id = '0f6c6f9e-1111-4c1e-9a7a-2b2b2b2b2b2b';
    expect(expenseIdsIn([{ entity: 'expense', entityId: id, action: 'x', diff: null }, { entity: 'claim', entityId: 'c', action: 'y', diff: { meta: { reduced: [{ id }] } } }, { entity: 'expense', entityId: 'nije-uuid', action: 'z', diff: null }])).toEqual([id]);
  });
});
