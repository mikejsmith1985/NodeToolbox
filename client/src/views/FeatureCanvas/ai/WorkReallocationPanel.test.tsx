// WorkReallocationPanel.test.tsx — Verifies the gated copy-out panel: gating, target-sprint selection,
// prompt assembly, additional-details persistence, copy, and each empty/degraded state.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAiAssistUnlocked } from '../../../store/aiAssistStore.ts';
import type { StandupRosterMember } from '../../SprintDashboard/hooks/useStandupRosterStore.ts';
import type { CanvasNode } from '../logic/canvasTypes.ts';
import type { CanvasContainer } from '../overlay/overlayModel.ts';
import { useReallocationDetailsStore } from './useReallocationDetailsStore.ts';
import { WorkReallocationPanel } from './WorkReallocationPanel.tsx';

const PI_NAME = 'PI 26.3 (05/21/26 - 07/29/26)';

/** One sprint box on the canvas — the selectable target. */
const SPRINT: CanvasContainer = {
  id: 'sprint-25', kind: 'sprint', title: 'Sprint 25',
  bounds: { x: 0, y: 0, width: 400, height: 260 }, capacityBudget: 20,
  provenance: { state: 'real', jiraSprintId: 25, jiraVersionName: null, startDateIso: null, endDateIso: null },
};

/** Builds a feature node whose child stories sit in the target sprint. */
function buildNode(): CanvasNode {
  return {
    issueKey: 'DENP-1', position: { x: 0, y: 0 }, size: null, priority: null, containerId: 'sprint-25',
    isExpanded: false, isParked: false, summary: 'Login feature', status: 'In Progress', statusCategoryKey: 'indeterminate',
    assignee: null, storyPoints: 5, health: 'green', completionPercent: 0, hygieneFlags: [],
    childStories: [
      { key: 'DENP-2', summary: 'Build API', status: 'In Development', statusCategoryKey: 'indeterminate', storyPoints: 3, assignee: 'Ada Lovelace', statusChangedIso: '2026-07-01T00:00:00.000Z' },
      { key: 'DENP-3', summary: 'Write tests', status: 'To Do', statusCategoryKey: 'new', storyPoints: 2, assignee: null, statusChangedIso: null },
    ],
    dependencies: [], businessValue: null, description: null, acceptanceCriteria: null, parkReason: null,
    storyPlacements: {}, pendingComment: '', attachments: [], effectivePoints: 5,
  };
}

const ROSTER: StandupRosterMember[] = [
  { id: 'm1', displayName: 'Ada Lovelace', assigneeQueryValue: 'Ada Lovelace', roleCapabilities: { canDevelop: true, canInternalTest: false, canExternalTest: false } },
  { id: 'm2', displayName: 'Grace Hopper', assigneeQueryValue: 'Grace Hopper', roleCapabilities: { canDevelop: false, canInternalTest: true, canExternalTest: false } },
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof WorkReallocationPanel>> = {}) {
  return render(
    <WorkReallocationPanel
      canvasNodes={overrides.canvasNodes ?? [buildNode()]}
      sprintContainers={overrides.sprintContainers ?? [SPRINT]}
      rosterMembers={overrides.rosterMembers ?? ROSTER}
      piName={overrides.piName ?? PI_NAME}
      teamProfileId="team-a"
      projectKey="DENP"
      onClose={overrides.onClose ?? vi.fn()}
    />,
  );
}

describe('WorkReallocationPanel', () => {
  beforeEach(() => {
    window.localStorage.clear();
    act(() => {
      setAiAssistUnlocked(true);
      useReallocationDetailsStore.setState({ additionalDetails: '', storageKey: null });
    });
  });

  afterEach(() => {
    act(() => setAiAssistUnlocked(false));
  });

  it('renders nothing when AI Assist is locked (manual parity)', () => {
    act(() => setAiAssistUnlocked(false));
    const { container } = renderPanel();
    expect(container).toBeEmptyDOMElement();
  });

  it('offers a target-sprint selector and assembles a prompt over the sprint work', () => {
    renderPanel();
    expect(screen.getByLabelText('Target sprint')).toBeInTheDocument();
    const prompt = screen.getByLabelText<HTMLTextAreaElement>('Re-allocation prompt').value;
    // Roster with roles, the assigned item, the target sprint, and the risk instruction must all be present.
    expect(prompt).toContain('Ada Lovelace');
    expect(prompt).toContain('DENP-2');
    expect(prompt).toContain('Sprint 25');
    expect(prompt.toLowerCase()).toContain('risk');
  });

  it('injects the additional-details text verbatim and persists it', () => {
    renderPanel();
    const constraint = 'ESI only has two devs who can work it';
    fireEvent.change(screen.getByLabelText('Additional details'), { target: { value: constraint } });

    // Persisted to the store (and its localStorage key) …
    expect(useReallocationDetailsStore.getState().additionalDetails).toBe(constraint);
    // … and reflected verbatim in the regenerated prompt.
    expect(screen.getByLabelText<HTMLTextAreaElement>('Re-allocation prompt').value).toContain(constraint);
  });

  it('copies the prompt without any ingest/apply step', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Copy prompt/ }));
    expect(writeText).toHaveBeenCalledTimes(1);
    // One-way: there is no paste/ingest control.
    expect(screen.queryByText(/Ingest/)).not.toBeInTheDocument();
  });

  it('warns when the roster has no role coverage', () => {
    renderPanel({ rosterMembers: [{ id: 'm3', displayName: 'No Roles', assigneeQueryValue: 'No Roles' }] });
    expect(screen.getByText(/role-aware reasoning is degraded/i)).toBeInTheDocument();
  });

  it('guides when there is no roster, no sprint, or no assigned work', () => {
    const noRoster = renderPanel({ rosterMembers: [] });
    expect(screen.getByText(/Add a team roster/i)).toBeInTheDocument();
    noRoster.unmount();

    const noSprint = renderPanel({ sprintContainers: [] });
    expect(screen.getByText(/Define a sprint on the canvas first/i)).toBeInTheDocument();
    noSprint.unmount();

    // A node whose stories are NOT in the target sprint → no assigned work.
    const strayNode = { ...buildNode(), containerId: 'sprint-99', storyPlacements: {} };
    renderPanel({ canvasNodes: [strayNode] });
    expect(screen.getByText(/No assigned work/i)).toBeInTheDocument();
  });
});
