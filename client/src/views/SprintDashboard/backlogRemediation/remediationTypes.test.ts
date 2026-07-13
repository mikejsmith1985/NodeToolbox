// remediationTypes.test.ts — Pins the one behavioral constant the type module exports.

import { describe, expect, it } from 'vitest';

import { TERMINAL_REMEDIATION_STATUSES } from './remediationTypes.ts';

describe('TERMINAL_REMEDIATION_STATUSES', () => {
  it('is exactly the three statuses that hold an item out of the actionable queue', () => {
    // These drive reconcile's "stays decided until a material change" rule; snoozed/pending are deliberately absent.
    expect([...TERMINAL_REMEDIATION_STATUSES].sort()).toEqual(['canceled', 'dismissed', 'kept']);
  });

  it('excludes the actionable/time-based statuses', () => {
    expect(TERMINAL_REMEDIATION_STATUSES).not.toContain('pending');
    expect(TERMINAL_REMEDIATION_STATUSES).not.toContain('snoozed');
  });
});
