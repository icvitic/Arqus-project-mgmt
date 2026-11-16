import { describe, it, expect } from 'vitest';
import { brusselsWallToUtc, heActionTypes, mapFtResult, selectFtCalls, type FtResult } from '../src/ft-import';

const topic = (over: Record<string, string[] | null> = {}): FtResult => ({ metadata: {
  identifier: ['HORIZON-CL5-2027-D6-01-03'], callIdentifier: ['HORIZON-CL5-2027-D6-01'], title: ['Zero-emission urban mobility'], frameworkProgramme: ['43108390'],
  typesOfAction: ['HORIZON  Research and Innovation Actions'], deadlineModel: ['single-stage'], startDate: ['2027-05-06T00:00:00.000+0000'],
  deadlineDate: ['2027-09-16T17:00:00.000+0000'], esDA_IngestDate: ['2027-01-10T10:00:00.000+0100'], ...over,
} });

describe('uvoz F&T', () => {
  it('briselsko vrijeme → UTC (ljeto +2, zima +1)', () => {
    expect(brusselsWallToUtc('2027-09-16T17:00:00.000+0000')).toBe('2027-09-16T15:00:00.000Z');
    expect(brusselsWallToUtc('2027-01-19T17:00:00.000+0000')).toBe('2027-01-19T16:00:00.000Z');
    expect(brusselsWallToUtc('nije datum')).toBeNull();
  });
  it('vrste akcije Horizon Europe', () => {
    expect(heActionTypes(['HORIZON  Research and Innovation Actions'])).toEqual(['RIA']);
    expect(heActionTypes(['HORIZON JU Innovation Actions'])).toEqual(['IA']);
    expect(heActionTypes(['HORIZON Coordination and Support Actions', 'HORIZON EIC Grants'])).toEqual(['CSA']);
    expect(heActionTypes(['HORIZON TMA MSCA Doctoral Networks'])).toEqual([]);
  });
  it('tema Horizon Europe → poziv s paketom, vrstom akcije i poveznicom', () => {
    expect(mapFtResult(topic())).toMatchObject({
      code: 'HORIZON-CL5-2027-D6-01-03', programme: 'Horizon Europe', packageId: 'horizon-europe-2021-2027', actionTypes: ['RIA'], opensAt: '2027-05-06',
      deadlines: [{ kind: 'submission', at: '2027-09-16T15:00:00.000Z' }],
      url: 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/HORIZON-CL5-2027-D6-01-03',
      summary: 'Vrsta akcije: HORIZON Research and Innovation Actions · Poziv: HORIZON-CL5-2027-D6-01 · Model roka: single-stage',
    });
  });
  it('dvofazni i višestruki rokovi; drugi programi bez paketa', () => {
    const two = mapFtResult(topic({ frameworkProgramme: ['43252405'], deadlineModel: ['two-stage'], deadlineDate: ['2028-03-05T17:00:00.000+0000', '2027-09-05T17:00:00.000+0000'], typesOfAction: ['LIFE Project Grants'] }))!;
    expect(two).toMatchObject({ programme: 'LIFE', packageId: null, actionTypes: [] });
    expect(two.deadlines.map((d) => d.kind)).toEqual(['stage1', 'stage2']);
    const multi = mapFtResult(topic({ deadlineModel: ['multiple cut-off'], deadlineDate: ['2027-09-16T17:00:00.000+0000', '2028-01-16T17:00:00.000+0000'] }))!;
    expect(multi.deadlines.map((d) => d.label)).toEqual(['rok 1', 'rok 2']);
    expect(mapFtResult(topic({ frameworkProgramme: ['99'], identifier: ['NEW-2027-X'] }))!.programme).toBe('NEW');
    expect(mapFtResult({ metadata: { title: ['bez oznake'] } })).toBeNull();
  });
  it('odabir: duplikati (zadnji uvoz), neispravni i istekli', () => {
    const r = selectFtCalls([
      topic(), topic({ title: ['Noviji naslov'], esDA_IngestDate: ['2027-02-01T10:00:00.000+0100'] }), topic({ title: ['Stariji'], esDA_IngestDate: ['2026-12-01T10:00:00.000+0100'] }),
      topic({ identifier: ['OLD-2023'], deadlineDate: ['2023-09-21T17:00:00.000+0000'] }), { metadata: {} },
    ], new Date('2027-03-01T00:00:00Z'));
    expect(r.calls.map((c) => c.title)).toEqual(['Noviji naslov']);
    expect(r.skipped).toEqual({ duplicate: 2, invalid: 1, expired: 1 });
  });
});
