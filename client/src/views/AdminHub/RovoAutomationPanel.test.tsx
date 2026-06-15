// Tests for the gated Rovo Automation config panel.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockIsRovoUnlocked } = vi.hoisted(() => ({ mockIsRovoUnlocked: { value: true } }));
vi.mock('../../store/rovoStore', () => ({
  useRovoStore: (selector: (state: { isRovoUnlocked: boolean }) => unknown) => selector({ isRovoUnlocked: mockIsRovoUnlocked.value }),
}));

import { RovoAutomationPanel } from './RovoAutomationPanel.tsx';

const SAVED_CONFIG = { webhookUrl: 'https://x.atlassian.net/hook', webhookSecret: 's', parkingSpaceKey: 'ROVO', isEnabled: true };

describe('RovoAutomationPanel', () => {
  beforeEach(() => {
    mockIsRovoUnlocked.value = true;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => SAVED_CONFIG }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders nothing when the Rovo capability is locked', () => {
    mockIsRovoUnlocked.value = false;
    const { container } = render(<RovoAutomationPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('loads the config on mount and shows the section when unlocked', async () => {
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
