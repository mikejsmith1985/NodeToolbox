// BusinessHelperView.test.tsx — Unit tests for the top-level Business Helper view shell.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./tabs/SimpleSearchTab.tsx', () => ({
  default: () => <div>Simple Search Tab Content</div>,
}));

vi.mock('./tabs/StablizationFundingTab.tsx', () => ({
  default: () => <div>Stablization Tab Content</div>,
}));

vi.mock('./tabs/BusinessHelperSettingsTab.tsx', () => ({
  default: () => <div>Settings Tab Content</div>,
}));

import BusinessHelperView from './BusinessHelperView.tsx';

describe('BusinessHelperView', () => {
  it('renders the page header and lets the user switch between Business Helper tabs', () => {
    render(<BusinessHelperView />);

    expect(screen.getByRole('heading', { name: 'Business Helper' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Simple Search' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Stablization' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('Simple Search Tab Content')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Stablization' }));

    expect(screen.getByText('Stablization Tab Content')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));

    expect(screen.getByText('Settings Tab Content')).toBeInTheDocument();
  });
});
