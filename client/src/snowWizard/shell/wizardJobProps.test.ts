// wizardJobProps.test.ts — Proves Home's job list stays the three agreed jobs, in order.

import { describe, expect, it } from 'vitest';

import { WIZARD_JOB_IDS } from './wizardJobProps.ts';

describe('wizardJobProps', () => {
  it('lists the three jobs in Home order', () => {
    expect(WIZARD_JOB_IDS).toEqual(['change', 'prb', 'review']);
  });
});
