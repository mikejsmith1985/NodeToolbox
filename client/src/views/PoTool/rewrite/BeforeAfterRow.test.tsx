// BeforeAfterRow.test.tsx — the per-issue before/after review row (spec 030, US2).

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import BeforeAfterRow from './BeforeAfterRow.tsx';
import type { RewriteItem } from './rewriteBatchModel';

function makeItem(over: Partial<RewriteItem> = {}): RewriteItem {
  return {
    jiraKey: 'ABC-1',
    original: { summary: 'Old summary', description: 'old description', acceptanceCriteria: 'old ac', capturedAtIso: '2026-07-26T00:00:00Z' },
    proposed: { description: 'Description:\nnew description', acceptanceCriteria: 'new ac', isEdited: false },
    state: 'proposed',
    captureError: null,
    submitResult: null,
    ...over,
  };
}

describe('BeforeAfterRow', () => {
  it('renders the original beside the proposal', () => {
    render(<BeforeAfterRow item={makeItem()} onChange={vi.fn()} />);
    expect(screen.getByText('ABC-1')).toBeInTheDocument();
    expect(screen.getByText(/old description/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/new description/)).toBeInTheDocument();
  });

  it('editing the proposed description updates the proposal and marks it edited', () => {
    const onChange = vi.fn();
    render(<BeforeAfterRow item={makeItem()} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/proposed description/i), { target: { value: 'my edit' } });
    const next = onChange.mock.calls[0][0] as RewriteItem;
    expect(next.proposed?.description).toBe('my edit');
    expect(next.proposed?.isEdited).toBe(true);
  });

  it('the state control sets the item state', () => {
    const onChange = vi.fn();
    render(<BeforeAfterRow item={makeItem()} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect((onChange.mock.calls[0][0] as RewriteItem).state).toBe('approved');
  });

  it('editing an approved item returns it to reviewing (FR-023)', () => {
    const onChange = vi.fn();
    render(<BeforeAfterRow item={makeItem({ state: 'approved' })} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/proposed acceptance criteria/i), { target: { value: 'changed ac' } });
    expect((onChange.mock.calls[0][0] as RewriteItem).state).toBe('reviewing');
  });
});
