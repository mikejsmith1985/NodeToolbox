// ConfigurationTab.test.tsx — Verifies the dedicated CRG configuration tab renders in configuration mode.

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./CreateChgTab.tsx', () => ({
  default: ({ mode }: { mode?: 'wizard' | 'configuration' }) => (
    <div data-mode={mode} data-testid="mock-create-chg-tab">Create CHG Tab</div>
  ),
}));

import ConfigurationTab from './ConfigurationTab.tsx';

describe('ConfigurationTab', () => {
  it('renders the Create CHG tab in configuration mode', () => {
    render(<ConfigurationTab />);

    expect(screen.getByTestId('mock-create-chg-tab')).toBeInTheDocument();
    expect(screen.getByTestId('mock-create-chg-tab')).toHaveAttribute('data-mode', 'configuration');
  });
});
