// PoAiPanel.test.tsx — Proves the gate hides the accelerator completely when locked, and that the
// round trip is copy-out / paste-back with no service call and no Jira write (SC-005, SC-006, FR-021).

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setAiAssistUnlocked, useAiAssistStore } from '../../../store/aiAssistStore';
import { AI_MODE_MESSAGE_CHARACTER_LIMIT } from '../../../utils/promptFile.ts';
import PoAiPanel from './PoAiPanel';

function renderPanel(overrides: Partial<Parameters<typeof PoAiPanel>[0]> = {}) {
  const onIngest = vi.fn().mockReturnValue({ acceptedCount: 2, errors: [] });
  const utils = render(
    <PoAiPanel
      title="Propose a split"
      buildPrompt={() => 'PROMPT TEXT'}
      onIngest={onIngest}
      helpText="Nothing is written to Jira until you commit."
      {...overrides}
    />,
  );
  return { ...utils, onIngest };
}

beforeEach(() => {
  vi.clearAllMocks();
  useAiAssistStore.setState({ isAiAssistUnlocked: false });
});

describe('PoAiPanel — the gate (SC-005)', () => {
  it('renders NOTHING for a locked session — no button, no hint, no trace', () => {
    const { container } = renderPanel();

    expect(container).toBeEmptyDOMElement();
  });

  it('appears once AI Assist is unlocked', () => {
    setAiAssistUnlocked(true);

    renderPanel();

    expect(screen.getByRole('button', { name: /build the prompt/i })).toBeInTheDocument();
  });

  it('disappears again when the gate is re-locked mid-draft', () => {
    setAiAssistUnlocked(true);
    const { rerender, container } = renderPanel();
    expect(screen.getByRole('button', { name: /build the prompt/i })).toBeInTheDocument();

    setAiAssistUnlocked(false);
    rerender(
      <PoAiPanel
        title="Propose a split"
        buildPrompt={() => 'PROMPT TEXT'}
        onIngest={vi.fn()}
        helpText="help"
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe('PoAiPanel — the round trip', () => {
  beforeEach(() => {
    setAiAssistUnlocked(true);
  });

  it('does not build the prompt until the PO asks', () => {
    const buildPrompt = vi.fn().mockReturnValue('PROMPT TEXT');

    renderPanel({ buildPrompt });

    expect(buildPrompt).not.toHaveBeenCalled();
  });

  it('shows the PO the prompt before they send it anywhere', async () => {
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: /build the prompt/i }));

    expect(screen.getByLabelText(/read it, then copy it/i)).toHaveValue('PROMPT TEXT');
  });

  it('makes the prompt read-only, so what is copied is what was reviewed', async () => {
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: /build the prompt/i }));

    expect(screen.getByLabelText(/read it, then copy it/i)).toHaveAttribute('readonly');
  });

  it('never calls a service — the PO runs the prompt themselves', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: /build the prompt/i }));

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('will not ingest an empty reply', async () => {
    renderPanel();

    await userEvent.click(screen.getByRole('button', { name: /build the prompt/i }));

    expect(screen.getByRole('button', { name: /read the reply/i })).toBeDisabled();
  });

  it('hands the pasted reply to the tab, which owns the draft', async () => {
    const { onIngest } = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: /build the prompt/i }));

    await userEvent.type(screen.getByLabelText(/paste the assistant/i), '{{"kind":"x"}');
    await userEvent.click(screen.getByRole('button', { name: /read the reply/i }));

    expect(onIngest).toHaveBeenCalledWith('{"kind":"x"}');
  });

  it('says plainly that nothing is in Jira yet', async () => {
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: /build the prompt/i }));
    await userEvent.type(screen.getByLabelText(/paste the assistant/i), 'reply');
    await userEvent.click(screen.getByRole('button', { name: /read the reply/i }));

    expect(screen.getByText(/nothing is in Jira yet/i)).toBeInTheDocument();
  });
});

describe('PoAiPanel — what it says about a bad reply (SC-009)', () => {
  beforeEach(() => {
    setAiAssistUnlocked(true);
  });

  it('reports every problem rather than swallowing them', async () => {
    renderPanel({
      onIngest: vi.fn().mockReturnValue({
        acceptedCount: 0,
        errors: ['Response kind "sizeEstimate" is not featureSplitIngest.'],
      }),
    });
    await userEvent.click(screen.getByRole('button', { name: /build the prompt/i }));
    await userEvent.type(screen.getByLabelText(/paste the assistant/i), 'wrong kind');
    await userEvent.click(screen.getByRole('button', { name: /read the reply/i }));

    const problems = screen.getByLabelText('Problems with the reply');
    expect(problems).toHaveTextContent('is not featureSplitIngest');
  });

  it('reports partial success — what landed AND what did not', async () => {
    renderPanel({
      onIngest: vi.fn().mockReturnValue({
        acceptedCount: 2,
        errors: ['Increment at position 3 is missing a summary.'],
      }),
    });
    await userEvent.click(screen.getByRole('button', { name: /build the prompt/i }));
    await userEvent.type(screen.getByLabelText(/paste the assistant/i), 'partly good');
    await userEvent.click(screen.getByRole('button', { name: /read the reply/i }));

    expect(screen.getByText(/2 proposal\(s\) added below/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Problems with the reply')).toHaveTextContent('position 3');
  });

  it('keeps the reply on screen when nothing could be read, so the PO can look at it', async () => {
    renderPanel({ onIngest: vi.fn().mockReturnValue({ acceptedCount: 0, errors: ['No JSON object found.'] }) });
    await userEvent.click(screen.getByRole('button', { name: /build the prompt/i }));
    await userEvent.type(screen.getByLabelText(/paste the assistant/i), 'garbage');
    await userEvent.click(screen.getByRole('button', { name: /read the reply/i }));

    expect(screen.getByLabelText(/paste the assistant/i)).toHaveValue('garbage');
  });
});

describe('PoAiPanel — the follow-up for a reply in the wrong shape (GH #499)', () => {
  beforeEach(() => {
    setAiAssistUnlocked(true);
  });

  async function readReply(): Promise<void> {
    await userEvent.click(screen.getByRole('button', { name: /build the prompt/i }));
    await userEvent.type(screen.getByLabelText(/paste the assistant/i), 'an answer engine reply');
    await userEvent.click(screen.getByRole('button', { name: /read the reply/i }));
  }

  it('shows the follow-up for the same chat when the round hands one back', async () => {
    renderPanel({ onIngest: vi.fn().mockReturnValue({ acceptedCount: 0, errors: ['No JSON object found.'], followUpPrompt: 'PUT IT IN THE TABLE' }) });
    await readReply();

    expect(screen.getByLabelText(/follow-up for the same ai chat/i)).toHaveValue('PUT IT IN THE TABLE');
  });

  it('shows no follow-up when the reply was read in full', async () => {
    renderPanel();
    await readReply();

    expect(screen.queryByLabelText(/follow-up for the same ai chat/i)).not.toBeInTheDocument();
  });

  it('drops an old follow-up once a fresh prompt is built', async () => {
    renderPanel({ onIngest: vi.fn().mockReturnValue({ acceptedCount: 1, errors: [], followUpPrompt: 'ONLY THE MISSING ROWS' }) });
    await readReply();
    await userEvent.click(screen.getByRole('button', { name: /build the prompt/i }));

    expect(screen.queryByLabelText(/follow-up for the same ai chat/i)).not.toBeInTheDocument();
  });
});

describe('PoAiPanel — a prompt too long for AI Mode (GH #499)', () => {
  it('offers the built prompt as a file to attach once it passes AI Mode\'s 2,048 characters', async () => {
    setAiAssistUnlocked(true);
    renderPanel({ buildPrompt: () => 'x'.repeat(AI_MODE_MESSAGE_CHARACTER_LIMIT + 1) });

    await userEvent.click(screen.getByRole('button', { name: /build the prompt/i }));

    expect(screen.getByRole('button', { name: 'Download the prompt (PDF)' })).toBeInTheDocument();
  });
});
