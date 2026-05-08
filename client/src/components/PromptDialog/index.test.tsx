// index.test.tsx — Tests for the shared in-app prompt dialog.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import PromptDialog from './index.tsx';

describe('PromptDialog', () => {
  it('renders a prompt message and disabled submit button until text is entered', () => {
    render(<PromptDialog message="Enter the passphrase" onCancel={vi.fn()} onConfirm={vi.fn()} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Enter the passphrase')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'OK' })).toBeDisabled();
  });

  it('calls onConfirm with the entered value', async () => {
    const user = userEvent.setup();
    const handleConfirm = vi.fn();

    render(<PromptDialog message="Enter the passphrase" onCancel={vi.fn()} onConfirm={handleConfirm} />);

    await user.type(screen.getByRole('textbox'), 'secret');
    await user.click(screen.getByRole('button', { name: 'OK' }));

    expect(handleConfirm).toHaveBeenCalledWith('secret');
  });

  it('calls onCancel when the cancel button is clicked', async () => {
    const user = userEvent.setup();
    const handleCancel = vi.fn();

    render(<PromptDialog message="Enter the passphrase" onCancel={handleCancel} onConfirm={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(handleCancel).toHaveBeenCalledOnce();
  });
});
