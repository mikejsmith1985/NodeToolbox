// index.test.tsx — Tests for the shared in-app confirm dialog.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import ConfirmDialog from './index.tsx';

describe('ConfirmDialog', () => {
  it('renders the message and default buttons', () => {
    render(<ConfirmDialog message="Delete this item?" onCancel={vi.fn()} onConfirm={vi.fn()} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Delete this item?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });

  it('calls onConfirm when the confirm button is clicked', async () => {
    const user = userEvent.setup();
    const handleConfirm = vi.fn();

    render(<ConfirmDialog message="Delete this item?" onCancel={vi.fn()} onConfirm={handleConfirm} />);

    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    expect(handleConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when the cancel button is clicked', async () => {
    const user = userEvent.setup();
    const handleCancel = vi.fn();

    render(<ConfirmDialog message="Delete this item?" onCancel={handleCancel} onConfirm={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(handleCancel).toHaveBeenCalledOnce();
  });
});
