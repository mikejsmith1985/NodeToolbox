// BookmarkletInstallLink.test.tsx — Unit tests for safe bookmarklet installation links.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BookmarkletInstallLink } from './index.tsx';

describe('BookmarkletInstallLink', () => {
  it('sets the bookmarklet href as a DOM attribute after React renders safely', () => {
    render(
      <BookmarkletInstallLink
        bookmarkletCode="javascript:mockRelay()"
        className="bookmarklet-link"
        title="Drag this to your bookmarks bar"
        onClick={() => undefined}
      >
        NodeToolbox SNow Relay
      </BookmarkletInstallLink>,
    );

    expect(screen.getByRole('link', { name: /NodeToolbox SNow Relay/i })).toHaveAttribute(
      'href',
      'javascript:mockRelay()',
    );
  });

  it('keeps accidental clicks controlled by the owning setup surface', async () => {
    const user = userEvent.setup();
    const handleBookmarkletClick = vi.fn((clickEvent) => clickEvent.preventDefault());

    render(
      <BookmarkletInstallLink
        bookmarkletCode="javascript:mockRelay()"
        className="bookmarklet-link"
        title="Drag this to your bookmarks bar"
        onClick={handleBookmarkletClick}
      >
        NodeToolbox SNow Relay
      </BookmarkletInstallLink>,
    );

    await user.click(screen.getByRole('link', { name: /NodeToolbox SNow Relay/i }));

    expect(handleBookmarkletClick).toHaveBeenCalledTimes(1);
  });
});
