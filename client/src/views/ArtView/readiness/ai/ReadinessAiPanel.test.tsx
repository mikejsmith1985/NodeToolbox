// ReadinessAiPanel.test.tsx — Proves the readiness AI panel is gated, propose-only, and writes only
// the accepted date/estimate fields through the shared writers (never ownership).

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../SprintDashboard/featureReviewFixes.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../SprintDashboard/featureReviewFixes.ts')>()),
  saveFeatureReviewSimpleField: vi.fn().mockResolvedValue(undefined),
}));

import { ReadinessAiPanel } from './ReadinessAiPanel.tsx';
import { useAiAssistStore } from '../../../../store/aiAssistStore.ts';
import { saveFeatureReviewSimpleField } from '../../../SprintDashboard/featureReviewFixes.ts';
import type { ReadinessLens } from '../readinessScan.ts';

function buildLens(): ReadinessLens {
  return {
    id: 'current',
    piNames: ['PI 26.3'],
    features: [
      {
        issue: { key: 'F-1', fields: {} },
        key: 'F-1',
        summary: 'Feature one',
        statusName: 'Analyzing',
        statusBucket: 'todo',
        assigneeDisplayName: null,
        productOwnerDisplayName: null,
        estimateValue: null,
        pcodeValue: null,
        targetEndIso: null,
        dueDateIso: null,
        ageDays: 5,
        impedimentReasons: [],
        alerts: ['missing-estimate'],
      },
    ],
    countsByBucket: { todo: 1, inProgress: 0, done: 0 },
    refinedCount: 0,
    unrefinedCount: 0,
    isPiConfigured: true,
    isCoverageCapped: false,
  } as unknown as ReadinessLens;
}

const WRITE_FIELD_IDS = {
  productOwnerFieldId: 'customfield_20002',
  estimateFieldId: 'customfield_20007',
  pcodeFieldId: 'customfield_20008',
  targetEndFieldId: 'customfield_10102',
};

function renderPanel(onProposalWritten = vi.fn()) {
  render(
    <ReadinessAiPanel lens={buildLens()} writeFieldIds={WRITE_FIELD_IDS} onProposalWritten={onProposalWritten} />,
  );
  return onProposalWritten;
}

beforeEach(() => {
  vi.clearAllMocks();
  useAiAssistStore.setState({ isAiAssistUnlocked: false });
});

describe('ReadinessAiPanel', () => {
  it('renders nothing while AI Assist is locked', () => {
    const { container } = render(
      <ReadinessAiPanel lens={buildLens()} writeFieldIds={WRITE_FIELD_IDS} onProposalWritten={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the panel and a prompt scoped to the active lens once unlocked', () => {
    useAiAssistStore.setState({ isAiAssistUnlocked: true });
    renderPanel();

    const prompt = screen.getByLabelText(/ai prompt/i) as HTMLTextAreaElement;
    expect(prompt.value).toContain('F-1');
    expect(prompt.value).toContain('featureReadiness');
  });

  it('writes only the accepted estimate through the shared writer, never ownership', async () => {
    useAiAssistStore.setState({ isAiAssistUnlocked: true });
    const onProposalWritten = renderPanel();

    const reply = JSON.stringify({
      kind: 'featureReadiness',
      items: [{ issueKey: 'F-1', estimateSuggestion: '8', ownershipSuggestion: 'Route to PO', insight: 'At risk' }],
    });
    fireEvent.change(screen.getByLabelText(/paste ai reply/i), { target: { value: reply } });
    fireEvent.click(screen.getByRole('button', { name: /load proposals/i }));

    // Ownership guidance shows (as a paragraph, distinct from the reply textarea) but exposes no write button.
    expect(screen.getByText(/route to po/i, { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /accept ownership/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /accept estimate/i }));

    await waitFor(() => {
      expect(saveFeatureReviewSimpleField).toHaveBeenCalledWith('F-1', 'customfield_20007', '8');
    });
    expect(saveFeatureReviewSimpleField).toHaveBeenCalledTimes(1);
    expect(onProposalWritten).toHaveBeenCalled();
  });

  it('declining a proposal writes nothing', () => {
    useAiAssistStore.setState({ isAiAssistUnlocked: true });
    renderPanel();

    const reply = JSON.stringify({ kind: 'featureReadiness', items: [{ issueKey: 'F-1', estimateSuggestion: '8' }] });
    fireEvent.change(screen.getByLabelText(/paste ai reply/i), { target: { value: reply } });
    fireEvent.click(screen.getByRole('button', { name: /load proposals/i }));
    fireEvent.click(screen.getByRole('button', { name: /decline/i }));

    expect(saveFeatureReviewSimpleField).not.toHaveBeenCalled();
  });
});
