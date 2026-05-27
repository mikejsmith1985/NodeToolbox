// ChgTab.test.tsx — Tests for unified CHG Create/Modify tab with mode toggle.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import ChgTab from './ChgTab.tsx';

// Mock the child tabs
vi.mock('./CreateChgTab.tsx', () => ({
  default: () => <div data-testid="create-chg-tab">Create CHG Tab</div>,
}));

vi.mock('./ModifyChgTab.tsx', () => ({
  default: () => <div data-testid="modify-chg-tab">Modify CHG Tab</div>,
}));

describe('ChgTab', () => {
  it('renders the Create CHG button and Modify CHG button', () => {
    render(<ChgTab />);
    expect(screen.getByRole('button', { name: /Create CHG/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Modify CHG/i })).toBeInTheDocument();
  });

  it('displays the Create tab by default', () => {
    render(<ChgTab />);
    expect(screen.getByTestId('create-chg-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('modify-chg-tab')).not.toBeInTheDocument();
  });

  it('switches to Modify mode when Modify button is clicked', async () => {
    const user = userEvent.setup();
    render(<ChgTab />);

    const modifyButton = screen.getByRole('button', { name: /Modify CHG/i });
    await user.click(modifyButton);

    expect(screen.getByTestId('modify-chg-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('create-chg-tab')).not.toBeInTheDocument();
  });

  it('switches back to Create mode when Create button is clicked', async () => {
    const user = userEvent.setup();
    render(<ChgTab />);

    const modifyButton = screen.getByRole('button', { name: /Modify CHG/i });
    await user.click(modifyButton);

    const createButton = screen.getByRole('button', { name: /Create CHG/i });
    await user.click(createButton);

    expect(screen.getByTestId('create-chg-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('modify-chg-tab')).not.toBeInTheDocument();
  });

  it('sets aria-pressed correctly on active mode button', async () => {
    const user = userEvent.setup();
    render(<ChgTab />);

    const createButton = screen.getByRole('button', { name: /Create CHG/i });
    const modifyButton = screen.getByRole('button', { name: /Modify CHG/i });

    // Create mode is active initially
    expect(createButton).toHaveAttribute('aria-pressed', 'true');
    expect(modifyButton).toHaveAttribute('aria-pressed', 'false');

    // Switch to Modify mode
    await user.click(modifyButton);
    expect(createButton).toHaveAttribute('aria-pressed', 'false');
    expect(modifyButton).toHaveAttribute('aria-pressed', 'true');
  });
});
