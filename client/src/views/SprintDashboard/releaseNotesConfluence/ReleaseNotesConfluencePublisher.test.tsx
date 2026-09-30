// ReleaseNotesConfluencePublisher.test.tsx — Unit tests for the release notes "Post to Confluence" control.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { publishReleaseNotesToConfluence } from '../hooks/releaseNotesConfluence.ts';
import { ReleaseNotesConfluencePublisher } from './ReleaseNotesConfluencePublisher.tsx';

vi.mock('../hooks/releaseNotesConfluence.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/releaseNotesConfluence.ts')>()),
  publishReleaseNotesToConfluence: vi.fn(),
}));

const PARENT_PAGE_URL = 'https://wiki.example.com/pages/viewpage.action?pageId=555';
const publishMock = vi.mocked(publishReleaseNotesToConfluence);

function renderPublisher(): void {
  render(
    <ReleaseNotesConfluencePublisher
      pageTitle="Transformers 10/14/2026 Release Notes"
      projectKey="ENFCT"
      storageValue="<p>Notes</p>"
    />,
  );
}

describe('ReleaseNotesConfluencePublisher', () => {
  beforeEach(() => {
    window.localStorage.clear();
    publishMock.mockReset();
  });

  it('keeps the post button disabled until a parent page is chosen', () => {
    renderPublisher();

    expect(screen.getByRole('button', { name: /post to confluence/i })).toBeDisabled();
  });

  it('posts under the chosen parent, remembers it, and links the resulting page', async () => {
    publishMock.mockResolvedValue({ pageUrl: 'https://wiki.example.com/x/999', wasCreated: true });
    renderPublisher();

    fireEvent.change(screen.getByLabelText(/confluence parent page/i), { target: { value: PARENT_PAGE_URL } });
    fireEvent.click(screen.getByRole('button', { name: /post to confluence/i }));

    await waitFor(() => expect(screen.getByRole('link', { name: /open page/i })).toHaveAttribute(
      'href',
      'https://wiki.example.com/x/999',
    ));
    expect(publishMock).toHaveBeenCalledWith({
      parentPageReference: PARENT_PAGE_URL,
      pageTitle: 'Transformers 10/14/2026 Release Notes',
      storageValue: '<p>Notes</p>',
    });
    expect(screen.getByText(/created/i)).toBeInTheDocument();
    expect(window.localStorage.getItem('tbxReleaseNotesConfluenceParents')).toContain('pageId=555');
  });

  it('says the page was updated when this release had been posted before', async () => {
    publishMock.mockResolvedValue({ pageUrl: 'https://wiki.example.com/x/777', wasCreated: false });
    window.localStorage.setItem('tbxReleaseNotesConfluenceParents', JSON.stringify({ ENFCT: PARENT_PAGE_URL }));
    renderPublisher();

    fireEvent.click(screen.getByRole('button', { name: /post to confluence/i }));

    await waitFor(() => expect(screen.getByText(/updated/i)).toBeInTheDocument());
  });

  it('shows why a post failed', async () => {
    publishMock.mockRejectedValue(new Error('Confluence POST page "x" failed: No permission'));
    window.localStorage.setItem('tbxReleaseNotesConfluenceParents', JSON.stringify({ ENFCT: PARENT_PAGE_URL }));
    renderPublisher();

    fireEvent.click(screen.getByRole('button', { name: /post to confluence/i }));

    await waitFor(() => expect(screen.getByText(/no permission/i)).toBeInTheDocument());
  });
});
