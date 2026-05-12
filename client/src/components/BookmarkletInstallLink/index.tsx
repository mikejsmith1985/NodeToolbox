// BookmarkletInstallLink.tsx — Safe drag-to-bookmarks link for browser bookmarklet installation.

import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';

const BOOKMARKLET_SAFE_PLACEHOLDER_HREF = '#';

interface BookmarkletInstallLinkProps {
  bookmarkletCode: string;
  className: string;
  title: string;
  children: ReactNode;
  onClick(clickEvent: ReactMouseEvent<HTMLAnchorElement>): void;
}

/**
 * Renders a draggable bookmarklet link without passing a javascript: URL through React.
 *
 * React 19 blocks javascript: href props during rendering, but bookmarklet install
 * still needs the browser-native anchor href attribute for drag-to-bookmarks.
 */
export function BookmarkletInstallLink({
  bookmarkletCode,
  className,
  title,
  children,
  onClick,
}: BookmarkletInstallLinkProps) {
  const bookmarkletAnchorRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    const bookmarkletAnchor = bookmarkletAnchorRef.current;
    if (bookmarkletAnchor === null) {
      return;
    }

    // Assign after render so React never sanitizes the bookmarklet URL, while
    // the browser can still drag the real href into the bookmarks bar.
    bookmarkletAnchor.setAttribute('href', bookmarkletCode);
  }, [bookmarkletCode]);

  return (
    <a
      ref={bookmarkletAnchorRef}
      href={BOOKMARKLET_SAFE_PLACEHOLDER_HREF}
      className={className}
      draggable
      title={title}
      onClick={onClick}
    >
      {children}
    </a>
  );
}
