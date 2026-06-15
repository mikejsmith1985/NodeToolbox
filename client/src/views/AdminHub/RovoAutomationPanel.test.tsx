// Tests for the Rovo Automation config form (gating is handled by AdminHubView).

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RovoAutomationPanel } from './RovoAutomationPanel.tsx';

const SAVED_CONFIG = { webhookUrl: 'https://x.atlassian.net/hook', webhookSecret: 's', parkingSpaceKey: 'ROVO', isEnabled: true };

describe('RovoAutomationPanel', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => SAVED_CONFIG }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('loads the config from the server on mount', async () => {
    render(<RovoAutomationPanel />);
    expect(await screen.findByText('⚡ Rovo Automation')).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/rovo/config'));
    const urlInput = await screen.findByPlaceholderText(/incoming webhook URL/i) as HTMLInputElement;
    await waitFor(() => expect(urlInput.value).toBe('https://x.atlassian.net/hook'));
  });

  it('saves the config via POST on Save', async () => {
    render(<RovoAutomationPanel />);
    await screen.findByText('⚡ Rovo Automation');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const postCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
        (call) => call[0] === '/api/rovo/config' && call[1]?.method === 'POST',
      );
      expect(postCall).toBeTruthy();
    });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });
});
