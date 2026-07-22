// index.test.tsx — Verifies the app-wide AI Assist unlock gate (Ctrl+Alt+Z + passphrase).

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { setAiAssistUnlocked, useAiAssistStore } from '../../store/aiAssistStore.ts';
import { AiAssistUnlockGate } from './index.tsx';

// The real activation passphrase (its SHA-256 digest is what useAiAssist checks against).
const CORRECT_PASSPHRASE = 'unlock';

afterEach(() => {
  setAiAssistUnlocked(false);
});

describe('AiAssistUnlockGate', () => {
  it('renders nothing until the shortcut is pressed', () => {
    const { container } = render(<AiAssistUnlockGate />);
    expect(container).toBeEmptyDOMElement();
  });

  it('opens the passphrase prompt on Ctrl+Alt+Z from anywhere', () => {
    render(<AiAssistUnlockGate />);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, altKey: true });
    expect(screen.getByPlaceholderText('Enter passphrase')).toBeInTheDocument();
  });

  it('unlocks the shared store when the correct passphrase is entered', async () => {
    render(<AiAssistUnlockGate />);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, altKey: true });
    fireEvent.change(screen.getByPlaceholderText('Enter passphrase'), { target: { value: CORRECT_PASSPHRASE } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock AI Assist' }));

    await waitFor(() => expect(useAiAssistStore.getState().isAiAssistUnlocked).toBe(true));
    // The prompt closes on success.
    await waitFor(() => expect(screen.queryByPlaceholderText('Enter passphrase')).not.toBeInTheDocument());
  });

  it('shows an error and stays locked on a wrong passphrase', async () => {
    render(<AiAssistUnlockGate />);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, altKey: true });
    fireEvent.change(screen.getByPlaceholderText('Enter passphrase'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock AI Assist' }));

    expect(await screen.findByText('Incorrect passphrase')).toBeInTheDocument();
    expect(useAiAssistStore.getState().isAiAssistUnlocked).toBe(false);
  });

  it('re-locks on a second Ctrl+Alt+Z when already unlocked', () => {
    setAiAssistUnlocked(true);
    render(<AiAssistUnlockGate />);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, altKey: true });
    expect(useAiAssistStore.getState().isAiAssistUnlocked).toBe(false);
    // No prompt is shown when the shortcut is used to re-lock.
    expect(screen.queryByPlaceholderText('Enter passphrase')).not.toBeInTheDocument();
  });
});
