import { describe, it, expect } from 'vitest';
import { proposalReadiness, isReady, PROPOSAL_TRANSITIONS, isProposalEditable } from '../src/proposal.js';

describe('prijava', () => {
  const ok = { members: [{ country: 'HR', confirmed: true }, { country: 'IT', confirmed: true }, { country: 'DE', confirmed: true }], minPartners: 3, minCountries: 3, workPackages: 2, budgetTotal: 100, budgetLocked: true, hasLead: true, callOpen: true };
  it('spremna prijava', () => { expect(isReady(proposalReadiness(ok))).toBe(true); });
  it('nedostaci se navode pojedinačno', () => {
    const r = proposalReadiness({ ...ok, members: [{ country: 'HR', confirmed: true }, { country: 'HR', confirmed: false }], budgetLocked: false, callOpen: false });
    expect(r.filter((i) => !i.ok).map((i) => i.key)).toEqual(['consortium', 'confirmed', 'budget_locked', 'call_open']);
    expect(r[0]!.label).toMatch(/sada 2 iz 1/);
  });
  it('bez poziva nema provjere poziva; zadana pravila konzorcija 1/1', () => {
    const r = proposalReadiness({ ...ok, minPartners: undefined, minCountries: undefined, members: [{ country: 'HR', confirmed: true }], callOpen: null });
    expect(r.map((i) => i.key)).not.toContain('call_open');
    expect(isReady(r)).toBe(true);
  });
  it('prijelazi i uređivanje', () => {
    expect(PROPOSAL_TRANSITIONS.internal_review).toContain('preparation');
    expect(PROPOSAL_TRANSITIONS.internal_review).not.toContain('submitted'); // predaja je zasebna radnja
    expect(PROPOSAL_TRANSITIONS.contracted).toEqual([]);
    expect(isProposalEditable('preparation')).toBe(true);
    expect(isProposalEditable('internal_review')).toBe(false);
  });
});
