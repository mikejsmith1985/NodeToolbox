// Tests for the gated Rovo Automation config panel.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRovoAssist } = vi.hoisted(() => ({
  mockRovoAssist: { isUnlocked: true, verifyPassphrase: vi.fn() },
}));
vi.mock('../SnowHub/hooks/useRovoAssist.ts', () => ({
  useRovoAssist: () => mockRovoAssist,
}));

import { RovoAutomationPanel } from './RovoAutomationPanel.tsx';

const SAVED_CONFIG = { webhookUrl: 'https://x.atlassian.net/hook', webhookSecret: 's', parkingSpaceKey: 'ROVO', isEnabled: true };

describe('RovoAutomationPanel', () => {
  beforeEach(() => {
    mockRovoAssist.isUnlocked = true;
    mockRovoAssist.verifyPassphrase = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => SAVED_CONFIG }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders nothing when locked and the passphrase gate is closed', () => {
    mockRovoAssist.isUnlocked = false;
    const { container } = render(<RovoAutomationPanel />);
    expect(container).toBeEmptyDOMElement();
  });

  it('reveals the passphrase gate on the hidden Ctrl+Alt+Z shortcut while locked', () => {
    mockRovoAssist.isUnlocked = false;
    render(<RovoAutomationPanel />);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, altKey: true });
    expect(screen.getByPlaceholderText('Enter passphrase')).toBeInTheDocument();
  });

  it('calls verifyPassphrase when a passphrase is submitted', async () => {
    mockRovoAssist.isUnlocked = false;
    mockRovoAssist.verifyPassphrase = vi.fn().mockResolvedValue(false);
    render(<RovoAutomationPanel />);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, altKey: true });
    fireEvent.change(screen.getByPlaceholderText('Enter passphrase'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(mockRovoAssist.verifyPassphrase).toHaveBeenCalledWith('wrong'));
    expect(await screen.findByText('Incorrect passphrase')).toBeInTheDocument();
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
