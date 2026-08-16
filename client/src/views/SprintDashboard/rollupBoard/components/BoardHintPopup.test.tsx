// BoardHintPopup.test.tsx — Proves a passing note behaves like one: it says its piece and leaves.

import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BoardHintPopup } from './BoardHintPopup.tsx';

describe('BoardHintPopup', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the message where the thing happened', () => {
    render(<BoardHintPopup message="Move it to In progress first." onDismiss={vi.fn()} position={{ xPx: 400, yPx: 300 }} />);

    const hint = screen.getByTestId('rollup-board-hint');
    expect(hint.textContent).toContain('Move it to In progress first.');
    expect(hint.getAttribute('style')).toContain('400px');
  });

  it('clears itself, so a passing note never becomes a permanent mark', () => {
    // The failure this replaces stayed pinned to a card in red, about an action nobody was going to
    // retry, on work that was perfectly fine.
    const onDismiss = vi.fn();
    render(<BoardHintPopup message="Move it to In progress first." onDismiss={onDismiss} position={{ xPx: 1, yPx: 1 }} />);

    act(() => { vi.advanceTimersByTime(5000); });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('can be dismissed at once rather than waited out', () => {
    const onDismiss = vi.fn();
    render(<BoardHintPopup message="Nope." onDismiss={onDismiss} position={{ xPx: 1, yPx: 1 }} />);

    screen.getByRole('button', { name: 'Dismiss' }).click();

    expect(onDismiss).toHaveBeenCalled();
  });

  it('is announced, so somebody who cannot see the pointer still learns the drop did nothing', () => {
    render(<BoardHintPopup message="Nope." onDismiss={vi.fn()} position={{ xPx: 1, yPx: 1 }} />);

    expect(screen.getByTestId('rollup-board-hint').getAttribute('role')).toBe('status');
  });

  it('renders nothing at all when there is nothing to say', () => {
    render(<BoardHintPopup message="" onDismiss={vi.fn()} position={null} />);

    expect(screen.queryByTestId('rollup-board-hint')).toBeNull();
  });
});
