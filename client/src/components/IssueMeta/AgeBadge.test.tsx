// AgeBadge.test.tsx — Unit tests for the graded age badge.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AgeBadge } from './AgeBadge.tsx';

describe('AgeBadge', () => {
  it('renders the day count with the overdue tone past twice the stale threshold', () => {
    render(<AgeBadge ageDays={16} staleDaysThreshold={5} />);
    expect(screen.getByText('16d')).toHaveAttribute('data-tone', 'danger');
  });

  it('renders a comfortable tone below the threshold', () => {
    render(<AgeBadge ageDays={2} staleDaysThreshold={5} />);
    expect(screen.getByText('2d')).toHaveAttribute('data-tone', 'neutral');
  });
});
