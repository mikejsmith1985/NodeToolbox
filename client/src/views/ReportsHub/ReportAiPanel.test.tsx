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

  it('confirms a prompt copy by flipping the button label to ✓ Copied!', () => {
    act(() => setAiAssistUnlocked(true));
    render(<ReportAiPanel title="AI triage" prompt="P" ingestLabel="Ingest" onIngest={vi.fn()} error={null} />);

    fireEvent.click(screen.getByRole('button', { name: /copy prompt/i }));

    expect(screen.getByRole('button', { name: '✓ Copied!' })).toBeInTheDocument();
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

  // ── The automated exchange is retired: the shell is copy-out / paste-back only ──
  //
  // Feature 016 added an optional onRunAuto prop for the PI Review panel. The automation channel
  // can no longer be used, so the prop is gone and no caller can offer an auto path.

  it('never renders an automated exchange button — the shell is copy/paste only', () => {
    act(() => setAiAssistUnlocked(true));
    render(<ReportAiPanel title="AI triage" prompt="P" ingestLabel="Ingest" onIngest={vi.fn()} error={null} />);

    expect(screen.queryByRole('button', { name: /run via ai assist/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy prompt/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/paste the assistant's json reply/i)).toBeInTheDocument();
  });

  it('shows the advisory hint by default', () => {
    act(() => setAiAssistUnlocked(true));
    render(<ReportAiPanel title="AI triage" prompt="P" ingestLabel="Ingest" onIngest={vi.fn()} error={null} />);

    expect(screen.getByText(/writes nothing to jira/i)).toBeInTheDocument();
  });

  it('lets a caller replace the advisory hint — it must not claim to write nothing when it can', () => {
    // The PI Review panel CAN reach Jira (an accepted estimate arms the existing write-back), so the
    // default "writes nothing to Jira" hint would be a lie there. FR-030 makes that disclosure a
    // first-class requirement, so the shell must not hardcode the opposite claim.
    act(() => setAiAssistUnlocked(true));
    render(
      <ReportAiPanel
        error={null}
        hint="review each suggestion · an accepted estimate can update the Jira issue"
        ingestLabel="Ingest"
        onIngest={vi.fn()}
        prompt="P"
        title="AI Assistance"
      />,
    );

    expect(screen.getByText(/an accepted estimate can update the jira issue/i)).toBeInTheDocument();
    expect(screen.queryByText(/writes nothing to jira/i)).not.toBeInTheDocument();
  });
});
