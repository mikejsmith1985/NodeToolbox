// ConfigurationTab.test.tsx — Verifies the dedicated CRG configuration tab renders in configuration mode.

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./CrgTab.tsx', () => ({
  default: ({ mode }: { mode?: 'wizard' | 'configuration' }) => (
    <div data-mode={mode} data-testid="mock-crg-tab">CRG Tab</div>
  ),
}));

import ConfigurationTab from './ConfigurationTab.tsx';

describe('ConfigurationTab', () => {
  it('renders the CRG tab in configuration mode', () => {
    render(<ConfigurationTab />);

    expect(screen.getByTestId('mock-crg-tab')).toBeInTheDocument();
    expect(screen.getByTestId('mock-crg-tab')).toHaveAttribute('data-mode', 'configuration');
  });
});
