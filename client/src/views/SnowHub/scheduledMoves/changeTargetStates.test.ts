// changeTargetStates.test.ts — Which states a change can be booked to move to.

import { describe, expect, it } from 'vitest';

import { listTargetStatesForChange } from './changeTargetStates.ts';

describe('listTargetStatesForChange — only where the change can actually go', () => {
  it('offers ServiceNow-s own next states for a Scheduled change', () => {
    expect(listTargetStatesForChange('-2').map((option) => option.label)).toEqual(['Implement', 'Cancel']);
  });

  it('falls back to every state when the current one is not in the map, rather than to nothing', () => {
    expect(listTargetStatesForChange('999').length).toBeGreaterThan(1);
  });
});
