// BusinessHelperView.test.tsx — Unit tests for the top-level Business Helper view shell.

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./tabs/SimpleSearchTab.tsx', () => ({
  default: () => <div>Simple Search Tab Content</div>,
}));

import BusinessHelperView from './BusinessHelperView.tsx';

describe('BusinessHelperView', () => {
  it('renders the page header and the Simple Search tab panel', () => {
    render(<BusinessHelperView />);

    expect(screen.getByRole('heading', { name: 'Business Helper' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Simple Search' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Simple Search Tab Content')).toBeInTheDocument();
  });
});
