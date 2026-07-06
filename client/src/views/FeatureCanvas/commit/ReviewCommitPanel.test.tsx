// ReviewCommitPanel.test.tsx — Verifies the pre-commit diff lists changes and writes nothing until commit.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CanvasNode } from '../logic/canvasTypes.ts';
import type { CanvasContainer } from '../overlay/overlayModel.ts';
import { ReviewCommitPanel } from './ReviewCommitPanel.tsx';

const SPRINT: CanvasContainer = {
  id: 'ctr-1', kind: 'sprint', title: 'Sprint 24', bounds: { x: 0, y: 0, width: 400, height: 300 },
  capacityBudget: 20,
  provenance: { state: 'real', jiraSprintId: 100, jiraVersionName: null, startDateIso: null, endDateIso: null },
};

function buildNode(): CanvasNode {
  return {
    issueKey: 'DENP-1', position: { x: 0, y: 0 }, size: null, priority: null, containerId: 'ctr-1',
    isExpanded: false, isParked: false, summary: '', status: '', statusCategoryKey: 'new',
    assignee: null, storyPoints: null, health: 'green', completionPercent: 0, hygieneFlags: [],
    childStories: [], dependencies: [], businessValue: null, description: null, acceptanceCriteria: null, parkReason: null, storyPlacements: {}, pendingComment: "", attachments: [], effectivePoints: 0,
  };
}

describe('ReviewCommitPanel', () => {
  it('lists the proposed change and states nothing is written until commit', () => {
    render(
      <ReviewCommitPanel
        canvasNodes={[buildNode()]}
        containers={[SPRINT]}
        sizeMapping={{ XS: 10, S: 20, M: 40, L: 60, XL: 80, XXL: 100 }}
        boardId={10}
        projectKey="DENP"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/DENP-1 → sprint "Sprint 24"/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is written to Jira until you press Commit/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Commit 1 change/ })).toBeInTheDocument();
  });

  it('shows per-sprint story-point load from selected child stories, recomputing as they toggle', () => {
    // A feature in the sprint with two 3pt child stories → 6pt of load against the 20pt budget.
    const feature: CanvasNode = {
      ...buildNode(),
      childStories: [
        { key: 'DENP-2', summary: 'A', status: 'To Do', statusCategoryKey: 'new', storyPoints: 3 },
        { key: 'DENP-3', summary: 'B', status: 'To Do', statusCategoryKey: 'new', storyPoints: 3 },
      ],
    };
    render(
      <ReviewCommitPanel canvasNodes={[feature]} containers={[SPRINT]} sizeMapping={{ XS: 10, S: 20, M: 40, L: 60, XL: 80, XXL: 100 }} boardId={10} projectKey="DENP" onClose={vi.fn()} />,
    );

    expect(screen.getByText(/Sprint load/)).toBeInTheDocument();
    expect(screen.getByText(/Sprint 24: 6 \/ 20 pt/)).toBeInTheDocument();

    // Unchecking one 3pt story drops the load to 3.
    fireEvent.click(screen.getByRole('checkbox', { name: /DENP-2/ }));
    expect(screen.getByText(/Sprint 24: 3 \/ 20 pt/)).toBeInTheDocument();
  });

  it('shows an empty-state message when there are no pending changes', () => {
    render(
      <ReviewCommitPanel canvasNodes={[]} containers={[]} sizeMapping={{ XS: 10, S: 20, M: 40, L: 60, XL: 80, XXL: 100 }} boardId={null} projectKey="DENP" onClose={vi.fn()} />,
    );
    expect(screen.getByText(/No pending changes/)).toBeInTheDocument();
  });
});
