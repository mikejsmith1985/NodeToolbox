// Tests for the AI Assist Automation config form (gating is handled by AdminHubView).

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AiAssistAutomationPanel } from './AiAssistAutomationPanel.tsx';

const SAVED_CONFIG = { webhookUrl: 'https://x.atlassian.net/hook', webhookSecret: 's', parkingSpaceKey: 'AI_ASSIST', isEnabled: true };

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
