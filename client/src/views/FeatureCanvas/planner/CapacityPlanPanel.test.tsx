// CapacityPlanPanel.test.tsx — Verifies the read-only Capacity Plan panel (feature 013, Layer 4a).
//
// The panel's run() does a real network fetch, so the projection RENDERING is exercised directly through
// the presentational <PlanProjectionView> with a fixture PlanResult (no network). The panel itself is
// tested for its controls (bucket checkboxes + Build button) without triggering a fetch.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PlanResult } from './capacityTypes.ts';
import { CapacityPlanPanel, PlanProjectionView } from './CapacityPlanPanel.tsx';

/** A small, fully-formed PlanResult so the projection can render without any pipeline run. */
function buildFixtureResult(): PlanResult {
  return {
    sprints: [
      {
        index: 1,
        startIso: '2026-05-21',
        endIso: '2026-06-03',
        isBeyondPiEnd: false,
        scheduledPoints: 12,
        loads: [
          { displayName: 'Dana Dev', devPoints: 8, internalTestPoints: 0, externalTestPoints: 0, itemKeys: ['DENP-2'] },
          { displayName: 'Tina Test', devPoints: 0, internalTestPoints: 4, externalTestPoints: 0, itemKeys: ['DENP-2'] },
        ],
      },
    ],
    proposals: [],
    bottleneck: {
      limitingRole: 'internalTest',
      additionalToMatchThroughput: 2,
      additionalToFinishByPiEnd: 1,
      statement: 'Internal testing is the bottleneck; add 2 internal testers.',
    },
    completionSprintIndex: 1,
    completionDateIso: '2026-06-03',
    sprintsBeyondPiEnd: 0,
    unschedulableItemKeys: [],
  };
}

describe('PlanProjectionView (presentational)', () => {
  it('renders the bottleneck statement, a sprint, and a person load from a fixture', () => {
    render(<PlanProjectionView result={buildFixtureResult()} piName="PI 26.3" />);
    expect(screen.getByText(/Internal testing is the bottleneck/)).toBeInTheDocument();
    expect(screen.getByText(/2026-05-21 → 2026-06-03/)).toBeInTheDocument();
    expect(screen.getByText(/Dana Dev — 8 dev \/ 0 int \/ 0 ext/)).toBeInTheDocument();
  });

  it('copies the plain-text summary to the clipboard when Copy summary is clicked', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<PlanProjectionView result={buildFixtureResult()} piName="PI 26.3" />);
    fireEvent.click(screen.getByRole('button', { name: /Copy summary/ }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain('Internal testing is the bottleneck');
  });
});

describe('CapacityPlanPanel (controls)', () => {
  function renderPanel(overrides: Partial<React.ComponentProps<typeof CapacityPlanPanel>> = {}) {
    return render(
      <CapacityPlanPanel
        canvasNodes={overrides.canvasNodes ?? []}
        rosterMembers={overrides.rosterMembers ?? []}
        projectKey={overrides.projectKey ?? 'DENP'}
        piName={overrides.piName ?? 'PI 26.3'}
        storyPointsFieldId={overrides.storyPointsFieldId ?? 'customfield_10016'}
        onClose={overrides.onClose ?? vi.fn()}
      />,
    );
  }

  it('offers the four bucket checkboxes with Must/Should/Could on and Won\'t off by default', () => {
    renderPanel();
    expect(screen.getByLabelText('Must')).toBeChecked();
    expect(screen.getByLabelText('Should')).toBeChecked();
    expect(screen.getByLabelText('Could')).toBeChecked();
    expect(screen.getByLabelText("Won't")).not.toBeChecked();
    expect(screen.getByRole('button', { name: /Build plan/ })).toBeInTheDocument();
  });

  it('surfaces a clear error when Build is clicked with no roster', () => {
    renderPanel({ rosterMembers: [] });
    fireEvent.click(screen.getByRole('button', { name: /Build plan/ }));
    expect(screen.getByRole('alert')).toHaveTextContent(/No roster/i);
  });

  it('toggles a bucket off when its checkbox is clicked', () => {
    renderPanel();
    const mustCheckbox = screen.getByLabelText('Must');
    fireEvent.click(mustCheckbox);
    expect(mustCheckbox).not.toBeChecked();
  });
});
