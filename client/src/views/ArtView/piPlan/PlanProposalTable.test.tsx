// PlanProposalTable.test.tsx — Per-item accept/dismiss controls; existing items cannot be re-created.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlanProposalTable } from './PlanProposalTable.tsx';
import type { DatedItem, PlanItemProposal, ScheduledStory } from './piPlanTypes.ts';

const STORY: ScheduledStory = {
  tempId: 'ABC-1#1', featureKey: 'ABC-1', summary: 'Login form', sizePoints: 8, devPoints: 6,
  internalTestPoints: 2, hasTestableOutput: true, assignee: 'Dev One', sprintName: '26.3.1',
  sprintStartIso: '2026-05-21', sprintEndIso: '2026-06-03',
};
const DATES: DatedItem = {
  targetStartIso: '2026-05-21', internalTestEndIso: '2026-05-27', targetEndIso: '2026-05-28',
  deployIntIso: '2026-05-28', deployRelIso: '2026-06-04', deployProdIso: '2026-06-15', dueIso: '2026-06-15', derivations: {},
};

function items(status: PlanItemProposal['status'] = 'new'): PlanItemProposal[] {
  return [{ id: STORY.tempId, kind: 'story', status, parentKey: 'ABC-1', payload: STORY, dates: DATES, warnings: [] }];
}

describe('PlanProposalTable', () => {
  it('shows the empty message when there are no items', () => {
    render(<PlanProposalTable items={[]} onAccept={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/Nothing to plan/i)).toBeInTheDocument();
  });

  it('renders a story with owner + dates and fires accept/dismiss', () => {
    const onAccept = vi.fn();
    const onDismiss = vi.fn();
    render(<PlanProposalTable items={items()} onAccept={onAccept} onDismiss={onDismiss} />);
    expect(screen.getByText('Login form')).toBeInTheDocument();
    expect(screen.getByText(/Dev One/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onAccept).toHaveBeenCalledWith('ABC-1#1');
    expect(onDismiss).toHaveBeenCalledWith('ABC-1#1');
  });

  it('shows an existing item as already-in-Jira with no accept control', () => {
    render(<PlanProposalTable items={items('existing')} onAccept={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/Already in Jira/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument();
  });
});
