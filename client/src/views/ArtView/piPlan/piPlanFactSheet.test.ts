// piPlanFactSheet.test.ts — The deterministic PI Planning Fact Sheet assembler (spec 032, contract fact-sheet.md).

import { describe, expect, it } from 'vitest';

import { assembleFactSheet, type FactSheetInputs } from './piPlanFactSheet.ts';

function baseInputs(overrides: Partial<FactSheetInputs> = {}): FactSheetInputs {
  return {
    piName: '26.4',
    piStartIso: '2026-07-30',
    sprints: [
      { name: '26.4.1', startIso: '2026-07-30', endIso: '2026-08-12' },
      { name: '26.4.2', startIso: '2026-08-13', endIso: '2026-08-26' },
      { name: '26.4.3', startIso: '2026-08-27', endIso: '2026-09-09' },
      { name: '26.4.4', startIso: '2026-09-10', endIso: '2026-09-23' },
      { name: '26.4.5', startIso: '2026-09-24', endIso: '2026-10-07' },
    ],
    features: [
      {
        key: 'DENP-100', summary: 'Enrollment enhancement', sizePoints: 8, priorityRank: 1, priorityName: 'High',
        isCommitted: true, componentNames: ['enrollment-api', 'Enrollment', 'enrollment-ui'],
        dependencyKeys: [], targetFixVersion: null, existingChildren: [],
      },
    ],
    people: [
      { displayName: 'Dev One', accountId: 'a1', roles: ['dev'], velocity: 10 },
      { displayName: 'SL Tester', accountId: 'a2', roles: ['internalTest'], velocity: 5 },
    ],
    releaseSchedule: { entries: [] },
    fieldConfig: { inIntStatusNames: ['In INT'], slDoneStatusNames: ['SL Done'], doneCategoryNames: ['Done'] },
    classifyComponent: (name) => (name === 'Enrollment' ? 'domain' : name.includes('-') ? 'repo' : 'unclassified'),
    ...overrides,
  };
}

describe('assembleFactSheet', () => {
  it('applies the 0.80 load factor exactly once to every person', () => {
    const sheet = assembleFactSheet(baseInputs());
    expect(sheet.people.find((p) => p.displayName === 'Dev One')?.pointsPerSprint).toBeCloseTo(8);   // 10 × 0.8
    expect(sheet.people.find((p) => p.displayName === 'SL Tester')?.pointsPerSprint).toBeCloseTo(4); // 5 × 0.8
    expect(sheet.velocityByPerson['Dev One']).toBe(10); // raw velocity preserved for reference
  });

  it('uses a selected capacity as the raw figure but still applies the load factor beneath it', () => {
    const sheet = assembleFactSheet({ ...baseInputs(), capacityPerSprintOverride: 10 });
    // Every person plans at 10 × 0.8 = 8 effective points, regardless of their measured velocity.
    expect(sheet.people.find((p) => p.displayName === 'Dev One')?.pointsPerSprint).toBeCloseTo(8);
    expect(sheet.people.find((p) => p.displayName === 'SL Tester')?.pointsPerSprint).toBeCloseTo(8);
    expect(sheet.velocityByPerson['Dev One']).toBe(10); // raw measured velocity still preserved for reference
  });

  it('splits components into repo vs domain and excludes unclassified', () => {
    const feature = assembleFactSheet(baseInputs()).features[0];
    expect(feature.repoComponentNames).toEqual(['enrollment-api', 'enrollment-ui']);
    expect(feature.domainComponentNames).toEqual(['Enrollment']);
  });

  it('builds the repo allowlist as the de-duped union of repo component names', () => {
    const inputs = baseInputs();
    inputs.features = [
      { ...inputs.features[0] },
      { ...inputs.features[0], key: 'DENP-101', componentNames: ['enrollment-api', 'notify-svc'] },
    ];
    const sheet = assembleFactSheet(inputs);
    expect([...sheet.repoAllowlist].sort()).toEqual(['enrollment-api', 'enrollment-ui', 'notify-svc']);
  });

  it('sets the delivery deadline to the end of Sprint-5 Week-1', () => {
    const sheet = assembleFactSheet(baseInputs());
    // Sprint 5 starts 2026-09-24; end of week 1 = start + 6 calendar days.
    expect(sheet.deliveryDeadlineIso).toBe('2026-09-30');
  });

  it('surfaces honest notes for an unsized Feature and a Feature with no repos', () => {
    const inputs = baseInputs();
    inputs.features = [
      { ...inputs.features[0], key: 'DENP-200', sizePoints: null },
      { ...inputs.features[0], key: 'DENP-201', componentNames: ['Enrollment'] }, // domain only → no repos
    ];
    const sheet = assembleFactSheet(inputs);
    expect(sheet.notes.some((n) => n.includes('DENP-200') && /not sized/i.test(n))).toBe(true);
    expect(sheet.notes.some((n) => n.includes('DENP-201') && /map repos/i.test(n))).toBe(true);
  });

  it('is immutable: mutating a returned array does not affect a second assemble', () => {
    const inputs = baseInputs();
    const first = assembleFactSheet(inputs);
    first.repoAllowlist.push('injected');
    first.features[0].repoComponentNames.push('injected');
    const second = assembleFactSheet(inputs);
    expect(second.repoAllowlist).not.toContain('injected');
    expect(second.features[0].repoComponentNames).not.toContain('injected');
  });
});
