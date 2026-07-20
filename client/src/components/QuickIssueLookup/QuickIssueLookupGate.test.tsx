// QuickIssueLookupGate.test.tsx — Tests the app-wide F2 shell: open/close, preventDefault, keyboard guard.
//
// The popup body's data hook, reused panel, and connection store are mocked so these tests focus on
// the gate's own keyboard handling.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QuickIssueLookupGate } from './QuickIssueLookupGate.tsx';
import { useQuickLookupStore } from './quickLookupStore.ts';

vi.mock('../../hooks/useIssueByKey.ts', () => ({
  useIssueByKey: () => ({ issue: null, status: 'idle', errorMessage: null, refetch: vi.fn() }),
}));

vi.mock('../IssueDetailPanel/index.tsx', () => ({
  default: () => <div data-testid="issue-detail-panel" />,
}));

vi.mock('../../store/connectionStore.ts', () => ({
  useConnectionStore: (selector: (state: unknown) => unknown) =>
    selector({ proxyStatus: { jira: { baseUrl: 'https://jira.example.com' } } }),
}));

describe('QuickIssueLookupGate', () => {
  // Open/close state now lives in the app-wide store, so reset it to the closed baseline per test.
  beforeEach(() => useQuickLookupStore.setState({ isOpen: false, seedKey: null, openNonce: 0 }));
  afterEach(() => vi.clearAllMocks());

  it('renders nothing until F2 is pressed', () => {
    render(<QuickIssueLookupGate />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the dialog on F2 and prevents the browser default', () => {
    render(<QuickIssueLookupGate />);

    const f2Event = new KeyboardEvent('keydown', { key: 'F2', cancelable: true });
    act(() => {
      window.dispatchEvent(f2Event);
    });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(f2Event.defaultPrevented).toBe(true);
  });

  it('ignores F2 while the user is typing in a field outside the popup', () => {
    render(
      <>
        <input aria-label="outside field" />
        <QuickIssueLookupGate />
      </>,
    );
    const outsideField = screen.getByLabelText('outside field');
    outsideField.focus();

    act(() => {
      outsideField.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', cancelable: true, bubbles: true }));
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes the dialog on Escape', () => {
    render(<QuickIssueLookupGate />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', cancelable: true }));
    });

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
