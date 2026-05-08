// ToastProvider.test.tsx — Tests for the shared in-app toast notification system.

import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToastProvider, useToast } from './ToastProvider.tsx';

function ToastHarness() {
  const { showToast } = useToast();

  return (
    <button onClick={() => showToast('Saved successfully', 'success')} type="button">
      Show toast
    </button>
  );
}

describe('ToastProvider', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a toast message when showToast is called', async () => {
    const user = userEvent.setup();

    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    await user.click(screen.getByRole('button', { name: /show toast/i }));

    expect(screen.getByText('Saved successfully')).toBeInTheDocument();
  });

  it('removes a toast after the timeout expires', () => {
    vi.useFakeTimers();

    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /show toast/i }));
    expect(screen.getByText('Saved successfully')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4_000);
    });

    expect(screen.queryByText('Saved successfully')).not.toBeInTheDocument();
  });

  it('throws when useToast is used outside the provider', () => {
    expect(() => render(<ToastHarness />)).toThrow('useToast must be used inside ToastProvider');
  });
});
