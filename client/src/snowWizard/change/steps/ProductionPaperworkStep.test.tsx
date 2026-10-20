// ProductionPaperworkStep.test.tsx — Proves the paperwork step is skipped with its reason, and otherwise offers the email and the PDF.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { openChangePlanForPrinting } from '../../../views/SnowHub/rcp/changePlanDocument.ts';
import { useCrgState } from '../../../views/SnowHub/hooks/useCrgState.ts';
import { createChangeWizardSession } from '../changeWizardSession.ts';
import type { PaperworkNeed } from '../changeWizardSteps.ts';
import ProductionPaperworkStep from './ProductionPaperworkStep.tsx';

vi.mock('../../../services/jiraApi.ts', () => ({ jiraGet: vi.fn(async () => []) }));
vi.mock('../../../services/snowApi.ts', () => ({ snowFetch: vi.fn() }));
vi.mock('../../../views/SnowHub/rcp/changePlanDocument.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../views/SnowHub/rcp/changePlanDocument.ts')>()),
  openChangePlanForPrinting: vi.fn(() => true),
}));

const NEEDED: PaperworkNeed = { isNeeded: true, reason: 'This Production change falls in the restricted change period, so a Director must approve it.' };
const NOT_NEEDED: PaperworkNeed = { isNeeded: false, reason: 'No Production environment is in this change, so no approval email or change plan PDF is needed.' };

function Harness({ paperworkNeed, updateSession, isProduction }: { paperworkNeed: PaperworkNeed; updateSession: () => void; isProduction: boolean }) {
  const crg = useCrgState({ storageKey: `snowWizard:change:paperwork-${String(isProduction)}` });
  const draft = isProduction ? { ...crg.state, prdEnvironment: { ...crg.state.prdEnvironment, isEnabled: true, plannedStartDate: '2026-11-07T19:00', plannedEndDate: '2026-11-07T21:00' } } : crg.state;
  return <ProductionPaperworkStep crg={{ ...crg, state: draft }} session={createChangeWizardSession('create')} updateSession={updateSession} goToStep={vi.fn()} paperworkNeed={paperworkNeed} />;
}

describe('ProductionPaperworkStep', () => {
  it('is skipped with the reason when it is not needed', () => {
    render(<Harness paperworkNeed={NOT_NEEDED} updateSession={vi.fn()} isProduction={false} />);
    expect(screen.getByText(/Nothing to do here\. No Production environment/)).toBeTruthy();
  });

  it('offers the email prompt and the change plan, and counts either as done', () => {
    const updateSession = vi.fn();
    render(<Harness paperworkNeed={NEEDED} updateSession={updateSession} isProduction />);
    expect(screen.getByRole('button', { name: 'Copy the email prompt' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open the change plan to save as PDF' }));
    expect(openChangePlanForPrinting).toHaveBeenCalledWith(expect.stringContaining('New change'));
    expect(updateSession).toHaveBeenCalledWith({ isPaperworkDone: true });

    fireEvent.change(screen.getByLabelText(/Paste the assistant/), { target: { value: '=== EMAIL ===\nHello Dana, please approve.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read the email' }));
    expect(screen.getByDisplayValue('Hello Dana, please approve.')).toBeTruthy();
  });
});
