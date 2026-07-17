// PriorityBadge.test.tsx — Unit tests for the priority badge.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PriorityBadge } from './PriorityBadge.tsx';

describe('PriorityBadge', () => {
  it('renders the direction glyph and the priority name with the severity tone', () => {
    render(<PriorityBadge priorityName="High" />);
    const priorityBadge = screen.getByText(/High/);
    expect(priorityBadge).toHaveAttribute('data-tone', 'warning');
    expect(priorityBadge.textContent).toContain('↑');
  });

  it('degrades unknown priorities to a neutral flat badge with the name visible', () => {
    render(<PriorityBadge priorityName="Whatever" />);
    const priorityBadge = screen.getByText(/Whatever/);
    expect(priorityBadge).toHaveAttribute('data-tone', 'neutral');
    expect(priorityBadge.textContent).toContain('→');
  });
});
