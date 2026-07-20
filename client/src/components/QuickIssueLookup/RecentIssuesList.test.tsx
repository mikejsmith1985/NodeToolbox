// RecentIssuesList.test.tsx — Tests the pre-search recents list: render, click, arrow-key focus.

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RecentIssuesList } from './RecentIssuesList.tsx';

const ENTRIES = [
  { key: 'ABC-1', summary: 'First issue' },
  { key: 'ABC-2', summary: 'Second issue' },
];

describe('RecentIssuesList', () => {
  afterEach(() => vi.clearAllMocks());

  it('renders nothing when there are no recents', () => {
    const { container } = render(<RecentIssuesList entries={[]} onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders each recent with its key and summary', () => {
    render(<RecentIssuesList entries={ENTRIES} onSelect={vi.fn()} />);
    expect(screen.getByText('ABC-1')).toBeInTheDocument();
    expect(screen.getByText('First issue')).toBeInTheDocument();
    expect(screen.getByText('ABC-2')).toBeInTheDocument();
  });

  it('calls onSelect with the key when a recent is clicked', () => {
    const onSelect = vi.fn();
    render(<RecentIssuesList entries={ENTRIES} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Second issue'));
    expect(onSelect).toHaveBeenCalledWith('ABC-2');
  });

  it('moves focus to the next recent on ArrowDown', () => {
    render(<RecentIssuesList entries={ENTRIES} onSelect={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    buttons[0].focus();
    fireEvent.keyDown(buttons[0], { key: 'ArrowDown' });
    expect(buttons[1]).toHaveFocus();
  });
});
