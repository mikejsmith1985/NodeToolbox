// PiDeliveryMonitor.test.tsx — Smoke tests for the monitoring panel (spec 032, US5). Confirms the
// deterministic baseline renders from the plan and the live-refresh affordance is present.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import PiDeliveryMonitor from './PiDeliveryMonitor.tsx';
import type { DeliveryPlan } from './piPlan/piDeliveryEngine.ts';
import type { PiPlanningFactSheet } from './piPlan/piPlanTypes.ts';

function factSheet(): PiPlanningFactSheet {
  return {
    piName: '26.4', piStartIso: '2026-07-30', deliveryDeadlineIso: '2026-09-30', features: [],
    people: [{ displayName: 'SL', accountId: 'a', roles: ['internalTest'], pointsPerSprint: 6 }],
    sprints: [{ name: 'S1', startIso: '2026-07-30', endIso: '2026-08-12' }],
    releaseSchedule: { entries: [] }, repoAllowlist: [], fieldConfig: { inIntStatusNames: [], slDoneStatusNames: [], doneCategoryNames: [] },
    velocityByPerson: {}, notes: [],
  };
}

const plan: DeliveryPlan = {
  stories: [{
    tempId: 'Alpha#1', featureKey: 'DENP-1', summary: 'Alpha', sizePoints: 5, codingSubtasks: [], slAssignee: null,
    sprintName: 'S1', dates: { targetStartIso: '', internalTestEndIso: null, targetEndIso: '', deployIntIso: '', deployRelIso: '', deployProdIso: null, dueIso: null, derivations: {} }, warnings: [],
  }],
  planResult: { sprints: [], proposals: [], bottleneck: { limitingRole: null, additionalToMatchThroughput: 0, additionalToFinishByPiEnd: 0, statement: '' }, completionSprintIndex: 1, completionDateIso: null, sprintsBeyondPiEnd: 0, unschedulableItemKeys: [] },
  honestStates: [],
};

describe('PiDeliveryMonitor', () => {
  it('renders the deterministic planned baseline from the plan', () => {
    render(<PiDeliveryMonitor plan={plan} factSheet={factSheet()} featureLinkFieldId="customfield_100" />);
    expect(screen.getByText(/Monitor adherence/i)).toBeTruthy();
    // Baseline line for S1: 5 planned pts, SL capacity 6.
    expect(screen.getByText(/S1: 5 planned pts · SL capacity 6/)).toBeTruthy();
  });

  it('offers a live-refresh action', () => {
    render(<PiDeliveryMonitor plan={plan} factSheet={factSheet()} featureLinkFieldId="customfield_100" />);
    expect(screen.getByText(/Refresh live status/i)).toBeTruthy();
  });
});
