// SuggestionList.test.tsx — Proves each suggestion is shown beside the current text and written only when accepted.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import SuggestionList from './SuggestionList.tsx';

const SUGGESTIONS = [
  { fieldKey: 'justification' as const, fieldLabel: 'Justification', currentText: 'Old', suggestedText: 'New reason' },
  { fieldKey: 'testPlan' as const, fieldLabel: 'Test Plan', currentText: '', suggestedText: '1. Smoke test' },
];

describe('SuggestionList', () => {
  it('writes an accepted suggestion and leaves a declined one alone', () => {
    const onAccept = vi.fn();
    render(<SuggestionList suggestions={SUGGESTIONS} onAccept={onAccept} />);
    expect(screen.getByText('Old')).toBeTruthy();
    expect(screen.getByText('(empty)')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Accept' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith(SUGGESTIONS[0]);
    expect(screen.getByText('✓ Accepted')).toBeTruthy();
    expect(screen.getByText('Declined — left as it was')).toBeTruthy();
  });

  it('never says an AI wrote anything', () => {
    render(<SuggestionList suggestions={SUGGESTIONS} onAccept={vi.fn()} />);
    expect(document.body.textContent).not.toMatch(/\bAI\b|assistant/i);
  });
});
