// StatusChip.test.tsx — Unit tests for the status chip.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusChip } from './StatusChip.tsx';

describe('StatusChip', () => {
  it('renders the status name with the category tone', () => {
    render(<StatusChip statusName="Ready to Accept" statusCategoryKey="indeterminate" />);
    expect(screen.getByText('Ready to Accept')).toHaveAttribute('data-tone', 'progress');
  });

  it('renders unknown categories neutrally with the name still visible', () => {
    render(<StatusChip statusName="Weird State" />);
    expect(screen.getByText('Weird State')).toHaveAttribute('data-tone', 'neutral');
  });
});
