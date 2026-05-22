// ToastContext.test.tsx — Tests the shared toast context hook contract used by ToastProvider consumers.

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ToastContext, useToast } from './ToastContext.ts';

function ToastContextHarness() {
  const { showToast } = useToast();

  return (
    <button onClick={() => showToast('Context toast', 'info')} type="button">
      Trigger toast
    </button>
  );
}

describe('ToastContext', () => {
  it('returns the current toast dispatcher from context', () => {
    const showToast = vi.fn();

    render(
      <ToastContext.Provider value={{ showToast }}>
        <ToastContextHarness />
      </ToastContext.Provider>,
    );

    screen.getByRole('button', { name: /trigger toast/i }).click();

    expect(showToast).toHaveBeenCalledWith('Context toast', 'info');
  });

  it('throws when the hook is used without a provider', () => {
    expect(() => render(<ToastContextHarness />)).toThrow('useToast must be used inside ToastProvider');
  });
});
