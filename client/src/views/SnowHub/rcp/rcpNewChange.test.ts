// rcpNewChange.test.ts — The RCP checklist for a change that has not been created yet (GH #415).

import { describe, expect, it } from 'vitest';

import { evaluateNewChangeRcp, readLocalDateTimeAsUtc, type NewChangeRcpInput } from './rcpNewChange.ts';

const INPUT: NewChangeRcpInput = {
  productionEnvironment: {
    label: 'PRD',
    plannedStartUtc: '2026-10-10T00:30:00Z',
    plannedEndUtc: '2026-10-10T08:00:00Z',
    configItem: { sysId: 'ci-1', displayName: 'Recon Service' },
  },
  totalEstimateMinutes: 150,
  requestedBy: { sysId: 'dir', displayName: 'Lee, Jordan' },
  justification: 'Must deploy during RCP; delaying until after Jan 19 misses the Nov 1 regulatory deadline.',
  shortDescription: 'Recon deploy',
  backoutPlan: 'Redeploy v1.4.',
  todayIso: '2026-10-05',
};

describe('evaluateNewChangeRcp', () => {
  it('judges the window and justification now, and says what can only be confirmed once the change exists', () => {
    const evaluation = evaluateNewChangeRcp(INPUT);

    expect(evaluation?.results.map((result) => [result.ruleId, result.status])).toEqual([
      ['window', 'pass'],
      ['director', 'check'],
      ['approval', 'check'],
      ['justification', 'pass'],
      ['leadTime', 'check'],
    ]);
    expect(evaluation?.results.find((result) => result.ruleId === 'approval')?.detail).toMatch(/once the change is created/i);
    expect(evaluation?.emailContext).toEqual(expect.objectContaining({ directorName: 'Lee, Jordan', configItemName: 'Recon Service', environmentLabel: 'PRD' }));
  });

  it('does not apply when no Production environment is enabled', () => {
    expect(evaluateNewChangeRcp({ ...INPUT, productionEnvironment: null })).toBeNull();
  });
});

describe('readLocalDateTimeAsUtc', () => {
  it('reads a typed local date-time as an instant, and nothing as nothing', () => {
    expect(readLocalDateTimeAsUtc('2026-10-09T19:30')).toBe(new Date('2026-10-09T19:30').toISOString());
    expect(readLocalDateTimeAsUtc('')).toBeNull();
    expect(readLocalDateTimeAsUtc('not a date')).toBeNull();
  });
});
