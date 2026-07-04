// ReviewCommitPanel.test.tsx — Verifies the pre-commit diff lists changes and writes nothing until commit.

import { render, screen } from '@testing-library/react';
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
    childStories: [], dependencies: [], businessValue: null, description: null, acceptanceCriteria: null, attachments: [], effectivePoints: 0,
  };
}

describe('ReviewCommitPanel', () => {
  it('lists the proposed change and states nothing is written until commit', () => {
    render(
      <ReviewCommitPanel
        canvasNodes={[buildNode()]}
        containers={[SPRINT]}
        sizeMapping={{ S: 1, M: 3, L: 5, XL: 8 }}
        boardId={10}
        projectKey="DENP"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/DENP-1 → sprint "Sprint 24"/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing is written to Jira until you press Commit/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Commit 1 change/ })).toBeInTheDocument();
  });

  it('shows an empty-state message when there are no pending changes', () => {
    render(
      <ReviewCommitPanel canvasNodes={[]} containers={[]} sizeMapping={{ S: 1, M: 3, L: 5, XL: 8 }} boardId={null} projectKey="DENP" onClose={vi.fn()} />,
    );
    expect(screen.getByText(/No pending changes/)).toBeInTheDocument();
  });
});
