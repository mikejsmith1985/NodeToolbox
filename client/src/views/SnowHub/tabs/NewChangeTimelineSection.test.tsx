// NewChangeTimelineSection.test.tsx — Planning a new change's CTASK timeline with AI Assist before it is created.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NewChangeTimelineSection } from './NewChangeTimelineSection.tsx';

const STAGED_TASK = {
  id: 'staged-1', name: 'Business Checkout', createdAt: '', shortDescription: 'Review Business Checkout',
  description: 'PO confirms the enrolment screens.', assignmentGroup: { sysId: '', displayName: '' },
  assignedTo: { sysId: '', displayName: '' }, plannedStartDate: '', plannedEndDate: '', closeNotes: '',
};

/** The parts of the change builder's state the section reads. */
function buildState(overrides: Record<string, unknown> = {}) {
  return {
    changeTasks: [STAGED_TASK],
    reconcileAutoCtasks: false,
    ctaskTimelinePlan: [],
    prdEnvironment: { isEnabled: true, plannedStartDate: '2026-10-10T00:00', plannedEndDate: '2026-10-10T02:00' },
    relEnvironment: { isEnabled: false, plannedStartDate: '', plannedEndDate: '' },
    pfixEnvironment: { isEnabled: false, plannedStartDate: '', plannedEndDate: '' },
    ...overrides,
  } as unknown as Parameters<typeof NewChangeTimelineSection>[0]['state'];
}

describe('NewChangeTimelineSection', () => {
  it('plans the timeline over the tasks the change will get, and keeps the plan for create', () => {
    const onSetPlan = vi.fn();
    render(<NewChangeTimelineSection isAiAssistUnlocked onSetPlan={onSetPlan} state={buildState()} />);

    fireEvent.click(screen.getByRole('button', { name: /Plan the CTASK timeline with AI Assist/ }));
    const promptText = (document.querySelector('textarea[readonly]') as HTMLTextAreaElement).value;
    expect(promptText).toContain('Implementation (created by ServiceNow)');
    expect(promptText).toContain('Review Business Checkout');

    const implementationNumber = /(CTASK\d+) — Implementation \(created by ServiceNow\)/.exec(promptText)?.[1];
    const businessNumber = /(CTASK\d+) — Review Business Checkout/.exec(promptText)?.[1];
    fireEvent.change(screen.getByLabelText(/Paste the assistant/), {
      target: { value: `TIMELINE:\n${implementationNumber} | 45\n${businessNumber} | 30` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use this timeline' }));

    expect(onSetPlan).toHaveBeenCalledWith([
      { taskLabel: 'Implementation (created by ServiceNow)', minutes: 45 },
      { taskLabel: 'Review Business Checkout', minutes: 30 },
    ]);
  });

  it('shows the planned order once there is a plan', () => {
    render(
      <NewChangeTimelineSection
        isAiAssistUnlocked
        onSetPlan={vi.fn()}
        state={buildState({ ctaskTimelinePlan: [{ taskLabel: 'Review Business Checkout', minutes: 30 }] })}
      />,
    );

    expect(screen.getByText(/Review Business Checkout \(30 min\)/)).toBeInTheDocument();
  });

  it('shows nothing while AI Assist is locked', () => {
    const { container } = render(<NewChangeTimelineSection isAiAssistUnlocked={false} onSetPlan={vi.fn()} state={buildState()} />);

    expect(container).toBeEmptyDOMElement();
  });
});
