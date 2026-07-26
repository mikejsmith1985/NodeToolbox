// PiPlanCapacityMap.test.tsx — The capacity map (spec 028, US2): committed==assigned, over-allocation flagged.

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PiPlanCapacityMap } from './PiPlanCapacityMap.tsx';
import type { PersonCapacity, PlanResult } from '../../FeatureCanvas/planner/capacityTypes.ts';

const PEOPLE: PersonCapacity[] = [
  { displayName: 'Dev One', roles: ['dev'], pointsPerSprint: 5 },
  { displayName: 'QA One', roles: ['internalTest'], pointsPerSprint: 5 },
];

const PLAN_RESULT: PlanResult = {
  sprints: [
    {
      index: 1, name: '26.3.1', startIso: '2026-05-21', endIso: '2026-06-03', isBeyondPiEnd: false, scheduledPoints: 8,
      loads: [
        { displayName: 'Dev One', devPoints: 6, internalTestPoints: 0, externalTestPoints: 0, itemKeys: ['x'] }, // over 5
        { displayName: 'QA One', devPoints: 0, internalTestPoints: 2, externalTestPoints: 0, itemKeys: ['x'] },
      ],
    },
  ],
  proposals: [],
  bottleneck: { limitingRole: null, additionalToMatchThroughput: 0, additionalToFinishByPiEnd: 0, statement: '' },
  completionSprintIndex: 1, completionDateIso: '2026-06-03', sprintsBeyondPiEnd: 0, unschedulableItemKeys: [],
};

describe('PiPlanCapacityMap', () => {
  it('shows committed/available per person and flags over-allocation', () => {
    render(<PiPlanCapacityMap planResult={PLAN_RESULT} people={PEOPLE} />);
    const devRow = screen.getByText('Dev One').closest('tr')!;
    const devCell = within(devRow).getAllByRole('cell')[0];
    expect(devCell.textContent).toContain('6/5');
    expect(devCell.getAttribute('data-over-allocated')).toBe('true'); // committed 6 > available 5

    const qaRow = screen.getByText('QA One').closest('tr')!;
    const qaCell = within(qaRow).getAllByRole('cell')[0];
    expect(qaCell.textContent).toContain('2/5');
    expect(qaCell.getAttribute('data-over-allocated')).toBe('false');
  });
});
