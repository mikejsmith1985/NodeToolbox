// piPlanFields.test.ts — Resolves plan-write field ids from the reused hygiene discovery.

import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ loadHygieneFieldConfig: vi.fn() }));
vi.mock('../../Hygiene/checks/hygieneFieldConfig.ts', () => ({ loadHygieneFieldConfig: mocks.loadHygieneFieldConfig }));

import { resolvePiPlanFieldIds } from './piPlanFields.ts';

describe('resolvePiPlanFieldIds', () => {
  it('takes the first discovered id per concept, Due is native duedate', async () => {
    mocks.loadHygieneFieldConfig.mockResolvedValue({
      targetStartFieldIds: ['customfield_20001', 'customfield_10101'],
      targetEndFieldIds: ['customfield_20002'],
      featureLinkFieldIds: ['customfield_20003'],
      programIncrementFieldIds: ['customfield_20004'],
    });
    const ids = await resolvePiPlanFieldIds();
    expect(ids.targetStart).toBe('customfield_20001');
    expect(ids.featureLink).toBe('customfield_20003');
    expect(ids.due).toBe('duedate');
  });

  it('falls back to platform defaults when a list is empty', async () => {
    mocks.loadHygieneFieldConfig.mockResolvedValue({
      targetStartFieldIds: [], targetEndFieldIds: [], featureLinkFieldIds: [], programIncrementFieldIds: [],
    });
    const ids = await resolvePiPlanFieldIds();
    expect(ids.targetStart).toBe('customfield_10101');
    expect(ids.targetEnd).toBe('customfield_10102');
    expect(ids.featureLink).toBe('customfield_10108');
    expect(ids.programIncrement).toBe('customfield_10301');
  });
});
