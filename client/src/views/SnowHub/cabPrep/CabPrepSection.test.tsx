// CabPrepSection.test.tsx — Preparing for CAB from a loaded change, with a scope you can see.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoadScope, mockUseAiAssist } = vi.hoisted(() => ({
  mockLoadScope: vi.fn(),
  mockUseAiAssist: vi.fn(),
}));

vi.mock('./cabScopeFetch.ts', () => ({ loadCabScopeIssues: mockLoadScope }));
vi.mock('../hooks/useAiAssist.ts', () => ({ useAiAssist: mockUseAiAssist }));

import { CabPrepSection } from './CabPrepSection.tsx';
import type { ChangeRequest } from '../../../types/snow.ts';

/** Class names are irrelevant here; the host tab supplies its own. */
const STYLES = new Proxy({}, { get: (_target, key) => String(key) }) as Record<string, string>;

function change(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    sysId: 'change-1',
    number: 'CHG0041298',
    shortDescription: 'Enrollment uplift',
    state: 'Scheduled',
    stateValue: '-2',
    assignedTo: { sysId: 'u1', name: 'Casey Engineer', email: '' },
    plannedStartDate: '2026-09-10 22:00:00',
    plannedEndDate: '2026-09-11 02:00:00',
    risk: 'Moderate',
    impact: 'Medium',
    description: 'Deploys ENCUC-2213 and ENCUC-2358.',
    justification: 'The current feed breaches its SLA.',
    riskImpactAnalysis: 'Medium.',
    implementationPlan: 'Deploy and verify.',
    backoutPlan: 'Redeploy the previous artefact.',
    testPlan: 'Regression pack in INT.',
    ...overrides,
  } as ChangeRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAiAssist.mockReturnValue({ isUnlocked: true });
  mockLoadScope.mockResolvedValue({ issues: [], missingKeys: [] });
});

describe('CabPrepSection', () => {
  it('renders nothing until AI Assist is unlocked', () => {
    // Same gate as every other AI affordance.
    mockUseAiAssist.mockReturnValue({ isUnlocked: false });
    const { container } = render(<CabPrepSection loadedChange={change()} styles={STYLES} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('seeds the scope from the keys the change itself names', () => {
    // Nothing in ServiceNow records which issues a change covers; its own text is the only trace.
    render(<CabPrepSection loadedChange={change()} styles={STYLES} />);

    const scopeField = screen.getByLabelText(/Jira issues to draw context from/) as HTMLTextAreaElement;
    expect(scopeField.value).toBe('ENCUC-2213 ENCUC-2358');
  });

  it('lets the seeded scope be edited before anything is loaded', () => {
    // A scope you cannot correct is one you simply have to trust.
    render(<CabPrepSection loadedChange={change()} styles={STYLES} />);
    const scopeField = screen.getByLabelText(/Jira issues to draw context from/);

    fireEvent.change(scopeField, { target: { value: 'ENCUC-9999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load these issues' }));

    expect(mockLoadScope).toHaveBeenCalledWith(['ENCUC-9999']);
  });

  it('starts clean for a different change, because the host remounts it by key', () => {
    // The host passes the change number as React's `key`, so a new change gets a new component and
    // every piece of state starts fresh — no reset effect to fight the edit it was meant to keep.
    const { rerender } = render(
      <CabPrepSection key="CHG0041298" loadedChange={change()} styles={STYLES} />,
    );
    fireEvent.change(screen.getByLabelText(/Jira issues to draw context from/), {
      target: { value: 'ENCUC-EDITED' },
    });

    rerender(<CabPrepSection
      key="CHG0050000"
      loadedChange={change({ number: 'CHG0050000', description: 'Deploys ENCUC-1.' })}
      styles={STYLES}
    />);

    expect((screen.getByLabelText(/Jira issues to draw context from/) as HTMLTextAreaElement).value)
      .toBe('ENCUC-1');
  });

  it('keeps an edit across a plain re-render of the SAME change', () => {
    // The bug a reset effect would have introduced: any parent re-render wiping what was typed.
    const { rerender } = render(<CabPrepSection loadedChange={change()} styles={STYLES} />);
    fireEvent.change(screen.getByLabelText(/Jira issues to draw context from/), {
      target: { value: 'ENCUC-EDITED' },
    });

    rerender(<CabPrepSection loadedChange={change()} styles={STYLES} />);

    expect((screen.getByLabelText(/Jira issues to draw context from/) as HTMLTextAreaElement).value)
      .toBe('ENCUC-EDITED');
  });

  it('names keys the change mentions that Jira could not return', async () => {
    // A pack built from twenty-eight of thirty answers "is everything finished?" from an incomplete
    // picture.
    mockLoadScope.mockResolvedValue({ issues: [], missingKeys: ['ENCUC-2358'] });
    render(<CabPrepSection loadedChange={change()} styles={STYLES} />);

    fireEvent.click(screen.getByRole('button', { name: 'Load these issues' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('ENCUC-2358');
  });

  it('says what it ignored rather than dropping it silently', async () => {
    render(<CabPrepSection loadedChange={change()} styles={STYLES} />);
    fireEvent.change(screen.getByLabelText(/Jira issues to draw context from/), {
      target: { value: 'ENCUC-1 banana' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Load these issues' }));

    expect(await screen.findByText(/Ignored, not a Jira key: banana/)).toBeInTheDocument();
  });

  it('builds a prompt naming the change and its scope', async () => {
    render(<CabPrepSection loadedChange={change()} styles={STYLES} />);

    fireEvent.click(screen.getByRole('button', { name: 'Prepare for CAB review' }));

    const promptField = await screen.findByLabelText(/Copy this prompt into AI Assist/) as HTMLTextAreaElement;
    expect(promptField.value).toContain('CHG0041298');
    expect(promptField.value).toContain('Redeploy the previous artefact.');
  });

  it('builds the pack from a pasted reply, leading with what cannot be answered', async () => {
    render(<CabPrepSection loadedChange={change()} styles={STYLES} />);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare for CAB review' }));

    fireEvent.change(await screen.findByLabelText(/Paste the assistant/), {
      target: {
        value: JSON.stringify({
          kind: 'cabPrep',
          answers: [
            { questionId: 'why-now', answer: 'The contract lapses on the 30th.', isUnanswerable: false, whatWouldAnswerIt: '' },
            { questionId: 'backout-tested', answer: '', isUnanswerable: true, whatWouldAnswerIt: 'A recorded rehearsal.' },
          ],
        }),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Build the CAB pack' }));

    await waitFor(() => expect(screen.getByText(/CAB preparation pack/)).toBeInTheDocument());
    expect(screen.getByText(/Cannot be answered from what is recorded/)).toBeInTheDocument();
  });

  it('refuses a reply meant for a different prompt', async () => {
    render(<CabPrepSection loadedChange={change()} styles={STYLES} />);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare for CAB review' }));

    fireEvent.change(await screen.findByLabelText(/Paste the assistant/), {
      target: { value: JSON.stringify({ kind: 'piReview', items: [] }) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Build the CAB pack' }));

    expect(await screen.findByText(/not "cabPrep"/)).toBeInTheDocument();
  });

  it('reports an empty change field rather than answering from it', async () => {
    // The whole safety property: a pack that answers smoothly from a field nobody filled in has
    // invented the reassurance.
    render(<CabPrepSection loadedChange={change({ backoutPlan: '' })} styles={STYLES} />);

    fireEvent.click(screen.getByRole('button', { name: 'Prepare for CAB review' }));

    const promptField = await screen.findByLabelText(/Copy this prompt into AI Assist/) as HTMLTextAreaElement;
    expect(promptField.value).toContain('Empty change fields: Backout plan');
  });
});
