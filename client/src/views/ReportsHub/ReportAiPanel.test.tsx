// ReportAiPanel.test.tsx — Verifies the shared report AI shell is gated, copies the prompt, and ingests replies.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setAiAssistUnlocked } from '../../store/aiAssistStore.ts';

// The clipboard helper the "Copy prompt" button calls; mocked so a click can be asserted in jsdom.
const { mockCopyToClipboard } = vi.hoisted(() => ({ mockCopyToClipboard: vi.fn() }));
vi.mock('../FeatureCanvas/ai/clipboard.ts', () => ({ copyToClipboard: mockCopyToClipboard }));

import { ReportAiPanel } from './ReportAiPanel.tsx';

describe('ReportAiPanel', () => {
  afterEach(() => {
    act(() => setAiAssistUnlocked(false));
    mockCopyToClipboard.mockReset();
  });

  it('renders nothing while AI Assist is locked', () => {
    const { container } = render(
      <ReportAiPanel title="AI triage" prompt="PROMPT" ingestLabel="Ingest" onIngest={vi.fn()} error={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the prompt and copies it when unlocked', () => {
    act(() => setAiAssistUnlocked(true));
    render(<ReportAiPanel title="AI triage" prompt="THE PROMPT TEXT" ingestLabel="Ingest" onIngest={vi.fn()} error={null} />);

    expect(screen.getByDisplayValue('THE PROMPT TEXT')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /copy prompt/i }));
    expect(mockCopyToClipboard).toHaveBeenCalledWith('THE PROMPT TEXT');
  });

  it('disables ingest until a reply is pasted, then calls onIngest with the pasted text', () => {
    act(() => setAiAssistUnlocked(true));
    const onIngest = vi.fn();
    render(<ReportAiPanel title="AI triage" prompt="P" ingestLabel="Ingest verdicts" onIngest={onIngest} error={null} />);

    const ingestButton = screen.getByRole('button', { name: /ingest verdicts/i });
    expect(ingestButton).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/paste the assistant's json reply/i), { target: { value: '{"kind":"x"}' } });
    expect(ingestButton).toBeEnabled();
    fireEvent.click(ingestButton);
    expect(onIngest).toHaveBeenCalledWith('{"kind":"x"}');
  });

  it('surfaces an ingest error and renders the results children', () => {
    act(() => setAiAssistUnlocked(true));
    render(
      <ReportAiPanel title="AI triage" prompt="P" ingestLabel="Ingest" onIngest={vi.fn()} error="Could not read the response.">
        <div>results-slot</div>
      </ReportAiPanel>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Could not read the response.');
    expect(screen.getByText('results-slot')).toBeInTheDocument();
  });
});
