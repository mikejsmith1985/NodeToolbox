// BulkCommentPanel.test.tsx — Tests for the Bulk Comment Panel component.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import BulkCommentPanel from './BulkCommentPanel.tsx';

describe('BulkCommentPanel', () => {
  it('shows selected count text', () => {
    render(
      <BulkCommentPanel
        bulkCommentError={null}
        isBulkPostingComment={false}
        onCancelBulk={vi.fn()}
        onPostBulkComment={vi.fn()}
        selectedCount={3}
        selectedKeys={['TBX-1', 'TBX-2', 'TBX-3']}
      />,
    );

    expect(screen.getByText(/3 issues selected/i)).toBeInTheDocument();
  });

  it('renders the comment textarea', () => {
    render(
      <BulkCommentPanel
        bulkCommentError={null}
        isBulkPostingComment={false}
        onCancelBulk={vi.fn()}
        onPostBulkComment={vi.fn()}
        selectedCount={1}
        selectedKeys={['TBX-1']}
      />,
    );

    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('disables submit when no comment is typed', () => {
    render(
      <BulkCommentPanel
        bulkCommentError={null}
        isBulkPostingComment={false}
        onCancelBulk={vi.fn()}
        onPostBulkComment={vi.fn()}
        selectedCount={1}
        selectedKeys={['TBX-1']}
      />,
    );

    expect(screen.getByRole('button', { name: /post comment/i })).toBeDisabled();
  });

  it('enables submit when a comment is typed', async () => {
    const user = userEvent.setup();
    render(
      <BulkCommentPanel
        bulkCommentError={null}
        isBulkPostingComment={false}
        onCancelBulk={vi.fn()}
        onPostBulkComment={vi.fn()}
        selectedCount={1}
        selectedKeys={['TBX-1']}
      />,
    );

    await user.type(screen.getByRole('textbox'), 'Hello world');

    expect(screen.getByRole('button', { name: /post comment/i })).not.toBeDisabled();
  });

  it('calls onPostBulkComment with trimmed text when submitted', async () => {
    const user = userEvent.setup();
    const handlePost = vi.fn();
    render(
      <BulkCommentPanel
        bulkCommentError={null}
        isBulkPostingComment={false}
        onCancelBulk={vi.fn()}
        onPostBulkComment={handlePost}
        selectedCount={1}
        selectedKeys={['TBX-1']}
      />,
    );

    await user.type(screen.getByRole('textbox'), '  hello  ');
    await user.click(screen.getByRole('button', { name: /post comment/i }));

    expect(handlePost).toHaveBeenCalledWith('hello');
  });

  it('calls onCancelBulk when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const handleCancel = vi.fn();
    render(
      <BulkCommentPanel
        bulkCommentError={null}
        isBulkPostingComment={false}
        onCancelBulk={handleCancel}
        onPostBulkComment={vi.fn()}
        selectedCount={1}
        selectedKeys={['TBX-1']}
      />,
    );

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(handleCancel).toHaveBeenCalled();
  });

  it('shows a spinner while posting', () => {
    render(
      <BulkCommentPanel
        bulkCommentError={null}
        isBulkPostingComment={true}
        onCancelBulk={vi.fn()}
        onPostBulkComment={vi.fn()}
        selectedCount={2}
        selectedKeys={['TBX-1', 'TBX-2']}
      />,
    );

    expect(screen.getByText(/posting/i)).toBeInTheDocument();
  });

  it('shows error message when bulkCommentError is set', () => {
    render(
      <BulkCommentPanel
        bulkCommentError="Failed to post to TBX-2"
        isBulkPostingComment={false}
        onCancelBulk={vi.fn()}
        onPostBulkComment={vi.fn()}
        selectedCount={1}
        selectedKeys={['TBX-1']}
      />,
    );

    expect(screen.getByText(/failed to post to tbx-2/i)).toBeInTheDocument();
  });
});
