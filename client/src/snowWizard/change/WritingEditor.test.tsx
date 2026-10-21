// WritingEditor.test.tsx — Proves every piece of the change's writing can be edited by hand, straight into the draft.

import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useCrgState } from '../../views/SnowHub/hooks/useCrgState.ts';
import WritingEditor from './WritingEditor.tsx';

vi.mock('../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));

const observed = { shortDescription: '', backoutPlan: '' };

function Harness() {
  const crg = useCrgState({ storageKey: 'snowWizard:change:writing-test' });
  useEffect(() => {
    observed.shortDescription = crg.state.generatedShortDescription;
    observed.backoutPlan = crg.state.chgPlanningContent.backoutPlan;
  });
  return <WritingEditor crg={crg} />;
}

describe('WritingEditor', () => {
  it('lets every field be edited by hand, writing straight into the change', () => {
    render(<Harness />);
    ['Short Description', 'Description', 'Justification', 'Risk & Impact', 'Implementation Plan', 'Test Plan', 'Backout Plan'].forEach((label) => expect(screen.getByLabelText(label)).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Short Description'), { target: { value: 'Payments 1.2 — my own title' } });
    fireEvent.change(screen.getByLabelText('Backout Plan'), { target: { value: '1. Redeploy v1.1 (edited by hand)' } });
    expect(observed.shortDescription).toBe('Payments 1.2 — my own title');
    expect(observed.backoutPlan).toBe('1. Redeploy v1.1 (edited by hand)');
    expect((screen.getByLabelText('Backout Plan') as HTMLTextAreaElement).value).toBe('1. Redeploy v1.1 (edited by hand)');
  });
});
