// Tests for the AI Assist Automation config form (gating is handled by AdminHubView).

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAssistAutomationPanel } from './AiAssistAutomationPanel.tsx';

// The shape the server actually returns: it reports WHETHER a secret is set, never the secret itself.
const SAVED_CONFIG = {
  webhookUrl: 'https://x.atlassian.net/hook',
  hasWebhookSecret: true,
  parkingSpaceKey: 'AI_ASSIST',
  parkingPageId: '781058099',
  isEnabled: true,
};

/** The body of the POST the form sent, parsed. */
function readSavedBody(): Record<string, unknown> {
  const postCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
    (call) => call[0] === '/api/ai-assist/config' && call[1]?.method === 'POST',
  );
  return JSON.parse((postCall?.[1] as RequestInit).body as string) as Record<string, unknown>;
}

describe('AiAssistAutomationPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => SAVED_CONFIG }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('loads the config from the server on mount', async () => {
    render(<AiAssistAutomationPanel />);
    expect(await screen.findByText('⚡ AI Assist Automation')).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/ai-assist/config'));
    const urlInput = await screen.findByPlaceholderText(/incoming webhook URL/i) as HTMLInputElement;
    await waitFor(() => expect(urlInput.value).toBe('https://x.atlassian.net/hook'));
  });

  it('saves the config via POST on Save', async () => {
    render(<AiAssistAutomationPanel />);
    await screen.findByText('⚡ AI Assist Automation');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const postCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === '/api/ai-assist/config' && call[1]?.method === 'POST',
      );
      expect(postCall).toBeTruthy();
    });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });
});

describe('AiAssistAutomationPanel — the webhook secret is write-only', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => SAVED_CONFIG }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('leaves the secret box blank even when one is saved, because the server never sends it back', async () => {
    render(<AiAssistAutomationPanel />);
    await screen.findByText('⚡ AI Assist Automation');

    const secretInput = await screen.findByLabelText('Webhook Secret') as HTMLInputElement;
    await waitFor(() => expect(secretInput.value).toBe(''));
  });

  it('says a secret is saved, so a blank box does not read as "not configured"', async () => {
    render(<AiAssistAutomationPanel />);

    expect(await screen.findByText(/A secret is saved/i)).toBeInTheDocument();
  });

  it('says plainly when no secret is saved yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ ...SAVED_CONFIG, hasWebhookSecret: false }),
    }));
    render(<AiAssistAutomationPanel />);

    expect(await screen.findByText(/No secret is saved yet/i)).toBeInTheDocument();
  });

  it('sends a blank secret when the PO does not touch it, so the saved one is kept', async () => {
    render(<AiAssistAutomationPanel />);
    await screen.findByText('⚡ AI Assist Automation');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText('Saved.')).toBeInTheDocument());
    expect(readSavedBody().webhookSecret).toBe('');
    expect(readSavedBody().clearWebhookSecret).toBe(false);
  });

  it('sends a new secret when one is typed', async () => {
    render(<AiAssistAutomationPanel />);
    await screen.findByText('⚡ AI Assist Automation');

    fireEvent.change(await screen.findByLabelText('Webhook Secret'), { target: { value: 'rotated-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(readSavedBody().webhookSecret).toBe('rotated-token'));
  });

  it('offers an explicit way to remove a saved secret', async () => {
    render(<AiAssistAutomationPanel />);
    await screen.findByText('⚡ AI Assist Automation');

    fireEvent.click(await screen.findByLabelText(/Remove the saved secret/i));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(readSavedBody().clearWebhookSecret).toBe(true));
  });

  it('does not offer to remove a secret that is not there', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ ...SAVED_CONFIG, hasWebhookSecret: false }),
    }));
    render(<AiAssistAutomationPanel />);
    await screen.findByText(/No secret is saved yet/i);

    expect(screen.queryByLabelText(/Remove the saved secret/i)).toBeNull();
  });

  it('clears the typed secret after saving, so it is not left sitting in the DOM', async () => {
    render(<AiAssistAutomationPanel />);
    await screen.findByText('⚡ AI Assist Automation');
    const secretInput = await screen.findByLabelText('Webhook Secret') as HTMLInputElement;

    fireEvent.change(secretInput, { target: { value: 'rotated-token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByText('Saved.')).toBeInTheDocument());
    expect(secretInput.value).toBe('');
  });
});
